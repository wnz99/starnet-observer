import assert from "node:assert/strict";
import { test } from "bun:test";
import { createRowFormat } from "./format.js";
import type { DisplayRow, LayoutRow } from "../model/types.js";

const row = (id: string, fields: DisplayRow = {}): LayoutRow => ({ id, ...fields });
function setup(rows: readonly LayoutRow[] = [], seats: ReadonlyMap<string, number> = new Map()) {
  let byId = new Map(rows.map((value) => [value.id, value]));
  return {
    format: createRowFormat({ seatFor: (id) => seats.get(id), byId: () => byId }),
    replace: (values: readonly LayoutRow[]) => {
      byId = new Map(values.map((value) => [value.id, value]));
    },
  };
}

test("worker names use exact parents, current seats, nickname and bounded chains", () => {
  const root = row("root", { provider: "codex" });
  const helper = row("child", { source: "helper", provider: "claude", parentId: "root" });
  const grandchild = row("grandchild", { source: "helper", parentId: "child" });
  const context = setup([root, helper, grandchild], new Map([["root", 4]]));
  assert.equal(context.format.workerName(root), "Codex · 5");
  assert.equal(context.format.workerName(helper), "Helper of Codex · 5");
  assert.equal(context.format.workerName(grandchild), "Helper of Helper of Codex · 5");
  assert.equal(context.format.workerName({ ...helper, title: "Scout" }), "Claude · helper · Scout");
  assert.equal(context.format.workerName({ ...helper, title: "Helper" }), "Helper of Codex · 5");
  assert.equal(
    context.format.workerName(row("app", { provider: "chatgpt", source: "desktop" })),
    "ChatGPT app",
  );
  assert.equal(context.format.workerName(row("unknown", { provider: "other" })), "Agent");
  assert.equal(context.format.workerName(row("orphan", { parentId: null })), "Agent · helper");
  context.replace([row("root", { source: "desktop", provider: "claude" })]);
  assert.equal(context.format.workerName(helper), "Helper of Claude app · 5");
  context.replace([row("", { provider: "claude" })]);
  assert.equal(
    context.format.workerName(row("empty-parent", { parentId: "" })),
    "Helper of Claude",
  );
  const cycle = row("cycle", { parentId: "cycle", provider: "codex" });
  context.replace([cycle]);
  assert.equal(context.format.workerName(cycle), "Helper of Helper of Helper of Codex · helper");
  assert.equal(
    context.format.workerName({ ...helper, source: "herdr", title: "Native task" }),
    "Claude · helper",
  );
});

test("inspection identity preserves explicit source identity and null before native fallback", () => {
  const { format } = setup();
  const native = { provider: "codex", sessionId: "native" };
  assert.equal(format.inspectionIdentity(native), "codex:native");
  assert.equal(format.inspectionIdentity({ ...native, inspectionIdentity: null }), null);
  assert.equal(format.inspectionIdentity({ ...native, inspectionIdentity: "" }), "");
  assert.equal(
    format.inspectionIdentity({ ...native, inspectionIdentity: "desktop:window" }),
    "desktop:window",
  );
  assert.equal(format.inspectionIdentity({ sessionId: "unresolved" }), "undefined:unresolved");
  assert.equal(format.inspectionIdentity({ ...native, sessionId: "" }), null);
});

test("task text distinguishes verified partial assignments, native titles and Desktop windows", () => {
  const { format } = setup();
  const helper: DisplayRow = { source: "helper", title: "Scout" };
  const evidence = { state: "partial", summary: "Review privacy", source: null, observedAt: null };
  assert.equal(format.taskText({ ...helper, taskEvidence: evidence }), "Review privacy (partial)");
  assert.equal(
    format.taskText({ ...helper, taskEvidence: { ...evidence, state: "available" } }),
    "Review privacy",
  );
  assert.equal(
    format.taskText({ ...helper, taskEvidence: { ...evidence, state: "unavailable" } }),
    "Task unavailable",
  );
  assert.equal(format.taskText(helper), "Task unavailable");
  assert.equal(
    format.taskText({ parentId: null, title: "Native   assignment" }),
    "Native assignment",
  );
  assert.equal(format.taskText({ parentId: null, title: "Codex" }), "Task unavailable");
  assert.equal(format.taskText({ source: "desktop", title: "Draft" }), "Draft · app window");
  assert.equal(format.taskText({ source: "desktop", title: "" }), "app window");
  assert.equal(format.taskText({ title: "Claude" }), "Title not yet published by Herdr");
  assert.equal(format.taskText({ title: "  Fix   tests " }), "Fix tests");
});

