import { runScenarios } from "./ui-test.fixture.js";
import type { QuerySpec } from "../queryspine/types.js";
import type { SpriteInit } from "../sprites/types.js";
import type { RuntimeThemeWarning } from "../theme/dom.js";
import type { AppBus } from "./data.js";
import type { Delivery } from "./ui-test.fixture.js";
import { child } from "./ui-test.fixture.js";
import { present } from "../view/drawing.fixture.js";
import { spyOn, test } from "bun:test";
import { Floor } from "./floor.js";
import { Couriers } from "./couriers.js";
import { uiFixture, querySpy, viewSpy } from "./ui-test.fixture.js";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { createModel } from "../model.js";
import * as ObserverInspector from "../inspector.js";
import * as ObserverScene from "../scene/index.js";
import { createThemePack } from "../theme.js";
import { canonicalTheme } from "../theme.fixture.js";
import { createQuerySpine } from "../queryspine.js";
import { makePresentationObserver } from "../../sidecar/presentation/index.js";
import { createViewFactory } from "../view/index.js";
import { AppFixtureCanvas, AppFixtureMedia } from "./dom.fixture.js";
import { countedDocument, bindDocument, mountScenario, notify } from "./ui-test.fixture.js";
import type { UiScenario, UiEvents, Deliver } from "./ui-test.fixture.js";
import type { AppFixtureNode } from "./dom.fixture.js";
import type { AppRow, AppSnapshot } from "./data.js";
import type { PresentationInput } from "../../sidecar/presentation/types.js";
import type { SpriteBody } from "../sprites/types.js";
import type { Resource } from "../view/drawing.fixture.js";
import type { Scene } from "../scene/types.js";
import type { UiViewOptions, UiFrame } from "./ui-test.fixture.js";
import type { UpdateOptions } from "../view/types.js";
import { AppState, FRESH_MS } from "./state.js";
import type { AppQuerySnapshot } from "./data.js";
const sessionItems = (node: AppFixtureNode): AppFixtureNode[] =>
  node.className.split(" ").includes("session-item") ? [node] : node.children.flatMap(sessionItems);
