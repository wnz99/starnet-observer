"use strict";
const { test } = require("bun:test");

test("control-ui regression contracts", async () => {
  const sessionItems = (node) =>
    node.className?.split(" ").includes("session-item")
      ? [node]
      : (node.children || []).flatMap(sessionItems);
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
  function element() {
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
      disabled: false,
      classList: { toggle() {}, add() {} },
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
      },
      showModal() {
        this.open = true;
      },
      close() {
        this.open = false;
      },
    };
  }
  await (async () => {
    for (const enabled of [false, true])
      for (const presentation of [false, true]) await controls(enabled, presentation);
    console.log(
      "control UI: four-action mode/result matrix, real pane targets, stale rejection, focus, provider truth and overseer deck retention OK",
    );
  })();

  async function controls(enabled, presentation) {
    const elements = {},
      badge = element();
    const filters = ["all", "working", "blocked"].map((value) => {
      const button = element();
      button.dataset.filter = value;
      return button;
    });
    document = {
      documentElement: element(),
      body: element(),
      activeElement: null,
      hidden: false,
      getElementById: (id) => elements[id] || (elements[id] = element()),
      querySelector: (selector) => (selector === ".read-only" ? badge : null),
      createElement: (tag) => Object.assign(element(), { tagName: tag.toUpperCase() }),
      addEventListener() {},
    };
    elements.filters = element();
    elements.filters.children = filters;
    const find = (id) => {
      const walk = (node) => (node.id === id ? node : node.children.map(walk).find(Boolean));
      return walk(document.body);
    };
    const posts = [],
      confirms = [];
    const lastPost = () => JSON.stringify(posts.at(-1));
    let confirmAnswer = false,
      listener,
      viewOptions,
      failing = false;
    const context = {
      console,
      Date,
      Set,
      Map,
      document,
      setTimeout: () => 1,
      clearTimeout() {},
      ObserverModel,
      ObserverMail,
      ObserverInspector,
      ObserverMailInspector,
      ObserverScene,
      ThemePack,
      encodeURIComponent,
      ObserverView: {
        create: (options) => {
          viewOptions = options;
          return {
            setFx() {},
            fx() {
              return true;
            },
            update() {},
            focus() {},
            overview() {},
            zoomBy() {},
            start() {},
            stop() {},
            invalidate() {},
          };
        },
      },
      window: {
        __OBSERVER_CONTROL__: enabled,
        __OBSERVER_THEME__: {},
        localStorage: {
          getItem() {
            return "on";
          },
          setItem() {},
        },
        addEventListener() {},
        confirm: (message) => {
          confirms.push(message);
          return confirmAnswer;
        },
      },
      SPRITES: { init: async () => ({}) },
      Harness: {
        api: {
          get: () => new Promise(() => {}),
          post: async (path, body) => {
            posts.push([path, body]);
            if (failing) throw new Error("control-unavailable");
            return { ok: true, paneId: "w1:pX" };
          },
        },
      },
      QuerySpine: {
        define() {},
        invalidate() {
          return Promise.resolve();
        },
        subscribe(key, fn) {
          if (key === "observer.sessions") listener = fn;
          return () => {};
        },
      },
    };
    vm.runInNewContext(fs.readFileSync(require.resolve("./observer.js"), "utf8"), context);
    await new Promise((resolve) => setImmediate(resolve));
    const sessions = [
      {
        id: "obs_" + "a".repeat(24),
        paneId: "w1:p1",
        source: "herdr",
        project: "Fictional",
        projectId: "repo1",
        projectKind: "repository",
        provider: "codex",
        sessionId: "s1",
        status: "working",
        title: "Live Codex session",
        tool: { available: false },
      },
      {
        id: "obs_" + "b".repeat(24),
        paneId: null,
        source: "desktop",
        project: "Fictional",
        projectId: "repo1",
        projectKind: "repository",
        provider: "codex",
        sessionId: "s2",
        status: "idle",
        title: "Window",
        tool: { available: false },
      },
    ];
    const publish = (rows) =>
      listener({
        data: {
          sessions: rows,
          health: "available",
          observedAt: Date.now(),
          ...(presentation ? { presentation: { company: "Fictional" } } : {}),
        },
      });
    const tick = () => new Promise((resolve) => setImmediate(resolve));
    publish(sessions);
    assert.equal(
      badge.textContent,
      presentation
        ? "LIVE · FICTIONAL LABELS" + (enabled ? " · CONTROLS ON" : "")
        : enabled
          ? "CONTROLS ON"
          : "READ ONLY",
    );
    const group = elements.sessions.children[0],
      heading = group.children[0],
      rows = sessionItems(group);
    assert.equal(rows.length, 2);
    const [herdrRow, desktopRow] = rows.map((item) => ({
      item,
      button: item.children[0],
      inspect: item.children[2],
      attach: item.children[3],
      close: item.children[4],
    }));
    if (!enabled) {
      assert.equal(herdrRow.attach, undefined);
      assert.equal(herdrRow.close, undefined);
      assert.equal(
        heading.children.some((node) => node.textContent === "+"),
        false,
      );
      viewOptions.onObservatory();
      await tick();
      assert.equal(posts.length, 0);
      return;
    }
    assert.equal(herdrRow.attach.hidden, false);
    assert.equal(herdrRow.close.hidden, false);
    assert.equal(desktopRow.attach.hidden, true);
    assert.equal(desktopRow.close.hidden, true);
    herdrRow.button.focus();
    herdrRow.close.handlers.click();
    await tick();
    assert.equal(confirms.length, 1);
    assert.match(confirms[0], /ends the Codex session/);
    assert.doesNotMatch(confirms[0], /claude --resume/);
    assert.deepEqual(posts, []);
    confirmAnswer = true;
    const spawn = heading.children.at(-1);
    assert.equal(spawn.textContent, "+");
    for (failing of [false, true]) {
      for (const [action, button] of [
        ["close", herdrRow.close],
        ["attach", herdrRow.attach],
        ["spawn", spawn],
      ]) {
        button.handlers.click();
        await tick();
        assert.equal(lastPost(), JSON.stringify(["/api/control/" + action, { paneId: "w1:p1" }]));
        assert.equal(
          button.disabled,
          false,
          "action clears pending state after success and failure",
        );
        assert.equal(elements["control-notice"].textContent.includes("Could not"), failing);
      }
      const beforeChooser = posts.length;
      viewOptions.onObservatory();
      await tick();
      const dialog = find("overseer-chooser"),
        provider = find("overseer-provider");
      assert.equal(dialog.open, true);
      assert.equal(provider.value, "claude");
      assert.equal(document.activeElement, provider);
      assert.equal(provider.attributes["aria-label"], "Overseer provider");
      provider.value = "codex";
      provider.handlers.change();
      assert.match(find("overseer-confirmation").textContent, /Codex/);
      assert.equal(
        posts.length,
        beforeChooser,
        "changing provider never launches or closes a pane",
      );
      find("overseer-cancel").handlers.click();
      assert.equal(posts.length, beforeChooser);
      assert.equal(document.activeElement, elements.world);
      viewOptions.onObservatory();
      find("overseer-chooser").handlers.cancel({ preventDefault() {} });
      assert.equal(posts.length, beforeChooser, "Escape cancels without mutations");
      assert.equal(document.activeElement, elements.world);
      viewOptions.onObservatory();
      const chosen = failing ? "codex" : "claude";
      find("overseer-provider").value = chosen;
      find("overseer-start").handlers.click();
      await tick();
      assert.equal(lastPost(), JSON.stringify(["/api/control/overseer", { provider: chosen }]));
      assert.equal(document.activeElement, elements.world);
      assert.equal(elements["control-notice"].textContent.includes("Could not"), failing);
    }
    herdrRow.button.focus();
    publish(sessions.map((row) => ({ ...row })));
    assert.equal(sessionItems(elements.sessions.children[0])[0], herdrRow.item);
    assert.equal(document.activeElement, herdrRow.button, "polls and controls preserve row focus");
    publish([{ ...sessions[0], observedAt: Date.now() - 6001 }]);
    assert.equal(herdrRow.attach.hidden, true);
    assert.equal(herdrRow.close.hidden, true);
    const before = posts.length;
    for (const button of [spawn, herdrRow.attach, herdrRow.close]) {
      button.handlers.click();
      await tick();
    }
    assert.equal(posts.length, before, "stale rows cannot seed or invoke controls");
    publish([
      { ...sessions[0], observedAt: Date.now() - 6001 },
      { ...sessions[0], id: "fresh", paneId: "w2:p2" },
    ]);
    spawn.handlers.click();
    await tick();
    assert.equal(
      lastPost(),
      JSON.stringify(["/api/control/spawn", { paneId: "w2:p2" }]),
      "spawn skips a stale project seed",
    );
    // Overseer has no layout slot: selecting it must keep the current deck.
    const overseer = { ...sessions[0], id: "boss", paneId: "w9:p1", role: "overseer" };
    const crew = Array.from({ length: 10 }, (_, i) => ({
      ...sessions[0],
      id: "crew" + i,
      projectId: "project" + i,
      repoId: "repo" + i,
    }));
    publish([overseer, ...crew]);
    elements["next-page"].handlers.click();
    const deck = elements["page-label"].textContent;
    assert.match(deck, /Deck 2/);
    const count = posts.length;
    viewOptions.onObservatory();
    await tick();
    assert.equal(
      elements["page-label"].textContent,
      deck,
      "selecting the observatory keeps the deck",
    );
    assert.equal(posts.length, count, "verified overseer selects without launching");
  }
}, 30000);
