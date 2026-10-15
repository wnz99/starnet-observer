/* Agent inspector: a read-only, bounded snapshot of one observed session's usage and conversation. Text arrives
   redacted from the sidecar and is only ever set through textContent; reasoning and raw provider fields are never
   read, even when present. Each open panel is its own instance with its own DOM (buildPanel); the controller's
   panel stack owns showing, modality, Escape and focus, and only the top panel polls. */
"use strict";
const ObserverInspector = (() => {
  const Model =
    typeof ObserverModel !== "undefined" ? ObserverModel : require("./observer-model.js");
  const ROLES = { user: "USER", assistant: "ASSISTANT", tool: "TOOL" };
  const PHASES = ["started", "finished"],
    OUTCOMES = { unknown: "outcome unknown", ok: "ok", error: "error" };
  const REASONS = {
    "unknown-session": "This session is no longer known to the observer.",
    "inventory-unavailable":
      "This session's source is unavailable or not refreshed, so no conversation is shown.",
    "identity-unavailable":
      "The conversation behind this row could not be identified, so none is shown.",
    "transcript-unavailable": "The transcript for this session could not be read.",
    "loaded-ui-unavailable": "No loaded conversation text could be read from this app window.",
    "identity-mismatch": "This row now shows a different session; open it again to read it.",
    "invalid-identity": "This session could not be identified, so no conversation is shown.",
  };
  // What a snapshot is, stated once in the header; partial loaded UI is never presented as conversation history.
  const PROVENANCE = {
    "loaded-ui": "Loaded UI · partial · this window snapshot only, not conversation history",
    transcript: "Transcript · bounded window · this session",
  };
  const isSnapshot = (data) =>
    !!(data && data.provenance && data.provenance.identity === "window-snapshot");
  const MOBILE = "(max-width: 850px)";
  const count = (value) =>
    typeof value === "number" && Number.isFinite(value)
      ? Math.round(value).toLocaleString("en-US")
      : null;
  function formatDuration(ms) {
    if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return null;
    const seconds = Math.floor(ms / 1000),
      hours = Math.floor(seconds / 3600),
      minutes = Math.floor((seconds % 3600) / 60);
    return hours
      ? hours + "h " + String(minutes).padStart(2, "0") + "m"
      : minutes
        ? minutes + "m " + String(seconds % 60).padStart(2, "0") + "s"
        : seconds + "s";
  }
  const FIELDS = [
    [
      "model",
      "Model",
      (value) => (typeof value === "string" && value.trim() ? value.trim() : null),
    ],
    ["inputTokens", "Input tokens", count],
    ["outputTokens", "Output tokens", count],
    ["cacheReadTokens", "Cache read", count],
    ["cacheWriteTokens", "Cache write", count],
    ["durationMs", "Duration", formatDuration],
    [
      "startedAt",
      "Started",
      (value, now) => (typeof value === "string" && Model.age(value, now)) || null,
    ],
    [
      "lastActivityAt",
      "Latest activity",
      (value, now) => (typeof value === "string" && Model.age(value, now)) || null,
    ],
  ];
  // Every field says what it is: a value, a bounded partial reading, or unavailable. Nothing is filled in.
  function statRows(stats, now = Date.now()) {
    return FIELDS.map(([key, label, format]) => {
      const field = stats && typeof stats === "object" ? stats[key] : null;
      let state =
        field && (field.state === "available" || field.state === "partial")
          ? field.state
          : "unavailable";
      const value = state === "unavailable" ? null : format(field.value, now);
      if (value == null) state = "unavailable";
      return {
        key,
        label,
        state,
        text:
          state === "unavailable"
            ? "Unavailable"
            : state === "partial"
              ? value + " · partial"
              : value,
      };
    });
  }
  /* Only the documented fields are read. An unknown role is shown only from loaded app UI, labelled as such and never
     as an assistant's words; anywhere else it is dropped rather than guessed. */
  function turnParts(turn, loaded = false) {
    const known =
      turn && typeof turn === "object" && (ROLES[turn.role] || (loaded && turn.role === "unknown"));
    if (!known || (typeof turn.id !== "string" && typeof turn.id !== "number")) return null;
    const tool =
      turn.role === "tool" && turn.tool && typeof turn.tool === "object"
        ? {
            name: typeof turn.tool.name === "string" && turn.tool.name ? turn.tool.name : "tool",
            phase: PHASES.includes(turn.tool.phase) ? turn.tool.phase : "started",
            outcome: OUTCOMES[turn.tool.outcome] || OUTCOMES.unknown,
          }
        : null;
    const parts = {
      id: String(turn.id),
      role: turn.role,
      label: ROLES[turn.role] || "LOADED UI TEXT",
      at: typeof turn.at === "string" ? turn.at : null,
      text: typeof turn.text === "string" ? turn.text : "",
      truncated: turn.textTruncated === true,
      tool,
    };
    parts.key = JSON.stringify([parts.role, parts.at, parts.text, parts.truncated, tool]);
    return parts;
  }
  const isLoaded = (data) => !!(data && data.provenance && data.provenance.kind === "loaded-ui");
  const valid = (data) =>
    !!(
      data &&
      typeof data === "object" &&
      typeof data.id === "string" &&
      ["available", "unavailable"].includes(data.health) &&
      Array.isArray(data.turns)
    );
  const clock = (iso) => {
    const at = Date.parse(iso);
    return Number.isFinite(at)
      ? new Date(at).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })
      : "time unknown";
  };

  /* One panel's DOM. Parts keep their former element names, so lookups stay readable; element ids are suffixed with
     the panel number, so several open panels never share an id. */
  function buildPanel(document, n) {
    const parts = {},
      make = (tag, part, className, text) => {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text != null) node.textContent = text;
        if (part) {
          parts[part] = node;
          node.id = part + "-" + n;
        }
        return node;
      };
    const dialog = make("dialog", "inspector", "inspector"),
      head = make("header", null, "inspector-head"),
      bar = make("div", null, "inspector-bar");
    const close = make("button", "inspector-close", "", "Close");
    close.type = "button";
    close.setAttribute("aria-label", "Close inspector");
    bar.append(
      make("span", null, "eyebrow", "INSPECTOR"),
      make("span", null, "read-only", "READ ONLY"),
      make("span", "inspector-stack", "panel-stack", ""),
      close,
    );
    const top = make("div", null, "row-top"),
      title = make("h2", "inspector-title", "", "Session");
    title.tabIndex = -1;
    top.append(title, make("span", "inspector-status", "status", ""));
    const health = make("p", "inspector-health", "inspector-health", "");
    health.setAttribute("role", "status");
    health.setAttribute("aria-live", "polite");
    head.append(
      bar,
      top,
      make("p", "inspector-task", "inspector-task", ""),
      make("p", "inspector-meta", "row-meta", ""),
      make("p", "inspector-provenance", "inspector-provenance", ""),
      health,
    );
    const stats = make("dl", "inspector-stats", "inspector-stats", null);
    stats.setAttribute("aria-label", "Session usage");
    const conversation = make("section", null, "inspector-conversation"),
      logHead = make("div", null, "inspector-log-head"),
      logTitle = make("h3", "inspector-log-title", "", "Conversation");
    logHead.append(logTitle, make("span", "inspector-window", "inspector-window", ""));
    const log = make("ol", "inspector-log", "inspector-log", null);
    for (const [key, value] of [
      ["role", "log"],
      ["aria-live", "polite"],
      ["aria-relevant", "additions"],
      ["aria-labelledby", logTitle.id],
    ])
      log.setAttribute(key, value);
    log.tabIndex = 0;
    const truncated = make("p", "inspector-truncated", "inspector-note", ""),
      empty = make("p", "inspector-empty", "inspector-note", "");
    truncated.hidden = true;
    empty.hidden = true;
    conversation.setAttribute("aria-labelledby", logTitle.id);
    conversation.append(logHead, truncated, log, empty);
    const controls = make("footer", null, "inspector-controls"),
      button = (part, text, pressed) => {
        const node = make("button", part, part, text);
        node.type = "button";
        if (pressed != null) node.setAttribute("aria-pressed", pressed);
        return node;
      };
    const jump = button("inspector-jump", "", null);
    jump.hidden = true;
    const buffer = make("span", "inspector-buffer", "inspector-buffer", "");
    buffer.setAttribute("role", "status");
    controls.append(
      button("inspector-follow", "Follow", "true"),
      button("inspector-pause", "Pause", "false"),
      jump,
      buffer,
    );
    dialog.setAttribute("aria-labelledby", title.id);
    dialog.setAttribute("aria-describedby", health.id);
    const helpers = make("section", "inspector-helpers", "inspector-helpers");
    helpers.hidden = true;
    helpers.tabIndex = 0;
    const helperTitle = make("h3", "inspector-helpers-title", "", "Helpers");
    helpers.setAttribute("aria-labelledby", helperTitle.id);
    helpers.append(helperTitle, make("ul", "inspector-helpers-list", "inspector-helpers-list"));
    dialog.append(
      head,
      helpers,
      stats,
      conversation,
      controls,
      make(
        "p",
        null,
        "inspector-footnote",
        "Redacted plain text from the local transcript or text loaded in an app window. No reasoning content, raw provider fields or cost.",
      ),
    );
    return { root: dialog, get: (part) => parts[part] };
  }

  function createInspector({
    get,
    document,
    QuerySpine,
    describe,
    onChange = () => {},
    requestClose = null,
    inspectHelper = () => {},
    now = () => Date.now(),
  }) {
    const dialog = get("inspector"),
      log = get("inspector-log"),
      title = get("inspector-title");
    const make = (tag, className, value) => {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (value != null) node.textContent = value;
      return node;
    };
    // expected: the exact identity this panel was opened for. identity: the identity whose content is on screen.
    let id = null,
      expected = null,
      identity,
      unsubscribe = null,
      generation,
      nodes = new Map(),
      last = null,
      pending = null;
    let follow = true,
      paused = false,
      unseen = 0;
    // windowed: this inspection reads window snapshots, which prove nothing beyond their own read.
    let windowed = false;
    // seen: the snapshot data last handled, so QuerySpine's pending re-notify of old data does no work.
    // suspended: hidden page; no poll and no rows until resume() after a fresh inventory.
    // held: the identity inspected when the page hid. locked: a different session (or none) proved since, so the
    // conversation stays withheld until the user opens that row again. covered: a lower stack entry, never polling.
    let seen = null,
      suspended = false,
      held,
      locked = false,
      covered = false;

    const helperNodes = new Map();
    function header() {
      const row = id ? describe(id) : null;
      title.textContent = row ? row.name : "Session no longer in the roster";
      get("inspector-status").className = "status " + (row ? row.status : "unknown");
      get("inspector-status").textContent = row
        ? (row.stale ? "was " : "") + (row.status === "blocked" ? "waiting" : row.status)
        : "";
      get("inspector-task").textContent = row ? row.title : "";
      // Metadata spans are reused by position; a roster pass with unchanged values touches no node.
      const meta = get("inspector-meta"),
        values = (row ? row.meta : []).filter(Boolean);
      values.forEach((value, index) => {
        let span = meta.children[index];
        if (!span) {
          span = make("span", "", "");
          meta.append(span);
        }
        if (span.textContent !== value) span.textContent = value;
      });
      while (meta.children.length > values.length) meta.children[meta.children.length - 1].remove();
      const helpers =
        row?.inventory === "available" && row.identity === expected ? row.helpers || [] : [];
      const section = get("inspector-helpers"),
        list = get("inspector-helpers-list");
      section.hidden = !helpers.length;
      get("inspector-helpers-title").textContent = "Verified helpers · " + helpers.length;
      const present = new Set(helpers.map((helper) => helper.id));
      for (const [key, item] of helperNodes)
        if (!present.has(key)) {
          item.root.remove();
          helperNodes.delete(key);
        }
      for (const [index, helper] of helpers.entries()) {
        let item = helperNodes.get(helper.id);
        if (!item) {
          const root = make("li", "", null),
            button = make("button", "", null);
          button.type = "button";
          button.setAttribute("aria-haspopup", "dialog");
          root.append(button);
          item = { root, button, helper };
          helperNodes.set(helper.id, item);
          button.addEventListener("click", () => {
            if (item.helper.eligible) inspectHelper(item.helper.id, item.helper.identity, button);
          });
        }
        item.helper = helper;
        // Own row status, own native task report and lifecycle evidence are separate facts, each said in its own words.
        const label = [
          helper.name,
          (helper.stale ? "last observed " : "") +
            (helper.status === "blocked" ? "waiting" : helper.status),
          helper.task,
          helper.lifecycle,
          helper.title,
        ]
          .filter(Boolean)
          .join(" · ");
        if (item.button.textContent !== label) item.button.textContent = label;
        item.button.disabled = !helper.eligible;
        // Move only when roster order changed; unchanged polls keep nodes and keyboard focus.
        if (list.children[index] !== item.root)
          list.insertBefore(item.root, list.children[index] || null);
      }
    }
    function health(message, state) {
      get("inspector-health").textContent = message;
      dialog.dataset.health = state;
    }
    // One group per stat field for the inspector's lifetime: a snapshot rewrites only the state, text and hint that changed.
    const statNodes = new Map();
    function stats(data) {
      const list = get("inspector-stats");
      for (const row of statRows(data, now())) {
        let node = statNodes.get(row.key);
        if (!node) {
          const group = make("div", "", null),
            value = make("dd", "", "");
          group.append(make("dt", "", row.label), value);
          list.append(group);
          node = { group, value };
          statNodes.set(row.key, node);
        }
        const className = "stat stat-" + row.state,
          hint =
            row.state === "partial" ? "A bounded-window reading, not a whole-session total" : "";
        if (node.group.className !== className) {
          node.group.className = className;
          node.group.dataset.state = row.state;
        }
        if (node.value.textContent !== row.text) node.value.textContent = row.text;
        if (node.value.title !== hint) node.value.title = hint;
      }
    }
    function resetLog() {
      nodes = new Map();
      generation = undefined;
      unseen = 0;
      pending = null;
      log.replaceChildren();
      log.scrollTop = 0;
      get("inspector-truncated").hidden = true;
      get("inspector-window").textContent = "";
      get("inspector-provenance").textContent = "";
      delete dialog.dataset.provenance;
    }
    // A window snapshot replaces itself whole on every read: there is nothing to follow or hold back.
    function controls() {
      const snapshot = windowed,
        hint = snapshot ? "Snapshots replace; nothing to follow" : "";
      for (const name of ["inspector-follow", "inspector-pause"]) {
        const button = get(name);
        button.disabled = snapshot;
        button.title = hint;
      }
      get("inspector-follow").setAttribute("aria-pressed", String(follow));
      get("inspector-pause").setAttribute("aria-pressed", String(paused));
      const jump = get("inspector-jump");
      jump.hidden = follow || !unseen;
      jump.textContent = unseen + " new · jump to latest";
      const fresh = pending
        ? pending.turns
            .map((turn) => turnParts(turn, isLoaded(pending)))
            .filter((turn) => turn && (pending.generation !== generation || !nodes.has(turn.id)))
            .length
        : 0;
      get("inspector-buffer").textContent = paused
        ? fresh
          ? "Paused · " + fresh + " new held"
          : "Paused"
        : "";
    }
    function toEnd() {
      log.scrollTop = log.scrollHeight;
      unseen = 0;
    }
    function fill(item, turn) {
      const open = !!(item.details && item.details.open);
      const head = make("span", "turn-head", ""),
        body = make("p", "turn-text", turn.text);
      head.append(
        make("span", "turn-role", turn.label),
        make("span", "turn-time", turn.at ? clock(turn.at) : "time unknown"),
      );
      const cut = turn.truncated
        ? make(
            "span",
            "turn-cut",
            "… truncated at " +
              count((last && last.window && last.window.maxTextChars) || 8000) +
              " characters",
          )
        : null;
      if (turn.tool) {
        const details = make("details", "turn-tool", "");
        details.open = open;
        details.append(
          make("summary", "", turn.tool.name + " · " + turn.tool.phase + " · " + turn.tool.outcome),
          body,
        );
        if (cut) details.append(cut);
        item.details = details;
        item.replaceChildren(head, details);
      } else {
        item.details = null;
        item.replaceChildren(head, body, ...(cut ? [cut] : []));
      }
      item.key = turn.key;
    }
    function turns(data) {
      const fresh = data.generation !== generation;
      if (fresh) {
        resetLog();
        generation = data.generation;
      }
      const seen = new Set(),
        list = data.turns
          .map((turn) => turnParts(turn, isLoaded(data)))
          .filter((turn) => turn && !seen.has(turn.id) && seen.add(turn.id));
      for (const [key, node] of nodes)
        if (!seen.has(key)) {
          node.remove();
          nodes.delete(key);
        }
      let added = 0;
      list.forEach((turn, index) => {
        const existing = nodes.get(turn.id);
        if (existing) {
          if (existing.key !== turn.key) fill(existing, turn);
          return;
        }
        const item = make("li", "turn turn-" + turn.role, null);
        item.dataset.turnId = turn.id;
        fill(item, turn);
        const before =
          list
            .slice(index + 1)
            .map((next) => nodes.get(next.id))
            .find(Boolean) || null;
        log.insertBefore(item, before);
        nodes.set(turn.id, item);
        added++;
      });
      get("inspector-empty").hidden = list.length > 0;
      get("inspector-empty").textContent = "No conversation turns in this snapshot yet.";
      if (follow) toEnd();
      else if (!fresh) unseen += added;
      controls();
    }
    function unavailable(reason) {
      health(REASONS[reason] || "Inspector data is unavailable.", "unavailable");
      resetLog();
      get("inspector-empty").hidden = false;
      get("inspector-empty").textContent =
        "No conversation is shown while the session is unavailable.";
      controls();
    }
    // Loaded window text and its stats leave the page before anything else is shown in their place.
    function withdrawSnapshot(message, state) {
      last = null;
      stats(null);
      resetLog();
      controls();
      get("inspector-empty").hidden = false;
      get("inspector-empty").textContent = "No text is shown until this window is read again.";
      health(message, state);
    }
    function receive(snapshot) {
      // The next window read is in flight: the previous snapshot is withdrawn now, not when the read settles.
      if (snapshot.pending && windowed && last) {
        withdrawSnapshot("Reading this window again…", "loading");
        return;
      }
      if (!snapshot.error && snapshot.hasData && snapshot.data === seen) return;
      if (snapshot.hasData) seen = snapshot.data;
      if (snapshot.error) {
        if (/\bhttp 404\b/.test(snapshot.error.message)) {
          last = null;
          stats(null);
          unavailable("unknown-session");
          return;
        }
        // An unrefreshed window snapshot is withdrawn: nothing proves the same conversation is still on screen.
        if (windowed) {
          withdrawSnapshot(
            "Could not refresh this window snapshot; its text was withdrawn.",
            "stale",
          );
          return;
        }
        health(
          last
            ? "Stale · could not refresh · snapshot from " + Model.age(last.asOf, now())
            : "The inspector service could not be reached.",
          "stale",
        );
        return;
      }
      if (!snapshot.hasData) {
        health("Loading snapshot…", "loading");
        return;
      }
      const data = snapshot.data;
      if (data.id !== id) return;
      /* The server re-reads its own inventory, so it can find another session behind this row before the browser's
         roster does. Only a reply proving this panel's exact target is shown or held by Pause; anything else locks it. */
      if (
        data.health === "available"
          ? data.inspectionIdentity !== expected
          : data.reason === "identity-mismatch"
      ) {
        lock(REPLACED);
        return;
      }
      // Unavailability is never held back by Pause: the conversation is withdrawn at once.
      if (data.health !== "available") {
        last = data;
        stats(data.stats);
        unavailable(data.reason);
        return;
      }
      // Pause holds transcript reads only; a window snapshot always replaces the previous one whole.
      if (isSnapshot(data)) {
        windowed = true;
        paused = false;
        pending = null;
      }
      if (paused) {
        pending = data;
        health("Paused · newer snapshot from " + clock(data.asOf) + " held", "available");
        controls();
        return;
      }
      apply(data);
    }
    // Stats, turns and the window notice always describe the one snapshot on screen.
    function apply(data) {
      last = data;
      stats(data.stats);
      turns(data);
      notice(data);
      health("Snapshot as of " + clock(data.asOf), "available");
    }
    // After the turn reconcile: a generation reset clears the log, never the notice of the snapshot being shown.
    function notice(data) {
      const window = data.window && typeof data.window === "object" ? data.window : {};
      get("inspector-window").textContent = Number.isFinite(window.maxTurns)
        ? "last " + window.maxTurns + " turns max"
        : "";
      get("inspector-truncated").hidden = data.truncated !== true;
      get("inspector-truncated").textContent = isSnapshot(data)
        ? "Partial: only text loaded in the app window was read, and some may be cut."
        : "Bounded window: earlier, oversized or unreadable entries are not shown.";
      const kind = data.provenance && data.provenance.kind;
      get("inspector-provenance").textContent = PROVENANCE[kind] || "";
      if (isSnapshot(data)) dialog.dataset.provenance = "window-snapshot";
      else delete dialog.dataset.provenance;
    }
    function poll() {
      const key = "observer.inspect." + id;
      // Each read names the exact target this panel was opened for; the server answers for that target or not at all.
      QuerySpine.define(key, {
        path:
          "/api/observer/sessions/" +
          encodeURIComponent(id) +
          "/inspect?identity=" +
          encodeURIComponent(expected),
        ttlMs: 2000,
        pollMs: 2000,
        timeoutMs: 10000,
        validate: valid,
        retainOnUnsubscribe: false,
      }); // a closed inspector keeps no conversation cache for a reused pane id
      unsubscribe = QuerySpine.subscribe(key, (snapshot) => {
        if ("observer.inspect." + id === key) receive(snapshot);
      });
    }
    function stop() {
      if (unsubscribe) unsubscribe();
      unsubscribe = null;
      seen = null;
    }
    function open(next, target) {
      if (!next) return;
      id = next;
      expected = target == null ? null : target;
      identity = undefined;
      follow = true;
      paused = false;
      suspended = false;
      locked = false;
      covered = false;
      header();
      sync();
      onChange(id);
    }
    // Restarting reads from scratch; a covered or hidden panel only clears and waits until it is shown again.
    function restart() {
      stop();
      last = null;
      windowed = false;
      resetLog();
      stats(null);
      health("Loading snapshot…", "loading");
      controls();
      if (!covered && !suspended) poll();
    }
    function withhold(message) {
      stop();
      last = null;
      resetLog();
      stats(null);
      unavailable(null);
      health(message, "unavailable");
    }
    const missing = (row) =>
      !row
        ? "This session left the roster; its conversation is withheld."
        : row.inventory === "unavailable"
          ? REASONS["inventory-unavailable"]
          : REASONS["identity-unavailable"];
    const REPLACED = "This row now shows a different session; open it again to read it.";
    function lock(message) {
      locked = true;
      identity = null;
      withhold(message);
    }
    /* Roster and inspector polls are independent. A row that leaves the roster or turns stale or unavailable clears
       the conversation at once; a different session behind the row locks this panel, which belongs to the session
       it was opened for. Covered panels are reconciled the same way. */
    function sync() {
      if (id === null || suspended || locked) return;
      const row = describe(id),
        next = row && row.inventory !== "unavailable" ? row.identity : null;
      if (next != null && next !== expected) {
        lock(REPLACED);
        return;
      }
      if (next === identity) return;
      identity = next;
      if (next == null) withhold(missing(row));
      else restart();
    }
    function close() {
      if (id === null) return;
      stop();
      id = null;
      expected = null;
      identity = undefined;
      last = null;
      suspended = false;
      locked = false;
      covered = false;
      resetLog();
      onChange(null);
    }
    get("inspector-close").addEventListener("click", () => (requestClose || close)());
    get("inspector-follow").addEventListener("click", () => {
      follow = !follow;
      if (follow) toEnd();
      controls();
    });
    get("inspector-pause").addEventListener("click", () => {
      paused = !paused;
      if (!paused && pending) {
        const data = pending;
        pending = null;
        apply(data);
      } else controls();
    });
    get("inspector-jump").addEventListener("click", () => {
      follow = true;
      toEnd();
      controls();
    });
    log.addEventListener("scroll", () => {
      const atEnd = log.scrollHeight - log.scrollTop - log.clientHeight < 24;
      if (follow && !atEnd) follow = false;
      else if (!follow && atEnd) {
        follow = true;
        unseen = 0;
      }
      controls();
    });
    /* Covered: a lower stack entry stops polling. A transcript keeps its bounded redacted rows, Follow, Pause and
       held snapshot under its unchanged identity; a window snapshot proves nothing once unread, so it is withdrawn. */
    function cover() {
      if (id === null || covered) return;
      covered = true;
      stop();
      if (windowed && last)
        withdrawSnapshot("Covered · this window is read again when shown.", "loading");
    }
    // Revealed: reconcile first, then read again; a kept transcript continues from its own state.
    function reveal() {
      if (id === null || !covered) return;
      covered = false;
      if (suspended || locked) return;
      sync();
      if (identity != null && !unsubscribe && !locked) poll();
    }
    /* Hidden page: no conversation poll, and the rows are withdrawn rather than kept on an unproven identity.
       The chosen session, Follow and Pause stay; the Pause buffer goes with the rows. */
    function suspend() {
      if (!id || suspended) return;
      if (!locked) held = identity; // a lock survives repeated hide/show cycles; only a new open clears it
      stop();
      last = null;
      resetLog();
      stats(null);
      suspended = true;
      health("Not refreshed while the page is hidden.", "loading");
      controls();
    }
    // Called after a fresh inventory: only the exact identity inspected before hiding reads again (when on top).
    function resume() {
      if (!suspended) return;
      suspended = false;
      const row = describe(id),
        next = row && row.inventory !== "unavailable" ? row.identity : null;
      if (!locked && next != null && next === held && next === expected) {
        identity = next;
        restart();
        return;
      }
      lock(next != null ? REPLACED : missing(row));
    }
    return {
      open,
      close,
      cover,
      reveal,
      suspend,
      resume,
      isOpen: () => !!id,
      current: () => id,
      isCovered: () => covered,
      focusTarget: () => title,
      roster: () => {
        if (id) {
          header();
          sync();
        }
      },
    };
  }
  return { createInspector, buildPanel, statRows, turnParts, formatDuration, REASONS, MOBILE };
})();
if (typeof module !== "undefined" && module.exports) module.exports = ObserverInspector;