test("floor keeps validated returns fresh by source and rejects old page, parent and disposal settlements", () => {
  let now = 10000,
    refreshes = 0;
  const state = new AppState(canonicalTheme(), { now: () => now, frame: () => now });
  state.active = true;
  let options: UpdateOptions = {},
    scene!: Scene;
  const floor = new Floor({
    state,
    now: () => now,
    frame: () => now,
    view: viewSpy({
      update(next, value) {
        scene = next;
        options = value;
      },
      invalidate() {},
    }),
    refresh: () => {
      refreshes++;
    },
    mailFrame: () => ({ drones: [], envelopes: [] }),
    inspected: () => null,
    repositoryToggle() {},
    showZoom() {},
    overview: () => {
      state.selected = null;
    },
    setPage: (page) => {
      state.page = page;
    },
  });
  const root: AppRow = { id: "retained-root", source: "herdr", projectId: "a" },
    child: AppRow = {
      id: "retained-child",
      source: "helper",
      parentId: root.id,
      projectId: "a",
      lineageState: "verified",
      status: "idle",
    };
  const render = (rows: AppRow[], herdrAt = now) => {
    const snapshot: AppQuerySnapshot = {
      key: "observer.sessions",
      path: "",
      hasData: true,
      pending: false,
      stale: false,
      ageMs: 0,
      errorAt: 0,
      error: null,
      updatedAt: now,
      data: {
        sessions: rows,
        health: "available",
        observedAt: now,
        sources: {
          herdr: { health: "available", observedAt: herdrAt },
          hosts: { remote: { health: "available", observedAt: now } },
        },
      },
    };
    state.latest = snapshot;
    state.byId = new Map(rows.map((row) => [row.id, row]));
    floor.observe(snapshot);
    const refresh = false;
    return floor.render(snapshot, [], refresh);
  };
  render([root, child]);
  now++;
  render([root, { ...child, lifecycleEvidence: { state: "closed" } }]);
  state.selected = child.id;
  const returning = present(scene.workers.find((worker) => worker.id === child.id));
  assert.equal(returning.helperPhase, "returning");
  const sourceAt = now;
  now++;
  assert.equal(render([root]).displayedRows.length, 2);
  assert.equal(state.selected, child.id, "retained avatar stays selected until it settles");
  assert.equal(
    present(options.rowStale)(returning),
    false,
    "missing raw row uses its current source proof",
  );
  now += FRESH_MS + 1;
  render([root], sourceAt);
  assert.equal(
    present(options.rowStale)(returning),
    true,
    "another fresh host cannot renew a retained return",
  );
  const expiredCallback = present(options.onHelperSettled);
  expiredCallback(child.id, "returning");
  assert.equal(refreshes, 0);
  now++;
  assert.equal(render([root]).displayedRows.length, 1);
  assert.equal(state.selected, null);
  expiredCallback(child.id, "returning");
  assert.equal(refreshes, 0);
  now++;
  const born: AppRow = {
    ...child,
    id: "new-child",
    taskEvidence: { state: "available", source: "spawn", observedAt: now },
  };
  render([root, born]);
  assert.equal(
    present(scene.workers.find((worker) => worker.id === born.id)).helperPhase,
    "entering",
  );
  const oldParentCallback = present(options.onHelperSettled);
  state.selectedHost = "remote";
  render([root, born]);
  assert.equal(
    present(scene.workers.find((worker) => worker.id === born.id)).helperPhase,
    "entering",
    "host selection never rebaselines sources",
  );
  now++;
  render([root, { ...root, id: "other-root" }, { ...born, parentId: "other-root" }]);
  oldParentCallback(born.id, "entering");
  assert.equal(refreshes, 0);
  assert.equal(
    present(scene.workers.find((worker) => worker.id === born.id)).helperPhase,
    "present",
  );
  now++;
  const roots = Array.from({ length: 8 }, (_, i) => ({
    ...root,
    id: "page-root-" + String(i),
    projectId: "z" + String(i),
  }));
  render([root, ...roots]);
  now++;
  const paged = {
    ...born,
    id: "page-child",
    taskEvidence: { ...born.taskEvidence, observedAt: now },
  };
  render([root, paged, ...roots]);
  const oldPageCallback = present(options.onHelperSettled),
    firstPage = state.page;
  state.page = firstPage === 0 ? 1 : 0;
  render([root, paged, ...roots]);
  oldPageCallback(paged.id, "entering");
  assert.equal(refreshes, 0);
  state.page = firstPage;
  render([root, paged, ...roots]);
  assert.equal(
    present(scene.workers.find((worker) => worker.id === paged.id)).helperPhase,
    "present",
  );
  now++;
  const last = {
    ...paged,
    id: "last-child",
    taskEvidence: { ...paged.taskEvidence, observedAt: now },
  };
  render([root, last]);
  const disposedCallback = present(options.onHelperSettled);
  floor.dispose();
  disposedCallback(last.id, "entering");
  assert.equal(refreshes, 0);
  assert.equal(floor.displayedRows.length, 0);
});
test("displayed crew excludes retained helpers without an avatar and preserves history usage", async () => {
  const page = uiFixture();
  let live: Deliver | null = null;
  let scene!: Scene;
  let overviews = 0;
  const app = page.mount({
    createView: () =>
      viewSpy({
        update: (next) => {
          scene = next;
        },
        start() {},
        stop() {},
        overview() {
          overviews++;
        },
        focus() {},
        invalidate() {},
      }),
    query: {
      ...querySpy({
        define() {},
        invalidate: () => Promise.resolve(),
        subscribe: (_key, listener) => {
          live = listener;
          return () => {};
        },
      }),
      dispose() {},
    },
  });
  try {
    await new Promise((resolve) => setImmediate(resolve));
    const now = Date.now();
    const panes: AppRow[] = Array.from({ length: 12 }, (_, index) => ({
      id: "pane" + String(index),
      title: "pane" + String(index),
      source: "herdr",
      paneId: "p" + String(index),
      projectId: "crew",
      project: "Crew",
      repoId: "crew",
      status: index === 8 ? "done" : index === 9 ? "unknown" : index === 10 ? "idle" : "working",
      observedAt: index === 11 ? now - 60000 : now,
    }));
    const helpers: AppRow[] = Array.from({ length: 64 }, (_, index) => ({
      id: "helper" + String(index).padStart(2, "0"),
      source: "helper",
      parentId: "pane0",
      status: index < 2 ? "blocked" : "idle",
      observedAt: now,
    }));
    notify(live, {
      hasData: true,
      updatedAt: now,
      data: {
        health: "available",
        observedAt: now,
        sessions: [...panes, ...helpers],
        aggregate: {
          agents: { observed: 76, statuses: { working: 12, blocked: 2, idle: 62 } },
          usage: { inputTokens: { value: 76000, state: "available" } },
          coverage: { eligible: 76, available: 76 },
        },
      },
    });
    const rosterIds = () =>
      page.document
        .querySelectorAll(page.get("sessions"), ".session-row")
        .map((node) => node.dataset.sessionId)
        .sort();
    const crewIds = scene.workers.map((worker) => worker.id).sort();
    assert.equal(crewIds.length, 20);
    assert.deepEqual(rosterIds(), crewIds);
    assert.match(page.get("counts").textContent, /8 working · 2 waiting · 20 total · 1 last known/);
    assert.match(page.get("room-count").textContent, /20 workers on this deck/);
    const totals = page.get("station-totals");
    assert.match(child(totals, 1).textContent, /^20 displayed/);
    assert.equal(
      child(totals, 3).textContent,
      "8 working · 2 waiting · 7 idle · 1 done · 1 unknown · 1 stale",
    );
    assert.equal(child(child(totals, 5), 0).textContent, "in 76K");
    page.get("search").value = "pane0";
    page.get("search").emit("input");
    assert.equal(rosterIds().length, 1);
    assert.match(child(totals, 1).textContent, /^20 displayed/);
    page.get("search").value = "";
    page.get("search").emit("input");
    const extra: AppRow[] = [
      { id: "overseer", source: "herdr", role: "overseer", status: "idle" },
      { id: "remote", host: "remote", source: "herdr", projectId: "remote", status: "idle" },
      ...Array.from({ length: 9 }, (_, index) => ({
        id: "deck" + String(index),
        projectId: "deck" + String(index),
      })),
    ];
    const expanded: AppSnapshot = {
      sessions: [...panes, ...helpers, ...extra],
      health: "available",
      observedAt: now,
      aggregate: {},
      sources: {
        hosts: {
          local: { health: "available", observedAt: now },
          remote: { health: "available", observedAt: now },
        },
      },
    };
    notify(live, { hasData: true, updatedAt: now, data: expanded });
    assert.equal(rosterIds().length, 30, "local roster covers every deck");
    assert.equal(rosterIds().filter((id) => id === "overseer").length, 1);
    assert.match(child(totals, 1).textContent, /^31 displayed/);
    assert.match(
      page.get("room-count").textContent,
      new RegExp(String(scene.workers.length) + " workers on this deck$"),
    );
    page.get("next-page").emit("click");
    assert.equal(rosterIds().length, 30);
    assert.match(
      page.get("room-count").textContent,
      new RegExp(String(scene.workers.length) + " workers on this deck$"),
    );
    const tabs = page.get("host-tabs").children;
    assert.equal(
      present(tabs.find((tab) => tab.dataset.host === "")).dataset.label,
      "This machine · 30",
    );
    present(tabs.find((tab) => tab.dataset.host === "remote")).emit("click");
    assert.deepEqual(rosterIds(), ["remote"]);
    assert.match(child(totals, 1).textContent, /^31 displayed/);
    present(tabs.find((tab) => tab.dataset.host === "")).emit("click");
    present(
      page.document
        .querySelectorAll(page.get("sessions"), ".session-row")
        .find((node) => node.dataset.sessionId === "helper00"),
    ).emit("click");
    const previousOverviews = overviews;
    notify(live, {
      hasData: true,
      updatedAt: now,
      data: {
        ...expanded,
        sessions: expanded.sessions.filter((row) => row.id !== "pane0"),
      },
    });
    assert(
      !rosterIds().includes("helper00"),
      "a retained helper without a represented parent leaves crew",
    );
    assert(overviews > previousOverviews, "selection clears when its avatar leaves displayed crew");
  } finally {
    app.dispose();
  }
});
test("local roster actions preserve the floor and mail without unrelated reconciliation", async () => {
  const page = uiFixture();
  const filters = ["all", "working"].map((value) => {
    const button = page.document.createElement("button");
    button.dataset.filter = value;
    page.document.attach(page.get("filters"), button);
    return button;
  });
  let live: Deliver | null = null;
  let frame!: UiFrame;
  let invalidated = 0;
  let reads = 0;
  const focused: string[] = [];
  const floor = spyOn(Floor.prototype, "render");
  const couriers = spyOn(Couriers.prototype, "update");
  const app = page.mount({
    createView: () =>
      viewSpy({
        update: (scene, options) => {
          frame = { scene, options };
        },
        start() {},
        stop() {},
        overview() {},
        focus: (id) => {
          focused.push(id);
        },
        invalidate: () => {
          invalidated++;
        },
      }),
    query: {
      ...querySpy({
        define() {},
        invalidate: () => {
          reads++;
          return Promise.resolve();
        },
        subscribe: (_key, listener) => {
          live = listener;
          return () => {};
        },
      }),
      dispose() {},
    },
  });
  try {
    await new Promise((resolve) => setImmediate(resolve));
    const now = Date.now();
    notify(live, {
      hasData: true,
      updatedAt: now,
      data: {
        health: "available",
        observedAt: now,
        sessions: ["first", "second"].map((id, index) => ({
          id,
          project: "Fixture",
          projectId: "fixture",
          repo: "Repo",
          repoId: "repo_fixture",
          provider: "codex",
          status: index ? "idle" : "working",
          title: id,
          observedAt: now,
        })),
      },
    });
    const scene = frame.scene;
    const original = {
      floor: floor.mock.calls.length,
      couriers: couriers.mock.calls.length,
      reads,
      invalidated,
    };
    assert(original.floor > 0 && original.couriers > 0, "ingestion exercises both full owners");
    const rows = () => page.document.querySelectorAll(page.get("sessions"), ".session-row");
    const first = present(rows()[0]);
    first.focus();
    page.get("sessions").scrollTop = 37;
    page.get("search").value = "first";
    page.get("search").emit("input");
    assert.deepEqual(
      rows().map((row) => row.dataset.sessionId),
      ["first"],
    );
    assert.equal(invalidated, original.invalidated, "search leaves canvas untouched");
    page.get("search").value = "";
    page.get("search").emit("input");
    present(filters[1]).emit("click");
    assert.deepEqual(
      rows().map((row) => row.dataset.sessionId),
      ["first"],
    );
    assert.equal(invalidated, original.invalidated, "filter leaves canvas untouched");
    present(filters[0]).emit("click");
    assert.equal(rows()[0], first);
    assert.equal(page.document.activeElement, first);
    assert.equal(page.get("sessions").scrollTop, 37);
    present(frame.options.onRepositoryToggle)("repo_fixture");
    assert.equal(present(frame.options.repositorySelection)(), "repo_fixture");
    assert.equal(invalidated, original.invalidated + 1, "repository selection repaints canvas");
    first.emit("click");
    assert.equal(first.attributes.get("aria-pressed"), "true");
    assert.deepEqual(focused, ["first"]);
    assert.equal(invalidated, original.invalidated + 2, "same-page selection repaints canvas");
    assert.equal(frame.scene, scene);
    assert.equal(
      floor.mock.calls.length,
      original.floor,
      "local actions never reconcile or serialize floor",
    );
    assert.equal(
      couriers.mock.calls.length,
      original.couriers,
      "local actions never rebuild courier state",
    );
    assert.equal(reads, original.reads, "local actions never request inventory");

    notify(live, {
      hasData: true,
      updatedAt: now,
      data: {
        health: "available",
        observedAt: now,
        sessions: [],
        sources: {
          hosts: {
            local: { health: "available", observedAt: now, reason: null, agents: 0 },
            remote: { health: "available", observedAt: now, reason: null, agents: 0 },
          },
        },
      },
    });
    present(page.get("host-tabs").children.find((tab) => tab.dataset.host === "remote")).emit(
      "click",
    );
    assert.equal(page.get("empty").textContent, "No sessions on remote.");
    page.get("search").value = "missing";
    page.get("search").emit("input");
    assert.equal(page.get("empty").textContent, "No sessions on remote.");
    present(filters[1]).emit("click");
    assert.equal(page.get("empty").textContent, "No sessions on remote.");
  } finally {
    app.dispose();
    floor.mockRestore();
    couriers.mockRestore();
  }
});
test("observer-ui regression contracts", async () => {
  const defaults = canonicalTheme();
  const ObserverModel = createModel(defaults);
  const ThemePack = createThemePack(defaults);
  let created = 0,
    listenersAdded = 0;
  const newDocument = () =>
    countedDocument({
      created: () => {
        created++;
      },
      listening: () => {
        listenersAdded++;
      },
    });
  let document = newDocument();
  const element = () => document.createElement("div");
  // Fake timers: the controller's only timer is the stale deadline.
  const timers = new Map<
    number,
    {
      fn: () => void;
      ms: number;
    }
  >();
  let timerId = 0;
  const fakeSetTimeout = (fn: () => void, ms: number) => {
      timers.set(++timerId, { fn, ms });
      return timerId;
    },
    fakeClearTimeout = (id: number) => {
      timers.delete(id);
    };
  const fireTimers = () => {
    const due = [...timers.values()];
    timers.clear();
    for (const timer of due) timer.fn();
  };
  // Panels are built per stack entry with numbered ids; tests find a named part of a panel (default: the top one).
  const findPart = (node: AppFixtureNode, name: string): AppFixtureNode | null => {
    if (new RegExp("^" + name + "-\\d+$").test(node.id || "")) return node;
    for (const child of node.children) {
      const hit = findPart(child, name);
      if (hit) return hit;
    }
    return null;
  };
  const panelPart = (host: AppFixtureNode, name: string, index = -1) => {
    const root = host.children.at(index);
    return root ? findPart(root, name) : null;
  };
  // Fixed markup and accessibility declarations are checked separately from typed mount behavior.
  // Theme status and logo slots: fixed markup, separate from source health, empty and hidden until a theme reports.
  {
    const page = fs
      .readFileSync(new URL("../../../frontend/observer.html", import.meta.url), "utf8")
      .replace(/\s+/g, " ")
      .replace(/>\s+</g, "><")
      .replace(/\s+>/g, ">")
      .replace(/\s+\/>/g, ">");
    const status = page.match(/<div id="theme-status"[^>]*><\/div>/)?.[0] || "";
    assert.ok(
      /role="status"/.test(status) && /aria-live="polite"/.test(status) && / hidden>/.test(status),
      "theme status is a polite, initially hidden status region",
    );
    const health = present(page.match(/<p id="health"[^>]*>[^<]*<\/p>/))[0],
      connection = present(page.match(/<div class="connection">.*?<\/div>/))[0];
    assert.ok(
      connection.includes(health) &&
        !connection.includes("theme-status") &&
        page.indexOf(status) > page.indexOf(connection),
      "theme status sits outside #health and the connection group",
    );
    assert.ok(
      page.indexOf('id="source-health"') > page.indexOf(status),
      "console source health stays a separate region",
    );
    const brand = present(page.match(/<div class="brand">.*?<\/div>/))[0];
    assert.ok(
      brand.includes(
        '<span class="brand-mark" aria-hidden="true">✦</span><img id="brand-logo" class="brand-logo" alt="" hidden><h1>Local observer</h1><span class="read-only">READ ONLY</span>',
      ),
      "logo slot follows the mark without replacing heading or READ ONLY label",
    );
  }
  await (async () => {
    const elements = Object.fromEntries(
      [
        "world",
        "health",
        "observed",
        "sessions",
        "empty",
        "filters",
        "overview",
        "previous-page",
        "next-page",
        "search",
        "page-label",
        "room-count",
        "counts",
        "zoom-in",
        "zoom-out",
        "fx-toggle",
        "mail-health",
        "mail-counts",
        "mail-ledger",
        "mail-empty",
        "mail-detail",
        "inspector",
        "inspector-log",
        "inspector-title",
        "inspector-status",
        "inspector-task",
        "inspector-meta",
        "inspector-health",
        "inspector-stats",
        "inspector-truncated",
        "inspector-window",
        "inspector-empty",
        "inspector-follow",
        "inspector-pause",
        "inspector-jump",
        "inspector-buffer",
        "inspector-close",
        "mail-inspector",
        "mail-inspector-title",
        "mail-inspector-meta",
        "mail-inspector-health",
        "mail-inspector-body",
        "mail-inspector-truncated",
        "mail-inspector-empty",
        "mail-inspector-close",
        "zoom-chip",
        "source-health",
        "panels",
        "station-totals",
        "station-stats",
        "station-stats-summary",
        "controls-help",
        "controls-help-popover",
      ].map((id) => [id, element()]),
    );
    // Theme slots belong to the theme helper. Any controller write is a behavioral failure.
    let guardsActive = false;
    for (const id of ["theme-status", "brand-logo"])
      elements[id] = new Proxy(element(), {
        set(target, key, value) {
          if (!guardsActive) return Reflect.set(target, key, value);
          assert.fail("session controller must not write " + id);
        },
      });
    const filters = ["all", "working", "blocked"].map((value) => {
      const button = document.createElement("button");
      button.dataset.filter = value;
      return button;
    });
    document.replaceChildren(present(elements.filters), ...filters);
    const events: UiEvents = {},
      updates: UiFrame[] = [],
      focuses: (string | null)[] = [],
      zooms: number[] = [],
      lifecycle: string[] = [],
      invalidations: number[] = [],
      refreshes: string[] = [];
    const inspections: Map<string, Deliver> = new Map(),
      specs: Map<string, QuerySpec> = new Map(),
      reads: string[] = [];
    let fxState = true;
    const themedStyles = new Map<string, string>();
    const themeOwnedStyles = new Map<string, string>();
    let applyingTheme = false;
    let listener!: Deliver | null,
      subscriptions = 0,
      removals = 0,
      spec!: QuerySpec,
      viewOptions!: UiViewOptions;
    const scene = () => present(updates.at(-1)).scene,
      options = () => present(updates.at(-1)).options,
      chairOf = (id: string) => present(scene().workers.find((worker) => worker.id === id)).chair;
    document = bindDocument(document, elements, events, { hidden: false });
    const rootStyle = document.themeDocument.documentElement.style;
    const applyStyle = rootStyle.setProperty.bind(rootStyle);
    rootStyle.setProperty = (key, value) => {
      applyStyle(key, value);
      (applyingTheme ? themeOwnedStyles : themedStyles).set(key, value);
    };
    const bodyStyles = new Map();
    document.body.style.setProperty = (key, value) => bodyStyles.set(key, value);
    const ObserverView: UiScenario["view"] = {
      create(created) {
        viewOptions = created;
        return {
          setFx(on) {
            fxState = on;
          },
          fx() {
            return fxState;
          },
          update(next, payload) {
            updates.push({ scene: next, options: payload });
          },
          focus(id) {
            focuses.push(id);
          },
          overview() {
            focuses.push(null);
          },
          zoomBy(factor) {
            zooms.push(factor);
          },
          start() {
            lifecycle.push("start");
          },
          stop() {
            lifecycle.push("stop");
          },
          invalidate() {
            invalidations.push(1);
          },
        };
      },
    };
    const context: UiScenario = {
      document,
      schedule: (callback, milliseconds) => {
        const id = fakeSetTimeout(callback, milliseconds);
        return () => {
          fakeClearTimeout(id);
        };
      },
      model: ObserverModel,
      view: ObserverView,
      theme: {
        ...ThemePack,
        start(snapshot, themeDocument) {
          applyingTheme = true;
          try {
            return ThemePack.start(snapshot, themeDocument);
          } finally {
            applyingTheme = false;
          }
        },
      },
      window: {
        __OBSERVER_THEME__: { fx: false, colors: { accent: "#77dce8", background: "#02060b" } },
        localStorage: {
          getItem() {
            return "on";
          },
          setItem() {},
        },
        addEventListener(name, fn) {
          events[name] = fn;
        },
      },
      sprites: { init: async () => {} },
      api: {
        get: (path) => {
          reads.push(path);
          return new Promise(() => {});
        },
      },
      query: {
        define(key, options) {
          specs.set(key, options);
          if (key === "observer.sessions") spec = options;
        },
        invalidate(key) {
          refreshes.push(key);
          return Promise.resolve();
        },
        subscribe(key, fn) {
          if (key !== "observer.sessions") {
            inspections.set(key, fn);
            return () => inspections.delete(key);
          }
          subscriptions++;
          listener = fn;
          return () => {
            removals++;
            listener = null;
          };
        },
      },
    };
    guardsActive = true;
    mountScenario(context);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(spec.path, "/api/observer/sessions");
    assert.equal(spec.pollMs, 2000);
    const sessions: AppRow[] = Array.from({ length: 16 }, (_, i) => ({
      id: "obs_" + String(i),
      paneId: "p" + String(i),
      project: "repo",
      projectId: "repo1",
      projectKind: "repository",
      provider: "codex",
      sessionId: "session1",
      status: "working",
      title: "<script>private</script>",
      tool: { available: false },
    }));
    const snapshot = { data: { sessions, health: "available", observedAt: Date.now() } };
    // A real poll always parses a new data object; tests that edit rows in place republish them the same way.
    const poll = () => ({ ...snapshot, data: { ...snapshot.data } });
    assert.equal(viewOptions.canvas, document.canvas);
    assert.deepEqual(lifecycle, ["start"], "one view, started once");
    assert.equal(
      viewOptions.theme,
      ThemePack.getDefault(),
      "without a selected snapshot the view paints the canonical default",
    );
    assert.equal(fxState, false, "explicit theme FX wins over saved browser preference");
    assert.equal(present(elements["fx-toggle"]).attributes.get("aria-pressed"), "false");
    assert(themeOwnedStyles.size > 0, "the actual theme owner applies its interface styles");
    assert.equal(
      themedStyles.size,
      0,
      "interface colours come from the theme pack helper, not observer.js",
    );
    assert.equal(bodyStyles.has("--chrome"), false);
    assert.equal(
      bodyStyles.has("--glow"),
      false,
      "theme inheritance leaves body stale-state overrides in control",
    );
    present(elements["fx-toggle"]).emit("click");
    assert.equal(fxState, true, "manual FX toggle remains available");
    notify(listener, snapshot);
    assert.equal(scene().workers.length, 16);
    assert.equal(present(elements.sessions).children.length, 1);
    assert.equal(scene().platforms.length, 1);
    assert(
      scene().workers.every((worker) => worker.platformKey === present(scene().platforms[0]).key),
      "every worker stands on its project platform",
    );
    assert.equal(
      new Set(
        scene().workers.map((worker) => String(worker.chair.x) + "," + String(worker.chair.y)),
      ).size,
      16,
      "16 distinct desks",
    );
    const allItems = (node: AppFixtureNode): AppFixtureNode[] =>
      node.className.split(" ").includes("session-item") ? [node] : node.children.flatMap(allItems);
    const originalItem = allItems(present(elements.sessions))[0],
      originalButton = present(originalItem).children[0];
    present(originalButton).focus();
    const checkoutRows = [
      "main",
      "checkout_7785594026262a4b150b",
      "checkout_95a43a6b39b11304150b",
      null,
    ].map((checkoutId, i) => ({
      ...sessions[i],
      repoId: "same-repo",
      repo: "shared",
      checkoutId,
      checkoutKind: i === 0 ? "main" : i < 3 ? "worktree" : null,
      worktree: i ? "same name" : null,
      folder: "src",
    }));
    notify(listener, { data: { ...snapshot.data, sessions: checkoutRows } });
    const checkoutGroups = child(child(present(elements.sessions), 0), 2).children;
    assert.equal(checkoutGroups.length, 4, "four checkout containers");
    assert.deepEqual(
      checkoutGroups.map((node) => child(node, 0).textContent),
      [
        "shared · Main checkout",
        "shared · Worktree same name · b150b",
        "shared · Worktree same name · 4150b",
        "shared · Checkout unavailable",
      ],
    );
    assert(
      checkoutGroups.every((node) => child(child(child(node, 1), 0), 0).textContent === "src"),
    );
    assert.equal(allItems(present(elements.sessions))[0], originalItem);
    assert.equal(document.activeElement, originalButton);
    notify(listener, { data: { ...snapshot.data, sessions: checkoutRows.slice().reverse() } });
    assert.equal(
      allItems(present(elements.sessions)).find((item) => item.children[0] === originalButton),
      originalItem,
    );
    assert.equal(document.activeElement, originalButton);
    assert.deepEqual(
      child(child(present(elements.sessions), 0), 2).children.map(
        (node) => child(node, 0).textContent,
      ),
      [
        "shared · Checkout unavailable",
        "shared · Worktree same name · 4150b",
        "shared · Worktree same name · b150b",
        "shared · Main checkout",
      ],
      "colliding checkout headings remain distinct and stable after reorder",
    );
    const stableCheckout = child(child(present(elements.sessions), 0), 2).children.find((node) =>
      child(node, 0).textContent.includes("Main checkout"),
    );
    const stableFolder = child(present(stableCheckout), 1).children[0],
      stableInspect = present(originalItem).children[2];
    notify(listener, { data: { ...snapshot.data, sessions: checkoutRows } });
    assert.equal(child(child(present(elements.sessions), 0), 2).children[0], stableCheckout);
    assert.equal(child(present(stableCheckout), 1).children[0], stableFolder);
    assert.equal(present(allItems(present(elements.sessions))[0]).children[2], stableInspect);
    present(filters[2]).emit("click");
    present(filters[0]).emit("click");
    assert.equal(
      allItems(present(elements.sessions)).find((item) => item.children[0] === originalButton),
      originalItem,
      "filter restores exact row",
    );
    notify(listener, { data: { ...snapshot.data, sessions: checkoutRows.slice(0, 3) } });
    assert.equal(
      child(child(present(elements.sessions), 0), 2).children.length,
      3,
      "removal prunes unavailable checkout",
    );
    assert.equal(
      child(child(child(present(elements.sessions), 0), 0), 3).textContent,
      "3",
      "project count follows rows",
    );
    notify(listener, { data: { ...snapshot.data, sessions: [] } });
    notify(listener, snapshot);
    // Recording mode hides every inspector entrypoint during ordinary observation remains inspectable.
    const recordedRow = sessionItems(child(present(elements.sessions), 0))[0];
    notify(listener, {
      ...snapshot,
      data: { ...snapshot.data, presentation: { company: "Helioforge" } },
    });
    assert.equal(child(present(recordedRow), 1).disabled, true);
    assert.equal(child(present(recordedRow), 2).disabled, true);
    present(viewOptions.onTitleToggle)("obs_0");
    child(present(recordedRow), 2).emit("click");
    assert.equal(
      present(elements.panels).children.length,
      0,
      "canvas and console cannot open private inspectors",
    );
    notify(listener, poll());
    assert.equal(child(present(recordedRow), 1).disabled, false);
    assert.equal(child(present(recordedRow), 2).disabled, false);
    const firstRevision = scene().revision;
    notify(listener, snapshot);
    assert.equal(scene().revision, firstRevision, "a repeated snapshot keeps the geometry");
    assert.equal(present(options().stale)(), false);
    assert.equal(present(options().inspected)(), null);
    let button = present(sessionItems(child(present(elements.sessions), 0))[0]).children[0];
    present(button).focus();
    present(button).emit("click");
    assert.equal(focuses.at(-1), "obs_0");
    notify(listener, snapshot);
    assert.equal(document.activeElement.dataset.sessionId, "obs_0");
    assert.equal(document.activeElement.attributes.get("aria-pressed"), "true");
    present(snapshot.data.sessions[0]).provider = "claude";
    present(snapshot.data.sessions[0]).sessionId = "replacement";
    present(snapshot.data.sessions[0]).tool = {
      available: true,
      last: { name: "Bash", phase: "started", at: new Date().toISOString() },
    };
    notify(listener, poll());
    assert(present(viewOptions.nameFor)("obs_0").startsWith("Claude"));
    assert.equal(
      present(scene().workers.find((worker) => worker.id === "obs_0")).row.provider,
      "claude",
    );
    button = present(sessionItems(child(present(elements.sessions), 0))[0]).children[0];
    assert(child(present(button), 2).textContent.includes("running a command"));
    present(present(present(snapshot.data.sessions[0]).tool).last).phase = "finished";
    notify(listener, poll());
    assert(
      child(
        child(present(sessionItems(child(present(elements.sessions), 0))[0]), 0),
        2,
      ).textContent.includes("finished"),
    );
    present(filters[2]).emit("click");
    assert.equal(present(elements.sessions).children.length, 0);
    assert.equal(scene().workers.length, 16, "filters never remove floor workers");
    assert.equal(present(elements.empty).hidden, false);
    present(filters[0]).emit("click");
    notify(listener, { ...snapshot, error: new Error("offline") });
    assert.equal(present(options().stale)(), true, "stale freezes the scene");
    assert.equal(scene().workers.length, 16, "and retains the last crew");
    // Freshness is evaluated per paint: an old observation turns stale without another response.
    notify(listener, { data: { ...snapshot.data, observedAt: Date.now() - 7000 } });
    assert.equal(present(options().stale)(), true);
    const retained = chairOf("obs_1");
    snapshot.data.sessions = sessions.slice(1);
    snapshot.data.observedAt = Date.now();
    notify(listener, poll());
    assert.equal(scene().workers.length, 15);
    assert.deepEqual(chairOf("obs_1"), retained, "survivors keep their desk");
    // The magnifier is a sibling of the row button: it opens the inspector without changing what a row click means.
    let inspect = present(sessionItems(child(present(elements.sessions), 0))[0]).children[2];
    assert.equal(present(inspect).className, "row-inspect");
    assert.equal(present(inspect).attributes.get("aria-haspopup"), "dialog");
    assert.equal(present(inspect).attributes.get("aria-expanded"), "false");
    present(inspect).focus();
    present(inspect).emit("click");
    const panel = () => present(elements.panels).children.at(-1),
      part = (name: string) => panelPart(present(elements.panels), name);
    assert.equal(present(elements.panels).children.length, 1);
    assert.equal(present(panel()).open, true);
    assert.equal(present(panel()).mode, "show", "desktop opens non-modal");
    assert.equal(
      present(specs.get("observer.inspect.obs_1")).path,
      "/api/observer/sessions/obs_1/inspect?identity=codex%3Asession1",
      "the read names the panel's exact target",
    );
    assert.equal(document.activeElement, part("inspector-title"), "focus moves into the inspector");
    assert.equal(present(part("inspector-title")).textContent, "Codex · 2");
    assert.equal(
      present(part("inspector-task")).textContent,
      "<script>private</script>",
      "titles stay text",
    );
    inspect = present(sessionItems(child(present(elements.sessions), 0))[0]).children[2];
    assert.equal(present(inspect).attributes.get("aria-expanded"), "true");
    assert.equal(
      present(inspect).attributes.get("aria-controls"),
      present(panel()).id,
      "the toggle names the panel it controls",
    );
    assert.equal(present(options().inspected)(), "obs_1", "the view can tag the inspected worker");
    // Still open: the roster moves a new provider/session behind obs_1. This panel belongs to the old session: it is
    // withdrawn at once and never reads the replacement.
    const firstRead = inspections.get("observer.inspect.obs_1");
    present(firstRead)({
      hasData: true,
      error: null,
      data: {
        id: "obs_1",
        inspectionIdentity: "codex:session1",
        health: "available",
        asOf: new Date().toISOString(),
        reason: null,
        stats: {},
        generation: "g1",
        truncated: false,
        window: {},
        turns: [
          { id: "u1", role: "user", at: null, text: "old pane conversation", textTruncated: false },
        ],
      },
    });
    assert.equal(present(part("inspector-log")).children.length, 1);
    present(snapshot.data.sessions[0]).sessionId = "replacement-2";
    present(snapshot.data.sessions[0]).provider = "claude";
    notify(listener, { data: { ...snapshot.data, observedAt: Date.now() } });
    assert.equal(
      present(part("inspector-log")).children.length,
      0,
      "no old conversation under the new header",
    );
    assert.equal(
      inspections.has("observer.inspect.obs_1"),
      false,
      "the replacement is not read by this panel",
    );
    assert.equal(present(part("inspector-title")).textContent, "Claude · 2");
    assert.match(present(part("inspector-health")).textContent, /different session/);
    inspect = present(sessionItems(child(present(elements.sessions), 0))[0]).children[2];
    assert.equal(
      present(inspect).attributes.get("aria-expanded"),
      "false",
      "the row now shows a session with no open panel",
    );
    // Opening it again replaces the obsolete panel associated with that row, targeting its current session.
    present(inspect).emit("click");
    assert.equal(present(elements.panels).children.length, 1);
    assert(inspections.has("observer.inspect.obs_1"));
    notify(listener, { data: { ...snapshot.data, health: "unavailable", observedAt: Date.now() } });
    assert.equal(
      inspections.has("observer.inspect.obs_1"),
      false,
      "an unavailable roster withholds the inspector",
    );
    notify(listener, { data: { ...snapshot.data, observedAt: Date.now() } });
    present(events.keydown)({ key: "Escape", preventDefault() {} });
    assert.equal(present(elements.panels).children.length, 0);
    assert.equal(inspections.size, 0, "closing stops the inspector poll");
    assert.equal(
      document.activeElement.dataset.inspectId,
      "obs_1",
      "focus returns to the rebuilt magnifier",
    );
    assert.equal(
      child(present(sessionItems(child(present(elements.sessions), 0))[0]), 0).attributes.get(
        "aria-pressed",
      ),
      "true",
      "Escape closed only the inspector, the worker stays focused",
    );
    // Toolbar zoom goes through the view; the view reports its clamps back to the buttons.
    present(elements["zoom-in"]).emit("click");
    present(elements["zoom-out"]).emit("click");
    assert.deepEqual(zooms, [1.25, 0.8]);
    present(viewOptions.onCamera)({ canZoomIn: false, canZoomOut: true });
    assert.equal(present(elements["zoom-in"]).disabled, true);
    assert.equal(present(elements["zoom-out"]).disabled, false);
    present(elements.overview).emit("click");
    assert.equal(focuses.at(-1), null, "Overview releases the worker focus");
    present(events.pagehide)();
    assert.equal(removals, 1);
    present(events.pageshow)();
    assert.equal(subscriptions, 2);
    assert.deepEqual(lifecycle.slice(-2), ["stop", "start"]);
    console.log(
      "observer UI: live summaries, 16 stable desks, focused selection across polls, filters independent of floor, replacement/stale/removal/lifecycle OK",
    );
    // Older or partial snapshots without a bus field keep working.
    assert.equal(present(elements["mail-health"]).textContent, "Bus not read yet");
    assert.equal(present(elements["mail-counts"]).textContent, "");
    const sent = new Date().toISOString();
    const mail = {
      health: "available",
      reason: null,
      observedAt: Date.now(),
      window: 100,
      messages: [
        {
          id: 3,
          from: "external",
          to: "ambiguous",
          sentAt: sent,
          acknowledgedAt: null,
          wake: "none",
          identity: "mail_" + "3".repeat(64),
        },
        {
          id: 2,
          from: "obs_2",
          to: "external",
          sentAt: sent,
          acknowledgedAt: sent,
          wake: "requested",
          identity: "mail_" + "2".repeat(64),
        },
        {
          id: 1,
          from: "obs_2",
          to: "obs_1",
          sentAt: sent,
          acknowledgedAt: null,
          wake: "failed",
          identity: "mail_" + "1".repeat(64),
        },
      ],
    };
    notify(listener, { data: { ...snapshot.data, observedAt: Date.now(), bus: mail } });
    assert.equal(present(elements["mail-health"]).textContent, "Live · llm-bus");
    assert.equal(
      present(elements["mail-counts"]).textContent,
      "2 pending · 1 acknowledged · in recent 100",
      "counts are within the recent window",
    );
    const ledger = present(elements["mail-ledger"]).children.map((item) => item.children[0]);
    assert.deepEqual(
      ledger.map((button) => present(button).dataset.messageId),
      ["3", "2", "1"],
    );
    const rowFor = (id: string) =>
      present(elements.sessions)
        .children.flatMap((group) => sessionItems(group).map((item) => item.children[0]))
        .find((button) => present(button).dataset.sessionId === id);
    assert.equal(
      present(present(rowFor("obs_1")).children.find((child) => child.className === "row-mail"))
        .textContent,
      "✉ 1 unacknowledged message · recent 100",
    );
    assert(!present(rowFor("obs_2")).children.some((child) => child.className === "row-mail"));
    present(ledger[2]).emit("click");
    assert.equal(focuses.at(-1), "obs_1", "selecting a message focuses its recipient");
    // Pending mail is static truth at the recipient desk; the frame grounds on a stale transition.
    const frame = present(options().mailFrame)(1000);
    assert.equal(frame.envelopes.length, 2, "one desk envelope and one outbound chute envelope");
    assert(frame.envelopes.every((envelope) => envelope.point.z === 1.2));
    assert(
      frame.envelopes.some((envelope) => envelope.mark),
      "a failed wake is marked",
    );
    assert.equal(frame.drones.length, 3, "parked drones fill the hub pads");
    assert(present(elements["mail-detail"]).textContent.includes("not acknowledged · wake failed"));
    child(child(present(elements["mail-ledger"]), 1), 0).emit("click");
    assert.equal(focuses.at(-1), "obs_2");
    assert(
      present(elements["mail-detail"]).textContent.includes(
        "recipient is not an observed pane; showing sender",
      ),
    );
    child(child(present(elements["mail-ledger"]), 0), 0).emit("click");
    assert(
      present(elements["mail-detail"]).textContent.includes(
        "from Outside the observer · to Ambiguous session",
      ),
    );
    assert(
      present(elements["mail-detail"]).textContent.includes("neither side is an observed pane"),
    );
    assert(!/received|read by/i.test(present(elements["mail-detail"]).textContent));
    // The open detail follows its message id across polls: a later ACK replaces the stale wake text, and a row that
    // leaves the recent window says so instead of showing its old state.
    child(child(present(elements["mail-ledger"]), 2), 0).emit("click");
    assert(
      present(elements["mail-detail"]).textContent.startsWith("Message #1 ") &&
        present(elements["mail-detail"]).textContent.includes("not acknowledged · wake failed"),
    );
    const ackedMail = {
      ...mail,
      observedAt: Date.now(),
      messages: mail.messages.map((value) =>
        value.id === 1 ? { ...value, acknowledgedAt: sent, wake: "requested" } : value,
      ),
    };
    notify(listener, { data: { ...snapshot.data, observedAt: Date.now(), bus: ackedMail } });
    assert(present(elements["mail-detail"]).textContent.startsWith("Message #1 "));
    assert(present(elements["mail-detail"]).textContent.endsWith(" · acknowledged"));
    assert(
      !present(elements["mail-detail"]).textContent.includes("wake failed"),
      "ACK refreshes the open detail",
    );
    // The body magnifier is a sibling of the ledger row: one identity-bound read per open; metadata polls never refetch.
    // Mail is proved by a successful current transport, so these notifications carry QuerySpine's success fields.
    const proved = (data: unknown) => ({
      hasData: true,
      error: null,
      pending: false,
      updatedAt: Date.now(),
      data,
    });
    notify(listener, proved({ ...snapshot.data, observedAt: Date.now(), bus: ackedMail }));
    const read = child(present(elements["mail-ledger"]), 2).children[1];
    assert.equal(present(read).className, "row-inspect");
    assert.equal(present(read).attributes.get("aria-label"), "Read message #1");
    assert.equal(present(read).attributes.get("aria-expanded"), "false");
    present(read).focus();
    present(read).emit("click");
    await new Promise((resolve) => setImmediate(resolve));
    const mailPart = (name: string) => panelPart(present(elements.panels), name);
    assert.deepEqual(reads, ["/api/observer/messages/1/inspect?identity=mail_" + "1".repeat(64)]);
    assert.equal(present(present(elements.panels).children.at(-1)).open, true);
    assert.equal(document.activeElement, mailPart("mail-inspector-title"));
    assert(present(mailPart("mail-inspector-meta")).textContent.startsWith("from Codex"));
    assert.equal(
      child(child(present(elements["mail-ledger"]), 2), 1).attributes.get("aria-expanded"),
      "true",
    );
    assert.equal(
      child(child(present(elements["mail-ledger"]), 2), 1).attributes.get("aria-label"),
      "Close message #1",
    );
    notify(listener, proved({ ...snapshot.data, observedAt: Date.now(), bus: ackedMail }));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(reads.length, 1, "the ledger poll keeps the body read to one");
    present(events.keydown)({ key: "Escape", preventDefault() {} });
    assert.equal(present(elements.panels).children.length, 0, "Escape closes the mail panel first");
    assert.equal(
      document.activeElement,
      child(present(elements["mail-ledger"]), 2).children[1],
      "focus returns to the live magnifier",
    );
    // Mail and agent panels stack: opening one never closes the other; closing the top reveals the lower one.
    child(child(present(elements["mail-ledger"]), 2), 1).emit("click");
    await new Promise((resolve) => setImmediate(resolve));
    const sessionInspect = sessionItems(child(present(elements.sessions), 0))
      .map((item) => item.children[2])
      .find((button) => present(button).dataset.inspectId === "obs_1");
    present(sessionInspect).emit("click");
    assert.equal(
      present(elements.panels).children.length,
      2,
      "opening the agent inspector keeps the mail panel underneath",
    );
    assert.equal(child(present(elements.panels), 0).open, false);
    assert.equal(
      child(present(elements.panels), 0).inert,
      true,
      "the covered panel is hidden and inert",
    );
    assert.equal(child(present(elements.panels), 1).open, true);
    present(events.keydown)({ key: "Escape", preventDefault() {} });
    assert.equal(present(elements.panels).children.length, 1);
    assert.equal(child(present(elements.panels), 0).open, true, "the mail panel is shown again");
    assert.equal(document.activeElement, mailPart("mail-inspector-title"));
    assert.equal(reads.length, 2, "and is not read again");
    present(events.keydown)({ key: "Escape", preventDefault() {} });
    assert.equal(present(elements.panels).children.length, 0);
    const later = Array.from({ length: 30 }, (_, index) => ({
      id: 200 - index,
      from: "external",
      to: "obs_3",
      sentAt: sent,
      acknowledgedAt: null,
      wake: "none",
    }));
    notify(listener, {
      data: {
        ...snapshot.data,
        observedAt: Date.now(),
        bus: { ...mail, observedAt: Date.now(), messages: later },
      },
    });
    assert.equal(present(elements["mail-detail"]).hidden, false);
    assert.equal(
      present(elements["mail-detail"]).textContent,
      "Message #1 is no longer in the recent 100 bus messages",
    );
    assert.equal(
      present(elements["mail-ledger"]).children.length,
      30,
      "the ledger lists the whole recent window, not a silent subset",
    );
    notify(listener, {
      data: {
        ...snapshot.data,
        observedAt: Date.now(),
        bus: {
          health: "unavailable",
          reason: "missing",
          observedAt: null,
          window: 100,
          messages: [],
        },
      },
    });
    assert.equal(present(elements["mail-health"]).textContent, "No bus database found");
    assert.equal(present(elements["mail-empty"]).hidden, false);
    // Hover reads the latest roster title on every call: Herdr publishes it after the conversation starts.
    const hovered = present(snapshot.data.sessions[1]).id;
    present(snapshot.data.sessions[1]).title = "codex";
    notify(listener, { data: { ...snapshot.data, observedAt: Date.now() } });
    assert.equal(
      present(viewOptions.hoverLabel)(hovered),
      "Codex — title not yet published by Herdr",
      "the sidecar agent-name fallback is not a title",
    );
    present(snapshot.data.sessions[1]).title = "Fix  drone\nspeed";
    notify(listener, { data: { ...snapshot.data, observedAt: Date.now() } });
    assert.equal(
      present(viewOptions.hoverLabel)(hovered),
      "Codex — Fix drone speed",
      "a newly published title replaces the fallback while hovered",
    );
    notify(listener, {
      data: { ...snapshot.data, observedAt: Date.now() },
      error: new Error("offline"),
    });
    assert.equal(
      present(viewOptions.hoverLabel)(hovered),
      "Codex — Fix drone speed · stale",
      "retained data is marked stale",
    );
    assert.equal(
      present(viewOptions.hoverLabel)("obs_missing"),
      null,
      "an unknown body keeps its renderer name",
    );
    console.log(
      "observer UI: optional bus field, recent-window counts, pending row text, ledger focus/unknown endpoints, mail frames, dynamic hover and missing bus OK",
    );
    // Sprite assets that never settle, reject or fail synchronously never hold back the inventory poll, the view or the first render.
    for (const init of [
      () => new Promise(() => {}),
      () => Promise.reject(new Error("assets blocked")),
      () => {
        throw new Error("no sprites");
      },
    ]) {
      document = newDocument();
      const own = Object.fromEntries(Object.keys(elements).map((id) => [id, element()])),
        started: string[] = [],
        renders: Scene[] = [];
      let defined = false,
        live: Deliver | null = null;
      const ownDocument = bindDocument(document, own, undefined, { hidden: false });
      document.replaceChildren(
        present(own.filters),
        ...["all", "working", "blocked"].map((value) => {
          const node = document.createElement("button");
          node.dataset.filter = value;
          return node;
        }),
      );
      mountScenario({
        ...context,
        document: ownDocument,
        sprites: { init },
        view: {
          create: () => ({
            update: (next) => renders.push(next),
            focus() {},
            overview() {},
            zoomBy() {},
            start: () => started.push("start"),
            stop() {},
            invalidate() {},
          }),
        },
        query: {
          define(key) {
            if (key === "observer.sessions") defined = true;
          },
          invalidate: () => Promise.resolve(),
          subscribe(key, fn) {
            if (key === "observer.sessions") live = fn;
            return () => {};
          },
        },
      });
      const inventoryReady = () => defined && live !== null;
      assert(
        inventoryReady(),
        "the inventory resource is defined and subscribed without waiting for sprites",
      );
      assert.deepEqual(started, ["start"], "the view starts without waiting for sprites");
      notify(live, {
        data: { sessions: sessions.slice(0, 2), health: "available", observedAt: Date.now() },
      });
      assert.equal(
        present(renders.at(-1)).workers.length,
        2,
        "the first inventory renders while sprites are pending or failed",
      );
      await new Promise((resolve) => setImmediate(resolve));
    }
    console.log(
      "observer UI: unresolved, rejected and throwing sprite init never block startup OK",
    );
    // The selected snapshot reaches the view, layout accents, courier colours and crew init; crew failure warns once and repaints.
    {
      const base = ThemePack.getDefault(),
        accents = Array.from(
          { length: 10 },
          (_, index) => "#c0" + String(index).padStart(2, "0") + "c" + String(index),
        );
      const pack = {
        version: 1,
        requestedId: "synthetic",
        effectiveId: "synthetic",
        warnings: [],
        ui: base.ui,
        crew: { ...base.crew, blank: base.crew.blank },
        scene: {
          ...base.scene,
          colors: { ...base.scene.colors, "mail-pending": "#102030" },
          projectAccents: accents,
          backgroundFx: "none",
          ambientFx: "none",
        },
      };
      document = newDocument();
      const own = Object.fromEntries(Object.keys(elements).map((id) => [id, element()])),
        renders: Scene[] = [],
        inits: SpriteInit[] = [],
        warnings: RuntimeThemeWarning[] = [];
      let created!: UiViewOptions,
        invalidated = 0,
        live: Deliver | null = null,
        options!: UpdateOptions;
      const ownDocument = bindDocument(document, own, undefined, { hidden: false });
      document.replaceChildren(
        present(own.filters),
        ...["all", "working", "blocked"].map((value) => {
          const node = document.createElement("button");
          node.dataset.filter = value;
          return node;
        }),
      );
      mountScenario({
        ...context,
        document: ownDocument,
        window: { ...context.window, __OBSERVER_THEME_PACK__: pack },
        sprites: {
          init: (arg) => {
            inits.push(arg);
            return Promise.resolve();
          },
        },
        theme: { ...ThemePack, reportWarning: (warning) => warnings.push(warning) },
        view: {
          create: (value) => {
            created = value;
            return {
              update: (next, payload) => {
                renders.push(next);
                options = payload;
              },
              focus() {},
              overview() {},
              zoomBy() {},
              start() {},
              stop() {},
              invalidate: () => {
                invalidated++;
              },
            };
          },
        },
        query: {
          define() {},
          invalidate: () => Promise.resolve(),
          subscribe(key, fn) {
            if (key === "observer.sessions") live = fn;
            return () => {};
          },
        },
      });
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(created.theme, pack, "the view receives the selected snapshot");
      assert(Object.isFrozen(pack.scene.colors), "and it is frozen");
      assert.equal(inits.length, 1);
      assert.equal(present(inits[0]).crew, pack.crew, "sprite init receives the snapshot crew");
      assert.equal(typeof present(inits[0]).onDegraded, "function");
      const settled = invalidated;
      const rows = sessions.slice(0, 2).map((row) => ({ ...row, sessionId: "mail-" + row.id }));
      notify(live, {
        data: {
          sessions: rows,
          health: "available",
          observedAt: Date.now(),
          bus: {
            health: "available",
            reason: null,
            observedAt: Date.now(),
            window: 100,
            messages: [
              {
                id: 1,
                from: "obs_1",
                to: "obs_0",
                sentAt: new Date().toISOString(),
                acknowledgedAt: null,
                wake: "none",
                identity: "mail_" + "1".repeat(64),
              },
            ],
          },
        },
      });
      const accent = present(present(renders.at(-1)).platforms[0]).accent;
      assert(
        accents.includes(accent) && !base.scene.projectAccents.includes(accent),
        "platform accents come from the snapshot slots",
      );
      assert.deepEqual(
        present(options.mailFrame)(1000).envelopes.map((envelope) => envelope.color),
        ["#102030"],
        "pending envelopes use the snapshot mail colour",
      );
      present(present(inits[0]).onDegraded)({ skin: "blank", reason: "image-load" });
      assert.equal(warnings.length, 1);
      assert.equal(invalidated, settled + 1, "a degraded crew group repaints the scene once");
      assert.deepEqual(
        {
          code: present(warnings[0]).code,
          pack: present(warnings[0]).pack,
          group: present(warnings[0]).group,
        },
        { code: "crew-load", pack: "synthetic", group: "blank" },
      );
      assert.equal(
        present(warnings[0]).message,
        "Theme pack synthetic crew blank did not load; showing fallback crew.",
      );
      present(present(inits[0]).onDegraded)({
        skin: "../assets/x.png",
        reason: "image-dimensions",
        ...{ error: new Error("/private/path") },
      });
      assert.deepEqual(
        [present(warnings[1]).code, present(warnings[1]).group],
        ["crew-dimensions", "unknown"],
        "unsafe group names never reach the warning",
      );
      assert(
        !present(present(warnings[1]).message).includes("/") &&
          !present(present(warnings[1]).message).includes("Error"),
        "no paths or raw errors",
      );
    }
    console.log(
      "observer UI: snapshot reaches view, layout accents, courier colours and crew init; crew degradation warns and repaints OK",
    );
    // ---------- Task 2: work follows visible change ----------
    {
      timers.clear();
      const ids = [
        "world",
        "health",
        "observed",
        "sessions",
        "empty",
        "filters",
        "overview",
        "previous-page",
        "next-page",
        "search",
        "page-label",
        "room-count",
        "counts",
        "zoom-in",
        "zoom-out",
        "mail-health",
        "mail-counts",
        "mail-ledger",
        "mail-empty",
        "mail-detail",
        "inspector",
        "inspector-log",
        "inspector-title",
        "inspector-status",
        "inspector-task",
        "inspector-meta",
        "inspector-health",
        "inspector-stats",
        "inspector-truncated",
        "inspector-window",
        "inspector-empty",
        "inspector-follow",
        "inspector-pause",
        "inspector-jump",
        "inspector-buffer",
        "inspector-close",
        "mail-inspector",
        "mail-inspector-title",
        "mail-inspector-meta",
        "mail-inspector-health",
        "mail-inspector-body",
        "mail-inspector-truncated",
        "mail-inspector-empty",
        "mail-inspector-close",
        "zoom-chip",
        "source-health",
        "panels",
        "station-totals",
        "station-stats",
        "station-stats-summary",
        "controls-help",
        "controls-help-popover",
      ];
      document = newDocument();
      const own = Object.fromEntries(ids.map((id) => [id, element()]));
      document.replaceChildren(
        present(own.filters),
        ...["all", "working", "blocked"].map((value) => {
          const node = document.createElement("button");
          node.dataset.filter = value;
          return node;
        }),
      );
      const docEvents: UiEvents = {},
        winEvents: UiEvents = {},
        sceneUpdates: Scene[] = [],
        lifecycle: string[] = [],
        refreshes: string[] = [],
        inspectSubs: Map<string, Deliver> = new Map();
      let deadlineNow: number | undefined;
      let invalidated = 0,
        live: Deliver | null = null,
        subscribed = 0,
        unsubscribed = 0,
        rowWork = 0;
      document = bindDocument(document, own, docEvents, { hidden: false });
      mountScenario({
        ...context,
        document,
        now: () => deadlineNow ?? Date.now(),
        model: {
          ...ObserverModel,
          activity: (row) => {
            rowWork++;
            return ObserverModel.activity(row);
          },
        },
        window: {
          addEventListener(name, fn) {
            winEvents[name] = fn;
          },
        },
        view: {
          create: () => ({
            update: (next) => sceneUpdates.push(next),
            focus() {},
            overview() {},
            zoomBy() {},
            start: () => lifecycle.push("start"),
            stop: () => lifecycle.push("stop"),
            invalidate: () => {
              invalidated++;
            },
          }),
        },
        query: {
          define() {},
          invalidate: (key, options) => {
            assert.equal(options && options.refresh, true, "resume invalidates and re-reads");
            refreshes.push(key);
            return Promise.resolve();
          },
          subscribe(key, fn, options) {
            if (key !== "observer.sessions") {
              inspectSubs.set(key, fn);
              return () => inspectSubs.delete(key);
            }
            assert.equal(
              JSON.stringify(options),
              JSON.stringify({ immediate: false, refresh: false }),
              "the inventory never replays its cache on subscribe",
            );
            subscribed++;
            live = fn;
            return () => {
              unsubscribed++;
              live = null;
            };
          },
        },
      });
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(refreshes.join(), "observer.sessions", "startup reads the inventory at once");
      assert.equal(lifecycle.join(), "start");
      const at = new Date().toISOString();
      const rows: AppRow[] = Array.from({ length: 6 }, (_, i) => ({
        id: "obs_" + String(i),
        paneId: "p" + String(i),
        project: "repo",
        projectId: "repo1",
        projectKind: "repository",
        provider: i % 2 ? "codex" : "claude",
        sessionId: "s" + String(i),
        status: i === 5 ? "blocked" : "working",
        title: "Task " + String(i),
        tool: { available: true, last: { name: "Bash", phase: "started", at } },
      }));
      const bus: AppBus = {
        health: "available",
        reason: null,
        observedAt: Date.now(),
        window: 100,
        messages: [
          { id: 2, from: "obs_1", to: "obs_0", sentAt: at, acknowledgedAt: null, wake: "none" },
          { id: 1, from: "obs_0", to: "obs_1", sentAt: at, acknowledgedAt: null, wake: "none" },
        ],
      };
      const settled = (data: unknown, extra: Delivery = {}) => ({
        hasData: true,
        error: null,
        pending: false,
        updatedAt: Date.now(),
        data,
        ...extra,
      });
      const fresh = (change: (value: AppSnapshot) => AppSnapshot = (value) => value) =>
        change({
          sessions: rows.map((row) => ({
            ...row,
            tool: { ...present(row.tool), last: { ...present(row.tool).last } },
          })),
          health: "available",
          observedAt: Date.now(),
          bus: { ...bus, messages: present(bus.messages).map((message) => ({ ...message })) },
        });
      const rowButton = (id: string) =>
        present(own.sessions)
          .children.flatMap((section) => sessionItems(section))
          .map((item) => item.children[0])
          .find((button) => present(button).dataset.sessionId === id);
      const first = fresh();
      notify(live, settled(first));
      assert.equal(sceneUpdates.length, 1);
      assert.equal(timers.size, 1, "one stale deadline");
      const [deadlineTimer] = timers.values();
      assert(
        present(deadlineTimer).ms > 5900 && present(deadlineTimer).ms <= 6001,
        "due at observedAt + 6s",
      );
      const button0 = rowButton("obs_0"),
        mailNode = present(own["mail-ledger"]).children[0];
      present(button0).focus();
      present(own.sessions).scrollTop = 37;
      // Pending re-notify of the same data: metadata only.
      assert(
        rowWork > 0,
        "ordinary rendering exercises real model activity before zero-work checks",
      );
      const before = { created, listenersAdded, invalidated, rowWork };
      notify(live, settled(first, { pending: true }));
      assert.equal(rowWork, before.rowWork, "a pending notification does no row work");
      assert.equal(created, before.created, "a pending notification creates no nodes");
      assert.equal(listenersAdded, before.listenersAdded);
      assert.equal(invalidated, before.invalidated);
      assert.equal(sceneUpdates.length, 1);
      // A new poll with equal content: same nodes, focus and scroll, no scene rebuild or repaint; ages refresh.
      notify(live, settled(fresh()));
      assert.equal(created, before.created, "equal content reuses every node");
      assert.equal(listenersAdded, before.listenersAdded, "and attaches no listeners");
      assert.equal(sceneUpdates.length, 1, "no scene rebuild");
      assert.equal(invalidated, before.invalidated, "no repaint for equal content");
      assert.equal(rowButton("obs_0"), button0);
      assert.equal(document.activeElement, button0);
      assert.equal(present(own.sessions).scrollTop, 37);
      assert.equal(present(own["mail-ledger"]).children[0], mailNode);
      // A changed title or tool updates text in place and repaints the floor (hover text), without a rebuild.
      notify(
        live,
        settled(
          fresh((originalData) => {
            const data = { ...originalData };
            present(data.sessions[0]).title = "Renamed task";
            present(present(present(data.sessions[0]).tool).last).phase = "finished";
            return data;
          }),
        ),
      );
      assert.equal(rowButton("obs_0"), button0, "the same row node");
      assert.equal(
        child(present(present(button0).parent), 1).textContent,
        "Renamed task",
        "the title button updates in place",
      );
      assert(child(present(button0), 2).textContent.includes("finished"));
      assert.equal(sceneUpdates.length, 1);
      assert(invalidated > before.invalidated);
      // ACK changes the ledger row in place; a status change rebuilds the scene once.
      notify(
        live,
        settled(
          fresh((originalData) => {
            const data = { ...originalData };
            present(present(present(data.bus).messages)[0]).acknowledgedAt = at;
            return data;
          }),
        ),
      );
      assert.equal(present(own["mail-ledger"]).children[0], mailNode);
      assert(child(child(present(mailNode), 0), 1).textContent.startsWith("acknowledged"));
      notify(
        live,
        settled(
          fresh((originalData) => {
            const data = { ...originalData };
            present(data.sessions[2]).status = "idle";
            return data;
          }),
        ),
      );
      assert.equal(sceneUpdates.length, 2, "a status change rebuilds the scene");
      // Removal and reorder move existing nodes: obs_5 (waiting) leads, obs_4 leaves.
      const button3 = rowButton("obs_3");
      notify(
        live,
        settled(
          fresh((originalData) => {
            const data = { ...originalData };
            data.sessions = data.sessions.filter((row) => row.id !== "obs_4");
            return data;
          }),
        ),
      );
      assert.equal(rowButton("obs_4"), undefined);
      assert.equal(rowButton("obs_3"), button3, "survivors keep their node");
      assert.equal(
        child(present(sessionItems(child(present(own.sessions), 0))[0]), 0).dataset.sessionId,
        "obs_5",
        "waiting first",
      );
      assert.equal(document.activeElement, button0, "focus survives a reorder");
      // Stale deadline: a stalled request still turns the view stale on time.
      // Hold the injected clock so rendering cannot consume the five milliseconds of freshness.
      const agingAt = Date.now();
      deadlineNow = agingAt;
      const aging = fresh((originalData) => {
        const data = { ...originalData };
        data.observedAt = agingAt - 5995;
        data.sessions = data.sessions.filter((row) => row.id !== "obs_4");
        return data;
      });
      notify(live, settled(aging));
      assert.equal(present(own.health).textContent, "Live");
      notify(live, settled(aging, { pending: true }));
      deadlineNow += 12;
      const repaint = invalidated;
      fireTimers();
      assert.equal(
        present(own.health).textContent,
        "Stale · last known inventory",
        "the deadline marks the stalled inventory stale",
      );
      assert(
        child(child(present(rowButton("obs_0")), 0), 1).textContent.startsWith("was "),
        "rows say last known",
      );
      assert(invalidated > repaint, "and the frozen floor repaints once");
      assert.equal(timers.size, 0, "no deadline is kept for a stale inventory");
      deadlineNow = undefined;
      // An error is stale at once.
      notify(live, settled(fresh()));
      notify(live, settled(fresh(), { error: { message: "offline" } }));
      assert.equal(present(own.health).textContent, "Stale · last known inventory");
      // Hidden: no subscription, deadline or view; an in-flight answer cannot rebuild.
      notify(live, settled(fresh()));
      assert.equal(timers.size, 1);
      child(present(present(rowButton("obs_1")).parent), 2).emit("click");
      assert.equal(inspectSubs.size, 1, "the inspector polls while visible");
      document.hidden = true;
      present(docEvents.visibilitychange)();
      assert.equal(unsubscribed, 1);
      assert.equal(live, null);
      assert.equal(timers.size, 0, "the deadline is cancelled");
      assert.equal(lifecycle.join(), "start,stop");
      assert.equal(inspectSubs.size, 0, "the inspector stops polling");
      assert.equal(present(own.panels).children.length, 1, "but stays open");
      assert.equal(
        present(panelPart(present(own.panels), "inspector-log")).children.length,
        0,
        "with no conversation rows",
      );
      // Visible: one immediate fresh read, view restarted; the inspector waits until a fresh inventory that proves it.
      document.hidden = false;
      present(docEvents.visibilitychange)();
      present(docEvents.visibilitychange)();
      assert.equal(subscribed, 2, "one new subscription");
      assert.equal(refreshes.length, 2, "one immediate refresh");
      assert.equal(lifecycle.join(), "start,stop,start");
      assert.equal(inspectSubs.size, 0, "no conversation poll before fresh proof");
      notify(live, settled(first, { pending: true, updatedAt: 0 }));
      assert.equal(inspectSubs.size, 0, "cached inventory proves nothing");
      notify(
        live,
        settled(
          fresh((originalData) => {
            const data = { ...originalData };
            data.observedAt = Date.now() - 7000;
            return data;
          }),
        ),
      );
      assert.equal(inspectSubs.size, 0, "a stale inventory proves nothing");
      notify(live, settled(fresh()));
      assert.equal(inspectSubs.size, 1, "the fresh inventory resumes the inspector");
      // pagehide closes both inspectors and suspends; pageshow resumes once.
      present(winEvents.pagehide)();
      assert.equal(present(own.panels).children.length, 0, "pagehide closes every panel");
      assert.equal(unsubscribed, 2);
      assert.equal(lifecycle.join(), "start,stop,start,stop");
      present(winEvents.pageshow)();
      assert.equal(subscribed, 3);
      assert.equal(refreshes.length, 3);
      // Real QuerySpine: a request in flight before hide settles after resume but cannot prove the inspector's session.
      {
        timers.clear();
        document = newDocument();
        const qOwn = Object.fromEntries(ids.map((id) => [id, element()]));
        document.replaceChildren(
          present(qOwn.filters),
          ...["all", "working", "blocked"].map((value) => {
            const node = document.createElement("button");
            node.dataset.filter = value;
            return node;
          }),
        );
        const qDoc: UiEvents = {},
          gets: {
            path: string;
            resolve(data: unknown): void;
            reject(reason?: unknown): void;
          }[] = [];
        const qDocument = bindDocument(document, qOwn, qDoc, { hidden: false });
        document = qDocument;
        const sandbox: UiScenario = {
          ...context,
          document: qDocument,
          window: { addEventListener() {} },
          view: {
            create: () => ({
              update() {},
              focus() {},
              overview() {},
              zoomBy() {},
              start() {},
              stop() {},
              invalidate() {},
            }),
          },
          api: {
            get: (path) => new Promise((resolve, reject) => gets.push({ path, resolve, reject })),
          },
        };
        const realQuery = createQuerySpine({
          getJson: (path, options) => sandbox.api.get(path, options),
          interval: () => () => {},
        });
        sandbox.queryPort = realQuery;
        mountScenario(sandbox);
        const flush = async () => {
          for (let i = 0; i < 6; i++) await new Promise((resolve) => setImmediate(resolve));
        };
        const inventory = (title = "Task") => ({
          sessions: rows.map((row) => ({ ...row, title })),
          health: "available",
          observedAt: Date.now(),
        });
        const sessionGets = () => gets.filter((entry) => entry.path === "/api/observer/sessions"),
          inspectGets = () => gets.filter((entry) => entry.path.includes("/inspect"));
        await flush();
        assert.equal(sessionGets().length, 1, "startup reads once");
        present(sessionGets()[0]).resolve(inventory());
        await flush();
        const magnifier = sessionItems(child(present(qOwn.sessions), 0))
          .map((item) => item.children[2])
          .find((button) => present(button).dataset.inspectId === "obs_1");
        present(magnifier).emit("click");
        await flush();
        assert.equal(inspectGets().length, 1, "the inspector reads while visible");
        const preHide = realQuery.refresh("observer.sessions").catch(() => {});
        await flush();
        assert.equal(sessionGets().length, 2, "a poll is in flight when the page hides");
        qDocument.hidden = true;
        present(qDoc.visibilitychange)();
        await new Promise((resolve) => setTimeout(resolve, 3));
        qDocument.hidden = false;
        present(qDoc.visibilitychange)();
        await flush();
        assert.equal(
          sessionGets().length,
          3,
          "resume issues its own new read despite the pending one",
        );
        const inspectBefore = inspectGets().length;
        present(sessionGets()[1]).resolve(inventory("old"));
        await preHide;
        await flush();
        assert.equal(
          inspectGets().length,
          inspectBefore,
          "the pre-hide response cannot resume the inspector",
        );
        assert.equal(
          child(present(sessionItems(child(present(qOwn.sessions), 0))[0]), 1).textContent,
          "Task",
          "nor replace the inventory",
        );
        present(sessionGets()[2]).resolve(inventory("new"));
        await flush();
        assert.equal(
          inspectGets().length,
          inspectBefore + 1,
          "the post-resume read proves the session and the inspector reads again",
        );
        assert.equal(
          child(present(sessionItems(child(present(qOwn.sessions), 0))[0]), 1).textContent,
          "new",
        );
        // Hidden again; the fresh inventory now shows a different session behind obs_1: it is not read.
        qDocument.hidden = true;
        present(qDoc.visibilitychange)();
        await new Promise((resolve) => setTimeout(resolve, 3));
        qDocument.hidden = false;
        present(qDoc.visibilitychange)();
        await flush();
        const replaced = inventory("swap");
        replaced.sessions = replaced.sessions.map((row) =>
          row.id === "obs_1" ? { ...row, sessionId: "different-session-after-hide" } : row,
        );
        const inspectBeforeSwap = inspectGets().length;
        present(sessionGets().at(-1)).resolve(replaced);
        await flush();
        assert.equal(
          inspectGets().length,
          inspectBeforeSwap,
          "a session replaced while hidden is withheld",
        );
        assert.match(
          present(panelPart(present(qOwn.panels), "inspector-health")).textContent,
          /different session/,
        );
        qDocument.hidden = true;
        present(qDoc.visibilitychange)();
      }
      // A tab loaded or restored in the background acquires nothing until it is shown.
      {
        timers.clear();
        document = newDocument();
        const hOwn = Object.fromEntries(ids.map((id) => [id, element()]));
        document.replaceChildren(
          present(hOwn.filters),
          ...["all", "working", "blocked"].map((value) => {
            const node = document.createElement("button");
            node.dataset.filter = value;
            return node;
          }),
        );
        const hDoc: UiEvents = {},
          hWin: UiEvents = {},
          acquired = { subscribe: 0, read: 0, start: 0 };
        const hDocument = bindDocument(document, hOwn, hDoc, { hidden: true });
        document = hDocument;
        mountScenario({
          ...context,
          document: hDocument,
          window: {
            addEventListener(name, fn) {
              hWin[name] = fn;
            },
          },
          view: {
            create: () => ({
              update() {},
              focus() {},
              overview() {},
              zoomBy() {},
              start: () => {
                acquired.start++;
              },
              stop() {},
              invalidate() {},
            }),
          },
          query: {
            define() {},
            invalidate: () => {
              acquired.read++;
              return Promise.resolve();
            },
            subscribe: () => {
              acquired.subscribe++;
              return () => {};
            },
          },
        });
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(
          JSON.stringify(acquired),
          JSON.stringify({ subscribe: 0, read: 0, start: 0 }),
          "a hidden startup subscribes, reads and starts nothing",
        );
        present(hWin.pageshow)();
        assert.equal(
          JSON.stringify(acquired),
          JSON.stringify({ subscribe: 0, read: 0, start: 0 }),
          "nor does a hidden pageshow",
        );
        assert.equal(timers.size, 0, "no deadline either");
        hDocument.hidden = false;
        present(hDoc.visibilitychange)();
        present(hWin.pageshow)();
        present(hDoc.visibilitychange)();
        assert.equal(
          JSON.stringify(acquired),
          JSON.stringify({ subscribe: 1, read: 1, start: 1 }),
          "showing it acquires exactly once",
        );
      }
      console.log(
        "observer UI: pending-only/equal snapshots keep nodes, keyed in-place updates, scene rebuild only on floor change, stale deadline, hidden/visible lifecycle and inspector proof OK",
      );
    }
    // ---------- Task 4: source-scoped freshness, helper and Desktop rows, loaded-UI inspection and platform zoom ----------
    {
      timers.clear();
      const ids = [
        "world",
        "health",
        "observed",
        "sessions",
        "empty",
        "filters",
        "overview",
        "previous-page",
        "next-page",
        "search",
        "page-label",
        "room-count",
        "counts",
        "zoom-in",
        "zoom-out",
        "mail-health",
        "mail-counts",
        "mail-ledger",
        "mail-empty",
        "mail-detail",
        "inspector",
        "inspector-log",
        "inspector-title",
        "inspector-status",
        "inspector-task",
        "inspector-meta",
        "inspector-health",
        "inspector-stats",
        "inspector-truncated",
        "inspector-window",
        "inspector-empty",
        "inspector-follow",
        "inspector-pause",
        "inspector-jump",
        "inspector-buffer",
        "inspector-close",
        "mail-inspector",
        "mail-inspector-title",
        "mail-inspector-meta",
        "mail-inspector-health",
        "mail-inspector-body",
        "mail-inspector-truncated",
        "mail-inspector-empty",
        "mail-inspector-close",
        "zoom-chip",
        "source-health",
        "panels",
        "station-totals",
        "station-stats",
        "station-stats-summary",
        "controls-help",
        "controls-help-popover",
      ];
      document = newDocument();
      const own = Object.fromEntries(ids.map((id) => [id, element()]));
      document.replaceChildren(
        present(own.filters),
        ...["all", "working", "blocked"].map((value) => {
          const node = document.createElement("button");
          node.dataset.filter = value;
          return node;
        }),
      );
      const P = (name: string) => panelPart(present(own.panels), name);
      const docEvents: UiEvents = {},
        updates: UiFrame[] = [],
        platformFocus: string[] = [],
        overviews = [],
        inspectSubs: Map<string, Deliver> = new Map();
      let created4!: UiViewOptions,
        live: Deliver | null = null;
      document = bindDocument(document, own, docEvents, { hidden: false });
      mountScenario({
        ...context,
        document,
        window: { addEventListener() {} },
        view: {
          create: (options) => {
            created4 = options;
            return {
              update: (scene, payload) => updates.push({ scene, options: payload }),
              focus() {},
              focusPlatform: (key) => platformFocus.push(key),
              overview: () => overviews.push(1),
              zoomBy() {},
              start() {},
              stop() {},
              invalidate() {},
            };
          },
        },
        query: {
          define() {},
          invalidate: () => Promise.resolve(),
          subscribe(key, fn) {
            if (key !== "observer.sessions") {
              inspectSubs.set(key, fn);
              return () => inspectSubs.delete(key);
            }
            live = fn;
            return () => {
              live = null;
            };
          },
        },
      });
      await new Promise((resolve) => setImmediate(resolve));
      const now = Date.now(),
        old = now - 20000,
        base = {
          project: "Starnet",
          projectId: "starnet",
          projectKind: "group",
          repo: "starnet",
          repoId: "starnet",
          worktree: null,
          tool: { available: false },
        };
      // Herdr failed 20s ago: its root and helpers are retained unavailable. Desktop refreshed now.
      const herdr = {
        ...base,
        id: "obs_root",
        paneId: "p1",
        provider: "codex",
        sessionId: "s1",
        status: "working",
        title: "Ship task 4",
        source: "herdr",
        presence: "pane",
        inventoryHealth: "unavailable",
        observedAt: old,
        inspectionIdentity: "codex:s1",
      };
      const ada = {
        ...base,
        id: "hlp_ada",
        paneId: null,
        provider: "codex",
        sessionId: "c1",
        status: "unknown",
        title: "Ada",
        source: "helper",
        presence: "verified-lineage",
        parentId: "obs_root",
        lineageState: "open",
        taskEvidence: null,
        inventoryHealth: "unavailable",
        observedAt: old,
        inspectionIdentity: "helper:hlp_ada",
      };
      const plain = {
        ...ada,
        id: "hlp_plain",
        sessionId: "c2",
        title: "Helper",
        parentId: "hlp_ada",
        inspectionIdentity: "helper:hlp_plain",
      };
      const app = {
        id: "dsk_1",
        paneId: null,
        provider: "chatgpt",
        title: "ChatGPT",
        projectId: "desktop",
        project: "Desktop",
        projectKind: "group",
        repoId: "app_x",
        repo: "ChatGPT",
        repoKind: "application",
        worktree: null,
        status: "unknown",
        sessionId: null,
        tool: { available: false },
        source: "desktop",
        presence: "window",
        inventoryHealth: "available",
        observedAt: now,
        inspectionIdentity: "dsk_1",
      };
      const inventory = (rows: unknown[], desktopAt = now) => ({
        sessions: rows,
        health: "available",
        observedAt: desktopAt,
        error: null,
        sources: {
          herdr: {
            health: "unavailable",
            observedAt: old,
            reason: "Local session inventory unavailable. Check that Herdr is running and on PATH.",
          },
          desktop: { health: "available", observedAt: desktopAt, reason: null },
        },
      });
      const settled = (data: unknown) => ({
        hasData: true,
        error: null,
        pending: false,
        updatedAt: Date.now(),
        data,
      });
      const terminalOnly = {
        ...inventory([herdr]),
        sources: {
          ...inventory([]).sources,
          desktop: { health: "unavailable", observedAt: null, reason: "permission-denied" },
        },
      };
      notify(live, settled(terminalOnly));
      assert.doesNotMatch(
        present(own["source-health"]).textContent,
        /Desktop apps unavailable/,
        "terminal-only use does not request desktop accessibility permission",
      );
      notify(
        live,
        settled({
          ...terminalOnly,
          sources: {
            ...terminalOnly.sources,
            desktop: { ...terminalOnly.sources.desktop, observedAt: old },
          },
        }),
      );
      assert.match(
        present(own["source-health"]).textContent,
        /Desktop apps unavailable/,
        "a previously observed desktop source still reports lost access",
      );
      notify(live, settled(inventory([herdr, ada, plain, app])));
      const scene4 = present(updates.at(-1)).scene,
        options4 = present(updates.at(-1)).options,
        workerOf = (id: string) => scene4.workers.find((worker) => worker.id === id);
      assert.equal(
        present(own.health).textContent,
        "Live",
        "connection status stays compact; individual source warnings remain below",
      );
      assert.equal(present(own["source-health"]).hidden, false);
      assert(present(own["source-health"]).textContent.includes("Herdr panes unavailable"));
      assert.equal(present(options4.stale)(), false, "the inventory as a whole is live");
      assert.equal(
        present(options4.rowStale)(present(workerOf("obs_root"))),
        true,
        "a fresh Desktop never blesses a stale Herdr row",
      );
      assert.equal(present(options4.rowStale)(present(workerOf("dsk_1"))), false);
      assert.equal(
        present(own.counts).textContent,
        "0 working · 0 waiting · 4 total · 3 last known",
        "working counts only live rows",
      );
      // Names: root and app seats, helper nickname or exact parent, never a number computed from an absent seat.
      const groups = present(own.sessions).children,
        textAll = (node: AppFixtureNode): string =>
          node.children.length > 0 ? node.children.map(textAll).join(" ") : node.textContent;
      assert(!groups.map(textAll).join(" ").includes("NaN"), "no NaN reaches the list");
      const starnet = groups.find(
          (section) => child(child(section, 0), 1).textContent === "Starnet",
        ),
        desktop = groups.find((section) => child(child(section, 0), 1).textContent === "Desktop");
      const listed = sessionItems(present(starnet)).map((item) => [
        child(item, 0).dataset.sessionId,
        item.className,
        child(child(child(item, 0), 0), 0).textContent,
      ]);
      assert.deepEqual(
        listed,
        [
          ["obs_root", "session-item", "Codex · 1"],
          ["hlp_ada", "session-item helper", "Codex · helper · Ada"],
          ["hlp_plain", "session-item helper", "Helper of Codex · helper · Ada"],
        ],
        "helpers are listed under their exact parent",
      );
      assert.equal(
        child(child(child(present(sessionItems(present(starnet))[2]), 0), 0), 0).title,
        "Helper of Codex · helper · Ada",
        "a long name cut to one line stays readable in full",
      );
      assert.equal(
        child(child(present(starnet), 0), 3).textContent,
        "1 +2 helpers",
        "helpers are counted apart from their parent",
      );
      assert.equal(child(child(present(desktop), 0), 2).textContent, "APPS");
      assert.equal(
        child(child(child(present(sessionItems(present(desktop))[0]), 0), 0), 0).textContent,
        "ChatGPT app · 1",
      );
      const rootRow = present(sessionItems(present(starnet))[0]).children[0],
        appRow = present(sessionItems(present(desktop))[0]).children[0];
      assert(
        child(child(present(rootRow), 0), 1).textContent.startsWith("was "),
        "the stale Herdr row says it was last observed",
      );
      assert(!child(child(present(appRow), 0), 1).textContent.startsWith("was "));
      assert.equal(
        child(present(present(rootRow).children.at(-1)), 3).textContent,
        "observed 20s ago",
        "its age is its own observation, not the Desktop refresh",
      );
      assert.equal(
        child(present(sessionItems(present(starnet))[1]), 1).textContent,
        "Task unavailable",
        "a helper with no task evidence says so",
      );
      // Inspection eligibility is per row: the unavailable Herdr row is withheld without a read.
      child(present(sessionItems(present(starnet))[0]), 1).emit("click");
      assert.equal(inspectSubs.size, 0);
      assert.equal(
        present(P("inspector-health")).textContent,
        ObserverInspector.REASONS["inventory-unavailable"],
      );
      // The Desktop row reads a window snapshot: labelled loaded UI text, provenance, replace-only, no Follow/Pause.
      const inspectApp = present(sessionItems(present(desktop))[0]).children[1];
      present(inspectApp).emit("click");
      assert.equal(inspectSubs.size, 1);
      const feed = inspectSubs.get("observer.inspect.dsk_1");
      present(P("inspector-pause")).emit("click");
      const window4 = (generation: string, texts: string[], extra = {}) => ({
        hasData: true,
        error: null,
        data: {
          id: "dsk_1",
          inspectionIdentity: "dsk_1",
          health: "available",
          asOf: new Date().toISOString(),
          reason: null,
          stats: {},
          turns: texts.map((text, index) => ({
            id: generation + ":" + String(index),
            role: "unknown",
            at: null,
            text,
            textTruncated: false,
          })),
          truncated: false,
          window: { maxTurns: 200, maxTextChars: 8000 },
          generation,
          provenance: {
            kind: "loaded-ui",
            coverage: "partial-loaded-ui",
            identity: "window-snapshot",
          },
          ...extra,
        },
      });
      present(feed)(window4("g1", ["first <b>text</b>", "second"]));
      assert.equal(
        present(P("inspector-log")).children.length,
        2,
        "Pause never holds a window snapshot back",
      );
      assert.equal(
        child(child(child(present(P("inspector-log")), 0), 0), 0).textContent,
        "LOADED UI TEXT",
      );
      assert.equal(
        child(child(present(P("inspector-log")), 0), 1).textContent,
        "first <b>text</b>",
      );
      assert.equal(child(present(P("inspector-log")), 0).className, "turn turn-unknown");
      assert.equal(
        present(P("inspector-provenance")).textContent,
        "Loaded UI · partial · this window snapshot only, not conversation history",
      );
      assert.equal(present(P("inspector-follow")).disabled, true);
      assert.equal(present(P("inspector-pause")).disabled, true);
      assert.equal(present(P("inspector-pause")).attributes.get("aria-pressed"), "false");
      present(feed)(window4("g2", ["replacement"]));
      assert.deepEqual(
        present(P("inspector-log")).children.map((item) => child(item, 1).textContent),
        ["replacement"],
        "a new snapshot replaces the old one whole",
      );
      present(feed)({ hasData: true, error: { message: "offline" }, data: null });
      assert.equal(
        present(P("inspector-log")).children.length,
        0,
        "an unrefreshed window snapshot is withdrawn",
      );
      assert.equal(present(P("inspector-provenance")).textContent, "");
      present(feed)(window4("g3", ["again"]));
      // A different window behind the same row withdraws the text at once, before any new read settles.
      notify(
        live,
        settled(inventory([herdr, ada, plain, { ...app, inspectionIdentity: "dsk_other" }])),
      );
      assert.equal(
        present(P("inspector-log")).children.length,
        0,
        "an identity change withdraws loaded text immediately",
      );
      // Platform zoom: a double-click clears worker selection; the chip and Escape leave it; the heading button is the keyboard path.
      present(rootRow).emit("click");
      assert.equal(present(rootRow).attributes.get("aria-pressed"), "true");
      present(created4.onPlatform)(present(scene4.platforms[0]).key);
      assert.equal(
        present(rootRow).attributes.get("aria-pressed"),
        "false",
        "platform zoom never keeps a worker selected",
      );
      present(created4.onMode)({ mode: "platform", platform: present(scene4.platforms[0]).key });
      assert.equal(present(own["zoom-chip"]).hidden, false);
      assert.equal(
        present(own["zoom-chip"]).textContent,
        "Zoomed · " + present(scene4.platforms[0]).name + " ✕",
      );
      // Two panels are stacked (the withheld Herdr row, then the Desktop window): Escape closes them top first.
      assert.equal(present(own.panels).children.length, 2);
      present(docEvents.keydown)({ key: "Escape", preventDefault() {} });
      present(docEvents.keydown)({ key: "Escape", preventDefault() {} });
      assert.equal(overviews.length, 0, "Escape closes the open panels first");
      assert.equal(present(own.panels).children.length, 0);
      present(docEvents.keydown)({ key: "Escape", preventDefault() {} });
      assert.equal(overviews.length, 1, "then leaves the platform zoom");
      present(created4.onMode)({ mode: "overview", platform: null });
      assert.equal(present(own["zoom-chip"]).hidden, true);
      const zoomButton = child(present(starnet), 0).children[4];
      assert.equal(
        present(zoomButton).attributes.get("aria-label"),
        "Zoom to the Starnet platform",
      );
      present(zoomButton).emit("click");
      assert.deepEqual(
        platformFocus,
        [
          present(
            present(updates.at(-1)).scene.platforms.find((value) => value.projectId === "starnet"),
          ).key,
        ],
        "the heading button fits that project platform",
      );
      // An available row whose own observation expired is withheld even during another source stays live.
      const liveHerdr = { ...herdr, inventoryHealth: "available", observedAt: Date.now() };
      const mixed = (appAt: number) => ({
        sessions: [liveHerdr, { ...app, observedAt: appAt }],
        health: "available",
        observedAt: Date.now(),
        error: null,
        sources: {
          herdr: { health: "available", observedAt: Date.now(), reason: null },
          desktop: { health: "available", observedAt: appAt, reason: null },
        },
      });
      notify(live, settled(mixed(Date.now())));
      child(
        present(
          sessionItems(
            present(
              present(own.sessions).children.find(
                (section) => child(child(section, 0), 1).textContent === "Desktop",
              ),
            ),
          )[0],
        ),
        2,
      ).emit("click");
      present(inspectSubs.get("observer.inspect.dsk_1"))(window4("g5", ["visible excerpt"]));
      assert.equal(present(P("inspector-log")).children.length, 1);
      notify(live, settled(mixed(Date.now() - 7000)));
      assert.equal(
        present(P("inspector-log")).children.length,
        0,
        "an expired Desktop row is withheld while Herdr stays live",
      );
      assert.equal(inspectSubs.size, 0, "and its reads stop");
      assert.equal(
        present(P("inspector-health")).textContent,
        ObserverInspector.REASONS["inventory-unavailable"],
      );
      assert.equal(present(own.health).textContent, "Live");
      console.log(
        "observer UI: per-source/row freshness, helper and Desktop naming/order/counts, row-scoped inspection, loaded-UI snapshots, withdrawal and platform zoom OK",
      );
    }
    // Formation evidence must reach real movement through a fresh controller poll, even with unchanged own status.
    return runScenarios([
      // Formation evidence must reach real movement through a fresh controller poll, even with unchanged own status.
      async () => {
        const RealView = createViewFactory(defaults, ThemePack);
        const canvas = () => Object.assign(new AppFixtureCanvas(), { __id: "ui-canvas" });
        for (const transition of [
          { status: "unknown", patch: { lifecycleEvidence: { state: "closed" } }, closed: true },
          { status: "working", patch: { lineageState: "closed" }, closed: true },
          { status: "unknown", patch: { lineageState: "unverified" }, closed: false },
        ] as const) {
          timers.clear();
          document = newDocument();
          const own = Object.fromEntries(Object.keys(elements).map((id) => [id, element()]));
          document.canvas.clientHeight = 500;
          document.canvas.height = 500;
          document.replaceChildren(
            present(own.filters),
            ...["all", "working", "blocked"].map((value) => {
              const node = document.createElement("button");
              node.dataset.filter = value;
              return node;
            }),
          );
          document = bindDocument(document, own, undefined, { hidden: false });
          let live!: Deliver | null,
            floor!: Scene,
            floorOptions!: UpdateOptions,
            realView!: ReturnType<ReturnType<typeof createViewFactory>["create"]>,
            now = 0,
            updateCount = 0,
            observedAt = 10000;
          const bodies = new Map<string | undefined, SpriteBody<Resource>>(),
            poses = new Map<
              string | undefined,
              {
                state: string | undefined;
                x: number;
                y: number;
              }
            >();
          mountScenario({
            ...context,
            document,
            now: () => observedAt,
            view: {
              create(options) {
                realView = RealView.create({
                  ...options,
                  env: {
                    now: () => now,
                    raf: () => 1,
                    caf() {},
                    dpr: () => 1,
                    createCanvas: canvas,
                    sprites: {
                      drawBody(_ctx, body) {
                        bodies.set(body.id, body);
                        poses.set(body.id, { state: body.state, x: body.px, y: body.py });
                        return null;
                      },
                    },
                  },
                });
                const update = realView.update;
                return {
                  ...realView,
                  update(next, payload) {
                    floor = next;
                    floorOptions = payload;
                    updateCount++;
                    update(next, payload);
                  },
                };
              },
            },
            query: {
              define() {},
              invalidate: () => Promise.resolve(),
              subscribe(key, fn) {
                if (key === "observer.sessions") live = fn;
                return () => {};
              },
            },
          });
          await new Promise((resolve) => setImmediate(resolve));
          const root = {
            id: "leader",
            provider: "codex",
            project: "repo",
            projectId: "repo1",
            projectKind: "repository",
            status: "idle",
          };
          const helper = {
            id: "follower-0",
            provider: "codex",
            source: "helper",
            parentId: root.id,
            status: transition.status,
            lineageState: "open",
            lifecycleEvidence: { state: "open" },
          };
          const inventory = (
            patch: Partial<AppRow> & {
              tokens?: {
                total: number;
              };
            },
          ) => ({
            data: {
              health: "available",
              observedAt: ++observedAt,
              sessions: [
                { ...root, observedAt },
                { ...helper, ...patch, observedAt },
              ],
            },
          });
          const paintUntil = (end: number) => {
            let walks = 0;
            for (now += 100; now <= end; now += 100) {
              realView.paint(now);
              if (present(poses.get(helper.id)).state === "walk") walks++;
            }
            now = end;
            return walks;
          };
          notify(live, inventory({}));
          realView.zoomBy(1.2);
          realView.paint(now);
          const revision = floor.revision,
            camera = realView.camera(),
            cacheBuilds = realView.cacheBuilds(),
            body = bodies.get(helper.id);
          const walked = paintUntil(60000);
          if (helper.status === "unknown")
            assert(walked > 0, "the open helper follows its idle parent before withdrawal");
          const ordinary = inventory({
            title: "new title",
            task: { text: "new task" },
            tokens: { total: 123 },
          });
          const beforeMetadata = updateCount;
          notify(live, ordinary);
          notify(live, ordinary);
          assert.equal(
            updateCount,
            beforeMetadata,
            "task/token/time-only polls and repeated snapshots retain the scene cache",
          );
          notify(live, inventory(transition.patch));
          realView.paint(now);
          assert.equal(
            present(floor.workers.find((worker) => worker.id === helper.id)).row.status,
            helper.status,
            "withdrawal never rewrites own task status",
          );
          if (transition.closed) {
            const current = inventory(transition.patch);
            notify(live, {
              ...current,
              data: { ...current.data, sessions: current.data.sessions.slice(0, 1) },
            });
            assert(
              floor.workers.some((worker) => worker.id === helper.id),
              "validated return survives a missing raw row",
            );
            assert(
              paintUntil(90000) > 0,
              "fresh closure routes the displayed helper back to quarters",
            );
            const quarters = ObserverScene.project(
              present(
                floor.platforms.find(
                  (platform) =>
                    platform.key ===
                    present(floor.workers.find((worker) => worker.id === helper.id)).platformKey,
                ),
              ).quarters.entry,
            );
            assert(
              Math.hypot(
                present(poses.get(helper.id)).x - quarters.x,
                present(poses.get(helper.id)).y - quarters.y,
              ) < 0.001,
            );
            assert.equal(
              present(own.counts).textContent,
              (transition.status === "working" ? "1" : "0") + " working · 0 waiting · 2 total",
              "return remains counted until settlement",
            );
            assert.equal(
              present(body).working,
              false,
              "closure withdraws the active work pose without rewriting own status",
            );
          } else {
            paintUntil(120000);
            const chair = ObserverScene.project(
              present(floor.workers.find((worker) => worker.id === helper.id)).chair,
            );
            assert(
              Math.hypot(
                present(poses.get(helper.id)).x - chair.x,
                present(poses.get(helper.id)).y - chair.y,
              ) < 0.001,
              "verification-only withdrawal returns the helper to its own station",
            );
            assert.equal(
              paintUntil(130000),
              0,
              "withdrawn verification cannot retain the old formation",
            );
          }
          assert.equal(
            floor.revision,
            revision,
            "formation evidence never changes geometry revision",
          );
          assert.deepEqual(realView.camera(), camera, "fresh evidence keeps the chosen camera");
          assert.equal(
            realView.cacheBuilds(),
            cacheBuilds,
            "formation evidence never rebuilds the static layer",
          );
          assert.equal(
            bodies.get(helper.id),
            body,
            "fresh evidence preserves sprite body identity",
          );
          const beforeRepeat = updateCount;
          notify(live, inventory(transition.patch));
          assert.equal(
            updateCount,
            beforeRepeat,
            "unchanged formation evidence retains the normal scene cache",
          );
          if (transition.closed) {
            if (transition.status === "working") {
              realView.stop();
              await Promise.resolve();
              assert(
                floor.workers.some((worker) => worker.id === helper.id),
                "view stop invalidates queued settlement",
              );
              realView.update(floor, floorOptions);
              realView.start();
              realView.paint(now);
            }
            await Promise.resolve();
            assert(!floor.workers.some((worker) => worker.id === helper.id));
            assert.equal(sessionItems(present(own.sessions)).length, 1);
            assert.equal(present(own.counts).textContent, "0 working · 0 waiting · 1 total");
          }
          realView.stop();
        }
        console.log(
          "observer UI: lifecycle/verification-only fresh polls reach real movement; own status, geometry, camera, static cache and bodies preserved OK",
        );
      },

      // ---------- Task 5: one exact-target panel stack ----------
      async () => {
        timers.clear();
        const ids = [
          "world",
          "health",
          "observed",
          "sessions",
          "empty",
          "filters",
          "overview",
          "previous-page",
          "next-page",
          "search",
          "page-label",
          "room-count",
          "counts",
          "zoom-in",
          "zoom-out",
          "mail-health",
          "mail-counts",
          "mail-ledger",
          "mail-empty",
          "mail-detail",
          "zoom-chip",
          "source-health",
          "panels",
          "station-totals",
          "station-stats",
          "station-stats-summary",
          "controls-help",
          "controls-help-popover",
        ];
        document = newDocument();
        const own = Object.fromEntries(ids.map((id) => [id, element()]));
        document.replaceChildren(
          present(own.filters),
          ...["all", "working", "blocked"].map((value) => {
            const node = document.createElement("button");
            node.dataset.filter = value;
            return node;
          }),
        );
        const narrow = new AppFixtureMedia();
        const docEvents: UiEvents = {},
          subs: Map<string, Deliver> = new Map(),
          mailReads: {
            path: string;
            resolve(data: unknown): void;
            reject(reason?: unknown): void;
          }[] = [];
        let view5!: UiViewOptions,
          live: Deliver | null = null;
        document = bindDocument(document, own, docEvents, { hidden: false });
        mountScenario({
          ...context,
          document,
          window: { addEventListener() {}, matchMedia: () => narrow },
          api: {
            get: (path) =>
              new Promise((resolve, reject) => mailReads.push({ path, resolve, reject })),
          },
          view: {
            create: (options) => {
              view5 = options;
              return {
                update() {},
                focus() {},
                focusPlatform() {},
                overview() {},
                zoomBy() {},
                start() {},
                stop() {},
                invalidate() {},
              };
            },
          },
          query: {
            define() {},
            invalidate: () => Promise.resolve(),
            subscribe(key, fn) {
              if (key !== "observer.sessions") {
                subs.set(key, fn);
                return () => subs.delete(key);
              }
              live = fn;
              return () => {
                live = null;
              };
            },
          },
        });
        await new Promise((resolve) => setImmediate(resolve));
        const flushQueued = () => {
          document.flushCloseEvents();
        };
        const MAIL = "mail_" + "c".repeat(64);
        const rows: AppRow[] = Array.from({ length: 10 }, (_, i) => ({
          id: "obs_" + String(i),
          paneId: "p" + String(i),
          project: "repo",
          projectId: "repo1",
          projectKind: "repository",
          provider: "codex",
          sessionId: "s" + String(i),
          status: "working",
          title: "Task " + String(i),
          tool: { available: false },
          source: "herdr",
          inventoryHealth: "available",
          inspectionIdentity: "codex:s" + String(i),
        }));
        const bus = (extra = {}): AppBus => ({
          health: "available",
          reason: null,
          observedAt: Date.now() - 60000,
          window: 100,
          messages: [
            {
              id: 5,
              from: "obs_1",
              to: "obs_0",
              sentAt: new Date().toISOString(),
              acknowledgedAt: null,
              wake: "none",
              identity: MAIL,
            },
          ],
          ...extra,
        });
        const inventory = (change: (data: AppSnapshot) => AppSnapshot = (data) => data) =>
          change({
            sessions: rows.map((row) => ({ ...row, observedAt: Date.now() })),
            health: "available",
            observedAt: Date.now(),
            bus: bus(),
          });
        const settled = (data: unknown, extra: Delivery = {}) => ({
          hasData: true,
          error: null,
          pending: false,
          updatedAt: Date.now(),
          data,
          ...extra,
        });
        notify(live, settled(inventory()));
        const item = (id: string) =>
          present(own.sessions)
            .children.flatMap((section) => sessionItems(section))
            .find((node) => child(node, 0).dataset.sessionId === id);
        const titleButton = (id: string) => present(item(id)).children[1],
          magnifier = (id: string) => present(item(id)).children[2];
        const roots = () => present(own.panels).children,
          top = () => roots().at(-1),
          partOf = (root: AppFixtureNode, name: string) => findPart(root, name);
        const turnsOf = (root: AppFixtureNode) =>
          present(partOf(root, "inspector-log")).children.map((node) => node.dataset.turnId);
        const snapshot = (id: string, turns: string[], extra = {}) => ({
          hasData: true,
          error: null,
          data: {
            id,
            inspectionIdentity: "codex:s" + id.slice(4),
            health: "available",
            asOf: new Date().toISOString(),
            reason: null,
            stats: {},
            generation: "g1",
            truncated: false,
            window: { maxTurns: 200 },
            turns: turns.map((turn) => ({
              id: turn,
              role: "user",
              at: null,
              text: turn,
              textTruncated: false,
            })),
            ...extra,
          },
        });
        // A then B: B on top and polling; A covered, hidden, inert and not polling, with its rows, Pause and scroll kept.
        present(magnifier("obs_1")).emit("click");
        present(subs.get("observer.inspect.obs_1"))(snapshot("obs_1", ["a1", "a2"]));
        const panelA = top();
        present(partOf(present(panelA), "inspector-pause")).emit("click");
        present(partOf(present(panelA), "inspector-log")).scrollTop = 33;
        const rowsA = present(partOf(present(panelA), "inspector-log")).children.slice();
        present(titleButton("obs_2")).emit("click");
        const panelB = top();
        assert.equal(roots().length, 2);
        assert.notEqual(panelA, panelB);
        assert.deepEqual([...subs.keys()], ["observer.inspect.obs_2"], "only the top panel polls");
        assert.equal(present(panelA).open, false);
        assert.equal(present(panelA).inert, true);
        assert.equal(present(panelA).attributes.get("aria-hidden"), "true");
        assert.equal(present(panelB).open, true);
        assert.equal(
          document.activeElement,
          partOf(present(panelB), "inspector-title"),
          "focus moves to the new top",
        );
        assert.equal(present(titleButton("obs_2")).attributes.get("aria-expanded"), "true");
        assert.equal(
          present(magnifier("obs_2")).attributes.get("aria-expanded"),
          "true",
          "title and magnifier report the same panel",
        );
        assert.equal(
          present(magnifier("obs_1")).attributes.get("aria-expanded"),
          "true",
          "a covered panel is still open",
        );
        assert.equal(
          present(partOf(present(panelB), "inspector-stack")).textContent,
          "Stack 2 · closing shows the previous panel",
        );
        const ids2 = new Set();
        const collect = (node: AppFixtureNode): void => {
          if (node.id) {
            assert(!ids2.has(node.id), "duplicate id " + node.id);
            ids2.add(node.id);
          }
          node.children.forEach(collect);
        };
        roots().forEach(collect);
        present(subs.get("observer.inspect.obs_2"))(snapshot("obs_2", ["b1"]));
        // Closing the top reveals A with its own state and resumes its read; nothing from B leaks into A.
        present(docEvents.keydown)({ key: "Escape", preventDefault() {} });
        assert.deepEqual(roots(), [panelA]);
        assert.equal(present(panelA).open, true);
        assert.equal(present(panelA).inert, false);
        assert.deepEqual(
          present(partOf(present(panelA), "inspector-log")).children,
          rowsA,
          "the revealed panel keeps its own rows",
        );
        assert.equal(present(partOf(present(panelA), "inspector-log")).scrollTop, 33);
        assert.equal(
          present(partOf(present(panelA), "inspector-pause")).attributes.get("aria-pressed"),
          "true",
          "and its own Pause",
        );
        assert.deepEqual([...subs.keys()], ["observer.inspect.obs_1"], "and reads again");
        assert.equal(
          document.activeElement,
          partOf(present(panelA), "inspector-title"),
          "focus moves to the revealed panel",
        );
        present(subs.get("observer.inspect.obs_1"))(snapshot("obs_1", ["a1", "a2", "a3"]));
        assert.deepEqual(
          turnsOf(present(panelA)),
          ["a1", "a2"],
          "Pause still holds the newer snapshot",
        );
        // A lower entry closes in place: the top and its focus stay.
        present(titleButton("obs_3")).emit("click");
        const panelC = top();
        present(partOf(present(panelC), "inspector-follow")).focus();
        const focusC = document.activeElement;
        present(magnifier("obs_1")).emit("click");
        assert.deepEqual(roots(), [panelC], "toggling the lower entry closes exactly that entry");
        assert.equal(document.activeElement, focusC, "and never moves focus");
        assert.deepEqual([...subs.keys()], ["observer.inspect.obs_3"]);
        present(titleButton("obs_3")).emit("click");
        assert.equal(roots().length, 0, "the same title toggles its open panel closed");
        assert.equal(
          document.activeElement,
          titleButton("obs_3"),
          "an empty stack returns focus to the trigger",
        );
        // Cap: the ninth open disposes the oldest entry; only the newest polls.
        for (let i = 0; i < 9; i++) present(titleButton("obs_" + String(i))).emit("click");
        assert.equal(roots().length, 8);
        assert.equal(
          present(magnifier("obs_0")).attributes.get("aria-expanded"),
          "false",
          "the oldest entry was disposed",
        );
        assert.deepEqual([...subs.keys()], ["observer.inspect.obs_8"]);
        assert.equal(document.activeElement, partOf(present(top()), "inspector-title"));
        // Covered entries are reconciled: a stale or lost row withdraws its kept rows during covered.
        const covered = roots().find(
          (root) => present(partOf(root, "inspector-title")).textContent === "Codex · 6",
        );
        // Reveal it once so it holds rows, then cover it again.
        while (top() !== covered)
          present(docEvents.keydown)({ key: "Escape", preventDefault() {} });
        present(subs.get("observer.inspect.obs_5"))(snapshot("obs_5", ["k1"]));
        assert.deepEqual(turnsOf(present(covered)), ["k1"]);
        present(titleButton("obs_9")).emit("click");
        assert.equal(present(covered).open, false);
        notify(
          live,
          settled(
            inventory((originalData) => {
              const data = { ...originalData };
              data.sessions = data.sessions.map((row) =>
                row.id === "obs_5" ? { ...row, inventoryHealth: "unavailable" } : row,
              );
              return data;
            }),
          ),
        );
        assert.deepEqual(
          turnsOf(present(covered)),
          [],
          "a covered panel is withdrawn when its row goes stale",
        );
        assert.equal(subs.has("observer.inspect.obs_5"), false, "and is still not read");
        notify(live, settled(inventory()));
        present(docEvents.keydown)({ key: "Escape", preventDefault() {} });
        assert.equal(top(), covered);
        assert(
          subs.has("observer.inspect.obs_5"),
          "a revealed panel whose row recovered reads again",
        );
        assert.deepEqual(turnsOf(present(covered)), [], "with no stale rows shown");
        // Hidden: every panel suspends; after fresh proof only the top reads again.
        present(titleButton("obs_9")).emit("click");
        document.hidden = true;
        present(docEvents.visibilitychange)();
        assert.equal(subs.size, 0, "no panel polls while hidden");
        document.hidden = false;
        present(docEvents.visibilitychange)();
        assert.equal(subs.size, 0, "nor before a fresh inventory proves them");
        notify(live, settled(inventory()));
        assert.deepEqual(
          [...subs.keys()],
          ["observer.inspect.obs_9"],
          "then only the top panel reads",
        );
        while (roots().length > 0)
          present(docEvents.keydown)({ key: "Escape", preventDefault() {} });
        // Canvas titles use the same toggle: one call opens, the next closes.
        present(view5.onTitleToggle)("obs_4");
        assert.equal(roots().length, 1);
        assert(subs.has("observer.inspect.obs_4"));
        present(view5.onTitleToggle)("obs_4");
        assert.equal(roots().length, 0, "the canvas title closes its own panel");
        // Narrow screens: only the top is a modal; a drawer/modal swap survives the queued native close event.
        present(titleButton("obs_1")).emit("click");
        present(titleButton("obs_2")).emit("click");
        narrow.matches = true;
        narrow.added.forEach(({ listener }) => {
          listener({ preventDefault() {} });
        });
        flushQueued();
        assert.equal(
          roots().length,
          2,
          "the swap never closes the top through its queued close event",
        );
        assert.equal(present(top()).mode, "modal");
        assert.equal(present(top()).open, true);
        assert.equal(present(roots()[0]).open, false);
        present(docEvents.keydown)({ key: "Escape", preventDefault() {} });
        flushQueued();
        assert.equal(roots().length, 1, "Escape closes only the top");
        assert.equal(present(top()).mode, "modal", "the revealed panel becomes the modal");
        assert.equal(present(top()).open, true);
        // A native modal cancel goes through the stack, once.
        let prevented = false;
        present(top()).emit("cancel", {
          preventDefault() {
            prevented = true;
          },
        });
        flushQueued();
        assert(prevented);
        assert.equal(roots().length, 0);
        narrow.matches = false;
        narrow.added.forEach(({ listener }) => {
          listener({ preventDefault() {} });
        });
        // A close the stack did not start (the dialog closed some other way) still removes that top entry.
        present(titleButton("obs_1")).emit("click");
        present(top()).open = false;
        present(top()).emit("close");
        assert.equal(roots().length, 0);
        // A helper panel belongs to its exact parent too: reparenting locks it; losing the parent withholds it.
        const helperRow = {
          ...rows[0],
          id: "hlp_x",
          source: "helper",
          parentId: "obs_0",
          sessionId: "h1",
          inspectionIdentity: "helper:hlp_x",
          paneId: null,
          title: "Ada",
        };
        const withHelper = (parentId: string, drop: string | null = null) =>
          inventory((originalData) => {
            const data = { ...originalData };
            data.sessions = data.sessions.filter((row) => row.id !== drop);
            data.sessions.push({ ...helperRow, parentId, observedAt: Date.now() });
            return data;
          });
        notify(live, settled(withHelper("obs_0")));
        present(titleButton("obs_0")).emit("click");
        const parentPanel = top(),
          helperList = partOf(present(parentPanel), "inspector-helpers-list");
        assert.equal(present(partOf(present(parentPanel), "inspector-helpers")).hidden, false);
        assert.equal(
          present(partOf(present(parentPanel), "inspector-helpers-title")).textContent,
          "Verified helpers · 1",
        );
        const helperButton = child(present(helperList), 0).children[0];
        assert.match(present(helperButton).textContent, /Ada/);
        assert.equal(subs.size, 1, "listing helpers does not start their inspectors");
        notify(live, settled(withHelper("obs_0")));
        assert.equal(
          child(present(helperList), 0).children[0],
          helperButton,
          "unchanged roster retains the helper control",
        );
        present(helperButton).emit("click");
        assert.equal(roots().length, 2, "a helper opens above its parent");
        assert(subs.has("observer.inspect.hlp_x"));
        assert.equal(subs.size, 1, "only the top inspector polls");
        present(docEvents.keydown)({ key: "Escape", preventDefault() {} });
        assert.equal(top(), parentPanel);
        assert(subs.has("observer.inspect.obs_0"), "closing a helper restores its parent");
        notify(live, settled(withHelper("obs_1")));
        assert.equal(
          present(partOf(present(parentPanel), "inspector-helpers")).hidden,
          true,
          "reparenting removes the old parent list",
        );
        const beforeObsoleteClick = roots().length;
        present(helperButton).emit("click");
        assert.equal(
          roots().length,
          beforeObsoleteClick,
          "obsolete helper controls cannot inspect a new parent binding",
        );
        present(docEvents.keydown)({ key: "Escape", preventDefault() {} });
        notify(live, settled(withHelper("obs_0")));
        present(titleButton("hlp_x")).emit("click");
        assert(subs.has("observer.inspect.hlp_x"));
        notify(live, settled(withHelper("obs_1")));
        assert.equal(
          subs.has("observer.inspect.hlp_x"),
          false,
          "a reparented helper is not read by its old panel",
        );
        assert.match(
          present(partOf(present(top()), "inspector-health")).textContent,
          /different session/,
        );
        present(titleButton("hlp_x")).emit("click");
        assert.equal(roots().length, 1, "opening it again replaces the obsolete panel");
        assert(subs.has("observer.inspect.hlp_x"));
        notify(live, settled(withHelper("obs_1", "obs_1")));
        assert.equal(
          subs.has("observer.inspect.hlp_x"),
          false,
          "a helper whose parent left is withheld",
        );
        assert.equal(
          present(partOf(present(top()), "inspector-health")).textContent,
          ObserverInspector.REASONS["inventory-unavailable"],
        );
        present(docEvents.keydown)({ key: "Escape", preventDefault() {} });
        notify(live, settled(inventory()));
        // Mail is proved by the current transport: an old unchanged copy time and down agent sources still allow reading.
        const ledgerRead = () => child(present(own["mail-ledger"]), 0).children[1];
        notify(
          live,
          settled(
            inventory((originalData) => {
              const data = { ...originalData };
              data.health = "unavailable";
              data.sessions = data.sessions.map((row) => ({
                ...row,
                inventoryHealth: "unavailable",
              }));
              return data;
            }),
          ),
        );
        present(ledgerRead()).emit("click");
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(mailReads.length, 1);
        assert.equal(
          present(mailReads[0]).path,
          "/api/observer/messages/5/inspect?identity=" + MAIL,
        );
        present(mailReads[0]).resolve({
          id: 5,
          identity: MAIL,
          health: "available",
          reason: null,
          asOf: new Date().toISOString(),
          text: "hello",
          truncated: false,
          window: { maxTextChars: 32768 },
        });
        await new Promise((resolve) => setImmediate(resolve));
        const mailBody = () => partOf(present(top()), "mail-inspector-body");
        assert.equal(
          present(mailBody()).textContent,
          "hello",
          "old bus copy time and unavailable agent sources do not withhold live mail",
        );
        notify(live, settled(inventory()));
        assert.equal(present(mailBody()).textContent, "hello");
        // Covering and revealing mail never reads again.
        present(titleButton("obs_2")).emit("click");
        present(docEvents.keydown)({ key: "Escape", preventDefault() {} });
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(mailReads.length, 1, "a revealed mail panel is not read again");
        assert.equal(present(mailBody()).textContent, "hello");
        // The proof expires with the transport: an errored request withdraws the body permanently.
        notify(live, settled(inventory(), { error: { message: "offline" } }));
        assert.equal(
          present(mailBody()).textContent,
          "",
          "a failed transport withdraws the mail body",
        );
        notify(live, settled(inventory()));
        assert.equal(present(mailBody()).textContent, "", "and it never comes back by itself");
        present(docEvents.keydown)({ key: "Escape", preventDefault() {} });
        // Same cached object: QuerySpine keeps one data object across a failed request. With agents already unavailable
        // nothing else changes, yet the transport failure must still withdraw a loaded body, and cancel a pending one.
        for (const phase of ["loaded", "pending"]) {
          const cached = inventory((originalData) => {
            const data = { ...originalData };
            data.health = "unavailable";
            data.sessions = data.sessions.map((row) => ({
              ...row,
              inventoryHealth: "unavailable",
            }));
            return data;
          });
          notify(live, settled(cached));
          present(ledgerRead()).emit("click");
          await new Promise((resolve) => setImmediate(resolve));
          const request = mailReads.at(-1);
          const body = {
            id: 5,
            identity: MAIL,
            health: "available",
            reason: null,
            asOf: new Date().toISOString(),
            text: "kept " + phase,
            truncated: false,
            window: { maxTextChars: 32768 },
          };
          if (phase === "loaded") {
            present(request).resolve(body);
            await new Promise((resolve) => setImmediate(resolve));
            assert.equal(present(mailBody()).textContent, "kept loaded");
          }
          const nodes = created;
          notify(live, settled(cached, { pending: true }));
          assert.equal(
            created,
            nodes,
            "a successful pending re-notify of the same object recreates nothing",
          );
          if (phase === "loaded")
            assert.equal(
              present(mailBody()).textContent,
              "kept loaded",
              "and keeps the eligible body",
            );
          notify(live, settled(cached, { error: { message: "offline" } }));
          if (phase === "pending") {
            present(request).resolve(body);
            await new Promise((resolve) => setImmediate(resolve));
          }
          assert.equal(
            present(mailBody()).textContent,
            "",
            phase + ": a transport failure on the same cached object withdraws the body",
          );
          notify(live, settled(cached));
          assert.equal(
            present(mailBody()).textContent,
            "",
            phase + ": and it never returns by itself",
          );
          present(docEvents.keydown)({ key: "Escape", preventDefault() {} });
        }
        // A deadline covers an open mail panel even when every agent source is down.
        present(ledgerRead()).emit("click");
        timers.clear();
        notify(
          live,
          settled(
            inventory((originalData) => {
              const data = { ...originalData };
              data.health = "unavailable";
              data.observedAt = Date.now() - 60000;
              return data;
            }),
          ),
        );
        assert.equal(timers.size, 1, "the mail proof has its own deadline");
        present(docEvents.keydown)({ key: "Escape", preventDefault() {} });
        // Legacy rows without an identity cannot be read.
        notify(
          live,
          settled(
            inventory((originalData) => {
              const data = { ...originalData };
              present(data.bus).messages = present(present(data.bus).messages).map((message) => {
                const rest = { ...message };
                delete rest.identity;
                return rest;
              });
              return data;
            }),
          ),
        );
        assert.equal(present(ledgerRead()).disabled, true);
        assert.match(
          present(present(ledgerRead()).attributes.get("aria-label")),
          /not identifiable/,
        );
        console.log(
          "observer UI: exact-target panel stack, title/magnifier toggles, top-only polling, reveal state, lower close, cap, covered/hidden reconcile, modal swap, Escape/focus and mail transport proof OK",
        );
      },

      // ---------- Live features Task 5: station totals, exact repository highlight, controls help, helper evidence ----------
      async () => {
        timers.clear();
        const ids = [
          "world",
          "health",
          "observed",
          "sessions",
          "empty",
          "filters",
          "overview",
          "previous-page",
          "next-page",
          "search",
          "page-label",
          "room-count",
          "counts",
          "zoom-in",
          "zoom-out",
          "mail-health",
          "mail-counts",
          "mail-ledger",
          "mail-empty",
          "mail-detail",
          "zoom-chip",
          "source-health",
          "panels",
          "station-totals",
          "station-stats",
          "station-stats-summary",
          "controls-help",
          "controls-help-popover",
        ];
        document = newDocument();
        const own = Object.fromEntries(ids.map((id) => [id, element()]));
        document.replaceChildren(
          present(own.filters),
          ...["all", "working", "blocked"].map((value) => {
            const node = document.createElement("button");
            node.dataset.filter = value;
            return node;
          }),
        );
        present(own["controls-help-popover"]).hidden = true;
        document.attach(present(own["controls-help-popover"]), element());
        const docEvents: UiEvents = {},
          subs: Map<string, Deliver> = new Map(),
          requests: string[] = [],
          viewCalls: (string | number)[][] = [];
        let updateOptions!: UpdateOptions,
          invalidated = 0,
          live: Deliver | null = null,
          subscribed = 0;
        document = bindDocument(document, own, docEvents, { hidden: false });
        mountScenario({
          ...context,
          document,
          window: { addEventListener() {} },
          api: {
            get: (path) => {
              requests.push(path);
              return new Promise(() => {});
            },
          },
          view: {
            create: () => {
              return {
                update: (_scene, payload) => {
                  updateOptions = payload;
                },
                focus: (id) => viewCalls.push(["focus", id]),
                focusPlatform: (key) => viewCalls.push(["platform", key]),
                overview: () => viewCalls.push(["overview"]),
                zoomBy: (factor) => viewCalls.push(["zoom", factor]),
                start() {},
                stop() {},
                invalidate: () => {
                  invalidated++;
                },
              };
            },
          },
          query: {
            define() {},
            invalidate: () => Promise.resolve(),
            subscribe(key, fn) {
              subscribed++;
              if (key !== "observer.sessions") {
                subs.set(key, fn);
                return () => subs.delete(key);
              }
              live = fn;
              return () => {
                live = null;
              };
            },
          },
        });
        await new Promise((resolve) => setImmediate(resolve));
        const UUID = (n: number) => "00000000-0000-4000-8000-00000000000" + String(n);
        const base = {
          project: "Proj",
          projectId: "prj1",
          projectKind: "group",
          provider: "codex",
          tool: { available: false },
          inventoryHealth: "available",
        };
        const roster = (now = Date.now()) => [
          {
            ...base,
            id: "obs_r",
            paneId: "p1",
            source: "herdr",
            repo: "api",
            repoId: "repo_aaaa",
            sessionId: UUID(1),
            inspectionIdentity: "codex:" + UUID(1),
            status: "working",
            title: "Root",
            observedAt: now,
          },
          {
            ...base,
            id: "obs_s",
            paneId: "p2",
            source: "herdr",
            repo: "api",
            repoId: "repo_aaaa",
            sessionId: UUID(2),
            inspectionIdentity: "codex:" + UUID(2),
            status: "working",
            title: "Old",
            observedAt: now - 60000,
          },
          {
            ...base,
            id: "obs_w",
            paneId: "p3",
            source: "herdr",
            repo: "api",
            repoId: "repo_bbbb",
            sessionId: UUID(3),
            inspectionIdentity: "codex:" + UUID(3),
            status: "working",
            title: "Twin",
            observedAt: now,
          },
          {
            ...base,
            id: "hlp_k",
            source: "helper",
            presence: "verified-lineage",
            parentId: "obs_r",
            repo: "api",
            repoId: "repo_aaaa",
            sessionId: UUID(4),
            inspectionIdentity: "codex:" + UUID(4),
            status: "done",
            title: "Helper",
            lineageState: "open",
            observedAt: now,
            taskEvidence: { state: "partial", summary: "Fix tests" },
            taskStatusEvidence: { status: "killed", source: "codex:task", observedAt: now },
            lifecycleEvidence: {
              state: "closed",
              reason: "killed",
              source: "codex:task",
              observedAt: now,
            },
          },
          {
            ...base,
            id: "hlp_c",
            source: "helper",
            presence: "verified-lineage",
            parentId: "obs_r",
            repo: "api",
            repoId: "repo_aaaa",
            sessionId: UUID(5),
            inspectionIdentity: "codex:" + UUID(5),
            status: "done",
            title: "Helper",
            lineageState: "open",
            observedAt: now,
            taskEvidence: { state: "unavailable", summary: null },
            taskStatusEvidence: { status: "completed", source: "codex:task", observedAt: now },
            lifecycleEvidence: { state: "unknown", reason: null, source: null, observedAt: null },
          },
          // A native Herdr pane proved to be obs_r's helper keeps source herdr, its pane, own status and exact identity.
          {
            ...base,
            id: "obs_n",
            paneId: "p9",
            source: "herdr",
            parentId: "obs_r",
            repo: "api",
            repoId: "repo_aaaa",
            sessionId: UUID(6),
            inspectionIdentity: "codex:" + UUID(6),
            status: "idle",
            title: "Helper",
            lineageState: "open",
            observedAt: now,
            taskEvidence: { state: "partial", summary: "Port the parser" },
            taskStatusEvidence: { status: "running", source: "codex:task", observedAt: now },
            lifecycleEvidence: {
              state: "closed",
              reason: "closed",
              source: "codex:shutdown_complete",
              observedAt: now,
            },
          },
          {
            ...base,
            id: "obs_d",
            source: "desktop",
            provider: "chatgpt",
            project: "Desktop",
            projectId: "desktop",
            status: "unknown",
            title: "App",
            observedAt: now,
          },
        ];
        const aggregate = {
          agents: {
            observed: 6,
            verifiedSessions: 5,
            presenceOnly: 1,
            statuses: { working: 2, blocked: 0, idle: 0, done: 2, unknown: 1 },
            stale: 1,
          },
          usage: {
            inputTokens: { value: null, state: "unavailable" },
            outputTokens: { value: 1588, state: "partial" },
            cacheReadTokens: { value: 768673, state: "available" },
            cacheWriteTokens: { value: 0, state: "available" },
          },
          coverage: {
            eligible: 5,
            available: 2,
            partial: 1,
            unavailable: 1,
            stale: 1,
            conflicting: 1,
            counters: Object.fromEntries(
              ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens"].map((key) => [
                key,
                { eligible: 5, available: 2, partial: 1, unavailable: 1, stale: 1 },
              ]),
            ),
          },
        };
        const inventory = ({
          herdrAt = Date.now(),
          rows = roster(),
          withAggregate = true,
        } = {}) => ({
          hasData: true,
          error: null,
          pending: false,
          updatedAt: Date.now(),
          data: {
            sessions: rows,
            health: "available",
            observedAt: Date.now(),
            ...(withAggregate ? { aggregate } : {}),
            sources: {
              herdr: { health: "available", observedAt: herdrAt },
              desktop: { health: "available", observedAt: Date.now() },
            },
          },
        });
        notify(live, inventory());
        const totals = own["station-totals"],
          dd = (index: number) => present(totals).children[index * 2 + 1];
        // Crew follows displayed rows; usage stays published. Null is unavailable, zero is a value, coverage is stated.
        assert.equal(present(totals).hidden, false);
        assert.equal(present(own["station-stats"]).hidden, false);
        assert.equal(
          present(own["station-stats-summary"]).textContent,
          "6 displayed crew · 2 working · history In unavailable / Out 1.6K · partial usage data",
        );
        present(own["station-stats"]).open = true;
        notify(live, inventory());
        assert.equal(
          present(own["station-stats"]).open,
          true,
          "polling preserves the native disclosure state",
        );
        assert.deepEqual(
          present(totals)
            .children.filter((_, index) => index % 2 === 0)
            .map((node) => node.textContent),
          ["Displayed crew", "Status", "Cumulative session-history tokens", "Usage data coverage"],
        );
        assert.equal(present(dd(0)).textContent, "6 displayed");
        assert.equal(
          present(dd(1)).textContent,
          "2 working · 0 waiting · 1 idle · 1 done · 1 unknown · 1 stale",
        );
        assert.deepEqual(
          present(dd(2)).children.map((node) => [node.textContent, node.className]),
          [
            ["in unavailable", "total-counter total-unavailable"],
            ["out 1.6K partial", "total-counter total-partial"],
            ["cache read 768.7K", "total-counter total-available"],
            ["cache write 0", "total-counter total-available"],
          ],
          "null is unavailable, never 0; a real 0 is shown",
        );
        assert.match(
          child(present(dd(2)), 1).title,
          /^1,588 tokens · of 5 session histories: 2 complete usage data, 1 partial usage data, 1 unavailable usage data, 1 stale$/,
        );
        assert.equal(
          present(dd(3)).textContent,
          "2 of 5 session histories with complete usage data · 1 partial usage data · 1 unavailable usage data · 1 stale · 1 conflicting, not counted",
        );
        assert.equal(present(totals).dataset.freshness, "live");
        // Desktop stays fresh when Herdr expires. Station freshness becomes last known; rows retain their own deadlines.
        notify(live, inventory({ herdrAt: Date.now() - 7000 }));
        assert.equal(present(totals).dataset.freshness, "stale");
        assert.match(present(own["station-stats-summary"]).textContent, /^Last known/);
        assert.match(present(dd(1)).textContent, /^last known · 2 working/);
        assert.deepEqual(
          present(dd(2)).children.map((node) => node.textContent),
          [
            "in unavailable",
            "out 1.6K partial, last known",
            "cache read 768.7K last known",
            "cache write 0 last known",
          ],
        );
        assert(
          present(dd(2))
            .children.slice(1)
            .every((node) => node.className === "total-counter total-stale"),
        );
        // Herdr's own deadline withdraws live claims with no new response.
        timers.clear();
        notify(live, inventory({ herdrAt: Date.now() - 5990 }));
        assert.equal(present(totals).dataset.freshness, "live");
        await new Promise((resolve) => setTimeout(resolve, 20));
        fireTimers();
        assert.equal(
          present(totals).dataset.freshness,
          "stale",
          "the Herdr deadline labels the cached aggregate last known",
        );
        notify(live, inventory({ withAggregate: false }));
        assert.equal(present(totals).hidden, true, "no aggregate, no totals");
        assert.equal(
          present(own["station-stats"]).hidden,
          true,
          "no aggregate, no collapsed stats either",
        );
        notify(live, inventory());
        assert.deepEqual(
          [requests, [...subs.keys()], subscribed],
          [[], [], 1],
          "totals add no request, inspection or subscription",
        );
        // Repository toggles: exact ids, same names kept apart, selection never filters, pans or reads.
        // A filter can drop and rebuild a group's nodes, so tests always read the current group.
        const groupOf = (name: string) =>
          present(own.sessions).children.find(
            (section) => child(child(section, 0), 1).textContent === name,
          );
        const toggles = () => child(present(groupOf("Proj")), 1).children;
        assert.deepEqual(
          toggles().map((node) => [
            node.dataset.repoId,
            node.textContent,
            node.attributes.get("aria-pressed"),
          ]),
          [
            ["repo_aaaa", "api · aaaa", "false"],
            ["repo_bbbb", "api · bbbb", "false"],
          ],
          "two repositories named api stay two toggles",
        );
        assert.equal(child(present(groupOf("Proj")), 1).attributes.get("role"), "group");
        assert.equal(
          child(present(groupOf("Desktop")), 1).hidden,
          true,
          "a project without repository ids has no toggles",
        );
        const itemOf = (id: string) =>
          present(own.sessions)
            .children.flatMap((section) => sessionItems(section))
            .find((node) => child(node, 0).dataset.sessionId === id);
        const before = invalidated;
        present(toggles()[0]).emit("click");
        assert.equal(present(updateOptions.repositorySelection)(), "repo_aaaa");
        assert.equal(present(toggles()[0]).attributes.get("aria-pressed"), "true");
        assert.equal(present(toggles()[1]).attributes.get("aria-pressed"), "false");
        assert(invalidated > before, "the floor repaints");
        assert.deepEqual(
          ["obs_r", "obs_s", "hlp_c", "obs_w", "obs_d"].map((id) => present(itemOf(id)).className),
          [
            "session-item repo-selected repo-working",
            "session-item repo-selected",
            "session-item helper repo-selected",
            "session-item",
            "session-item",
          ],
          "own fresh working is emphasised; stale working and helpers are highlighted; the same-name repository is not",
        );
        const mark = (id: string) =>
          child(child(present(itemOf(id)), 0), 0).children.find(
            (node) => node.className === "repo-mark",
          );
        assert.deepEqual(
          [
            present(mark("obs_r")).textContent,
            present(mark("obs_s")).textContent,
            present(mark("obs_w")).hidden,
          ],
          ["◆◆", "◆", true],
        );
        assert.equal(present(mark("obs_r")).attributes.get("aria-hidden"), "true");
        assert(
          child(child(present(itemOf("obs_r")), 0), 0).children.some(
            (node) => node.textContent === "Highlighted repository, working now",
          ),
          "the highlight is in words too",
        );
        child(present(own.filters), 2).emit("click");
        assert.equal(
          present(updateOptions.repositorySelection)(),
          "repo_aaaa",
          "a filter never changes the selection",
        );
        child(present(own.filters), 0).emit("click");
        // A canvas sign drives the same toggle: the same id clears, a different id moves, an unknown id is ignored.
        present(updateOptions.onRepositoryToggle)("repo_aaaa");
        assert.equal(present(updateOptions.repositorySelection)(), null);
        assert.equal(present(toggles()[0]).attributes.get("aria-pressed"), "false");
        present(updateOptions.onRepositoryToggle)("nowhere");
        assert.equal(present(updateOptions.repositorySelection)(), null);
        present(updateOptions.onRepositoryToggle)("repo_bbbb");
        assert.equal(present(updateOptions.repositorySelection)(), "repo_bbbb");
        assert.equal(present(itemOf("obs_r")).className, "session-item");
        present(toggles()[1]).emit("click");
        assert.equal(present(updateOptions.repositorySelection)(), null, "a second click clears");
        present(updateOptions.onRepositoryToggle)("repo_bbbb");
        notify(live, inventory({ rows: roster().filter((row) => row.id !== "obs_w") }));
        assert.equal(
          present(updateOptions.repositorySelection)(),
          null,
          "removing the last row of the repository clears it",
        );
        assert.deepEqual(
          child(present(groupOf("Proj")), 1).children.map((node) => node.dataset.repoId),
          ["repo_aaaa"],
        );
        assert.deepEqual(
          [viewCalls, requests, [...subs.keys()]],
          [[], [], []],
          "selection never focuses, zooms, pans or reads",
        );
        // Helper evidence: own task report and lifecycle are separate facts; closed only on positive evidence.
        notify(live, inventory());
        child(present(itemOf("obs_r")), 2).emit("click");
        const panel = present(own.panels).children.at(-1),
          helpers = present(findPart(present(panel), "inspector-helpers-list")).children.map(
            (node) => child(node, 0).textContent,
          );
        assert.equal(
          present(findPart(present(panel), "inspector-helpers-title")).textContent,
          "Verified helpers · 3",
        );
        assert(
          helpers.some((label) =>
            label.includes("done · task killed · killed · Fix tests (partial)"),
          ),
          "killed task, killed lifecycle and a partial task: " + String(helpers),
        );
        const completed = helpers.find((label) => label.includes("task completed"));
        assert(
          completed && !/closed|killed/.test(completed),
          "a completed task alone never closes a helper: " + String(completed),
        );
        assert.equal(
          itemOf("hlp_k"),
          undefined,
          "historically closed synthetic helpers remain in raw inspection, outside displayed crew",
        );
        // A native pane helper: its own idle status stays, beside its running task report, positive closure and partial
        // assignment, in the parent list, the console row (with its real pane) and its own inspector.
        assert(
          helpers.some((label) =>
            label.includes("idle · task running · closed · Port the parser (partial)"),
          ),
          "native helper in the parent list: " + String(helpers),
        );
        const native = itemOf("obs_n");
        assert.equal(
          child(child(child(present(native), 0), 3), 0).textContent,
          "p9 · link open · closed · task running",
          "the pane id is composed with the helper facts",
        );
        assert.equal(
          child(child(child(present(native), 0), 0), 1).textContent,
          "idle",
          "its authoritative pane status is untouched",
        );
        assert.equal(
          child(present(native), 1).textContent,
          "Port the parser (partial)",
          "the row title is the verified assignment",
        );
        assert.match(
          present(child(present(native), 1).attributes.get("aria-label")),
          /— Port the parser \(partial\)$/,
        );
        present(docEvents.keydown)({ key: "Escape", preventDefault() {} });
        child(present(native), 2).emit("click");
        const nativePanel = present(own.panels).children.at(-1);
        assert.equal(
          present(findPart(present(nativePanel), "inspector-task")).textContent,
          "Port the parser (partial)",
        );
        assert.deepEqual(
          present(findPart(present(nativePanel), "inspector-meta")).children.map(
            (node) => node.textContent,
          ),
          [
            "p9",
            "api",
            "Helper · relationship open · native pane observed",
            "closed",
            "task running",
          ],
        );
        assert.equal(
          present(findPart(present(nativePanel), "inspector-status")).textContent,
          "idle",
        );
        assert(subs.has("observer.inspect.obs_n"), "its own inspection reads its own row");
        present(docEvents.keydown)({ key: "Escape", preventDefault() {} });
        child(present(itemOf("obs_r")), 2).emit("click");
        // Controls help: a disclosure that Escape closes first, returning focus to its trigger.
        const help = own["controls-help"],
          popover = own["controls-help-popover"];
        assert.equal(present(popover).hidden, true, "help starts closed");
        present(docEvents.keydown)({ key: "Escape", preventDefault() {} });
        assert.equal(present(own.panels).children.length, 0);
        present(help).focus();
        present(help).emit("click");
        assert.deepEqual(
          [present(popover).hidden, present(help).attributes.get("aria-expanded")],
          [false, "true"],
        );
        present(own.search).focus();
        let prevented = false;
        viewCalls.length = 0; // Reset observations so repository highlights cannot inherit the magnifier focus.
        present(
          // the magnifier above focused its worker
          docEvents.keydown,
        )({
          key: "Escape",
          preventDefault() {
            prevented = true;
          },
        });
        assert.deepEqual(
          [
            present(popover).hidden,
            present(help).attributes.get("aria-expanded"),
            prevented,
            document.activeElement,
          ],
          [true, "false", true, help],
          "Escape closes help and returns focus to its trigger",
        );
        assert.deepEqual(viewCalls, [], "that Escape never reaches the overview");
        present(help).emit("click");
        present(docEvents.pointerdown)({ target: present(popover).children[0] });
        assert.equal(present(popover).hidden, false, "a press inside keeps help open");
        present(own.search).focus();
        present(docEvents.pointerdown)({ target: own.world });
        assert.deepEqual(
          [present(popover).hidden, document.activeElement],
          [true, own.search],
          "a press outside dismisses without moving focus",
        );
        present(help).emit("click");
        child(present(itemOf("obs_w")), 2).emit("click");
        assert.deepEqual(
          [
            present(popover).hidden,
            present(help).attributes.get("aria-expanded"),
            present(own.panels).children.length,
          ],
          [true, "false", 1],
          "opening a panel closes help",
        );
        present(docEvents.keydown)({ key: "Escape", preventDefault() {} });
        assert.equal(present(own.panels).children.length, 0, "so the next Escape closes the panel");
        present(help).emit("click");
        present(help).emit("click");
        assert.equal(present(popover).hidden, true, "the trigger toggles");
        console.log(
          "observer UI: aggregate totals (null unavailable, partial, coverage, Herdr deadline), exact repository toggles, helper task/lifecycle evidence and controls help OK",
        );
      },

      // Projected optional evidence expires during a fresh inventory request remains pending.
      async () => {
        timers.clear();
        let now = 7000,
          live!: Deliver | null,
          floor!: UpdateOptions,
          inventory!: PresentationInput;
        const presentation = makePresentationObserver({ get: () => Promise.resolve(inventory) });
        class EvidenceDate extends Date {
          static override now() {
            return now;
          }
        }
        const ids = [
          "world",
          "health",
          "observed",
          "sessions",
          "empty",
          "filters",
          "overview",
          "previous-page",
          "next-page",
          "search",
          "page-label",
          "room-count",
          "counts",
          "zoom-in",
          "zoom-out",
          "mail-health",
          "mail-counts",
          "mail-ledger",
          "mail-empty",
          "mail-detail",
          "zoom-chip",
          "source-health",
          "panels",
          "station-totals",
          "station-stats",
          "station-stats-summary",
          "controls-help",
          "controls-help-popover",
        ];
        document = newDocument();
        const own = Object.fromEntries(ids.map((id) => [id, element()]));
        document.replaceChildren(present(own.filters), ...[]);
        document = bindDocument(document, own, undefined, { hidden: false });
        mountScenario({
          ...context,
          now: () => EvidenceDate.now(),
          document,
          window: { addEventListener() {} },
          view: {
            create: () => ({
              update(_scene, options) {
                floor = options;
              },
              start() {},
              stop() {},
              invalidate() {},
            }),
          },
          query: {
            define() {},
            invalidate: () => Promise.resolve(),
            subscribe(key, fn) {
              if (key === "observer.sessions") live = fn;
              return () => {};
            },
          },
        });
        await new Promise((resolve) => setImmediate(resolve));
        const snapshot = async (at: number) => {
          const sourceRow = {
            id: "obs_evidence",
            source: "herdr",
            projectId: "repo",
            repoId: "repo",
            project: "Repo",
            provider: "codex",
            status: "working",
            title: "Task",
            inventoryHealth: "available",
            observedAt: now,
            tool: {
              available: true,
              observedAt: at,
              last: { name: "Read", phase: "started", at: 900 },
            },
          } satisfies AppRow & Pick<PresentationInput["sessions"][number], "provider" | "source">;
          inventory = {
            health: "available",
            observedAt: now,
            sources: {
              herdr: { health: "available", observedAt: now },
              desktop: { health: "unavailable", observedAt: null },
            },
            sessions: [sourceRow],
            aggregate: {
              agents: {
                observed: 1,
                verifiedSessions: 1,
                presenceOnly: 0,
                statuses: { working: 1 },
                stale: 0,
              },
              usageObservedAt: at,
              usage: { inputTokens: { value: 42, state: "available" } },
              coverage: {},
            },
          };
          return {
            hasData: true,
            pending: false,
            error: null,
            updatedAt: now,
            data: await presentation.get(),
          };
        };
        const findClass = (node: AppFixtureNode, name: string): AppFixtureNode | undefined =>
          node.className.split(" ").includes(name)
            ? node
            : node.children.map((child) => findClass(child, name)).find(Boolean);
        const summary = () => findClass(present(own.sessions), "row-summary");
        const status = () => findClass(present(own.sessions), "status");
        const tokens = () => child(present(own["station-totals"]), 5).children[0];
        const current = await snapshot(1000);
        notify(live, current);
        assert.match(present(summary()).textContent, /reading files/);
        assert.equal(present(tokens()).className, "total-counter total-available");
        assert.equal(
          present([...timers.values()][0]).ms,
          1,
          "original optional evidence reaches its deadline before current inventory",
        );
        notify(live, { ...current, pending: true });
        now = 7001;
        fireTimers();
        assert.equal(present(summary()).textContent, "Tool detail unavailable");
        assert.equal(
          present(summary()).title,
          "",
          "expired tool evidence no longer advertises live details",
        );
        assert.equal(present(tokens()).className, "total-counter total-stale");
        assert.match(present(tokens()).textContent, /42 last known/);
        assert.equal(present(status()).textContent, "working");
        assert.equal(
          present(own["station-totals"]).dataset.freshness,
          "live",
          "optional usage cannot dim current crew/status as stale",
        );
        assert.equal(present(floor.stale)(), false, "current inventory stays live");
        assert.match(
          child(present(own["station-totals"]), 3).textContent,
          /^1 working/,
          "current aggregate status stays live",
        );
        notify(live, await snapshot(now));
        assert.match(present(summary()).textContent, /reading files/);
        assert.equal(present(tokens()).className, "total-counter total-available");
        assert.doesNotMatch(present(tokens()).textContent, /last known/);
        console.log(
          "observer UI: presentation-projected activity and authoritative usage expire during pending poll while inventory stays live, then recover",
        );
      },
    ]);
  })();
}, 30000);
test("observer entry preserves synchronous prepaint and one module after the DOM", () => {
  const page = fs.readFileSync(new URL("../../../frontend/observer.html", import.meta.url), "utf8");
  const scripts = [...page.matchAll(/<script\b([^>]*)><\/script>/g)]
    .map((match) => ({
      attributes: match[1] ?? "",
      source: /src="([^"]+)"/.exec(match[1] ?? "")?.[1],
      index: match.index,
    }))
    .filter((script) => script.source !== undefined);
  const boot = page.indexOf("<!--observer-boot-->"),
    headEnd = page.indexOf("</head>"),
    domEnd = page.indexOf("</main>"),
    bodyEnd = page.indexOf("</body>");
  const hasDocumentBoundaries = () =>
    boot >= 0 && headEnd > boot && domEnd > headEnd && bodyEnd > domEnd;
  const prepaint = scripts.find((script) => script.source === "app/prepaint.js");
  const main = scripts.find((script) => script.source === "app/main.js");
  assert.ok(
    hasDocumentBoundaries() &&
      scripts.length === 2 &&
      prepaint &&
      main &&
      !/\b(?:async|defer|type)=?/.test(prepaint.attributes) &&
      prepaint.index > boot &&
      prepaint.index < headEnd &&
      /\btype="module"/.test(main.attributes) &&
      main.index > domEnd &&
      main.index < bodyEnd,
  );
  assert.equal(scripts.filter((script) => /\btype="module"/.test(script.attributes)).length, 1);
});
