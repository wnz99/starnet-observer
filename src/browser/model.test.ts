import { test, expect } from "bun:test";
import { createModel } from "./model.js";
import { canonicalTheme } from "./theme.fixture.js";
import type { LayoutRow } from "./model/types.js";
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
test("checkout proof and observed activity retain labels and unavailable evidence", () => {
  const model = createModel(canonicalTheme());
  expect(model.checkoutSuffix("checkout_b150b", ["checkout_b150b", "checkout_4150b"])).toBe(
    "b150b",
  );
  expect(model.checkoutLabel({ checkoutKind: "main" })).toBe("Checkout unavailable");
  expect(model.hoverLabel({ provider: "codex", title: "Codex", source: "herdr" })).toBe(
    "Codex — title not yet published by Herdr",
  );
  expect(model.idleAge({ status: "working", lastActivityAt: 0 }, 1000000).level).toBe(0);
  expect(model.activity({ tool: { available: false } })).toBe("Tool detail unavailable");
});
