import assert from "node:assert/strict";
import { test, expect } from "bun:test";
import * as Inspector from "./inspector.js";
import { createQuerySpine } from "./queryspine.js";
import type { FixtureNode } from "./inspector/dom.fixture.js";
import { fixtureDocument, focusCalls } from "./inspector/dom.fixture.js";
import type { HelperDescription } from "./inspector/types.js";
import type { QuerySpec, QuerySnapshot } from "./queryspine/types.js";
function requiredValue<T>(value: T | null | undefined): T {
  assert.ok(value !== null && value !== undefined);
  return value;
}
function at<T>(values: readonly T[], index: number): T {
  return requiredValue(values[index]);
}
function required<K, V>(values: ReadonlyMap<K, V>, key: K): V {
  return requiredValue(values.get(key));
}
function textOf(node: FixtureNode): string {
  return node.children.length > 0 ? node.children.map(textOf).join(" ") : node.textContent;
}
function querySnapshot(extra: Partial<QuerySnapshot> = {}): QuerySnapshot {
  return {
    key: "observer.inspect.obs_a",
    path: "/inspect",
    hasData: true,
    data: null,
    updatedAt: 0,
    ageMs: 0,
    stale: false,
    error: null,
    errorAt: 0,
    pending: false,
    ...extra,
  };
}
interface ReadCall {
  path: string;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}
