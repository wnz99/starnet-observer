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
      fx: boolean[] = [];
    let fxOn = false;
    let listener: Deliver = () => {
      throw new Error("Inventory not subscribed");
    };
    page.mount({
      createView: () =>
        viewSpy({
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
      query: querySpy({
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
    });
    return {
      get: page.get,
      updates,
      stored: page.window.storage.writes,
      fx,
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
    assert.deepEqual(pressed(fresh), ["all"], "built-in default: all sessions");
    const firstDeck = names(fresh);
    fresh.get("fx-toggle").emit("click");
    child(fresh.get("filters"), 1).emit("click");
    fresh.get("next-page").emit("click");
    assert.deepEqual(
      fresh.stored.map(([key]) => key),
      ["observer.fx", "observer.filter", "observer.page"],
      "each change is remembered under observer.*",
    );
    assert(
      fresh.stored.every(([, value]) => /^(0|1|all|working|blocked|\d+)$/.test(value)),
      "only toggles and positions are stored, never session data",
    );
    const restored = boot({
      saved: { "observer.fx": "1", "observer.filter": "working", "observer.page": "1" },
    });
    await settle();
    restored.poll(data());
    assert.deepEqual(restored.fx, [true], "saved FX comes back");
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
      saved: { "observer.filter": "everything", "observer.page": "-3", "observer.fx": "yes" },
    });
    await settle();
    invalid.poll(data());
    assert.deepEqual(pressed(invalid), ["all"]);
    assert.deepEqual(invalid.fx, [false]);
    assert.equal(names(invalid), firstDeck, "invalid saved values fall back");
    const broken = boot({ theme: { fx: true }, broken: true });
    await settle();
    broken.poll(data());
    assert.deepEqual(broken.fx, [true], "unreadable storage falls back to the theme default");
    broken.get("fx-toggle").emit("click");
    child(broken.get("filters"), 2).emit("click");
    assert.deepEqual(broken.fx, [true, false], "controls still work when storage throws");
    assert.deepEqual(pressed(broken), ["blocked"]);
    console.log(
      "observer view settings: restore on load, observer.* keys, saved over theme over built-in, invalid values and throwing storage OK",
    );
  })();
}, 30000);
