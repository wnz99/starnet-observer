import assert from "node:assert/strict";
import { test } from "bun:test";
import { canonicalTheme } from "../theme.fixture.js";
import type { AppQuerySnapshot, AppRow } from "./data.js";
import { AppState, FRESH_MS } from "./state.js";
import { HelperPresentation } from "./helper-presentation.js";
import { FreshnessDeadline } from "./deadline.js";

const root: AppRow = { id: "root", source: "herdr" };
const helper = (id: string, patch: Partial<AppRow> = {}): AppRow => ({
  id,
  source: "helper",
  parentId: root.id,
  lineageState: "verified",
  status: "idle",
  ...patch,
});
function harness() {
  let now = 10000;
  const state = new AppState(canonicalTheme(), { now: () => now, frame: () => now });
  const owner = new HelperPresentation(state);
  const snapshot = (
    rows: AppRow[],
    hosts: Record<string, { health: "available" | "unavailable"; observedAt: number }> = {},
  ): AppQuerySnapshot => ({
    data: {
      health: "available",
      observedAt: now,
      sessions: rows,
      sources: { herdr: { health: "available", observedAt: now }, hosts },
    },
    hasData: true,
    pending: false,
    error: null,
    updatedAt: now,
    key: "observer.sessions",
    path: "/api/sessions",
    stale: false,
    ageMs: 0,
    errorAt: 0,
  });
  const reconcile = (rows: AppRow[], value = snapshot(rows)) =>
    owner.reconcile(rows, { snapshot: value, now });
  return {
    owner,
    state,
    snapshot,
    reconcile,
    advance: (ms = 1000) => {
      now += ms;
    },
    now: () => now,
  };
}
test("helper presentation animates proved births and closures once, never completion or history", () => {
  const h = harness(),
    historical = helper("history", { lifecycleEvidence: { state: "closed" } });
  assert.deepEqual(
    h.reconcile([root, historical]).map((row) => row.id),
    [root.id],
  );
  h.advance();
  const born = helper("born", {
    taskEvidence: { state: "available", source: "codex:spawn_agent", observedAt: h.now() - 100 },
  });
  h.reconcile([root, born]);
  assert.equal(h.owner.phase(born.id), "entering");
  assert.equal(h.owner.settle(born.id, "entering"), true);
  assert.equal(h.owner.settle(born.id, "entering"), false);
  h.advance();
  h.reconcile([root, { ...born, status: "done" }]);
  assert.equal(h.owner.phase(born.id), "present");
  h.advance();
  const closed = { ...born, lifecycleEvidence: { state: "closed" } };
  h.reconcile([root, closed]);
  assert.equal(h.owner.phase(born.id), "returning");
  h.advance();
  assert.equal(
    h.reconcile([root, { ...born, lifecycleEvidence: { state: "unknown" } }])[1]?.lifecycleEvidence
      ?.state,
    "closed",
    "an unknown observation cannot erase validated return labels",
  );
  h.advance();
  const missing = h.snapshot([root]);
  assert.equal(h.reconcile([root], missing).length, 2);
  assert.equal(h.owner.returnStale(born.id, missing, h.now()), false);
  assert.equal(h.owner.settle(born.id, "returning"), true);
  assert.deepEqual(
    h.reconcile([root, closed]).map((row) => row.id),
    [root.id],
  );
  h.owner.dispose();
  assert.equal(h.owner.phase(born.id), undefined);
});

test("validated missing-row returns freeze on their source, then settle on recovery without replay", () => {
  const h = harness(),
    row = helper("retained");
  h.reconcile([root, row]);
  h.advance();
  h.reconcile([root, { ...row, lifecycleEvidence: { state: "closed" } }]);
  const sourceAt = h.now();
  h.advance();
  const missing = h.snapshot([root]);
  assert.equal(h.reconcile([root], missing).length, 2);
  assert.equal(h.owner.returnStale(row.id, missing, h.now()), false);
  h.advance(FRESH_MS);
  const expired = h.snapshot([root], { other: { health: "available", observedAt: h.now() } });
  if (expired.data?.sources)
    expired.data.sources.herdr = { health: "available", observedAt: sourceAt };
  assert.equal(h.reconcile([root], expired).length, 2);
  assert.equal(h.owner.returnStale(row.id, expired, h.now()), true);
  assert.equal(h.owner.phase(row.id), "returning");
  h.advance();
  assert.equal(h.reconcile([root]).length, 1);
  assert.equal(h.owner.phase(row.id), undefined);
  assert.equal(
    h.owner.settle(row.id, "returning"),
    false,
    "old settlement cannot remove another generation",
  );
});

