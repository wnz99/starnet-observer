import { test } from "bun:test";
import assert from "node:assert/strict";
import { makeObserver } from "./index.js";
import { makeIdentityResolver } from "../identity/index.js";
import { createQuerySpine } from "../../browser/queryspine.js";
import type { ObserverOptions } from "./contracts.js";
import type { ObserverSnapshot } from "../../shared/observer.js";
import { must, fixtureString, busFixture } from "./testing.fixture.js";
import { counts } from "../failopen.js";
const NO_MATCH = false;
const ID = "00000000-0000-0000-0000-000000000001";
const pane = (id: string, session = ID) => ({
  pane_id: id,
  agent: "codex",
  agent_status: "working",
  terminal_title_stripped: "Title",
  cwd: "/private/project",
  agent_session: { agent: "codex", kind: "id", value: session },
});
const makeCoreObserver = (options: ObserverOptions) =>
  makeObserver({
    overseerState: {
      read: () => Promise.resolve({ state: "empty" }),
      match: () => Promise.resolve(NO_MATCH),
    },
    ...options,
  });
test("observer queryspine polling freshness", async () => {
  for (const contention of ["healthy", "intermittent", "perpetual"])
    await pollingFreshness(contention);
  async function pollingFreshness(contention: string) {
    let clock = 0,
      serial = 0,
      inventoryMode = "healthy",
      holdHelpers = false,
      releaseHelpers: () => void = () => {
        throw new Error("fixture gate missing");
      };
    const events: { at: number; run: () => void }[] = [],
      intervals = new Set<number>(),
      starts: number[] = [],
      publications: { at: number; data: ObserverSnapshot }[] = [],
      rpcCounts = new Map<string, number>(),
      birthCounts = new Map<number, number>();
    let activeRpc = 0,
      maxRpc = 0,
      activeBirth = 0,
      maxBirth = 0;
    const attempts = new Map<string, { start: number; end: number }[]>();
    const diagnosticsBefore = counts()["observer.identity.content"] || 0;
    let maxWorkers = 0,
      maxWaiting = 0;
    const working = new Set<string>();
    const panes = Array.from({ length: 20 }, (_, index) => ({
      ...pane(`timing:${String(index)}`),
      terminal_id: `terminal_${String(index)}`,
    }));
    const helperGate = new Promise<void>((resolve) => {
      releaseHelpers = resolve;
    });
    const delay = (ms: number) =>
      new Promise<void>((resolve) => events.push({ at: clock + ms, run: resolve }));
    const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
    const herdrRows = (data: ObserverSnapshot) =>
      data.sessions.filter((row) => row.source === "herdr");
    function assertHealthyAge() {
      if (!Q.state("observer.sessions").hasData || clock >= 8000) return;
      const data = stateData();
      assert(
        clock - must(data.sources.herdr.observedAt) < 6000,
        "healthy source never ages beyond six seconds while pending",
      );
      for (const row of herdrRows(data))
        assert(
          clock - must(row.observedAt) < 6000,
          "healthy row never ages beyond six seconds while pending",
        );
    }
    async function advance(target: number) {
      await flush();
      for (;;) {
        events.sort((a, b) => a.at - b.at);
        if (events.length === 0 || must(events[0]).at > target) break;
        clock = must(events[0]).at;
        assertHealthyAge();
        while (events[0]?.at === clock) must(events.shift()).run();
        await flush();
        assertHealthyAge();
      }
      clock = target;
      await flush();
      assertHealthyAge();
    }
    function startRpc(id: string, count: number) {
      rpcCounts.set(id, count);
      maxRpc = Math.max(maxRpc, ++activeRpc);
      if (count % 8 !== 1) return;
      const records = attempts.get(id) || [];
      records.push({ start: clock, end: clock });
      attempts.set(id, records);
      working.add(id);
      maxWorkers = Math.max(maxWorkers, working.size);
      maxWaiting = Math.max(maxWaiting, 20 - attempts.size);
    }
    function copyMotion(id: string, count: number, index: number) {
      const final = count % 8 === 0;
      if (final) {
        must(attempts.get(id)?.at(-1)).end = clock;
        working.delete(id);
      }
      const conflict =
        final &&
        (contention === "perpetual" || (contention === "intermittent" && index < 4 && count === 8));
      return { result: { pane_id: id, content_revision: conflict ? 10 : 8 } };
    }
    const identities = makeIdentityResolver({
      now: () => clock,
      readConfiguration: () => Promise.resolve("configured"),
      readProcessBirth: async (pid) => {
        birthCounts.set(pid, (birthCounts.get(pid) || 0) + 1);
        maxBirth = Math.max(maxBirth, ++activeBirth);
        await delay(25);
        activeBirth--;
        return { pid, startSeconds: 1, startMicroseconds: 2 };
      },
      rpc: async (method, params) => {
        const id = fixtureString(params.pane_id || params.target),
          index = Number(id.split(":")[1]);
        const count = (rpcCounts.get(id) || 0) + 1;
        startRpc(id, count);
        // Synthetic workload only: eight RPCs plus two fresh birth reads.
        // First footer costs 30 ms; remaining seven RPCs each cost 27.5 ms.
        await delay(count === 1 ? 30 : 27.5);
        activeRpc--;
        if (method === "agent.get") return { result: { agent: panes[index] } };
        if (method === "pane.process_info")
          return { result: { process_info: { pane_id: id, shell_pid: index + 100 } } };
        if (method === "pane.get")
          return {
            result: {
              pane: { ...panes[index], scroll: { max_offset_from_bottom: 0, viewport_rows: 20 } },
            },
          };
        if (method === "pane.copy_motion") return copyMotion(id, count, index);
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
      execute: () => {
        starts.push(clock);
        rpcCounts.clear();
        birthCounts.clear();
        attempts.clear();
        maxRpc = 0;
        maxBirth = 0;
        if (inventoryMode === "failed") throw Error("synthetic outage");
        return Promise.resolve({
          stdout: JSON.stringify({ result: { agents: inventoryMode === "empty" ? [] : panes } }),
        });
      },
      projects: { resolve: () => Promise.resolve({ projectId: "fixture" }) },
      transcripts: { read: () => Promise.resolve({ available: false }), retain() {} },
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
      bus: { read: () => busFixture() },
      desktop: {
        inventory: () =>
          Promise.resolve({
            health: "available",
            observedAt: -7000,
            windows: [{ id: "old-desktop", provider: "codex", status: "idle" }],
          }),
      },
    });
    const observed = new WeakSet();
    function isObserved(value: unknown): value is ObserverSnapshot {
      return value !== null && typeof value === "object" && observed.has(value);
    }
    const Q = createQuerySpine({
      now: () => clock,
      getJson: async () => {
        const value = await observer.get();
        observed.add(value);
        return value;
      },
      interval: (fn, ms) => {
        const id = ++serial;
        intervals.add(id);
        const tick = () => {
          if (!intervals.has(id)) return;
          fn();
          events.push({ at: clock + ms, run: tick });
        };
        events.push({ at: clock + ms, run: tick });
        return () => {
          intervals.delete(id);
        };
      },
    });
    function stateData() {
      const data = Q.state("observer.sessions").data;
      assert(isObserved(data), "query cache keeps actual observer snapshot identity");
      return data;
    }
    Q.define("observer.sessions", {
      path: "/api/observer/sessions",
      ttlMs: 2000,
      pollMs: 2000,
      timeoutMs: 10000,
      validate: isObserved,
    });
    async function characterizeContention() {
      // At most 28 complete attempts, seven four-worker waves, first-admission
      // skew and unchanged downstream work. Failed work remains in this bound.
      const bound = 7 * 272.5 + 30 + 100;
      await advance(1999);
      const publication = must(publications.at(-1));
      assert.equal(starts.length, 1);
      assert(publication.at <= bound);
      const count = [...attempts.values()].reduce((sum, records) => sum + records.length, 0);
      assert.equal(count, contention === "intermittent" ? 24 : 28);
      assert.equal(
        [...rpcCounts.values()].reduce((sum, value) => sum + value, 0),
        count * 8,
      );
      assert.equal(
        [...birthCounts.values()].reduce((sum, value) => sum + value, 0),
        count * 2,
      );
      assert.equal(maxRpc, 4);
      assert.equal(maxWorkers, 4);
      assert.equal(maxWaiting, 19, "first admitted capture leaves nineteen waiting panes");
      assert(maxBirth <= 4);
      for (let index = 4; index < 20; index++) {
        assert(attempts.has(`timing:${String(index)}`), "later panes retain first admission");
        assert.equal(attempts.get(`timing:${String(index)}`)?.length, 1);
      }
      for (const records of attempts.values()) {
        assert(records.length <= 3);
        assert(must(records.at(-1)).end - must(records[0]).start <= 812.5);
      }
      const rows = herdrRows(publication.data);
      assert.equal(
        rows.filter((row) => row.identitySource === "footer").length,
        contention === "intermittent" ? 20 : 0,
      );
      assert(rows.every((row) => row.observedAt === 0));
      assert.equal(
        (counts()["observer.identity.content"] || 0) - diagnosticsBefore,
        contention === "perpetual" ? 20 : 0,
        "only exhausted captures emit diagnostics",
      );
      console.log(
        JSON.stringify({
          contention,
          publication: publication.at,
          attempts: count,
          rpc: count * 8,
          births: count * 2,
          maxRpc,
          maxBirth,
          maxWorkers,
          maxWaiting,
          exhausted: rows.filter((row) => row.identitySource === "unavailable").length,
          captureLatency: [...attempts.values()].map((records) => ({
            attempts: records.length,
            latency: must(records.at(-1)).end - must(records[0]).start,
          })),
        }),
      );
    }
    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = Q.subscribe("observer.sessions", (state) => {
        if (state.hasData && !state.pending) publications.push({ at: clock, data: stateData() });
      });
      if (contention !== "healthy") {
        await characterizeContention();
        return;
      }
      for (const start of [0, 2000, 4000, 6000]) {
        await advance(start + 1500);
        assert.deepEqual(
          starts,
          [0, 2000, 4000, 6000].filter((time) => time <= start),
          "actual poll callback starts inventory every two seconds",
        );
        const publication = must(publications.at(-1));
        const publishedSources = publication.data.sources;
        assert.equal(publishedSources.herdr.observedAt, start);
        assert(
          publication.at - start <= 1500,
          "four capture workers plus first admission and downstream fit synthetic budget",
        );
        assert.equal(herdrRows(publication.data).length, 20);
        assert(
          herdrRows(publication.data).every(
            (row) => row.identitySource === "footer" && row.observedAt === start,
          ),
        );
        assert.deepEqual([...rpcCounts.values()], Array(20).fill(8));
        assert.equal(
          [...rpcCounts.values()].reduce((sum, value) => sum + value, 0),
          160,
        );
        console.log(
          JSON.stringify({
            contention,
            publication: publication.at - start,
            rpc: 160,
            births: 40,
            maxRpc,
            maxBirth,
            maxWorkers,
            maxWaiting,
          }),
        );
        assert.deepEqual([...birthCounts.values()], Array(20).fill(2));
        assert.equal(maxRpc, 4);
        assert(maxBirth <= 4);
        assert.equal(publishedSources.desktop.observedAt, -7000);
        assert.equal(
          publication.data.sessions.find((row) => row.source === "desktop")?.observedAt,
          -7000,
        );
        assert(
          clock - must(publishedSources.desktop.observedAt) > 6000,
          "fresh Herdr never renews old Desktop",
        );
      }
      holdHelpers = true;
      await advance(13700);
      const duringHelpers = stateData();
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
      const unavailable = stateData();
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
      assert.equal(stateData().sources.herdr.health, "available");
      assert.equal(stateData().sources.herdr.observedAt, 18000);
      assert.deepEqual(
        herdrRows(stateData()),
        [],
        "authoritative empty inventory removes retained rows",
      );
      inventoryMode = "healthy";
      await advance(21700);
      const recovered = stateData();
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
        assert(!Q.state("observer.sessions").pending);
        assert.equal(intervals.size, 0);
      } finally {
        await observer.close();
        events.length = 0;
      }
    }
  }
}, 30000);
