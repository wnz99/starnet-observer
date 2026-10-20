const AVAILABLE_TOOL = true;
const UNAVAILABLE_TOOL = false;
const PUBLISHED_CORE = true;
const NO_DETAIL_READ = false;
const NO_OBSOLETE_DESCENDANTS = false;
const CLOSE_STILL_PENDING = false;
import { settled } from "./testing.fixture.js";
import type { ChildBinding } from "../inspector/contracts.js";
import type { HelperTranscripts } from "../helpers/contracts.js";
import type { BusState } from "../bus/types.js";
import {
  must,
  inspection,
  busFixture,
  deferred,
  fixtureRelease,
  fixtureString,
  nativeSession,
  usageFixture,
  lastFixture,
} from "./testing.fixture.js";
import { test } from "bun:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { makeObserver as makeNativeObserver, aggregateRows, lastActivity } from "./index.js";
import { makeHelperObserver } from "../helpers/index.js";
import { makeDesktopObserver } from "../desktop/index.js";
import { makeTranscriptObserver } from "../transcripts/index.js";
import { makeIdentityResolver } from "../identity/index.js";
import { CONTENT_CHANGED_CODE } from "../identity/types.js";
import { makeOverseerState } from "../overseer-state/index.js";
import type { ObserverOptions, Inventory, ObserverInputRow } from "./contracts.js";

