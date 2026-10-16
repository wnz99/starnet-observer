import { test, expect } from "bun:test";
import { createUi, setText } from "./ui.js";
import {
  AppFixtureDocument,
  AppFixtureScheduler,
  AppFixtureWindow,
  createAppFixture,
} from "./dom.fixture.js";

test("moving nodes preserves identity and order but releases removed focus", () => {
  const document = new AppFixtureDocument();
  const left = document.register("left"),
    right = document.register("right");
  const first = document.createElement("button"),
    second = document.createElement("button");
  document.attach(left, first, second);
  second.focus();
  document.insertBefore(left, second, first);
  expect(left.children).toEqual([second, first]);
  expect(document.activeElement).toBe(document.body);
  second.focus();
  document.attach(right, second);
  expect(left.children).toEqual([first]);
  expect(right.children).toEqual([second]);
  expect(document.activeElement).toBe(document.body);
  expect(document.contains(left, second)).toBeFalsy();
  expect(document.contains(right, second)).toBeTruthy();
  document.replaceChildren(right, first);
  expect(left.children).toEqual([]);
  expect(second.parent).toBeNull();
  expect(second.isConnected).toBeFalsy();
  first.remove();
  expect(right.children).toEqual([]);
});

test("removing or replacing a focused subtree releases focus and detached focus is inert", () => {
  const document = new AppFixtureDocument();
  const row = document.register("row");
  const button = document.createElement("button");
  document.attach(row, button);
  button.focus();
  row.remove();
  expect(document.activeElement).toBe(document.body);
  button.focus();
  expect(document.activeElement).toBe(document.body);
  document.attach(document.body, row);
  button.focus();
  document.replaceChildren(document.body);
  expect(document.activeElement).toBe(document.body);
  expect(button.isConnected).toBeFalsy();
});

test("native close dispatch is queued and removal requires the same callback", () => {
  const document = new AppFixtureDocument();
  const dialog = document.register("panel", "dialog");
  let closed = 0;
  const listener = () => {
    closed++;
  };
  dialog.addEventListener("close", listener);
  dialog.addEventListener("close", listener);
  const modal = true;
  document.showDialog(dialog, { modal });
  document.closeDialog(dialog);
  expect(closed).toBe(0);
  expect(document.dialogOpen(dialog)).toBeFalsy();
  dialog.removeEventListener("close", () => {
    closed++;
  });
  expect(dialog.events.count("close")).toBe(1);
  document.flushCloseEvents();
  expect(closed).toBe(1);
  const drawer = false;
  document.showDialog(dialog, { modal: drawer });
  document.closeDialog(dialog);
  dialog.removeEventListener("close", listener);
  document.flushCloseEvents();
  expect(closed).toBe(1);
  expect(dialog.events.removed).toEqual([{ name: "close", listener }]);
  const firstAdded = dialog.events.added[0];
  expect(firstAdded?.listener).toBe(listener);
  listener();
  expect(closed).toBe(2);
});

test("controlled deadlines cancel precisely and intervals retain one active resource", () => {
  const scheduler = new AppFixtureScheduler();
  const calls: string[] = [];
  const cancel = scheduler.timeout(() => calls.push("cancelled"), 5);
  scheduler.timeout(() => calls.push("deadline"), 10);
  const stop = scheduler.interval(() => calls.push("poll"), 4);
  cancel();
  cancel();
  expect(scheduler.timers.size).toBe(2);
  scheduler.advance(9);
  expect(calls).toEqual(["poll", "poll"]);
  expect([...scheduler.timers.values()].map((timer) => timer.deadline)).toEqual([10, 12]);
  scheduler.advance(3);
  expect(calls).toEqual(["poll", "poll", "deadline", "poll"]);
  expect(scheduler.timers.size).toBe(1);
  stop();
  scheduler.advance(20);
  expect(scheduler.timers.size).toBe(0);
  expect(calls.length).toBe(4);
});

