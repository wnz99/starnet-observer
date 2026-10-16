import { expect, test } from "bun:test";
import { fixtureEvent } from "../environment.fixture.js";
import { row, RosterFixture } from "./roster.fixture.js";
const FRESH_OBSERVATION = false,
  STALE_OBSERVATION = true;

test("nested checkout/folder grouping keeps exact repository identities and helper order", () => {
  const f = new RosterFixture();
  const rows = [
    row("root"),
    row("helper", { source: "helper", parentId: "root", title: "Helper", paneId: null }),
    row("second", { repoId: "repo:b5678", checkoutId: "checkout:other", folder: "lib" }),
  ];
  const originalActivity = f.state.model.activity;
  let activityCalls = 0;
  f.state.model.activity = (row) => {
    activityCalls += 1;
    return originalActivity(row);
  };
  f.inventory(rows);
  f.roster.render(rows, FRESH_OBSERVATION, [], null);
  expect(activityCalls).toBe(rows.length);
  expect(f.nodes(".project-group")).toHaveLength(1);
  expect(f.nodes(".project-total").map((node) => node.textContent)).toEqual(["2 +1 helper"]);
  expect(f.nodes(".checkout-heading").map((node) => node.textContent)).toEqual([
    "Repo · Main checkout",
    "Repo · Main checkout",
  ]);
  expect(f.nodes(".folder-heading").map((node) => node.textContent)).toEqual(["src", "lib"]);
  expect(f.nodes(".session-row").map((node) => node.dataset.sessionId)).toEqual([
    "root",
    "helper",
    "second",
  ]);
  expect(f.nodes(".repo-toggle").map((node) => node.textContent)).toEqual([
    "Repo · 1234",
    "Repo · 5678",
  ]);
  f.nodes(".repo-toggle").forEach((node) => {
    node.click();
  });
  expect(f.repositories).toEqual(["repo:a1234", "repo:b5678"]);
  expect(f.nodes(".session-item")[1]?.properties.get("--depth")).toBe("1");
  f.roster.dispose();
  f.controls.dispose();
});

test("keyed equal-content updates reuse nodes; status reorder restores actual focus and scroll", () => {
  const f = new RosterFixture(),
    rows = [row("first"), row("second", { status: "idle" })];
  f.inventory(rows);
  f.roster.render(rows, FRESH_OBSERVATION, [], null);
  const inspect = f.roster.inspectTrigger("first"),
    section = f.node(".project-group"),
    items = f.nodes(".session-item");
  if (!inspect) throw new Error("Missing first inspector");
  inspect.focus();
  f.document.node("sessions").scrollTop = 321;
  const focusCalls = inspect.focusCalls.length;
  f.inventory(rows.map((row) => ({ ...row })));
  f.roster.render(
    rows.map((row) => ({ ...row })),
    FRESH_OBSERVATION,
    [],
    null,
  );
  expect(f.roster.inspectTrigger("first")).toBe(inspect);
  expect(inspect.focusCalls).toHaveLength(focusCalls);
  expect(f.node(".project-group")).toBe(section);
  expect(f.nodes(".session-item")).toEqual(items);
  const reordered = [
    row("first", { status: "idle", title: "New task" }),
    row("second", { status: "blocked" }),
  ];
  f.inventory(reordered);
  f.roster.render(reordered, FRESH_OBSERVATION, [], null);
  expect(f.nodes(".session-row").map((node) => node.dataset.sessionId)).toEqual([
    "second",
    "first",
  ]);
  expect(f.document.activeElement).toBe(inspect);
  expect(inspect.focusCalls.at(-1)).toEqual({ preventScroll: true });
  expect(f.document.node("sessions").scrollTop).toBe(321);
  const regrouped = [
    row("first", { projectId: "project:new", project: "Elsewhere" }),
    row("second", { status: "blocked", projectId: "project:new", project: "Elsewhere" }),
  ];
  f.inventory(regrouped);
  f.roster.render(regrouped, FRESH_OBSERVATION, [], null);
  expect(f.roster.inspectTrigger("first")).toBe(inspect);
  expect(f.document.activeElement).toBe(inspect);
  f.roster.scrollTo("first");
  expect(
    f.nodes(".session-row").find((node) => node.dataset.sessionId === "first")?.scrollCalls,
  ).toEqual([{ block: "nearest" }]);
  f.roster.dispose();
  f.controls.dispose();
});