test("original inspector formatting, follow, pause, visibility locks and stable nodes", () => {
  focusCalls.length = 0;
  {
    const field = (value: unknown, state = "available") => ({ value, state });
    const rows = Inspector.statRows({
      model: field("gpt-5-codex"),
      inputTokens: field(1234567),
      outputTokens: field(890, "partial"),
      cacheReadTokens: field(null, "available"),
      cacheWriteTokens: field(null, "unavailable"),
      durationMs: field(3723000),
      startedAt: field("not a date"),
      lastActivityAt: field(new Date(Date.now() - 5000).toISOString()),
    });
    const text = new Map(rows.map((row) => [row.key, [row.state, row.text]]));
    assert.deepEqual(required(text, "model"), ["available", "gpt-5-codex"]);
    assert.deepEqual(required(text, "inputTokens"), ["available", "1,234,567"]);
    assert.deepEqual(
      required(text, "outputTokens"),
      ["partial", "890"],
      "the numeric value stays concise while its coverage state remains partial",
    );
    assert.deepEqual(
      required(text, "cacheReadTokens"),
      ["unavailable", "Unavailable"],
      "a null value is unavailable whatever its state claims",
    );
    assert.deepEqual(
      required(text, "cacheWriteTokens"),
      ["unavailable", "Unavailable"],
      "missing Codex cache write stays unavailable",
    );
    assert.deepEqual(required(text, "durationMs"), ["available", "1h 02m"]);
    assert.deepEqual(required(text, "startedAt"), ["unavailable", "Unavailable"]);
    assert.equal(required(text, "lastActivityAt")[0], "available");
    assert.match(at(required(text, "lastActivityAt"), 1), /s ago$/);
    assert(
      Inspector.statRows(null).every((row) => row.state === "unavailable"),
      "no stats object means every field unavailable",
    );
    assert.deepEqual(
      [
        Inspector.formatDuration(59000),
        Inspector.formatDuration(61000),
        Inspector.formatDuration(-1),
      ],
      ["59s", "1m 01s", null],
    );
  }

  {
    assert.equal(Inspector.turnParts({ id: "t1", role: "thinking", text: "secret" }), null);
    assert.equal(Inspector.turnParts({ role: "user", text: "no id" }), null);
    const turn = Inspector.turnParts({
      id: 7,
      role: "tool",
      at: null,
      text: "ls",
      textTruncated: true,
      thinking: "secret",
      raw: { x: 1 },
      tool: { name: "Bash", phase: "weird", outcome: "boom" },
    });
    assert.deepEqual(
      { ...turn, key: undefined },
      {
        id: "7",
        role: "tool",
        label: "TOOL",
        at: null,
        text: "ls",
        truncated: true,
        tool: { name: "Bash", phase: "started", outcome: "outcome unknown" },
        key: undefined,
      },
    );
    assert.ok(turn);
    assert(!turn.key.includes("secret"));
  }
  {
    const loadedUi = true;
    const loaded = {
      id: "g:0",
      role: "unknown",
      at: null,
      text: "window text",
      reasoning: "secret",
    };
    assert.equal(Inspector.turnParts(loaded), null, "an unknown role outside loaded UI is dropped");
    const parts = Inspector.turnParts(loaded, loadedUi);
    assert.ok(parts);
    assert.equal(parts.label, "LOADED UI TEXT");
    assert.equal(parts.role, "unknown");
    assert.equal(parts.text, "window text");
    assert.ok(!JSON.stringify(parts).includes("secret"));
    assert.ok(
      !JSON.stringify(
        Inspector.turnParts({
          id: "public",
          role: "assistant",
          text: "Public",
          reasoning: "secret",
        }),
      ).includes("secret"),
    );
    assert.equal(
      Inspector.turnParts({ id: "g:1", role: "thinking", text: "x" }, loadedUi),
      null,
      "loaded UI admits no other undocumented role",
    );
    assert.equal(
      Inspector.REASONS["loaded-ui-unavailable"],
      "No loaded conversation text could be read from this app window.",
    );
  }

  const { get: el } = Inspector.buildPanel(fixtureDocument, 1);
  const specs = new Map<string, QuerySpec>(),
    live = new Map<string, (snapshot: QuerySnapshot) => void>();
  const QuerySpine = {
    define(key: string, spec: QuerySpec) {
      specs.set(key, spec);
    },
    subscribe(key: string, fn: (snapshot: QuerySnapshot) => void) {
      live.set(key, fn);
      fn(querySnapshot({ hasData: false, data: null }));
      return () => {
        live.delete(key);
      };
    },
  };
  type RosterProof = { identity: string; inventory: string; meta?: string[] };
  const roster = new Map<string, RosterProof>([
    ["obs_a", { identity: "claude:s1", inventory: "available" }],
    ["obs_b", { identity: "codex:s2", inventory: "available" }],
  ]);
  const changes: (string | null)[] = [];
  const inspector = Inspector.createInspector({
    get: el,
    document: fixtureDocument,
    QuerySpine,
    describe: (id) =>
      roster.has(id)
        ? {
            name: id === "obs_a" ? "Claude · 1" : "Codex · 2",
            status: "working",
            stale: false,
            title: "Ship the inspector",
            meta: ["p1", "", "wt"],
            ...required(roster, id),
          }
        : null,
    onChange: (id) => {
      changes.push(id);
    },
  });
  const log = el("inspector-log");
  const turn = (id: string, role: string, text: string, extra: Record<string, unknown> = {}) => ({
    id,
    role,
    at: "2026-10-11T21:00:00.000Z",
    text,
    textTruncated: false,
    ...extra,
  });
  const snapshot = (turns: unknown[], extra: Record<string, unknown> = {}): QuerySnapshot =>
    querySnapshot({
      data: {
        id: "obs_a",
        health: "available",
        asOf: new Date().toISOString(),
        reason: null,
        stats: { model: { value: "claude-opus", state: "available" } },
        turns,
        truncated: false,
        window: { maxTurns: 200, maxTextChars: 8000 },
        generation: "g1",
        inspectionIdentity: roster.get(typeof extra.id === "string" ? extra.id : "obs_a")?.identity,
        ...extra,
      },
    });
  const feed = (key: string, value: QuerySnapshot) => {
    required(live, "observer.inspect." + key)(value);
  };
  const openRow = (id: string) => {
    inspector.open(id, roster.get(id)?.identity);
  };
  openRow("obs_a");
  expect(el("inspector").open, "an instance never shows itself: the panel stack does").toBeFalse();
  assert.equal(focusCalls.length, 0, "nor moves focus");
  assert.equal(
    required(specs, "observer.inspect.obs_a").path,
    "/api/observer/sessions/obs_a/inspect?identity=claude%3As1",
    "each read names the exact target",
  );
  expect(
    requiredValue(required(specs, "observer.inspect.obs_a").validate)({
      id: "x",
      health: "stale",
      turns: [],
    }),
    "only the contract health values are accepted",
  ).toBeFalse();
  expect(
    required(specs, "observer.inspect.obs_a").retainOnUnsubscribe,
    "a closed inspector keeps no cached conversation",
  ).toBeFalse();
  assert.equal(el("inspector-health").textContent, "Loading snapshot…");
  assert.deepEqual(changes, ["obs_a"]);

  feed(
    "obs_a",
    snapshot([
      turn("u1", "user", "<b>hi</b>", { thinking: "hidden" }),
      turn("a1", "assistant", "hello"),
      turn("t1", "tool", "npm test", {
        tool: { name: "Bash", phase: "started", outcome: "unknown" },
      }),
    ]),
  );
  assert.equal(log.children.length, 3);
  assert.equal(log.child(0).child(1).textContent, "<b>hi</b>", "text is set as text");
  assert(!textOf(log).includes("hidden"), "reasoning fields are never rendered");
  assert.equal(el("inspector-stats").child(0).child(1).textContent, "claude-opus");
  assert.equal(el("inspector-stats").child(4).dataset.state, "unavailable");
  assert.equal(log.scrollTop, log.scrollHeight, "follow keeps the newest turn in view");

  const toolNode = log.child(2);
  feed(
    "obs_a",
    snapshot([
      turn("u1", "user", "<b>hi</b>"),
      turn("a1", "assistant", "hello"),
      turn("t1", "tool", "npm test", { tool: { name: "Bash", phase: "finished", outcome: "ok" } }),
    ]),
  );
  assert.equal(log.child(2), toolNode);
  assert(textOf(toolNode).includes("Bash · finished · ok"));

  log.scrollTop = 100;
  log.emit("scroll");
  assert.equal(el("inspector-follow").attributes.get("aria-pressed"), "false");
  feed(
    "obs_a",
    snapshot([
      turn("u1", "user", "<b>hi</b>"),
      turn("a1", "assistant", "hello"),
      turn("t1", "tool", "npm test"),
      turn("a2", "assistant", "done"),
    ]),
  );
  assert.equal(log.scrollTop, 100, "a paused follow never moves the reader");
  expect(el("inspector-jump").hidden).toBeFalse();
  assert.equal(el("inspector-jump").textContent, "1 new · jump to latest");
  el("inspector-jump").emit("click");
  assert.equal(log.scrollTop, log.scrollHeight);
  expect(el("inspector-jump").hidden).toBeTrue();
  assert.equal(el("inspector-follow").attributes.get("aria-pressed"), "true");

  el("inspector-pause").emit("click");
  feed(
    "obs_a",
    snapshot(
      [
        turn("a1", "assistant", "hello"),
        turn("t1", "tool", "npm test"),
        turn("a2", "assistant", "done"),
        turn("a3", "assistant", "more"),
        turn("a4", "assistant", "again"),
      ],
      { stats: { model: { value: "claude-newer", state: "available" } }, truncated: true },
    ),
  );
  expect(
    el("inspector-truncated").hidden,
    "the window notice stays with the displayed snapshot while paused",
  ).toBeTrue();
  assert.equal(log.children.length, 4);
  assert.equal(el("inspector-buffer").textContent, "Paused · 2 new held");
  assert.equal(
    el("inspector-stats").child(0).child(1).textContent,
    "claude-opus",
    "stats stay with the displayed snapshot while paused",
  );
  assert.match(el("inspector-health").textContent, /^Paused · newer snapshot from .* held$/);
  el("inspector-pause").emit("click");
  assert.deepEqual(
    log.children.map((node) => node.dataset.turnId),
    ["a1", "t1", "a2", "a3", "a4"],
    "evicted turns leave, retained ids keep order",
  );
  assert.equal(el("inspector-buffer").textContent, "");
  assert.equal(el("inspector-stats").child(0).child(1).textContent, "claude-newer");
  expect(el("inspector-truncated").hidden).toBeFalse();

  feed(
    "obs_a",
    snapshot([turn("x1", "user", "new file", { textTruncated: true })], {
      generation: "g2",
      truncated: true,
    }),
  );
  assert.deepEqual(
    log.children.map((node) => node.dataset.turnId),
    ["x1"],
  );
  expect(el("inspector-truncated").hidden).toBeFalse();
  assert(textOf(log).includes("truncated at 8,000 characters"));

  feed(
    "obs_a",
    querySnapshot({
      hasData: true,
      data: snapshot([]).data,
      error: { name: "Error", message: "Timed out" },
    }),
  );
  assert.equal(el("inspector").dataset.health, "stale");
  assert.match(el("inspector-health").textContent, /^Stale · could not refresh/);
  assert.equal(log.children.length, 1);
  feed(
    "obs_a",
    snapshot([], { health: "unavailable", reason: "transcript-unavailable", generation: null }),
  );
  assert.equal(log.children.length, 0);
  assert.equal(el("inspector-health").textContent, Inspector.REASONS["transcript-unavailable"]);
  expect(el("inspector-empty").hidden).toBeFalse();
  feed(
    "obs_a",
    querySnapshot({ hasData: false, data: null, error: { name: "Error", message: "http 404" } }),
  );
  assert.equal(el("inspector-health").textContent, Inspector.REASONS["unknown-session"]);
  assert(el("inspector-stats").children.every((stat) => stat.dataset.state === "unavailable"));

  feed("obs_a", snapshot([turn("u1", "user", "hi"), turn("a1", "assistant", "hello")]));

  // A roster replacement withdraws its previous conversation.
  roster.set("obs_a", { identity: "codex:s9", inventory: "available" });
  inspector.roster();
  assert.equal(log.children.length, 0, "the old conversation is cleared at once");
  assert(el("inspector-stats").children.every((stat) => stat.dataset.state === "unavailable"));
  expect(
    live.has("observer.inspect.obs_a"),
    "and the replacement is not read by this panel",
  ).toBeFalse();
  assert.match(el("inspector-health").textContent, /different session/);
  openRow("obs_a");
  assert.equal(
    el("inspector-health").textContent,
    "Loading snapshot…",
    "opening the row again reads its current session",
  );
  feed("obs_a", snapshot([turn("n1", "user", "fresh")]));
  inspector.roster();
  assert.deepEqual(
    log.children.map((node) => node.dataset.turnId),
    ["n1"],
    "an unchanged identity keeps the conversation",
  );
  roster.set("obs_a", { identity: "codex:s9", inventory: "unavailable" });
  inspector.roster();
  assert.equal(log.children.length, 0);
  expect(live.has("observer.inspect.obs_a"), "an unavailable inventory stops the read").toBeFalse();
  assert.equal(el("inspector-health").textContent, Inspector.REASONS["inventory-unavailable"]);
  roster.set("obs_a", { identity: "codex:s9", inventory: "available" });
  inspector.roster();
  assert(live.has("observer.inspect.obs_a"), "recovery restarts the read");
  roster.delete("obs_a");
  inspector.roster();
  assert.equal(log.children.length, 0);
  expect(live.has("observer.inspect.obs_a")).toBeFalse();
  assert.match(el("inspector-health").textContent, /left the roster/);
  assert.equal(el("inspector-title").textContent, "Session no longer in the roster");
  roster.set("obs_a", { identity: "claude:s1", inventory: "available" });

  openRow("obs_b");
  assert(
    !live.has("observer.inspect.obs_a") && live.has("observer.inspect.obs_b"),
    "one poll at a time",
  );
  assert.equal(log.children.length, 0);
  assert.equal(el("inspector-title").textContent, "Codex · 2");
  inspector.close();
  assert.equal(live.size, 0);
  assert.equal(changes.at(-1), null);
  expect(inspector.isOpen()).toBeFalse();
  openRow("obs_a");
  el("inspector-close").emit("click");
  expect(inspector.isOpen()).toBeFalse();

  openRow("obs_a");
  const steady = snapshot([turn("s1", "user", "steady"), turn("s2", "assistant", "reply")]);
  feed("obs_a", steady);
  const steadyNode = log.child(0),
    statNode = el("inspector-stats").child(0);
  feed("obs_a", { ...steady, pending: true });
  assert.equal(log.child(0), steadyNode);
  assert.equal(
    el("inspector-stats").child(0),
    statNode,
    "a pending re-notify of the same data rebuilds nothing",
  );
  el("inspector-pause").emit("click");
  assert.equal(el("inspector-pause").attributes.get("aria-pressed"), "true");
  feed("obs_a", snapshot([turn("s1", "user", "steady"), turn("s3", "user", "held")]));
  assert.match(el("inspector-buffer").textContent, /1 new held/);
  inspector.suspend();
  expect(live.has("observer.inspect.obs_a"), "no conversation poll while hidden").toBeFalse();
  assert.equal(log.children.length, 0, "rows are withheld");
  assert(el("inspector-stats").children.every((stat) => stat.dataset.state === "unavailable"));
  assert.equal(el("inspector-buffer").textContent, "Paused", "the Pause buffer goes with the rows");
  expect(inspector.isOpen()).toBeTrue();
  assert.equal(el("inspector-pause").attributes.get("aria-pressed"), "true");
  inspector.roster();
  expect(
    live.has("observer.inspect.obs_a"),
    "a roster pass cannot restart a suspended read",
  ).toBeFalse();
  roster.set("obs_a", { identity: "claude:moved", inventory: "available" });
  inspector.roster();
  expect(
    live.has("observer.inspect.obs_a"),
    "not even for a new identity while hidden",
  ).toBeFalse();
  roster.set("obs_a", { identity: "claude:s1", inventory: "available" });
  inspector.resume();
  assert(live.has("observer.inspect.obs_a"), "the proved identity polls again");
  assert.equal(el("inspector-pause").attributes.get("aria-pressed"), "true");
  inspector.resume();
  assert.equal(el("inspector-health").textContent, "Loading snapshot…");
  inspector.suspend();
  roster.delete("obs_a");
  inspector.resume();
  expect(live.has("observer.inspect.obs_a")).toBeFalse();
  assert.match(el("inspector-health").textContent, /left the roster/);
  roster.set("obs_a", { identity: "claude:s1", inventory: "available" });
  inspector.roster();
  expect(
    live.has("observer.inspect.obs_a"),
    "a lost session stays withheld until reopened",
  ).toBeFalse();
  openRow("obs_a");
  assert(live.has("observer.inspect.obs_a"), "an explicit reopen reads again");
  inspector.suspend();
  roster.set("obs_a", { identity: "codex:replaced", inventory: "available" });
  inspector.resume();
  expect(
    live.has("observer.inspect.obs_a"),
    "a different session after hiding is not read",
  ).toBeFalse();
  assert.match(el("inspector-health").textContent, /different session/);
  assert.equal(log.children.length, 0);
  inspector.roster();
  expect(live.has("observer.inspect.obs_a"), "roster passes keep it withheld").toBeFalse();
  roster.set("obs_a", { identity: "claude:s1", inventory: "available" });
  inspector.roster();
  expect(live.has("observer.inspect.obs_a"), "even if the original session returns").toBeFalse();
  openRow("obs_a");
  assert(live.has("observer.inspect.obs_a"), "reopen inspects the current session");
  inspector.suspend();
  roster.set("obs_a", { identity: "claude:s1", inventory: "unavailable" });
  inspector.resume();
  expect(live.has("observer.inspect.obs_a")).toBeFalse();
  assert.equal(el("inspector-health").textContent, Inspector.REASONS["inventory-unavailable"]);
  roster.set("obs_a", { identity: "claude:s1", inventory: "available" });
  openRow("obs_a");
  inspector.roster();
  feed("obs_a", snapshot([turn("p1", "user", "paused view")]));
  roster.set("obs_a", { identity: "claude:other", inventory: "available" });
  inspector.roster();
  assert.equal(log.children.length, 0, "a new identity withdraws the paused conversation");
  expect(
    live.has("observer.inspect.obs_a"),
    "and, visible or not, this panel never reads the replacement",
  ).toBeFalse();
  roster.set("obs_a", { identity: "claude:s1", inventory: "available" });
  inspector.close();

  const locks: [string, () => unknown][] = [
    [
      "changed",
      () =>
        roster.set("obs_a", { identity: "codex:second-hide-replacement", inventory: "available" }),
    ],
    ["lost", () => roster.delete("obs_a")],
    ["unavailable", () => roster.set("obs_a", { identity: "claude:s1", inventory: "unavailable" })],
  ];
  for (const [label, change] of locks) {
    roster.set("obs_a", { identity: "claude:s1", inventory: "available" });
    openRow("obs_a");
    assert(live.has("observer.inspect.obs_a"), label + ": reading before the hide");
    inspector.suspend();
    change();
    inspector.resume();
    expect(
      live.has("observer.inspect.obs_a"),
      label + ": withheld after the first resume",
    ).toBeFalse();
    for (let cycle = 0; cycle < 2; cycle++) {
      inspector.suspend();
      inspector.resume();
      expect(
        live.has("observer.inspect.obs_a"),
        label + ": still withheld after hide/show " + String(cycle + 2),
      ).toBeFalse();
    }
    roster.set("obs_a", { identity: "claude:s1", inventory: "available" });
    inspector.suspend();
    inspector.resume();
    inspector.roster();
    expect(
      live.has("observer.inspect.obs_a"),
      label + ": not even when the original session is back",
    ).toBeFalse();
    openRow("obs_a");
    assert(live.has("observer.inspect.obs_a"), label + ": only an explicit open reads again");
  }
  {
    roster.set("obs_a", { identity: "claude:s1", inventory: "available" });
    openRow("obs_a");
    const activityAt = new Date(Date.now() - 60000).toISOString();
    const statsOf = (model: string, extra: Record<string, unknown> = {}) => ({
      model: { value: model, state: "available" },
      inputTokens: { value: 1200, state: "partial" },
      lastActivityAt: { value: activityAt, state: "available" },
      ...extra,
    });
    const content = [turn("e1", "user", "equal"), turn("e2", "assistant", "same")];
    feed(
      "obs_a",
      snapshot(content, {
        stats: statsOf("claude-opus"),
        asOf: new Date(Date.now() - 2000).toISOString(),
      }),
    );
    const statGroups = el("inspector-stats").children.slice(),
      statValues = statGroups.map((group) => group.child(1)),
      turns = log.children.slice();
    const health = el("inspector-health").textContent;
    feed(
      "obs_a",
      snapshot(
        content.map((value) => ({ ...value })),
        { stats: statsOf("claude-opus"), asOf: new Date().toISOString() },
      ),
    );
    assert.deepEqual(
      el("inspector-stats").children,
      statGroups,
      "an equal new snapshot keeps every stat group",
    );
    assert(
      statGroups.every((group, index) => group.child(1) === statValues[index]),
      "and every stat value node",
    );
    assert.deepEqual(log.children, turns, "and every turn row");
    assert.notEqual(el("inspector-health").textContent, health, "while freshness still updates");
    const model = statGroups.find((group) => group.child(0).textContent === "Model"),
      tokens = statGroups.find((group) => group.child(0).textContent === "Input tokens");
    const activity = statGroups.find((group) => group.child(0).textContent === "Latest activity");
    assert.ok(model);
    assert.ok(tokens);
    assert.ok(activity);
    assert.equal(tokens.dataset.state, "partial");
    assert.equal(tokens.child(1).textContent, "1,200");
    assert.match(tokens.child(1).title, /bounded-window/);
    feed(
      "obs_a",
      snapshot(content, {
        stats: statsOf("claude-sonnet", {
          inputTokens: { value: 1500, state: "available" },
          lastActivityAt: { value: new Date().toISOString(), state: "available" },
        }),
      }),
    );
    assert.deepEqual(
      el("inspector-stats").children,
      statGroups,
      "changed stats reuse their groups",
    );
    assert.equal(model.child(1).textContent, "claude-sonnet");
    assert.ok(model);
    assert.ok(tokens);
    assert.ok(activity);
    assert.equal(tokens.dataset.state, "available");
    assert.equal(tokens.className, "stat stat-available");
    assert.equal(tokens.child(1).title, "", "the partial hint is cleared");
    assert.notEqual(activity.child(1).textContent, "1m ago", "age text rewritten in place");
    el("inspector-pause").emit("click");
    feed("obs_a", snapshot(content, { stats: statsOf("claude-haiku") }));
    assert.equal(model.child(1).textContent, "claude-sonnet", "Pause keeps the displayed stats");
    assert.deepEqual(el("inspector-stats").children, statGroups);
    el("inspector-pause").emit("click");
    assert.equal(
      model.child(1).textContent,
      "claude-haiku",
      "resume applies the held stats in place",
    );
    assert.deepEqual(el("inspector-stats").children, statGroups);
    const metaSpans = el("inspector-meta").children.slice();
    inspector.roster();
    assert.deepEqual(
      el("inspector-meta").children,
      metaSpans,
      "an equal roster pass keeps the meta spans",
    );
    roster.set("obs_a", { identity: "claude:s1", inventory: "available", meta: ["p9", "", "wt"] });
    inspector.roster();
    assert.equal(el("inspector-meta").child(0), metaSpans[0]);
    assert.equal(at(metaSpans, 0).textContent, "p9");
    roster.set("obs_a", { identity: "claude:s1", inventory: "available", meta: ["p9", "", ""] });
    inspector.roster();
    assert.deepEqual(
      el("inspector-meta").children,
      [metaSpans[0]],
      "a dropped value removes only its span",
    );
    roster.set("obs_a", { identity: "claude:s1", inventory: "available" });
    inspector.close();
  }
});
test("original loaded-window query generation and withdrawal", async () => {
  const reads: ReadCall[] = [];
  const Q = createQuerySpine({
    interval: () => () => {},
    getJson: (path) =>
      new Promise<unknown>((resolve, reject) => {
        reads.push({ path, resolve, reject });
      }),
  });
  const flush = async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  };
  const { get: own } = Inspector.buildPanel(fixtureDocument, 1);
  let identity = "dsk:w1";
  const view = Inspector.createInspector({
    get: own,
    document: fixtureDocument,
    QuerySpine: Q,
    describe: () => ({
      name: "ChatGPT app · 1",
      status: "unknown",
      stale: false,
      title: "ChatGPT · app window",
      meta: [],
      identity,
      inventory: "available",
    }),
  });
  const snapshot = (generation: string, texts: string[]) => ({
    id: "dsk_1",
    inspectionIdentity: identity,
    health: "available",
    asOf: new Date().toISOString(),
    reason: null,
    stats: { model: { value: null, state: "unavailable" } },
    turns: texts.map((text, index) => ({
      id: generation + ":" + String(index),
      role: "unknown",
      at: null,
      text,
    })),
    truncated: false,
    window: { maxTurns: 200, maxTextChars: 8000 },
    generation,
    provenance: { kind: "loaded-ui", coverage: "partial-loaded-ui", identity: "window-snapshot" },
  });
  const texts = () => own("inspector-log").children.map((item) => item.child(1).textContent);
  const key = "observer.inspect.dsk_1";
  view.open("dsk_1", identity);
  own("inspector-pause").emit("click"); // Pause pressed before the first snapshot arrives
  await flush();
  assert.equal(reads.length, 1);
  at(reads, 0).resolve(snapshot("g1", ["first excerpt"]));
  await flush();
  assert.deepEqual(texts(), ["first excerpt"], "Pause never holds a window snapshot");
  assert.equal(own("inspector-pause").attributes.get("aria-pressed"), "false");
  expect(own("inspector-pause").disabled).toBeTrue();
  void Q.refresh(key).catch(() => {});
  assert.deepEqual(
    texts(),
    [],
    "the excerpt leaves the page as soon as the next read is in flight",
  );
  await flush();
  assert.equal(reads.length, 2);
  assert.equal(own("inspector-health").textContent, "Reading this window again…");
  assert.equal(own("inspector-provenance").textContent, "");
  expect(own("inspector-pause").disabled, "Follow/Pause stay disabled for this window").toBeTrue();
  at(reads, 1).resolve(snapshot("g2", ["second excerpt"]));
  await flush();
  assert.deepEqual(texts(), ["second excerpt"], "the fresh snapshot replaces it whole");
  void Q.refresh(key).catch(() => {});
  assert.deepEqual(texts(), []);
  await flush();
  identity = "dsk:w2";
  view.roster();
  await flush();
  assert.equal(reads.length, 3, "a replaced window is not read by this panel");
  at(reads, 2).resolve(snapshot("late", ["old window text"]));
  await flush();
  assert.deepEqual(texts(), [], "a late response from the replaced identity is never shown");
  view.open("dsk_1", identity);
  await flush();
  assert.equal(reads.length, 4, "opening it again reads the new window");
  at(reads, 3).resolve(snapshot("g3", ["new window text"]));
  await flush();
  assert.deepEqual(texts(), ["new window text"]);
  // A failed read withdraws too.
  void Q.refresh(key).catch(() => {});
  await flush();
  at(reads, 4).reject(new Error("offline"));
  await flush();
  assert.deepEqual(texts(), []);
  assert.match(own("inspector-health").textContent, /withdrawn/);
  view.close();
});
test("original real-query cover transcript identity and window re-read", async () => {
  const reads: ReadCall[] = [];
  const Q = createQuerySpine({
    interval: () => () => {},
    getJson: (path) =>
      new Promise<unknown>((resolve, reject) => {
        reads.push({ path, resolve, reject });
      }),
  });
  const flush = async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  };
  const { get: own } = Inspector.buildPanel(fixtureDocument, 1);
  const row = {
    name: "Codex · 1",
    status: "working",
    stale: false,
    title: "Task",
    meta: [],
    identity: "codex:t1",
    inventory: "available",
  };
  const view = Inspector.createInspector({
    get: own,
    document: fixtureDocument,
    QuerySpine: Q,
    describe: () => row,
  });
  const data = (generation: string, texts: string[], extra: Record<string, unknown> = {}) => ({
    id: "obs_t",
    inspectionIdentity: row.identity,
    health: "available",
    asOf: new Date().toISOString(),
    reason: null,
    stats: {},
    truncated: false,
    window: { maxTurns: 200 },
    generation,
    turns: texts.map((text) => ({ id: text, role: "user", at: null, text })),
    ...extra,
  });
  const shown = () => own("inspector-log").children.map((node) => node.dataset.turnId);
  view.open("obs_t", "codex:t1");
  await flush();
  at(reads, 0).resolve(data("g1", ["t1", "t2"]));
  await flush();
  own("inspector-pause").emit("click");
  const nodes = own("inspector-log").children.slice();
  void Q.refresh("observer.inspect.obs_t").catch(() => {});
  await flush();
  const inflight = at(reads, reads.length - 1);
  view.cover();
  expect(view.isCovered()).toBeTrue();
  inflight.resolve(data("g1", ["t1", "t2", "late"]));
  await flush();
  assert.deepEqual(
    own("inspector-log").children,
    nodes,
    "a covered transcript keeps its rows and never takes a late answer",
  );
  assert.equal(own("inspector-pause").attributes.get("aria-pressed"), "true");
  const before = reads.length;
  view.roster();
  await flush();
  assert.equal(reads.length, before, "a covered panel never reads");
  view.reveal();
  await flush();
  assert.equal(reads.length, before + 1, "revealed, it reads again");
  at(reads, reads.length - 1).resolve(data("g1", ["t1", "t2", "t3"]));
  await flush();
  assert.deepEqual(
    own("inspector-log").children,
    nodes,
    "its own Pause still holds the newer snapshot",
  );
  assert.match(own("inspector-buffer").textContent, /1 new held/);
  view.cover();
  row.identity = "codex:other";
  view.roster();
  assert.deepEqual(shown(), []);
  view.reveal();
  await flush();
  assert.equal(reads.length, before + 1, "a locked panel is not read on reveal");
  assert.match(own("inspector-health").textContent, /different session/);
  view.close();
  row.identity = "dsk:w";
  reads.length = 0;
  // A covered window snapshot is withdrawn at once and read fresh when shown.
  view.open("obs_t", "dsk:w");
  await flush();
  at(reads, 0).resolve(
    data("w1", ["window text"], {
      provenance: {
        kind: "loaded-ui",
        coverage: "partial-loaded-ui",
        identity: "window-snapshot",
      },
    }),
  );
  await flush();
  assert.equal(own("inspector-log").children.length, 1);
  view.cover();
  assert.equal(own("inspector-log").children.length, 0, "a covered window snapshot is withdrawn");
  view.reveal();
  await flush();
  assert.equal(reads.length, 2, "and read fresh when shown");
  at(reads, 1).resolve(
    data("w2", ["newer window text"], {
      provenance: {
        kind: "loaded-ui",
        coverage: "partial-loaded-ui",
        identity: "window-snapshot",
      },
    }),
  );
  await flush();
  assert.equal(own("inspector-log").child(0).child(1).textContent, "newer window text");
  view.close();
});

