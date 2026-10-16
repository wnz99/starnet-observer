import assert from "node:assert/strict";
import { test, expect } from "bun:test";
import * as Mail from "./mail-inspector.js";
import { fixtureDocument, focusCalls } from "./inspector/dom.fixture.js";
interface ReadCall {
  path: string;
  options: { signal: AbortSignal; timeoutMs: number };
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}
function at<T>(values: readonly T[], index: number): T {
  const value = values[index];
  assert.ok(value !== undefined);
  return value;
}
function required<K, V>(values: ReadonlyMap<K, V>, key: K): V {
  const value = values.get(key);
  assert.ok(value !== undefined);
  return value;
}
test("original mail inspector validation, identity, read and visibility lifecycle", async () => {
  focusCalls.length = 0;
  expect(Mail.validId(7)).toBeTrue();
  expect(Mail.validId(0)).toBeFalse();
  expect(Mail.validId(-1)).toBeFalse();
  expect(Mail.validId(1.5)).toBeFalse();
  expect(Mail.validId("7")).toBeFalse();
  expect(Mail.validId(2 ** 53)).toBeFalse();
  expect(Mail.valid({ id: 7, health: "available", text: "x" }, 7)).toBeTrue();
  expect(
    Mail.valid({ id: 7, health: "available", text: null }, 7),
    "available needs text",
  ).toBeFalse();
  expect(Mail.valid({ id: 7, health: "unavailable", text: null, reason: "missing" }, 7)).toBeTrue();
  expect(
    Mail.valid({ id: 8, health: "available", text: "x" }, 7),
    "an answer for another id is rejected",
  ).toBeFalse();
  expect(Mail.valid({ id: 7, health: "stale", text: "x" }, 7)).toBeFalse();
  const ID7 = "mail_" + "7".repeat(64),
    ID8 = "mail_" + "8".repeat(64),
    OTHER = "mail_" + "a".repeat(64);
  expect(Mail.validIdentity(ID7)).toBeTrue();
  expect(Mail.validIdentity("mail_" + "A".repeat(64))).toBeFalse();
  expect(Mail.validIdentity(undefined)).toBeFalse();
  expect(Mail.validIdentity(ID7.slice(1))).toBeFalse();
  expect(
    Mail.validIdentity("mail_" + "7".repeat(63)),
    "only the exact digest shape is an identity",
  ).toBeFalse();
  const shell = Mail.buildPanel(fixtureDocument, 3),
    other = Mail.buildPanel(fixtureDocument, 4);
  assert.equal(shell.root.tag, "dialog");
  assert.equal(shell.get("mail-inspector-title").id, "mail-inspector-title-3");
  assert.notEqual(
    shell.get("mail-inspector-body").id,
    other.get("mail-inspector-body").id,
    "two panels never share an element id",
  );
  assert.equal(shell.root.attributes.get("aria-labelledby"), "mail-inspector-title-3");
  assert.equal(shell.root.attributes.get("aria-describedby"), "mail-inspector-health-3");
  const el = (part: string) => shell.get(part);
  const calls: ReadCall[] = [],
    changes: (number | null)[] = [],
    closes: number[] = [];
  const ledger = new Map([
    [7, { text: "from Claude · 1 · to Codex · 2", identity: ID7, eligible: true }],
    [8, { text: "from Codex · 2 · to Claude · 1", identity: ID8, eligible: true }],
  ]);
  const fetchJson = (path: string, options: { signal: AbortSignal; timeoutMs: number }) =>
    new Promise<unknown>((resolve, reject) => {
      calls.push({ path, options, resolve, reject });
    });
  const mail = Mail.createMailInspector({
    get: el,
    fetchJson,
    describe: (id) => ledger.get(id) || null,
    onChange: (id) => changes.push(id),
    requestClose: () => closes.push(1),
  });
  const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
  const body = el("mail-inspector-body"),
    healthText = () => el("mail-inspector-health").textContent;
  assert.equal(body.tag, "pre");
  const answer = (
    id: number,
    identity: string,
    text: string,
    extra: Record<string, unknown> = {},
  ) => ({
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

  mail.open("7", ID7);
  mail.open(0, ID7);
  mail.open(1.5, ID7);
  await tick();
  assert.equal(calls.length, 0, "an invalid id never fetches");
  expect(mail.isOpen()).toBeFalse();
  // A message without a verified identity is never read.
  mail.open(7, undefined);
  await tick();
  assert.equal(calls.length, 0, "no identity, no read");
  assert.equal(healthText(), Mail.REASONS["invalid-identity"]);
  expect(body.hidden).toBeTrue();
  mail.close();

  mail.open(7, ID7);
  await tick();
  assert.equal(calls.length, 1);
  assert.equal(at(calls, 0).path, "/api/observer/messages/7/inspect?identity=" + ID7);
  assert(at(calls, 0).options.signal, "the read can be aborted");
  expect(shell.root.open, "an instance never shows itself: the panel stack does").toBeFalse();
  assert.equal(focusCalls.length, 0, "nor moves focus");
  assert.equal(el("mail-inspector-title").textContent, "Message #7");
  assert.equal(el("mail-inspector-meta").textContent, required(ledger, 7).text);
  assert.equal(healthText(), "Reading message…");
  expect(body.hidden).toBeTrue();
  assert.deepEqual(changes, [7, null, 7]);
  at(calls, 0).resolve(answer(7, ID7, "<img src=x onerror=1> hi", { truncated: true }));
  await tick();
  assert.equal(body.textContent, "<img src=x onerror=1> hi");
  expect(body.hidden).toBeFalse();
  assert.equal(body.children.length, 0, "set through textContent only");
  expect(el("mail-inspector-truncated").hidden).toBeFalse();
  assert(el("mail-inspector-truncated").textContent.includes("32,768"));
  assert(healthText().startsWith("Read as of"));

  ledger.set(7, { ...required(ledger, 7), text: "from Claude · 1 · to Codex · 2 · acknowledged" });
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
  at(calls, 0).resolve(answer(7, ID7, "stale body"));
  await tick();
  assert.equal(body.textContent, "", "a late answer for the previous message is dropped");
  assert.equal(healthText(), "Reading message…");
  at(calls, 1).resolve(answer(8, OTHER, "someone else"));
  await tick();
  assert.equal(body.textContent, "");
  expect(body.hidden).toBeTrue();
  assert.equal(healthText(), Mail.REASONS["identity-mismatch"]);
  mail.open(8, ID8);
  await tick();
  at(calls, calls.length - 1).resolve(answer(8, ID8, ""));
  await tick();
  expect(body.hidden).toBeTrue();
  assert.equal(el("mail-inspector-empty").textContent, "This message has no text.");

  const withdrawals: [string, () => unknown, () => unknown][] = [
    [
      "changed identity",
      () => ledger.set(7, { ...required(ledger, 7), identity: OTHER }),
      () => ledger.set(7, { ...required(ledger, 7), identity: ID7 }),
    ],
    [
      "left the window",
      () => ledger.delete(7),
      () =>
        ledger.set(7, { text: "from Claude · 1 · to Codex · 2", identity: ID7, eligible: true }),
    ],
    [
      "bus unreadable",
      () => ledger.set(7, { ...required(ledger, 7), eligible: false }),
      () => ledger.set(7, { ...required(ledger, 7), eligible: true }),
    ],
  ];
  for (const [label, change, restore] of withdrawals) {
    mail.open(7, ID7);
    await tick();
    at(calls, calls.length - 1).resolve(answer(7, ID7, "readable"));
    await tick();
    assert.equal(body.textContent, "readable", label + ": read");
    const reads: number = calls.length;
    change();
    mail.roster();
    assert.equal(body.textContent, "", label + ": withdrawn at once");
    expect(body.hidden).toBeTrue();
    restore();
    mail.roster();
    mail.reveal();
    await tick();
    assert.equal(body.textContent, "", label + ": never revived");
    assert.equal(calls.length, reads, label + ": and not read again by itself");
  }
  mail.open(7, ID7);
  await tick();
  {
    const pending = at(calls, calls.length - 1),
      reads = calls.length;
    mail.cover();
    assert.ok(pending.options.signal.aborted, "cover aborts the pending read");
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
  expect(
    at(calls, calls.length - 1).path.endsWith(ID7),
    "another explicit open reads again",
  ).toBeTrue();
  at(calls, calls.length - 1).resolve(answer(7, ID7, "kept"));
  await tick();
  {
    const reads: number = calls.length;
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
    const pending = at(calls, calls.length - 1);
    mail.suspend();
    pending.resolve(answer(7, ID7, "late after hide"));
    await tick();
    mail.resume();
    assert.equal(body.textContent, "", "a read in flight while hidden is rejected");
  }
  // A withdrawal also drops a read still in flight.
  mail.open(7, ID7);
  await tick();
  const changedIdentityRead = at(calls, calls.length - 1);
  ledger.set(7, { ...required(ledger, 7), identity: OTHER });
  mail.roster();
  assert.ok(changedIdentityRead.options.signal.aborted);
  changedIdentityRead.resolve(answer(7, ID7, "old identity pending"));
  await tick();
  assert.equal(body.textContent, "");
  ledger.set(7, { ...required(ledger, 7), identity: ID7 });
  mail.open(7, ID7);
  await tick();
  const inflight = at(calls, calls.length - 1);
  ledger.set(7, { ...required(ledger, 7), eligible: false });
  mail.roster();
  assert.ok(inflight.options.signal.aborted);
  ledger.set(7, { ...required(ledger, 7), eligible: true });
  inflight.resolve(answer(7, ID7, "too late"));
  await tick();
  assert.equal(body.textContent, "", "a late read never revives a withdrawn body");

  mail.open(7, ID7);
  await tick();
  let aborted = false;
  const signal = at(calls, calls.length - 1).options.signal;
  signal.onabort = () => {
    aborted = true;
  };
  mail.close();
  expect(mail.isOpen()).toBeFalse();
  assert.equal(changes.at(-1), null);
  assert.ok(signal.aborted, "closing aborts the read");
  assert.ok(aborted, "closing dispatches onabort");
  at(calls, calls.length - 1).resolve(answer(7, ID7, "after close"));
  await tick();
  assert.equal(body.textContent, "", "a result after close is discarded");
  assert.equal(healthText(), "");
  mail.open(7, ID7);
  el("mail-inspector-close").click();
  assert.deepEqual(closes, [1], "the close button asks the panel stack");
  mail.close();

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
    at(calls, calls.length - 1).resolve({
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
    expect(body.hidden).toBeTrue();
    assert.equal(el("mail-inspector-empty").textContent, "No message text is shown.");
    mail.close();
  }
  mail.open(7, ID7);
  await tick();
  at(calls, calls.length - 1).reject(new Error("http 404"));
  await tick();
  assert.equal(healthText(), Mail.REASONS["missing-message"]);
  mail.close();
  mail.open(7, ID7);
  await tick();
  at(calls, calls.length - 1).reject(
    new Error("The station took too long to respond. Please retry."),
  );
  await tick();
  assert.equal(healthText(), "The message could not be read. Close and reopen to retry.");
  mail.close();
  mail.open(7, ID7);
  await tick();
  at(calls, calls.length - 1).resolve({ id: 7, identity: ID7, health: "available", text: 42 });
  await tick();
  assert(healthText().startsWith("The sidecar returned an unreadable answer"));
  expect(body.hidden).toBeTrue();
  mail.close();
  mail.open(9, ID7);
  assert.equal(el("mail-inspector-meta").textContent, "No longer in the recent bus window.");
  mail.close();
});

test("terminal mail disposal aborts one panel and rejects queued reads and retained close", async () => {
  const identity = "mail_" + "7".repeat(64);
  const panels = [1, 2, 3].map((number) => Mail.buildPanel(fixtureDocument, number));
  const reads: ReadCall[] = [];
  let descriptions = 0,
    closes = 0,
    gets = 0;
  const inspectors = panels.map((panel) =>
    Mail.createMailInspector({
      get(part) {
        gets++;
        return panel.get(part);
      },
      fetchJson: (path, options) =>
        new Promise((resolve, reject) => {
          reads.push({ path, options, resolve, reject });
        }),
      describe() {
        descriptions++;
        return { text: "Message", identity: undefined, eligible: false };
      },
      requestClose() {
        closes++;
      },
    }),
  );
  const first = at(inspectors, 0),
    second = at(inspectors, 1),
    queued = at(inspectors, 2);
  first.open(7, identity);
  second.open(8, identity);
  queued.open(9, identity);
  queued.dispose();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(reads.length, 2, "dispose before deferred fetch prevents acquisition");
  const panel = at(panels, 0),
    callback = required(panel.get("mail-inspector-close").handlers, "click");
  at(reads, 0).options.signal.addEventListener("abort", () => {
    first.dispose();
    at(reads, 0).resolve({ id: 7, identity, health: "available", text: "reentrant settlement" });
  });
  first.dispose();
  first.dispose();
  expect(at(reads, 0).options.signal.aborted).toBeTrue();
  expect(at(reads, 1).options.signal.aborted).toBeFalse();
  const text = panel.get("mail-inspector-body").textContent,
    count = descriptions,
    getCount = gets,
    focus = focusCalls.length;
  callback();
  first.open(7, identity);
  first.close();
  first.roster();
  first.cover();
  first.suspend();
  first.reveal();
  first.resume();
  first.focusTarget();
  at(reads, 0).resolve({ id: 7, identity, health: "available", text: "late private body" });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(panel.get("mail-inspector-body").textContent, text);
  assert.equal(descriptions, count);
  assert.equal(gets, getCount);
  assert.equal(closes, 0);
  assert.equal(reads.length, 2);
  assert.equal(focusCalls.length, focus);
  assert.equal(first.current(), null);
  expect(first.isOpen()).toBeFalse();
  assert.equal(panel.get("mail-inspector-close").handlers.size, 0);
  at(panels, 1).get("mail-inspector-close").click();
  assert.equal(closes, 1);
  second.dispose();
  at(reads, 1).reject(new Error("late failure"));
  await new Promise<void>((resolve) => setImmediate(resolve));
});