test("search/filter preserve cached rows and unfiltered repository toggles; removed identities release events", () => {
  const f = new RosterFixture(),
    rows = [row("first"), row("second", { title: "Needle", repoId: "repo:b5678" })];
  f.inventory(rows);
  f.roster.render(rows, FRESH_OBSERVATION, [], null);
  const first = f.roster.inspectTrigger("first"),
    buttons = f.nodes("button"),
    callbacks = buttons.flatMap((node) => node.added.map((event) => event.listener));
  f.document.node("search").value = " needle ";
  f.roster.render(rows, FRESH_OBSERVATION, [], null);
  expect(f.nodes(".session-row").map((node) => node.dataset.sessionId)).toEqual(["second"]);
  expect(f.nodes(".repo-toggle")).toHaveLength(2);
  expect(f.roster.inspectTrigger("first")).toBe(first);
  f.document.node("search").value = "";
  f.roster.render(rows, FRESH_OBSERVATION, [], null);
  expect(f.roster.inspectTrigger("first")).toBe(first);
  f.inventory([]);
  f.roster.render([], FRESH_OBSERVATION, [], null);
  expect(f.roster.inspectTrigger("first")).toBeNull();
  for (const button of buttons) expect(button.removed).toHaveLength(button.added.length);
  for (const callback of callbacks) callback(fixtureEvent());
  expect(f.selected).toEqual([]);
  expect(f.repositories).toEqual([]);
  expect(f.zooms).toEqual([]);
  expect(f.posts).toEqual([]);
  expect(f.toggles).toEqual([]);
  f.inventory(rows);
  f.roster.render(rows, FRESH_OBSERVATION, [], null);
  expect(f.roster.inspectTrigger("first")).not.toBe(first);
  f.roster.dispose();
  f.controls.dispose();
});

test("title and magnifier preserve exact panel guard, selection, ARIA and presentation behavior", () => {
  const f = new RosterFixture(),
    rows = [row("first", { inspectionIdentity: "codex:session" })];
  f.inventory(rows);
  f.roster.render(rows, FRESH_OBSERVATION, [], null);
  const title = f.node(".row-title"),
    inspect = f.node(".row-inspect");
  title.click();
  expect(f.selected).toEqual([]);
  expect(f.toggles[0]).toEqual({
    target: { kind: "agent", id: "first", identity: "codex:session" },
    trigger: title,
  });
  inspect.click();
  expect(f.selected).toEqual(["first"]);
  f.open();
  f.roster.render(rows, FRESH_OBSERVATION, [], null);
  inspect.click();
  expect(f.selected).toEqual(["first"]);
  expect(title.attributes.get("aria-controls")).toBe("test-agent-panel");
  expect(inspect.attributes.get("aria-expanded")).toBe("true");
  f.close();
  f.roster.render(rows, FRESH_OBSERVATION, [], null);
  expect(title.attributes.has("aria-controls")).toBeFalsy();
  const snapshot = f.state.latest?.data;
  if (!snapshot) throw new Error("Missing inventory");
  snapshot.presentation = { label: "Masked" };
  f.roster.render(rows, FRESH_OBSERVATION, [], null);
  expect(title.disabled).toBeTruthy();
  expect(inspect.disabled).toBeTruthy();
  const toggles = f.toggles.length;
  title.click();
  inspect.click();
  expect(f.toggles).toHaveLength(toggles);
  f.roster.dispose();
  f.controls.dispose();
});