test("equal observations, missing/future proof, regressions and gaps never replay events", () => {
  const h = harness(),
    row = helper("known");
  const equal = h.snapshot([root, row]);
  h.reconcile([root, row], equal);
  const sameTime = helper("same-time", {
    taskEvidence: { state: "available", source: "spawn", observedAt: h.now() },
  });
  h.reconcile([root, row, sameTime], {
    ...equal,
    data: { ...equal.data, sessions: [root, row, sameTime], health: "available" },
  });
  assert.equal(h.owner.phase(sameTime.id), "present");
  h.advance();
  const future = helper("future", {
    taskEvidence: { state: "available", source: "spawn", observedAt: h.now() + 1 },
  });
  const missing = helper("no-proof", {
    taskStatusEvidence: { status: "running", observedAt: h.now() },
  });
  h.reconcile([root, row, future, missing]);
  assert.equal(h.owner.phase(future.id), "present");
  assert.equal(h.owner.phase(missing.id), "present");
  h.advance();
  const staleClosed = {
    ...row,
    lifecycleEvidence: { state: "closed" },
    inventoryHealth: "unavailable" as const,
  };
  assert(h.reconcile([root, staleClosed]).some((value) => value.id === row.id));
  assert.equal(
    h.owner.phase(row.id),
    "present",
    "stale closure cannot start a return or remove a displayed helper",
  );
  const regressed = h.snapshot([root, row]);
  if (regressed.data?.sources)
    regressed.data.sources.herdr = { health: "available", observedAt: h.now() - 500 };
  h.reconcile([root, row], regressed);
  h.advance(FRESH_MS + 1);
  const gapBirth = helper("gap", {
    taskEvidence: { state: "available", source: "spawn", observedAt: h.now() },
  });
  h.reconcile([root, gapBirth]);
  assert.equal(h.owner.phase(gapBirth.id), "present");
  h.advance();
  const unavailable = h.snapshot([root, gapBirth]);
  if (unavailable.data)
    unavailable.data.sources = { desktop: { health: "available", observedAt: h.now() } };
  const unproved = helper("missing-herdr", {
    taskEvidence: { state: "available", source: "spawn", observedAt: h.now() },
  });
  h.reconcile([root, gapBirth, unproved], unavailable);
  assert.equal(h.owner.phase(unproved.id), "present");
  h.advance();
  const legacy = h.snapshot([root, gapBirth, unproved]);
  if (legacy.data) delete legacy.data.sources;
  h.reconcile([root, gapBirth, unproved], legacy);
  assert.equal(
    h.owner.phase(unproved.id),
    "present",
    "legacy source recovery seeds without replay",
  );
});

test("parent changes cancel transitions and bounded retention clears through reset/dispose", () => {
  const h = harness();
  h.reconcile([root]);
  h.advance();
  const rows = Array.from({ length: 80 }, (_, i) =>
    helper("bounded-" + String(i), {
      taskEvidence: { state: "available", source: "spawn", observedAt: h.now() },
    }),
  );
  h.reconcile([root, ...rows]);
  assert.equal(rows.filter((row) => h.owner.phase(row.id) === "entering").length, 64);
  h.advance();
  const first = rows[79];
  assert(first);
  h.reconcile([root, { ...first, parentId: "other" }, { ...root, id: "other" }]);
  assert.equal(h.owner.phase(first.id), "present");
  h.reconcile([]);
  assert.equal(h.owner.phase(first.id), undefined);
  h.advance();
  h.reconcile([
    root,
    ...Array.from({ length: 300 }, (_, i) =>
      helper("closed-" + String(i), { lineageState: "closed" }),
    ),
  ]);
  // Inspect retained collection sizes to verify the required memory bounds.
  const retained = h.owner as unknown as {
    transitions: Map<string, unknown>;
    tombstones: Set<string>;
    domains: Map<string, unknown>;
  };
  assert.equal(retained.tombstones.size, 256);
  assert.equal(retained.transitions.size, 0);
  h.reconcile(
    [root],
    h.snapshot(
      [root],
      Object.fromEntries(
        Array.from({ length: 20 }, (_, i) => [
          String(i),
          { health: "available", observedAt: h.now() },
        ]),
      ),
    ),
  );
  assert.equal(retained.domains.size, 21);
  h.reconcile([root]);
  assert.equal(retained.domains.size, 1);
  h.owner.reset();
  assert.equal(retained.domains.size, 0);
  assert.equal(retained.tombstones.size, 0);
  h.owner.dispose();
  assert.equal(retained.transitions.size, 0);
});