test("observer regression contracts", async () => {
  // Inventory fixtures never consult a developer's real private overseer record.
  const emptyOverseerState: NonNullable<ObserverOptions["overseerState"]> = {
    read: () => settled(() => ({ state: "empty" })),
    match: () => settled(() => false),
  };
  const makeCoreObserver = (options: ObserverOptions = {}) =>
    makeNativeObserver({ overseerState: emptyOverseerState, ...options });
  // Legacy scenarios assert completed source observations using tracked injected fixture work.
  // Progressive fixtures below exercise production core publication directly.
  function makeObserver(options?: ObserverOptions) {
    if (!options) return makeCoreObserver();
    const work = new Set<Promise<unknown>>();
    function track<A extends unknown[], R>(
      method: (...args: A) => R | Promise<R>,
      receiver: object,
    ) {
      return (...args: A) => {
        const promise = Promise.resolve().then(() => method.apply(receiver, args));
        work.add(promise);
        void promise.then(
          () => {
            work.delete(promise);
          },
          () => {
            work.delete(promise);
          },
        );
        return promise;
      };
    }
    const tracked: ObserverOptions = { ...options, warmDetails: false };
    if (options.transcripts) {
      const adapter = options.transcripts;
      tracked.transcripts = {
        ...adapter,
        ...(adapter.read ? { read: track(adapter.read, adapter) } : {}),
      };
    }
    if (options.helpers) {
      const adapter = options.helpers;
      tracked.helpers = {
        ...adapter,
        ...(adapter.children ? { children: track(adapter.children, adapter) } : {}),
        ...(adapter.prepareChildren
          ? { prepareChildren: track(adapter.prepareChildren, adapter) }
          : {}),
      };
    }
    if (options.desktop)
      tracked.desktop = {
        ...options.desktop,
        inventory: track(options.desktop.inventory, options.desktop),
      };
    if (options.bus) tracked.bus = { ...options.bus, read: track(options.bus.read, options.bus) };
    const observer = makeCoreObserver(tracked);
    let pending: Promise<Inventory> | null = null;
    const get = () =>
      pending ||
      (pending = observer
        .get()
        .then(async () => {
          while (work.size > 0) await Promise.allSettled([...work]);
          return observer.get();
        })
        .finally(() => {
          pending = null;
        }));
    return {
      ...observer,
      get,
      inspect: async (...args: Parameters<typeof observer.inspect>) => {
        await get();
        return observer.inspect(...args);
      },
    };
  }
  assert.throws(() => makeObserver(), /requires an injected now clock/);
  // Working-session idle age uses current time, otherwise the newer conversation or tool event, clamped against future timestamps.
  assert.equal(lastActivity("working", { lastEntryAt: 5 }, 1000), 1000);
  assert.equal(
    lastActivity(
      "idle",
      { lastEntryAt: 700, last: lastFixture({ at: new Date(600).toISOString() }) },
      1000,
    ),
    700,
  );
  assert.equal(
    lastActivity(
      "idle",
      { lastEntryAt: null, last: lastFixture({ at: new Date(600).toISOString() }) },
      1000,
    ),
    600,
  );
  assert.equal(lastActivity("idle", { modifiedAt: 900 }, 1000), null, "file mtime is not activity");
  assert.equal(lastActivity("done", { lastEntryAt: 5000 }, 1000), 1000, "clock skew is clamped");
  assert.equal(lastActivity("idle", { available: false }, 1000), null);
  const ID = "00000000-0000-0000-0000-000000000001";
  const pane = (id: string, session: string | null = ID) => ({
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
    await historicalLineage();
    await progressiveOptionalFreshness();
    await sparseEvidenceShape();
    await receiverAdapters();
    await titleCoercion();
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
    let release: (() => void) | true | null | undefined;
    const reads: [string, ObserverInputRow["provider"], string | null | undefined][] = [];
    let inspectRelease: (() => void) | true | null | undefined = null;
    // A fixture bus reader: the real user bus is never opened by this test.
    let busReads = 0,
      busState: BusState = {
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
      readIdentityConfiguration: () => settled(() => "unconfigured"),
      now: () => now,
      endpoint: "test",
      desktop: {
        inventory: () =>
          settled(() => ({ health: "unavailable", reason: "unsupported", windows: [] })),
      },
      bus: {
        read: () => {
          busReads++;
          return busState;
        },
      },
      projects: { resolve: () => settled(() => ({ project: "project", projectId: "fixture" })) },
      transcripts: {
        read: (...args) => {
          return settled(() => {
            reads.push(args);
            return { available: false };
          });
        },
        retain() {},
        inspect: async () => {
          if (inspectRelease)
            await new Promise<void>((resolve) => {
              inspectRelease = resolve;
            });
          return inspection({
            available: true,
            health: "available",
            turns: [{ text: "conversation" }],
          });
        },
      },
      execute: async (_command, args, options) => {
        assert.equal(_command, "herdr");
        assert.deepEqual(args, ["agent", "list"]);
        assert.equal(options.timeout, 3000);
        count++;
        if (release)
          await new Promise<void>((resolve) => {
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
    fixtureRelease(release);
    release = null;
    const a = await first;
    assert.equal(count, 1);
    assert.equal(a.sessions.length, 2);
    assert.notEqual(must(a.sessions[0]).id, must(a.sessions[1]).id);
    assert.equal(must(a.sessions[0]).project, "project");
    assert(!JSON.stringify(a).includes("/private"));
    assert(!must(must(a.sessions[0]).title).includes("123456789ABC"));
    assert(!must(must(a.sessions[0]).title).includes("canary"));
    assert(must(must(a.sessions[0]).title).includes("Check"));
    assert.equal((await observer.inspect(must(a.sessions[0]).id)).health, "available");
    assert.equal((await observer.inspect("unknown")).reason, "unknown-session");
    assert.equal((await observer.get()).observedAt, 1000);
    assert.equal(count, 1);
    assert.equal(busReads, 1, "the bus shares the 2s snapshot cache");
    // Two panes share the codex session, so the join stays ambiguous; the claude address has no pane.
    assert.deepEqual(must(a.bus).messages, [
      {
        id: 7,
        from: "ambiguous",
        to: "external",
        sentAt: null,
        acknowledgedAt: null,
        wake: "requested",
      },
    ]);
    assert.equal(must(a.bus).health, "available");
    assert(!JSON.stringify(a.bus).includes(ID));
    now = 4000;
    fail = true;
    busState = { ...busState, health: "unavailable", reason: "unreadable" };
    const stale = await observer.get();
    assert.equal(stale.health, "unavailable");
    assert.equal(stale.observedAt, 1000);
    const staleInspection = await observer.inspect(must(a.sessions[0]).id);
    assert.equal(staleInspection.reason, "inventory-unavailable");
    assert.deepEqual(staleInspection.turns, []);
    assert.deepEqual(
      [must(stale.bus).health, must(stale.bus).observedAt, must(stale.bus).messages.length],
      ["unavailable", 900, 1],
      "bus health is reported independently",
    );
    busState = { ...busState, health: "available", reason: null };
    assert.deepEqual(
      stale.sessions.map((row) => row.inventoryHealth),
      ["unavailable", "unavailable"],
    );
    assert.equal(must(stale.sessions[0]).observedAt, must(a.sessions[0]).observedAt);
    assert(!JSON.stringify(stale).includes("SECRET"));
    now = 7000;
    fail = false;
    inventory = [pane("one", null)];
    const b = await observer.get();
    assert.equal(b.sessions.length, 1);
    assert.equal(must(b.sessions[0]).id, must(a.sessions[0]).id);
    assert.equal(must(b.sessions[0]).sessionId, null);
    assert.equal(must(reads.at(-1))[2], null);
    assert.equal((await observer.inspect(must(b.sessions[0]).id)).reason, "identity-unavailable");
    assert.equal(
      must(must(b.bus).messages[0]).from,
      "external",
      "a pane without a session id never joins",
    );
    now = 10000;
    inventory = [pane("one"), pane("two", "00000000-0000-0000-0000-000000000002")];
    const joined = await observer.get();
    assert.equal(
      must(must(joined.bus).messages[0]).from,
      must(joined.sessions[0]).id,
      "exact provider:session join",
    );
    inspectRelease = true;
    const oldInspection = observer.inspect(must(joined.sessions[0]).id, "codex:" + ID);
    await new Promise<void>((resolve) => setImmediate(resolve));
    now = 12500;
    inventory = [pane("one", "00000000-0000-0000-0000-000000000002")];
    await observer.get();
    fixtureRelease(inspectRelease);
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
        ...pane(`batch-${String(index)}`),
        cwd: `/fixture/${String(index)}`,
      }));
      let active = 0,
        maximum = 0,
        begins = 0,
        projectMaximum = 0,
        projectActive = 0;
      const gates: (() => void)[] = [],
        projectGates: (() => void)[] = [],
        projectCalls: unknown[] = [];
      const project = async (cwd: unknown) => {
        projectCalls.push(cwd);
        projectMaximum = Math.max(projectMaximum, ++projectActive);
        await new Promise<void>((resolve) => projectGates.push(resolve));
        projectActive--;
        return { projectId: fixtureString(cwd) };
      };
      const observer = makeObserver({
        now: () => 1000,
        execute: () => settled(() => ({ stdout: JSON.stringify({ result: { agents } }) })),
        identities: {
          resolveMany: (panes) =>
            settled(() => panes.map(() => ({ sessionId: ID, source: "fixture" }))),
        },
        projects: batchProjects
          ? {
              resolveMany: (cwds) =>
                settled(() =>
                  Promise.all(
                    cwds.map((cwd) => Promise.resolve({ projectId: fixtureString(cwd) })),
                  ),
                ),
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
            await new Promise<void>((resolve) => gates.push(resolve));
            active--;
            return { available: true, marker: id };
          },
        },
        helpers: {
          children: () =>
            settled(() => ({
              rows: [],
              annotations: new Map<string, Partial<ObserverInputRow>>(),
              overflow: new Map<string, number>(),
            })),
        },
        desktop: { inventory: () => settled(() => ({ health: "available", windows: [] })) },
        bus: { read: () => settled(() => busFixture({ rows: [] })) },
      });
      const refreshState = { complete: false };
      const refreshing = observer.get().then((value) => {
        refreshState.complete = true;
        return value;
      });
      for (let attempts = 0; !refreshState.complete && attempts < 1000; attempts++) {
        await new Promise<void>((resolve) => setImmediate(resolve));
        gates
          .splice(0)
          .reverse()
          .forEach((resolve) => {
            resolve();
          });
        projectGates
          .splice(0)
          .reverse()
          .forEach((resolve) => {
            resolve();
          });
      }
      assert(refreshState.complete, "bounded refresh completes");
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
    for (const closeEarly of [false, true]) await composedSummaryBoundScenario(closeEarly);
  }
  async function composedSummaryBoundScenario(closeEarly: boolean) {
    // Helper identity order differs from roster order: its first root is outside
    // the four summaries admitted initially. Identical pending keys cannot hide it.
    const agents = Array.from({ length: 9 }, (_, index) =>
      pane(
        `composed-${String(index)}`,
        "00000000-0000-0000-0000-" + String(9 - index).padStart(12, "0"),
      ),
    );
    agents.push(pane("composed-presence", null));
    const gates = new Map<
        string | null | undefined,
        { resolve: () => void; reject: (error: Error) => void }
      >(),
      calls: (string | null | undefined)[] = [],
      helperGate = deferred();
    let active = 0,
      maximum = 0,
      edgeReads = 0,
      cleaning = false;
    const transcripts: HelperTranscripts & { retain(ids: Set<string>): void } = {
      retain() {},
      inspectChild: () => settled(() => ({ available: false })),
      bindChild: () => settled(() => null),
      claudeCandidates: () => settled(() => []),
      read: async (
        _id: string,
        _provider: ObserverInputRow["provider"],
        sessionId: string | null | undefined,
      ) => {
        if (cleaning) return { available: false };
        calls.push(sessionId);
        maximum = Math.max(maximum, ++active);
        try {
          await new Promise<void>((resolve, reject: (reason: unknown) => void) =>
            gates.set(sessionId, { resolve, reject }),
          );
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
        resolveMany: (rows) =>
          settled(() => rows.map((row) => ({ sessionId: nativeSession(row), source: "native" }))),
      },
      projects: {
        resolveMany: (rows) => settled(() => rows.map(() => ({ projectId: "fixture" }))),
      },
      execute: () => settled(() => ({ stdout: JSON.stringify({ result: { agents } }) })),
      desktop: { inventory: () => settled(() => ({ health: "available", windows: [] })) },
      bus: { read: () => settled(() => busFixture({ rows: [] })) },
    });
    function settleHelperGates(failedSession: string | null) {
      for (const [sessionId, gate] of gates) {
        if (sessionId === null) continue; // Presence-only summary cannot gate helper roots.
        if (sessionId === failedSession) gate.reject(Error("fixture failure"));
        else gate.resolve();
      }
    }
    try {
      const core = await observer.get();
      await new Promise<void>((resolve) => setImmediate(resolve));
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
          core.sessions.every((row) => !must(row.tool).available),
          "late results cannot mutate published core",
        );
      } else {
        must(gates.get(must(agents[0]).agent_session.value)).resolve();
        const partial = await inventoryWhen(
          observer,
          (data) => must(must(data.sessions[0]).tool).available,
        );
        assert.equal(
          must(must(partial.sessions[1]).tool).available,
          UNAVAILABLE_TOOL,
          "one summary publishes while other roots wait",
        );
        const failedSession = must(agents[4]).agent_session.value;
        // Reject an admitted summary: helper eligibility must reuse the unavailable
        // result rather than retrying it through a separate admission path.
        for (let attempt = 0; attempt < 1000 && edgeReads === 0; attempt++) {
          settleHelperGates(failedSession);
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
        assert.equal(
          edgeReads,
          1,
          "helper discovery starts before the unrelated presence summary settles",
        );
        assert.equal(active, 1, "presence-only summary remains held when helper work starts");
        const complete = await inventoryWhen(
          observer,
          (data) => data.sessions.filter((row) => must(row.tool).available).length === 8,
        );
        assert.equal(
          must(must(complete.sessions[4]).tool).available,
          UNAVAILABLE_TOOL,
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

  async function independentDesktop() {
    let clock = 1000,
      fail = false,
      desktopFail = false,
      rows: ObserverInputRow[] = [
        {
          provider: "claude",
          id: "obs_" + "a".repeat(24),
          inspectionIdentity: "window-a",
          source: "desktop",
          sessionId: null,
        },
      ],
      release: (() => void) | true | null | undefined;
    const retained: string[][] = [];
    const desktop = {
      inventory: () =>
        settled(() =>
          desktopFail
            ? { health: "unavailable", reason: "permission-denied", windows: [] }
            : { health: "available", reason: null, observedAt: clock, windows: rows },
        ),
      inspect: async () => {
        if (release)
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        return inspection({ health: "available", turns: [{ text: "old" }] });
      },
    };
    const observer = makeObserver({
      readIdentityConfiguration: () => settled(() => "unconfigured"),
      now: () => clock,
      desktop,
      projects: { resolve: () => settled(() => ({ projectId: "fixture" })) },
      bus: { read: () => busFixture({ health: "available", rows: [] }) },
      transcripts: {
        read: () => settled(() => ({ available: false })),
        retain: (ids) => retained.push([...ids]),
      },
      execute: () => {
        return settled(() => {
          if (fail) throw Error("private");
          return { stdout: JSON.stringify({ result: { agents: [pane("legacy")] } }) };
        });
      },
    });
    const first = await observer.get();
    assert.equal(first.sources.desktop.health, "available");
    assert.equal(first.sessions.length, 2);
    assert.deepEqual(retained.at(-1), [
      must(first.sessions.find((row) => row.source === "herdr")).id,
    ]);
    assert(
      retained.every((ids) => !ids.includes(must(rows[0]).id)),
      "desktop IDs never enter transcript cache",
    );
    clock = 4000;
    fail = true;
    const mixed = await observer.get();
    assert.equal(mixed.health, "available");
    assert.equal(mixed.sources.herdr.health, "unavailable");
    assert.equal(
      must(mixed.sessions.find((row) => row.source === "herdr")).inventoryHealth,
      "unavailable",
    );
    assert.equal(
      (await observer.inspect(must(rows[0]).id)).health,
      "available",
      "fresh Desktop survives Herdr failure",
    );
    release = true;
    const late = observer.inspect(must(rows[0]).id);
    await new Promise<void>((resolve) => setImmediate(resolve));
    clock = 7000;
    rows = [{ ...must(rows[0]), inspectionIdentity: "window-b" }];
    await observer.get();
    fixtureRelease(release);
    release = null;
    assert.equal((await late).reason, "identity-unavailable");
    clock = 10000;
    fail = false;
    desktopFail = true;
    const desktopStale = await observer.get();
    assert.equal(desktopStale.health, "available");
    assert.equal(desktopStale.sources.desktop.health, "unavailable");
    const staleRow = desktopStale.sessions.find((row) => row.source === "desktop");
    assert.equal(must(staleRow).observedAt, 7000);
    assert.equal(must(staleRow).inventoryHealth, "unavailable");
    assert.equal((await observer.inspect(must(staleRow).id)).reason, "inventory-unavailable");
  }

  async function coldBuildIndependence() {
    const temp = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), "observer-cold-build-")),
    );
    let release: (() => void) | true | null | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const compilerState = { began: false };

    const buildGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const desktop = makeDesktopObserver({
      now: () => 1000,
      platform: "darwin",
      cacheDir: temp,
      execute: async () => {
        compilerState.began = true;
        await buildGate;
        throw Error("fixture compiler unavailable");
      },
    });
    const observer = makeObserver({
      readIdentityConfiguration: () => settled(() => "unconfigured"),
      now: () => 1000,
      desktop,
      projects: { resolve: () => settled(() => ({ projectId: "fixture" })) },
      bus: { read: () => busFixture({ health: "available", rows: [] }) },
      transcripts: { read: () => settled(() => ({ available: false })), retain() {} },
      execute: () =>
        settled(() => ({ stdout: JSON.stringify({ result: { agents: [pane("legacy")] } }) })),
    });
    try {
      const snapshot = await Promise.race<Inventory>([
        observer.get(),
        new Promise((_, reject: (reason: unknown) => void) => {
          timer = setTimeout(() => {
            reject(Error("cold build held Herdr"));
          }, 500);
        }),
      ]);
      clearTimeout(timer);
      assert.equal(snapshot.health, "available");
      assert.equal(snapshot.sources.herdr.health, "available");
      assert.equal(snapshot.sources.desktop.reason, "native-reader-building");
      assert.equal(snapshot.sessions.length, 1);
      // The fake compiler reaches its gate before release and private fixture disposal.
      for (let attempt = 0; !compilerState.began && attempt < 100; attempt++)
        await new Promise<void>((resolve) => setTimeout(resolve, 5));
      assert(compilerState.began);
      fixtureRelease(release);
      for (let attempt = 0; attempt < 100; attempt++) {
        if ((await desktop.inventory()).reason !== "native-reader-building") break;
        await new Promise<void>((resolve) => setTimeout(resolve, 5));
      }
    } finally {
      clearTimeout(timer);
      fixtureRelease(release);
      await fs.rm(temp, { recursive: true, force: true });
    }
  }

  async function helperComposition() {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "starnet-helper-composition-"));
    try {
      const child = "00000000-0000-0000-0000-000000000002";
      let clock = 1000,
        inventory = [pane("root")],
        fail = false;
      const line = (value: unknown) => JSON.stringify(value) + "\n";
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
        readIdentityConfiguration: () => settled(() => "unconfigured"),
        now: () => clock,
        transcripts,
        helpers,
        desktop: { inventory: () => settled(() => ({ health: "unavailable", windows: [] })) },
        bus: { read: () => busFixture({ rows: [], health: "available" }) },
        projects: { resolve: () => settled(() => ({ projectId: "fixture" })) },
        execute: () => {
          return settled(() => {
            if (fail) throw new Error("unavailable");
            return { stdout: JSON.stringify({ result: { agents: inventory } }) };
          });
        },
      });
      let result = await observer.get();
      const helper = result.sessions.find((row) => row.source === "helper");
      assert(helper);
      assert.equal(must((await observer.inspect(helper.id)).turns[0]).text, "HELPER ONLY");
      clock += 3000;
      inventory.push({ ...pane("child", child), agent_status: "blocked" });
      result = await observer.get();
      assert.equal(result.sessions.length, 2);
      assert.equal(must(result.sessions[1]).parentId, must(result.sessions[0]).id);
      assert.equal(must(result.sessions[1]).status, "blocked");
      assert.equal(
        must((await observer.inspect(must(result.sessions[1]).id)).turns[0]).text,
        "HELPER ONLY",
      );
      clock += 3000;
      fail = true;
      result = await observer.get();
      assert.equal(
        must(result.sessions[1]).parentId,
        must(result.sessions[0]).id,
        "source outage preserves last-known grouping",
      );
      assert(result.sessions.every((row) => row.inventoryHealth === "unavailable"));
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
    const id = (number: number) => "00000000-0000-0000-0000-" + String(number).padStart(12, "0");

    const transcripts = {
      read: () => settled(() => ({ available: true })),
      retain() {},
      claudeCandidates: () => settled(() => []),
      bindChild: (
        provider: ObserverInputRow["provider"],
        sessionId: string,
        parentSessionId: string,
      ) =>
        settled(() => ({
          provider,
          sessionId,
          parentSessionId,
        })),
      inspectChild: () => settled(() => inspection({ available: true, turns: [] })),
    };
    for (const [existing, rootId] of [
      [false, id(1)],
      [true, id(1)],
      [true, id(12)],
    ] as const) {
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
        readIdentityConfiguration: () => settled(() => "unconfigured"),
        now: () => 1000,
        transcripts,
        helpers: makeHelperObserver({
          now: () => 1000,
          transcripts,
          readEdges: () => ({ rows: edges }),
        }),
        execute: () =>
          settled(() => ({ stdout: JSON.stringify({ result: { agents: inventory } }) })),
        projects: {
          resolve: (cwd) =>
            settled(() => ({
              projectId: fixtureString(cwd),
              project: fixtureString(cwd),
              projectKind: "repository-parent",
              repoId: fixtureString(cwd) + "-repo",
              repo: fixtureString(cwd) + " repo",
              checkoutId: fixtureString(cwd) + "-checkout",
              checkoutKind: "worktree",
              folder: "src",
              worktreeId: fixtureString(cwd) + "-worktree",
              worktree: fixtureString(cwd) + " worktree",
            })),
        },
        desktop: { inventory: () => settled(() => ({ health: "unavailable", windows: [] })) },
        bus: { read: () => busFixture({ rows: [], health: "available" }) },
      });
      const { sessions } = await observer.get();
      const parent = sessions.find((row) => row.sessionId === rootId),
        child = sessions.find((row) => row.sessionId === id(2));
      assert.equal(must(child).parentId, must(parent).id);
      assert.equal(must(child).helperOverflow, 1);
      assert.equal(must(child).source, existing ? "herdr" : "helper");
      assert.equal(must(child).status, existing ? "blocked" : "unknown");
      assert.equal(
        must(child).inspectionIdentity,
        existing ? "codex:" + id(2) : "helper:" + must(child).id,
      );
      const descendants = sessions.filter((row) => row.parentId === must(child).id);
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
        ] as const)
          assert.equal(must(row)[field], must(parent)[field], field + " inherits root grouping");
      }
    }
  }

  async function deepHelperOwnership() {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "starnet-deep-pane-"));
    try {
      const id = (number: number) => "00000000-0000-0000-0000-" + String(number).padStart(12, "0");
      const line = (value: unknown) => JSON.stringify(value) + "\n";
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
              payload: { type: "message", role: "assistant", content: `PANE ${String(number)}` },
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
        readIdentityConfiguration: () => settled(() => "unconfigured"),
        now: () => clock,
        transcripts,
        helpers: makeHelperObserver({
          now: () => clock,
          transcripts,
          readEdges: () => ({ rows: edges }),
        }),
        execute: () =>
          settled(() => ({ stdout: JSON.stringify({ result: { agents: inventory } }) })),
        projects: {
          resolve: (cwd) =>
            settled(() => ({
              projectId: fixtureString(cwd),
              repoId: fixtureString(cwd) + "-repo",
              worktreeId: fixtureString(cwd) + "-worktree",
            })),
        },
        desktop: { inventory: () => settled(() => ({ health: "unavailable", windows: [] })) },
        bus: { read: () => busFixture({ rows: [], health: "available" }) },
      });
      let result = await observer.get();
      let deep = result.sessions.find((row) => row.sessionId === id(6));
      assert.equal(result.sessions.length, 5);
      assert.equal(must(deep).parentId, undefined);
      assert.equal(must(deep).projectId, "parent");
      assert.equal(must(deep).repoId, "parent-repo");
      assert.equal(must(deep).worktreeId, "parent-worktree");
      assert.equal(must(deep).source, "herdr");
      assert.equal(must(deep).status, "blocked");
      assert.equal(must(deep).inspectionIdentity, "codex:" + id(6));
      assert.equal(must((await observer.inspect(must(deep).id)).turns[0]).text, "PANE 6");
      clock += 3000;
      inventory = inventory.slice(1);
      result = await observer.get();
      deep = result.sessions.find((row) => row.sessionId === id(6));
      assert.equal(must(deep).projectId, "deep");
      assert.equal(must(deep).repoId, "deep-repo");
      const independent = result.sessions.find((row) => row.sessionId === id(7));
      assert.equal(must(independent).parentId, must(deep).id);
      assert.equal(must(independent).projectId, "deep");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }

  async function cappedHelperOwnership() {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "starnet-capped-pane-"));
    try {
      const id = (number: number) => "00000000-0000-0000-0000-" + String(number).padStart(12, "0");
      const line = (value: unknown) => JSON.stringify(value) + "\n";
      const content = (number: number, parent = id(1)) =>
        line({
          type: "session_meta",
          payload: {
            id: id(number),
            ...(number > 1 ? { parent_thread_id: parent } : {}),
          },
        }) +
        line({
          type: "response_item",
          payload: { type: "message", role: "assistant", content: `PANE ${String(number)}` },
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
        readIdentityConfiguration: () => settled(() => "unconfigured"),
        now: () => clock,
        transcripts,
        helpers: makeHelperObserver({
          now: () => clock,
          transcripts,
          readEdges: () => ({ rows: edges }),
        }),
        execute: () =>
          settled(() => ({ stdout: JSON.stringify({ result: { agents: inventory } }) })),
        projects: {
          resolve: (cwd) =>
            settled(() => ({
              projectId: fixtureString(cwd),
              repoId: fixtureString(cwd) + "-repo",
              worktreeId: fixtureString(cwd) + "-worktree",
            })),
        },
        desktop: { inventory: () => settled(() => ({ health: "unavailable", windows: [] })) },
        bus: { read: () => busFixture({ rows: [], health: "available" }) },
      });
      let result = await observer.get();
      const parent = result.sessions.find((row) => row.sessionId === id(1));
      const boundary = result.sessions.find((row) => row.sessionId === id(65));
      let omitted = result.sessions.find((row) => row.sessionId === id(66));
      assert.equal(result.sessions.length, 66);
      assert.equal(must(parent).helperOverflow, 57);
      assert.equal(must(boundary).parentId, must(parent).id, "64th binding remains represented");
      assert.equal(must(omitted).parentId, undefined, "65th child has grouping only");
      for (const row of [boundary, omitted]) {
        assert.equal(must(row).projectId, "parent");
        assert.equal(must(row).repoId, "parent-repo");
        assert.equal(must(row).worktreeId, "parent-worktree");
        assert.equal(must(row).source, "herdr");
        assert.equal(must(row).status, "blocked");
        assert.equal(must(row).inspectionIdentity, "codex:" + fixtureString(must(row).sessionId));
        assert.equal(
          must((await observer.inspect(must(row).id)).turns[0]).text,
          row === boundary ? "PANE 65" : "PANE 66",
        );
      }
      // Losing exact lineage proof restores the authoritative pane's own room and inspection.
      await fs.writeFile(path.join(root, id(66) + ".jsonl"), content(66, id(99)));
      clock += 3000;
      result = await observer.get();
      omitted = result.sessions.find((row) => row.sessionId === id(66));
      assert.equal(must(omitted).projectId, "omitted");
      assert.equal(must(omitted).parentId, undefined);
      assert.equal(must(omitted).status, "blocked");
      assert.equal(must(omitted).inspectionIdentity, "codex:" + id(66));
      assert.equal(must((await observer.inspect(must(omitted).id)).turns[0]).text, "PANE 66");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }

  // The browser retains A during inspection-driven server inventory refresh to B.
  async function exactTargetInspection() {
    const secondSession = "00000000-0000-0000-0000-000000000002";
    const desktopId = "obs_" + "d".repeat(24),
      helperId = "obs_" + "e".repeat(24);
    let clock = 1000,
      selectedSession = ID,
      parentIndex = 0,
      inventoryReads = 0,
      bodyReads = 0,
      release: (() => void) | true | null | undefined = null;
    let desktopIdentity = desktopId,
      desktopHealth = "available",
      herdrHealth = "available",
      provider = "codex",
      bodyHealth: "available" | "unavailable" = "available";
    const inspectBody = async () => {
      bodyReads++;
      if (release)
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      return inspection({
        available: true,
        health: bodyHealth,
        turns: [{ text: "SELECTED BODY" }],
        inspectionIdentity: "UNTRUSTED ADAPTER PROOF",
      });
    };
    const observer = makeObserver({
      readIdentityConfiguration: () => settled(() => "unconfigured"),
      now: () => clock,
      endpoint: "exact-target-fixture",
      projects: { resolve: () => settled(() => ({ projectId: "fixture" })) },
      bus: { read: () => busFixture({ rows: [], health: "available" }) },
      execute: () => {
        return settled(() => {
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
        });
      },
      transcripts: {
        read: () => settled(() => ({ available: false })),
        retain() {},
        inspect: inspectBody,
      },
      desktop: {
        inventory: () =>
          settled(() => ({
            health: desktopHealth,
            windows: [{ id: desktopId, provider: "claude", inspectionIdentity: desktopIdentity }],
          })),
        inspect: inspectBody,
      },
      helpers: {
        children: (parents) =>
          settled(() => ({
            rows: [
              {
                id: helperId,
                source: "helper",
                provider: "codex",
                inspectionIdentity: "helper:" + helperId,
                parentId: must(parents[parentIndex]).id,
                inventoryHealth: "available",
              },
            ],
            annotations: new Map<string, Partial<ObserverInputRow>>([
              [must(parents[2]).id, { parentId: must(parents[parentIndex]).id }],
            ]),
            overflow: new Map<string, number>(),
          })),
        inspect: inspectBody,
      },
    });
    const initial = await observer.get(),
      selected = initial.sessions[2];
    const parentA = must(initial.sessions[0]).id,
      parentB = must(initial.sessions[1]).id;
    const expectedA = "codex:" + ID + "|" + parentA;
    const assertWithdrawn = (
      result: Awaited<ReturnType<ReturnType<typeof makeNativeObserver>["inspect"]>>,
      reason: string,
    ) => {
      assert.equal(result.health, "unavailable");
      assert.equal(result.reason, reason);
      assert.deepEqual(result.turns, []);
      assert.equal(result.inspectionIdentity, undefined);
      assert(!JSON.stringify(result).includes("SELECTED BODY"));
    };
    for (const malformed of ["", null, 12, [], "bad", "codex:" + ID + "|", "x".repeat(129)])
      assertWithdrawn(await observer.inspect(must(selected).id, malformed), "invalid-identity");
    assert.equal(inventoryReads, 1, "malformed backend callers trigger no refresh or content read");
    assert.equal(bodyReads, 0);
    assert.equal(
      (await observer.inspect(must(selected).id, expectedA)).inspectionIdentity,
      expectedA,
      "Herdr helper proof includes parent, overriding adapter data",
    );
    const beforeReplacement = bodyReads;
    selectedSession = secondSession;
    clock += 3000;
    assertWithdrawn(await observer.inspect(must(selected).id, expectedA), "identity-mismatch");
    assert.equal(
      bodyReads,
      beforeReplacement,
      "server discovers B before browser roster A: no selected body read",
    );
    const expectedB = "codex:" + secondSession + "|" + parentA;
    assert.equal(
      (await observer.inspect(must(selected).id, expectedB)).inspectionIdentity,
      expectedB,
    );
    assert.equal(
      (await observer.inspect(must(selected).id)).inspectionIdentity,
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
    assertWithdrawn(await observer.inspect(must(selected).id, expectedB), "identity-mismatch");
    assert.equal(bodyReads, beforeReparent, "reparented helpers never read against old parent");
    const reparented = "codex:" + secondSession + "|" + parentB;
    release = true;
    const pending = observer.inspect(must(selected).id, reparented);
    await new Promise<void>((resolve) => setImmediate(resolve));
    parentIndex = 0;
    clock += 3000;
    await observer.get();
    fixtureRelease(release);
    release = null;
    assertWithdrawn(await pending, "identity-mismatch");
    release = true;
    const helperPending = observer.inspect(helperId, helperExpected);
    await new Promise<void>((resolve) => setImmediate(resolve));
    parentIndex = 1;
    clock += 3000;
    await observer.get();
    fixtureRelease(release);
    release = null;
    assertWithdrawn(await helperPending, "identity-mismatch");
    // Desktop proof is its opaque native window identity, never a transcript session.
    assert.equal((await observer.inspect(desktopId, desktopId)).inspectionIdentity, desktopId);
    release = true;
    const replacedDesktopPending = observer.inspect(desktopId, desktopId);
    await new Promise<void>((resolve) => setImmediate(resolve));
    desktopIdentity = "obs_" + "f".repeat(24);
    clock += 3000;
    await observer.get();
    fixtureRelease(release);
    release = null;
    assertWithdrawn(await replacedDesktopPending, "identity-mismatch");
    const beforeDesktopReplacement = bodyReads;
    assertWithdrawn(await observer.inspect(desktopId, desktopId), "identity-mismatch");
    assert.equal(bodyReads, beforeDesktopReplacement);
    release = true;
    const desktopPending = observer.inspect(desktopId, desktopIdentity);
    await new Promise<void>((resolve) => setImmediate(resolve));
    desktopHealth = "unavailable";
    clock += 3000;
    await observer.get();
    fixtureRelease(release);
    release = null;
    assertWithdrawn(await desktopPending, "inventory-unavailable");
    // Fresh ordinary panes retain provider/session proof without a helper parent.
    const ordinary = initial.sessions[0];
    assert.equal(
      (await observer.inspect(must(ordinary).id, "codex:" + ID)).inspectionIdentity,
      "codex:" + ID,
    );
    bodyHealth = "unavailable";
    assertWithdrawn(
      await observer.inspect(must(ordinary).id, "codex:" + ID),
      "transcript-unavailable",
    );
    bodyHealth = "available";
    release = true;
    const providerPending = observer.inspect(must(ordinary).id, "codex:" + ID);
    await new Promise<void>((resolve) => setImmediate(resolve));
    provider = "claude";
    clock += 3000;
    await observer.get();
    fixtureRelease(release);
    release = null;
    assertWithdrawn(await providerPending, "identity-mismatch");
    provider = "codex";
    clock += 3000;
    await observer.get();
    release = true;
    const ordinaryPending = observer.inspect(must(ordinary).id, "codex:" + ID);
    await new Promise<void>((resolve) => setImmediate(resolve));
    selectedSession = ID;
    herdrHealth = "unavailable";
    clock += 3000;
    await observer.get();
    fixtureRelease(release);
    release = null;
    assertWithdrawn(await ordinaryPending, "inventory-unavailable");
  }

  async function footerInspection() {
    let clock = 1000,
      displayed = ID,
      terminal = "term_original",
      revision = 1,
      sequence = 8,
      startSeconds = 1,
      birthCalls = 0,
      readCalls = 0,
      detailCalls = 0,
      release: (() => void) | true | null | undefined = null;
    const original = { ...pane("footer"), terminal_id: terminal, revision };
    const resolver = makeIdentityResolver({
      now: () => clock,
      readConfiguration: () => settled(() => "configured"),
      readProcessBirth: (pid) =>
        settled(() => {
          birthCalls++;
          return { pid, startSeconds, startMicroseconds: 0 };
        }),
      rpc: (method, params) => {
        return settled(() => {
          // First complete capture conflicts after the bracketed footer read.
          const native = nativeIdentityResult(
            method,
            params,
            {
              ...original,
              terminal_id: terminal,
            },
            sequence,
          );
          if (native) return native;
          if (method === "agent.get")
            return { result: { agent: { ...original, terminal_id: terminal, revision } } };
          readCalls++;
          if (readCalls === 2) sequence = 10;
          return {
            result: {
              read: {
                pane_id: "footer",
                source: "recent",
                format: "text",
                revision: 0,
                truncated: true,
                text:
                  "\n  " +
                  displayed +
                  " · model\n  New activity · enter/esc latest · ? shortcuts\n",
              },
            },
          };
        });
      },
    });
    const helperId = "obs_" + "f".repeat(24),
      helperIdentity = "helper:" + helperId;
    const observer = makeObserver({
      now: () => clock,
      identities: resolver,
      endpoint: "footer-race-fixture",
      execute: () =>
        settled(() => ({ stdout: JSON.stringify({ result: { agents: [original] } }) })),
      projects: { resolve: () => settled(() => ({ projectId: "fixture" })) },
      bus: { read: () => busFixture({ rows: [], health: "available" }) },
      desktop: { inventory: () => settled(() => ({ health: "unavailable", windows: [] })) },
      transcripts: {
        read: (_id, _provider, session) => settled(() => ({ available: !!session })),
        retain() {},
        inspect: async () => {
          detailCalls++;
          if (release)
            await new Promise<void>((resolve) => {
              release = resolve;
            });
          return inspection({
            available: true,
            health: "available",
            turns: [{ text: "PRIVATE OLD BODY" }],
            stats: { totalTokens: 42 },
          });
        },
      },
      helpers: {
        children: (parents) =>
          settled(() => ({
            rows: [
              {
                id: helperId,
                provider: "codex",
                source: "helper",
                inventoryHealth: "available",
                parentId: must(parents[0]).id,
                inspectionIdentity: helperIdentity,
              },
            ],
            annotations: new Map<string, Partial<ObserverInputRow>>(),
            overflow: new Map<string, number>(),
          })),
        inspect: async () => {
          detailCalls++;
          if (release)
            await new Promise<void>((resolve) => {
              release = resolve;
            });
          return inspection({
            available: true,
            health: "available",
            turns: [{ text: "PRIVATE HELPER BODY" }],
          });
        },
      },
    });
    const first = await observer.get(),
      root = first.sessions[0];
    assert.equal(must(root).identitySource, "footer");
    assert.equal(must(root).identityHealth, "available");
    assert.equal(readCalls, 4, "initial content conflict retries one complete capture");
    assert.equal(birthCalls, 4, "both failed and successful captures use fresh births");
    assert(
      !JSON.stringify(first).includes("term_original"),
      "terminal incarnation proof stays private",
    );
    const captured = readCalls;
    await observer.get();
    assert.equal(readCalls, captured, "footer capture shares cached refresh");
    revision++;
    const birthsBeforeInspection = birthCalls;
    assert.equal(
      (await observer.inspect(must(root).id)).health,
      "available",
      "normal output revision changes do not invalidate same current footer",
    );
    assert.equal(readCalls, captured + 4, "selected read revalidates footer before and after");
    assert.equal(
      birthCalls,
      birthsBeforeInspection + 4,
      "both inspector validations query both births freshly",
    );
    displayed = "00000000-0000-0000-0000-000000000002";
    const before = detailCalls;
    const reject = (
      result: Awaited<ReturnType<ReturnType<typeof makeNativeObserver>["inspect"]>>,
    ) => {
      assert.equal(result.health, "unavailable");
      assert.deepEqual(result.turns, []);
      assert(!JSON.stringify(result).includes("PRIVATE"));
      assert(
        Object.values(result.stats).every(
          (metric) => metric.value === null && metric.state === "unavailable",
        ),
      );
    };
    reject(await observer.inspect(must(root).id));
    reject(await observer.inspect(helperId));
    assert.equal(
      detailCalls,
      before,
      "cached inventory cannot authorize old root or helper content after in-TUI switch",
    );
    displayed = ID;
    for (const kind of ["session", "terminal", "birth"])
      for (const target of [must(root).id, helperId]) {
        release = true;
        const pending = observer.inspect(target);
        await new Promise<void>((resolve) => setImmediate(resolve));
        if (kind === "session") displayed = "00000000-0000-0000-0000-000000000002";
        else if (kind === "terminal") terminal = "term_replaced";
        else startSeconds = 2;
        fixtureRelease(release);
        release = null;
        reject(await pending);
        displayed = ID;
        terminal = "term_original";
        startSeconds = 1;
      }
    terminal = "term_replaced";
    reject(await observer.inspect(must(root).id));
    clock += 3000;
    const withdrawn = await observer.get();
    assert.equal(must(withdrawn.sessions[0]).sessionId, null);
    assert.equal(must(withdrawn.sessions[0]).identityHealth, "unavailable");
  }

  async function footerFinalValidationRace() {
    for (const kind of ["thread", "terminal", "birth"]) {
      let clock = 1000,
        session = ID,
        terminal = "term_original",
        birth = 1,
        validations = 0,
        release: (() => void) | true | null | undefined;
      const observer = makeObserver({
        now: () => clock,
        identities: {
          resolve: () =>
            settled(() => ({
              sessionId: session,
              source: "footer",
              proof: {
                paneId: "final-race",
                provider: "codex",
                contentRevision: 1,
                observedAt: clock,
                terminalId: terminal,
                sessionId: session,
                birth: { pid: 41, startSeconds: birth, startMicroseconds: 0 },
              },
            })),
          revalidate: async () => {
            if (++validations === 2)
              await new Promise<void>((resolve) => {
                release = resolve;
              });
            return true;
          },
        },
        execute: () =>
          settled(() => ({
            stdout: JSON.stringify({ result: { agents: [pane("final-race", session)] } }),
          })),
        projects: { resolve: () => settled(() => ({ projectId: "fixture" })) },
        bus: { read: () => busFixture({ rows: [], health: "available" }) },
        desktop: { inventory: () => settled(() => ({ health: "unavailable", windows: [] })) },
        transcripts: {
          read: () => settled(() => ({ available: true })),
          retain() {},
          inspect: () =>
            settled(() =>
              inspection({
                available: true,
                health: "available",
                turns: [{ text: "FINAL RACE CANARY" }],
              }),
            ),
        },
      });
      const first = await observer.get();
      const pending = observer.inspect(must(first.sessions[0]).id);
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.equal(typeof release, "function");
      clock += 3000;
      if (kind === "thread") session = "00000000-0000-0000-0000-000000000002";
      else if (kind === "terminal") terminal = "term_replacement";
      else birth = 2;
      await observer.get();
      fixtureRelease(release);
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
    for (const helper of [false, true]) {
      const terminal = "term_original";
      let sequence = 8,
        contentRead = false,
        configurationAfterRead = 0,
        release: (() => void) | true | null | undefined,
        inventoryReads = 0;
      let reachedConfiguration: (() => void) | undefined;
      const blocked = new Promise<void>((resolve) => {
        reachedConfiguration = resolve;
      });
      const original = { ...pane("configuration-race"), terminal_id: terminal, revision: 1 };
      const resolver = makeIdentityResolver({
        now: () => 1000,
        readProcessBirth: (pid) => settled(() => ({ pid, startSeconds: 1, startMicroseconds: 0 })),
        readConfiguration: async () => {
          // Pause the final configuration verification after selected content has been read.
          if (contentRead && ++configurationAfterRead === 1) {
            must(reachedConfiguration)();
            await new Promise<void>((resolve) => {
              release = resolve;
            });
          }
          if (contentRead) sequence += 2;
          return "configured";
        },
        rpc: (method, params) => {
          return settled(() => {
            const native = nativeIdentityResult(method, params, original, sequence);
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
          });
        },
      });
      const helperId = "obs_" + "e".repeat(24);
      const inspectBody = () => {
        return settled(() => {
          contentRead = true;
          return inspection({
            available: true,
            health: "available",
            turns: [{ text: "CONFIGURATION RACE CANARY" }],
            stats: { totalTokens: 42 },
          });
        });
      };
      const observer = makeObserver({
        now: () => 1000,
        identities: resolver,
        execute: () => {
          return settled(() => {
            inventoryReads++;
            return { stdout: JSON.stringify({ result: { agents: [original] } }) };
          });
        },
        projects: { resolve: () => settled(() => ({ projectId: "fixture" })) },
        bus: { read: () => busFixture({ rows: [], health: "available" }) },
        desktop: { inventory: () => settled(() => ({ health: "unavailable", windows: [] })) },
        transcripts: {
          read: () => settled(() => ({ available: true })),
          retain() {},
          inspect: inspectBody,
        },
        helpers: {
          children: (parents) =>
            settled(() => ({
              rows: [
                {
                  id: helperId,
                  provider: "codex",
                  source: "helper",
                  inventoryHealth: "available",
                  parentId: must(parents[0]).id,
                  inspectionIdentity: "helper:" + helperId,
                },
              ],
              annotations: new Map<string, Partial<ObserverInputRow>>(),
              overflow: new Map<string, number>(),
            })),
          inspect: inspectBody,
        },
      });
      const first = await observer.get();
      const pending = observer.inspect(helper ? helperId : must(first.sessions[0]).id);
      await blocked;
      sequence = 10;
      fixtureRelease(release);
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
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), "observer-stalled-endpoint-"));
    const endpoint = path.join(folder, "native.sock");
    const sockets = new Set<net.Socket>();
    let requests = 0,
      responsive = false,
      inventoryReads = 0;
    const agents: Record<string, unknown>[] = Array.from({ length: 4 }, (_, index) => ({
      ...pane(`stalled-${String(index)}`),
      terminal_id: `term_${String(index)}`,
      revision: 1,
    }));
    agents.push({
      ...pane("native-claude"),
      agent: "claude",
      agent_session: { agent: "claude", kind: "id", value: ID },
    });
    function readFixtureRequest(data: Buffer) {
      const request: unknown = JSON.parse(data.toString());
      assert(
        request &&
          typeof request === "object" &&
          "method" in request &&
          "params" in request &&
          "id" in request,
      );
      assert(typeof request.method === "string");
      const params = request.params;
      assert(params && typeof params === "object" && !Array.isArray(params));
      const parameters: Record<string, unknown> = { ...params };
      return { request: { method: request.method, id: request.id }, parameters };
    }
    const server = net.createServer((connection) => {
      sockets.add(connection);
      connection.on("error", () => {});
      connection.on("close", () => sockets.delete(connection));
      connection.once("data", (data) => {
        requests++;
        if (!responsive) return;
        const { request, parameters } = readFixtureRequest(data);
        const result =
          nativeIdentityResult(
            request.method,
            parameters,
            agents.find((agent) => agent.pane_id === parameters.pane_id) || {},
          )?.result ||
          (request.method === "agent.get"
            ? { agent: agents.find((agent) => agent.pane_id === parameters.target) }
            : {
                read: {
                  pane_id: parameters.pane_id,
                  source: "recent",
                  format: "text",
                  text: "\n  " + ID + " · model\n  ? for shortcuts\n",
                },
              });
        connection.end(JSON.stringify({ id: request.id, result }) + "\n");
      });
    });
    try {
      await new Promise<void>((resolve) => server.listen(endpoint, resolve));
      let clock = 1000;
      const observer = makeObserver({
        now: () => clock,
        endpoint,
        readIdentityConfiguration: () => settled(() => "configured"),
        readProcessBirth: (pid) => settled(() => ({ pid, startSeconds: 1, startMicroseconds: 0 })),
        execute: () => {
          return settled(() => {
            inventoryReads++;
            return { stdout: JSON.stringify({ result: { agents } }) };
          });
        },
        projects: { resolve: () => settled(() => ({ projectId: "fixture" })) },
        bus: { read: () => busFixture({ rows: [], health: "available" }) },
        transcripts: {
          read: (_id, _provider, session) => settled(() => ({ available: !!session })),
          retain() {},
        },
        desktop: {
          inventory: () =>
            settled(() => ({
              health: "available",
              windows: [{ id: "obs_" + "d".repeat(24), provider: "claude" }],
            })),
        },
      });
      const start = performance.now();
      const first = observer.get();
      assert.equal(observer.get(), first, "stalled readers share one refresh");
      const result = await first,
        elapsed = performance.now() - start;
      assert(
        elapsed < 3000,
        `shared footer timeout must not accumulate per pane: ${String(Math.round(elapsed))}ms`,
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
      assert.equal(must(result.sessions[4]).identitySource, "native");
      assert.equal(result.sources.desktop.health, "available");
      // Server-side EOF can arrive after the client promise settles; bound that cleanup observation.
      const cleanupUntil = performance.now() + 500;
      while (sockets.size > 0 && performance.now() < cleanupUntil)
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
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
          String(Math.round(elapsed)) +
          "ms, one timed-out request, socket closed, retry recovered",
      );
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) =>
        server.close(() => {
          resolve();
        }),
      );
      await fs.rm(folder, { recursive: true, force: true });
    }
  }

  // Real transcript lineage can involve independent footer runtimes. Neither the
  // observed child nor its synthetic descendant has a supported atomic proofset.
  async function footerAncestryProofSet() {
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
          path.join(folder, fixtureString(session) + ".jsonl"),
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
          readEdges: () =>
            settled(() => ({
              rows: [
                { parent_thread_id: ID, child_thread_id: child, status: "open" },
                { parent_thread_id: child, child_thread_id: descendant, status: "open" },
              ],
            })),
        });
        const resolver = makeIdentityResolver({
          now,
          readConfiguration: () => settled(() => "configured"),
          readProcessBirth: (pid) =>
            settled(() => ({ pid, startSeconds: 1, startMicroseconds: 0 })),
          rpc: (method, params) => {
            return settled(() => {
              const agent = agents.find(
                (agent) => agent.pane_id === (params.target || params.pane_id),
              );
              const native = nativeIdentityResult(method, params, agent || {});
              if (native) return native;
              if (method === "agent.get") return { result: { agent: { ...agent } } };
              assert.equal(method, "pane.read");
              return {
                result: {
                  read: {
                    pane_id: must(agent).pane_id,
                    source: "recent",
                    format: "text",
                    text:
                      "\n  " +
                      fixtureString(must(agent).agent_session.value) +
                      " · model\n  ? for shortcuts\n",
                  },
                },
              };
            });
          },
        });
        const observer = makeObserver({
          now,
          identities: resolver,
          transcripts,
          helpers,
          execute: () => {
            return settled(() => {
              inventoryReads++;
              return { stdout: JSON.stringify({ result: { agents } }) };
            });
          },
          projects: { resolve: () => settled(() => ({ projectId: "fixture" })) },
          bus: { read: () => busFixture({ rows: [], health: "available" }) },
          desktop: { inventory: () => settled(() => ({ health: "unavailable", windows: [] })) },
        });
        const inventory = await observer.get();
        const parentRow = inventory.sessions.find((row) => row.paneId === must(agents[0]).pane_id);
        const childRow = inventory.sessions.find((row) => row.paneId === must(agents[1]).pane_id);
        assert.equal(
          must(childRow).parentId,
          must(parentRow).id,
          "real helper module annotates observed pane",
        );
        assert.equal(must(childRow).identitySource, "footer");
        assert.equal(must(parentRow).identitySource, "footer");
        const row =
          target === "observed"
            ? childRow
            : inventory.sessions.find((row) => row.sessionId === descendant);
        assert.equal(
          must(row).parentId,
          target === "observed" ? must(parentRow).id : must(childRow).id,
        );
        const result = await observer.inspect(
          must(row).id,
          fixtureString(must(row).inspectionIdentity) + "|" + fixtureString(must(row).parentId),
        );
        assert.equal(inventoryReads, 1, "proof-set race has no roster refresh");
        assert.equal(
          detailRead,
          NO_DETAIL_READ,
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
  function nativeIdentityResult(
    method: string,
    params: Record<string, unknown>,
    agent: Record<string, unknown>,
    sequence = 8,
  ) {
    if (method === "pane.get")
      return {
        result: {
          pane: {
            ...agent,
            scroll: { max_offset_from_bottom: 0, viewport_rows: 20 },
          },
        },
      };
    if (method === "pane.process_info")
      return { result: { process_info: { pane_id: params.pane_id, shell_pid: 41 } } };
    if (method === "pane.copy_motion") {
      if (params.content_revision !== undefined && params.content_revision !== sequence)
        throw Object.assign(Error("Live footer changed during capture"), {
          code: CONTENT_CHANGED_CODE,
        });
      return { result: { pane_id: params.pane_id, content_revision: sequence } };
    }
    return null;
  }

  async function usageAggregate() {
    const second = "00000000-0000-0000-0000-000000000002";
    const wrapper = (value: number | null, state = "available") => ({
      value,
      state: value === null ? "unavailable" : state,
    });
    const usage = (value: number | null, state = "available") =>
      usageFixture({
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
        resolve: (row) => settled(() => ({ sessionId: nativeSession(row), source: "herdr" })),
      },
      projects: { resolve: () => settled(() => ({})) },
      bus: { read: () => busFixture({ rows: [] }) },
      execute: () => {
        return settled(() => {
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
        });
      },
      transcripts: {
        read: () => {
          return settled(() => {
            reads++;
            return { available: true, last: null, usage: usage(10) };
          });
        },
        retain() {},
      },
      desktop: {
        inventory: () =>
          settled(() => ({
            health: "available",
            observedAt: clock,
            windows: [
              {
                provider: "claude",
                id: "desktop",
                sessionId: null,
                status: "idle",
                presence: "window",
              },
            ],
          })),
      },
      helpers: {
        children: (parents) =>
          settled(() => ({
            annotations: new Map<string, Partial<ObserverInputRow>>(),
            overflow: new Map<string, number>(),
            rows: [
              {
                id: helperA,
                provider: "claude",
                sessionId: "same-child",
                parentId: must(parents[0]).id,
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
                parentId: must(parents[1]).id,
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
                parentId: must(parents[0]).id,
                source: "helper",
                presence: "verified-lineage",
                inspectionIdentity: "helper:" + helperA,
                inventoryHealth: "unavailable",
                observedAt: 999999,
                status: "unknown",
                usage: usage(999),
              },
            ],
          })),
      },
    });
    const first = await observer.get();
    assert.deepEqual(must(must(first.sessions[0]).usage).inputTokens, wrapper(10));
    assert.deepEqual(first.aggregate.agents, {
      observed: 5,
      verifiedSessions: 4,
      presenceOnly: 1,
      statuses: { working: 2, blocked: 1, idle: 1, done: 1, unknown: 0 },
      stale: 0,
    });
    assert.deepEqual(first.aggregate.usage.inputTokens, wrapper(30, "partial"));
    assert.deepEqual(first.aggregate.usage.outputTokens, wrapper(null));
    const { aggregate: firstAggregate } = first;
    assert.deepEqual(firstAggregate.coverage.counters.inputTokens, {
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
    const { aggregate: conflictingAggregate } = conflicting;
    assert.equal(
      conflictingAggregate.usage.inputTokens.value,
      20,
      "conflicting duplicates excluded once from every count",
    );
    clock += 3000;
    fail = true;
    const stale = await observer.get();
    assert.equal(stale.aggregate.coverage.stale, 4);
    const { aggregate: staleAggregate } = stale;
    assert.equal(
      staleAggregate.usage.inputTokens.value,
      null,
      "unavailable ancestor makes helper values stale too",
    );
    assert.equal(staleAggregate.agents.statuses.working, 0);
  }

  async function aggregateAgeAndOverflow() {
    let clock = 1000,
      overflow = false;
    const second = "00000000-0000-0000-0000-000000000002";
    const observer = makeObserver({
      now: () => clock,
      identities: {
        resolve: (row) => settled(() => ({ sessionId: nativeSession(row), source: "herdr" })),
      },
      execute: () =>
        settled(() => ({
          stdout: JSON.stringify({ result: { agents: [pane("a"), pane("b", second)] } }),
        })),
      projects: { resolve: () => settled(() => ({})) },
      bus: { read: () => busFixture({ rows: [] }) },
      helpers: {
        children: () =>
          settled(() => ({
            rows: [],
            annotations: new Map<string, Partial<ObserverInputRow>>(),
            overflow: new Map<string, number>(),
          })),
      },
      transcripts: {
        retain() {},
        read: () =>
          settled(() => ({
            available: true,
            usage: usageFixture({
              inputTokens: { value: overflow ? Number.MAX_SAFE_INTEGER : 10, state: "available" },
              outputTokens: { value: 1, state: "available" },
              cacheReadTokens: { value: 0, state: "available" },
              cacheWriteTokens: { value: 0, state: "available" },
            }),
          })),
      },
      desktop: {
        inventory: () => {
          return settled(() => {
            return {
              health: "available",
              observedAt: clock,
              windows: [{ provider: "claude", id: "app", status: "idle" }],
            };
          });
        },
      },
    });
    let result = await observer.get();
    const { aggregate: initialAggregate } = result;
    assert.equal(initialAggregate.usage.inputTokens.value, 20);
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
      firstId: string | undefined;
    const child = "obs_" + "e".repeat(24);
    const usage = (value: number, observedAt: number) =>
      usageFixture({
        inputTokens: { value, state: "available" },
        observedAt,
      });
    const observer = makeObserver(
      progressiveOptions({
        now: () => clock,
        execute: () =>
          settled(() => ({
            stdout: JSON.stringify({ result: { agents: [pane("old"), pane("fresh")] } }),
          })),
        transcripts: {
          retain() {},
          read: (id) => {
            return settled(() => {
              firstId ??= id;
              return {
                available: true,
                last: lastFixture({ name: "Read", phase: "started" }),
                usage: usage(id === firstId ? 999 : 42, id === firstId && !conflict ? 1000 : clock),
              };
            });
          },
        },
        helpers: {
          prepareChildren: (parents) =>
            settled(() => ({
              annotations: new Map<string, Partial<ObserverInputRow>>(),
              overflow: new Map<string, number>(),
              rows: [
                {
                  id: child,
                  provider: "claude",
                  sessionId: "child",
                  source: "helper",
                  presence: "verified-lineage",
                  inspectionIdentity: "helper:" + child,
                  parentId: must(parents[0]).id,
                  status: "working",
                  inventoryHealth: "available",
                  observedAt: clock,
                  usage: usage(777, 1000),
                },
              ],
            })),
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
      const { aggregate: resultAggregate } = result;
      assert.equal(
        resultAggregate.agents.statuses.working,
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
      const {
        counters: { inputTokens: resultInputCoverage },
      } = result.aggregate.coverage;
      assert.equal(resultInputCoverage.stale, 1);
      assert.equal(
        must(must(result.sessions.find((row) => row.id === firstId)).tool).available,
        UNAVAILABLE_TOOL,
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
      const { aggregate: conflictingAggregate } = conflicting;
      assert.equal(conflictingAggregate.usage.inputTokens.value, null);
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
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), "starnet-claude-namespaces-"));
    try {
      const second = "00000000-0000-0000-0000-000000000002";
      for (const [session, tokens] of [
        [ID, 3],
        [second, 7],
      ] as const) {
        await fs.writeFile(
          path.join(folder, fixtureString(session) + ".jsonl"),
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
          resolve: (row) => settled(() => ({ sessionId: nativeSession(row), source: "herdr" })),
        },
        execute: () =>
          settled(() => ({
            stdout: JSON.stringify({
              result: {
                agents: [
                  { ...pane("a"), agent: "claude" },
                  { ...pane("b", second), agent: "claude" },
                ],
              },
            }),
          })),
        projects: { resolve: () => settled(() => ({})) },
        bus: { read: () => busFixture({ rows: [] }) },
        desktop: { inventory: () => settled(() => ({ health: "unavailable", windows: [] })) },
      });
      const result = await observer.get(),
        children = result.sessions.filter((row) => row.source === "helper");
      assert.equal(children.length, 2);
      assert.notEqual(must(children[0]).id, must(children[1]).id);
      assert.equal(
        result.aggregate.agents.verifiedSessions,
        4,
        "real binding IDs separate equal agent IDs under two canonical roots",
      );
      const stats = await Promise.all(children.map((row) => observer.inspect(row.id)));
      assert.deepEqual(
        stats.map((value) => value.stats.inputTokens.value).sort((a, b) => must(a) - must(b)),
        [3, 7],
      );
      assert.deepEqual(
        result.aggregate.usage.inputTokens,
        { value: 10, state: "partial" },
        "own bound helper usage reaches totals before inspection",
      );
      const {
        counters: { inputTokens: availableInputCoverage },
      } = result.aggregate.coverage;
      assert.equal(availableInputCoverage.available, 2);
      const {
        counters: { inputTokens: unavailableInputCoverage },
      } = result.aggregate.coverage;
      assert.equal(unavailableInputCoverage.unavailable, 2);
    } finally {
      await fs.rm(folder, { recursive: true, force: true });
    }
  }

  async function identityEnrichmentOrdering() {
    let clock = 1000,
      inventory = [pane("a"), pane("b")];
    const events: string[] = [];
    const identities: NonNullable<ObserverOptions["identities"]> = {
      resolveMany: (panes) => {
        return settled(() => {
          events.push(`identities:${String(panes.length)}`);
          return panes.map((row) => ({ sessionId: nativeSession(row), source: "native" }));
        });
      },
      resolve: async (row) => {
        events.push("identity:" + row.pane_id);
        await new Promise<void>((resolve) => setImmediate(resolve));
        return { sessionId: nativeSession(row), source: "native" };
      },
      retain() {},
    };
    const observer = makeObserver({
      now: () => clock,
      endpoint: "ordering",
      identities,
      execute: () => settled(() => ({ stdout: JSON.stringify({ result: { agents: inventory } }) })),
      desktop: { inventory: () => settled(() => ({ health: "unavailable", windows: [] })) },
      bus: { read: () => busFixture({ rows: [] }) },
      transcripts: {
        retain() {},
        read: async () => {
          events.push("transcript");
          await new Promise<void>((resolve) => setImmediate(resolve));
          return { available: true };
        },
      },
      projects: {
        resolve: async () => {
          events.push("project");
          await new Promise<void>((resolve) => setImmediate(resolve));
          return {};
        },
      },
      helpers: {
        children: (parents) => {
          return settled(() => {
            events.push(`helpers:${String(parents.length)}`);
            return {
              rows: [],
              annotations: new Map<string, Partial<ObserverInputRow>>(),
              overflow: new Map<string, number>(),
            };
          });
        },
      },
    });
    assert.equal(
      (
        await inventoryWhen(
          observer,
          (data) =>
            data.sessions.length === 2 && data.sessions.every((row) => must(row.tool).available),
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
    assert.equal(events[events.length - 1], "helpers:2");
  }

  async function refreshStartCache() {
    for (const completionAt of [3000, 100]) {
      let clock = 0,
        reads = 0,
        release: (() => void) | true | null | undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const observer = makeCoreObserver({
        now: () => clock,
        readIdentityConfiguration: () => settled(() => "unconfigured"),
        execute: async () => {
          reads++;
          await gate;
          return { stdout: JSON.stringify({ result: { agents: [] } }) };
        },
        desktop: { inventory: () => settled(() => ({ health: "unavailable", windows: [] })) },
        helpers: {
          children: () => {
            return settled(() => {
              return {
                rows: [],
                annotations: new Map<string, Partial<ObserverInputRow>>(),
                overflow: new Map<string, number>(),
              };
            });
          },
        },
        transcripts: { retain() {} },
        bus: { read: () => busFixture({ rows: [] }) },
      });
      const first = observer.get();
      await new Promise<void>((resolve) => setImmediate(resolve));
      try {
        clock = completionAt;
        assert.equal(
          observer.get(),
          first,
          "pending refresh coalesces even after cache lifetime expires",
        );
      } finally {
        fixtureRelease(release);
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

  async function progressivePublication() {
    const summary = deferred(),
      desktopGate = deferred(),
      helperGate = deferred(),
      busGate = deferred();
    const started = new Set<string>();
    const observer = makeCoreObserver({
      now: () => 1000,
      warmDetails: false,
      identities: {
        resolveMany: (rows) => settled(() => rows.map(() => ({ sessionId: ID, source: "native" }))),
      },
      projects: {
        resolveMany: (rows) => settled(() => rows.map(() => ({ projectId: "fixture" }))),
      },
      execute: () =>
        settled(() => ({ stdout: JSON.stringify({ result: { agents: [pane("early")] } }) })),
      transcripts: {
        retain() {},
        read: async () => {
          started.add("summary");
          await summary.promise;
          return { available: true, usage: usageFixture({ observedAt: 777 }) };
        },
        inspect: () =>
          settled(() => inspection({ available: true, health: "available", turns: [] })),
      },
      helpers: {
        prepareChildren: async () => {
          started.add("helper");
          await helperGate.promise;
          return {
            rows: [],
            annotations: new Map<string, Partial<ObserverInputRow>>(),
            overflow: new Map<string, number>(),
            commitBindings() {},
          };
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
          return busFixture({ health: "available", rows: [], observedAt: 800 });
        },
      },
    });
    let published = false;
    const first = observer.get().then((value) => {
      published = true;
      return value;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    try {
      assert.equal(
        published,
        PUBLISHED_CORE,
        "core rooms publish while every optional source remains blocked",
      );
      const core = await first;
      assert.equal(core.sessions.length, 1);
      assert.equal(must(must(core.sessions[0]).tool).available, UNAVAILABLE_TOOL);
      assert.equal(must(core.sessions[0]).usage, null);
      assert.equal(core.bus, null);
      assert.deepEqual([...started].sort(), ["bus", "desktop", "helper", "summary"]);
      assert.equal(
        (await observer.inspect(must(core.sessions[0]).id, "codex:" + ID)).health,
        "available",
        "explicit inspection ignores unrelated optional gates",
      );
      summary.resolve();
      await summary.promise;
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.equal(
        must(must((await observer.get()).sessions[0]).tool).available,
        AVAILABLE_TOOL,
        "summary publication does not wait for helpers",
      );
      assert.equal(
        must(must(core.sessions[0]).tool).available,
        UNAVAILABLE_TOOL,
        "published snapshots remain immutable",
      );
    } finally {
      summary.resolve();
      desktopGate.resolve();
      helperGate.resolve();
      busGate.resolve();
      await first;
      await observer.close();
    }
  }

  async function inventoryWhen(
    observer: ReturnType<typeof makeNativeObserver>,
    predicate: (snapshot: Inventory) => boolean,
  ) {
    for (let attempt = 0; attempt < 1000; attempt++) {
      const snapshot = await observer.get();
      if (predicate(snapshot)) return snapshot;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    assert.fail("fixture did not publish the expected inventory");
  }

  function progressiveOptions(overrides: ObserverOptions = {}): ObserverOptions {
    return {
      now: () => 1000,
      warmDetails: false,
      identities: {
        resolveMany: (rows) =>
          settled(() => rows.map((row) => ({ sessionId: nativeSession(row), source: "native" }))),
      },
      projects: {
        resolveMany: (rows) => settled(() => rows.map(() => ({ projectId: "fixture" }))),
      },
      execute: () =>
        settled(() => ({ stdout: JSON.stringify({ result: { agents: [pane("root")] } }) })),
      transcripts: {
        retain() {},
        read: () => settled(() => ({ available: true })),
        inspect: () =>
          settled(() => inspection({ available: true, health: "available", turns: [] })),
      },
      helpers: {
        prepareChildren: () =>
          settled(() => ({
            rows: [],
            annotations: new Map<string, Partial<ObserverInputRow>>(),
            overflow: new Map<string, number>(),
            commitBindings() {},
          })),
      },
      desktop: { inventory: () => settled(() => ({ health: "unavailable", windows: [] })) },
      bus: {
        read: () => settled(() => busFixture({ health: "available", rows: [], observedAt: 900 })),
      },
      ...overrides,
    };
  }
  async function titleCoercion() {
    let title: unknown = "accepted",
      clock = 1000;
    const observer = makeCoreObserver(
      progressiveOptions({
        now: () => clock,
        execute: () =>
          settled(() => ({
            stdout: JSON.stringify({
              result: { agents: [{ ...pane("title"), terminal_title_stripped: title }] },
            }),
          })),
      }),
    );
    try {
      await observer.get();
      const examples: [unknown, string][] = [
        [{}, "[object Object]"],
        [[0, false, null, ["x", {}]], "0,false,,x,[object Object]"],
        [{ valueOf: 1 }, "[object Object]"],
        [false, "codex"],
      ];
      for (const [input, expected] of examples) {
        title = input;
        clock += 3000;
        const snapshot = await observer.get();
        assert.equal(snapshot.sources.herdr.health, "available");
        assert.equal(
          must(snapshot.sessions[0]).title,
          expected,
          "JSON title conversion preserves native object/array coercion",
        );
      }
      for (const input of [{ toString: 1 }, [null, { toString: "not-callable" }]]) {
        title = input;
        clock += 3000;
        const snapshot = await observer.get();
        assert.equal(
          snapshot.sources.herdr.health,
          "unavailable",
          "non-callable JSON conversion method fails inventory closed",
        );
        assert.equal(
          must(snapshot.sessions[0]).title,
          "codex",
          "failed title coercion retains the last accepted row",
        );
        assert.equal(must(snapshot.sessions[0]).inventoryHealth, "unavailable");
      }
    } finally {
      await observer.close();
    }
  }
  async function receiverAdapters() {
    const childSession = "00000000-0000-0000-0000-000000000002";
    const calls = new Set<string>();
    class ReceiverTranscripts {
      retain() {
        assert.equal(this, transcripts);
      }
      read() {
        assert.equal(this, transcripts);
        calls.add("read");
        return { available: true };
      }
      inspect() {
        assert.equal(this, transcripts);
        calls.add("inspect");
        return inspection({ available: true });
      }
      inspectChild() {
        assert.equal(this, transcripts);
        calls.add("inspectChild");
        return inspection({ available: true });
      }
      bindChild(
        provider: ObserverInputRow["provider"],
        sessionId: string,
        parentSessionId: string,
      ): ChildBinding {
        assert.equal(this, transcripts);
        calls.add("bindChild");
        return { provider, sessionId, parentSessionId };
      }
      claudeCandidates(parent: string): { sessionId: string }[] {
        assert.equal(this, transcripts);
        calls.add("originalCandidates");
        return parent === ID ? [{ sessionId: childSession }] : [];
      }
      helperMetadata() {
        assert.equal(this, transcripts);
        calls.add("helperMetadata");
        return undefined;
      }
      claudeClaims() {
        assert.equal(this, transcripts);
        calls.add("claudeClaims");
        return undefined;
      }
    }
    const transcripts = new ReceiverTranscripts();
    assert(!Object.hasOwn(transcripts, "read"), "fixture methods are inherited");
    const bus = {
      read() {
        assert.equal(this, bus);
        return busFixture();
      },
      inspect(id: number) {
        assert.equal(this, bus);
        calls.add("busInspect");
        return {
          id,
          identity: null,
          health: "unavailable" as const,
          reason: "fixture",
          asOf: "fixture",
          text: null,
          truncated: false,
          window: { maxTextChars: 0 },
        };
      },
    };
    const desktop = {
      inventory() {
        assert.equal(this, desktop);
        return {
          health: "available",
          windows: [
            {
              id: "desktop-fixture",
              provider: "codex" as const,
              inspectionIdentity: "obs_" + "e".repeat(24),
            },
          ],
        };
      },
      inspect() {
        assert.equal(this, desktop);
        calls.add("desktopInspect");
        return inspection({ available: true });
      },
    };
    const options = progressiveOptions({
      transcripts,
      bus,
      desktop,
      execute: () =>
        settled(() => ({
          stdout: JSON.stringify({
            result: { agents: [{ ...pane("receiver"), agent: "claude" }] },
          }),
        })),
    });
    delete options.helpers;
    const observer = makeCoreObserver(options);
    transcripts.claudeCandidates = function (parent: string) {
      assert.equal(this, transcripts);
      calls.add("currentCandidates");
      return parent === ID ? [{ sessionId: childSession }] : [];
    };
    try {
      const snapshot = await inventoryWhen(observer, (data) => data.sessions.length === 3);
      const child = must(snapshot.sessions.find((row) => row.source === "helper"));
      const root = must(snapshot.sessions.find((row) => row.source === "herdr"));
      assert.equal((await observer.inspect(root.id)).health, "available");
      assert.equal((await observer.inspect(child.id)).health, "available");
      assert.equal((await observer.inspect("desktop-fixture")).health, "available");
      assert.equal((await observer.inspectMessage(7)).reason, "fixture");
      assert.deepEqual(
        [...calls].sort(),
        [
          "bindChild",
          "busInspect",
          "desktopInspect",
          "claudeClaims",
          "currentCandidates",
          "helperMetadata",
          "inspect",
          "inspectChild",
          "read",
        ].sort(),
        "default helpers keep current inherited adapter methods and original receiver",
      );
    } finally {
      await observer.close();
    }
  }
  async function sparseEvidenceShape() {
    const child = "obs_" + "f".repeat(24);
    const observer = makeCoreObserver(
      progressiveOptions({
        helpers: {
          prepareChildren: (parents) =>
            settled(() => ({
              rows: [
                {
                  id: child,
                  provider: "codex",
                  source: "helper",
                  parentId: must(parents[0]).id,
                  inspectionIdentity: "helper:" + child,
                  inventoryHealth: "available",
                  tool: { available: true },
                },
              ],
              annotations: new Map<string, Partial<ObserverInputRow>>(),
              overflow: new Map<string, number>(),
            })),
        },
      }),
    );
    try {
      const snapshot = await inventoryWhen(observer, (data) =>
        data.sessions.some((row) => row.id === child),
      );
      const tool = must(must(snapshot.sessions.find((row) => row.id === child)).tool);
      assert(
        Object.hasOwn(tool, "observedAt"),
        "sparse evidence still publishes the timestamp property",
      );
      assert.equal(tool.observedAt, undefined, "missing source time remains explicitly undefined");
      assert.equal(
        tool.available,
        UNAVAILABLE_TOOL,
        "untimestamped helper evidence is unavailable",
      );
    } finally {
      await observer.close();
    }
  }
  async function progressiveOptionalFreshness() {
    for (const timestamped of [true, false]) {
      let clock = 1000,
        reads = 0;
      const summary = deferred(),
        helper = deferred();
      const usage = (at: number | undefined) =>
        usageFixture({
          inputTokens: { value: 42, state: "available" },
          ...(timestamped ? { observedAt: at } : {}),
        });
      const last = lastFixture({ name: "Read", phase: "started", outcome: "unknown", at: 900 });
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
              return {
                rows: [],
                annotations: new Map<string, Partial<ObserverInputRow>>(),
                overflow: new Map<string, number>(),
                commitBindings() {},
              };
            },
          },
        }),
      );
      try {
        await observer.get();
        summary.resolve();
        const accepted = await inventoryWhen(
          observer,
          (data) => must(must(data.sessions[0]).tool).available,
        );
        const { aggregate: acceptedAggregate } = accepted;
        assert.equal(acceptedAggregate.usage.inputTokens.value, 42);
        for (clock of [3000, 5000, 7000]) {
          const live = await observer.get();
          assert.equal(must(live.sessions[0]).observedAt, clock);
          assert.equal(
            must(must(live.sessions[0]).tool).available,
            AVAILABLE_TOOL,
            "optional evidence is live through exactly six seconds",
          );
          const { aggregate: liveAggregate } = live;
          assert.equal(liveAggregate.usage.inputTokens.value, 42);
          assert.equal(live.aggregate.usageObservedAt, 1000);
          assert.equal(
            must(must(live.sessions[0]).tool).observedAt,
            1000,
            "public tool evidence preserves source/read-start time",
          );
        }
        clock = 7001;
        const expired = await observer.get();
        assert.equal(
          must(must(expired.sessions[0]).tool).available,
          UNAVAILABLE_TOOL,
          "cached snapshots age optional activity at six seconds",
        );
        assert.equal(
          must(expired.sessions[0]).observedAt,
          7000,
          "optional age never changes inventory observation",
        );
        assert.equal(must(expired.sessions[0]).inventoryHealth, "available");
        const { aggregate: expiredAggregate } = expired;
        assert.equal(expiredAggregate.agents.statuses.working, 1);
        assert.equal(expired.aggregate.agents.stale, 0);
        assert.deepEqual(expired.aggregate.usage.inputTokens, {
          value: null,
          state: "unavailable",
        });
        assert.equal(expired.aggregate.coverage.stale, 1);
        const {
          counters: { inputTokens: expiredInputCoverage },
        } = expired.aggregate.coverage;
        assert.equal(expiredInputCoverage.stale, 1);
        assert.equal(
          must(must(expired.sessions[0]).usage).observedAt,
          1000,
          "retain actual source/read observation",
        );
        assert.deepEqual(
          must(must(expired.sessions[0]).tool).last,
          last,
          "retain last-known tool evidence without advertising it live",
        );
        assert.equal(
          must(must(accepted.sessions[0]).tool).available,
          AVAILABLE_TOOL,
          "previous published snapshot stays immutable",
        );
        assert.equal(reads, 1, "unchanged ownership does not restart a held sweep");
        clock = 9000;
        const held = await observer.get();
        assert.equal(must(held.sessions[0]).observedAt, 9000);
        const { aggregate: heldAggregate } = held;
        assert.equal(heldAggregate.agents.statuses.working, 1);
        assert.equal(
          held.aggregate.coverage.stale,
          1,
          "a later healthy core cannot renew held optional evidence",
        );
        helper.resolve();
        await helper.promise;
        await new Promise<void>((resolve) => setImmediate(resolve));
        clock = 11000;
        await observer.get();
        const recovered = await inventoryWhen(
          observer,
          (data) => must(data.sessions[0]).usage?.observedAt === clock,
        );
        assert.equal(must(must(recovered.sessions[0]).tool).available, AVAILABLE_TOOL);
        const { aggregate: recoveredAggregate } = recovered;
        assert.equal(recoveredAggregate.usage.inputTokens.value, 42);
        assert.equal(recovered.aggregate.coverage.stale, 0);
      } finally {
        summary.resolve();
        helper.resolve();
        await observer.close();
      }
    }
  }
  async function progressiveOwnership() {
    for (const change of ["unchanged", "session", "process", "removed", "unavailable"])
      await progressiveOwnershipScenario(change);
  }
  async function progressiveOwnershipScenario(change: string) {
    let clock = 1000,
      session = ID,
      pid = 7,
      present = true,
      failed = false,
      revision = 0,
      sweeps = 0;
    const summary = deferred(),
      helper = deferred(),
      warm: string[] = [],
      bindings = new Set<string>();
    const child = "obs_" + "c".repeat(24),
      grandchild = "obs_" + "d".repeat(24);
    const observer = makeCoreObserver(
      progressiveOptions({
        now: () => clock,
        warmDetails: true,
        execute: () => {
          return settled(() => {
            if (failed) throw Error("fixture unavailable");
            return {
              stdout: JSON.stringify({
                result: { agents: present ? [pane("root", session)] : [] },
              }),
            };
          });
        },
        identities: {
          resolveMany: (rows) =>
            settled(() =>
              rows.map((row) => ({
                sessionId: nativeSession(row),
                source: "footer",
                proof: {
                  provider: "codex",
                  contentRevision: 1,
                  observedAt: clock,
                  paneId: "root",
                  terminalId: "terminal",
                  sessionId: must(nativeSession(row)),
                  revision: ++revision,
                  birth: { pid, startSeconds: 1, startMicroseconds: 2 },
                },
              })),
            ),
          revalidateAll: () => settled(() => true),
        },
        transcripts: {
          retain() {},
          read: async () => {
            await summary.promise;
            return { available: true, usage: usageFixture({ observedAt: 700 }) };
          },
          inspect: (id) => {
            return settled(() => {
              warm.push(id);
              return inspection({ available: true, health: "available", turns: [] });
            });
          },
        },
        helpers: {
          prepareChildren: async (parents) => {
            const sweep = ++sweeps;
            await helper.promise;
            // Later changed-owner sweeps supply their own empty result; old work must not leak through.
            const rows: ObserverInputRow[] =
              sweep === 1 || change === "unchanged"
                ? [
                    {
                      id: child,
                      source: "helper",
                      provider: "codex",
                      sessionId: "child",
                      parentId: must(parents[0]).id,
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
              annotations: new Map<string, Partial<ObserverInputRow>>(),
              overflow: new Map<string, number>(),
              commitBindings(ids) {
                bindings.clear();
                for (const row of rows) if (ids.has(row.id)) bindings.add(row.id);
              },
            };
          },
          inspect: (row) => {
            return settled(() => {
              assert(bindings.has(row.id), "visible helper and binding publish together");
              warm.push(row.id);
              return inspection({ available: true, health: "available", turns: [] });
            });
          },
        },
      }),
    );
    function changeOwnership(round: number) {
      if (round !== 1) return;
      if (change === "session") session = "00000000-0000-0000-0000-000000000002";
      if (change === "process") pid++;
      if (change === "removed") present = false;
      if (change === "unavailable") failed = true;
    }
    try {
      const first = await observer.get();
      const root = must(first.sessions[0]).id;
      for (let round = 0; round < 3; round++) {
        clock += 2000;
        changeOwnership(round);
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
        assert.equal(must(enriched.sessions[0]).observedAt, 7000);
        assert.equal(must(must(enriched.sessions[0]).usage).observedAt, 700);
        assert.equal(must(enriched.sessions[1]).observedAt, 777);
        assert.equal(must(enriched.sessions[2]).observedAt, 778);
        assert.equal(sweeps, 1, "unchanged ownership retains enrichment across three generations");
        assert.deepEqual([...bindings], [child, grandchild]);
        assert.equal(
          (await observer.inspect(grandchild, "helper:" + grandchild + "|" + child)).health,
          "available",
        );
        clock += 2000;
        await observer.get();
        const retained = await observer.get();
        assert.equal(
          must(retained.sessions[1]).observedAt,
          777,
          "a later core cannot restamp helper evidence",
        );
        assert.equal(must(must(retained.sessions[0]).usage).observedAt, 700);
      } else {
        // Synchronize on actual fixture work; get exposes only public snapshots.
        await summary.promise;
        await helper.promise;
        await new Promise<void>((resolve) => setImmediate(resolve));
        const latest = await observer.get();
        assert.equal(
          latest.sessions.some((row) => row.id === child || row.id === grandchild),
          NO_OBSOLETE_DESCENDANTS,
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

  async function historicalLineage() {
    for (const replacement of [
      "session",
      "process",
      "terminal",
      "provider",
      "removed",
      "empty",
      "recover",
    ]) {
      let clock = 1000,
        uncertain = false,
        unavailable = false,
        replaced = false,
        sweeps = 0,
        reads = 0;
      const pending = deferred(),
        bindings = new Set<string>(),
        child = "obs_" + "c".repeat(24),
        grandchild = "obs_" + "d".repeat(24);
      const observer = makeCoreObserver(
        progressiveOptions({
          now: () => clock,
          execute: () =>
            settled(() => {
              if (unavailable) throw Error("fixture unavailable");
              return {
                stdout: JSON.stringify({
                  result: {
                    agents:
                      replaced && replacement === "removed"
                        ? []
                        : [
                            {
                              ...pane("root"),
                              agent: replaced && replacement === "provider" ? "claude" : "codex",
                              agent_status: uncertain ? "idle" : "working",
                            },
                          ],
                  },
                }),
              };
            }),
          identities: {
            resolveMany: (rows) =>
              settled(() =>
                rows.map(() => {
                  const identity =
                    replaced && replacement === "session"
                      ? "00000000-0000-0000-0000-000000000002"
                      : ID;
                  return {
                    sessionId: uncertain ? null : identity,
                    source: uncertain ? "unavailable" : "footer",
                    proof: uncertain
                      ? null
                      : {
                          provider: "codex" as const,
                          paneId: "root",
                          terminalId:
                            replaced && replacement === "terminal" ? "new-terminal" : "terminal",
                          sessionId: identity,
                          birth: {
                            pid: replaced && replacement === "process" ? 8 : 7,
                            startSeconds: 1,
                            startMicroseconds: 2,
                          },
                          contentRevision: 1,
                          observedAt: clock,
                        },
                  };
                }),
              ),
            revalidateAll: () => settled(() => true),
          },
          transcripts: { retain() {}, read: () => settled(() => ({ available: false })) },
          helpers: {
            prepareChildren: async (parents) => {
              const sweep = ++sweeps;
              if (sweep > 1) await pending.promise;
              const rows: ObserverInputRow[] =
                sweep === 1 || replacement === "recover"
                  ? [child, grandchild].map((id, index) => ({
                      id,
                      source: "helper",
                      provider: "codex",
                      sessionId: index
                        ? "00000000-0000-0000-0000-00000000000d"
                        : "00000000-0000-0000-0000-00000000000c",
                      parentId: index ? child : must(parents[0]).id,
                      inventoryHealth: "available",
                      inspectionIdentity: "helper:" + id,
                      observedAt: sweep === 1 ? 777 + index : clock,
                      status: "working",
                      usage: usageFixture({
                        observedAt: 700,
                        inputTokens: { value: 42, state: "available" },
                      }),
                      taskEvidence: {
                        state: "available",
                        summary: "Original task",
                        source: "fixture",
                        observedAt: 701,
                      },
                      lifecycleEvidence: {
                        state: "open",
                        reason: null,
                        source: "fixture",
                        observedAt: 702,
                      },
                      taskStatusEvidence: { status: "running", source: "fixture", observedAt: 703 },
                      tool: { available: false },
                    }))
                  : [];
              return {
                rows,
                annotations: new Map<string, Partial<ObserverInputRow>>(),
                overflow: new Map<string, number>(),
                commitBindings(ids) {
                  bindings.clear();
                  for (const row of rows) if (ids.has(row.id)) bindings.add(row.id);
                },
              };
            },
            inspect: () =>
              settled(() => {
                reads++;
                return inspection({ available: true });
              }),
          },
        }),
      );
      try {
        await observer.get();
        const first = await inventoryWhen(observer, (data) => data.sessions.length === 3);
        const { usage: firstUsage } = first.aggregate;
        assert.equal(firstUsage.inputTokens.value, 84, "fresh helpers initially contribute usage");
        assert.equal(bindings.size, 2);
        uncertain = true;
        clock = 3000;
        const lost = await observer.get();
        assert.equal(lost.sessions.length, 3, "temporary identity loss retains published ancestry");
        assert.equal(must(lost.sessions[0]).inspectionIdentity, null);
        assert.equal(
          must(lost.sessions[0]).status,
          "idle",
          "fresh native status is never restored from history",
        );
        assert.equal(bindings.size, 0, "historical presentation has no active bindings");
        const { usage: lostUsage, agents: lostAgents } = lost.aggregate;
        assert.equal(
          lostUsage.inputTokens.value,
          null,
          "historical helpers contribute no current usage",
        );
        assert.equal(lostAgents.stale, 2);
        for (const row of lost.sessions.slice(1)) {
          assert.deepEqual(row, {
            ...must(first.sessions.find((value) => value.id === row.id)),
            inventoryHealth: "unavailable",
          });
          assert.equal(
            (await observer.inspect(row.id, "helper:" + row.id + "|" + String(row.parentId)))
              .reason,
            "inventory-unavailable",
          );
        }
        assert.equal(reads, 0, "retained helpers are rejected before any transcript read");
        unavailable = true;
        clock = 5000;
        assert.equal(
          (await observer.get()).sessions.length,
          3,
          "source outage keeps historical tree",
        );
        unavailable = false;
        uncertain = false;
        clock = 11000;
        const recovered = await observer.get();
        assert.equal(
          recovered.sessions.length,
          3,
          "recovery waits for a successful helper observation",
        );
        assert.equal(must(recovered.sessions[1]).inventoryHealth, "unavailable");
        assert.equal(must(recovered.sessions[1]).observedAt, 777);
        assert.equal(must(must(recovered.sessions[1]).usage).observedAt, 700);
        const { agents } = recovered.aggregate;
        assert.equal(agents.statuses.working, 1, "unavailable helpers never count as working");
        if (!["empty", "recover"].includes(replacement)) {
          replaced = true;
          clock += 2000;
          const changed = await observer.get();
          assert(
            !changed.sessions.some((row) => row.source === "helper"),
            replacement + " discards history immediately",
          );
        }
        pending.resolve();
        await pending.promise;
        await new Promise<void>((resolve) => setImmediate(resolve));
        if (replacement === "recover") {
          const refreshed = await inventoryWhen(
            observer,
            (data) =>
              data.sessions.find((row) => row.id === child)?.inventoryHealth === "available",
          );
          assert.equal(must(refreshed.sessions.find((row) => row.id === child)).observedAt, clock);
          assert.deepEqual(
            [...bindings],
            [child, grandchild],
            "new successful observation restores bindings with rows",
          );
          continue;
        }
        const empty = await observer.get();
        assert(
          !empty.sessions.some((row) => row.source === "helper"),
          "successful empty result replaces history",
        );
        assert.equal(bindings.size, 0);
      } finally {
        pending.resolve();
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
      pane(
        `warm-${String(index)}`,
        "00000000-0000-0000-0000-" + String(index + 1).padStart(12, "0"),
      ),
    );
    const jobs: { id: string; gate: ReturnType<typeof deferred> }[] = [],
      observers: ReturnType<typeof makeNativeObserver>[] = [];
    const observer = makeCoreObserver(
      progressiveOptions({
        now: () => clock,
        warmDetails: true,
        execute: () => {
          return settled(() => {
            inventoryReads++;
            return { stdout: JSON.stringify({ result: { agents: panes } }) };
          });
        },
        transcripts: {
          retain() {},
          read: () =>
            settled(() => ({ available: true, usage: usageFixture({ observedAt: clock }) })),
          inspect: async (id) => {
            const gate = deferred();
            active++;
            maximum = Math.max(maximum, active);
            jobs.push({ id, gate });
            await gate.promise;
            active--;
            return inspection({ available: false });
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
      // Advance beyond cooldown with held reads. Warmup never requests new inventory itself.
      clock += 61000;
      const demands = inventoryReads;
      for (let completed = 0; completed < 32; completed++) {
        await fixtureUntil(
          () => !!jobs[completed],
          `warm job ${String(completed)}, total=${String(jobs.length)}`,
        );
        must(jobs[completed]).gate.resolve();
        await must(jobs[completed]).gate.promise;
      }
      await new Promise<void>((resolve) => setImmediate(resolve));
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
          `second warm job ${String(index)}, total=${String(jobs.length)}`,
        );
        must(jobs[index]).gate.resolve();
      }
      await new Promise<void>((resolve) => setImmediate(resolve));
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
            read: () => settled(() => ({ available: true })),
            inspect: () => {
              return settled(() => {
                assert.fail("disabled warmup read content");
              });
            },
          },
        }),
      );
      observers.push(hidden);
      await hidden.get();
      await new Promise<void>((resolve) => setImmediate(resolve));
      await hidden.get();
    } finally {
      for (const job of jobs) job.gate.resolve();
      await Promise.all(observers.map((value) => value.close()));
    }
  }

  async function fixtureUntil(predicate: () => boolean, label: string) {
    for (let attempt = 0; attempt < 1000; attempt++) {
      if (predicate()) return;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    assert.fail(label);
  }

  async function queuedWarmOwnership() {
    let clock = 1000,
      parentIndex = 0,
      thirdSession = "00000000-0000-0000-0000-000000000003",
      fourth = true;
    const child = "obs_" + "e".repeat(24),
      gates: ReturnType<typeof deferred>[] = [],
      reads: (string | null | undefined)[] = [],
      helperParents: string[] = [];
    const observer = makeCoreObserver(
      progressiveOptions({
        now: () => clock,
        warmDetails: true,
        execute: () =>
          settled(() => ({
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
          })),
        transcripts: {
          retain() {},
          read: () =>
            settled(() => ({ available: true, usage: usageFixture({ observedAt: clock }) })),
          inspect: async (_id, _provider, session) => {
            reads.push(session);
            if (reads.length <= 2) {
              const gate = deferred();
              gates.push(gate);
              await gate.promise;
            }
            return inspection({ available: true, health: "available", turns: [] });
          },
        },
        helpers: {
          prepareChildren: (parents) =>
            settled(() => ({
              rows: [
                {
                  id: child,
                  source: "helper",
                  provider: "codex",
                  sessionId: "child",
                  inspectionIdentity: "helper:" + child,
                  parentId: must(parents[parentIndex]).id,
                  inventoryHealth: "available",
                  observedAt: 900,
                },
              ],
              annotations: new Map<string, Partial<ObserverInputRow>>(),
              overflow: new Map<string, number>(),
              commitBindings() {},
            })),
          inspect: (row) => {
            return settled(() => {
              helperParents.push(must(row.parentId));
              return inspection({ available: true, health: "available", turns: [] });
            });
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
      ] as const) {
        clock += 2000;
        thirdSession = session;
        parentIndex = parent;
        fourth = false;
        await observer.get();
        await inventoryWhen(
          observer,
          (data) =>
            data.sessions.find((row) => row.id === child)?.parentId ===
              must(core.sessions[parent]).id &&
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
        [must(core.sessions[0]).id],
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
          inspect: () => {
            return settled(() => {
              reads++;
              return { available: false };
            });
          },
        },
        helpers: {
          prepareChildren: async () => {
            await helpers.promise;
            return {
              rows: [],
              annotations: new Map<string, Partial<ObserverInputRow>>(),
              overflow: new Map<string, number>(),
              commitBindings() {
                assert.fail("closed observer committed helper bindings");
              },
            };
          },
          close: () => {
            return settled(() => {
              helperCloses++;
            });
          },
        },
        bus: {
          read: async () => {
            await bus.promise;
            return busFixture({ rows: [], health: "available" });
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
    void closing.then(() => {
      complete = true;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(complete, CLOSE_STILL_PENDING, "close waits for accepted bounded work");
    summary.resolve();
    helpers.resolve();
    bus.resolve();
    desktop.resolve();
    await closing;
    assert.deepEqual(
      await observer.inspectMessage(7),
      { id: 7, health: "unavailable", reason: "unreadable", text: null },
      "closed message inspection preserves its exact public shape",
    );
    const after = await observer.get();
    assert.deepEqual(after, before, "late optional results cannot publish after close");
    assert.equal(reads, 0);
    assert.equal(helperCloses, 1);
    assert.equal((await observer.inspect(must(before.sessions[0]).id)).health, "unavailable");
    // A second observer closes with active reads and a queue, not only pending metadata.
    const jobs: ReturnType<typeof deferred>[] = [],
      activeObserver = makeCoreObserver(
        progressiveOptions({
          warmDetails: true,
          execute: () =>
            settled(() => ({
              stdout: JSON.stringify({
                result: {
                  agents: Array.from({ length: 4 }, (_, index) =>
                    pane(
                      `close-${String(index)}`,
                      "00000000-0000-0000-0000-" + String(index + 1).padStart(12, "0"),
                    ),
                  ),
                },
              }),
            })),
          transcripts: {
            retain() {},
            read: () => settled(() => ({ available: true })),
            inspect: async () => {
              const job = deferred();
              jobs.push(job);
              await job.promise;
              return inspection({ available: true, turns: [] });
            },
          },
        }),
      );
    try {
      await activeObserver.get();
      await fixtureUntil(() => jobs.length === 2, "two warm jobs did not start");
      const stopping = activeObserver.close();
      jobs.forEach((job) => {
        job.resolve();
      });
      await stopping;
      assert.equal(jobs.length, 2, "teardown clears queued targets before active work settles");
    } finally {
      jobs.forEach((job) => {
        job.resolve();
      });
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
    let published: Inventory | undefined;
    const setTimer = globalThis.setTimeout,
      clearTimer = globalThis.clearTimeout;
    let deadline: (() => void) | undefined,
      unref = 0,
      cleared = 0;
    try {
      Object.defineProperty(globalThis, "setTimeout", {
        value: Object.assign(
          <A extends unknown[]>(
            callback: (...args: A) => void,
            milliseconds?: number,
            ...args: A
          ) => {
            assert.equal(milliseconds, 10000);
            deadline = () => {
              callback(...args);
            };
            const timer = setTimer(() => {}, 60000);
            clearTimer(timer);
            return Object.assign(timer, {
              unref() {
                unref++;
                return timer;
              },
            });
          },
          { __promisify__: setTimer.__promisify__ },
        ),
      });
      globalThis.clearTimeout = () => {
        cleared++;
      };
      const stopping = bounded.close();
      published = await bounded.get();
      assert.equal(typeof deadline, "function");
      must(deadline)();
      await stopping;
      assert.equal(unref, 1);
      assert.equal(cleared, 1, "close deadline cannot retain a timer after settlement");
    } finally {
      globalThis.setTimeout = setTimer;
      globalThis.clearTimeout = clearTimer;
      stuck.resolve();
      await bounded.close();
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
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
      bindings = new Set<string>(),
      recovery = deferred();
    const observer = makeCoreObserver(
      progressiveOptions({
        now: () => clock,
        execute: () => {
          return settled(() => {
            if (coreFails) throw Error("fixture unavailable");
            return { stdout: JSON.stringify({ result: { agents: [pane("root")] } }) };
          });
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
                        parentId: must(parents[0]).id,
                        inventoryHealth: "available",
                        observedAt: 777,
                      },
                    ],
              annotations: new Map<string, Partial<ObserverInputRow>>(),
              overflow: new Map<string, number>(),
              commitBindings(ids) {
                bindings.clear();
                for (const id of ids) bindings.add(id);
              },
            };
          },
          inspect: () =>
            settled(() => inspection({ available: true, health: "available", turns: [] })),
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
      assert.equal(must(stale.sessions.find((row) => row.id === child)).observedAt, 777);
      assert.equal((await observer.inspect(child)).reason, "inventory-unavailable");
      assert.equal(bindings.size, 0);
      clock += 2000;
      coreFails = true;
      await observer.get();
      assert.equal(
        must((await observer.get()).sessions.find((row) => row.id === child)).inventoryHealth,
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
        execute: () =>
          settled(() => ({
            stdout: JSON.stringify({
              result: {
                agents: [
                  { ...pane("root"), cwd },
                  { ...pane("child", "00000000-0000-0000-0000-000000000002"), cwd: "child-room" },
                  { ...pane("capped", "00000000-0000-0000-0000-000000000003"), cwd: "capped-room" },
                ],
              },
            }),
          })),
        projects: {
          resolveMany: (cwds) =>
            settled(() =>
              cwds.map((value) => ({
                projectId: fixtureString(value),
                project: fixtureString(value),
                repoId: fixtureString(value) + "-repo",
                worktree: fixtureString(value) + "-tree",
              })),
            ),
        },
        helpers: {
          prepareChildren: async (parents) => {
            await helperGate.promise;
            const oldGrouping = {
              projectId: must(parents[0]).projectId,
              project: must(parents[0]).project,
              repoId: must(parents[0]).repoId,
              worktree: must(parents[0]).worktree,
            };
            return {
              rows: [
                {
                  id: child,
                  source: "helper",
                  provider: "codex",
                  inspectionIdentity: "helper:" + child,
                  inventoryHealth: "available",
                  parentId: must(parents[1]).id,
                  observedAt: 777,
                  ...oldGrouping,
                },
              ],
              annotations: new Map<string, Partial<ObserverInputRow>>([
                [must(parents[1]).id, { parentId: must(parents[0]).id, ...oldGrouping }],
                [must(parents[2]).id, oldGrouping],
              ]),
              groupOwners: new Map([[must(parents[2]).id, must(parents[0]).id]]),
              overflow: new Map<string, number>(),
              commitBindings() {},
            };
          },
        },
      }),
    );
    try {
      const first = await observer.get();
      assert.equal(must(first.sessions[0]).projectId, "old-room");
      clock += 2000;
      cwd = "new-room";
      const core = await observer.get();
      assert.equal(must(core.sessions[0]).projectId, "new-room");
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
        must(enriched.sessions[0]).projectId,
        must(core.sessions[0]).projectId,
        "lineage cannot overwrite latest core grouping",
      );
      assert.equal(
        must(enriched.sessions[2]).parentId,
        undefined,
        "capped ownership still advertises no guessed helper parent",
      );
      assert.equal(must(enriched.sessions[3]).observedAt, 777);
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
            return {
              rows: [],
              annotations: new Map<string, Partial<ObserverInputRow>>(),
              overflow: new Map<string, number>(),
            };
          },
        },
      }),
    );
    try {
      await observer.get();
      const accepted = await inventoryWhen(
        observer,
        (data) => must(must(data.sessions[0]).tool).available,
      );
      assert.equal(
        must(must(accepted.sessions[0]).tool).observedAt,
        1000,
        "tool-only adapter exports captured read start",
      );
      clock = 7000;
      const boundary = await observer.get();
      assert.equal(
        must(must(boundary.sessions[0]).tool).observedAt,
        1000,
        "healthy core does not restamp tool-only evidence",
      );
      assert.equal(must(must(boundary.sessions[0]).tool).available, AVAILABLE_TOOL);
      clock++;
      assert.equal(must(must((await observer.get()).sessions[0]).tool).available, UNAVAILABLE_TOOL);
    } finally {
      helper.resolve();
      await observer.close();
    }
  }

  async function overseerRoles() {
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
    let inventory: Record<string, unknown>[] = [
        launched,
        { ...launched, pane_id: "legacy", name: "overseer" },
      ],
      fail = false,
      clock = 1000;
    const observers: ReturnType<typeof makeNativeObserver>[] = [];
    const create = (state: NonNullable<ObserverOptions["overseerState"]>) => {
      const observer = makeCoreObserver({
        now: () => clock,
        endpoint,
        overseerState: state,
        identities: {
          resolveMany: (panes) =>
            settled(() => panes.map(() => ({ sessionId: null, source: "unavailable" }))),
        },
        execute: (_command, args, settings) => {
          return settled(() => {
            assert.deepEqual(args, ["agent", "list"], "role proof adds no per-row subprocess");
            assert.equal(must(settings.env).HERDR_SOCKET_PATH, endpoint);
            if (fail) throw Error("inventory unavailable");
            return { stdout: JSON.stringify({ result: { agents: inventory } }) };
          });
        },
        projects: { resolve: () => settled(() => ({ projectId: "fixture" })) },
        transcripts: { read: () => settled(() => ({ available: false })), retain() {} },
        helpers: {
          children: () =>
            settled(() => ({
              rows: [],
              annotations: new Map<string, Partial<ObserverInputRow>>(),
              overflow: new Map<string, number>(),
            })),
        },
        bus: { read: () => busFixture({ rows: [] }) },
        desktop: { inventory: () => settled(() => ({ health: "unavailable", windows: [] })) },
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
      assert.equal(must(first.sessions.find((row) => row.paneId === "boss")).role, "overseer");
      assert.equal(
        must(first.sessions.find((row) => row.paneId === "legacy")).role,
        null,
        "legacy name cannot adopt role",
      );
      assert.equal(
        must(first.sessions.find((row) => row.paneId === "boss")).identityHealth,
        "unavailable",
        "role is independent of transcript proof",
      );
      inventory = [{ ...launched, name: "renamed again", terminal_title_stripped: "random title" }];
      const restarted = create(makeOverseerState({ file, endpoint }));
      assert.equal(must((await restarted.get()).sessions[0]).role, "overseer");
      clock += 3000;
      fail = true;
      const stale = (await restarted.get()).sessions[0];
      assert.equal(must(stale).role, "overseer");
      assert.equal(must(stale).inventoryHealth, "unavailable");
      fail = false;
      clock += 3000;
      inventory = [{ ...launched, terminal_id: "reused" }];
      assert.equal(must((await restarted.get()).sessions[0]).role, null);
      assert(
        !JSON.stringify(await restarted.get()).includes(file),
        "private state path never enters rows",
      );
    } finally {
      await Promise.all(observers.map((observer) => observer.close()));
      await fs.rm(directory, { recursive: true, force: true });
    }
  }

  // A transcript UUID belongs to one host; copied histories on other machines are
  // Separate hosts remain independent observations. Duplicate panes on one host still agree or conflict.
  function aggregateHostOwnership() {
    const usage = (value: number) =>
      usageFixture({
        inputTokens: { value, state: "available" },
        outputTokens: { value: 2, state: "available" },
        cacheReadTokens: { value: 0, state: "available" },
        cacheWriteTokens: { value: 0, state: "available" },
        observedAt: 1000,
      });
    const local: ObserverInputRow = {
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
    const remote: ObserverInputRow = {
      ...local,
      id: "remote-pane",
      host: "vm",
      status: "blocked",
      usage: usage(20),
    };
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
