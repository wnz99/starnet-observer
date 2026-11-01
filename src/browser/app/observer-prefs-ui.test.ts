import type { Deliver } from "./ui-test.fixture.js";
import { child } from "./ui-test.fixture.js";
import { present } from "../view/drawing.fixture.js";
import { test } from "bun:test";
import assert from "node:assert/strict";
import { uiFixture, querySpy, viewSpy } from "./ui-test.fixture.js";
import type { Scene } from "../scene/types.js";
test("observer-prefs-ui regression contracts", async () => {
  function boot({
    theme = {},
    saved = {},
    broken = false,
  }: {
    theme?: {
      fx?: boolean;
      arrange?: boolean;
    };
    saved?: Record<string, string>;
    broken?: boolean;
  } = {}) {
    const page = uiFixture({ __OBSERVER_THEME__: theme });
    const storage = page.window.storage;
    for (const [key, value] of Object.entries(saved)) storage.values.set(key, value);
    page.window.storage.throwing = broken;
    const updates: Scene[] = [],
      fx: boolean[] = [],
      startup: boolean[] = [];
    let fxOn = false;
    let listener: Deliver = () => {
      throw new Error("Inventory not subscribed");
    };
    const mounted = page.mount({
      createView: () =>
        viewSpy({
          setStartupAnimation(on) {
            startup.push(on);
          },
          setFx(on) {
            fxOn = on;
            fx.push(on);
          },
          fx() {
            return fxOn;
          },
          update(scene) {
            updates.push(scene);
          },
          focus() {},
          overview() {},
          zoomBy() {},
          start() {},
          stop() {},
          invalidate() {},
        }),
      query: {
        ...querySpy({
          define() {},
          invalidate: () => {
            listener({});
            return Promise.resolve();
          },
          subscribe(key, fn) {
            if (key === "observer.sessions") listener = fn;
            return () => {};
          },
        }),
        dispose() {},
      },
    });
    return {
      get: page.get,
      document: page.document,
      dispose: () => {
        mounted.dispose();
      },
      updates,
      stored: page.window.storage.writes,
      fx,
      startup,
      poll: (data: unknown) => {
        listener({ data });
      },
    };
  }
  const pressed = (page: ReturnType<typeof boot>) =>
    page
      .get("filters")
      .children.filter((button) => button.attributes.get("aria-pressed") === "true")
      .map((button) => button.dataset.filter);
  const row = (index: number) => ({
    id: "obs_" + String(index).padStart(24, "0"),
    paneId: "w1:p" + String(index),
    provider: "claude",
    source: "herdr",
    sessionId: "session-" + String(index),
    status: "idle",
    title: "t",
    tool: { available: false },
    projectId: "prj_" + String(index),
    project: "p" + String(index),
    projectKind: "group",
    repoId: "repo_" + String(index),
    repo: "r" + String(index),
    folder: "",
    observedAt: Date.now(),
    inventoryHealth: "available",
  });
  // Nine rooms: more than one deck (eight rooms per deck), so the saved page is observable.
  const data = () => ({
    health: "available",
    observedAt: Date.now(),
    sessions: Array.from({ length: 9 }, (_, index) => row(index + 1)),
  });
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  const names = (page: ReturnType<typeof boot>) =>
    present(page.updates.at(-1))
      .platforms.map((platform) => platform.name)
      .sort()
      .join(",");
  await (async () => {
    const fresh = boot();
    await settle();
    fresh.poll(data());
    assert.deepEqual(fresh.fx, [false], "built-in default: FX off");
    assert.deepEqual(fresh.startup, [true], "startup animation defaults on");
    fresh.get("startup-animation-toggle").emit("click");
    assert.deepEqual(fresh.startup, [true, false]);
    assert.equal(fresh.get("startup-animation-toggle").attributes.get("aria-checked"), "false");
    assert.deepEqual(fresh.fx, [false], "startup and FX are independent");
    assert.deepEqual(pressed(fresh), ["all"], "built-in default: all sessions");
    const firstDeck = names(fresh);
    fresh.get("fx-toggle").emit("click");
    child(fresh.get("filters"), 1).emit("click");
    fresh.get("next-page").emit("click");
    assert.deepEqual(
      fresh.stored.map(([key]) => key),
      ["observer.startupAnimation", "observer.fx", "observer.filter", "observer.page"],
      "each change is remembered under observer.*",
    );
    assert(
      fresh.stored.every(([, value]) => /^(0|1|all|working|blocked|\d+)$/.test(value)),
      "only toggles and positions are stored, never session data",
    );
    const restored = boot({
      saved: {
        "observer.fx": "1",
        "observer.startupAnimation": "0",
        "observer.filter": "working",
        "observer.page": "1",
      },
    });
    await settle();
    restored.poll(data());
    assert.deepEqual(restored.fx, [true], "saved FX comes back");
    assert.deepEqual(restored.startup, [false], "saved startup off comes back");
    assert.deepEqual(pressed(restored), ["working"], "saved filter comes back");
    assert.notEqual(names(restored), firstDeck, "saved deck page comes back");
    const precedence = boot({ theme: { fx: true, arrange: true }, saved: { "observer.fx": "0" } });
    await settle();
    precedence.poll(data());
    assert.deepEqual(precedence.fx, [false], "a saved choice beats the theme default");
    assert.equal(
      precedence.get("arrange-toggle").attributes.get("aria-pressed"),
      "true",
      "theme default applies when nothing is saved",
    );
    const invalid = boot({
      saved: {
        "observer.filter": "everything",
        "observer.page": "-3",
        "observer.fx": "yes",
        "observer.startupAnimation": "yes",
      },
    });
    await settle();
    invalid.poll(data());
    assert.deepEqual(pressed(invalid), ["all"]);
    assert.deepEqual(invalid.fx, [false]);
    assert.deepEqual(invalid.startup, [true]);
    assert.equal(names(invalid), firstDeck, "invalid saved values fall back");
    const broken = boot({ theme: { fx: true }, broken: true });
    await settle();
    broken.poll(data());
    assert.deepEqual(broken.fx, [true], "unreadable storage falls back to the theme default");
    broken.get("fx-toggle").emit("click");
    broken.get("startup-animation-toggle").emit("click");
    assert.deepEqual(broken.startup, [true, false], "startup works with broken storage");
    child(broken.get("filters"), 2).emit("click");
    assert.deepEqual(broken.fx, [true, false], "controls still work when storage throws");
    assert.deepEqual(pressed(broken), ["blocked"]);
    const settings = broken.get("visual-settings"),
      popover = broken.get("visual-settings-popover"),
      help = broken.get("controls-help"),
      helpPopover = broken.get("controls-help-popover");
    helpPopover.hidden = true;
    settings.emit("click");
    assert.equal(popover.hidden, false);
    assert.equal(broken.document.activeElement, broken.get("startup-animation-toggle"));
    broken.document.emit("keydown", { key: "Escape", preventDefault() {} });
    assert.equal(popover.hidden, true);
    assert.equal(broken.document.activeElement, settings);
    help.emit("click");
    settings.emit("click");
    assert.equal(helpPopover.hidden, true, "settings closes help");
    help.emit("click");
    assert.equal(popover.hidden, true, "help closes settings");
    settings.emit("click");
    broken.document.emit("pointerdown", { target: broken.get("fx-toggle"), preventDefault() {} });
    assert.equal(popover.hidden, false, "inside press retains settings");
    broken.get("search").focus();
    broken.document.emit("focusin", { target: broken.get("search"), preventDefault() {} });
    assert.equal(popover.hidden, true, "focus leaving dismisses settings");
    assert.equal(broken.document.activeElement, broken.get("search"));
    settings.emit("click");
    broken.document.emit("pointerdown", { target: broken.get("world"), preventDefault() {} });
    assert.equal(popover.hidden, true, "outside press dismisses settings");
    broken.dispose();
    settings.emit("click");
    broken.get("startup-animation-toggle").emit("click");
    assert.equal(popover.hidden, true, "disposed trigger stays inactive");
    assert.deepEqual(broken.startup, [true, false], "disposed switch stays inactive");
    console.log(
      "observer view settings: restore on load, observer.* keys, saved over theme over built-in, invalid values and throwing storage OK",
    );
  })();
}, 30000);
