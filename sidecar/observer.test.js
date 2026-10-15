"use strict";
const { test } = require("bun:test");

test("observer regression contracts", async () => {
  const assert = require("node:assert/strict");
  const { makeObserver: makeNativeObserver, aggregateRows } = require("./observer.js");
  // Inventory fixtures never consult a developer's real private overseer record.
  const emptyOverseerState = { read: async () => ({ state: "empty" }), match: async () => false };
  const makeCoreObserver = (options) =>
    makeNativeObserver({ overseerState: emptyOverseerState, ...options });
  // Legacy scenarios assert completed source observations. Track only injected fixture work;
  // the progressive fixtures below exercise the production core-return boundary directly.
  function makeObserver(options) {
    if (!options) return makeCoreObserver();
    const work = new Set();
    const tracked = { ...options, warmDetails: false };
    for (const [name, methods] of [
      ["transcripts", ["read"]],
      ["helpers", ["children", "prepareChildren"]],
      ["desktop", ["inventory"]],
      ["bus", ["read"]],
    ]) {
      if (!options[name]) continue;
      tracked[name] = { ...options[name] };
      for (const method of methods)
        if (typeof options[name][method] === "function")
          tracked[name][method] = (...args) => {
            const promise = Promise.resolve().then(() => options[name][method](...args));
            work.add(promise);
            promise.then(
              () => work.delete(promise),
              () => work.delete(promise),
            );
            return promise;
          };
    }
    const observer = makeCoreObserver(tracked);
    let pending;
    const get = () =>
      pending ||
      (pending = observer
        .get()
        .then(async () => {
          while (work.size) await Promise.allSettled([...work]);
          return observer.get();
        })
        .finally(() => {
          pending = null;
        }));
    return {
      ...observer,
      get,
      inspect: async (...args) => {
        await get();
        return observer.inspect(...args);
      },
    };
  }
  const { makeHelperObserver } = require("./observer-helpers.js");
  const { lastActivity } = require("./observer.js");
  const { makeDesktopObserver } = require("./observer-desktop.js");
  const fs = require("node:fs/promises");
  const os = require("node:os");
  const path = require("node:path");
  assert.throws(() => makeObserver(), /requires an injected now clock/);
  // Last activity for idle age: working is now; otherwise the newer of last conversation entry and last tool event, never in the future.
  assert.equal(lastActivity("working", { lastEntryAt: 5 }, 1000), 1000);
  assert.equal(
    lastActivity("idle", { lastEntryAt: 700, last: { at: new Date(600).toISOString() } }, 1000),
    700,
  );
  assert.equal(
    lastActivity("idle", { lastEntryAt: null, last: { at: new Date(600).toISOString() } }, 1000),
    600,
  );
  assert.equal(lastActivity("idle", { modifiedAt: 900 }, 1000), null, "file mtime is not activity");
  assert.equal(lastActivity("done", { lastEntryAt: 5000 }, 1000), 1000, "clock skew is clamped");
  assert.equal(lastActivity("idle", { available: false }, 1000), null);
  const ID = "00000000-0000-0000-0000-000000000001";
  const pane = (id, session = ID) => ({
    pane_id: id,
    agent: "codex",
    agent_status: "working",
    terminal_title_stripped: "Title",
    cwd: "/private/project",
    agent_session: { agent: "codex", kind: "id", value: session },
  });
  await (async () => {
    await overseerRoles();
    await progressivePublication();
    await progressiveOwnership();
    await progressiveOptionalFreshness();
    await boundedWarmup();
    await queuedWarmOwnership();
    await progressiveClose();
    await helperFailureTruthfulness();
    await progressiveGrouping();
    let now = 1000,
      count = 0,
      inventory = [
        {
          ...pane("one"),
          terminal_title_stripped: 'Check sk-ant-123456789ABC password="multi word canary"',
        },
        pane("two"),
      ],
      fail = false;
    let release;
    const reads = [];
    let inspectRelease = null;
    // A fixture bus reader: the real user bus is never opened by this test.
    let busReads = 0,
      busState = {
        rows: [
          {
            id: 7,
            sender: "codex:" + ID,
            recipient: "claude:" + ID,
            sentAt: null,
            acknowledgedAt: null,
            wake: "requested",
          },
        ],
        observedAt: 900,
        health: "available",
        reason: null,
      };
    const observer = makeObserver({
      readIdentityConfiguration: async () => "unconfigured",
      now: () => now,
      endpoint: "test",
      desktop: {
        inventory: async () => ({ health: "unavailable", reason: "unsupported", windows: [] }),
      },
      bus: {
        read: () => {
          busReads++;
          return busState;
        },
      },
      projects: { resolve: async () => ({ project: "project", projectId: "fixture" }) },
      transcripts: {
        read: async (...args) => {
          reads.push(args);
          return { available: false };
        },
        retain() {},
        inspect: async () => {
          if (inspectRelease)
            await new Promise((resolve) => {
              inspectRelease = resolve;
            });
          return { available: true, health: "available", turns: [{ text: "conversation" }] };
        },
      },
      execute: async (command, args, options) => {
        assert.equal(command, "herdr");
        assert.deepEqual(args, ["agent", "list"]);
        assert.equal(options.timeout, 3000);
        count++;
        if (release)
          await new Promise((resolve) => {
            release = resolve;
          });
        if (fail) throw new Error("SECRET");
        return { stdout: JSON.stringify({ result: { agents: inventory } }) };
      },
    });
    release = true;
    const first = observer.get(),
      concurrent = observer.get();
    assert.equal(first, concurrent);
    release();
    release = null;
    const a = await first;
    assert.equal(count, 1);
    assert.equal(a.sessions.length, 2);
    assert.notEqual(a.sessions[0].id, a.sessions[1].id);
    assert.equal(a.sessions[0].project, "project");
    assert(!JSON.stringify(a).includes("/private"));
    assert(!a.sessions[0].title.includes("123456789ABC"));
    assert(!a.sessions[0].title.includes("canary"));
    assert(a.sessions[0].title.includes("Check"));
    assert.equal((await observer.inspect(a.sessions[0].id)).health, "available");
    assert.equal((await observer.inspect("unknown")).reason, "unknown-session");
    assert.equal((await observer.get()).observedAt, 1000);
    assert.equal(count, 1);
    assert.equal(busReads, 1, "the bus shares the 2s snapshot cache");
    // Two panes share the codex session, so the join stays ambiguous; the claude address has no pane.
    assert.deepEqual(a.bus.messages, [
      {
        id: 7,
        from: "ambiguous",
        to: "external",
        sentAt: null,
        acknowledgedAt: null,
        wake: "requested",
      },
    ]);
    assert.equal(a.bus.health, "available");
    assert(!JSON.stringify(a.bus).includes(ID));
    now = 4000;
    fail = true;
    busState = { ...busState, health: "unavailable", reason: "unreadable" };
    const stale = await observer.get();
    assert.equal(stale.health, "unavailable");
    assert.equal(stale.observedAt, 1000);
    const staleInspection = await observer.inspect(a.sessions[0].id);
    assert.equal(staleInspection.reason, "inventory-unavailable");
    assert.deepEqual(staleInspection.turns, []);
    assert.deepEqual(
      [stale.bus.health, stale.bus.observedAt, stale.bus.messages.length],
      ["unavailable", 900, 1],
      "bus health is reported independently",
    );
    busState = { ...busState, health: "available", reason: null };
    assert.deepEqual(
      stale.sessions.map((row) => row.inventoryHealth),
      ["unavailable", "unavailable"],
    );
    assert.equal(stale.sessions[0].observedAt, a.sessions[0].observedAt);
    assert(!JSON.stringify(stale).includes("SECRET"));
    now = 7000;
    fail = false;
    inventory = [pane("one", null)];
    const b = await observer.get();
    assert.equal(b.sessions.length, 1);
    assert.equal(b.sessions[0].id, a.sessions[0].id);
    assert.equal(b.sessions[0].sessionId, null);
    assert.equal(reads.at(-1)[2], null);
    assert.equal((await observer.inspect(b.sessions[0].id)).reason, "identity-unavailable");
    assert.equal(b.bus.messages[0].from, "external", "a pane without a session id never joins");
    now = 10000;
    inventory = [pane("one"), pane("two", "00000000-0000-0000-0000-000000000002")];
    const joined = await observer.get();
    assert.equal(joined.bus.messages[0].from, joined.sessions[0].id, "exact provider:session join");
    inspectRelease = true;
    const oldInspection = observer.inspect(joined.sessions[0].id, "codex:" + ID);
    await new Promise((resolve) => setImmediate(resolve));
    now = 12500;
    inventory = [pane("one", "00000000-0000-0000-0000-000000000002")];
    await observer.get();
    inspectRelease();
    inspectRelease = null;
    assert.equal(
      (await oldInspection).reason,
      "identity-mismatch",
      "in-flight old-session conversation is discarded",
    );
    now = 15000;
    inventory = [pane("one"), pane("one")];
    assert.equal((await observer.get()).health, "unavailable");
    now = 18000;
    inventory = [];
    assert.deepEqual((await observer.get()).sessions, []);
    await refreshStartCache();
    await pollingFreshness();
    await identityEnrichmentOrdering();
    await usageAggregate();
    aggregateHostOwnership();
    await aggregateAgeAndOverflow();
    await aggregateOptionalEvidence();
    await optionalToolObservationFallback();
    await claudeHelperNamespaces();
    await footerInspection();
    await footerFinalValidationRace();
    await footerConfigurationRace();
    await footerAncestryProofSet();
    await stalledFooterEndpoint();
    await exactTargetInspection();
    await independentDesktop();
    await coldBuildIndependence();
    await helperComposition();
    await deepHelperOwnership();
    await cappedHelperOwnership();
    await nestedHelperGrouping();
    await boundedDiscovery();
    await composedSummaryBound();
    console.log(
      "observer: shared refresh, stable panes, cache freshness, stale retention and authoritative removal OK",
    );
  })();

  async function boundedDiscovery() {
    for (const batchProjects of [false, true]) {
      const agents = Array.from({ length: 9 }, (_, index) => ({
        ...pane("batch-" + index),
        cwd: "/fixture/" + index,
      }));
      let active = 0,
        maximum = 0,
        begins = 0,
        projectMaximum = 0,
        projectActive = 0;
      const gates = [],
        projectGates = [],
        projectCalls = [];
      const project = async (cwd) => {
        projectCalls.push(cwd);
        projectMaximum = Math.max(projectMaximum, ++projectActive);
        await new Promise((resolve) => projectGates.push(resolve));
        projectActive--;
        return { projectId: cwd };
      };
      const observer = makeObserver({
        now: () => 1000,
        execute: async () => ({ stdout: JSON.stringify({ result: { agents } }) }),
        identities: {
          resolveMany: async (panes) => panes.map(() => ({ sessionId: ID, source: "fixture" })),
        },
        projects: batchProjects
          ? {
              resolveMany: async (cwds) =>
                Promise.all(cwds.map((cwd) => Promise.resolve({ projectId: cwd }))),
            }
          : { resolve: project },
        transcripts: {
          beginDiscovery() {
            begins++;
          },
          retain() {},
          read: async (id) => {
            assert.equal(begins, 1, "sweep starts before summary reads");
            maximum = Math.max(maximum, ++active);
            await new Promise((resolve) => gates.push(resolve));
            active--;
            return { available: true, marker: id };
          },
        },
        helpers: {
          children: async () => ({ rows: [], annotations: new Map(), overflow: new Map() }),
        },
        desktop: { inventory: async () => ({ health: "available", windows: [] }) },
        bus: { read: async () => ({ rows: [] }) },
      });
      let complete = false;
      const refreshing = observer.get().then((value) => {
        complete = true;
        return value;
      });
      for (let attempts = 0; !complete && attempts < 1000; attempts++) {
        await new Promise((resolve) => setImmediate(resolve));
        gates
          .splice(0)
          .reverse()
          .forEach((resolve) => resolve());
        projectGates
          .splice(0)
          .reverse()
          .forEach((resolve) => resolve());
      }
      assert(complete, "bounded refresh completes");
      const snapshot = await refreshing;
      assert.equal(maximum, 4, "summary reads use four concurrent rows");
      assert(projectMaximum <= 4, "single-project injected adapter stays bounded");
      assert.equal(begins, 1);
      assert.deepEqual(
        snapshot.sessions.map((row) => row.paneId),
        agents.map((row) => row.pane_id),
        "completion order preserves roster order",
      );
      assert.deepEqual(
        snapshot.sessions.map((row) => row.projectId),
        agents.map((row) => row.cwd),
      );
      if (!batchProjects) assert.equal(projectCalls.length, agents.length);
      await observer.close();
    }
  }

  async function composedSummaryBound() {
    for (const closeEarly of [false, true]) {
      // Helper identity order differs from roster order: its first root is outside
      // the four summaries admitted initially. Identical pending keys cannot hide it.
      const agents = Array.from({ length: 9 }, (_, index) =>
        pane("composed-" + index, "00000000-0000-0000-0000-" + String(9 - index).padStart(12, "0")),
      );
      agents.push(pane("composed-presence", null));
      const gates = new Map(),
        calls = [],
        helperGate = deferred();
      let active = 0,
        maximum = 0,
        edgeReads = 0,
        cleaning = false;
      const transcripts = {
        retain() {},
        bindChild: async () => null,
        claudeCandidates: async () => [],
        read: async (id, provider, sessionId) => {
          if (cleaning) return { available: false };
          calls.push(sessionId);
          maximum = Math.max(maximum, ++active);
          try {
            await new Promise((resolve, reject) => gates.set(sessionId, { resolve, reject }));
            return { available: true };
          } finally {
            active--;
          }
        },
      };
      const helpers = makeHelperObserver({
        transcripts,
        now: () => 1000,
        readEdges: async () => {
          edgeReads++;
          await helperGate.promise;
          return { rows: [] };
        },
      });
      const observer = makeCoreObserver({
        now: () => 1000,
        warmDetails: false,
        transcripts,
        helpers,
        identities: {
          resolveMany: async (rows) =>
            rows.map((row) => ({ sessionId: row.agent_session.value, source: "native" })),
        },
        projects: { resolveMany: async (rows) => rows.map(() => ({ projectId: "fixture" })) },
        execute: async () => ({ stdout: JSON.stringify({ result: { agents } }) }),
        desktop: { inventory: async () => ({ health: "available", windows: [] }) },
        bus: { read: async () => ({ rows: [] }) },
      });
      try {
        const core = await observer.get();
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(core.sessions.length, agents.length, "core publishes while summaries wait");
        assert.equal(maximum, 4, "actual helper composition shares the four-summary bound");
        if (closeEarly) {
          const closing = observer.close();
          for (const gate of gates.values()) gate.resolve();
          await closing;
          assert.equal(
            calls.length,
            4,
            "close settles queued helper roots without admitting more reads",
          );
          assert.equal(edgeReads, 0, "close cannot discover helpers from abandoned summaries");
          assert(
            core.sessions.every((row) => !row.tool.available),
            "late results cannot mutate published core",
          );
        } else {
          gates.get(agents[0].agent_session.value).resolve();
          const partial = await inventoryWhen(observer, (data) => data.sessions[0].tool.available);
          assert.equal(
            partial.sessions[1].tool.available,
            false,
            "one summary publishes while other roots wait",
          );
          const failedSession = agents[4].agent_session.value;
          // Reject an admitted summary: helper eligibility must reuse the unavailable
          // result rather than retrying it through a separate admission path.
          for (let attempt = 0; attempt < 1000 && edgeReads === 0; attempt++) {
            for (const [sessionId, gate] of gates) {
              if (sessionId === null) continue; // Presence-only summary cannot gate helper roots.
              if (sessionId === failedSession) gate.reject(Error("fixture failure"));
              else gate.resolve();
            }
            await new Promise((resolve) => setImmediate(resolve));
          }
          assert.equal(
            edgeReads,
            1,
            "helper discovery starts before the unrelated presence summary settles",
          );
          assert.equal(active, 1, "presence-only summary remains held when helper work starts");
          const complete = await inventoryWhen(
            observer,
            (data) => data.sessions.filter((row) => row.tool.available).length === 8,
          );
          assert.equal(
            complete.sessions[4].tool.available,
            false,
            "failed summary remains unavailable",
          );
          assert.equal(
            calls.length,
            agents.length,
            "helper roots reuse every completed summary including failures",
          );
          assert.equal(new Set(calls).size, agents.length);
          assert.equal(maximum, 4);
        }
      } finally {
        cleaning = true;
        helperGate.resolve();
        for (const gate of gates.values()) gate.resolve();
        await observer.close();
      }
    }
  }

  async function independentDesktop() {
    let clock = 1000,
      fail = false,
      desktopFail = false,
      rows = [
        {
          id: "obs_" + "a".repeat(24),
          inspectionIdentity: "window-a",
          source: "desktop",
          sessionId: null,
        },
      ],
      release;
    const retained = [];
    const desktop = {
      inventory: async () =>
        desktopFail
          ? { health: "unavailable", reason: "permission-denied", windows: [] }
          : { health: "available", reason: null, observedAt: clock, windows: rows },
      inspect: async () => {
        if (release)
          await new Promise((resolve) => {
            release = resolve;
          });
        return { health: "available", turns: [{ text: "old" }] };
      },
    };
    const observer = makeObserver({
      readIdentityConfiguration: async () => "unconfigured",
      now: () => clock,
      desktop,
      projects: { resolve: async () => ({ projectId: "fixture" }) },
      bus: { read: () => ({ health: "available", rows: [] }) },
      transcripts: {
        read: async () => ({ available: false }),
        retain: (ids) => retained.push([...ids]),
      },
      execute: async () => {
        if (fail) throw Error("private");
        return { stdout: JSON.stringify({ result: { agents: [pane("legacy")] } }) };
      },
    });
    const first = await observer.get();
    assert.equal(first.sources.desktop.health, "available");
    assert.equal(first.sessions.length, 2);
    assert.deepEqual(retained.at(-1), [first.sessions.find((row) => row.source === "herdr").id]);
    assert(
      retained.every((ids) => !ids.includes(rows[0].id)),
      "desktop IDs never enter transcript cache",
    );
    clock = 4000;
    fail = true;
    const mixed = await observer.get();
    assert.equal(mixed.health, "available");
    assert.equal(mixed.sources.herdr.health, "unavailable");
    assert.equal(
      mixed.sessions.find((row) => row.source === "herdr").inventoryHealth,
      "unavailable",
    );
    assert.equal(
      (await observer.inspect(rows[0].id)).health,
      "available",
      "fresh Desktop survives Herdr failure",
    );
    release = true;
    const late = observer.inspect(rows[0].id);
    await new Promise((resolve) => setImmediate(resolve));
    clock = 7000;
    rows = [{ ...rows[0], inspectionIdentity: "window-b" }];
    await observer.get();
    release();
    release = null;
    assert.equal((await late).reason, "identity-unavailable");
    clock = 10000;
    fail = false;
    desktopFail = true;
    const desktopStale = await observer.get();
    assert.equal(desktopStale.health, "available");
    assert.equal(desktopStale.sources.desktop.health, "unavailable");
    const staleRow = desktopStale.sessions.find((row) => row.source === "desktop");
    assert.equal(staleRow.observedAt, 7000);
    assert.equal(staleRow.inventoryHealth, "unavailable");
    assert.equal((await observer.inspect(staleRow.id)).reason, "inventory-unavailable");
  }

  async function coldBuildIndependence() {
    const temp = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), "observer-cold-build-")),
    );
    let release,
      began = false,
      timer;
    const buildGate = new Promise((resolve) => {
      release = resolve;
    });
    const desktop = makeDesktopObserver({
      now: () => 1000,
      platform: "darwin",
      cacheDir: temp,
      execute: async () => {
        began = true;
        await buildGate;
        throw Error("fixture compiler unavailable");
      },
    });
    const observer = makeObserver({
      readIdentityConfiguration: async () => "unconfigured",
      now: () => 1000,
      desktop,
      projects: { resolve: async () => ({ projectId: "fixture" }) },
      bus: { read: () => ({ health: "available", rows: [] }) },
      transcripts: { read: async () => ({ available: false }), retain() {} },
      execute: async () => ({ stdout: JSON.stringify({ result: { agents: [pane("legacy")] } }) }),
    });
    try {
      const snapshot = await Promise.race([
        observer.get(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(Error("cold build held Herdr")), 500);
        }),
      ]);
      clearTimeout(timer);
      assert.equal(snapshot.health, "available");
      assert.equal(snapshot.sources.herdr.health, "available");
      assert.equal(snapshot.sources.desktop.reason, "native-reader-building");
      assert.equal(snapshot.sessions.length, 1);
      // Wait for the fake compiler to reach its gate, then release it before disposing its private fixture.
      for (let attempt = 0; !began && attempt < 100; attempt++)
        await new Promise((resolve) => setTimeout(resolve, 5));
      assert(began);
      release();
      for (let attempt = 0; attempt < 100; attempt++) {
        if ((await desktop.inventory()).reason !== "native-reader-building") break;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    } finally {
      clearTimeout(timer);
      release();
      await fs.rm(temp, { recursive: true, force: true });
    }
  }

  async function helperComposition() {
    const { makeTranscriptObserver } = require("./observer-transcripts.js");
    const { makeHelperObserver } = require("./observer-helpers.js");
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "starnet-helper-composition-"));
    try {
      const child = "00000000-0000-0000-0000-000000000002";
      let clock = 1000,
        inventory = [pane("root")],
        fail = false;
      const line = (value) => JSON.stringify(value) + "\n";
      await fs.writeFile(
        path.join(root, ID + ".jsonl"),
        line({ type: "session_meta", payload: { id: ID } }),
      );
      await fs.writeFile(
        path.join(root, child + ".jsonl"),
        line({ type: "session_meta", payload: { id: child, parent_thread_id: ID } }) +
          line({
            type: "response_item",
            payload: { type: "message", role: "assistant", content: "HELPER ONLY" },
          }),
      );
      const transcripts = makeTranscriptObserver({ now: () => clock, roots: { codex: root } });
      const helpers = makeHelperObserver({
        now: () => clock,
        transcripts,
        readEdges: () => ({
          rows: [{ parent_thread_id: ID, child_thread_id: child, status: "open" }],
        }),
      });
      const observer = makeObserver({
        readIdentityConfiguration: async () => "unconfigured",
        now: () => clock,
        transcripts,
        helpers,
        desktop: { inventory: async () => ({ health: "unavailable", windows: [] }) },
        bus: { read: () => ({ rows: [], health: "available" }) },
        projects: { resolve: async () => ({ projectId: "fixture" }) },
        execute: async () => {
          if (fail) throw new Error("unavailable");
          return { stdout: JSON.stringify({ result: { agents: inventory } }) };
        },
      });
      let result = await observer.get();
      const helper = result.sessions.find((row) => row.source === "helper");
      assert(helper);
      assert.equal((await observer.inspect(helper.id)).turns[0].text, "HELPER ONLY");
      clock += 3000;
      inventory.push({ ...pane("child", child), agent_status: "blocked" });
      result = await observer.get();
      assert.equal(result.sessions.length, 2);
      assert.equal(result.sessions[1].parentId, result.sessions[0].id);
      assert.equal(result.sessions[1].status, "blocked");
      assert.equal((await observer.inspect(result.sessions[1].id)).turns[0].text, "HELPER ONLY");
      clock += 3000;
      fail = true;
      result = await observer.get();
      assert(result.sessions.every((row) => !row.parentId));
      assert.equal((await observer.inspect(helper.id)).reason, "unknown-session");
      clock += 3000;
      fail = false;
      inventory = [];
      assert.deepEqual((await observer.get()).sessions, []);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }

  async function nestedHelperGrouping() {
    const { makeHelperObserver } = require("./observer-helpers.js");
    const id = (number) => "00000000-0000-0000-0000-" + String(number).padStart(12, "0");

    const transcripts = {
      read: async () => ({ available: true }),
      retain() {},
      claudeCandidates: async () => [],
      bindChild: async (provider, sessionId, parentSessionId) => ({
        provider,
        sessionId,
        parentSessionId,
      }),
      inspectChild: async () => ({ available: true, turns: [] }),
    };
    for (const [existing, rootId] of [
      [false, id(1)],
      [true, id(1)],
      [true, id(12)],
    ]) {
      const edges = [
        { parent_thread_id: rootId, child_thread_id: id(2), status: "open" },
        ...Array.from({ length: 9 }, (_, index) => ({
          parent_thread_id: id(2),
          child_thread_id: id(index + 3),
          status: "closed",
        })),
      ];
      const inventory = [{ ...pane("root", rootId), cwd: "parent" }];
      if (existing)
        inventory.push({ ...pane("child", id(2)), cwd: "child", agent_status: "blocked" });
      const observer = makeObserver({
        readIdentityConfiguration: async () => "unconfigured",
        now: () => 1000,
        transcripts,
        helpers: makeHelperObserver({
          now: () => 1000,
          transcripts,
          readEdges: () => ({ rows: edges }),
        }),
        execute: async () => ({ stdout: JSON.stringify({ result: { agents: inventory } }) }),
        projects: {
          resolve: async (cwd) => ({
            projectId: cwd,
            project: cwd,
            projectKind: "repository-parent",
            repoId: cwd + "-repo",
            repo: cwd + " repo",
            checkoutId: cwd + "-checkout",
            checkoutKind: "worktree",
            folder: "src",
            worktreeId: cwd + "-worktree",
            worktree: cwd + " worktree",
          }),
        },
        desktop: { inventory: async () => ({ health: "unavailable", windows: [] }) },
        bus: { read: () => ({ rows: [], health: "available" }) },
      });
      const { sessions } = await observer.get();
      const parent = sessions.find((row) => row.sessionId === rootId),
        child = sessions.find((row) => row.sessionId === id(2));
      assert.equal(child.parentId, parent.id);
      assert.equal(child.helperOverflow, 1);
      assert.equal(child.source, existing ? "herdr" : "helper");
      assert.equal(child.status, existing ? "blocked" : "unknown");
      assert.equal(child.inspectionIdentity, existing ? "codex:" + id(2) : "helper:" + child.id);
      const descendants = sessions.filter((row) => row.parentId === child.id);
      assert.equal(descendants.length, 9);
      assert.equal(descendants.filter((row) => row.helperSlot !== null).length, 8);
      assert.equal(descendants.filter((row) => row.helperSlot === null).length, 1);
      for (const row of [child, ...descendants]) {
        for (const field of [
          "projectId",
          "project",
          "projectKind",
          "repoId",
          "repo",
          "worktreeId",
          "worktree",
          "checkoutId",
          "checkoutKind",
          "folder",
        ])
          assert.equal(row[field], parent[field], field + " inherits root grouping");
      }
    }
  }

  async function deepHelperOwnership() {
    const { makeTranscriptObserver } = require("./observer-transcripts.js");
    const { makeHelperObserver } = require("./observer-helpers.js");
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "starnet-deep-pane-"));
    try {
      const id = (number) => "00000000-0000-0000-0000-" + String(number).padStart(12, "0");
      const line = (value) => JSON.stringify(value) + "\n";
      for (let number = 1; number <= 7; number++) {
        await fs.writeFile(
          path.join(root, id(number) + ".jsonl"),
          line({
            type: "session_meta",
            payload: {
              id: id(number),
              ...(number > 1 ? { parent_thread_id: id(number - 1) } : {}),
            },
          }) +
            line({
              type: "response_item",
              payload: { type: "message", role: "assistant", content: "PANE " + number },
            }),
        );
      }
      let clock = 1000,
        inventory = [
          { ...pane("root", id(1)), cwd: "parent" },
          { ...pane("deep", id(6)), cwd: "deep", agent_status: "blocked" },
        ];
      const transcripts = makeTranscriptObserver({ now: () => clock, roots: { codex: root } });
      const edges = Array.from({ length: 6 }, (_, index) => ({
        parent_thread_id: id(index + 1),
        child_thread_id: id(index + 2),
        status: "open",
      }));
      const observer = makeObserver({
        readIdentityConfiguration: async () => "unconfigured",
        now: () => clock,
        transcripts,
        helpers: makeHelperObserver({
          now: () => clock,
          transcripts,
          readEdges: () => ({ rows: edges }),
        }),
        execute: async () => ({ stdout: JSON.stringify({ result: { agents: inventory } }) }),
        projects: {
          resolve: async (cwd) => ({
            projectId: cwd,
            repoId: cwd + "-repo",
            worktreeId: cwd + "-worktree",
          }),
        },
        desktop: { inventory: async () => ({ health: "unavailable", windows: [] }) },
        bus: { read: () => ({ rows: [], health: "available" }) },
      });
      let result = await observer.get();
      let deep = result.sessions.find((row) => row.sessionId === id(6));
      assert.equal(result.sessions.length, 5);
      assert.equal(deep.parentId, undefined);
      assert.equal(deep.projectId, "parent");
      assert.equal(deep.repoId, "parent-repo");
      assert.equal(deep.worktreeId, "parent-worktree");
      assert.equal(deep.source, "herdr");
      assert.equal(deep.status, "blocked");
      assert.equal(deep.inspectionIdentity, "codex:" + id(6));
      assert.equal((await observer.inspect(deep.id)).turns[0].text, "PANE 6");
      clock += 3000;
      inventory = inventory.slice(1);
      result = await observer.get();
      deep = result.sessions.find((row) => row.sessionId === id(6));
      assert.equal(deep.projectId, "deep");
      assert.equal(deep.repoId, "deep-repo");
      const independent = result.sessions.find((row) => row.sessionId === id(7));
      assert.equal(independent.parentId, deep.id);
      assert.equal(independent.projectId, "deep");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }

  async function cappedHelperOwnership() {
    const { makeTranscriptObserver } = require("./observer-transcripts.js");
    const { makeHelperObserver } = require("./observer-helpers.js");
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "starnet-capped-pane-"));
    try {
      const id = (number) => "00000000-0000-0000-0000-" + String(number).padStart(12, "0");
      const line = (value) => JSON.stringify(value) + "\n";
      const content = (number, parent = id(1)) =>
        line({
          type: "session_meta",
          payload: {
            id: id(number),
            ...(number > 1 ? { parent_thread_id: parent } : {}),
          },
        }) +
        line({
          type: "response_item",
          payload: { type: "message", role: "assistant", content: "PANE " + number },
        });
      for (let number = 1; number <= 66; number++)
        await fs.writeFile(path.join(root, id(number) + ".jsonl"), content(number));
      let clock = 1000;
      const inventory = [
        { ...pane("root", id(1)), cwd: "parent" },
        { ...pane("boundary", id(65)), cwd: "boundary", agent_status: "blocked" },
        { ...pane("omitted", id(66)), cwd: "omitted", agent_status: "blocked" },
      ];
      const transcripts = makeTranscriptObserver({ now: () => clock, roots: { codex: root } });
      const edges = Array.from({ length: 65 }, (_, index) => ({
        parent_thread_id: id(1),
        child_thread_id: id(index + 2),
        status: "open",
      }));
      const observer = makeObserver({
        readIdentityConfiguration: async () => "unconfigured",
        now: () => clock,
        transcripts,
        helpers: makeHelperObserver({
          now: () => clock,
          transcripts,
          readEdges: () => ({ rows: edges }),
        }),
        execute: async () => ({ stdout: JSON.stringify({ result: { agents: inventory } }) }),
        projects: {
          resolve: async (cwd) => ({
            projectId: cwd,
            repoId: cwd + "-repo",
            worktreeId: cwd + "-worktree",
          }),
        },
        desktop: { inventory: async () => ({ health: "unavailable", windows: [] }) },
        bus: { read: () => ({ rows: [], health: "available" }) },
      });
      let result = await observer.get();
      const parent = result.sessions.find((row) => row.sessionId === id(1));
      const boundary = result.sessions.find((row) => row.sessionId === id(65));
      let omitted = result.sessions.find((row) => row.sessionId === id(66));
      assert.equal(result.sessions.length, 66);
      assert.equal(parent.helperOverflow, 57);
      assert.equal(boundary.parentId, parent.id, "64th binding remains represented");
      assert.equal(omitted.parentId, undefined, "65th child has grouping only");
      for (const row of [boundary, omitted]) {
        assert.equal(row.projectId, "parent");
        assert.equal(row.repoId, "parent-repo");
        assert.equal(row.worktreeId, "parent-worktree");
        assert.equal(row.source, "herdr");
        assert.equal(row.status, "blocked");
        assert.equal(row.inspectionIdentity, "codex:" + row.sessionId);
        assert.equal(
          (await observer.inspect(row.id)).turns[0].text,
          row === boundary ? "PANE 65" : "PANE 66",
        );
      }
      // Losing exact lineage proof restores the authoritative pane's own room and inspection.
      await fs.writeFile(path.join(root, id(66) + ".jsonl"), content(66, id(99)));
      clock += 3000;
      result = await observer.get();
      omitted = result.sessions.find((row) => row.sessionId === id(66));
      assert.equal(omitted.projectId, "omitted");
      assert.equal(omitted.parentId, undefined);
      assert.equal(omitted.status, "blocked");
      assert.equal(omitted.inspectionIdentity, "codex:" + id(66));
      assert.equal((await observer.inspect(omitted.id)).turns[0].text, "PANE 66");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }

  // The browser retains A while inspect() refreshes the server inventory to B.
  async function exactTargetInspection() {
    const secondSession = "00000000-0000-0000-0000-000000000002";
    const desktopId = "obs_" + "d".repeat(24),
      helperId = "obs_" + "e".repeat(24);
    let clock = 1000,
      selectedSession = ID,
      parentIndex = 0,
      inventoryReads = 0,
      bodyReads = 0,
      release = null;
    let desktopIdentity = desktopId,
      desktopHealth = "available",
      herdrHealth = "available",
      provider = "codex",
      bodyHealth = "available";
    const inspectBody = async () => {
      bodyReads++;
      if (release)
        await new Promise((resolve) => {
          release = resolve;
        });
      return {
        available: true,
        health: bodyHealth,
        turns: [{ text: "SELECTED BODY" }],
        inspectionIdentity: "UNTRUSTED ADAPTER PROOF",
      };
    };
    const observer = makeObserver({
      readIdentityConfiguration: async () => "unconfigured",
      now: () => clock,
      endpoint: "exact-target-fixture",
      projects: { resolve: async () => ({ projectId: "fixture" }) },
      bus: { read: () => ({ rows: [], health: "available" }) },
      execute: async () => {
        inventoryReads++;
        if (herdrHealth !== "available") throw Error("fixture unavailable");
        return {
          stdout: JSON.stringify({
            result: {
              agents: [
                {
                  ...pane("parent-a"),
                  agent: provider,
                  agent_session: { agent: provider, kind: "id", value: ID },
                },
                pane("parent-b", secondSession),
                pane("selected", selectedSession),
              ],
            },
          }),
        };
      },
      transcripts: { read: async () => ({ available: false }), retain() {}, inspect: inspectBody },
      desktop: {
        inventory: async () => ({
          health: desktopHealth,
          windows: [{ id: desktopId, provider: "claude", inspectionIdentity: desktopIdentity }],
        }),
        inspect: inspectBody,
      },
      helpers: {
        children: async (parents) => ({
          rows: [
            {
              id: helperId,
              source: "helper",
              provider: "codex",
              inspectionIdentity: "helper:" + helperId,
              parentId: parents[parentIndex].id,
              inventoryHealth: "available",
            },
          ],
          annotations: new Map([[parents[2].id, { parentId: parents[parentIndex].id }]]),
          overflow: new Map(),
        }),
        inspect: inspectBody,
      },
    });
    const initial = await observer.get(),
      selected = initial.sessions[2];
    const parentA = initial.sessions[0].id,
      parentB = initial.sessions[1].id;
    const expectedA = "codex:" + ID + "|" + parentA;
    const assertWithdrawn = (result, reason) => {
      assert.equal(result.health, "unavailable");
      assert.equal(result.reason, reason);
      assert.deepEqual(result.turns, []);
      assert.equal(result.inspectionIdentity, undefined);
      assert(!JSON.stringify(result).includes("SELECTED BODY"));
    };
    for (const malformed of ["", null, 12, [], "bad", "codex:" + ID + "|", "x".repeat(129)])
      assertWithdrawn(await observer.inspect(selected.id, malformed), "invalid-identity");
    assert.equal(inventoryReads, 1, "malformed backend callers trigger no refresh or content read");
    assert.equal(bodyReads, 0);
    assert.equal(
      (await observer.inspect(selected.id, expectedA)).inspectionIdentity,
      expectedA,
      "Herdr helper proof includes parent, overriding adapter data",
    );
    const beforeReplacement = bodyReads;
    selectedSession = secondSession;
    clock += 3000;
    assertWithdrawn(await observer.inspect(selected.id, expectedA), "identity-mismatch");
    assert.equal(
      bodyReads,
      beforeReplacement,
      "server discovers B before browser roster A: no selected body read",
    );
    const expectedB = "codex:" + secondSession + "|" + parentA;
    assert.equal((await observer.inspect(selected.id, expectedB)).inspectionIdentity, expectedB);
    assert.equal(
      (await observer.inspect(selected.id)).inspectionIdentity,
      expectedB,
      "legacy omission reads current target",
    );
    // Parent changes invalidate both synthetic helpers and authoritative Herdr rows annotated as helpers.
    const helperExpected = "helper:" + helperId + "|" + parentA;
    assert.equal(
      (await observer.inspect(helperId, helperExpected)).inspectionIdentity,
      helperExpected,
    );
    parentIndex = 1;
    clock += 3000;
    const beforeReparent = bodyReads;
    assertWithdrawn(await observer.inspect(helperId, helperExpected), "identity-mismatch");
    assertWithdrawn(await observer.inspect(selected.id, expectedB), "identity-mismatch");
    assert.equal(bodyReads, beforeReparent, "reparented helpers never read against old parent");
    const reparented = "codex:" + secondSession + "|" + parentB;
    release = true;
    const pending = observer.inspect(selected.id, reparented);
    await new Promise((resolve) => setImmediate(resolve));
    parentIndex = 0;
    clock += 3000;
    await observer.get();
    release();
    release = null;
    assertWithdrawn(await pending, "identity-mismatch");
    release = true;
    const helperPending = observer.inspect(helperId, helperExpected);
    await new Promise((resolve) => setImmediate(resolve));
    parentIndex = 1;
    clock += 3000;
    await observer.get();
    release();
    release = null;
    assertWithdrawn(await helperPending, "identity-mismatch");
    // Desktop proof is its opaque native window identity, never a transcript session.
    assert.equal((await observer.inspect(desktopId, desktopId)).inspectionIdentity, desktopId);
    release = true;
    const replacedDesktopPending = observer.inspect(desktopId, desktopId);
    await new Promise((resolve) => setImmediate(resolve));
    desktopIdentity = "obs_" + "f".repeat(24);
    clock += 3000;
    await observer.get();
    release();
    release = null;
    assertWithdrawn(await replacedDesktopPending, "identity-mismatch");
    const beforeDesktopReplacement = bodyReads;
    assertWithdrawn(await observer.inspect(desktopId, desktopId), "identity-mismatch");
    assert.equal(bodyReads, beforeDesktopReplacement);
    release = true;
    const desktopPending = observer.inspect(desktopId, desktopIdentity);
    await new Promise((resolve) => setImmediate(resolve));
    desktopHealth = "unavailable";
    clock += 3000;
    await observer.get();
    release();
    release = null;
    assertWithdrawn(await desktopPending, "inventory-unavailable");
    // Fresh ordinary panes retain provider/session proof without a helper parent.
    const ordinary = initial.sessions[0];
    assert.equal(
      (await observer.inspect(ordinary.id, "codex:" + ID)).inspectionIdentity,
      "codex:" + ID,
    );
    bodyHealth = "unavailable";
    assertWithdrawn(await observer.inspect(ordinary.id, "codex:" + ID), "transcript-unavailable");
    bodyHealth = "available";
    release = true;
    const providerPending = observer.inspect(ordinary.id, "codex:" + ID);
    await new Promise((resolve) => setImmediate(resolve));
    provider = "claude";
    clock += 3000;
    await observer.get();
    release();
    release = null;
    assertWithdrawn(await providerPending, "identity-mismatch");
    provider = "codex";
    clock += 3000;
    await observer.get();
    release = true;
    const ordinaryPending = observer.inspect(ordinary.id, "codex:" + ID);
    await new Promise((resolve) => setImmediate(resolve));
    selectedSession = ID;
    herdrHealth = "unavailable";
    clock += 3000;
    await observer.get();
    release();
    release = null;
    assertWithdrawn(await ordinaryPending, "inventory-unavailable");
  }

  async function footerInspection() {
    const { makeIdentityResolver } = require("./observer-identity.js");
    let clock = 1000,
      displayed = ID,
      terminal = "term_original",
      revision = 1,
      readCalls = 0,
      detailCalls = 0,
      release = null;
    const original = { ...pane("footer"), terminal_id: terminal, revision };
    const resolver = makeIdentityResolver({
      now: () => clock,
      readConfiguration: async () => "configured",
      readProcessBirth: async (pid) => ({ pid, startSeconds: 1, startMicroseconds: 0 }),
      rpc: async (method, params) => {
        const native = nativeIdentityResult(method, params);
        if (native) return native;
        if (method === "agent.get")
          return { result: { agent: { ...original, terminal_id: terminal, revision } } };
        readCalls++;
        return {
          result: {
            read: {
              pane_id: "footer",
              source: "recent",
              format: "text",
              revision: 0,
              truncated: true,
              text: "\n  " + displayed + " · model\n  ? for shortcuts\n",
            },
          },
        };
      },
    });
    const helperId = "obs_" + "f".repeat(24),
      helperIdentity = "helper:" + helperId;
    const observer = makeObserver({
      now: () => clock,
      identities: resolver,
      endpoint: "footer-race-fixture",
      execute: async () => ({ stdout: JSON.stringify({ result: { agents: [original] } }) }),
      projects: { resolve: async () => ({ projectId: "fixture" }) },
      bus: { read: () => ({ rows: [], health: "available" }) },
      desktop: { inventory: async () => ({ health: "unavailable", windows: [] }) },
      transcripts: {
        read: async (id, provider, session) => ({ available: !!session }),
        retain() {},
        inspect: async () => {
          detailCalls++;
          if (release)
            await new Promise((resolve) => {
              release = resolve;
            });
          return {
            available: true,
            health: "available",
            turns: [{ text: "PRIVATE OLD BODY" }],
            stats: { totalTokens: 42 },
          };
        },
      },
      helpers: {
        children: async (parents) => ({
          rows: [
            {
              id: helperId,
              provider: "codex",
              source: "helper",
              inventoryHealth: "available",
              parentId: parents[0].id,
              inspectionIdentity: helperIdentity,
            },
          ],
          annotations: new Map(),
          overflow: new Map(),
        }),
        inspect: async () => {
          detailCalls++;
          if (release)
            await new Promise((resolve) => {
              release = resolve;
            });
          return { available: true, health: "available", turns: [{ text: "PRIVATE HELPER BODY" }] };
        },
      },
    });
    const first = await observer.get(),
      root = first.sessions[0];
    assert.equal(root.identitySource, "footer");
    assert.equal(root.identityHealth, "available");
    assert(
      !JSON.stringify(first).includes("term_original"),
      "terminal incarnation proof stays private",
    );
    const captured = readCalls;
    await observer.get();
    assert.equal(readCalls, captured, "footer capture shares cached refresh");
    revision++;
    assert.equal(
      (await observer.inspect(root.id)).health,
      "available",
      "normal output revision changes do not invalidate same current footer",
    );
    assert.equal(readCalls, captured + 4, "selected read revalidates footer before and after");
    displayed = "00000000-0000-0000-0000-000000000002";
    const before = detailCalls;
    const reject = (result) => {
      assert.equal(result.health, "unavailable");
      assert.deepEqual(result.turns, []);
      assert(!JSON.stringify(result).includes("PRIVATE"));
      assert(
        Object.values(result.stats).every(
          (metric) => metric.value === null && metric.state === "unavailable",
        ),
      );
    };
    reject(await observer.inspect(root.id));
    reject(await observer.inspect(helperId));
    assert.equal(
      detailCalls,
      before,
      "cached inventory cannot authorize old root or helper content after in-TUI switch",
    );
    displayed = ID;
    for (const target of [root.id, helperId]) {
      release = true;
      const pending = observer.inspect(target);
      await new Promise((resolve) => setImmediate(resolve));
      displayed = "00000000-0000-0000-0000-000000000002";
      release();
      release = null;
      reject(await pending);
      displayed = ID;
    }
    terminal = "term_replaced";
    reject(await observer.inspect(root.id));
    clock += 3000;
    const withdrawn = await observer.get();
    assert.equal(withdrawn.sessions[0].sessionId, null);
    assert.equal(withdrawn.sessions[0].identityHealth, "unavailable");
  }

  async function footerFinalValidationRace() {
    for (const kind of ["thread", "terminal", "birth"]) {
      let clock = 1000,
        session = ID,
        terminal = "term_original",
        birth = 1,
        validations = 0,
        release;
      const observer = makeObserver({
        now: () => clock,
        identities: {
          resolve: async () => ({
            sessionId: session,
            source: "footer",
            proof: {
              terminalId: terminal,
              sessionId: session,
              birth: { pid: 41, startSeconds: birth, startMicroseconds: 0 },
            },
          }),
          revalidate: async () => {
            if (++validations === 2)
              await new Promise((resolve) => {
                release = resolve;
              });
            return true;
          },
        },
        execute: async () => ({
          stdout: JSON.stringify({ result: { agents: [pane("final-race", session)] } }),
        }),
        projects: { resolve: async () => ({ projectId: "fixture" }) },
        bus: { read: () => ({ rows: [], health: "available" }) },
        desktop: { inventory: async () => ({ health: "unavailable", windows: [] }) },
        transcripts: {
          read: async () => ({ available: true }),
          retain() {},
          inspect: async () => ({
            available: true,
            health: "available",
            turns: [{ text: "FINAL RACE CANARY" }],
          }),
        },
      });
      const first = await observer.get();
      const pending = observer.inspect(first.sessions[0].id);
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(typeof release, "function");
      clock += 3000;
      if (kind === "thread") session = "00000000-0000-0000-0000-000000000002";
      else if (kind === "terminal") terminal = "term_replacement";
      else birth = 2;
      await observer.get();
      release();
      const rejected = await pending;
      assert.equal(
        rejected.health,
        "unavailable",
        kind + " changes during final async proof cannot export stale content",
      );
      assert(!JSON.stringify(rejected).includes("CANARY"));
      assert.deepEqual(rejected.turns, []);
    }
  }

  async function footerConfigurationRace() {
    const { makeIdentityResolver } = require("./observer-identity.js");
    for (const helper of [false, true]) {
      let sequence = 8,
        terminal = "term_original",
        contentRead = false,
        configurationAfterRead = 0,
        release,
        inventoryReads = 0;
      let reachedConfiguration;
      const blocked = new Promise((resolve) => {
        reachedConfiguration = resolve;
      });
      const original = { ...pane("configuration-race"), terminal_id: terminal, revision: 1 };
      const resolver = makeIdentityResolver({
        now: () => 1000,
        readProcessBirth: async (pid) => ({ pid, startSeconds: 1, startMicroseconds: 0 }),
        readConfiguration: async () => {
          // Pause the final configuration verification after selected content has been read.
          if (contentRead && ++configurationAfterRead === 1) {
            reachedConfiguration();
            await new Promise((resolve) => {
              release = resolve;
            });
          }
          return "configured";
        },
        rpc: async (method, params) => {
          const native = nativeIdentityResult(method, params, sequence);
          if (native) return native;
          return method === "agent.get"
            ? { result: { agent: { ...original, terminal_id: terminal } } }
            : {
                result: {
                  read: {
                    pane_id: original.pane_id,
                    source: "recent",
                    format: "text",
                    text: "\n  " + ID + " · model\n  ? for shortcuts\n",
                  },
                },
              };
        },
      });
      const helperId = "obs_" + "e".repeat(24);
      const inspectBody = async () => {
        contentRead = true;
        return {
          available: true,
          health: "available",
          turns: [{ text: "CONFIGURATION RACE CANARY" }],
          stats: { totalTokens: 42 },
        };
      };
      const observer = makeObserver({
        now: () => 1000,
        identities: resolver,
        execute: async () => {
          inventoryReads++;
          return { stdout: JSON.stringify({ result: { agents: [original] } }) };
        },
        projects: { resolve: async () => ({ projectId: "fixture" }) },
        bus: { read: () => ({ rows: [], health: "available" }) },
        desktop: { inventory: async () => ({ health: "unavailable", windows: [] }) },
        transcripts: { read: async () => ({ available: true }), retain() {}, inspect: inspectBody },
        helpers: {
          children: async (parents) => ({
            rows: [
              {
                id: helperId,
                provider: "codex",
                source: "helper",
                inventoryHealth: "available",
                parentId: parents[0].id,
                inspectionIdentity: "helper:" + helperId,
              },
            ],
            annotations: new Map(),
            overflow: new Map(),
          }),
          inspect: inspectBody,
        },
      });
      const first = await observer.get();
      const pending = observer.inspect(helper ? helperId : first.sessions[0].id);
      await blocked;
      sequence = 10;
      release();
      const result = await pending;
      assert.equal(inventoryReads, 1, "terminal race has no roster refresh");
      assert.equal(
        result.health,
        "unavailable",
        (helper ? "helper root" : "selected pane") +
          " output changed during final configuration I/O",
      );
      assert.deepEqual(result.turns, []);
      assert(!JSON.stringify(result).includes("CANARY"));
      assert(
        Object.values(result.stats).every(
          (metric) => metric.value === null && metric.state === "unavailable",
        ),
      );
    }
  }

  async function stalledFooterEndpoint() {
    const net = require("node:net");
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), "observer-stalled-endpoint-"));
    const endpoint = path.join(folder, "native.sock");
    const sockets = new Set();
    let requests = 0,
      responsive = false,
      inventoryReads = 0;
    const agents = Array.from({ length: 4 }, (_, index) => ({
      ...pane("stalled-" + index),
      terminal_id: "term_" + index,
      revision: 1,
    }));
    agents.push({
      ...pane("native-claude"),
      agent: "claude",
      agent_session: { agent: "claude", kind: "id", value: ID },
    });
    const server = net.createServer((connection) => {
      sockets.add(connection);
      connection.on("error", () => {});
      connection.on("close", () => sockets.delete(connection));
      connection.once("data", (data) => {
        requests++;
        if (!responsive) return;
        const request = JSON.parse(data.toString());
        const result =
          nativeIdentityResult(request.method, request.params)?.result ||
          (request.method === "agent.get"
            ? { agent: agents.find((agent) => agent.pane_id === request.params.target) }
            : {
                read: {
                  pane_id: request.params.pane_id,
                  source: "recent",
                  format: "text",
                  text: "\n  " + ID + " · model\n  ? for shortcuts\n",
                },
              });
        connection.end(JSON.stringify({ id: request.id, result }) + "\n");
      });
    });
    try {
      await new Promise((resolve) => server.listen(endpoint, resolve));
      let clock = 1000;
      const observer = makeObserver({
        now: () => clock,
        endpoint,
        readIdentityConfiguration: async () => "configured",
        readProcessBirth: async (pid) => ({ pid, startSeconds: 1, startMicroseconds: 0 }),
        execute: async () => {
          inventoryReads++;
          return { stdout: JSON.stringify({ result: { agents } }) };
        },
        projects: { resolve: async () => ({ projectId: "fixture" }) },
        bus: { read: () => ({ rows: [], health: "available" }) },
        transcripts: {
          read: async (id, provider, session) => ({ available: !!session }),
          retain() {},
        },
        desktop: {
          inventory: async () => ({
            health: "available",
            windows: [{ id: "obs_" + "d".repeat(24), provider: "desktop" }],
          }),
        },
      });
      const start = performance.now();
      const first = observer.get();
      assert.equal(observer.get(), first, "stalled readers share one refresh");
      const result = await first,
        elapsed = performance.now() - start;
      assert(
        elapsed < 3000,
        "shared footer timeout must not accumulate per pane: " + Math.round(elapsed) + "ms",
      );
      assert.equal(requests, 1, "endpoint timeout suppresses remaining requests in this refresh");
      assert.equal(inventoryReads, 1);
      assert.deepEqual(
        result.sessions.filter((row) => row.source === "herdr").map((row) => row.paneId),
        agents.map((agent) => agent.pane_id),
      );
      assert(
        result.sessions
          .slice(0, 4)
          .every((row) => row.sessionId === null && row.identityHealth === "unavailable"),
      );
      assert.equal(result.sessions[4].identitySource, "native");
      assert.equal(result.sources.desktop.health, "available");
      // Server-side EOF can arrive after the client promise settles; bound that cleanup observation.
      const cleanupUntil = performance.now() + 500;
      while (sockets.size && performance.now() < cleanupUntil)
        await new Promise((resolve) => setTimeout(resolve, 10));
      assert.equal(sockets.size, 0, "timed-out native connection closes");
      responsive = true;
      clock += 3000;
      const recovered = await observer.get();
      assert(
        recovered.sessions.slice(0, 4).every((row) => row.identitySource === "footer"),
        "next authoritative refresh retries recovered endpoint",
      );
      console.log(
        "observer stalled endpoint: " +
          Math.round(elapsed) +
          "ms, one timed-out request, socket closed, retry recovered",
      );
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
      await fs.rm(folder, { recursive: true, force: true });
    }
  }

  // Real transcript lineage can involve independent footer runtimes. Neither the
  // observed child nor its synthetic descendant has a supported atomic proofset.
  async function footerAncestryProofSet() {
    const { makeIdentityResolver } = require("./observer-identity.js");
    const { makeTranscriptObserver } = require("./observer-transcripts.js");
    const { makeHelperObserver } = require("./observer-helpers.js");
    const child = "00000000-0000-0000-0000-000000000002",
      descendant = "00000000-0000-0000-0000-000000000003";
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), "observer-footer-ancestry-"));
    try {
      for (const [session, parent] of [
        [ID, null],
        [child, ID],
        [descendant, child],
      ]) {
        const rows = [
          {
            type: "session_meta",
            payload: { id: session, ...(parent ? { parent_thread_id: parent } : {}) },
          },
          {
            type: "response_item",
            payload: {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: "ANCESTRY CANARY" }],
            },
          },
        ];
        await fs.writeFile(
          path.join(folder, session + ".jsonl"),
          rows.map((row) => JSON.stringify(row) + "\n").join(""),
        );
      }
      for (const target of ["observed", "synthetic"]) {
        let inventoryReads = 0,
          detailRead = false;
        const agents = [
          { ...pane("ancestor-parent", ID), terminal_id: "term_parent", revision: 1 },
          { ...pane("ancestor-child", child), terminal_id: "term_child", revision: 1 },
        ];
        const now = () => 1000;
        const transcripts = makeTranscriptObserver({ now, roots: { codex: folder } });
        const inspectChild = transcripts.inspectChild;
        transcripts.inspectChild = async (...args) => {
          const result = await inspectChild(...args);
          detailRead = true;
          return result;
        };
        const helpers = makeHelperObserver({
          now,
          transcripts,
          readEdges: async () => ({
            rows: [
              { parent_thread_id: ID, child_thread_id: child, status: "open" },
              { parent_thread_id: child, child_thread_id: descendant, status: "open" },
            ],
          }),
        });
        const resolver = makeIdentityResolver({
          now,
          readConfiguration: async () => "configured",
          readProcessBirth: async (pid) => ({ pid, startSeconds: 1, startMicroseconds: 0 }),
          rpc: async (method, params) => {
            const native = nativeIdentityResult(method, params);
            if (native) return native;
            const agent = agents.find(
              (agent) => agent.pane_id === (params.target || params.pane_id),
            );
            if (method === "agent.get") return { result: { agent: { ...agent } } };
            assert.equal(method, "pane.read");
            return {
              result: {
                read: {
                  pane_id: agent.pane_id,
                  source: "recent",
                  format: "text",
                  text: "\n  " + agent.agent_session.value + " · model\n  ? for shortcuts\n",
                },
              },
            };
          },
        });
        const observer = makeObserver({
          now,
          identities: resolver,
          transcripts,
          helpers,
          execute: async () => {
            inventoryReads++;
            return { stdout: JSON.stringify({ result: { agents } }) };
          },
          projects: { resolve: async () => ({ projectId: "fixture" }) },
          bus: { read: () => ({ rows: [], health: "available" }) },
          desktop: { inventory: async () => ({ health: "unavailable", windows: [] }) },
        });
        const inventory = await observer.get();
        const parentRow = inventory.sessions.find((row) => row.paneId === agents[0].pane_id);
        const childRow = inventory.sessions.find((row) => row.paneId === agents[1].pane_id);
        assert.equal(childRow.parentId, parentRow.id, "real helper module annotates observed pane");
        assert.equal(childRow.identitySource, "footer");
        assert.equal(parentRow.identitySource, "footer");
        const row =
          target === "observed"
            ? childRow
            : inventory.sessions.find((row) => row.sessionId === descendant);
        assert.equal(row.parentId, target === "observed" ? parentRow.id : childRow.id);
        const result = await observer.inspect(row.id, row.inspectionIdentity + "|" + row.parentId);
        assert.equal(inventoryReads, 1, "proof-set race has no roster refresh");
        assert.equal(
          detailRead,
          false,
          "multiple distinct footer roots rejected before selected transcript read",
        );
        assert.equal(result.health, "unavailable");
        assert.deepEqual(result.turns, []);
        assert(!JSON.stringify(result).includes("CANARY"));
        assert(
          Object.values(result.stats).every(
            (metric) => metric.value === null && metric.state === "unavailable",
          ),
        );
      }
    } finally {
      await fs.rm(folder, { recursive: true, force: true });
    }
  }

  // Faithful native wrappers: metadata revision is independent of content sequence.
  function nativeIdentityResult(method, params, sequence = 8) {
    if (method === "pane.get")
      return {
        result: {
          pane: {
            pane_id: params.pane_id,
            scroll: { max_offset_from_bottom: 0, viewport_rows: 20 },
          },
        },
      };
    if (method === "pane.process_info")
      return { result: { process_info: { pane_id: params.pane_id, shell_pid: 41 } } };
    if (method === "pane.copy_motion") {
      if (params.content_revision !== undefined && params.content_revision !== sequence)
        throw Error("stale_content");
      return { result: { pane_id: params.pane_id, content_revision: sequence } };
    }
    return null;
  }

  async function usageAggregate() {
    const second = "00000000-0000-0000-0000-000000000002";
    const wrapper = (value, state = "available") => ({
      value,
      state: value === null ? "unavailable" : state,
    });
    const usage = (value, state = "available") => ({
      inputTokens: wrapper(value, state),
      outputTokens: wrapper(null),
      cacheReadTokens: wrapper(0, state),
      cacheWriteTokens: wrapper(null),
      coverage: "bounded-transcript",
      observedAt: 1000,
    });
    let clock = 1000,
      fail = false,
      reads = 0,
      conflict = false;
    const helperA = "obs_" + "a".repeat(24),
      helperB = "obs_" + "b".repeat(24);
    const observer = makeObserver({
      now: () => clock,
      identities: {
        resolve: async (row) => ({ sessionId: row.agent_session.value, source: "herdr" }),
      },
      projects: { resolve: async () => ({}) },
      bus: { read: () => ({ rows: [] }) },
      execute: async () => {
        if (fail) throw Error("unavailable");
        return {
          stdout: JSON.stringify({
            result: {
              agents: [
                { ...pane("parent-a"), agent: "claude" },
                { ...pane("parent-b", second), agent: "claude" },
                {
                  ...pane("duplicate-a"),
                  agent: "claude",
                  agent_status: conflict ? "blocked" : "working",
                },
              ],
            },
          }),
        };
      },
      transcripts: {
        read: async () => {
          reads++;
          return { available: true, last: null, usage: usage(10) };
        },
        retain() {},
      },
      desktop: {
        inventory: async () => ({
          health: "available",
          observedAt: clock,
          windows: [{ id: "desktop", sessionId: null, status: "idle", presence: "window" }],
        }),
      },
      helpers: {
        children: async (parents) => ({
          annotations: new Map(),
          overflow: new Map(),
          rows: [
            {
              id: helperA,
              provider: "claude",
              sessionId: "same-child",
              parentId: parents[0].id,
              source: "helper",
              presence: "verified-lineage",
              inspectionIdentity: "helper:" + helperA,
              inventoryHealth: fail ? "unavailable" : "available",
              observedAt: clock,
              status: "done",
              usage: usage(3, "partial"),
            },
            {
              id: helperB,
              provider: "claude",
              sessionId: "same-child",
              parentId: parents[1].id,
              source: "helper",
              presence: "verified-lineage",
              inspectionIdentity: "helper:" + helperB,
              inventoryHealth: "available",
              observedAt: clock,
              status: "blocked",
              usage: usage(7, "partial"),
            },
            {
              id: helperA,
              provider: "claude",
              sessionId: "same-child",
              parentId: parents[0].id,
              source: "helper",
              presence: "verified-lineage",
              inspectionIdentity: "helper:" + helperA,
              inventoryHealth: "unavailable",
              observedAt: 999999,
              status: "unknown",
              usage: usage(999),
            },
          ],
        }),
      },
    });
    const first = await observer.get();
    assert.deepEqual(first.sessions[0].usage.inputTokens, wrapper(10));
    assert.deepEqual(first.aggregate.agents, {
      observed: 5,
      verifiedSessions: 4,
      presenceOnly: 1,
      statuses: { working: 2, blocked: 1, idle: 1, done: 1, unknown: 0 },
      stale: 0,
    });
    assert.deepEqual(first.aggregate.usage.inputTokens, wrapper(30, "partial"));
    assert.deepEqual(first.aggregate.usage.outputTokens, wrapper(null));
    assert.deepEqual(first.aggregate.coverage.counters.inputTokens, {
      eligible: 4,
      available: 2,
      partial: 2,
      unavailable: 0,
      stale: 0,
    });
    assert.equal(
      first.aggregate.coverage.available,
      0,
      "missing counters do not claim complete usage",
    );
    assert.equal(first.aggregate.coverage.partial, 4);
    assert.equal(reads, 3);
    await observer.get();
    assert.equal(reads, 3, "aggregate shares refresh cache");
    clock += 3000;
    conflict = true;
    const conflicting = await observer.get();
    assert.equal(conflicting.aggregate.coverage.conflicting, 1);
    assert.equal(conflicting.aggregate.agents.verifiedSessions, 3);
    assert.equal(
      conflicting.aggregate.usage.inputTokens.value,
      20,
      "conflicting duplicates excluded once from every count",
    );
    clock += 3000;
    fail = true;
    const stale = await observer.get();
    assert.equal(stale.aggregate.coverage.stale, 4);
    assert.equal(
      stale.aggregate.usage.inputTokens.value,
      null,
      "unavailable ancestor makes helper values stale too",
    );
    assert.equal(stale.aggregate.agents.statuses.working, 0);
  }

  async function aggregateAgeAndOverflow() {
    let clock = 1000,
      overflow = false;
    const second = "00000000-0000-0000-0000-000000000002";
    const observer = makeObserver({
      now: () => clock,
      identities: {
        resolve: async (row) => ({ sessionId: row.agent_session.value, source: "herdr" }),
      },
      execute: async () => ({
        stdout: JSON.stringify({ result: { agents: [pane("a"), pane("b", second)] } }),
      }),
      projects: { resolve: async () => ({}) },
      bus: { read: () => ({ rows: [] }) },
      helpers: {
        children: async () => ({ rows: [], annotations: new Map(), overflow: new Map() }),
      },
      transcripts: {
        retain() {},
        read: async () => ({
          available: true,
          usage: {
            inputTokens: { value: overflow ? Number.MAX_SAFE_INTEGER : 10, state: "available" },
            outputTokens: { value: 1, state: "available" },
            cacheReadTokens: { value: 0, state: "available" },
            cacheWriteTokens: { value: 0, state: "available" },
          },
        }),
      },
      desktop: {
        inventory: async () => {
          return {
            health: "available",
            observedAt: clock,
            windows: [{ id: "app", status: "idle" }],
          };
        },
      },
    });
    let result = await observer.get();
    assert.equal(result.aggregate.usage.inputTokens.value, 20);
    clock += 3000;
    overflow = true;
    result = await observer.get();
    assert.deepEqual(
      result.aggregate.usage.inputTokens,
      { value: null, state: "unavailable" },
      "overflow never returns an imprecise counter",
    );
    assert.deepEqual(
      result.aggregate.usage.outputTokens,
      { value: 2, state: "available" },
      "other counters remain usable",
    );
  }

  async function aggregateOptionalEvidence() {
    let clock = 9000,
      conflict = false,
      firstId;
    const child = "obs_" + "e".repeat(24);
    const usage = (value, observedAt) => ({
      inputTokens: { value, state: "available" },
      observedAt,
    });
    const observer = makeObserver(
      progressiveOptions({
        now: () => clock,
        execute: async () => ({
          stdout: JSON.stringify({ result: { agents: [pane("old"), pane("fresh")] } }),
        }),
        transcripts: {
          retain() {},
          read: async (id) => {
            firstId ??= id;
            return {
              available: true,
              last: { name: "Read", phase: "started" },
              usage: usage(id === firstId ? 999 : 42, id === firstId && !conflict ? 1000 : clock),
            };
          },
        },
        helpers: {
          prepareChildren: async (parents) => ({
            annotations: new Map(),
            overflow: new Map(),
            rows: [
              {
                id: child,
                provider: "claude",
                sessionId: "child",
                source: "helper",
                presence: "verified-lineage",
                inspectionIdentity: "helper:" + child,
                parentId: parents[0].id,
                status: "working",
                inventoryHealth: "available",
                observedAt: clock,
                usage: usage(777, 1000),
              },
            ],
          }),
        },
      }),
    );
    try {
      const result = await observer.get();
      assert.equal(
        result.aggregate.agents.observed,
        2,
        "duplicate roots count once alongside helper",
      );
      assert.equal(
        result.aggregate.agents.statuses.working,
        2,
        "fresh helper inventory keeps its status",
      );
      assert.deepEqual(result.aggregate.usage.inputTokens, { value: 42, state: "partial" });
      assert.equal(
        result.aggregate.usageObservedAt,
        9000,
        "excluded old duplicate/helper usage cannot age counted fresh totals",
      );
      assert.equal(
        result.aggregate.coverage.conflicting,
        0,
        "expired duplicate usage cannot conflict with fresh evidence",
      );
      assert.equal(
        result.aggregate.coverage.stale,
        1,
        "new helper inventory cannot refresh its old bound usage",
      );
      assert.equal(result.aggregate.coverage.counters.inputTokens.stale, 1);
      assert.equal(
        result.sessions.find((row) => row.id === firstId).tool.available,
        false,
        "newly accepted cached summaries keep their old source time",
      );
      clock += 3000;
      conflict = true;
      const conflicting = await observer.get();
      assert.equal(
        conflicting.aggregate.coverage.conflicting,
        1,
        "contradictory fresh duplicate usage still fails closed",
      );
      assert.equal(conflicting.aggregate.usage.inputTokens.value, null);
      assert.equal(
        conflicting.aggregate.usageObservedAt,
        null,
        "no usable contribution has no usage observation",
      );
    } finally {
      await observer.close();
    }
  }

  async function claudeHelperNamespaces() {
    const { makeTranscriptObserver } = require("./observer-transcripts.js");
    const { makeHelperObserver } = require("./observer-helpers.js");
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), "starnet-claude-namespaces-"));
    try {
      const second = "00000000-0000-0000-0000-000000000002";
      for (const [session, tokens] of [
        [ID, 3],
        [second, 7],
      ]) {
        await fs.writeFile(
          path.join(folder, session + ".jsonl"),
          [
            { type: "user", sessionId: session, message: { content: "parent fixture" } },
            {
              type: "assistant",
              sessionId: session,
              message: {
                content: [
                  {
                    type: "tool_use",
                    name: "Agent",
                    id: "spawn",
                    input: { description: "Own task" },
                  },
                ],
              },
            },
            {
              type: "user",
              sessionId: session,
              toolUseResult: { status: "async_launched", agentId: "same-child" },
              message: { content: [{ type: "tool_result", tool_use_id: "spawn" }] },
            },
          ]
            .map((row) => JSON.stringify(row) + "\n")
            .join(""),
        );
        const directory = path.join(folder, session, "subagents");
        await fs.mkdir(directory, { recursive: true });
        await fs.writeFile(
          path.join(directory, "agent-same-child.jsonl"),
          JSON.stringify({
            type: "assistant",
            sessionId: session,
            session_id: "unrelated-transport",
            agentId: "same-child",
            isSidechain: true,
            message: {
              id: "child-message",
              usage: { input_tokens: tokens },
              content: "child fixture",
            },
          }) + "\n",
        );
      }
      const transcripts = makeTranscriptObserver({ now: () => 1000, roots: { claude: folder } });
      const observer = makeObserver({
        now: () => 1000,
        transcripts,
        helpers: makeHelperObserver({ now: () => 1000, transcripts }),
        identities: {
          resolve: async (row) => ({ sessionId: row.agent_session.value, source: "herdr" }),
        },
        execute: async () => ({
          stdout: JSON.stringify({
            result: {
              agents: [
                { ...pane("a"), agent: "claude" },
                { ...pane("b", second), agent: "claude" },
              ],
            },
          }),
        }),
        projects: { resolve: async () => ({}) },
        bus: { read: () => ({ rows: [] }) },
        desktop: { inventory: async () => ({ health: "unavailable", windows: [] }) },
      });
      const result = await observer.get(),
        children = result.sessions.filter((row) => row.source === "helper");
      assert.equal(children.length, 2);
      assert.notEqual(children[0].id, children[1].id);
      assert.equal(
        result.aggregate.agents.verifiedSessions,
        4,
        "real binding IDs separate equal agent IDs under two canonical roots",
      );
      const stats = await Promise.all(children.map((row) => observer.inspect(row.id)));
      assert.deepEqual(
        stats.map((value) => value.stats.inputTokens.value).sort((a, b) => a - b),
        [3, 7],
      );
      assert.deepEqual(
        result.aggregate.usage.inputTokens,
        { value: 10, state: "partial" },
        "own bound helper usage reaches totals before inspection",
      );
      assert.equal(result.aggregate.coverage.counters.inputTokens.available, 2);
      assert.equal(result.aggregate.coverage.counters.inputTokens.unavailable, 2);
    } finally {
      await fs.rm(folder, { recursive: true, force: true });
    }
  }

  async function identityEnrichmentOrdering() {
    let clock = 1000,
      inventory = [pane("a"), pane("b")];
    const events = [];
    const identities = {
      resolveMany: async (panes) => {
        events.push("identities:" + panes.length);
        return panes.map((row) => ({ sessionId: row.agent_session.value, source: "native" }));
      },
      resolve: async (row) => {
        events.push("identity:" + row.pane_id);
        await new Promise((resolve) => setImmediate(resolve));
        return { sessionId: row.agent_session.value, source: "native" };
      },
      retain() {},
    };
    const observer = makeObserver({
      now: () => clock,
      endpoint: "ordering",
      identities,
      execute: async () => ({ stdout: JSON.stringify({ result: { agents: inventory } }) }),
      desktop: { inventory: async () => ({ health: "unavailable", windows: [] }) },
      bus: { read: () => ({ rows: [] }) },
      transcripts: {
        retain() {},
        read: async () => {
          events.push("transcript");
          await new Promise((resolve) => setImmediate(resolve));
          return { available: true };
        },
      },
      projects: {
        resolve: async () => {
          events.push("project");
          await new Promise((resolve) => setImmediate(resolve));
          return {};
        },
      },
      helpers: {
        children: async (parents) => {
          events.push("helpers:" + parents.length);
          return { rows: [], annotations: new Map(), overflow: new Map() };
        },
      },
    });
    assert.equal(
      (
        await inventoryWhen(
          observer,
          (data) => data.sessions.length === 2 && data.sessions.every((row) => row.tool.available),
        )
      ).sessions.length,
      2,
    );
    assert.equal(events[0], "identities:2", "identities finish before enrichment");
    assert.equal(
      events.at(-1),
      "helpers:2",
      "helper discovery starts alongside summaries after core proof",
    );
    assert.deepEqual(events.slice(1, -1).sort(), [
      "project",
      "project",
      "transcript",
      "transcript",
    ]);
    events.length = 0;
    inventory = [pane("a"), pane("a")];
    clock += 3000;
    assert.equal((await observer.get()).sources.herdr.health, "unavailable");
    assert.deepEqual(
      events,
      [],
      "duplicate inventory rejected before any identity or enrichment calls",
    );
    events.length = 0;
    inventory = [pane("a"), pane("bad id")];
    clock += 3000;
    assert.equal((await observer.get()).sources.herdr.health, "unavailable");
    assert.deepEqual(
      events,
      [],
      "invalid pane ID rejected before any identity or enrichment calls",
    );
    events.length = 0;
    inventory = [];
    clock += 3000;
    assert.deepEqual((await observer.get()).sessions, []);
    assert.deepEqual(events, ["identities:0", "helpers:0"]);
    events.length = 0;
    delete identities.resolveMany;
    inventory = [pane("a"), pane("b")];
    clock += 3000;
    await observer.get();
    assert.deepEqual(
      events.slice(0, 2),
      ["identity:a", "identity:b"],
      "supported injected identity fallback remains serial",
    );
    assert.deepEqual(events.slice(2, -1).sort(), [
      "project",
      "project",
      "transcript",
      "transcript",
    ]);
    assert.equal(events.at(-1), "helpers:2");
  }

  async function refreshStartCache() {
    for (const completionAt of [3000, 100]) {
      let clock = 0,
        reads = 0,
        release;
      const gate = new Promise((resolve) => {
        release = resolve;
      });
      const observer = makeCoreObserver({
        now: () => clock,
        readIdentityConfiguration: async () => "unconfigured",
        execute: async () => {
          reads++;
          await gate;
          return { stdout: JSON.stringify({ result: { agents: [] } }) };
        },
        desktop: { inventory: async () => ({ health: "unavailable", windows: [] }) },
        helpers: {
          children: async () => {
            return { rows: [], annotations: new Map(), overflow: new Map() };
          },
        },
        transcripts: { retain() {} },
        bus: { read: () => ({ rows: [] }) },
      });
      const first = observer.get();
      await new Promise((resolve) => setImmediate(resolve));
      try {
        clock = completionAt;
        assert.equal(
          observer.get(),
          first,
          "pending refresh coalesces even after cache lifetime expires",
        );
      } finally {
        release();
        await first;
      }
      assert.equal(
        (await first).sources.herdr.observedAt,
        completionAt,
        "inventory timestamp is captured when its source completes",
      );
      if (completionAt < 2000) {
        clock = 1999;
        await observer.get();
        assert.equal(reads, 1, "refresh starting at zero remains cached through 1999");
        clock = 2000;
      }
      const next = await observer.get();
      assert.equal(reads, 2, "cache expires from refresh start, including slow completion at 3000");
      assert.equal(
        next.sources.herdr.observedAt,
        clock,
        "new inventory supplies its actual observation time",
      );
    }
  }

  async function pollingFreshness() {
    const Q = require("../frontend/app/queryspine.fixture.js").loadQuerySpine();
    const { makeIdentityResolver } = require("./observer-identity.js");
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

  function deferred() {
    let resolve;
    const promise = new Promise((done) => {
      resolve = done;
    });
    return { promise, resolve };
  }
  async function progressivePublication() {
    const summary = deferred(),
      desktopGate = deferred(),
      helperGate = deferred(),
      busGate = deferred();
    const started = new Set();
    const observer = makeCoreObserver({
      now: () => 1000,
      warmDetails: false,
      identities: {
        resolveMany: async (rows) => rows.map(() => ({ sessionId: ID, source: "native" })),
      },
      projects: { resolveMany: async (rows) => rows.map(() => ({ projectId: "fixture" })) },
      execute: async () => ({ stdout: JSON.stringify({ result: { agents: [pane("early")] } }) }),
      transcripts: {
        retain() {},
        read: async () => {
          started.add("summary");
          await summary.promise;
          return { available: true, usage: { observedAt: 777 } };
        },
        inspect: async () => ({ available: true, health: "available", turns: [] }),
      },
      helpers: {
        prepareChildren: async () => {
          started.add("helper");
          await helperGate.promise;
          return { rows: [], annotations: new Map(), overflow: new Map(), commitBindings() {} };
        },
      },
      desktop: {
        inventory: async () => {
          started.add("desktop");
          await desktopGate.promise;
          return { health: "available", windows: [] };
        },
      },
      bus: {
        read: async () => {
          started.add("bus");
          await busGate.promise;
          return { health: "available", rows: [], observedAt: 800 };
        },
      },
    });
    let published = false;
    const first = observer.get().then((value) => {
      published = true;
      return value;
    });
    await new Promise((resolve) => setImmediate(resolve));
    try {
      assert.equal(
        published,
        true,
        "core rooms publish while every optional source remains blocked",
      );
      const core = await first;
      assert.equal(core.sessions.length, 1);
      assert.equal(core.sessions[0].tool.available, false);
      assert.equal(core.sessions[0].usage, null);
      assert.equal(core.bus, null);
      assert.deepEqual([...started].sort(), ["bus", "desktop", "helper", "summary"]);
      assert.equal(
        (await observer.inspect(core.sessions[0].id, "codex:" + ID)).health,
        "available",
        "explicit inspection ignores unrelated optional gates",
      );
      summary.resolve();
      await summary.promise;
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(
        (await observer.get()).sessions[0].tool.available,
        true,
        "summary publication does not wait for helpers",
      );
      assert.equal(core.sessions[0].tool.available, false, "published snapshots remain immutable");
    } finally {
      summary.resolve();
      desktopGate.resolve();
      helperGate.resolve();
      busGate.resolve();
      await first;
      await observer.close();
    }
  }

  async function inventoryWhen(observer, predicate) {
    for (let attempt = 0; attempt < 1000; attempt++) {
      const snapshot = await observer.get();
      if (predicate(snapshot)) return snapshot;
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.fail("fixture did not publish the expected inventory");
  }

  function progressiveOptions(overrides = {}) {
    return {
      now: () => 1000,
      warmDetails: false,
      identities: {
        resolveMany: async (rows) =>
          rows.map((row) => ({ sessionId: row.agent_session.value, source: "native" })),
      },
      projects: { resolveMany: async (rows) => rows.map(() => ({ projectId: "fixture" })) },
      execute: async () => ({ stdout: JSON.stringify({ result: { agents: [pane("root")] } }) }),
      transcripts: {
        retain() {},
        read: async () => ({ available: true }),
        inspect: async () => ({ available: true, health: "available", turns: [] }),
      },
      helpers: {
        prepareChildren: async () => ({
          rows: [],
          annotations: new Map(),
          overflow: new Map(),
          commitBindings() {},
        }),
      },
      desktop: { inventory: async () => ({ health: "unavailable", windows: [] }) },
      bus: { read: async () => ({ health: "available", rows: [], observedAt: 900 }) },
      ...overrides,
    };
  }
  async function progressiveOptionalFreshness() {
    for (const timestamped of [true, false]) {
      let clock = 1000,
        reads = 0;
      const summary = deferred(),
        helper = deferred();
      const usage = (at) => ({
        inputTokens: { value: 42, state: "available" },
        ...(timestamped ? { observedAt: at } : {}),
      });
      const last = { name: "Read", phase: "started", outcome: "unknown", at: 900 };
      const observer = makeCoreObserver(
        progressiveOptions({
          now: () => clock,
          transcripts: {
            retain() {},
            read: async () => {
              const at = clock;
              reads++;
              if (reads === 1) await summary.promise;
              return { available: true, last, usage: usage(at) };
            },
          },
          helpers: {
            prepareChildren: async () => {
              await helper.promise;
              return { rows: [], annotations: new Map(), overflow: new Map(), commitBindings() {} };
            },
          },
        }),
      );
      try {
        await observer.get();
        summary.resolve();
        const accepted = await inventoryWhen(observer, (data) => data.sessions[0].tool.available);
        assert.equal(accepted.aggregate.usage.inputTokens.value, 42);
        for (clock of [3000, 5000, 7000]) {
          const live = await observer.get();
          assert.equal(live.sessions[0].observedAt, clock);
          assert.equal(
            live.sessions[0].tool.available,
            true,
            "optional evidence is live through exactly six seconds",
          );
          assert.equal(live.aggregate.usage.inputTokens.value, 42);
          assert.equal(live.aggregate.usageObservedAt, 1000);
          assert.equal(
            live.sessions[0].tool.observedAt,
            1000,
            "public tool evidence preserves source/read-start time",
          );
        }
        clock = 7001;
        const expired = await observer.get();
        assert.equal(
          expired.sessions[0].tool.available,
          false,
          "cached snapshots age optional activity at six seconds",
        );
        assert.equal(
          expired.sessions[0].observedAt,
          7000,
          "optional age never changes inventory observation",
        );
        assert.equal(expired.sessions[0].inventoryHealth, "available");
        assert.equal(expired.aggregate.agents.statuses.working, 1);
        assert.equal(expired.aggregate.agents.stale, 0);
        assert.deepEqual(expired.aggregate.usage.inputTokens, {
          value: null,
          state: "unavailable",
        });
        assert.equal(expired.aggregate.coverage.stale, 1);
        assert.equal(expired.aggregate.coverage.counters.inputTokens.stale, 1);
        assert.equal(
          expired.sessions[0].usage.observedAt,
          1000,
          "retain actual source/read observation",
        );
        assert.deepEqual(
          expired.sessions[0].tool.last,
          last,
          "retain last-known tool evidence without advertising it live",
        );
        assert.equal(
          accepted.sessions[0].tool.available,
          true,
          "previous published snapshot stays immutable",
        );
        assert.equal(reads, 1, "unchanged ownership does not restart a held sweep");
        clock = 9000;
        const held = await observer.get();
        assert.equal(held.sessions[0].observedAt, 9000);
        assert.equal(held.aggregate.agents.statuses.working, 1);
        assert.equal(
          held.aggregate.coverage.stale,
          1,
          "a later healthy core cannot renew held optional evidence",
        );
        helper.resolve();
        await helper.promise;
        await new Promise((resolve) => setImmediate(resolve));
        clock = 11000;
        await observer.get();
        const recovered = await inventoryWhen(
          observer,
          (data) => data.sessions[0].usage?.observedAt === clock,
        );
        assert.equal(recovered.sessions[0].tool.available, true);
        assert.equal(recovered.aggregate.usage.inputTokens.value, 42);
        assert.equal(recovered.aggregate.coverage.stale, 0);
      } finally {
        summary.resolve();
        helper.resolve();
        await observer.close();
      }
    }
  }
  async function progressiveOwnership() {
    for (const change of ["unchanged", "session", "process", "removed", "unavailable"]) {
      let clock = 1000,
        session = ID,
        pid = 7,
        present = true,
        failed = false,
        revision = 0,
        sweeps = 0;
      const summary = deferred(),
        helper = deferred(),
        warm = [],
        bindings = new Set();
      const child = "obs_" + "c".repeat(24),
        grandchild = "obs_" + "d".repeat(24);
      const observer = makeCoreObserver(
        progressiveOptions({
          now: () => clock,
          warmDetails: true,
          execute: async () => {
            if (failed) throw Error("fixture unavailable");
            return {
              stdout: JSON.stringify({
                result: { agents: present ? [pane("root", session)] : [] },
              }),
            };
          },
          identities: {
            resolveMany: async (rows) =>
              rows.map((row) => ({
                sessionId: row.agent_session.value,
                source: "footer",
                proof: {
                  paneId: "root",
                  terminalId: "terminal",
                  sessionId: row.agent_session.value,
                  revision: ++revision,
                  birth: { pid, startSeconds: 1, startMicroseconds: 2 },
                },
              })),
            revalidateAll: async () => true,
          },
          transcripts: {
            retain() {},
            read: async () => {
              await summary.promise;
              return { available: true, usage: { observedAt: 700 } };
            },
            inspect: async (id) => {
              warm.push(id);
              return { available: true, health: "available", turns: [] };
            },
          },
          helpers: {
            prepareChildren: async (parents) => {
              const sweep = ++sweeps;
              await helper.promise;
              // Later changed-owner sweeps supply their own empty result; old work must not leak through.
              const rows =
                sweep === 1 || change === "unchanged"
                  ? [
                      {
                        id: child,
                        source: "helper",
                        provider: "codex",
                        sessionId: "child",
                        parentId: parents[0].id,
                        inventoryHealth: "available",
                        inspectionIdentity: "helper:" + child,
                        observedAt: 777,
                        tool: { available: false },
                      },
                      {
                        id: grandchild,
                        source: "helper",
                        provider: "codex",
                        sessionId: "grandchild",
                        parentId: child,
                        inventoryHealth: "available",
                        inspectionIdentity: "helper:" + grandchild,
                        observedAt: 778,
                        tool: { available: false },
                      },
                    ]
                  : [];
              return {
                rows,
                annotations: new Map(),
                overflow: new Map(),
                commitBindings(ids) {
                  bindings.clear();
                  for (const row of rows) if (ids.has(row.id)) bindings.add(row.id);
                },
              };
            },
            inspect: async (row) => {
              assert(bindings.has(row.id), "visible helper and binding publish together");
              warm.push(row.id);
              return { available: true, health: "available", turns: [] };
            },
          },
        }),
      );
      try {
        const first = await observer.get();
        const root = first.sessions[0].id;
        for (let round = 0; round < 3; round++) {
          clock += 2000;
          if (round === 1) {
            if (change === "session") session = "00000000-0000-0000-0000-000000000002";
            if (change === "process") pid++;
            if (change === "removed") present = false;
            if (change === "unavailable") failed = true;
          }
          await observer.get();
        }
        assert.equal(sweeps, 1, "polling never overlaps or cancels an active sweep");
        summary.resolve();
        helper.resolve();
        if (change === "unchanged") {
          const enriched = await inventoryWhen(
            observer,
            (data) => data.sessions.length === 3 && warm.includes(grandchild),
          );
          assert.equal(enriched.sessions[0].observedAt, 7000);
          assert.equal(enriched.sessions[0].usage.observedAt, 700);
          assert.equal(enriched.sessions[1].observedAt, 777);
          assert.equal(enriched.sessions[2].observedAt, 778);
          assert.equal(
            sweeps,
            1,
            "unchanged ownership retains enrichment across three generations",
          );
          assert.deepEqual([...bindings], [child, grandchild]);
          assert.equal(
            (await observer.inspect(grandchild, "helper:" + grandchild + "|" + child)).health,
            "available",
          );
          clock += 2000;
          await observer.get();
          const retained = await observer.get();
          assert.equal(
            retained.sessions[1].observedAt,
            777,
            "a later core cannot restamp helper evidence",
          );
          assert.equal(retained.sessions[0].usage.observedAt, 700);
        } else {
          // Synchronize on actual fixture work; get exposes only public snapshots.
          await summary.promise;
          await helper.promise;
          await new Promise((resolve) => setImmediate(resolve));
          const latest = await observer.get();
          assert.equal(
            latest.sessions.some((row) => row.id === child || row.id === grandchild),
            false,
            change + ": obsolete ancestry rejected",
          );
          assert.equal(bindings.size, 0);
          assert(!warm.includes(child));
          assert(!warm.includes(grandchild));
          if (change === "removed") assert(!warm.includes(root));
        }
      } finally {
        summary.resolve();
        helper.resolve();
        await observer.close();
      }
    }
  }
  async function boundedWarmup() {
    let clock = 1000,
      inventoryReads = 0,
      active = 0,
      maximum = 0;
    const panes = Array.from({ length: 40 }, (_, index) =>
      pane("warm-" + index, "00000000-0000-0000-0000-" + String(index + 1).padStart(12, "0")),
    );
    const jobs = [],
      observers = [];
    const observer = makeCoreObserver(
      progressiveOptions({
        now: () => clock,
        warmDetails: true,
        execute: async () => {
          inventoryReads++;
          return { stdout: JSON.stringify({ result: { agents: panes } }) };
        },
        transcripts: {
          retain() {},
          read: async () => ({ available: true, usage: { observedAt: clock } }),
          inspect: async (id) => {
            const gate = deferred();
            active++;
            maximum = Math.max(maximum, active);
            jobs.push({ id, gate });
            await gate.promise;
            active--;
            return { available: false };
          },
        },
      }),
    );
    observers.push(observer);
    try {
      await observer.get();
      await inventoryWhen(
        observer,
        (data) =>
          jobs.length === 2 && data.sessions.every((row) => row.usage?.observedAt === clock),
      );
      assert.equal(active, 2);
      for (let round = 0; round < 3; round++) {
        clock += 2000;
        await observer.get();
        await inventoryWhen(observer, (data) =>
          data.sessions.every((row) => row.usage?.observedAt === clock),
        );
      }
      // Advance beyond cooldown while reads are held. Warmup must never request new inventory itself.
      clock += 61000;
      const demands = inventoryReads;
      for (let completed = 0; completed < 32; completed++) {
        await fixtureUntil(
          () => !!jobs[completed],
          "warm job " + completed + ", total=" + jobs.length,
        );
        jobs[completed].gate.resolve();
        await jobs[completed].gate.promise;
      }
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(
        jobs.length,
        32,
        "one bounded sweep prepares at most 32 stable roster identities",
      );
      assert.equal(maximum, 2);
      assert.equal(active, 0);
      assert.equal(
        new Set(jobs.map((job) => job.id)).size,
        32,
        "unchanged queued targets are never duplicated across core generations",
      );
      assert.equal(
        inventoryReads,
        demands,
        "background work alone cannot trigger inventory or restart expired warmup",
      );
      // A caller resumes polling: expired attempts may be scheduled again.
      await observer.get();
      await inventoryWhen(observer, () => jobs.length === 34);
      assert.equal(inventoryReads, demands + 1);
      for (let index = 32; index < 34; index++) {
        await fixtureUntil(
          () => !!jobs[index],
          "second warm job " + index + ", total=" + jobs.length,
        );
        jobs[index].gate.resolve();
      }
      await new Promise((resolve) => setImmediate(resolve));
      await observer.get();
      assert.equal(
        jobs.length,
        34,
        "unavailable attempts also obey the 60-second cooldown from their actual start",
      );
      const hidden = makeCoreObserver(
        progressiveOptions({
          warmDetails: false,
          transcripts: {
            retain() {},
            read: async () => ({ available: true }),
            inspect: async () => {
              assert.fail("disabled warmup read content");
            },
          },
        }),
      );
      observers.push(hidden);
      await hidden.get();
      await new Promise((resolve) => setImmediate(resolve));
      await hidden.get();
    } finally {
      for (const job of jobs) job.gate.resolve();
      await Promise.all(observers.map((value) => value.close()));
    }
  }

  async function fixtureUntil(predicate, label) {
    for (let attempt = 0; attempt < 1000; attempt++) {
      if (predicate()) return;
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.fail(label);
  }

  async function queuedWarmOwnership() {
    let clock = 1000,
      parentIndex = 0,
      thirdSession = "00000000-0000-0000-0000-000000000003",
      fourth = true;
    const child = "obs_" + "e".repeat(24),
      gates = [],
      reads = [],
      helperParents = [];
    const observer = makeCoreObserver(
      progressiveOptions({
        now: () => clock,
        warmDetails: true,
        execute: async () => ({
          stdout: JSON.stringify({
            result: {
              agents: [
                pane("a"),
                pane("b", "00000000-0000-0000-0000-000000000002"),
                pane("c", thirdSession),
                ...(fourth ? [pane("d", "00000000-0000-0000-0000-000000000004")] : []),
              ],
            },
          }),
        }),
        transcripts: {
          retain() {},
          read: async () => ({ available: true, usage: { observedAt: clock } }),
          inspect: async (id, provider, session) => {
            reads.push(session);
            if (reads.length <= 2) {
              const gate = deferred();
              gates.push(gate);
              await gate.promise;
            }
            return { available: true, health: "available", turns: [] };
          },
        },
        helpers: {
          prepareChildren: async (parents) => ({
            rows: [
              {
                id: child,
                source: "helper",
                provider: "codex",
                sessionId: "child",
                inspectionIdentity: "helper:" + child,
                parentId: parents[parentIndex].id,
                inventoryHealth: "available",
                observedAt: 900,
              },
            ],
            annotations: new Map(),
            overflow: new Map(),
            commitBindings() {},
          }),
          inspect: async (row) => {
            helperParents.push(row.parentId);
            return { available: true, health: "available", turns: [] };
          },
        },
      }),
    );
    try {
      const core = await observer.get();
      await inventoryWhen(
        observer,
        (data) => data.sessions.some((row) => row.id === child) && gates.length === 2,
      );
      for (const [session, parent] of [
        ["00000000-0000-0000-0000-000000000005", 1],
        ["00000000-0000-0000-0000-000000000006", 0],
      ]) {
        clock += 2000;
        thirdSession = session;
        parentIndex = parent;
        fourth = false;
        await observer.get();
        await inventoryWhen(
          observer,
          (data) =>
            data.sessions.find((row) => row.id === child)?.parentId === core.sessions[parent].id &&
            data.sessions
              .filter((row) => row.source === "herdr")
              .every((row) => row.usage?.observedAt === clock),
        );
      }
      for (const gate of gates) gate.resolve();
      await fixtureUntil(
        () => helperParents.length === 1 && reads.includes(thirdSession),
        "latest queued ownership did not warm",
      );
      assert.deepEqual(
        reads,
        [ID, "00000000-0000-0000-0000-000000000002", thirdSession],
        "removed and superseded queued identities never read content",
      );
      assert.deepEqual(
        helperParents,
        [core.sessions[0].id],
        "only the latest complete helper ancestry reaches a queued read",
      );
    } finally {
      for (const gate of gates) gate.resolve();
      await observer.close();
    }
  }
  async function progressiveClose() {
    const summary = deferred(),
      helpers = deferred(),
      bus = deferred(),
      desktop = deferred();
    let reads = 0,
      helperCloses = 0;
    const observer = makeCoreObserver(
      progressiveOptions({
        warmDetails: true,
        transcripts: {
          retain() {},
          read: async () => {
            await summary.promise;
            return { available: true };
          },
          inspect: async () => {
            reads++;
          },
        },
        helpers: {
          prepareChildren: async () => {
            await helpers.promise;
            return {
              rows: [],
              annotations: new Map(),
              overflow: new Map(),
              commitBindings() {
                assert.fail("closed observer committed helper bindings");
              },
            };
          },
          close: async () => {
            helperCloses++;
          },
        },
        bus: {
          read: async () => {
            await bus.promise;
            return { rows: [], health: "available" };
          },
        },
        desktop: {
          inventory: async () => {
            await desktop.promise;
            return { windows: [], health: "available" };
          },
        },
      }),
    );
    const before = await observer.get();
    const closing = observer.close();
    assert.equal(observer.close(), closing);
    let complete = false;
    closing.then(() => {
      complete = true;
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(complete, false, "close waits for accepted bounded work");
    summary.resolve();
    helpers.resolve();
    bus.resolve();
    desktop.resolve();
    await closing;
    const after = await observer.get();
    assert.deepEqual(after, before, "late optional results cannot publish after close");
    assert.equal(reads, 0);
    assert.equal(helperCloses, 1);
    assert.equal((await observer.inspect(before.sessions[0].id)).health, "unavailable");
    // A second observer closes with active reads and a queue, not only pending metadata.
    const jobs = [],
      activeObserver = makeCoreObserver(
        progressiveOptions({
          warmDetails: true,
          execute: async () => ({
            stdout: JSON.stringify({
              result: {
                agents: Array.from({ length: 4 }, (_, index) =>
                  pane(
                    "close-" + index,
                    "00000000-0000-0000-0000-" + String(index + 1).padStart(12, "0"),
                  ),
                ),
              },
            }),
          }),
          transcripts: {
            retain() {},
            read: async () => ({ available: true }),
            inspect: async () => {
              const job = deferred();
              jobs.push(job);
              await job.promise;
              return { available: true, turns: [] };
            },
          },
        }),
      );
    try {
      await activeObserver.get();
      await fixtureUntil(() => jobs.length === 2, "two warm jobs did not start");
      const stopping = activeObserver.close();
      jobs.forEach((job) => job.resolve());
      await stopping;
      assert.equal(jobs.length, 2, "teardown clears queued targets before active work settles");
    } finally {
      jobs.forEach((job) => job.resolve());
      await activeObserver.close();
    }
    const stuck = deferred();
    const bounded = makeCoreObserver(
      progressiveOptions({
        transcripts: {
          retain() {},
          read: async () => {
            await stuck.promise;
            return { available: true };
          },
        },
      }),
    );
    await bounded.get();
    let published;
    const setTimer = globalThis.setTimeout,
      clearTimer = globalThis.clearTimeout;
    let deadline,
      unref = 0,
      cleared = 0;
    try {
      globalThis.setTimeout = (callback, milliseconds) => {
        assert.equal(milliseconds, 10000);
        deadline = callback;
        return {
          unref() {
            unref++;
          },
        };
      };
      globalThis.clearTimeout = () => {
        cleared++;
      };
      const stopping = bounded.close();
      published = await bounded.get();
      assert.equal(typeof deadline, "function");
      deadline();
      await stopping;
      assert.equal(unref, 1);
      assert.equal(cleared, 1, "close deadline cannot retain a timer after settlement");
    } finally {
      globalThis.setTimeout = setTimer;
      globalThis.clearTimeout = clearTimer;
      stuck.resolve();
      await bounded.close();
    }
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(
      await bounded.get(),
      published,
      "uncooperative optional work may settle later without publishing",
    );
  }

  async function helperFailureTruthfulness() {
    let clock = 1000,
      mode = "available",
      coreFails = false;
    const child = "obs_" + "b".repeat(24),
      bindings = new Set(),
      recovery = deferred();
    const observer = makeCoreObserver(
      progressiveOptions({
        now: () => clock,
        execute: async () => {
          if (coreFails) throw Error("fixture unavailable");
          return { stdout: JSON.stringify({ result: { agents: [pane("root")] } }) };
        },
        helpers: {
          prepareChildren: async (parents) => {
            if (mode === "recovering") await recovery.promise;
            return {
              health: mode === "failed" ? "unavailable" : "available",
              reason: mode === "failed" ? "unreadable" : null,
              rows:
                mode === "failed"
                  ? []
                  : [
                      {
                        id: child,
                        source: "helper",
                        provider: "codex",
                        inspectionIdentity: "helper:" + child,
                        parentId: parents[0].id,
                        inventoryHealth: "available",
                        observedAt: 777,
                      },
                    ],
              annotations: new Map(),
              overflow: new Map(),
              commitBindings(ids) {
                bindings.clear();
                for (const id of ids) bindings.add(id);
              },
            };
          },
          inspect: async () => ({ available: true, health: "available", turns: [] }),
        },
      }),
    );
    try {
      await observer.get();
      await inventoryWhen(observer, (data) => data.sessions.some((row) => row.id === child));
      clock += 2000;
      mode = "failed";
      await observer.get();
      const stale = await inventoryWhen(
        observer,
        (data) => data.sessions.find((row) => row.id === child)?.inventoryHealth === "unavailable",
      );
      assert.equal(stale.sessions.find((row) => row.id === child).observedAt, 777);
      assert.equal((await observer.inspect(child)).reason, "inventory-unavailable");
      assert.equal(bindings.size, 0);
      clock += 2000;
      coreFails = true;
      await observer.get();
      assert.equal(
        (await observer.get()).sessions.find((row) => row.id === child).inventoryHealth,
        "unavailable",
      );
      clock += 2000;
      coreFails = false;
      mode = "recovering";
      await observer.get();
      assert.equal(
        (await observer.inspect(child)).reason,
        "inventory-unavailable",
        "a surviving parent cannot revive an older helper binding",
      );
      recovery.resolve();
      await inventoryWhen(
        observer,
        (data) => data.sessions.find((row) => row.id === child)?.inventoryHealth === "available",
      );
    } finally {
      recovery.resolve();
      await observer.close();
    }
  }

  async function progressiveGrouping() {
    let clock = 1000,
      cwd = "old-room";
    const helperGate = deferred(),
      child = "obs_" + "f".repeat(24);
    const observer = makeCoreObserver(
      progressiveOptions({
        now: () => clock,
        execute: async () => ({
          stdout: JSON.stringify({
            result: {
              agents: [
                { ...pane("root"), cwd },
                { ...pane("child", "00000000-0000-0000-0000-000000000002"), cwd: "child-room" },
                { ...pane("capped", "00000000-0000-0000-0000-000000000003"), cwd: "capped-room" },
              ],
            },
          }),
        }),
        projects: {
          resolveMany: async (cwds) =>
            cwds.map((value) => ({
              projectId: value,
              project: value,
              repoId: value + "-repo",
              worktree: value + "-tree",
            })),
        },
        helpers: {
          prepareChildren: async (parents) => {
            await helperGate.promise;
            const oldGrouping = {
              projectId: parents[0].projectId,
              project: parents[0].project,
              repoId: parents[0].repoId,
              worktree: parents[0].worktree,
            };
            return {
              rows: [
                {
                  id: child,
                  source: "helper",
                  provider: "codex",
                  inspectionIdentity: "helper:" + child,
                  inventoryHealth: "available",
                  parentId: parents[1].id,
                  observedAt: 777,
                  ...oldGrouping,
                },
              ],
              annotations: new Map([
                [parents[1].id, { parentId: parents[0].id, ...oldGrouping }],
                [parents[2].id, oldGrouping],
              ]),
              groupOwners: new Map([[parents[2].id, parents[0].id]]),
              overflow: new Map(),
              commitBindings() {},
            };
          },
        },
      }),
    );
    try {
      const first = await observer.get();
      assert.equal(first.sessions[0].projectId, "old-room");
      clock += 2000;
      cwd = "new-room";
      const core = await observer.get();
      assert.equal(core.sessions[0].projectId, "new-room");
      helperGate.resolve();
      const enriched = await inventoryWhen(observer, (data) => data.sessions.length === 4);
      for (const row of enriched.sessions) {
        assert.equal(
          row.projectId,
          "new-room",
          "captured enrichment must inherit the current owner room",
        );
        assert.equal(row.repoId, "new-room-repo");
        assert.equal(row.worktree, "new-room-tree");
      }
      assert.equal(
        enriched.sessions[0].projectId,
        core.sessions[0].projectId,
        "lineage cannot overwrite latest core grouping",
      );
      assert.equal(
        enriched.sessions[2].parentId,
        undefined,
        "capped ownership still advertises no guessed helper parent",
      );
      assert.equal(enriched.sessions[3].observedAt, 777);
    } finally {
      helperGate.resolve();
      await observer.close();
    }
  }

  async function optionalToolObservationFallback() {
    let clock = 1000;
    const helper = deferred();
    const observer = makeCoreObserver(
      progressiveOptions({
        now: () => clock,
        helpers: {
          prepareChildren: async () => {
            await helper.promise;
            return { rows: [], annotations: new Map(), overflow: new Map() };
          },
        },
      }),
    );
    try {
      await observer.get();
      const accepted = await inventoryWhen(observer, (data) => data.sessions[0].tool.available);
      assert.equal(
        accepted.sessions[0].tool.observedAt,
        1000,
        "tool-only adapter exports captured read start",
      );
      clock = 7000;
      const boundary = await observer.get();
      assert.equal(
        boundary.sessions[0].tool.observedAt,
        1000,
        "healthy core does not restamp tool-only evidence",
      );
      assert.equal(boundary.sessions[0].tool.available, true);
      clock++;
      assert.equal((await observer.get()).sessions[0].tool.available, false);
    } finally {
      helper.resolve();
      await observer.close();
    }
  }

  async function overseerRoles() {
    const { makeOverseerState } = require("./overseer-state.js");
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "observer-overseer-"));
    const file = path.join(directory, "identity.json"),
      endpoint = "/fixture/observer.sock";
    const launched = {
      pane_id: "boss",
      workspace_id: "workspace",
      terminal_id: "terminal",
      agent: "claude",
      name: "ordinary name",
    };
    let inventory = [launched, { ...launched, pane_id: "legacy", name: "overseer" }],
      fail = false,
      clock = 1000;
    const observers = [];
    const create = (state) => {
      const observer = makeCoreObserver({
        now: () => clock,
        endpoint,
        overseerState: state,
        identities: {
          resolveMany: async (panes) =>
            panes.map(() => ({ sessionId: null, source: "unavailable" })),
        },
        execute: async (command, args, settings) => {
          assert.deepEqual(args, ["agent", "list"], "role proof adds no per-row subprocess");
          assert.equal(settings.env.HERDR_SOCKET_PATH, endpoint);
          if (fail) throw Error("inventory unavailable");
          return { stdout: JSON.stringify({ result: { agents: inventory } }) };
        },
        projects: { resolve: async () => ({ projectId: "fixture" }) },
        transcripts: { read: async () => ({ available: false }), retain() {} },
        helpers: {
          children: async () => ({ rows: [], annotations: new Map(), overflow: new Map() }),
        },
        bus: { read: () => ({ rows: [] }) },
        desktop: { inventory: async () => ({ health: "unavailable", windows: [] }) },
        warmDetails: false,
      });
      observers.push(observer);
      return observer;
    };
    try {
      const state = makeOverseerState({ file, endpoint });
      const owner = await state.reserve();
      await state.notePane(owner, "boss");
      await state.commit(owner, launched);
      const first = await create(state).get();
      assert.equal(first.sessions.find((row) => row.paneId === "boss").role, "overseer");
      assert.equal(
        first.sessions.find((row) => row.paneId === "legacy").role,
        null,
        "legacy name cannot adopt role",
      );
      assert.equal(
        first.sessions.find((row) => row.paneId === "boss").identityHealth,
        "unavailable",
        "role is independent of transcript proof",
      );
      inventory = [{ ...launched, name: "renamed again", terminal_title_stripped: "random title" }];
      const restarted = create(makeOverseerState({ file, endpoint }));
      assert.equal((await restarted.get()).sessions[0].role, "overseer");
      clock += 3000;
      fail = true;
      const stale = (await restarted.get()).sessions[0];
      assert.equal(stale.role, "overseer");
      assert.equal(stale.inventoryHealth, "unavailable");
      fail = false;
      clock += 3000;
      inventory = [{ ...launched, terminal_id: "reused" }];
      assert.equal((await restarted.get()).sessions[0].role, null);
      assert(
        !JSON.stringify(await restarted.get()).includes(file),
        "private state path never enters rows",
      );
    } finally {
      for (const observer of observers) observer.close();
      await fs.rm(directory, { recursive: true, force: true });
    }
  }

  // A transcript UUID belongs to one host; copied histories on other machines are
  // independent observations, while duplicate panes on the same host still agree or conflict.
  function aggregateHostOwnership() {
    const usage = (value) => ({
      inputTokens: { value, state: "available" },
      outputTokens: { value: 2, state: "available" },
      cacheReadTokens: { value: 0, state: "available" },
      cacheWriteTokens: { value: 0, state: "available" },
      observedAt: 1000,
    });
    const local = {
      id: "local-pane",
      provider: "codex",
      source: "herdr",
      sessionId: ID,
      inspectionIdentity: "codex:" + ID,
      inventoryHealth: "available",
      observedAt: 1000,
      status: "working",
      usage: usage(10),
    };
    const remote = { ...local, id: "remote-pane", host: "vm", status: "blocked", usage: usage(20) };
    const combined = aggregateRows([local, remote], 1000);
    assert.equal(
      combined.agents.observed,
      2,
      "same UUID on different hosts represents two observed agents",
    );
    assert.equal(combined.agents.verifiedSessions, 2);
    assert.equal(combined.agents.statuses.working, 1);
    assert.equal(combined.agents.statuses.blocked, 1);
    assert.equal(
      combined.coverage.conflicting,
      0,
      "independent host statuses and counters never conflict",
    );
    assert.deepEqual(combined.usage.inputTokens, { value: 30, state: "available" });
    assert.deepEqual(combined.usage.outputTokens, { value: 4, state: "available" });

    const duplicate = aggregateRows(
      [local, { ...local, id: "local-copy", host: null }, remote, { ...remote, id: "remote-copy" }],
      1000,
    );
    assert.deepEqual(
      duplicate,
      combined,
      "same-host duplicates count once; missing and null host both mean local",
    );
    const conflicted = aggregateRows(
      [local, remote, { ...remote, id: "remote-copy", status: "done", usage: usage(99) }],
      1000,
    );
    assert.equal(
      conflicted.coverage.conflicting,
      1,
      "same-host contradictory duplicates retain existing exclusion policy",
    );
    assert.equal(conflicted.agents.observed, 1);
    assert.equal(conflicted.agents.statuses.working, 1);
    assert.deepEqual(
      conflicted.usage.inputTokens,
      { value: 10, state: "partial" },
      "remote conflict cannot discard or contaminate local usage",
    );
  }
}, 30000);
