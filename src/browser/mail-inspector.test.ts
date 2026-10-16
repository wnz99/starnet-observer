import { test, expect } from "bun:test";
import {
  createMailInspector,
  buildPanel,
  valid,
  validIdentity,
  validId,
} from "./mail-inspector.js";
import { fixtureDocument } from "./inspector/dom.fixture.js";
function reader() {
  const calls: { path: string; signal: AbortSignal; resolve: (value: unknown) => void }[] = [];
  return {
    calls,
    fetchJson: (path: string, options: { signal: AbortSignal }) =>
      new Promise<unknown>((resolve) => {
        calls.push({ path, signal: options.signal, resolve });
      }),
  };
}
const identity = "mail_" + "7".repeat(64);
const tick = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
test("message panels keep unique accessible parts and only valid identity-bound payloads show", async () => {
  const panel = buildPanel(fixtureDocument, 3),
    other = buildPanel(fixtureDocument, 4);
  expect(panel.root.tag).toBe("dialog");
  expect(panel.get("mail-inspector-title").id).toBe("mail-inspector-title-3");
  expect(panel.get("mail-inspector-body").id).not.toBe(other.get("mail-inspector-body").id);
  expect(panel.get("mail-inspector-body").tag).toBe("pre");
  const read = reader();
  const inspector = createMailInspector({
    get: panel.get,
    fetchJson: read.fetchJson,
    describe: () => ({ identity, eligible: true, text: "A to B" }),
  });
  inspector.open(7, identity);
  await tick();
  expect(read.calls).toHaveLength(1);
  expect(read.calls[0]?.path).toBe(`/api/observer/messages/7/inspect?identity=${identity}`);
  read.calls[0]?.resolve({
    id: 7,
    health: "available",
    identity,
    text: "<script>literal</script>",
    asOf: "2026-10-11T10:00:00.000Z",
  });
  await tick();
  expect(panel.get("mail-inspector-body").textContent).toBe("<script>literal</script>");
  inspector.cover();
  inspector.reveal();
  inspector.resume();
  expect(read.calls).toHaveLength(1);
  inspector.suspend();
  expect(panel.get("mail-inspector-body").textContent).toBe("");
  inspector.reveal();
  inspector.resume();
  expect(read.calls).toHaveLength(1);
});
test("cover, close and ledger replacement cancel reads and discard late body responses", async () => {
  const panel = buildPanel(fixtureDocument, 1),
    read = reader();
  let current = identity;
  const inspector = createMailInspector({
    get: panel.get,
    fetchJson: read.fetchJson,
    describe: () => ({ identity: current, eligible: true, text: "A to B" }),
  });
  inspector.open(7, identity);
  await tick();
  inspector.cover();
  const first = read.calls[0];
  expect(first?.signal.aborted).toBeTruthy();
  read.calls[0]?.resolve({ id: 7, health: "available", identity, text: "late" });
  await tick();
  expect(panel.get("mail-inspector-body").textContent).toBe("");
  inspector.open(7, identity);
  await tick();
  current = "mail_" + "8".repeat(64);
  inspector.roster();
  const second = read.calls[1];
  expect(second?.signal.aborted).toBeTruthy();
  read.calls[1]?.resolve({ id: 7, health: "available", identity, text: "old" });
  await tick();
  expect(panel.get("mail-inspector-body").textContent).toBe("");
  inspector.close();
  expect(inspector.isOpen()).toBeFalsy();
});
test("body validation rejects wrong identities, unavailable text shape and invalid message IDs", () => {
  expect(validId(7)).toBeTruthy();
  expect(validId("7")).toBeFalsy();
  expect(validIdentity(identity)).toBeTruthy();
  expect(validIdentity(identity.slice(1))).toBeFalsy();
  expect(valid({ id: 8, health: "available", text: "x" }, 7)).toBeFalsy();
  expect(valid({ id: 7, health: "available", text: null }, 7)).toBeFalsy();
  expect(valid({ id: 7, health: "unavailable", text: null, reason: "missing" }, 7)).toBeTruthy();
});

test("unavailable responses retain explicit reasons even when their timestamp is null", async () => {
  const panel = buildPanel(fixtureDocument, 1),
    read = reader();
  const inspector = createMailInspector({
    get: panel.get,
    fetchJson: read.fetchJson,
    describe: () => ({ identity, eligible: true, text: "A to B" }),
  });
  inspector.open(7, identity);
  await tick();
  read.calls[0]?.resolve({
    id: 7,
    health: "unavailable",
    identity: null,
    text: null,
    asOf: null,
    reason: "missing-message",
  });
  await tick();
  expect(panel.get("mail-inspector-health").textContent).toBe(
    "This message is no longer in the bus.",
  );
  expect(panel.get("mail-inspector-body").hidden).toBeTruthy();
});
