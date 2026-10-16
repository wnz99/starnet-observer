import type { QueryError, QuerySnapshot, QuerySpec } from "./types.js";
const DEFAULT_TIMEOUT_MS = 15000;
const positiveMs = (value: number | undefined) =>
  Number.isFinite(value) && Number(value) > 0 ? Number(value) : 0;
export class Resource {
  readonly key: string;
  readonly path: string;
  readonly ttlMs: number;
  readonly pollMs: number;
  readonly timeoutMs: number;
  readonly validate: QuerySpec["validate"];
  readonly retainOnUnsubscribe: boolean;
  hasData = false;
  data: unknown;
  updatedAt = 0;
  invalidated = false;
  error: QueryError | null = null;
  errorAt = 0;
  generation = 0;
  inFlight: Promise<QuerySnapshot> | null = null;
  inFlightGeneration = 0;
  readonly listeners = new Set<(snapshot: QuerySnapshot) => void>();
  private cancelTimer: (() => void) | null = null;
  constructor(key: string, spec: QuerySpec) {
    this.key = key;
    this.path = spec.path;
    this.ttlMs = positiveMs(spec.ttlMs);
    this.pollMs = positiveMs(spec.pollMs);
    this.timeoutMs = positiveMs(spec.timeoutMs) || DEFAULT_TIMEOUT_MS;
    this.validate = spec.validate;
    this.retainOnUnsubscribe = spec.retainOnUnsubscribe !== false;
  }
  snapshot(now: () => number): QuerySnapshot {
    const ageMs = this.hasData ? Math.max(0, now() - this.updatedAt) : null;
    return Object.freeze({
      key: this.key,
      path: this.path,
      hasData: this.hasData,
      data: this.data,
      updatedAt: this.updatedAt,
      ageMs,
      stale:
        !this.hasData ||
        this.invalidated ||
        this.error !== null ||
        (this.ttlMs > 0 && ageMs !== null && ageMs >= this.ttlMs),
      error: this.error,
      errorAt: this.errorAt,
      pending: this.inFlight !== null,
    });
  }
  notify(now: () => number) {
    const snapshot = this.snapshot(now);
    for (const listener of Array.from(this.listeners)) {
      try {
        listener(snapshot);
      } catch {
        /* One view cannot break the shared resource. */
      }
    }
  }
  accept(data: unknown, now: () => number) {
    this.data = data;
    this.hasData = true;
    this.updatedAt = now();
    this.invalidated = false;
    this.error = null;
    this.errorAt = 0;
  }
  removeListener(listener: (snapshot: QuerySnapshot) => void) {
    this.listeners.delete(listener);
  }
  invalidate() {
    this.generation++;
    this.invalidated = true;
  }
  discard() {
    this.generation++;
    this.hasData = false;
    this.data = undefined;
  }
  failed(error: QueryError, now: () => number) {
    this.error = error;
    this.errorAt = now();
  }
  begin(pending: Promise<QuerySnapshot>, generation: number) {
    this.inFlight = pending;
    this.inFlightGeneration = generation;
  }
  complete(pending: Promise<QuerySnapshot>) {
    if (this.inFlight === pending) this.inFlight = null;
  }
  startTimer(arm: () => () => void) {
    if (this.cancelTimer === null) this.cancelTimer = arm();
  }
  stopTimer() {
    this.cancelTimer?.();
    this.cancelTimer = null;
  }
}
