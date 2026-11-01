import type { HelperPhase } from "../scene/types.js";
import { record } from "../theme/validation.js";
import type { AppQuerySnapshot, AppRow } from "./data.js";
import { FRESH_MS, type AppState } from "./state.js";

export function geometryField(name: string, value: unknown) {
  if (name !== "row" || !record(value)) return value;
  const lifecycle = record(value.lifecycleEvidence) ? value.lifecycleEvidence : null;
  return [
    value.id,
    value.status,
    value.provider,
    value.worktree,
    value.checkoutId,
    value.checkoutKind,
    value.folder,
    value.lineageState,
    lifecycle?.state,
  ];
}

interface Domain {
  at: number;
  valid: boolean;
  rows: Map<string, AppRow>;
}
interface Transition {
  row: AppRow;
  domain: string;
  phase: "entering" | "returning";
}
const LIMIT = { transitions: 64, tombstones: 256 };
const domainFor = (row: AppRow) => (row.host ? "host:" + row.host : "herdr");
const synthetic = (row: AppRow) => row.source === "helper" && !row.paneId;
const closed = (row: AppRow) =>
  row.lifecycleEvidence?.state === "closed" || row.lineageState === "closed";
const sameParent = (a: AppRow, b: AppRow) =>
  a.parentId === b.parentId &&
  a.projectId === b.projectId &&
  a.host === b.host &&
  a.checkoutId === b.checkoutId &&
  a.folder === b.folder;