test("terminal inspector disposal releases only its panel and rejects retained callbacks", () => {
  const panels = [1, 2].map((number) => Inspector.buildPanel(fixtureDocument, number));
  let reads = 0,
    stops = 0,
    descriptions = 0,
    selections = 0,
    closes = 0,
    gets = 0;
  const listeners: ((snapshot: QuerySnapshot) => void)[] = [];
  let helpers: HelperDescription[] = [
    { id: "helper", identity: "helper-session", eligible: true, name: "Helper", stale: false },
  ];
  const inspectors = panels.map((panel) =>
    Inspector.createInspector({
      get(part) {
        gets++;
        return panel.get(part);
      },
      document: fixtureDocument,
      QuerySpine: {
        define() {
          reads++;
        },
        subscribe(_key, listener) {
          listeners.push(listener);
          return () => {
            stops++;
            listener(querySnapshot({ error: { name: "Error", message: "reentrant unsubscribe" } }));
          };
        },
      },
      describe() {
        descriptions++;
        return {
          name: "Parent",
          identity: "session",
          inventory: "available",
          stale: false,
          title: "",
          meta: [],
          helpers,
        };
      },
      inspectHelper() {
        selections++;
      },
      requestClose() {
        closes++;
      },
    }),
  );
  const first = requiredValue(inspectors[0]),
    second = requiredValue(inspectors[1]);
  const panel = requiredValue(panels[0]);
  first.open("parent", "session");
  second.open("other", "session");
  const helper = panel.get("inspector-helpers-list").child(0).child(0);
  const helperClick = required(helper.handlers, "click");
  helpers = [];
  first.roster();
  assert.equal(helper.handlers.size, 0, "eviction releases helper listener immediately");
  helperClick();
  assert.equal(selections, 0, "retained evicted helper callback cannot select");
  const callbacks = [
    "inspector-close",
    "inspector-follow",
    "inspector-pause",
    "inspector-jump",
    "inspector-log",
  ].map((part) => {
    const node = panel.get(part);
    return required(node.handlers, part === "inspector-log" ? "scroll" : "click");
  });
  helpers = [{ id: "nullable", identity: null, eligible: true, name: "Unknown", stale: false }];
  first.roster();
  const activeHelper = panel.get("inspector-helpers-list").child(0).child(0);
  const activeClick = required(activeHelper.handlers, "click");
  activeClick();
  assert.equal(selections, 0, "nullable identity never invokes helper inspection");
  helpers = [{ id: "nullable", identity: "known", eligible: true, name: "Known", stale: false }];
  first.roster();
  first.dispose();
  first.dispose();
  activeClick();
  assert.equal(activeHelper.handlers.size, 0);
  assert.equal(selections, 0, "retained current helper callback cannot select after disposal");
  const before = { reads, stops, descriptions, selections, closes, gets };
  const text = textOf(panel.root),
    focus = focusCalls.length;
  for (const callback of callbacks) callback();
  for (const listener of listeners.slice(0, 1))
    listener(querySnapshot({ error: { name: "Error", message: "late" } }));
  first.open("parent", "session");
  first.close();
  first.cover();
  first.reveal();
  first.suspend();
  first.resume();
  first.roster();
  first.focusTarget();
  assert.deepEqual({ reads, stops, descriptions, selections, closes, gets }, before);
  assert.equal(textOf(panel.root), text);
  assert.equal(focusCalls.length, focus);
  expect(first.isOpen()).toBeFalse();
  assert.equal(first.current(), null);
  for (const part of [
    "inspector-close",
    "inspector-follow",
    "inspector-pause",
    "inspector-jump",
    "inspector-log",
  ])
    assert.equal(panel.get(part).handlers.size, 0);
  requiredValue(panels[1]).get("inspector-close").click();
  assert.equal(closes, 1, "other panel retains its listener");
  expect(second.isOpen()).toBeTrue();
  second.dispose();
  assert.equal(stops, 2);
});

