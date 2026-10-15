/* Mail inspector: one read-only look at a single llm-bus message body. The ledger keeps polling metadata only;
   the body is fetched once per open, bound to the message's body-free identity, arrives redacted and capped from
   the sidecar, and is only set through textContent. Opening never acknowledges, sends or wakes. Each open panel is
   its own instance with its own DOM; the controller's panel stack owns showing, modality, Escape and focus. */
"use strict";
const ObserverMailInspector = (() => {
  const REASONS = {
    "invalid-message": "This is not a valid bus message id.",
    "missing-message": "This message is no longer in the bus.",
    "invalid-identity": "This message could not be identified, so no text is shown.",
    "identity-mismatch":
      "The bus no longer holds the message that was listed, so no text is shown.",
    missing: "No bus database found.",
    unsupported: "Bus SQLite support unavailable; use the supported Bun runtime.",
    unstable: "The bus was busy while copying. Close and reopen to retry.",
    unreadable: "The bus could not be read.",
  };
  const IDENTITY = /^mail_[a-f0-9]{64}$/;
  const validId = (id) => Number.isSafeInteger(id) && id > 0;
  const validIdentity = (value) => typeof value === "string" && IDENTITY.test(value);
  const valid = (data, id) =>
    !!(
      data &&
      typeof data === "object" &&
      data.id === id &&
      ["available", "unavailable"].includes(data.health) &&
      (data.health === "unavailable" || typeof data.text === "string")
    );
  const clock = (iso) => {
    const at = Date.parse(iso);
    return Number.isFinite(at)
      ? new Date(at).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })
      : "an unknown time";
  };

  // One panel's DOM; element ids carry the panel number so several open panels never share an id.
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
    const dialog = make("dialog", "mail-inspector", "inspector mail-inspector"),
      head = make("header", null, "inspector-head"),
      bar = make("div", null, "inspector-bar");
    const close = make("button", "mail-inspector-close", "", "Close");
    close.type = "button";
    close.setAttribute("aria-label", "Close message");
    bar.append(
      make("span", null, "eyebrow", "MAIL"),
      make("span", null, "read-only", "READ ONLY"),
      make("span", "mail-inspector-stack", "panel-stack", ""),
      close,
    );
    const title = make("h2", "mail-inspector-title", "", "Message");
    title.tabIndex = -1;
    const health = make("p", "mail-inspector-health", "inspector-health", "");
    health.setAttribute("role", "status");
    health.setAttribute("aria-live", "polite");
    head.append(bar, title, make("p", "mail-inspector-meta", "inspector-task", ""), health);
    const section = make("section", null, "inspector-conversation"),
      logHead = make("div", null, "inspector-log-head"),
      bodyTitle = make("h3", "mail-inspector-body-title", "", "Message text");
    logHead.append(bodyTitle);
    const truncated = make("p", "mail-inspector-truncated", "inspector-note", ""),
      empty = make("p", "mail-inspector-empty", "inspector-note", "");
    const body = make("pre", "mail-inspector-body", "mail-body", "");
    body.tabIndex = 0;
    body.setAttribute("aria-labelledby", bodyTitle.id);
    truncated.hidden = true;
    empty.hidden = true;
    body.hidden = true;
    section.setAttribute("aria-labelledby", bodyTitle.id);
    section.append(logHead, truncated, body, empty);
    dialog.setAttribute("aria-labelledby", title.id);
    dialog.setAttribute("aria-describedby", health.id);
    dialog.append(
      head,
      section,
      make(
        "p",
        null,
        "inspector-footnote",
        "Redacted plain text read once from the local llm-bus. Opening never acknowledges, sends or wakes.",
      ),
    );
    return { root: dialog, get: (part) => parts[part] };
  }

  /* describe(id) → { text, identity, eligible } from the current ledger, or null when the message left it. */
  function createMailInspector({
    get,
    document,
    fetchJson,
    describe,
    onChange = () => {},
    requestClose = null,
  }) {
    const dialog = get("mail-inspector"),
      title = get("mail-inspector-title"),
      body = get("mail-inspector-body");
    // expected: the exact message identity this panel was opened for. withdrawn: its body may never return.
    // reading: the one read is still in flight.
    let id = null,
      expected = null,
      request = 0,
      abort = null,
      withdrawn = false,
      reading = false;

    function health(message, state) {
      get("mail-inspector-health").textContent = message;
      dialog.dataset.health = state;
    }
    function header() {
      title.textContent = "Message #" + id;
      get("mail-inspector-meta").textContent =
        describe(id)?.text || "No longer in the recent bus window.";
    }
    function clear() {
      body.textContent = "";
      body.hidden = true;
      get("mail-inspector-truncated").hidden = true;
      get("mail-inspector-empty").hidden = true;
    }
    function note(message) {
      get("mail-inspector-empty").textContent = message;
      get("mail-inspector-empty").hidden = false;
    }
    function receive(data) {
      // Only the snapshot that proves the listed identity may show text.
      if (data.health === "available" && data.identity !== expected) {
        health(REASONS["identity-mismatch"], "unavailable");
        note("No message text is shown.");
        return;
      }
      if (data.health !== "available") {
        health(REASONS[data.reason] || "This message is unavailable.", "unavailable");
        note("No message text is shown.");
        return;
      }
      health("Read as of " + clock(data.asOf), "available");
      body.textContent = data.text;
      body.hidden = data.text === "";
      if (data.text === "") note("This message has no text.");
      const cap =
        data.window && Number.isFinite(data.window.maxTextChars) ? data.window.maxTextChars : 32768;
      get("mail-inspector-truncated").hidden = data.truncated !== true;
      get("mail-inspector-truncated").textContent =
        "Truncated: only the first " + cap.toLocaleString("en-US") + " characters are shown.";
    }
    function cancel() {
      request++;
      if (abort) abort();
      abort = null;
      reading = false;
    }
    // One read per open. A close or withdrawal bumps the request number, so a late answer for it is dropped.
    function load() {
      const mine = ++request,
        target = id,
        identity = expected,
        controller = typeof AbortController === "function" ? new AbortController() : null;
      if (abort) abort();
      abort = controller ? () => controller.abort() : null;
      clear();
      health("Reading message…", "loading");
      reading = true;
      // Deferred a microtask so a sync fetch throw lands in the error path; an open superseded in the same turn never fetches.
      Promise.resolve()
        .then(() =>
          mine === request
            ? fetchJson(
                "/api/observer/messages/" +
                  target +
                  "/inspect?identity=" +
                  encodeURIComponent(identity),
                { signal: controller ? controller.signal : undefined, timeoutMs: 10000 },
              )
            : null,
        )
        .then(
          (data) => {
            if (mine !== request) return;
            if (!valid(data, target)) {
              health(
                "The sidecar returned an unreadable answer. Close and reopen to retry.",
                "unavailable",
              );
              note("No message text is shown.");
              return;
            }
            receive(data);
          },
          (error) => {
            if (mine !== request) return;
            health(
              /\bhttp 404\b/.test(error && error.message)
                ? REASONS["missing-message"]
                : "The message could not be read. Close and reopen to retry.",
              "unavailable",
            );
            note("No message text is shown.");
          },
        )
        .finally(() => {
          if (mine === request) {
            abort = null;
            reading = false;
          }
        });
    }
    function withdraw(message) {
      if (withdrawn) return;
      withdrawn = true;
      cancel();
      clear();
      health(message, "unavailable");
      note("No message text is shown. Open the message again to read it.");
    }
    function open(next, identity) {
      if (!validId(next)) return;
      id = next;
      expected = identity;
      withdrawn = false;
      header();
      if (validIdentity(identity)) load();
      else withdraw(REASONS["invalid-identity"]);
      onChange(id);
    }
    function close() {
      if (id === null) return;
      cancel();
      id = null;
      expected = null;
      withdrawn = false;
      clear();
      health("", "idle");
      onChange(null);
    }
    /* Metadata (route, ACK, wake) follows the ledger poll; the body is never refetched while open, covered or revealed.
       A message that leaves the window, changes identity or loses a live bus withdraws its body for good. */
    function roster() {
      if (id === null) return;
      header();
      const row = describe(id);
      if (!row) withdraw("This message left the recent bus window; its text was withdrawn.");
      else if (row.identity !== expected) withdraw(REASONS["identity-mismatch"]);
      else if (!row.eligible)
        withdraw("The bus is not currently readable; the message text was withdrawn.");
    }
    get("mail-inspector-close").addEventListener("click", () => (requestClose || close)());
    /* Covered: a body already read stays and is shown again without a fetch. A read still in flight is cancelled and
       withheld, so a late answer can never fill a covered panel. Hidden page: every body is withdrawn and in-flight
       reads are cancelled. Either way only another explicit open reads again; reveal and resume never fetch. */
    function cover() {
      if (id !== null && reading)
        withdraw("Covered before it was read; open the message again to read it.");
    }
    function suspend() {
      if (id !== null)
        withdraw("Not kept while the page was hidden; open the message again to read it.");
    }
    const idle = () => {};
    return {
      open,
      close,
      roster,
      cover,
      reveal: idle,
      suspend,
      resume: idle,
      isOpen: () => id !== null,
      current: () => id,
      focusTarget: () => title,
    };
  }
  return { createMailInspector, buildPanel, REASONS, valid, validId, validIdentity };
})();
if (typeof module !== "undefined" && module.exports) module.exports = ObserverMailInspector;