test("helper status and closure require their own positive evidence", () => {
  const { format } = setup();
  const helper: DisplayRow = { parentId: null, status: "done" };
  assert.equal(format.lifecycleText(helper), "");
  assert.equal(
    format.lifecycleText({ ...helper, lifecycleEvidence: { state: "open", reason: "killed" } }),
    "",
  );
  assert.equal(
    format.lifecycleText({ ...helper, lifecycleEvidence: { state: "closed", reason: "killed" } }),
    "killed",
  );
  assert.equal(
    format.lifecycleText({ ...helper, lifecycleEvidence: { state: "closed", reason: null } }),
    "closed",
  );
  assert.equal(
    format.lifecycleText({ lifecycleEvidence: { state: "closed", reason: "killed" } }),
    "",
  );
  for (const status of ["running", "completed", "failed", "killed", "stopped"]) {
    assert.equal(
      format.taskState({
        ...helper,
        taskStatusEvidence: { status, source: null, observedAt: null },
      }),
      "task " + status,
    );
  }
  assert.equal(
    format.taskState({
      ...helper,
      taskStatusEvidence: { status: "unknown", source: null, observedAt: null },
    }),
    "",
  );
  assert.equal(
    format.taskState({ taskStatusEvidence: { status: "running", source: null, observedAt: null } }),
    "",
  );
  assert.deepEqual(
    [
      format.composedTask(helper),
      format.composedTask({ source: "desktop" }),
      format.composedTask({}),
    ],
    [true, true, false],
  );
  assert.equal(
    format.sourceNote({ source: "desktop", parentId: null }),
    "App window · loaded UI only",
  );
  assert.equal(format.sourceNote(helper), "Helper · link unknown");
  assert.equal(
    format.sourceNote({ ...helper, lineageState: "verified" }),
    "Helper · link verified",
  );
  assert.equal(format.sourceNote({}), "");
});

test("lineage order follows exact parents before orphan and cycle fallback", () => {
  const rows = [
    row("orphan", { parentId: "missing", status: "working" }),
    row("child-z", { parentId: "root-b" }),
    row("cycle-a", { parentId: "cycle-b" }),
    row("root-b", { status: "idle" }),
    row("grandchild", { parentId: "child-a" }),
    row("root-c", { status: "working" }),
    row("child-a", { parentId: "root-b" }),
    row("cycle-b", { parentId: "cycle-a" }),
    row("root-a", { status: "idle" }),
  ];
  const { format } = setup(
    rows,
    new Map([
      ["root-b", 0],
      ["root-a", 1],
    ]),
  );
  const rank = (value: LayoutRow) => (value.status === "working" ? 0 : 1);
  assert.deepEqual(
    format.lineageOrder(rows, rank).map(([value, depth]) => [value.id, depth]),
    [
      ["root-c", 0],
      ["root-b", 0],
      ["child-a", 1],
      ["grandchild", 2],
      ["child-z", 1],
      ["root-a", 0],
      ["orphan", 1],
      ["cycle-a", 1],
      ["cycle-b", 2],
    ],
  );
  const missingSeats = [
    row("z"),
    row("a"),
    row("orphan-z", { parentId: "absent" }),
    row("orphan-a", { parentId: "" }),
  ];
  assert.deepEqual(
    format.lineageOrder(missingSeats, () => 0).map(([value, depth]) => [value.id, depth]),
    [
      ["a", 0],
      ["z", 0],
      ["orphan-a", 1],
      ["orphan-z", 1],
    ],
  );
});
