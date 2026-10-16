import { mountObserver } from "./mount.js";
import { createAppFixture, AppFixtureWindow } from "./dom.fixture.js";
import type { AppFixtureNode } from "./dom.fixture.js";
import { readBootstrap } from "../bootstrap.js";
import { canonicalTheme } from "../theme.fixture.js";
import type { AppQuery, AppView, MountOptions } from "./contracts.js";
import type { QuerySnapshot, QuerySpec } from "../queryspine/types.js";
import type { Scene } from "../scene/types.js";
import type { UpdateOptions, ViewOptions } from "../view/types.js";
import type { Resource } from "../view/drawing.fixture.js";

export type Delivery = Omit<Partial<QuerySnapshot>, "error"> & {
  error?: Partial<NonNullable<QuerySnapshot["error"]>> | null;
};
export type Deliver = (snapshot: Delivery) => void;
export type UiViewOptions = ViewOptions<Resource>;
export interface UiFrame {
  scene: Scene;
  options: UpdateOptions;
}

function unexpected(name: string): never {
  throw new Error(`Unexpected UI collaborator call: ${name}`);
}

/** Original omitted spy methods remain errors, rather than silently gaining behavior. */
export function viewSpy(overrides: Partial<AppView>): AppView {
  return {
    update: () => unexpected("view.update"),
    focus: () => unexpected("view.focus"),
    focusPlatform: () => unexpected("view.focusPlatform"),
    overview: () => unexpected("view.overview"),
    zoomBy: () => unexpected("view.zoomBy"),
    start: () => unexpected("view.start"),
    stop: () => unexpected("view.stop"),
    invalidate: () => unexpected("view.invalidate"),
    ...overrides,
  };
}

/** Missing success metadata stays false/zero; deliveries never manufacture fresh transport proof. */
function delivery(key: string, snapshot: Delivery): QuerySnapshot {
  return {
    key,
    path: "",
    hasData: false,
    data: undefined,
    updatedAt: 0,
    ageMs: null,
    stale: false,
    errorAt: 0,
    pending: false,
    ...snapshot,
    error: snapshot.error
      ? { name: snapshot.error.name ?? "", message: snapshot.error.message ?? "" }
      : null,
  };
}
export function querySpy(options: {
  define?: (key: string, spec: QuerySpec) => void;
  invalidate?: AppQuery["invalidate"];
  subscribe: (
    key: string,
    listener: Deliver,
    options?: { immediate?: boolean; refresh?: boolean },
  ) => () => void;
}): AppQuery {
  return {
    define: options.define ?? (() => unexpected("query.define")),
    invalidate: options.invalidate ?? (() => unexpected("query.invalidate")),
    subscribe: (key, listener, subscription) =>
      options.subscribe(
        key,
        (snapshot) => {
          listener(delivery(key, snapshot));
        },
        subscription,
      ),
    dispose: () => unexpected("query.dispose"),
  };
}

export function uiFixture(bootstrap: Record<string, unknown> = {}) {
  const fixture = createAppFixture();
  const window = new AppFixtureWindow(
    readBootstrap({
      __OBSERVER_THEME_DEFAULT__: canonicalTheme(),
      ...bootstrap,
    }),
  );
  const get = (id: string): AppFixtureNode =>
    fixture.document.getElementById(id) ?? fixture.document.register(id);
  const badge = fixture.document.register("read-only-badge", "span");
  badge.className = "read-only";
  const mount = (options: {
    createView: (options: UiViewOptions) => AppView;
    query: AppQuery;
    fetch?: MountOptions<AppFixtureNode, Resource>["fetch"];
    frame?: () => number;
  }) =>
    mountObserver({
      document: fixture.document,
      window,
      fetch: options.fetch ?? (() => new Promise(() => {})),
      clock: { now: () => Date.now(), frame: options.frame ?? (() => Date.now()) },
      scheduler: fixture.scheduler,
      sprites: { init: async () => {} },
      collaborators: { createView: options.createView, query: options.query },
    });
  return { ...fixture, window, get, badge, mount };
}

import { AppFixtureDocument, AppFixtureScheduler } from "./dom.fixture.js";
import { fixtureEvent } from "./environment.fixture.js";
import type { AppEvent, AppMedia, AppWindow } from "./dom.js";
import type { AppSprites, AppTheme } from "./contracts.js";
import type { createModel } from "../model.js";
import type { createThemePack } from "../theme.js";

