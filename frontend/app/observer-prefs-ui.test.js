"use strict";
const { test } = require("bun:test");

test("observer-prefs-ui regression contracts", async () => {
  const assert = require("node:assert/strict");
  const fs = require("node:fs");
  const vm = require("node:vm");
  const ObserverModel = require("./observer-model.js");
  const ObserverMail = require("./observer-mail.js");
  const ObserverInspector = require("./observer-inspector.js");
  const ObserverMailInspector = require("./observer-mail-inspector.js");
  const ObserverScene = require("./observer-scene.js");
  const ThemePack = require("./theme-pack.js");
  let document;
  // DOM double with real move semantics: inserting an attached node detaches it first, as the browser does.
  let created = 0,
    listenersAdded = 0;
  function element() {
    created++;
    return {
      textContent: "",
      children: [],
      hidden: false,
      dataset: {},
      value: "",
      scrollTop: 0,
      handlers: {},
      attributes: {},
      style: { setProperty() {} },
      parent: null,
      classList: { toggle() {} },
      append(...nodes) {
        for (const node of nodes) {
          if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1);
          node.parent = this;
          this.children.push(node);
        }
      },
      replaceChildren(...nodes) {
        for (const child of this.children) child.parent = null;
        this.children = [];
        this.append(...nodes);
      },
      setAttribute(key, value) {
        this.attributes[key] = value;
      },
      removeAttribute(key) {
        delete this.attributes[key];
      },
      addEventListener(name, fn) {
        listenersAdded++;
        this.handlers[name] = fn;
      },
      focus() {
        document.activeElement = this;
      },
      scrollIntoView() {},
      querySelectorAll() {
        return this.children;
      },
      insertBefore(node, before) {
        if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1);
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
      open: false,
      show() {
        this.open = true;
        this.mode = "show";
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

  /* Persisted view settings: FX, ARRANGE, the session filter and the deck page come back after a reload. A saved value
   beats the theme default; missing, invalid or throwing storage falls back silently and the page still works. */
  function boot({ theme = {}, saved = {}, broken = false } = {}) {
    const elements = new Map(),
      stored = [],
      fx = [];
    const get = (id) => {
      if (!elements.has(id)) elements.set(id, element());
      return elements.get(id);
    };
    const filters = get("filters");
    filters.children = ["all", "working", "blocked"].map((value) => {
      const button = element();
      button.dataset.filter = value;
      return button;
    });
    const updates = [];
    let listener,
      fxOn = false;
    document = {
      documentElement: element(),
      body: element(),
      activeElement: null,
      hidden: false,
      getElementById: get,
      createElement: element,
      addEventListener() {},
      querySelector: () => null,
    };
    const ObserverView = {
      create() {
        return {
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
        };
      },
    };
    const localStorage = broken
      ? {
          getItem() {
            throw new Error("denied");
          },
          setItem() {
            throw new Error("denied");
          },
        }
      : {
          getItem: (key) => (Object.hasOwn(saved, key) ? saved[key] : null),
          setItem: (key, value) => {
            stored.push([key, value]);
            saved[key] = value;
          },
        };
    const context = {
      console,
      Date,
      Set,
      Map,
      Number,
      document,
      setTimeout: () => 0,
      clearTimeout() {},
      ObserverModel,
      ObserverMail,
      ObserverInspector,
      ObserverMailInspector,
      ObserverScene,
      ObserverView,
      ThemePack,
      encodeURIComponent,
      window: { __OBSERVER_THEME__: theme, localStorage, addEventListener() {} },
      SPRITES: { init: async () => {} },
      Harness: { api: { get: () => new Promise(() => {}) } },
      QuerySpine: {
        define() {},
        invalidate: () => {
          listener({});
          return Promise.resolve();
        },
        subscribe(key, fn) {
          if (key === "observer.sessions") listener = fn;
          return () => {};
        },
      },
    };
    vm.runInNewContext(fs.readFileSync(require.resolve("./observer.js"), "utf8"), context);
    return { get, updates, stored, fx, poll: (data) => listener({ data }) };
  }
  const pressed = (page) =>
    page
      .get("filters")
      .children.filter((button) => button.attributes["aria-pressed"] === "true")
      .map((button) => button.dataset.filter);
  const row = (index) => ({
    id: "obs_" + String(index).padStart(24, "0"),
    paneId: "w1:p" + index,
    provider: "claude",
    source: "herdr",
    sessionId: "session-" + index,
    status: "idle",
    title: "t",
    tool: { available: false },
    projectId: "prj_" + index,
    project: "p" + index,
    projectKind: "group",
    repoId: "repo_" + index,
    repo: "r" + index,
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
  const names = (page) =>
    page.updates
      .at(-1)
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
    fresh.get("fx-toggle").handlers.click();
    fresh.get("filters").children[1].handlers.click();
    fresh.get("next-page").handlers.click();
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
      precedence.get("arrange-toggle").attributes["aria-pressed"],
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
    broken.get("fx-toggle").handlers.click();
    broken.get("filters").children[2].handlers.click();
    assert.deepEqual(broken.fx, [true, false], "controls still work when storage throws");
    assert.deepEqual(pressed(broken), ["blocked"]);
    console.log(
      "observer view settings: restore on load, observer.* keys, saved over theme over built-in, invalid values and throwing storage OK",
    );
  })();
}, 30000);
