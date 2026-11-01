import type { AppQuerySnapshot, AppSnapshot } from "./data.js";
import type { AppScheduler } from "./dom.js";
import { FRESH_MS, type AppState } from "./state.js";
import { CHECKOUT_AGE } from "../model/checkout-age.js";

function observationTimes(data: AppSnapshot) {
  const sources = data.sources;
  return [
    data.observedAt,
    sources?.herdr?.observedAt,
    sources?.desktop?.observedAt,
    ...Object.values(sources?.hosts ?? {}).map((source) => source.observedAt),
    ...data.sessions.flatMap((row) => [row.observedAt, row.tool?.observedAt]),
    data.aggregate?.usageObservedAt,
  ];
}
function checkoutDeadlines(data: AppSnapshot, now: number) {
  return data.sessions.flatMap(({ checkoutObservation: observation }) => {
    if (
      observation?.source !== "shell-entry" ||
      !Number.isSafeInteger(observation.observedAt) ||
      observation.observedAt <= 0
    )
      return [];
    return [CHECKOUT_AGE.future, CHECKOUT_AGE.stale + 1, CHECKOUT_AGE.expiry + 1]
      .map((age) => observation.observedAt + age)
      .filter((due) => due > now);
  });
}
/* One deadline per observation: the moment it turns stale, even during the entire time its next request remains pending. */
export class FreshnessDeadline {
  private cancel: (() => void) | null = null;
  private generation = 0;
  constructor(
    private readonly options: {
      state: AppState;
      scheduler: AppScheduler;
      now(): number;
      hasMailPanel(): boolean;
      render(): void;
    },
  ) {}
  private current(generation: number) {
    const { state } = this.options;
    return generation === this.generation && !state.disposed && state.active;
  }
  arm(snapshot: AppQuerySnapshot) {
    this.clear();
    const { state } = this.options;
    // An open mail panel depends on the transport proof, which expires on the same clock even with every agent source down.
    const mail = state.busLive(snapshot) && this.options.hasMailPanel();
    if (!state.active || !snapshot.data) return;
    // Inventory, optional tools, counted usage and mail proofs expire on their original source clocks.
    const times = [
      ...(state.isStale(snapshot) ? [] : observationTimes(snapshot.data)),
      ...(mail ? [snapshot.updatedAt] : []),
    ].filter((at): at is number => state.fresh(at));
    const now = this.options.now();
    const deadlines = [
      ...times.map((at) => at + FRESH_MS + 1),
      ...checkoutDeadlines(snapshot.data, now),
    ];
    // Checkout evidence keeps its own source clock after inventory animation has frozen.
    if (deadlines.length === 0) return;
    const generation = this.generation;
    const cancel = this.options.scheduler.timeout(
      () => {
        if (!this.current(generation)) return;
        this.cancel = null;
        if (!state.disposed && state.active && state.latest) this.options.render();
      },
      Math.max(0, Math.min(...deadlines) - now),
    );
    if (this.current(generation)) this.cancel = cancel;
    else cancel();
  }
  clear() {
    this.generation++;
    const cancel = this.cancel;
    this.cancel = null;
    cancel?.();
  }
}