export type UiEvents = Record<string, (event?: Partial<AppEvent>) => void>;
export function countedDocument(count: { created(): void; listening(): void }) {
  const document = new UiFixtureDocument();
  const create = document.createElement.bind(document);
  document.createElement = (tag) => {
    count.created();
    const node = create(tag);
    const add = node.addEventListener.bind(node);
    node.addEventListener = (name, listener) => {
      count.listening();
      add(name, listener);
    };
    return node;
  };
  return document;
}
/** Named fixture nodes stay attached to their own document; captured events retain actual listeners. */
class UiFixtureDocument extends AppFixtureDocument {
  private captured: UiEvents | undefined;
  bind(
    nodes: Record<string, AppFixtureNode>,
    events: UiEvents | undefined,
    options: { hidden: boolean },
  ) {
    this.hidden = options.hidden;
    this.captured = events;
    for (const [id, node] of Object.entries(nodes)) {
      node.id = id;
      this.attach(this.body, node);
      for (const child of node.children) child.parent = node;
    }
    const add = this.addEventListener.bind(this);
    this.addEventListener = (name, listener) => {
      add(name, listener);
      if (this.captured)
        this.captured[name] = (detail) => {
          this.emit(name, { ...fixtureEvent(), ...detail });
        };
    };
    return this;
  }
}
export function bindDocument(
  document: UiFixtureDocument,
  nodes: Record<string, AppFixtureNode>,
  events: UiEvents | undefined,
  options: { hidden: boolean },
) {
  return document.bind(nodes, events, options);
}
const POST_METHOD = "POST";
const HTTP_OK = 200;
interface ScenarioWindow {
  __OBSERVER_THEME__?: unknown;
  __OBSERVER_THEME_PACK__?: unknown;
  __OBSERVER_CONTROL__?: boolean;
  localStorage?: Pick<Storage, "getItem" | "setItem"> & Partial<Pick<Storage, "removeItem">>;
  addEventListener?: (name: string, listener: () => void) => void;
  matchMedia?: (query: string) => AppMedia;
  confirm?: (message: string) => boolean;
}
export interface UiScenario {
  document: AppFixtureDocument;
  view: { create: (options: UiViewOptions) => Partial<AppView> };
  query: Parameters<typeof querySpy>[0];
  queryPort?: AppQuery;
  theme: ReturnType<typeof createThemePack> | AppTheme;
  model: ReturnType<typeof createModel>;
  window: ScenarioWindow;
  sprites: AppSprites<Resource>;
  api: {
    get: (path: string, options?: { signal?: AbortSignal }) => Promise<unknown>;
    post?: (path: string, body: unknown) => Promise<unknown>;
  };
  now?: () => number;
  frame?: () => number;
  schedule?: (callback: () => void, milliseconds: number) => () => void;
}
function scenarioWindow(scenario: UiScenario) {
  const window = new AppFixtureWindow(
    readBootstrap({
      __OBSERVER_THEME_DEFAULT__:
        scenario.theme instanceof Object && "getDefault" in scenario.theme
          ? scenario.theme.getDefault()
          : canonicalTheme(),
      ...scenario.window,
    }),
  );
  const storage = scenario.window.localStorage;
  if (storage) {
    window.storage.getItem = (key) => storage.getItem(key);
    window.storage.setItem = (key, value) => {
      storage.setItem(key, value);
    };
    window.storage.removeItem = (key) => storage.removeItem?.(key);
  }
  const add = window.addEventListener.bind(window);
  window.addEventListener = (name, listener) => {
    add(name, listener);
    scenario.window.addEventListener?.(name, () => {
      window.emit(name);
    });
  };

  if (scenario.window.confirm) window.confirm = scenario.window.confirm;
  return {
    bootstrap: window.bootstrap,
    viewEnvironment: window.viewEnvironment,
    localStorage: window.localStorage,
    matchMedia: scenario.window.matchMedia ?? window.matchMedia.bind(window),
    confirm: window.confirm.bind(window),
    reload: window.reload.bind(window),
    addEventListener: window.addEventListener.bind(window),
    removeEventListener: window.removeEventListener.bind(window),
  } satisfies AppWindow<Resource>;
}
function scenarioFetch(scenario: UiScenario): MountOptions<AppFixtureNode, Resource>["fetch"] {
  return async (path, options) => {
    let data: unknown;
    if (options.method === POST_METHOD) {
      if (!scenario.api.post) return unexpected("api.post");
      const body: unknown = typeof options.body === "string" ? JSON.parse(options.body) : undefined;
      data = await scenario.api.post(path, body);
    } else {
      const signal = options.signal ?? undefined;
      data = await scenario.api.get(path, signal ? { signal } : {});
    }
    return { ok: true, status: HTTP_OK, json: () => Promise.resolve(data) };
  };
}
export function mountScenario(scenario: UiScenario) {
  const scheduler = new AppFixtureScheduler();
  const options: MountOptions<AppFixtureNode, Resource> = {
    document: scenario.document,
    window: scenarioWindow(scenario),
    fetch: scenarioFetch(scenario),
    clock: { now: scenario.now ?? (() => Date.now()), frame: scenario.frame ?? (() => Date.now()) },
    scheduler: {
      timeout: scenario.schedule ?? scheduler.timeout.bind(scheduler),
      interval: scheduler.interval.bind(scheduler),
    },
    sprites: scenario.sprites,
    collaborators: {
      createView: (options) => viewSpy(scenario.view.create(options)),
      query: scenario.queryPort ?? querySpy(scenario.query),
      theme: scenario.theme,
      model: scenario.model,
    },
  };
  return mountObserver(options);
}

export function notify(listener: Deliver | null | undefined, snapshot: Delivery) {
  if (!listener) throw new Error("Inventory not subscribed");
  listener(snapshot);
}

export function child(node: AppFixtureNode, index: number) {
  const value = node.children[index];
  if (!value) throw new Error(`Missing expected UI child: ${String(index)}`);
  return value;
}

export function runScenarios(cases: (() => Promise<void>)[]) {
  return cases.reduce((previous, run) => previous.then(run), Promise.resolve());
}
