"use strict";
const { test } = require("bun:test");

test("observer-inspector regression contracts", async () => {
  const assert = require("node:assert/strict");
  const Inspector = require("./observer-inspector.js");

  // Stats: every field states value, bounded partial or unavailable; nothing is filled in.
  {
    const field = (value, state = "available") => ({ value, state });
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
    const text = Object.fromEntries(rows.map((row) => [row.key, [row.state, row.text]]));
    assert.deepEqual(text.model, ["available", "gpt-5-codex"]);
    assert.deepEqual(text.inputTokens, ["available", "1,234,567"]);
    assert.deepEqual(
      text.outputTokens,
      ["partial", "890 · partial"],
      "a windowed sum is never shown as a whole-session total",
    );
    assert.deepEqual(
      text.cacheReadTokens,
      ["unavailable", "Unavailable"],
      "a null value is unavailable whatever its state claims",
    );
    assert.deepEqual(
      text.cacheWriteTokens,
      ["unavailable", "Unavailable"],
      "missing Codex cache write stays unavailable",
    );
    assert.deepEqual(text.durationMs, ["available", "1h 02m"]);
    assert.deepEqual(text.startedAt, ["unavailable", "Unavailable"]);
    assert.equal(text.lastActivityAt[0], "available");
    assert.match(text.lastActivityAt[1], /s ago$/);
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

  // Turns: only documented fields are read; unknown roles and raw provider fields never reach the page.
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
    assert(!turn.key.includes("secret"));
  }
  // Unknown roles: only loaded app UI may carry them, labelled as loaded text and never as an assistant's words.
  {
    const loaded = { id: "g:0", role: "unknown", at: null, text: "window text" };
    assert.equal(Inspector.turnParts(loaded), null, "an unknown role outside loaded UI is dropped");
    const parts = Inspector.turnParts(loaded, true);
    assert.equal(parts.label, "LOADED UI TEXT");
    assert.equal(parts.role, "unknown");
    assert.equal(parts.text, "window text");
    assert.equal(
      Inspector.turnParts({ id: "g:1", role: "thinking", text: "x" }, true),
      null,
      "loaded UI admits no other undocumented role",
    );
    assert.equal(
      Inspector.REASONS["loaded-ui-unavailable"],
      "No loaded conversation text could be read from this app window.",
    );
  }

  // Controller over a small DOM double.
  let document;
  function element(tag = "div") {
    return {
      tag,
      className: "",
      textContent: "",
      children: [],
      hidden: false,
      dataset: {},
      attributes: {},
      handlers: {},
      title: "",
      scrollTop: 0,
      scrollHeight: 1000,
      clientHeight: 200,
      open: false,
      mode: null,
      parent: null,
      append(...nodes) {
        for (const node of nodes) {
          node.parent = this;
          this.children.push(node);
        }
      },
      replaceChildren(...nodes) {
        this.children = [];
        this.append(...nodes);
      },
      insertBefore(node, before) {
        node.parent = this;
        const at = this.children.indexOf(before);
        if (at < 0) this.children.push(node);
        else this.children.splice(at, 0, node);
      },
      remove() {
        if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1);
        this.parent = null;
      },
      contains(node) {
        for (let at = node; at; at = at.parent) if (at === this) return true;
        return false;
      },
      setAttribute(key, value) {
        this.attributes[key] = value;
      },
      addEventListener(name, fn) {
        this.handlers[name] = fn;
      },
      focus() {
        document.activeElement = this;
      },
      show() {
        this.open = true;
        this.mode = "drawer";
      },
      showModal() {
        this.open = true;
        this.mode = "modal";
      },
      close() {
        this.open = false;
      },
    };
  }
  const textOf = (node) =>
    node.children.length ? node.children.map(textOf).join(" ") : node.textContent;
  const ids = [
    "inspector",
    "inspector-log",
    "inspector-title",
    "inspector-status",
    "inspector-task",
    "inspector-meta",
    "inspector-health",
    "inspector-stats",
    "inspector-truncated",
    "inspector-window",
    "inspector-empty",
    "inspector-follow",
    "inspector-pause",
    "inspector-jump",
    "inspector-buffer",
    "inspector-close",
    "inspector-provenance",
    "inspector-helpers",
    "inspector-helpers-title",
    "inspector-helpers-list",
  ];
  const elements = Object.fromEntries(ids.map((id) => [id, element()]));
  for (const id of ids.slice(1)) elements.inspector.append(elements[id]);
  document = { activeElement: null, createElement: element };
  const specs = new Map(),
    live = new Map();
  const QuerySpine = {
    define(key, spec) {
      specs.set(key, spec);
    },
    subscribe(key, fn) {
      live.set(key, fn);
      fn({ hasData: false });
      return () => live.delete(key);
    },
  };
  const roster = new Map([
    ["obs_a", { identity: "claude:s1", inventory: "available" }],
    ["obs_b", { identity: "codex:s2", inventory: "available" }],
  ]);
  const changes = [];
  const inspector = Inspector.createInspector({
    get: (id) => elements[id],
    document,
    QuerySpine,
    describe: (id) =>
      roster.has(id)
        ? {
            name: id === "obs_a" ? "Claude · 1" : "Codex · 2",
            status: "working",
            stale: false,
            title: "Ship the inspector",
            meta: ["p1", "", "wt"],
            ...roster.get(id),
          }
        : null,
    onChange: (id) => changes.push(id),
  });
  const log = elements["inspector-log"];
  const turn = (id, role, text, extra = {}) => ({
    id,
    role,
    at: "2026-10-11T21:00:00.000Z",
    text,
    textTruncated: false,
    ...extra,
  });
  // A healthy reply proves the identity the row currently shows, as the server does.
  const snapshot = (turns, extra = {}) => ({
    hasData: true,
    error: null,
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
      inspectionIdentity: roster.get(extra.id || "obs_a")?.identity,
      ...extra,
    },
  });
  const feed = (key, value) => live.get("observer.inspect." + key)(value);
  // The controller opens a panel for the exact identity the row shows at that moment.
  const openRow = (id) => inspector.open(id, roster.get(id)?.identity);

  openRow("obs_a");
  assert.equal(
    elements.inspector.open,
    false,
    "an instance never shows itself: the panel stack does",
  );
  assert.equal(document.activeElement, null, "nor moves focus");
  assert.equal(
    specs.get("observer.inspect.obs_a").path,
    "/api/observer/sessions/obs_a/inspect?identity=claude%3As1",
    "each read names the exact target",
  );
  assert.equal(
    specs.get("observer.inspect.obs_a").validate({ id: "x", health: "stale", turns: [] }),
    false,
    "only the contract health values are accepted",
  );
  assert.equal(
    specs.get("observer.inspect.obs_a").retainOnUnsubscribe,
    false,
    "a closed inspector keeps no cached conversation",
  );
  assert.equal(elements["inspector-health"].textContent, "Loading snapshot…");
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
  assert.equal(log.children[0].children[1].textContent, "<b>hi</b>", "text is set as text");
  assert(!textOf(log).includes("hidden"), "reasoning fields are never rendered");
  assert.equal(elements["inspector-stats"].children[0].children[1].textContent, "claude-opus");
  assert.equal(elements["inspector-stats"].children[4].dataset.state, "unavailable");
  assert.equal(log.scrollTop, log.scrollHeight, "follow keeps the newest turn in view");

  // Stable ids: a tool completion updates its node in place.
  const toolNode = log.children[2];
  feed(
    "obs_a",
    snapshot([
      turn("u1", "user", "<b>hi</b>"),
      turn("a1", "assistant", "hello"),
      turn("t1", "tool", "npm test", { tool: { name: "Bash", phase: "finished", outcome: "ok" } }),
    ]),
  );
  assert.equal(log.children[2], toolNode);
  assert(textOf(toolNode).includes("Bash · finished · ok"));

  // Scrolling up pauses follow; new turns are counted and offered as a jump.
  log.scrollTop = 100;
  log.handlers.scroll();
  assert.equal(elements["inspector-follow"].attributes["aria-pressed"], "false");
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
  assert.equal(elements["inspector-jump"].hidden, false);
  assert.equal(elements["inspector-jump"].textContent, "1 new · jump to latest");
  elements["inspector-jump"].handlers.click();
  assert.equal(log.scrollTop, log.scrollHeight);
  assert.equal(elements["inspector-jump"].hidden, true);
  assert.equal(elements["inspector-follow"].attributes["aria-pressed"], "true");

  // Pause holds the conversation while polling continues; resume applies the latest snapshot.
  elements["inspector-pause"].handlers.click();
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
  assert.equal(
    elements["inspector-truncated"].hidden,
    true,
    "the window notice stays with the displayed snapshot while paused",
  );
  assert.equal(log.children.length, 4);
  assert.equal(elements["inspector-buffer"].textContent, "Paused · 2 new held");
  assert.equal(
    elements["inspector-stats"].children[0].children[1].textContent,
    "claude-opus",
    "stats stay with the displayed snapshot while paused",
  );
  assert.match(elements["inspector-health"].textContent, /^Paused · newer snapshot from .* held$/);
  elements["inspector-pause"].handlers.click();
  assert.deepEqual(
    log.children.map((node) => node.dataset.turnId),
    ["a1", "t1", "a2", "a3", "a4"],
    "evicted turns leave, retained ids keep order",
  );
  assert.equal(elements["inspector-buffer"].textContent, "");
  assert.equal(elements["inspector-stats"].children[0].children[1].textContent, "claude-newer");
  assert.equal(elements["inspector-truncated"].hidden, false);

  // Truncation and a generation change: bounded notice, bookkeeping reset.
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
  assert.equal(elements["inspector-truncated"].hidden, false);
  assert(textOf(log).includes("truncated at 8,000 characters"));

  // A refresh failure keeps the last snapshot but marks it stale; unavailable withholds the conversation.
  feed("obs_a", { hasData: true, data: snapshot([]).data, error: { message: "Timed out" } });
  assert.equal(elements.inspector.dataset.health, "stale");
  assert.match(elements["inspector-health"].textContent, /^Stale · could not refresh/);
  assert.equal(log.children.length, 1);
  feed(
    "obs_a",
    snapshot([], { health: "unavailable", reason: "transcript-unavailable", generation: null }),
  );
  assert.equal(log.children.length, 0);
  assert.equal(
    elements["inspector-health"].textContent,
    Inspector.REASONS["transcript-unavailable"],
  );
  assert.equal(elements["inspector-empty"].hidden, false);
  feed("obs_a", { hasData: false, error: { message: "http 404" } });
  assert.equal(elements["inspector-health"].textContent, Inspector.REASONS["unknown-session"]);
  assert(
    elements["inspector-stats"].children.every((stat) => stat.dataset.state === "unavailable"),
  );

  feed("obs_a", snapshot([turn("u1", "user", "hi"), turn("a1", "assistant", "hello")]));

  // The roster can move a new provider/session behind the same opaque id, drop the row or lose its inventory while open.
  // A panel belongs to the exact session it was opened for: a different one locks it until that row is opened again.
  roster.set("obs_a", { identity: "codex:s9", inventory: "available" });
  inspector.roster();
  assert.equal(log.children.length, 0, "the old conversation is cleared at once");
  assert(
    elements["inspector-stats"].children.every((stat) => stat.dataset.state === "unavailable"),
  );
  assert.equal(
    live.has("observer.inspect.obs_a"),
    false,
    "and the replacement is not read by this panel",
  );
  assert.match(elements["inspector-health"].textContent, /different session/);
  openRow("obs_a");
  assert.equal(
    elements["inspector-health"].textContent,
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
  assert.equal(
    live.has("observer.inspect.obs_a"),
    false,
    "an unavailable inventory stops the read",
  );
  assert.equal(
    elements["inspector-health"].textContent,
    Inspector.REASONS["inventory-unavailable"],
  );
  roster.set("obs_a", { identity: "codex:s9", inventory: "available" });
  inspector.roster();
  assert(live.has("observer.inspect.obs_a"), "recovery restarts the read");
  roster.delete("obs_a");
  inspector.roster();
  assert.equal(log.children.length, 0);
  assert.equal(live.has("observer.inspect.obs_a"), false);
  assert.match(elements["inspector-health"].textContent, /left the roster/);
  assert.equal(elements["inspector-title"].textContent, "Session no longer in the roster");
  roster.set("obs_a", { identity: "claude:s1", inventory: "available" });

  // Retargeting switches the poll; close stops it and reports no current session. Focus is the stack's business.
  openRow("obs_b");
  assert(
    !live.has("observer.inspect.obs_a") && live.has("observer.inspect.obs_b"),
    "one poll at a time",
  );
  assert.equal(log.children.length, 0);
  assert.equal(elements["inspector-title"].textContent, "Codex · 2");
  inspector.close();
  assert.equal(live.size, 0);
  assert.equal(changes.at(-1), null);
  assert.equal(inspector.isOpen(), false);
  // The close button asks its owner; without one it closes itself.
  openRow("obs_a");
  elements["inspector-close"].handlers.click();
  assert.equal(inspector.isOpen(), false);

  // Task 2: QuerySpine re-notifies old data while a request is pending; that is no work.
  openRow("obs_a");
  const steady = snapshot([turn("s1", "user", "steady"), turn("s2", "assistant", "reply")]);
  feed("obs_a", steady);
  const steadyNode = log.children[0],
    statNode = elements["inspector-stats"].children[0];
  feed("obs_a", { ...steady, pending: true });
  assert.equal(log.children[0], steadyNode);
  assert.equal(
    elements["inspector-stats"].children[0],
    statNode,
    "a pending re-notify of the same data rebuilds nothing",
  );
  // A hidden page: no conversation poll and no rows; the session, dialog, Follow and Pause choices stay.
  elements["inspector-pause"].handlers.click();
  assert.equal(elements["inspector-pause"].attributes["aria-pressed"], "true");
  feed("obs_a", snapshot([turn("s1", "user", "steady"), turn("s3", "user", "held")]));
  assert.match(elements["inspector-buffer"].textContent, /1 new held/);
  inspector.suspend();
  assert.equal(live.has("observer.inspect.obs_a"), false, "no conversation poll while hidden");
  assert.equal(log.children.length, 0, "rows are withheld");
  assert(
    elements["inspector-stats"].children.every((stat) => stat.dataset.state === "unavailable"),
  );
  assert.equal(
    elements["inspector-buffer"].textContent,
    "Paused",
    "the Pause buffer goes with the rows",
  );
  assert.equal(inspector.isOpen(), true);
  assert.equal(elements["inspector-pause"].attributes["aria-pressed"], "true");
  inspector.roster();
  assert.equal(
    live.has("observer.inspect.obs_a"),
    false,
    "a roster pass cannot restart a suspended read",
  );
  roster.set("obs_a", { identity: "claude:moved", inventory: "available" });
  inspector.roster();
  assert.equal(
    live.has("observer.inspect.obs_a"),
    false,
    "not even for a new identity while hidden",
  );
  roster.set("obs_a", { identity: "claude:s1", inventory: "available" });
  // Resume after a fresh inventory: the same identity polls again with Pause intact.
  inspector.resume();
  assert(live.has("observer.inspect.obs_a"), "the proved identity polls again");
  assert.equal(elements["inspector-pause"].attributes["aria-pressed"], "true");
  inspector.resume();
  assert.equal(elements["inspector-health"].textContent, "Loading snapshot…");
  // Identity lost while hidden: withheld, and a later recovery does not reopen it by itself.
  inspector.suspend();
  roster.delete("obs_a");
  inspector.resume();
  assert.equal(live.has("observer.inspect.obs_a"), false);
  assert.match(elements["inspector-health"].textContent, /left the roster/);
  roster.set("obs_a", { identity: "claude:s1", inventory: "available" });
  inspector.roster();
  assert.equal(
    live.has("observer.inspect.obs_a"),
    false,
    "a lost session stays withheld until reopened",
  );
  openRow("obs_a");
  assert(live.has("observer.inspect.obs_a"), "an explicit reopen reads again");
  // Provider/session replaced behind the same pane while hidden: withheld until an explicit reopen.
  inspector.suspend();
  roster.set("obs_a", { identity: "codex:replaced", inventory: "available" });
  inspector.resume();
  assert.equal(
    live.has("observer.inspect.obs_a"),
    false,
    "a different session after hiding is not read",
  );
  assert.match(elements["inspector-health"].textContent, /different session/);
  assert.equal(log.children.length, 0);
  inspector.roster();
  assert.equal(live.has("observer.inspect.obs_a"), false, "roster passes keep it withheld");
  roster.set("obs_a", { identity: "claude:s1", inventory: "available" });
  inspector.roster();
  assert.equal(live.has("observer.inspect.obs_a"), false, "even if the original session returns");
  openRow("obs_a");
  assert(live.has("observer.inspect.obs_a"), "reopen inspects the current session");
  // Unavailable inventory after hiding: withheld the same way.
  inspector.suspend();
  roster.set("obs_a", { identity: "claude:s1", inventory: "unavailable" });
  inspector.resume();
  assert.equal(live.has("observer.inspect.obs_a"), false);
  assert.equal(
    elements["inspector-health"].textContent,
    Inspector.REASONS["inventory-unavailable"],
  );
  roster.set("obs_a", { identity: "claude:s1", inventory: "available" });
  openRow("obs_a");
  // Identity replaced while paused and visible: withdrawn at once, Pause buffer included; the visible rule is unchanged.
  inspector.roster();
  feed("obs_a", snapshot([turn("p1", "user", "paused view")]));
  roster.set("obs_a", { identity: "claude:other", inventory: "available" });
  inspector.roster();
  assert.equal(log.children.length, 0, "a new identity withdraws the paused conversation");
  assert.equal(
    live.has("observer.inspect.obs_a"),
    false,
    "and, visible or not, this panel never reads the replacement",
  );
  roster.set("obs_a", { identity: "claude:s1", inventory: "available" });
  inspector.close();

  // Review 2: the reopen lock survives repeated hide/show cycles for a changed, lost or unavailable session.
  for (const [label, change] of [
    [
      "changed",
      () =>
        roster.set("obs_a", { identity: "codex:second-hide-replacement", inventory: "available" }),
    ],
    ["lost", () => roster.delete("obs_a")],
    ["unavailable", () => roster.set("obs_a", { identity: "claude:s1", inventory: "unavailable" })],
  ]) {
    roster.set("obs_a", { identity: "claude:s1", inventory: "available" });
    openRow("obs_a");
    assert(live.has("observer.inspect.obs_a"), label + ": reading before the hide");
    inspector.suspend();
    change();
    inspector.resume();
    assert.equal(
      live.has("observer.inspect.obs_a"),
      false,
      label + ": withheld after the first resume",
    );
    for (let cycle = 0; cycle < 2; cycle++) {
      inspector.suspend();
      inspector.resume();
      assert.equal(
        live.has("observer.inspect.obs_a"),
        false,
        label + ": still withheld after hide/show " + (cycle + 2),
      );
    }
    roster.set("obs_a", { identity: "claude:s1", inventory: "available" });
    inspector.suspend();
    inspector.resume();
    inspector.roster();
    assert.equal(
      live.has("observer.inspect.obs_a"),
      false,
      label + ": not even when the original session is back",
    );
    openRow("obs_a");
    assert(live.has("observer.inspect.obs_a"), label + ": only an explicit open reads again");
  }
  // Review 2: equal-content snapshots and roster passes keep every stat, meta and turn node; changes rewrite them in place.
  {
    roster.set("obs_a", { identity: "claude:s1", inventory: "available" });
    openRow("obs_a");
    const at = new Date(Date.now() - 60000).toISOString();
    const statsOf = (model, extra = {}) => ({
      model: { value: model, state: "available" },
      inputTokens: { value: 1200, state: "partial" },
      lastActivityAt: { value: at, state: "available" },
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
    const statGroups = elements["inspector-stats"].children.slice(),
      statValues = statGroups.map((group) => group.children[1]),
      turns = log.children.slice();
    const health = elements["inspector-health"].textContent;
    feed(
      "obs_a",
      snapshot(
        content.map((value) => ({ ...value })),
        { stats: statsOf("claude-opus"), asOf: new Date().toISOString() },
      ),
    );
    assert.deepEqual(
      elements["inspector-stats"].children,
      statGroups,
      "an equal new snapshot keeps every stat group",
    );
    assert(
      statGroups.every((group, index) => group.children[1] === statValues[index]),
      "and every stat value node",
    );
    assert.deepEqual(log.children, turns, "and every turn row");
    assert.notEqual(
      elements["inspector-health"].textContent,
      health,
      "while freshness still updates",
    );
    const model = statGroups.find((group) => group.children[0].textContent === "Model"),
      tokens = statGroups.find((group) => group.children[0].textContent === "Input tokens");
    const activity = statGroups.find(
      (group) => group.children[0].textContent === "Latest activity",
    );
    assert.equal(tokens.dataset.state, "partial");
    assert.match(tokens.children[1].title, /bounded-window/);
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
      elements["inspector-stats"].children,
      statGroups,
      "changed stats reuse their groups",
    );
    assert.equal(model.children[1].textContent, "claude-sonnet");
    assert.equal(tokens.dataset.state, "available");
    assert.equal(tokens.className, "stat stat-available");
    assert.equal(tokens.children[1].title, "", "the partial hint is cleared");
    assert.notEqual(activity.children[1].textContent, "1m ago", "age text rewritten in place");
    // Paused: polling continues but the stats stay with the displayed snapshot until resume.
    elements["inspector-pause"].handlers.click();
    feed("obs_a", snapshot(content, { stats: statsOf("claude-haiku") }));
    assert.equal(model.children[1].textContent, "claude-sonnet", "Pause keeps the displayed stats");
    assert.deepEqual(elements["inspector-stats"].children, statGroups);
    elements["inspector-pause"].handlers.click();
    assert.equal(
      model.children[1].textContent,
      "claude-haiku",
      "resume applies the held stats in place",
    );
    assert.deepEqual(elements["inspector-stats"].children, statGroups);
    // Roster passes: equal metadata keeps its spans; changed values rewrite them; a dropped value removes one span.
    const metaSpans = elements["inspector-meta"].children.slice();
    inspector.roster();
    assert.deepEqual(
      elements["inspector-meta"].children,
      metaSpans,
      "an equal roster pass keeps the meta spans",
    );
    roster.set("obs_a", { identity: "claude:s1", inventory: "available", meta: ["p9", "", "wt"] });
    inspector.roster();
    assert.equal(elements["inspector-meta"].children[0], metaSpans[0]);
    assert.equal(metaSpans[0].textContent, "p9");
    roster.set("obs_a", { identity: "claude:s1", inventory: "available", meta: ["p9", "", ""] });
    inspector.roster();
    assert.deepEqual(
      elements["inspector-meta"].children,
      [metaSpans[0]],
      "a dropped value removes only its span",
    );
    roster.set("obs_a", { identity: "claude:s1", inventory: "available" });
    inspector.close();
  }
  // Task 4: window snapshots through the real QuerySpine. The previous loaded text is withdrawn as soon as the next read is
  // in flight, Pause never holds a snapshot back, and a late response from a replaced identity is never shown.
  const windowChecks = (async () => {
    const Q = require("./queryspine.fixture.js").loadQuerySpine();
    Q._resetForTest();
    Q._setTimersForTest(
      () => 0,
      () => {},
    );
    const reads = [];
    Q._setGetForTest(
      (path) => new Promise((resolve, reject) => reads.push({ path, resolve, reject })),
    );
    const flush = async () => {
      for (let i = 0; i < 6; i++) await null;
    };
    const own = Object.fromEntries(ids.map((id) => [id, element()]));
    for (const id of ids.slice(1)) own.inspector.append(own[id]);
    let identity = "dsk:w1";
    const view = Inspector.createInspector({
      get: (id) => own[id],
      document,
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
    const snapshot = (generation, texts) => ({
      id: "dsk_1",
      inspectionIdentity: identity,
      health: "available",
      asOf: new Date().toISOString(),
      reason: null,
      stats: { model: { value: null, state: "unavailable" } },
      turns: texts.map((text, index) => ({
        id: generation + ":" + index,
        role: "unknown",
        at: null,
        text,
      })),
      truncated: false,
      window: { maxTurns: 200, maxTextChars: 8000 },
      generation,
      provenance: { kind: "loaded-ui", coverage: "partial-loaded-ui", identity: "window-snapshot" },
    });
    const texts = () => own["inspector-log"].children.map((item) => item.children[1].textContent);
    const key = "observer.inspect.dsk_1";
    view.open("dsk_1", identity);
    own["inspector-pause"].handlers.click(); // Pause pressed before the first snapshot arrives
    await flush();
    assert.equal(reads.length, 1);
    reads[0].resolve(snapshot("g1", ["first excerpt"]));
    await flush();
    assert.deepEqual(texts(), ["first excerpt"], "Pause never holds a window snapshot");
    assert.equal(own["inspector-pause"].attributes["aria-pressed"], "false");
    assert.equal(own["inspector-pause"].disabled, true);
    Q.refresh(key).catch(() => {});
    assert.deepEqual(
      texts(),
      [],
      "the excerpt leaves the page as soon as the next read is in flight",
    );
    await flush();
    assert.equal(reads.length, 2);
    assert.equal(own["inspector-health"].textContent, "Reading this window again…");
    assert.equal(own["inspector-provenance"].textContent, "");
    assert.equal(
      own["inspector-pause"].disabled,
      true,
      "Follow/Pause stay disabled for this window",
    );
    reads[1].resolve(snapshot("g2", ["second excerpt"]));
    await flush();
    assert.deepEqual(texts(), ["second excerpt"], "the fresh snapshot replaces it whole");
    // Another window behind the row: the in-flight read for the old identity settles late and is never shown.
    Q.refresh(key).catch(() => {});
    assert.deepEqual(texts(), []);
    await flush();
    identity = "dsk:w2";
    view.roster();
    await flush();
    assert.equal(reads.length, 3, "a replaced window is not read by this panel");
    reads[2].resolve(snapshot("late", ["old window text"]));
    await flush();
    assert.deepEqual(texts(), [], "a late response from the replaced identity is never shown");
    view.open("dsk_1", identity);
    await flush();
    assert.equal(reads.length, 4, "opening it again reads the new window");
    reads[3].resolve(snapshot("g3", ["new window text"]));
    await flush();
    assert.deepEqual(texts(), ["new window text"]);
    // A failed read withdraws too.
    Q.refresh(key).catch(() => {});
    await flush();
    reads[4].reject(new Error("offline"));
    await flush();
    assert.deepEqual(texts(), []);
    assert.match(own["inspector-health"].textContent, /withdrawn/);
    view.close();
    Q._resetForTest();
  })();
  // Task 5: a covered panel stops reading at once; a late answer for its old read never lands; a transcript keeps its
  // rows and Pause; a window snapshot is withdrawn and read again when shown; a covered panel is reconciled.
  const coverChecks = windowChecks.then(async () => {
    const Q = require("./queryspine.fixture.js").loadQuerySpine();
    Q._resetForTest();
    Q._setTimersForTest(
      () => 0,
      () => {},
    );
    const reads = [];
    Q._setGetForTest(
      (path) => new Promise((resolve, reject) => reads.push({ path, resolve, reject })),
    );
    const flush = async () => {
      for (let i = 0; i < 6; i++) await null;
    };
    const own = Object.fromEntries(ids.map((id) => [id, element()]));
    for (const id of ids.slice(1)) own.inspector.append(own[id]);
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
      get: (id) => own[id],
      document,
      QuerySpine: Q,
      describe: () => row,
    });
    const data = (generation, texts, extra = {}) => ({
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
    const shown = () => own["inspector-log"].children.map((node) => node.dataset.turnId);
    view.open("obs_t", "codex:t1");
    await flush();
    reads[0].resolve(data("g1", ["t1", "t2"]));
    await flush();
    own["inspector-pause"].handlers.click();
    const nodes = own["inspector-log"].children.slice();
    Q.refresh("observer.inspect.obs_t").catch(() => {});
    await flush();
    const inflight = reads.at(-1);
    view.cover();
    assert.equal(view.isCovered(), true);
    inflight.resolve(data("g1", ["t1", "t2", "late"]));
    await flush();
    assert.deepEqual(
      own["inspector-log"].children,
      nodes,
      "a covered transcript keeps its rows and never takes a late answer",
    );
    assert.equal(own["inspector-pause"].attributes["aria-pressed"], "true");
    const before = reads.length;
    view.roster();
    await flush();
    assert.equal(reads.length, before, "a covered panel never reads");
    view.reveal();
    await flush();
    assert.equal(reads.length, before + 1, "revealed, it reads again");
    reads.at(-1).resolve(data("g1", ["t1", "t2", "t3"]));
    await flush();
    assert.deepEqual(
      own["inspector-log"].children,
      nodes,
      "its own Pause still holds the newer snapshot",
    );
    assert.match(own["inspector-buffer"].textContent, /1 new held/);
    // Covered identity change: the panel locks without reading; revealing it keeps it withheld.
    view.cover();
    row.identity = "codex:other";
    view.roster();
    assert.deepEqual(shown(), []);
    view.reveal();
    await flush();
    assert.equal(reads.length, before + 1, "a locked panel is not read on reveal");
    assert.match(own["inspector-health"].textContent, /different session/);
    view.close();
    row.identity = "dsk:w";
    Q._resetForTest();
    reads.length = 0;
    // A covered window snapshot is withdrawn at once and read fresh when shown.
    view.open("obs_t", "dsk:w");
    await flush();
    reads[0].resolve(
      data("w1", ["window text"], {
        provenance: {
          kind: "loaded-ui",
          coverage: "partial-loaded-ui",
          identity: "window-snapshot",
        },
      }),
    );
    await flush();
    assert.equal(own["inspector-log"].children.length, 1);
    view.cover();
    assert.equal(own["inspector-log"].children.length, 0, "a covered window snapshot is withdrawn");
    view.reveal();
    await flush();
    assert.equal(reads.length, 2, "and read fresh when shown");
    reads[1].resolve(
      data("w2", ["newer window text"], {
        provenance: {
          kind: "loaded-ui",
          coverage: "partial-loaded-ui",
          identity: "window-snapshot",
        },
      }),
    );
    await flush();
    assert.equal(own["inspector-log"].children[0].children[1].textContent, "newer window text");
    view.close();
    Q._resetForTest();
  });
  // Task 5 review 3: the panel's own read can make the server re-read its inventory and find session B behind the row
  // before the browser's roster stops showing A. Real sidecar observer + real QuerySpine + the inspector instance.
  const bindingChecks = coverChecks.then(async () => {
    const { makeObserver } = require("../../sidecar/observer.js");
    const Q = require("./queryspine.fixture.js").loadQuerySpine();
    Q._resetForTest();
    Q._setTimersForTest(
      () => 0,
      () => {},
    );
    const A = "00000000-0000-0000-0000-00000000000a",
      B = "00000000-0000-0000-0000-00000000000b";
    let time = 1000,
      session = A;
    const observer = makeObserver({
      readIdentityConfiguration: async () => "unconfigured",
      now: () => time,
      endpoint: "synthetic",
      execute: async () => ({
        stdout: JSON.stringify({
          result: {
            agents: [
              {
                pane_id: "pane1",
                agent: "codex",
                agent_status: "working",
                agent_session: { agent: "codex", kind: "id", value: session },
              },
            ],
          },
        }),
      }),
      projects: { resolve: async () => ({ projectId: "synthetic" }) },
      desktop: { inventory: async () => ({ health: "unavailable", windows: [] }) },
      helpers: {
        children: async () => ({ rows: [], annotations: new Map(), overflow: new Map() }),
      },
      bus: { read: () => ({ rows: [], health: "available" }) },
      transcripts: {
        read: async () => ({ available: false }),
        retain() {},
        inspect: async (id, provider, sid) => ({
          available: true,
          health: "available",
          stats: {},
          generation: "g_" + sid,
          window: {},
          turns: [{ id: "t_" + sid, role: "user", text: "body for " + sid }],
        }),
      },
    });
    let reply = null; // when set, the next read answers with this crafted reply instead of the server
    Q._setGetForTest((path) => {
      const url = new URL(path, "http://observer"),
        id = decodeURIComponent(url.pathname.split("/")[4]),
        identity = url.searchParams.get("identity");
      if (reply) {
        const value = reply;
        reply = null;
        return Promise.resolve(value(id, identity));
      }
      return observer.inspect(id, identity === null ? undefined : identity);
    });
    const row = (await observer.get()).sessions[0],
      browser = { identity: row.inspectionIdentity, inventory: "available" };
    assert.equal(browser.identity, "codex:" + A);
    const own = Object.fromEntries(ids.map((id) => [id, element()]));
    for (const id of ids.slice(1)) own.inspector.append(own[id]);
    const view = Inspector.createInspector({
      get: (id) => own[id],
      document,
      QuerySpine: Q,
      describe: () => ({
        name: "Codex · 1",
        status: "working",
        stale: false,
        title: "Task",
        meta: [],
        ...browser,
      }),
    });
    try {
      const text = () => own["inspector-log"].children.map((node) => node.children[1].textContent);
      view.open(row.id, browser.identity);
      await Q.get("observer.inspect." + row.id);
      assert.deepEqual(text(), ["body for " + A], "the bound read shows its own session");
      own["inspector-pause"].handlers.click();
      // The pane now runs B; the browser roster still shows A. The panel's next read reaches the server first.
      session = B;
      time += 3000;
      await Q.refresh("observer.inspect." + row.id);
      assert.deepEqual(text(), [], "B is never shown in the A panel");
      assert.equal(own["inspector-buffer"].textContent, "Paused", "nor held by Pause");
      assert(
        !JSON.stringify(
          own["inspector-log"].children.map((node) =>
            node.children.map((child) => child.textContent),
          ),
        ).includes("body for " + B),
      );
      assert.match(own["inspector-health"].textContent, /different session/, "the panel locks");
      assert.throws(
        () => Q.state("observer.inspect." + row.id),
        /unknown query resource/,
        "its read is gone, so nothing can revive it",
      );
      assert.deepEqual(text(), []);
      view.close();
      Q._resetForTest();
      // Control: the server-side expectation is what protects it; an unbound legacy read would have returned B's body.
      assert.equal(
        (await observer.inspect(row.id)).turns[0].text,
        "body for " + B,
        "fixture: an unbound read finds B",
      );
      // A paused panel never buffers a reply that proves another target, and a helper's parent is part of its target.
      for (const [label, expected, foreign] of [
        ["foreign session", "codex:" + A, "codex:" + B],
        [
          "helper parent",
          "helper:obs_" + "1".repeat(24) + "|obs_" + "a".repeat(24),
          "helper:obs_" + "1".repeat(24) + "|obs_" + "b".repeat(24),
        ],
      ]) {
        browser.identity = expected;
        const answer = (proof, texts) => (id, identity) => ({
          id,
          inspectionIdentity: proof,
          health: "available",
          asOf: new Date().toISOString(),
          reason: null,
          stats: { model: { value: "m", state: "available" } },
          generation: "g1",
          truncated: false,
          window: {},
          turns: texts.map((value) => ({ id: value, role: "user", at: null, text: value })),
          asked: identity,
        });
        reply = answer(expected, ["mine"]);
        view.open(row.id, expected);
        await Q.get("observer.inspect." + row.id);
        assert.deepEqual(text(), ["mine"], label + ": own proof shows");
        assert.equal(
          Q.state("observer.inspect." + row.id).data.asked,
          expected,
          label + ": the read named the exact target",
        );
        own["inspector-pause"].handlers.click();
        reply = answer(foreign, ["mine", "foreign"]);
        await Q.refresh("observer.inspect." + row.id);
        assert.deepEqual(
          text(),
          [],
          label + ": a reply proving another target withdraws the panel",
        );
        assert.equal(
          own["inspector-buffer"].textContent,
          "Paused",
          label + ": and nothing is held",
        );
        assert(
          own["inspector-stats"].children.every((stat) => stat.dataset.state === "unavailable"),
          label + ": stats withdrawn too",
        );
        view.close();
        Q._resetForTest();
      }
      // A reply with no proof at all is treated the same way.
      browser.identity = "codex:" + A;
      reply = (id) => ({
        id,
        health: "available",
        asOf: new Date().toISOString(),
        reason: null,
        stats: {},
        generation: "g1",
        truncated: false,
        window: {},
        turns: [{ id: "x", role: "user", at: null, text: "unproven" }],
      });
      view.open(row.id, "codex:" + A);
      await Q.get("observer.inspect." + row.id);
      assert.deepEqual(text(), [], "an unproven reply is never shown");
      view.close();
      Q._resetForTest();
    } finally {
      view.close();
      Q._resetForTest();
      await observer.close();
    }
  });
  await bindingChecks.then(() =>
    console.log(
      "observer inspector: reads name their exact target; server-found replacement, foreign/unproven proof and helper parent change lock the panel, never shown or held OK",
    ),
  );
  await coverChecks.then(() =>
    console.log(
      "observer inspector: covered panels stop reading, keep transcript state, drop late answers, lock on replacement and re-read window snapshots OK",
    ),
  );
  await windowChecks.then(() =>
    console.log(
      "observer inspector: window snapshots withdraw in flight, ignore Pause and drop late replaced-identity reads OK",
    ),
  );
  console.log(
    "observer inspector: stat states, safe turns, stable updates, follow/jump, pause, truncation, stale/unavailable/404, replacement lock, retarget and close OK",
  );

  // Canonical disk identity owns stats; snake-case transport identity is unrelated.
  {
    const backend = require("../../src/sidecar/inspector/index.ts");
    const session = "00000000-0000-0000-0000-000000000001";
    const record = {
      type: "assistant",
      sessionId: session,
      session_id: "transport-id",
      uuid: "block",
      timestamp: "2026-10-11T00:00:00Z",
      message: {
        id: "message",
        model: "claude-model",
        content: [{ type: "text", text: "fixture" }],
        usage: { input_tokens: 10, output_tokens: 4 },
      },
    };
    assert.equal(backend.recordBelongsToSession(record, "claude", session), true);
    for (const extra of [
      { sessionId: undefined },
      { sessionId: "foreign" },
      { isSidechain: true },
      { isMeta: true },
    ])
      assert.equal(
        backend.recordBelongsToSession({ ...record, ...extra }, "claude", session),
        false,
      );
    const binding = { provider: "claude", parentSessionId: session, sessionId: "child" };
    const child = { ...record, isSidechain: true, agentId: "child" };
    assert.equal(backend.recordBelongsToSession(child, "claude", "child", binding), true);
    for (const extra of [{ sessionId: "foreign" }, { agentId: "foreign" }, { isSidechain: false }])
      assert.equal(
        backend.recordBelongsToSession({ ...child, ...extra }, "claude", "child", binding),
        false,
      );
    const projection = backend.createProjection();
    backend.consume(projection, record, "claude", 150, session, null, { beginning: true });
    const stats = backend.snapshot(projection, "claude", Date.parse("2026-10-11T01:00:00Z")).stats;
    assert.deepEqual(stats.inputTokens, { value: 10, state: "available" });
    assert.equal(stats.startedAt.value, "2026-10-11T00:00:00.000Z");
    const tail = backend.createProjection();
    backend.consume(tail, record, "claude", 300000, session);
    assert.equal(backend.snapshot(tail, "claude", 1000).stats.startedAt.value, null);
  }
}, 30000);