test("controls read latest source proof, keep pending disabled across paints, and confirm exact close", async () => {
  const f = new RosterFixture(),
    rows = [row("first", { status: "blocked" })];
  f.inventory(rows);
  f.roster.render(rows, FRESH_OBSERVATION, [], null);
  const attach = f.node(".row-attach"),
    close = f.node(".row-close");
  expect(attach.className).toBe("row-attach prominent");
  attach.click();
  expect(f.posts.map((post) => [post.path, post.payload])).toEqual([
    ["/api/control/attach", { paneId: "first" }],
  ]);
  f.roster.render(rows, FRESH_OBSERVATION, [], null);
  expect(attach.disabled).toBeTruthy();
  attach.click();
  expect(f.posts).toHaveLength(1);
  f.responses[0]?.({});
  await Promise.resolve();
  await Promise.resolve();
  expect(attach.disabled).toBeFalsy();
  f.window.confirmResult = false;
  close.click();
  expect(f.posts).toHaveLength(1);
  expect(f.window.confirmations).toEqual([
    "Stop Codex · Task first in pane first?\n\nThis closes the Herdr pane and ends the Codex session.",
  ]);
  f.window.confirmResult = true;
  close.click();
  expect(f.posts[1]?.payload).toEqual({ paneId: "first" });
  f.responses[1]?.({});
  await Promise.resolve();
  await Promise.resolve();
  f.scheduler.advance(6001);
  attach.click();
  close.click();
  f.node(".project-spawn").click();
  expect(f.posts).toHaveLength(2);
  expect(f.document.node("control-notice").textContent).toBe(
    "No Herdr pane in this project to start from",
  );
  f.roster.render(rows, STALE_OBSERVATION, [], null);
  expect(attach.hidden).toBeTruthy();
  expect(close.hidden).toBeTruthy();
  expect(f.node(".status").textContent).toBe("was waiting");
  f.roster.dispose();
  f.controls.dispose();
});

test("tool/mail optional evidence ages separately; helper lifecycle composes with native pane", () => {
  const f = new RosterFixture();
  const rows = [
    row("first", {
      source: "helper",
      parentId: "parent",
      lineageState: "linked",
      taskEvidence: { state: "available", summary: "Repair", source: "native", observedAt: 0 },
      lifecycleEvidence: { state: "closed", reason: "killed" },
      taskStatusEvidence: { status: "failed", source: "native", observedAt: 0 },
      tool: {
        available: true,
        observedAt: 0,
        last: { name: "Read", phase: "finished", outcome: "success", at: 0 },
      },
    }),
  ];
  f.inventory(rows);
  f.roster.render(
    rows,
    FRESH_OBSERVATION,
    [
      { id: 1, to: "first" },
      { id: 2, to: "first", relay: { state: "expired", machine: "remote", direction: "outbound" } },
      { id: 3, to: "first", acknowledgedAt: 1 },
    ],
    { window: 7 },
  );
  expect(f.node(".row-mail").textContent).toBe("✉ 1 unacknowledged message · recent 7");
  expect(f.node(".row-title").textContent).toBe("Repair");
  expect(f.node(".row-meta").children[0]?.textContent).toBe(
    "first · link linked · killed · task failed",
  );
  expect(f.node(".row-summary").textContent).toBe("Last observed: reading files · finished");
  f.scheduler.advance(6001);
  const refreshed = rows.map((row) => ({ ...row, observedAt: 6001 }));
  f.inventory(refreshed);
  f.roster.render(refreshed, FRESH_OBSERVATION, [], null);
  expect(f.node(".row-summary").textContent).toBe("Tool detail unavailable");
  expect(f.nodes(".row-mail")).toHaveLength(0);
  expect(f.node(".status").textContent).toBe("working");
  f.roster.dispose();
  f.controls.dispose();
});

