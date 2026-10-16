import type { QuerySnapshot, QuerySpec } from "../queryspine/types.js";
import type { SpriteInit } from "../sprites/types.js";
import type { ViewOptions } from "../view/types.js";
import type { Resource } from "../view/drawing.fixture.js";
import type { AppQuery, AppView, MountOptions } from "./contracts.js";
import { AppFixtureWindow, createAppFixture, type AppFixtureNode } from "./dom.fixture.js";

const HTTP_STATUS = { ok: 200, redirect: 300 };
type Response = Awaited<ReturnType<MountOptions<AppFixtureNode, Resource>["fetch"]>>;
export interface PendingFetch {
  path: string;
  options: RequestInit;
  resolve(response: Response): void;
  reject(error: Error): void;
}
export async function flushMount() {
  for (let turn = 0; turn < 12; turn++) await Promise.resolve();
}
export class MountProbe {
  readonly page = createAppFixture();
  readonly requests: PendingFetch[] = [];
  readonly calls = {
    focuses: 0,
    starts: 0,
    stops: 0,
    updates: 0,
    invalidations: 0,
    themesDisposed: 0,
    warnings: 0,
    sprites: 0,
  };
  viewOptions: ViewOptions<Resource> | null = null;
  spriteOptions: SpriteInit | null = null;
  private settleSprites: (() => void) | null = null;
  readonly view: AppView = {
    update: () => {
      this.calls.updates++;
    },
    focus: () => {
      this.calls.focuses++;
    },
    focusPlatform() {},
    overview() {},
    zoomBy() {},
    start: () => {
      this.calls.starts++;
    },
    stop: () => {
      this.calls.stops++;
    },
    invalidate: () => {
      this.calls.invalidations++;
    },
    setFx() {},
    fx: () => false,
  };
  readonly options: MountOptions<AppFixtureNode, Resource> = {
    ...this.page,
    clock: this.page.scheduler.clock,
    fetch: (path, options) =>
      new Promise<Response>((resolve, reject) => {
        this.requests.push({ path, options, resolve, reject });
      }),
    sprites: {
      init: (options) => {
        this.calls.sprites++;
        this.spriteOptions = options;
        return new Promise<void>((resolve) => {
          this.settleSprites = resolve;
        });
      },
    },
    collaborators: {
      createView: (options) => {
        this.viewOptions = options;
        return this.view;
      },
      theme: {
        start() {},
        reportWarning: () => {
          this.calls.warnings++;
        },
        reportNotice() {},
        dispose: () => {
          this.calls.themesDisposed++;
        },
      },
    },
  };
  constructor(options: { control?: boolean } = {}) {
    if (options.control) {
      this.page.window = new AppFixtureWindow({ ...this.page.window.bootstrap, control: true });
      this.options.window = this.page.window;
    }
  }
  reply(index: number, data: unknown, status = HTTP_STATUS.ok) {
    const request = this.requests[index];
    if (!request) throw new Error("Expected mounted request is unavailable");
    request.resolve({
      ok: status >= HTTP_STATUS.ok && status < HTTP_STATUS.redirect,
      status,
      json: () => Promise.resolve(data),
    });
  }
  exerciseRetainedViewActions() {
    const callbacks = this.viewOptions;
    if (!callbacks) throw new Error("Mounted View callbacks are unavailable");
    callbacks.onSelect?.("worker");
    callbacks.onTitleToggle?.("worker");
    callbacks.onPlatform?.("project");
    callbacks.onObservatory?.();
    callbacks.onShip?.("remote");
    callbacks.onMode?.({ mode: "platform", platform: "project" });
    callbacks.onCamera?.({ canZoomIn: false, canZoomOut: false });
  }
  settleCrew() {
    this.settleSprites?.();
  }
  retainedTimers() {
    return [...this.page.scheduler.scheduled].map((entry) => entry.callback);
  }
}

export class InventoryFeed implements AppQuery {
  readonly listeners = new Set<(snapshot: QuerySnapshot) => void>();
  readonly retained: ((snapshot: QuerySnapshot) => void)[] = [];
  readonly definitions: { key: string; spec: QuerySpec }[] = [];
  invalidations = 0;
  disposals = 0;
  private last: QuerySnapshot | null = null;
  releases = 0;
  define(key: string, spec: QuerySpec) {
    this.definitions.push({ key, spec });
  }
  subscribe(_key: string, listener: (snapshot: QuerySnapshot) => void) {
    this.listeners.add(listener);
    this.retained.push(listener);
    return () => {
      if (this.listeners.delete(listener)) this.releases++;
    };
  }
  invalidate() {
    this.invalidations++;
  }
  dispose() {
    this.disposals++;
    this.listeners.clear();
  }
  replayRetained() {
    const snapshot = this.last;
    if (snapshot) for (const listener of this.retained) listener(snapshot);
  }
  publish(data: unknown) {
    const snapshot: QuerySnapshot = {
      key: "observer.sessions",
      path: "/api/observer/sessions",
      hasData: true,
      data,
      updatedAt: 0,
      ageMs: 0,
      stale: false,
      error: null,
      errorAt: 0,
      pending: false,
    };
    this.last = snapshot;
    for (const listener of this.listeners) listener(snapshot);
  }
}
