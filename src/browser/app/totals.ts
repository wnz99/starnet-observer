import type { SpriteResource } from "../sprites/types.js";
import type { AppAggregate, AppQuerySnapshot } from "./data.js";
import type { AppNode } from "./dom.js";
import type { AppState } from "./state.js";
import { setText, type AppUi } from "./ui.js";

type CounterKey = keyof NonNullable<AppAggregate["usage"]>;
type StatusKey = keyof NonNullable<NonNullable<AppAggregate["agents"]>["statuses"]>;
const STATUS_TOTALS: readonly [StatusKey, string][] = [
  ["working", "working"],
  ["blocked", "waiting"],
  ["idle", "idle"],
  ["done", "done"],
  ["unknown", "unknown"],
];
const COUNTER_TOTALS: readonly [CounterKey, string][] = [
  ["inputTokens", "in"],
  ["outputTokens", "out"],
  ["cacheReadTokens", "cache read"],
  ["cacheWriteTokens", "cache write"],
];
function whole(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
const tally = (value: unknown) => {
  const count = whole(value);
  return count === null ? "?" : count.toLocaleString("en-US");
};
const compact = (value: number) =>
  value.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 1 });
function counterValue(item: NonNullable<AppAggregate["usage"]>[CounterKey]) {
  return item && ["available", "partial"].includes(item.state) ? whole(item.value) : null;
}
function counterNotes(
  item: NonNullable<AppAggregate["usage"]>[CounterKey],
  value: number | null,
  live: boolean,
) {
  return [
    item?.state === "partial" && value !== null ? "partial" : "",
    !live && value !== null ? "last known" : "",
  ]
    .filter(Boolean)
    .join(", ");
}
function counterKind(
  item: NonNullable<AppAggregate["usage"]>[CounterKey],
  value: number | null,
  live: boolean,
) {
  if (value === null) return "unavailable";
  return live ? item?.state : "stale";
}
function counterText(label: string, value: number | null, notes: string) {
  return (
    label + " " + (value === null ? "unavailable" : compact(value) + (notes ? " " + notes : ""))
  );
}
function shortCounter(aggregate: AppAggregate, key: CounterKey) {
  const value = counterValue(aggregate.usage?.[key]);
  return value === null ? "unavailable" : compact(value);
}
function partialCoverage(coverage: NonNullable<AppAggregate["coverage"]>) {
  return coverage.partial || coverage.unavailable || coverage.stale || coverage.conflicting;
}
function summaryPrefix(live: boolean, usageLive: boolean) {
  if (!live) return "Last known · ";
  return usageLive ? "" : "Last known tokens · ";
}
interface TotalsNodes<N> {
  list: N;
  disclosure: N;
  summary: N;
  crew: N;
  status: N;
  tokens: N;
  coverage: N;
  counters: Map<CounterKey, N>;
}
/* Station totals: the sidecar's one aggregate per refresh, shown as published and never re-added here. A counter
   without evidence is unavailable, never zero. Herdr owns status freshness; counted usage contributors own the
   separate token deadline. Both use the existing deadline render without deriving new counts in the browser. */
