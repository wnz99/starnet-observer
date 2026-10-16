import assert from "node:assert/strict";
import { test } from "bun:test";
import { createModel } from "./model.js";
import { canonicalTheme } from "./theme.fixture.js";
import { expect } from "bun:test";
import type { LayoutRow, DisplayRow } from "./model/types.js";
function at<T>(values: readonly T[], index: number): T {
  const value = values[index];
  assert.ok(value !== undefined);
  return value;
}
const fresh = false,
  stale = true;
const Model = createModel(canonicalTheme());
test("original model checkout suffix collision proofs", () => {
  // Canonical checkout IDs can share their last four hash characters. Only extend the collision.
  {
    const ids = [
      "checkout_7785594026262a4b150b",
      "checkout_95a43a6b39b11304150b",
      "checkout_otherabcd",
    ];
    for (const peers of [ids, ids.slice().reverse(), [...ids, ids[0]]]) {
      assert.deepEqual(
        ids.map((id) => Model.checkoutSuffix(id, peers)),
        ["b150b", "4150b", "abcd"],
      );
    }
    assert.equal(
      Model.checkoutSuffix(null, ids),
      "",
      "missing checkout proof has no discriminator",
    );
  }
});
test("original model activity and source title evidence", () => {
  assert.equal(Model.activity({ tool: { available: false } }), "Tool detail unavailable");
  assert.equal(
    Model.activity({
      tool: { available: true, last: { name: "Bash", phase: "started", outcome: null, at: null } },
    }),
    "Last observed: running a command · result not yet observed",
  );
  assert.equal(
    Model.activity({
      tool: {
        available: true,
        last: { name: "apply_patch", phase: "finished", outcome: "error", at: null },
      },
    }),
    "Last observed: editing files · error",
  );
  assert.equal(Model.age(null), "");
  assert.equal(Model.age(1000, 4000), "3s ago");
  assert.equal(
    Model.hoverLabel({ provider: "claude", title: "" }),
    "Claude — title not yet published by Herdr",
  );
  assert.equal(
    Model.hoverLabel({ provider: "claude", title: " Claude " }),
    "Claude — title not yet published by Herdr",
    "a provider-only title is unpublished",
  );
  assert.equal(
    Model.hoverLabel({ provider: "claude", title: "Claude review pass" }),
    "Claude — Claude review pass",
  );
  assert.equal(
    Model.hoverLabel({ provider: "claude", title: "Claude Code" }),
    "Claude — title not yet published by Herdr",
    "the Claude Code startup title is not a task summary",
  );
  assert.equal(Model.taskTitle({ title: "claude  code" }), null);
  assert.equal(
    Model.hoverLabel({ provider: "codex", title: "Ship it" }, stale),
    "Codex — Ship it · stale",
  );
});
test("original model source-aware desktop and helper labels", () => {
  assert.match(
    Model.hoverLabel({
      source: "desktop",
      provider: "chatgpt",
      title: "A private title",
      status: "unknown",
      inventoryHealth: "unavailable",
      observedAt: "2026-01-01",
    }),
    /ChatGPT.*A private title.*unknown.*stale.*last observed/,
  );
  assert.match(
    Model.hoverLabel({
      source: "helper",
      provider: "codex",
      taskEvidence: { state: "unavailable", summary: null, source: null, observedAt: null },
      status: "unknown",
    }),
    /Codex.*task unavailable.*unknown/,
  );

  assert.equal(
    Model.hoverLabel(
      {
        source: "helper",
        provider: "codex",
        title: "Ada",
        task: "Task unavailable.",
        status: "unknown",
        observedAt: 1000,
      },
      fresh,
      4000,
    ),
    "Codex — Ada · task unavailable · unknown · last observed 3s ago",
  );
});
test("original model authoritative group-only root", () => {
  {
    const layout = Model.createLayout();
    layout.reconcile([
      {
        id: "group-only-pane",
        source: "herdr",
        projectId: "parent",
        repoId: "repo",
        status: "idle",
      },
    ]);
    assert.equal(
      layout.seatFor("group-only-pane"),
      0,
      "authoritative group-only pane beyond represented lineage remains an ordinary root",
    );
    assert.equal(at(at(layout.onPage(0), 0).rows, 0).kind, "session");
  }
});
test("original model idle age vitality and labels", () => {
  {
    // Idle age: fresh under ten minutes, log-eased, quantised, capped at eight hours; working and untimed rows never age.
    const now = 100 * 3600000,
      minutes = (m: number) => now - m * 60000,
      idle = (m: number, extra: DisplayRow = {}) =>
        Model.idleAge({ status: "idle", lastActivityAt: minutes(m), ...extra }, now);
    assert.deepEqual(
      idle(9),
      { ms: 9 * 60000, level: 0, vigour: 1, label: "" },
      "under ten minutes is fresh",
    );
    // Sparkle vigour: a longer clock than the tint, so today, yesterday and last week still differ; eighths; none at 3 days.
    const vigour = [9, 60, 480, 24 * 60, 48 * 60, 72 * 60, 200 * 60].map((m) => idle(m).vigour);
    assert.deepEqual(
      vigour,
      [...vigour].sort((a, b) => b - a),
      "vigour only fades with time",
    );
    assert.equal(vigour[0], 1);
    assert.ok(at(vigour, 2) > 0.4, "still lively at eight hours");
    assert.ok(
      at(vigour, 3) > at(vigour, 4) && at(vigour, 4) > 0,
      "a day and two days apart differ",
    );
    assert.equal(idle(72 * 60).vigour, 0);
    assert.equal(idle(200 * 60).vigour, 0, "no sparks after three days");
    assert.ok(
      vigour.every((value) => Number.isInteger(Math.round(value * 8 * 1e9) / 1e9)),
      "vigour is quantised to eighths",
    );
    assert.equal(
      Model.idleAge({ status: "working", lastActivityAt: minutes(6000) }, now).vigour,
      1,
      "working is always lively",
    );
    assert.equal(Model.idleAge({ status: "idle" }, now).vigour, 1, "untimed rows are not faded");
    assert.equal(idle(11).label, "idle 11m");
    assert.equal(idle(192).label, "idle 3h 12m");
    assert.equal(idle(26 * 60).label, "idle 1d 2h");
    const levels = [11, 30, 60, 120, 240, 480, 2000].map((m) => idle(m).level);
    assert.deepEqual(
      levels,
      [...levels].sort((a, b) => a - b),
      "age only darkens with time",
    );
    assert.equal(idle(480).level, 1);
    assert.equal(idle(5000).level, 1, "capped at eight hours");
    assert.ok(
      levels.every((level) => Number.isInteger(level * 6)),
      "levels are quantised to sixths",
    );
    assert.equal(
      Model.idleAge({ status: "working", lastActivityAt: minutes(600) }, now).level,
      0,
      "a working pane is active now",
    );
    assert.equal(Model.idleAge({ status: "idle" }, now).level, 0, "no timestamp, no age");
    assert.equal(
      Model.idleAge({ status: "idle", lastActivityAt: now + 60000 }, now).level,
      0,
      "a future time is fresh",
    );
    assert.equal(
      Model.hoverLabel(
        {
          provider: "claude",
          source: "herdr",
          status: "idle",
          title: "Ship it",
          lastActivityAt: minutes(192),
        },
        fresh,
        now,
      ),
      "Claude — Ship it · idle 3h 12m",
    );
    assert.equal(
      Model.hoverLabel(
        {
          provider: "claude",
          source: "herdr",
          status: "idle",
          title: "Ship it",
          lastActivityAt: minutes(2),
        },
        fresh,
        now,
      ),
      "Claude — Ship it",
    );
  }
});