test("live lookup excludes removed ids and finds ids assigned after insertion", () => {
  const { document } = createAppFixture();
  const notice = document.createElement("p");
  document.attach(document.body, notice);
  notice.id = "control-notice";
  expect(document.node("control-notice")).toBe(notice);
  expect(
    document
      .querySelectorAll(document.node("filters"), "[data-filter]")
      .map((node) => node.dataset.filter),
  ).toEqual(["all", "working", "blocked"]);
  notice.remove();
  expect(document.getElementById("control-notice")).toBeNull();
  expect(document.contains(document.body, {})).toBeFalsy();
});

test("storage denial and removed media callbacks remain observable without live dispatch", () => {
  const window = new AppFixtureWindow();
  window.storage.setItem("observer.host", "remote");
  expect(window.localStorage.getItem("observer.host")).toBe("remote");
  window.storage.throwing = true;
  expect(() => window.localStorage.getItem("observer.host")).toThrow("denied");
  window.throwingStorage = true;
  expect(() => window.localStorage).toThrow("SecurityError");
  const media = window.matchMedia("(max-width: 760px)");
  let changes = 0;
  const listener = () => {
    changes++;
  };
  media.addEventListener("change", listener);
  const narrow = true;
  media.setMatches(narrow);
  expect(changes).toBe(1);
  media.removeEventListener("change", listener);
  const wide = false;
  media.setMatches(wide);
  expect(changes).toBe(1);
  expect(media.count("change")).toBe(0);
  const retained = media.added[0];
  expect(retained?.listener).toBe(listener);
  listener();
  expect(changes).toBe(2);
});

test("canvas teardown matches callback and capture while retaining removed callbacks", () => {
  const document = new AppFixtureDocument();
  const canvas = document.canvas;
  let events = 0;
  const listener = () => {
    events++;
  };
  const capture = { capture: true };
  canvas.addEventListener("wheel", listener, capture);
  canvas.addEventListener("wheel", listener, capture);
  canvas.removeEventListener("wheel", listener);
  expect(canvas.listeners.length).toBe(1);
  canvas.removeEventListener("wheel", listener, capture);
  expect(canvas.listeners).toEqual([]);
  expect(canvas.removed.length).toBe(1);
  const retained = canvas.added[0];
  retained?.listener({});
  expect(events).toBe(1);
});

test("actual arrange requires explicit focus restoration and unchanged order retains focus", () => {
  const document = new AppFixtureDocument();
  const ui = createUi(document);
  const list = document.register("list");
  const first = document.createElement("button");
  const second = document.createElement("button");
  document.attach(list, first, second);
  first.focus();
  const focused = document.activeElement;
  expect(ui.arrange(list, [second, first])).toBeTruthy();
  // Omitting the consumer restoration leaves focus on the body, making that regression observable.
  expect(document.activeElement).toBe(document.body);
  if (focused && document.activeElement !== focused && document.contains(list, focused))
    focused.focus({ preventScroll: true });
  expect(document.activeElement).toBe(first);
  expect(first.focusCalls).toEqual([undefined, { preventScroll: true }]);
  expect(ui.arrange(list, [second, first])).toBeFalsy();
  expect(document.activeElement).toBe(first);
  expect(first.focusCalls.length).toBe(2);
});

test("actual text replacement drops child elements and their focus without rebuilding unchanged text", () => {
  const document = new AppFixtureDocument();
  const label = document.register("label");
  const child = document.createElement("button");
  document.attach(label, child);
  child.focus();
  setText(label, "updated");
  expect(label.textContent).toBe("updated");
  expect(label.children).toEqual([]);
  expect(child.parent).toBeNull();
  expect(child.isConnected).toBeFalsy();
  expect(document.activeElement).toBe(document.body);
  const retained = document.createElement("button");
  document.attach(label, retained);
  retained.focus();
  setText(label, "updated");
  expect(label.children).toEqual([retained]);
  expect(document.activeElement).toBe(retained);
  setText(label, "");
  expect(label.textContent).toBe("");
  expect(label.children).toEqual([]);
  expect(document.activeElement).toBe(document.body);
});