export class Totals<N extends AppNode, R extends SpriteResource> {
  private nodes: TotalsNodes<N> | null = null;
  constructor(
    private readonly ui: AppUi<N, R>,
    private readonly state: AppState,
  ) {}
  private getNodes() {
    if (this.nodes) return this.nodes;
    const { ui } = this;
    const list = ui.get("station-totals");
    const group = (label: string) => {
      const value = ui.text("dd", "", "");
      ui.document.attach(list, ui.text("dt", "", label), value);
      return value;
    };
    this.nodes = {
      list,
      disclosure: ui.get("station-stats"),
      summary: ui.get("station-stats-summary"),
      crew: group("Crew"),
      status: group("Status"),
      tokens: group("Tokens"),
      coverage: group("Coverage"),
      counters: new Map(),
    };
    for (const [key] of COUNTER_TOTALS) {
      const node = ui.text("span", "total-counter", "");
      ui.document.attach(this.nodes.tokens, node);
      this.nodes.counters.set(key, node);
    }
    return this.nodes;
  }
  private live(snapshot: AppQuerySnapshot) {
    const hosts = snapshot.data?.sources?.hosts;
    return hosts
      ? !this.state.isStale(snapshot) &&
          Object.values(hosts).some(
            (source) => source.health === "available" && this.state.fresh(source.observedAt),
          )
      : !this.state.sourceStale("herdr", snapshot);
  }
  private counter(key: CounterKey, label: string, aggregate: AppAggregate, usageLive: boolean) {
    const nodes = this.getNodes();
    const node = nodes.counters.get(key);
    if (!node) throw new Error("Observer counter node is unavailable");
    const item = aggregate.usage?.[key];
    const value = counterValue(item);
    const kind = counterKind(item, value, usageLive);
    const counted = aggregate.coverage?.counters?.[key] ?? {};
    const notes = counterNotes(item, value, usageLive);
    setText(node, counterText(label, value, notes));
    const className = "total-counter total-" + String(kind);
    if (node.className !== className) node.className = className;
    const hint =
      (value === null ? "" : value.toLocaleString("en-US") + " tokens · ") +
      "of " +
      tally(counted.eligible) +
      " verified sessions: " +
      tally(counted.available) +
      " complete, " +
      tally(counted.partial) +
      " partial, " +
      tally(counted.unavailable) +
      " unavailable, " +
      tally(counted.stale) +
      " stale";
    if (node.title !== hint) node.title = hint;
  }
  private summary(aggregate: AppAggregate, live: boolean, usageLive: boolean) {
    const nodes = this.getNodes();
    const agents = aggregate.agents ?? {};
    const coverage = aggregate.coverage ?? {};
    const partial = partialCoverage(coverage);
    setText(
      nodes.summary,
      summaryPrefix(live, usageLive) +
        tally(agents.observed) +
        " crew · " +
        tally(agents.statuses?.working) +
        " working · In " +
        shortCounter(aggregate, "inputTokens") +
        " / Out " +
        shortCounter(aggregate, "outputTokens") +
        (partial ? " · partial" : ""),
    );
    setText(
      nodes.coverage,
      tally(coverage.available) +
        " of " +
        tally(coverage.eligible) +
        " sessions complete · " +
        tally(coverage.partial) +
        " partial · " +
        tally(coverage.unavailable) +
        " unavailable · " +
        tally(coverage.stale) +
        " stale" +
        (coverage.conflicting
          ? " · " + tally(coverage.conflicting) + " conflicting, not counted"
          : ""),
    );
  }
  private agents(aggregate: AppAggregate, live: boolean) {
    const nodes = this.getNodes();
    const agents = aggregate.agents ?? {};
    setText(
      nodes.crew,
      tally(agents.observed) +
        " observed · " +
        tally(agents.verifiedSessions) +
        " verified · " +
        tally(agents.presenceOnly) +
        " presence only",
    );
    setText(
      nodes.status,
      (live ? "" : "last known · ") +
        STATUS_TOTALS.map(([key, label]) => tally(agents.statuses?.[key]) + " " + label).join(
          " · ",
        ) +
        (agents.stale ? " · " + tally(agents.stale) + " stale" : ""),
    );
  }
  render(snapshot: AppQuerySnapshot) {
    const aggregate = snapshot.data?.aggregate;
    const nodes = this.getNodes();
    // A sidecar that publishes no aggregate gets no totals: nothing is inferred from the roster.
    nodes.list.hidden = !aggregate;
    nodes.disclosure.hidden = !aggregate;
    if (!aggregate) return;
    const live = this.live(snapshot);
    const usageLive =
      live &&
      (!Number.isFinite(aggregate.usageObservedAt) || this.state.fresh(aggregate.usageObservedAt));
    nodes.list.dataset.freshness = live ? "live" : "stale";
    nodes.disclosure.dataset.freshness = usageLive ? "live" : "stale";
    this.agents(aggregate, live);
    for (const [key, label] of COUNTER_TOTALS) this.counter(key, label, aggregate, usageLive);
    this.summary(aggregate, live, usageLive);
  }
}
