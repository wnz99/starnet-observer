import { readBootstrap } from "../bootstrap.js";
import { canonicalTheme } from "../theme.fixture.js";
import type { ThemeFont } from "../theme/dom.js";
import type { Resource } from "../view/drawing.fixture.js";
import type { ViewEnvironment } from "../view/types.js";
import type { AppEvent, AppMedia, AppScheduler, AppWindow } from "./dom.js";
export const fixtureEvent = (): AppEvent => ({
  preventDefault() {
    /* Event cancellation is supplied by individual assertions. */
  },
});
export class AppFixtureEvents {
  readonly handlers = new Map<string, Set<(event: AppEvent) => void>>();
  readonly added: { name: string; listener: (event: AppEvent) => void }[] = [];
  readonly removed: typeof this.added = [];
  addEventListener(name: string, listener: (event: AppEvent) => void) {
    this.added.push({ name, listener });
    const group = this.handlers.get(name) ?? new Set();
    group.add(listener);
    this.handlers.set(name, group);
  }
  removeEventListener(name: string, listener: (event: AppEvent) => void) {
    if (this.handlers.get(name)?.delete(listener)) this.removed.push({ name, listener });
  }
  count(name: string) {
    return this.handlers.get(name)?.size ?? 0;
  }
  emit(name: string, detail = fixtureEvent()) {
    const group = this.handlers.get(name);
    for (const listener of [...(group ?? [])]) {
      if (group?.has(listener)) listener(detail);
    }
  }
}
export class AppFixtureMedia extends AppFixtureEvents implements AppMedia {
  matches = false;
  setMatches(value: boolean) {
    this.matches = value;
    this.emit("change");
  }
}
class AppFixtureStorage {
  readonly values = new Map<string, string>();
  readonly writes: [string, string][] = [];
  throwing = false;
  private check() {
    if (this.throwing) throw new Error("denied");
  }
  getItem(key: string) {
    this.check();
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.check();
    this.values.set(key, value);
    this.writes.push([key, value]);
  }
  removeItem(key: string) {
    this.check();
    this.values.delete(key);
  }
}
export class AppFixtureWindow extends AppFixtureEvents implements AppWindow<Resource> {
  themeFont?: ThemeFont;
  readonly viewEnvironment: ViewEnvironment<Resource> = {};
  readonly storage = new AppFixtureStorage();
  private readonly queries = new Map<string, AppFixtureMedia>();
  throwingStorage = false;
  confirmations: string[] = [];
  confirmResult = true;
  reloads = 0;
  constructor(
    readonly bootstrap = readBootstrap({ __OBSERVER_THEME_DEFAULT__: canonicalTheme() }),
  ) {
    super();
  }
  get localStorage() {
    if (this.throwingStorage) throw new Error("SecurityError");
    return this.storage;
  }
  matchMedia(query: string) {
    const media = this.queries.get(query) ?? new AppFixtureMedia();
    this.queries.set(query, media);
    return media;
  }
  confirm(message: string) {
    this.confirmations.push(message);
    return this.confirmResult;
  }
  reload() {
    this.reloads++;
  }
}
interface FixtureTimer {
  callback: () => void;
  deadline: number;
  period: number | null;
}
export class AppFixtureScheduler implements AppScheduler {
  private time = 0;
  private serial = 0;
  readonly timers = new Map<number, FixtureTimer>();
  readonly scheduled: FixtureTimer[] = [];
  readonly clock = { now: () => this.time, frame: () => this.time };
  private schedule(callback: () => void, delay: number, period: number | null) {
    const id = ++this.serial;
    const timer = { callback, deadline: this.time + delay, period };
    this.timers.set(id, timer);
    this.scheduled.push(timer);
    return () => {
      this.timers.delete(id);
    };
  }
  timeout(callback: () => void, milliseconds: number) {
    return this.schedule(callback, milliseconds, null);
  }
  interval(callback: () => void, milliseconds: number) {
    if (milliseconds <= 0) throw new Error("Fixture interval must advance time");
    return this.schedule(callback, milliseconds, milliseconds);
  }
  advance(milliseconds: number) {
    const end = this.time + milliseconds;
    for (;;) {
      const next = [...this.timers]
        .filter(([, timer]) => timer.deadline <= end)
        .sort((a, b) => a[1].deadline - b[1].deadline)[0];
      if (!next) break;
      const [id, timer] = next;
      this.time = timer.deadline;
      if (timer.period === null) this.timers.delete(id);
      else timer.deadline += timer.period;
      const callback = timer.callback;
      callback();
    }
    this.time = end;
  }
}