test("hidden and terminal callbacks stay inert; disposal releases every owned listener and node", () => {
  const f = new RosterFixture(),
    rows = [row("first")];
  f.inventory(rows);
  f.roster.render(rows, FRESH_OBSERVATION, [], null);
  const buttons = f.nodes("button"),
    callbacks = buttons.flatMap((node) => node.added.map((event) => event.listener));
  f.state.active = false;
  for (const callback of callbacks) callback(fixtureEvent());
  expect(f.posts).toEqual([]);
  expect(f.selected).toEqual([]);
  expect(f.toggles).toEqual([]);
  f.roster.dispose();
  f.roster.dispose();
  f.state.active = true;
  for (const button of buttons) expect(button.removed).toHaveLength(button.added.length);
  for (const callback of callbacks) callback(fixtureEvent());
  f.roster.render(rows, FRESH_OBSERVATION, [], null);
  f.roster.scrollTo("first");
  expect(f.nodes(".project-group")).toHaveLength(0);
  expect(f.roster.inspectTrigger("first")).toBeNull();
  expect(f.posts).toEqual([]);
  expect(f.selected).toEqual([]);
  expect(f.repositories).toEqual([]);
  expect(f.zooms).toEqual([]);
  expect(f.toggles).toEqual([]);
  f.controls.dispose();
});

test("fresh project spawn uses matching live Herdr seed; disabled controls expose no action buttons", async () => {
  const f = new RosterFixture(),
    rows = [row("desktop", { source: "desktop" }), row("live")];
  f.inventory(rows);
  f.roster.render(rows, FRESH_OBSERVATION, [], null);
  f.node(".project-spawn").click();
  expect(f.posts.map((post) => [post.path, post.payload])).toEqual([
    ["/api/control/spawn", { paneId: "live" }],
  ]);
  f.responses[0]?.({ paneId: "spawned" });
  await Promise.resolve();
  await Promise.resolve();
  expect(f.spawned).toEqual(["spawned"]);
  f.roster.dispose();
  f.controls.dispose();
  const readonly = new RosterFixture({ enabled: false });
  readonly.inventory(rows);
  readonly.roster.render(rows, FRESH_OBSERVATION, [], null);
  expect(readonly.nodes(".row-attach")).toHaveLength(0);
  expect(readonly.nodes(".row-close")).toHaveLength(0);
  expect(readonly.nodes(".project-spawn")).toHaveLength(0);
  readonly.roster.dispose();
  readonly.controls.dispose();
});

test("checkout collisions extend opaque suffixes and empty states distinguish filtering from unavailable inventory", () => {
  const f = new RosterFixture(),
    rows = [
      row("one", { checkoutId: "checkout:A1234" }),
      row("two", { checkoutId: "checkout:B1234" }),
    ];
  f.inventory(rows);
  f.roster.render(rows, FRESH_OBSERVATION, [], null);
  expect(f.nodes(".checkout-heading").map((node) => node.textContent)).toEqual([
    "Repo · Main checkout · A1234",
    "Repo · Main checkout · B1234",
  ]);
  f.state.filter = "blocked";
  f.roster.render(rows, FRESH_OBSERVATION, [], null);
  expect(f.document.node("empty").hidden).toBeFalsy();
  expect(f.document.node("empty").textContent).toBe("No sessions match this filter.");
  f.inventory([]);
  f.roster.render([], STALE_OBSERVATION, [], null);
  expect(f.document.node("empty").textContent).toBe("Waiting for an available inventory.");
  f.roster.render([], FRESH_OBSERVATION, [], null);
  expect(f.document.node("empty").textContent).toBe("No Codex or Claude panes found in Herdr.");
  f.state.latest = null;
  f.roster.render([], STALE_OBSERVATION, [], null);
  expect(f.document.node("empty").hidden).toBeTruthy();
  f.roster.dispose();
  f.controls.dispose();
});
