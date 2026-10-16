import { test, expect } from "bun:test";
import { buildPanel, createInspector, formatDuration, statRows, turnParts } from "./inspector.js";
import type { FixtureNode } from "./inspector/dom.fixture.js";
import { fixtureDocument } from "./inspector/dom.fixture.js";
import type { QuerySnapshot, QuerySpec } from "./queryspine/types.js";
import type { RosterDescription } from "./inspector/types.js";
function queryFixture() {
  const specs = new Map<string, QuerySpec>(),
    listeners = new Map<string, (snapshot: QuerySnapshot) => void>();
  return {
    specs,
    listeners,
    define(key: string, spec: QuerySpec) {
      specs.set(key, spec);
    },
    subscribe(key: string, listener: (snapshot: QuerySnapshot) => void) {
      listeners.set(key, listener);
      return () => {
        listeners.delete(key);
      };
    },
  };
}
function snapshot(text: string, extra: Record<string, unknown> = {}): QuerySnapshot {
  return {
    key: "observer.inspect.obs_a",
    path: "/inspect",
    hasData: true,
    data: {
      id: "obs_a",
      health: "available",
      inspectionIdentity: "claude:s1",
      generation: "g1",
      asOf: "2026-10-11T10:00:00.000Z",
      turns: [{ id: "t1", role: "assistant", text }],
      ...extra,
    },
    updatedAt: 0,
    ageMs: 0,
    stale: false,
    error: null,
    errorAt: 0,
    pending: false,
  };
}
function fixture() {
  const panel = buildPanel(fixtureDocument, 1),
    query = queryFixture();
  let row: RosterDescription | null = {
    name: "Claude",
    status: "working",
    stale: false,
    title: "Ship inspector",
    meta: ["p1", "", "wt"],
    identity: "claude:s1",
    inventory: "available",
  };
  const inspector = createInspector({
    get: panel.get,
    document: fixtureDocument,
    QuerySpine: query,
    describe: () => row,
  });
  const feed = (value: QuerySnapshot) => {
    query.listeners.get("observer.inspect.obs_a")?.(value);
  };
  return {
    panel,
    query,
    inspector,
    feed,
    change: (next: RosterDescription | null) => {
      row = next;
    },
  };
}
function textOf(node: FixtureNode): string {
  return node.children.length > 0 ? node.children.map(textOf).join(" ") : (node.textContent ?? "");
}
test("inspector stats and turns state missing evidence and never expose undocumented fields", () => {
  expect(formatDuration(3723000)).toBe("1h 02m");
  expect(formatDuration(-1)).toBeNull();
  const stats = statRows({
    inputTokens: { value: null, state: "available" },
    outputTokens: { value: 890, state: "partial" },
  });
  expect(stats.find((row) => row.key === "inputTokens")).toEqual({
    key: "inputTokens",
    label: "Input tokens",
    state: "unavailable",
    text: "Unavailable",
  });
  expect(stats.find((row) => row.key === "outputTokens")).toEqual({
    key: "outputTokens",
    label: "Output tokens",
    state: "partial",
    text: "890 · partial",
  });
  expect(turnParts({ id: "t1", role: "unknown", text: "Unproven" })).toBeNull();
  const loaded = true;
  expect(
    turnParts({ id: "t1", role: "unknown", text: "Visible", reasoning: "secret" }, loaded),
  ).toMatchObject({ label: "LOADED UI TEXT", text: "Visible" });
  expect(
    JSON.stringify(turnParts({ id: "t1", role: "assistant", text: "Public", reasoning: "secret" })),
  ).not.toContain("secret");
});
test("polls name exact identity and pause preserves transcript state until resumed", () => {
  const { panel, query, inspector, feed } = fixture();
  inspector.open("obs_a", "claude:s1");
  expect(query.specs.get("observer.inspect.obs_a")).toMatchObject({
    path: "/api/observer/sessions/obs_a/inspect?identity=claude%3As1",
    retainOnUnsubscribe: false,
  });
  feed(snapshot("<script>plain</script>"));
  const log = panel.get("inspector-log"),
    first = log.children[0];
  expect(textOf(log)).toContain("<script>plain</script>");
  feed(snapshot("<script>plain</script>"));
  expect(log.children[0]).toBe(first);
  panel.get("inspector-pause").click();
  feed(snapshot("New held"));
  expect(textOf(log)).not.toContain("New held");
  expect(panel.get("inspector-buffer").textContent).toBe("Paused");
  panel.get("inspector-pause").click();
  expect(textOf(log)).toContain("New held");
  inspector.cover();
  expect(query.listeners.size).toBe(0);
  expect(textOf(log)).toContain("New held");
  inspector.reveal();
  expect(query.listeners.size).toBe(1);
});
test("foreign proof and roster replacement lock content across hide/show cycles", () => {
  const { panel, query, inspector, feed, change } = fixture();
  inspector.open("obs_a", "claude:s1");
  feed(snapshot("Owned"));
  feed(snapshot("Foreign", { inspectionIdentity: "claude:s2" }));
  expect(textOf(panel.get("inspector-log"))).toBe("");
  expect(query.listeners.size).toBe(0);
  inspector.suspend();
  inspector.resume();
  expect(query.listeners.size).toBe(0);
  inspector.open("obs_a", "claude:s1");
  feed(snapshot("Owned"));
  change(null);
  inspector.roster();
  expect(textOf(panel.get("inspector-log"))).toBe("");
  expect(query.listeners.size).toBe(0);
});
test("loaded window snapshots withdraw before refresh and cannot be held by Pause", () => {
  const { panel, inspector, feed } = fixture();
  inspector.open("obs_a", "claude:s1");
  feed(snapshot("Loaded", { provenance: { kind: "loaded-ui", identity: "window-snapshot" } }));
  expect(panel.get("inspector-pause").disabled).toBeTruthy();
  expect(textOf(panel.get("inspector-log"))).toContain("Loaded");
  feed({ ...snapshot("Loaded"), pending: true });
  expect(textOf(panel.get("inspector-log"))).toBe("");
  inspector.cover();
  inspector.reveal();
  feed(snapshot("Refreshed", { provenance: { kind: "loaded-ui", identity: "window-snapshot" } }));
  expect(textOf(panel.get("inspector-log"))).toContain("Refreshed");
  inspector.suspend();
  expect(textOf(panel.get("inspector-log"))).toBe("");
});
