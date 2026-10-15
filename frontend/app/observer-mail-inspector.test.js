"use strict";
const { test } = require("bun:test");

test("observer-mail-inspector regression contracts", async () => {
  const assert = require("node:assert/strict");
  const Mail = require("./observer-mail-inspector.js");

  assert.equal(Mail.validId(7), true);
  assert.equal(Mail.validId(0), false);
  assert.equal(Mail.validId(-1), false);
  assert.equal(Mail.validId(1.5), false);
  assert.equal(Mail.validId("7"), false);
  assert.equal(Mail.validId(2 ** 53), false);
  assert.equal(Mail.valid({ id: 7, health: "available", text: "x" }, 7), true);
  assert.equal(
    Mail.valid({ id: 7, health: "available", text: null }, 7),
    false,
    "available needs text",
  );
  assert.equal(
    Mail.valid({ id: 7, health: "unavailable", text: null, reason: "missing" }, 7),
    true,
  );
  assert.equal(
    Mail.valid({ id: 8, health: "available", text: "x" }, 7),
    false,
    "an answer for another id is rejected",
  );
  assert.equal(Mail.valid({ id: 7, health: "stale", text: "x" }, 7), false);
  const ID7 = "mail_" + "7".repeat(64),
    ID8 = "mail_" + "8".repeat(64),
    OTHER = "mail_" + "a".repeat(64);
  assert.equal(Mail.validIdentity(ID7), true);
  assert.equal(Mail.validIdentity("mail_" + "A".repeat(64)), false);
  assert.equal(Mail.validIdentity(undefined), false);
  assert.equal(
    Mail.validIdentity("mail_" + "7".repeat(63)),
    false,
    "only the exact digest shape is an identity",
  );

  let document;
  function element(tag = "div") {
    return {
      tag,
      className: "",
      id: "",
      textContent: "",
      children: [],
      hidden: false,
      dataset: {},
      attributes: {},
      handlers: {},
      scrollTop: 0,
      open: false,
      parent: null,
      isConnected: true,
      append(...nodes) {
        for (const node of nodes) {
          node.parent = this;
          this.children.push(node);
        }
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
    };
  }
  document = { activeElement: null, createElement: element };
  // Each panel builds its own DOM; parts are found by name and ids carry the panel number.
  const shell = Mail.buildPanel(document, 3),
    other = Mail.buildPanel(document, 4);
  assert.equal(shell.root.tag, "dialog");
  assert.equal(shell.get("mail-inspector-title").id, "mail-inspector-title-3");
  assert.notEqual(
    shell.get("mail-inspector-body").id,
    other.get("mail-inspector-body").id,
    "two panels never share an element id",
  );
  assert.equal(shell.root.attributes["aria-labelledby"], "mail-inspector-title-3");
  assert.equal(shell.root.attributes["aria-describedby"], "mail-inspector-health-3");
  const el = (part) => shell.get(part);
  const calls = [],
    changes = [],
    closes = [];
  const ledger = new Map([
    [7, { text: "from Claude · 1 · to Codex · 2", identity: ID7, eligible: true }],
    [8, { text: "from Codex · 2 · to Claude · 1", identity: ID8, eligible: true }],
  ]);
  const fetchJson = (path, options) =>
    new Promise((resolve, reject) => calls.push({ path, options, resolve, reject }));
  const mail = Mail.createMailInspector({
    get: el,
    document,
    fetchJson,
    describe: (id) => ledger.get(id) || null,
    onChange: (id) => changes.push(id),
    requestClose: () => closes.push(1),
  });
  const tick = () => new Promise((resolve) => setImmediate(resolve));
  const body = el("mail-inspector-body"),
    healthText = () => el("mail-inspector-health").textContent;
  const answer = (id, identity, text, extra = {}) => ({
    id,
    identity,
    health: "available",
    reason: null,
    asOf: new Date().toISOString(),
    text,
    truncated: false,
    window: { maxTextChars: 32768 },
    ...extra,
  });

  await (async () => {
    mail.open("7", ID7);
    mail.open(0, ID7);
    mail.open(1.5, ID7);
    await tick();
    assert.equal(calls.length, 0, "an invalid id never fetches");
    assert.equal(mail.isOpen(), false);
    // A message without a verified identity is never read.
    mail.open(7, undefined);
    await tick();
    assert.equal(calls.length, 0, "no identity, no read");
    assert.equal(healthText(), Mail.REASONS["invalid-identity"]);
    assert.equal(body.hidden, true);
    mail.close();

    // One fetch on open, bound to the listed identity; the body arrives as text, never markup.
    mail.open(7, ID7);
    await tick();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].path, "/api/observer/messages/7/inspect?identity=" + ID7);
    assert(calls[0].options.signal, "the read can be aborted");
    assert.equal(shell.root.open, false, "an instance never shows itself: the panel stack does");
    assert.equal(document.activeElement, null, "nor moves focus");
    assert.equal(el("mail-inspector-title").textContent, "Message #7");
    assert.equal(el("mail-inspector-meta").textContent, ledger.get(7).text);
    assert.equal(healthText(), "Reading message…");
    assert.equal(body.hidden, true);
    assert.deepEqual(changes, [7, null, 7]);
    calls[0].resolve(answer(7, ID7, "<img src=x onerror=1> hi", { truncated: true }));
    await tick();
    assert.equal(body.textContent, "<img src=x onerror=1> hi");
    assert.equal(body.hidden, false);
    assert.equal(body.children.length, 0, "set through textContent only");
    assert.equal(el("mail-inspector-truncated").hidden, false);
    assert(el("mail-inspector-truncated").textContent.includes("32,768"));
    assert(healthText().startsWith("Read as of"));

    // Ledger polls refresh the metadata but never refetch; covering and revealing keep the one read.
    ledger.set(7, { ...ledger.get(7), text: "from Claude · 1 · to Codex · 2 · acknowledged" });
    mail.roster();
    mail.cover();
    mail.reveal();
    await tick();
    assert.equal(calls.length, 1, "no polling and no refetch while open, covered or revealed");
    assert(el("mail-inspector-meta").textContent.endsWith("acknowledged"));
    assert.equal(
      body.textContent,
      "<img src=x onerror=1> hi",
      "a revealed message shows the body it already read",
    );

    // An answer proving another message identity shows no text.
    mail.open(8, ID8);
    await tick();
    assert.equal(calls.length, 2);
    assert.equal(body.textContent, "", "the previous body is cleared at once");
    calls[0].resolve(answer(7, ID7, "stale body"));
    await tick();
    assert.equal(body.textContent, "", "a late answer for the previous message is dropped");
    assert.equal(healthText(), "Reading message…");
    calls[1].resolve(answer(8, OTHER, "someone else"));
    await tick();
    assert.equal(body.textContent, "");
    assert.equal(body.hidden, true);
    assert.equal(healthText(), Mail.REASONS["identity-mismatch"]);
    mail.open(8, ID8);
    await tick();
    calls.at(-1).resolve(answer(8, ID8, ""));
    await tick();
    assert.equal(body.hidden, true);
    assert.equal(el("mail-inspector-empty").textContent, "This message has no text.");

    // The roster withdraws a body for good: a changed identity, a departed message or an unreadable bus.
    for (const [label, change, restore] of [
      [
        "changed identity",
        () => ledger.set(7, { ...ledger.get(7), identity: OTHER }),
        () => ledger.set(7, { ...ledger.get(7), identity: ID7 }),
      ],
      [
        "left the window",
        () => ledger.delete(7),
        () =>
          ledger.set(7, { text: "from Claude · 1 · to Codex · 2", identity: ID7, eligible: true }),
      ],
      [
        "bus unreadable",
        () => ledger.set(7, { ...ledger.get(7), eligible: false }),
        () => ledger.set(7, { ...ledger.get(7), eligible: true }),
      ],
    ]) {
      mail.open(7, ID7);
      await tick();
      calls.at(-1).resolve(answer(7, ID7, "readable"));
      await tick();
      assert.equal(body.textContent, "readable", label + ": read");
      const reads = calls.length;
      change();
      mail.roster();
      assert.equal(body.textContent, "", label + ": withdrawn at once");
      assert.equal(body.hidden, true);
      restore();
      mail.roster();
      mail.reveal();
      await tick();
      assert.equal(body.textContent, "", label + ": never revived");
      assert.equal(calls.length, reads, label + ": and not read again by itself");
    }
    // Covered while its read is in flight: cancelled and withheld; the late answer never fills it, and reveal never fetches.
    mail.open(7, ID7);
    await tick();
    {
      const pending = calls.at(-1),
        reads = calls.length;
      mail.cover();
      assert.equal(healthText(), "Covered before it was read; open the message again to read it.");
      pending.resolve(answer(7, ID7, "arrived while covered"));
      await tick();
      mail.reveal();
      await tick();
      assert.equal(body.textContent, "", "a covered pending read never revives");
      assert.equal(calls.length, reads, "and reveal never fetches");
    }
    mail.open(7, ID7);
    await tick();
    assert.equal(calls.at(-1).path.endsWith(ID7), true, "another explicit open reads again");
    calls.at(-1).resolve(answer(7, ID7, "kept"));
    await tick();
    // Hidden page: a loaded body is withdrawn too, and showing the page again never revives or refetches it.
    {
      const reads = calls.length;
      mail.suspend();
      assert.equal(body.textContent, "");
      assert.match(healthText(), /page was hidden/);
      mail.resume();
      mail.reveal();
      await tick();
      assert.equal(body.textContent, "");
      assert.equal(calls.length, reads);
    }
    mail.open(7, ID7);
    await tick();
    {
      const pending = calls.at(-1);
      mail.suspend();
      pending.resolve(answer(7, ID7, "late after hide"));
      await tick();
      mail.resume();
      assert.equal(body.textContent, "", "a read in flight while hidden is rejected");
    }
    // A withdrawal also drops a read still in flight.
    mail.open(7, ID7);
    await tick();
    const inflight = calls.at(-1);
    ledger.set(7, { ...ledger.get(7), eligible: false });
    mail.roster();
    ledger.set(7, { ...ledger.get(7), eligible: true });
    inflight.resolve(answer(7, ID7, "too late"));
    await tick();
    assert.equal(body.textContent, "", "a late read never revives a withdrawn body");

    // Close drops an in-flight read; the close button asks the owner.
    mail.open(7, ID7);
    await tick();
    let aborted = false;
    calls.at(-1).options.signal.addEventListener = (name, fn) => {};
    const signal = calls.at(-1).options.signal;
    signal.onabort = () => {
      aborted = true;
    };
    mail.close();
    assert.equal(mail.isOpen(), false);
    assert.equal(changes.at(-1), null);
    assert.equal(aborted || signal.aborted, true, "closing aborts the read");
    calls.at(-1).resolve(answer(7, ID7, "after close"));
    await tick();
    assert.equal(body.textContent, "", "a result after close is discarded");
    assert.equal(healthText(), "");
    mail.open(7, ID7);
    el("mail-inspector-close").handlers.click();
    assert.deepEqual(closes, [1], "the close button asks the panel stack");
    mail.close();

    // Same-turn changes before the deferred read runs: only the latest open fetches; a closed open fetches nothing.
    const before = calls.length;
    mail.open(7, ID7);
    mail.open(8, ID8);
    await tick();
    assert.deepEqual(
      calls.slice(before).map((call) => call.path),
      ["/api/observer/messages/8/inspect?identity=" + ID8],
      "a superseded open never fetches",
    );
    mail.close();
    const afterSwitch = calls.length;
    mail.open(7, ID7);
    mail.close();
    await tick();
    assert.equal(calls.length, afterSwitch, "an open closed in the same turn never fetches");

    // Every unavailable reason is explicit and shows no text.
    for (const [reason, message] of Object.entries(Mail.REASONS)) {
      mail.open(7, ID7);
      await tick();
      calls.at(-1).resolve({
        id: 7,
        identity: null,
        health: "unavailable",
        reason,
        asOf: null,
        text: null,
        truncated: false,
      });
      await tick();
      assert.equal(healthText(), message);
      assert.equal(body.hidden, true);
      assert.equal(el("mail-inspector-empty").textContent, "No message text is shown.");
      mail.close();
    }
    mail.open(7, ID7);
    await tick();
    calls.at(-1).reject(new Error("http 404"));
    await tick();
    assert.equal(healthText(), Mail.REASONS["missing-message"]);
    mail.close();
    mail.open(7, ID7);
    await tick();
    calls.at(-1).reject(new Error("The station took too long to respond. Please retry."));
    await tick();
    assert.equal(healthText(), "The message could not be read. Close and reopen to retry.");
    mail.close();
    mail.open(7, ID7);
    await tick();
    calls.at(-1).resolve({ id: 7, identity: ID7, health: "available", text: 42 });
    await tick();
    assert(healthText().startsWith("The sidecar returned an unreadable answer"));
    assert.equal(body.hidden, true);
    mail.close();
    mail.open(9, ID7);
    assert.equal(el("mail-inspector-meta").textContent, "No longer in the recent bus window.");
    mail.close();
    console.log(
      "observer mail inspector: id/identity validation, scoped panel DOM, one identity-bound read per open, mismatch/withdrawal never revived, no refetch on cover/reveal, reasons, 404/error, stale-result discard and abort on close OK",
    );
  })();
}, 30000);
