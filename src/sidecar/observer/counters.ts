import type { ObserverSnapshot } from "../../shared/observer.js";
import type { Row } from "./contracts.js";
import { COUNTERS, freshUsage, usageObservation } from "./evidence.js";
import type { CounterKey } from "./evidence.js";
export const emptyCoverage = () => ({
  eligible: 0,
  available: 0,
  partial: 0,
  unavailable: 0,
  stale: 0,
});
const counterMap = <T>(make: () => T): Record<CounterKey, T> => ({
  inputTokens: make(),
  outputTokens: make(),
  cacheReadTokens: make(),
  cacheWriteTokens: make(),
});
export class Counters {
  readonly coverage = { ...emptyCoverage(), conflicting: 0, counters: counterMap(emptyCoverage) };
  private totals = counterMap<number | null>(() => null);
  private observedAt = counterMap<number | null>(() => null);
  private overflow = new Set<CounterKey>();
  private add(row: Row, key: CounterKey, stale: boolean) {
    const counter = this.coverage.counters[key];
    counter.eligible++;
    if (stale) {
      counter.stale++;
      return null;
    }
    const item = row.usage?.[key];
    if (
      !item ||
      item.value === null ||
      !Number.isSafeInteger(item.value) ||
      item.value < 0 ||
      (item.state !== "available" && item.state !== "partial")
    ) {
      counter.unavailable++;
      return null;
    }
    counter[item.state]++;
    const observedAt = usageObservation(row);
    if (typeof observedAt === "number")
      this.observedAt[key] =
        this.observedAt[key] === null ? observedAt : Math.min(this.observedAt[key], observedAt);
    const sum = (this.totals[key] ?? 0) + item.value;
    if (!Number.isSafeInteger(sum)) this.overflow.add(key);
    this.totals[key] = this.overflow.has(key) ? null : sum;
    return item.state;
  }
  contribute(row: Row, stale: boolean, now: number) {
    this.coverage.eligible++;
    const usageStale = stale || (row.usage != null && !freshUsage(row, now));
    let usable = 0,
      complete = 0;
    for (const key of COUNTERS) {
      const state = this.add(row, key, usageStale);
      if (state) usable++;
      if (state === "available") complete++;
    }
    if (usageStale) this.coverage.stale++;
    else
      this.coverage[
        complete === COUNTERS.length ? "available" : usable ? "partial" : "unavailable"
      ]++;
  }
  finish() {
    const usage: ObserverSnapshot["aggregate"]["usage"] = counterMap(() => ({
      value: null,
      state: "unavailable",
    }));
    for (const key of COUNTERS) {
      const counter = this.coverage.counters[key],
        value = this.totals[key];
      usage[key] = {
        value,
        state:
          value === null
            ? "unavailable"
            : counter.partial || counter.unavailable || counter.stale || this.coverage.conflicting
              ? "partial"
              : "available",
      };
    }
    // Only contributors to published numeric counters set the browser's optional-evidence deadline.
    const observations = COUNTERS.filter((key) => usage[key].value !== null).flatMap((key) => {
      const at = this.observedAt[key];
      return at === null ? [] : [at];
    });
    return {
      usage,
      coverage: this.coverage,
      usageObservedAt: observations.length > 0 ? Math.min(...observations) : null,
    };
  }
}