test("disposing one real-query inspector preserves another subscriber and pending read", async () => {
  const reads: ReadCall[] = [];
  let timers = 0,
    stops = 0;
  const query = createQuerySpine({
    interval() {
      timers++;
      return () => {
        stops++;
      };
    },
    getJson: (path) =>
      new Promise((resolve, reject) => {
        reads.push({ path, resolve, reject });
      }),
  });
  const panels = [1, 2].map((number) => Inspector.buildPanel(fixtureDocument, number));
  const inspectors = panels.map((panel) =>
    Inspector.createInspector({
      get: panel.get,
      document: fixtureDocument,
      QuerySpine: query,
      describe: () => ({
        name: "Shared",
        identity: "session",
        inventory: "available",
        stale: false,
        title: "",
        meta: [],
      }),
    }),
  );
  const first = at(inspectors, 0),
    second = at(inspectors, 1);
  first.open("shared", "session");
  second.open("shared", "session");
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(reads.length, 1, "both panels share the actual pending resource");
  assert.equal(timers, 1);
  first.dispose();
  const before = textOf(at(panels, 0).root);
  assert.equal(stops, 0, "remaining subscriber keeps polling");
  at(reads, 0).resolve({
    id: "shared",
    inspectionIdentity: "session",
    health: "available",
    turns: [{ id: "turn", role: "user", text: "shared answer" }],
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(textOf(at(panels, 0).root), before, "disposed panel ignores pending settlement");
  assert.match(textOf(at(panels, 1).get("inspector-log")), /shared answer/);
  second.dispose();
  assert.equal(stops, 1, "last subscriber releases the timer");
});