const worker = (id: number, project = "A"): LayoutRow => ({
  id: `${project}_${String(id)}`,
  projectId: project,
  project,
});
test("layout preserves desks across reorder/removal/growth and annex color identity", () => {
  const model = createModel(canonicalTheme());
  const layout = model.createLayout();
  const rows = Array.from({ length: 25 }, (_, index) => worker(index));
  layout.reconcile(rows.slice(0, 24));
  const seats = rows.slice(0, 24).map((row) => layout.seatFor(row.id));
  layout.reconcile(rows);
  expect(rows.slice(0, 24).map((row) => layout.seatFor(row.id))).toEqual(seats);
  expect(layout.seatFor("A_24")).toBe(24);
  expect(layout.onPage(0).map((room) => room.floor)).toEqual([
    layout.colorFor("A").floor,
    layout.colorFor("A").floor,
  ]);
  expect(layout.reconcile(rows.slice().reverse()).changed).toBeFalsy();
  layout.reconcile(rows.filter((row) => row.id !== "A_5"));
  layout.reconcile([...rows.filter((row) => row.id !== "A_5"), worker(99)]);
  expect(layout.seatFor("A_99")).toBe(5);
});
test("project hues remain unique per deck; remote ships keep independent room slots", () => {
  const layout = createModel(canonicalTheme()).createLayout();
  const rows = Array.from({ length: 40 }, (_, index) => worker(0, `project_${String(index)}`));
  layout.reconcile(rows);
  expect(layout.pages()).toBe(5);
  for (let page = 0; page < layout.pages(); page++) {
    const rooms = layout.onPage(page);
    expect(new Set(rooms.map((room) => room.floor)).size).toBe(rooms.length);
  }
  const separate = createModel(canonicalTheme()).createLayout();
  separate.reconcile([worker(0), { ...worker(1), host: "remote" }]);
  expect(separate.onPage(0).map((room) => room.slot)).toEqual([0, 0]);
});
test("helper chains resolve exact roots, bounded stations never manufacture rooms", () => {
  const layout = createModel(canonicalTheme()).createLayout();
  const helpers: LayoutRow[] = Array.from({ length: 10 }, (_, index) => ({
    id: `helper_${String(index)}`,
    parentId: index === 0 ? "A_0" : `helper_${String(index - 1)}`,
    source: "helper",
  }));
  layout.reconcile([
    worker(0),
    ...helpers,
    { id: "orphan", parentId: "missing", source: "helper" },
  ]);
  const rows = layout.onPage(0).flatMap((room) => room.rows);
  expect(rows).toHaveLength(11);
  expect(rows.filter((row) => row.helperSlot !== null && row.kind === "helper")).toHaveLength(8);
  expect(rows.some((row) => row.row.id === "orphan")).toBeFalsy();
  layout.reconcile(helpers);
  expect(layout.onPage(0)).toEqual([]);
});

test("unavailable checkout proof and generic Codex title keep explicit fallback labels", () => {
  assert.equal(Model.checkoutLabel({ checkoutKind: "main" }), "Checkout unavailable");
  assert.equal(
    Model.hoverLabel({ provider: "codex", title: "Codex", source: "herdr" }),
    "Codex — title not yet published by Herdr",
  );
});