test("the existing single deadline expires proof for an empty remote host", () => {
  const h = harness();
  h.state.active = true;
  let scheduled: (() => void) | undefined,
    delay = 0,
    renders = 0,
    canceled = 0;
  const deadline = new FreshnessDeadline({
    state: h.state,
    now: h.now,
    hasMailPanel: () => false,
    scheduler: {
      interval: () => {
        throw new Error("No second scheduler");
      },
      timeout: (callback, milliseconds) => {
        scheduled = callback;
        delay = milliseconds;
        return () => {
          canceled++;
        };
      },
    },
    render: () => {
      renders++;
    },
  });
  const snapshot = h.snapshot([root], {
    empty: { health: "available", observedAt: h.now() - 5000 },
  });
  h.state.latest = snapshot;
  deadline.arm(snapshot);
  assert.equal(delay, 1001);
  h.advance(1001);
  assert(scheduled);
  scheduled();
  assert.equal(renders, 1);
  deadline.arm(h.snapshot([root]));
  deadline.clear();
  assert.equal(canceled, 1);
});
test("source domains recover independently, including empty hosts and metadata-only expiry", () => {
  const h = harness();
  h.reconcile([root], h.snapshot([root], { remote: { health: "unavailable", observedAt: 0 } }));
  h.advance();
  const local = helper("local", {
    taskEvidence: { state: "partial", source: "spawn", observedAt: h.now() },
  });
  h.reconcile(
    [root, local],
    h.snapshot([root, local], { remote: { health: "unavailable", observedAt: 0 } }),
  );
  assert.equal(h.owner.phase(local.id), "entering");
  const remote = helper("remote", {
    host: "remote",
    taskEvidence: { state: "available", source: "spawn", observedAt: h.now() },
  });
  h.advance();
  h.reconcile(
    [root, local, remote],
    h.snapshot([root, local, remote], { remote: { health: "available", observedAt: h.now() } }),
  );
  assert.equal(h.owner.phase(remote.id), "present");
  const old = h.snapshot([root, local, remote], {
    remote: { health: "available", observedAt: h.now() },
  });
  h.advance(FRESH_MS + 1);
  h.reconcile([root, local, remote], {
    ...old,
    data: {
      ...old.data,
      sessions: [root, local, remote],
      health: "available",
      observedAt: h.now(),
    },
  });
  assert.equal(
    h.owner.phase(local.id),
    "entering",
    "stale evidence freezes a transient until recovery",
  );
  h.advance();
  const next = helper("next", {
    host: "remote",
    taskEvidence: { state: "available", source: "spawn", observedAt: h.now() },
  });
  h.reconcile(
    [root, remote, next],
    h.snapshot([root, remote, next], { remote: { health: "available", observedAt: h.now() } }),
  );
  assert.equal(h.owner.phase(next.id), "present", "first recovery seeds history");
  h.advance();
  const proved = helper("proved", {
    ...next,
    id: "proved",
    taskEvidence: { ...next.taskEvidence, observedAt: h.now() },
  });
  h.reconcile(
    [root, remote, next, proved],
    h.snapshot([root, remote, next, proved], {
      remote: { health: "available", observedAt: h.now() },
    }),
  );
  assert.equal(h.owner.phase(proved.id), "entering");
  h.advance();
  const closedRemote = { ...proved, lifecycleEvidence: { state: "closed" } };
  const localDown = h.snapshot([root, remote, next, closedRemote], {
    remote: { health: "available", observedAt: h.now() },
  });
  if (localDown.data?.sources)
    localDown.data.sources.herdr = { health: "unavailable", observedAt: 0 };
  h.reconcile([root, remote, next, closedRemote], localDown);
  assert.equal(
    h.owner.phase(proved.id),
    "returning",
    "remote closure continues while local Herdr is unavailable",
  );
});
