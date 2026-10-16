const Harness=globalThis.Harness;
const { test } = require("bun:test");
const assert = require("node:assert/strict");
const { makeObserver } = require("./index.ts");
const ID = "00000000-0000-0000-0000-000000000001";
const pane = (id, session = ID) => ({
  pane_id: id,
  agent: "codex",
  agent_status: "working",
  terminal_title_stripped: "Title",
  cwd: "/private/project",
  agent_session: { agent: "codex", kind: "id", value: session },
});
const makeCoreObserver = (options) =>
  makeObserver({
    overseerState: { read: async () => ({ state: "empty" }), match: async () => false },
    ...options,
  });
test("observer queryspine polling freshness", async () => {
  await pollingFreshness();
  async function pollingFreshness() {
    const Q = require("../../../frontend/app/queryspine.fixture.js").loadQuerySpine();
    const { makeIdentityResolver } = require("../identity/index.ts");
    let clock = 0,
      serial = 0,
      inventoryMode = "healthy",
      holdHelpers = false,
      releaseHelpers;
    const events = [],
      intervals = new Map(),
      starts = [],
      publications = [],
      rpcCounts = new Map(),
      birthCounts = new Map();
    const panes = Array.from({ length: 20 }, (_, index) => ({
      ...pane("timing:" + index),
      terminal_id: "terminal_" + index,
    }));
    const helperGate = new Promise((resolve) => {
      releaseHelpers = resolve;
    });
    const delay = (ms) => new Promise((resolve) => events.push({ at: clock + ms, run: resolve }));
    const flush = () => new Promise((resolve) => setImmediate(resolve));
    const herdrRows = (data) => data.sessions.filter((row) => row.source === "herdr");
    function assertHealthyAge() {
      const data = Q.state("observer.sessions").data;
      if (!data || clock >= 8000) return;
      assert(
        clock - data.sources.herdr.observedAt < 6000,
        "healthy source never ages beyond six seconds while pending",
      );
      for (const row of herdrRows(data))
        assert(
          clock - row.observedAt < 6000,
          "healthy row never ages beyond six seconds while pending",
        );
    }
    async function advance(target) {
      await flush();
      while (true) {
        events.sort((a, b) => a.at - b.at);
        if (!events.length || events[0].at > target) break;
        clock = events[0].at;
        assertHealthyAge();
        while (events[0]?.at === clock) events.shift().run();
        await flush();
        assertHealthyAge();
      }
      clock = target;
      await flush();
      assertHealthyAge();
    }
    const identities = makeIdentityResolver({
      now: () => clock,
      readConfiguration: async () => "configured",
      readProcessBirth: async (pid) => {
        birthCounts.set(pid, (birthCounts.get(pid) || 0) + 1);
        await delay(25);
        return { pid, startSeconds: 1, startMicroseconds: 2 };
      },
      rpc: async (method, params) => {
        const id = params.pane_id || params.target,
          index = Number(id.split(":")[1]);
        const count = (rpcCounts.get(id) || 0) + 1;
        rpcCounts.set(id, count);
        // Synthetic workload only: nine RPCs total 250 ms; two birth reads total 50 ms.
        // First footer costs 30 ms; remaining eight RPCs each cost 27.5 ms.
        await delay(count === 1 ? 30 : 27.5);
        if (method === "agent.get") return { result: { agent: panes[index] } };
        if (method === "pane.process_info")
          return { result: { process_info: { pane_id: id, shell_pid: index + 100 } } };
        if (method === "pane.get")
          return {
            result: {
              pane: { pane_id: id, scroll: { max_offset_from_bottom: 0, viewport_rows: 20 } },
            },
          };
        if (method === "pane.copy_motion") return { result: { pane_id: id, content_revision: 8 } };
        assert.equal(method, "pane.read");
        return {
          result: {
            read: {
              pane_id: id,
              source: "recent",
              format: "text",
              text: "\n  " + ID + " · model\n  ? for shortcuts\n",
            },
          },
        };
      },
    });
    const observer = makeCoreObserver({
      now: () => clock,
      identities,
      execute: async () => {
        starts.push(clock);
        rpcCounts.clear();
        birthCounts.clear();
        if (inventoryMode === "failed") throw Error("synthetic outage");
        return {
          stdout: JSON.stringify({ result: { agents: inventoryMode === "empty" ? [] : panes } }),
        };
      },
      projects: { resolve: async () => ({ projectId: "fixture" }) },
      transcripts: { read: async () => ({ available: false }), retain() {} },
      helpers: {
        children: async () => {
          if (holdHelpers) {
            await helperGate;
            throw Error("synthetic helper failure");
          }
          await delay(100);
          return { rows: [], annotations: new Map(), overflow: new Map() };
        },
      },
      bus: { read: () => ({ rows: [] }) },
      desktop: {
        inventory: async () => ({
          health: "available",
          observedAt: -7000,
          windows: [{ id: "old-desktop", status: "idle" }],
        }),
      },
    });
    Q._resetForTest();
    Q.define("observer.sessions", {
      path: "/api/observer/sessions",
      ttlMs: 2000,
      pollMs: 2000,
      timeoutMs: 10000,
      validate: (data) => Array.isArray(data.sessions),
    });
    Q._setClockForTest(() => clock);
    Q._setGetForTest(() => observer.get());
    Q._setTimersForTest(
      (fn, ms) => {
        const id = ++serial;
        intervals.set(id, true);
        const tick = () => {
          if (!intervals.has(id)) return;
          fn();
          events.push({ at: clock + ms, run: tick });
        };
        events.push({ at: clock + ms, run: tick });
        return id;
      },
      (id) => intervals.delete(id),
    );
    let unsubscribe;
    try {
      unsubscribe = Q.subscribe("observer.sessions", (state) => {
        if (state.hasData && !state.pending) publications.push({ at: clock, data: state.data });
      });
      for (const start of [0, 2000, 4000, 6000]) {
        await advance(start + 1700);
        assert.deepEqual(
          starts,
          [0, 2000, 4000, 6000].filter((time) => time <= start),
          "actual poll callback starts inventory every two seconds",
        );
        const publication = publications.at(-1);
        assert.equal(publication.data.sources.herdr.observedAt, start);
        assert(
          publication.at - start <= 1700,
          "four capture workers plus first admission and downstream fit synthetic budget",
        );
        assert.equal(herdrRows(publication.data).length, 20);
        assert(
          herdrRows(publication.data).every(
            (row) => row.identitySource === "footer" && row.observedAt === start,
          ),
        );
        assert.deepEqual([...rpcCounts.values()], Array(20).fill(9));
        assert.deepEqual([...birthCounts.values()], Array(20).fill(2));
        assert.equal(publication.data.sources.desktop.observedAt, -7000);
        assert.equal(
          publication.data.sessions.find((row) => row.source === "desktop").observedAt,
          -7000,
        );
        assert(
          clock - publication.data.sources.desktop.observedAt > 6000,
          "fresh Herdr never renews old Desktop",
        );
      }
      holdHelpers = true;
      await advance(13700);
      const duringHelpers = Q.state("observer.sessions").data;
      assert.equal(
        duringHelpers.sources.herdr.observedAt,
        12000,
        "held helpers do not delay subsequent core observations",
      );
      assert(herdrRows(duringHelpers).every((row) => row.observedAt === 12000));
      holdHelpers = false;
      releaseHelpers();
      await advance(14100);
      inventoryMode = "failed";
      await advance(16100);
      const unavailable = Q.state("observer.sessions").data;
      assert.equal(unavailable.sources.herdr.health, "unavailable");
      assert.equal(unavailable.sources.herdr.observedAt, 14000);
      assert.equal(herdrRows(unavailable).length, 20);
      assert(
        herdrRows(unavailable).every(
          (row) => row.observedAt === 14000 && row.inventoryHealth === "unavailable",
        ),
      );
      inventoryMode = "empty";
      await advance(18100);
      assert.equal(Q.state("observer.sessions").data.sources.herdr.health, "available");
      assert.equal(Q.state("observer.sessions").data.sources.herdr.observedAt, 18000);
      assert.deepEqual(
        herdrRows(Q.state("observer.sessions").data),
        [],
        "authoritative empty inventory removes retained rows",
      );
      inventoryMode = "healthy";
      await advance(21700);
      const recovered = Q.state("observer.sessions").data;
      assert.equal(recovered.sources.herdr.observedAt, 20000);
      assert.equal(herdrRows(recovered).length, 20);
      assert(
        herdrRows(recovered).every(
          (row) => row.observedAt === 20000 && row.inventoryHealth === "available",
        ),
      );
      assert.equal(recovered.sources.desktop.observedAt, -7000);
    } finally {
      holdHelpers = false;
      releaseHelpers();
      unsubscribe?.();
      // Settle any deferred transport before resetting: QuerySpine clears its request timeout on settlement.
      try {
        await advance(clock + 1700);
        assert.equal(Q._debug("observer.sessions").inFlight, false);
        assert.equal(intervals.size, 0);
      } finally {
        Q._resetForTest();
        Q._setClockForTest(() => Date.now());
        Q._setTimersForTest(
          (fn, ms) => setInterval(fn, ms),
          (id) => clearInterval(id),
        );
        Q._setGetForTest((url, options) =>
          typeof Harness !== "undefined" && Harness.api
            ? Harness.api.get(url, options)
            : Promise.reject(Error("Harness.api.get unavailable")),
        );
        events.length = 0;
      }
    }
  }
}, 30000);
