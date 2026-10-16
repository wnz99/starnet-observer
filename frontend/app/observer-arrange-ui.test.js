"use strict";
const { test } = require("bun:test");

test("observer-arrange-ui regression contracts", async () => {
  const assert = require("node:assert/strict");
  const fs = require("node:fs");
  const vm = require("node:vm");
  const migrated = require("../../src/browser/legacy-modules.fixture.ts").legacyModules();
  const ObserverModel = migrated.Model;
  const ObserverMail = migrated.Mail;
  const ObserverInspector = migrated.Inspector;
  const ObserverMailInspector = migrated.MailInspector;
  const ObserverScene = require("./observer-scene.js");
  const ThemePack = migrated.ThemePack;
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
      appendChild(node) {
        this.append(node);
        return node;
      },
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

  /* ARRANGE toggle: default off draws the folder grouping exactly as before; on draws the sidecar's arrangement,
   persists the choice per viewer, rebuilds once and then holds desks between polls; theme.arrange sets the default. */
  function boot({ theme = {}, saved = null } = {}) {
    const elements = new Map(),
      stored = [];
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
    const updates = [],
      couriers = [];
    let listener;
    const mail = {
      ...ObserverMail,
      createCourier(options) {
        const courier = ObserverMail.createCourier(options);
        couriers.push(courier);
        return courier;
      },
    };
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
          setFx() {},
          fx() {
            return false;
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
    const context = {
      console,
      Date,
      Set,
      Map,
      document,
      setTimeout: () => 0,
      clearTimeout() {},
      ObserverModel,
      ObserverMail: mail,
      ObserverInspector,
      ObserverMailInspector,
      ObserverScene,
      ObserverView,
      ThemePack,
      encodeURIComponent,
      window: {
        __OBSERVER_THEME__: theme,
        localStorage: {
          getItem: (key) => (key === "observer.arrange" ? saved : null),
          setItem: (key, value) => stored.push([key, value]),
        },
        addEventListener() {},
      },
      SPRITES: { init: async () => {} },
      Harness: { api: { get: () => new Promise(() => {}) } },
      QuerySpine: {
        define() {},
        invalidate: () => Promise.resolve(),
        subscribe(key, fn) {
          if (key === "observer.sessions") listener = fn;
          return () => {};
        },
      },
    };
    vm.runInNewContext(fs.readFileSync(require.resolve("./observer.js"), "utf8"), context);
    return { get, updates, stored, courier: () => couriers[0], poll: (data) => listener({ data }) };
  }
  const row = (id, projectId, repoId, room, section) => ({
    id,
    paneId: "w1:" + id.slice(-2),
    provider: "claude",
    source: "herdr",
    sessionId: "session-" + id,
    status: "idle",
    title: "t",
    tool: { available: false },
    projectId,
    project: projectId,
    projectKind: "group",
    repoId,
    repo: repoId,
    folder: "",
    observedAt: Date.now(),
    inventoryHealth: "available",
    arrangement: {
      roomId: room,
      room: room.replace("room_", ""),
      sectionId: section,
      section: section.replace("sec_", ""),
    },
  });
  const data = () => ({
    health: "available",
    observedAt: Date.now(),
    sessions: [
      row("obs_" + "a".repeat(22) + "01", "prj_parent", "repo_web", "room_banqora", "sec_web"),
      row("obs_" + "a".repeat(22) + "02", "prj_other", "repo_infra", "room_banqora", "sec_infra"),
    ],
  });
  await (async () => {
    const page = boot();
    await new Promise((resolve) => setImmediate(resolve));
    page.poll(data());
    assert.equal(page.get("arrange-toggle").attributes["aria-pressed"], "false", "off by default");
    assert.equal(page.updates.at(-1).platforms.length, 2, "off: folder grouping, two rooms");
    page.get("arrange-toggle").handlers.click();
    assert.equal(page.get("arrange-toggle").attributes["aria-pressed"], "true");
    assert.deepEqual(
      page.stored,
      [["observer.arrange", "1"]],
      "the choice is remembered per viewer",
    );
    const arranged = page.updates.at(-1);
    assert.equal(arranged.platforms.length, 1, "on: one arranged room");
    assert.equal(arranged.platforms[0].name, "banqora");
    const chairs = arranged.workers.map((worker) => worker.chair.x + "," + worker.chair.y);
    page.poll(data());
    assert.deepEqual(
      page.updates.at(-1).workers.map((worker) => worker.chair.x + "," + worker.chair.y),
      chairs,
      "desks hold between polls while arranged",
    );
    page.get("arrange-toggle").handlers.click();
    assert.equal(page.updates.at(-1).platforms.length, 2, "off again: folder grouping is back");
    assert.deepEqual(page.stored.at(-1), ["observer.arrange", "0"]);
    const flying = boot();
    await new Promise((resolve) => setImmediate(resolve));
    const beforeMail = data(),
      sender = beforeMail.sessions[0].id,
      recipient = beforeMail.sessions[1].id;
    flying.poll({ ...beforeMail, bus: { health: "available", messages: [] } });
    flying.poll({
      ...data(),
      bus: {
        health: "available",
        messages: [
          { id: 1, from: sender, to: recipient, sentAt: Date.now(), acknowledgedAt: null },
        ],
      },
    });
    assert(
      flying.courier().frame(Date.now()).drones.length > 0,
      "a newly observed message starts a flight",
    );
    flying.get("arrange-toggle").handlers.click();
    assert.equal(
      flying.courier().frame(Date.now()).drones.length,
      0,
      "changing the floor layout discards old flight coordinates without replaying mail",
    );
    const themed = boot({ theme: { arrange: true } });
    await new Promise((resolve) => setImmediate(resolve));
    themed.poll(data());
    assert.equal(
      themed.get("arrange-toggle").attributes["aria-pressed"],
      "true",
      "theme.arrange sets the default",
    );
    assert.equal(themed.updates.at(-1).platforms.length, 1);
    const overridden = boot({ theme: { arrange: true }, saved: "0" });
    await new Promise((resolve) => setImmediate(resolve));
    overridden.poll(data());
    assert.equal(
      overridden.updates.at(-1).platforms.length,
      2,
      "a saved viewer choice wins over the theme default",
    );
    console.log(
      "observer arrange UI: default off, toggle on/off, remembered choice, stable desks while arranged, theme default and viewer override OK",
    );
  })();
}, 30000);