export class HelperPresentation {
  private readonly domains = new Map<string, Domain>();
  private readonly transitions = new Map<string, Transition>();
  private readonly tombstones = new Set<string>();
  private current = new Set<string>();
  constructor(private readonly state: Pick<AppState, "isStale" | "rowStale">) {}
  private source(domain: string, snapshot: AppQuerySnapshot, now: number) {
    const data = snapshot.data;
    const local = data?.sources ? data.sources.herdr : data;
    const source = domain === "herdr" ? local : this.remoteSource(domain, snapshot);
    const at = source?.observedAt;
    if (this.state.isStale(snapshot) || source?.health !== "available") return undefined;
    return this.freshTime(at, now) ? at : undefined;
  }
  private remoteSource(domain: string, snapshot: AppQuerySnapshot) {
    const sources = snapshot.data?.sources;
    return sources?.hosts?.[domain.slice("host:".length)];
  }
  private freshTime(at: unknown, now: number): at is number {
    return typeof at === "number" && Number.isFinite(at) && at <= now && now - at <= FRESH_MS;
  }
  private remember(id: string) {
    this.tombstones.add(id);
    while (this.tombstones.size > LIMIT.tombstones) {
      const first = this.tombstones.values().next().value;
      if (first !== undefined) this.tombstones.delete(first);
    }
  }
  private start(row: AppRow, phase: Transition["phase"]) {
    this.transitions.set(row.id, { row, phase, domain: domainFor(row) });
    while (this.transitions.size > LIMIT.transitions) {
      const first = this.transitions.entries().next().value;
      if (first) this.settle(first[0], first[1].phase);
    }
  }
  private settleDomain(domain: string) {
    for (const [id, transition] of this.transitions)
      if (transition.domain === domain) this.settle(id, transition.phase);
  }
  private observe(
    domain: string,
    rows: readonly AppRow[],
    snapshot: AppQuerySnapshot,
    now: number,
  ) {
    const at = this.source(domain, snapshot, now);
    let prior = this.domains.get(domain);
    if (at === undefined) {
      if (prior) prior.valid = false;
      return;
    }
    const seed = this.needsBaseline(prior, at);
    if (seed) this.settleDomain(domain);
    if (!seed && prior?.at === at) return;
    const accepted = new Map(
      rows
        .filter(
          (row) =>
            synthetic(row) && domainFor(row) === domain && !this.state.rowStale(row, snapshot),
        )
        .map((row) => [row.id, row]),
    );
    for (const row of accepted.values()) this.accept(row, prior, seed, at);
    prior = { at, valid: true, rows: accepted };
    this.domains.set(domain, prior);
  }
  private needsBaseline(prior: Domain | undefined, at: number) {
    return !prior?.valid || at < prior.at || at - prior.at > FRESH_MS;
  }
  private accept(row: AppRow, prior: Domain | undefined, seed: boolean, at: number) {
    const old = prior?.rows.get(row.id),
      transition = this.transitions.get(row.id);
    if (transition && !sameParent(transition.row, row)) this.transitions.delete(row.id);
    if (this.tombstones.has(row.id)) return;
    if (closed(row)) this.acceptClosure(row, old, seed);
    else if (!seed && !old && !transition) this.acceptBirth(row, prior, at);
  }
  private acceptBirth(row: AppRow, prior: Domain | undefined, at: number) {
    if (this.birth(row, prior?.at ?? at, at)) this.start(row, "entering");
  }
  private acceptClosure(row: AppRow, old: AppRow | undefined, seed: boolean) {
    if (!seed && old && !closed(old) && sameParent(old, row)) this.start(row, "returning");
    else {
      const returning = this.transitions.get(row.id);
      if (returning?.phase === "returning") returning.row = row;
      else this.remember(row.id);
    }
  }
  private birth(row: AppRow, previous: number, at: number) {
    const evidence = row.taskEvidence,
      born = evidence?.observedAt;
    if (!evidence?.source || !["available", "partial"].includes(evidence.state ?? "")) return false;
    return (
      ["open", "verified"].includes(row.lineageState ?? "") &&
      this.freshTime(born, at) &&
      born > previous
    );
  }
  reconcile(
    rows: readonly AppRow[],
    { snapshot, now }: { snapshot: AppQuerySnapshot; now: number },
  ): AppRow[] {
    const domains = this.mappedDomains(snapshot);
    for (const row of rows) if (synthetic(row)) domains.add(domainFor(row));
    for (const transition of this.transitions.values()) domains.add(transition.domain);
    for (const domain of domains) this.observe(domain, rows, snapshot, now);
    this.cancelRemoved(rows);
    const output = this.output(rows);
    this.current = new Set(output.filter(synthetic).map((row) => row.id));
    this.prune(snapshot);
    return output;
  }
  private cancelRemoved(rows: readonly AppRow[]) {
    const byId = new Map(rows.map((row) => [row.id, row]));
    for (const [id, transition] of this.transitions) {
      const row = byId.get(id);
      const absent = !row && transition.phase === "entering";
      if (
        absent ||
        !byId.has(transition.row.parentId ?? "") ||
        (row && !sameParent(transition.row, row))
      ) {
        this.transitions.delete(id);
        if (transition.phase === "returning") this.remember(id);
      }
    }
  }
  private eligible(row: AppRow) {
    return (
      !synthetic(row) ||
      (!this.tombstones.has(row.id) &&
        (!closed(row) ||
          this.current.has(row.id) ||
          this.transitions.get(row.id)?.phase === "returning"))
    );
  }
  private output(rows: readonly AppRow[]) {
    const byId = new Set(rows.map((row) => row.id));
    const output = rows
      .filter((row) => this.eligible(row))
      .map((row) => {
        const transition = this.transitions.get(row.id);
        return transition?.phase === "returning" ? transition.row : row;
      });
    for (const [id, transition] of this.transitions)
      if (!byId.has(id) && transition.phase === "returning") output.push(transition.row);
    return output;
  }
  private mappedDomains(snapshot: AppQuerySnapshot) {
    return new Set([
      "herdr",
      ...Object.keys(snapshot.data?.sources?.hosts ?? {}).map((host) => "host:" + host),
    ]);
  }
  private prune(snapshot: AppQuerySnapshot) {
    const mapped = this.mappedDomains(snapshot);
    for (const domain of this.domains.keys())
      if (
        !mapped.has(domain) &&
        ![...this.transitions.values()].some((value) => value.domain === domain)
      )
        this.domains.delete(domain);
  }
  phase(id: string): HelperPhase | undefined {
    return this.transitions.get(id)?.phase ?? (this.current.has(id) ? "present" : undefined);
  }
  returnStale(id: string, snapshot: AppQuerySnapshot, now: number): boolean | undefined {
    const transition = this.transitions.get(id);
    if (transition?.phase !== "returning" || snapshot.data?.sessions.some((row) => row.id === id))
      return undefined;
    return this.source(transition.domain, snapshot, now) === undefined;
  }
  settle(id: string, phase: "entering" | "returning"): boolean {
    if (this.transitions.get(id)?.phase !== phase) return false;
    this.transitions.delete(id);
    if (phase === "returning") {
      this.remember(id);
      this.current.delete(id);
    }
    return true;
  }
  settleOffPage(ids: ReadonlySet<string>) {
    let changed = false;
    for (const [id, transition] of this.transitions)
      if (!ids.has(id)) changed = this.settle(id, transition.phase) || changed;
    return changed;
  }
  reset() {
    this.domains.clear();
    this.transitions.clear();
    this.tombstones.clear();
    this.current.clear();
  }
  dispose() {
    this.reset();
  }
}
