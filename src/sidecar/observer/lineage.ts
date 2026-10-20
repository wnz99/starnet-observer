import { grouping } from "../helpers/evidence.js";
import { sameIdentity, sameProof } from "./ownership.js";
import { required } from "./required.js";
import type { State } from "./state.js";
import type { ObserverInputRow, Lineage, HelperResult, PublishedLineage } from "./contracts.js";
import type { FooterProof } from "../identity/types.js";
const MAX_ANCESTRY = 64;
export class Publication {
  private readonly candidates: Map<string, ObserverInputRow>;
  private readonly historical: Map<string, ObserverInputRow>;
  private readonly previous: PublishedLineage | null;
  private readonly retained: Set<string>;
  private readonly result: HelperResult;
  readonly accepted: Set<string>;
  constructor(
    private readonly s: State,
    private readonly lineage: Lineage,
    roots: ObserverInputRow[],
  ) {
    this.result = lineage.result;
    this.candidates = new Map([
      ...roots.map((row): [string, ObserverInputRow] => [
        row.id,
        { ...row, ...lineage.result.annotations.get(row.id) },
      ]),
      ...lineage.result.rows.map((row): [string, ObserverInputRow] => [row.id, row]),
    ]);
    this.previous = s.publishedLineage;
    this.historical = new Map(this.previous?.rows.map((row) => [row.id, row]));
    // Once an observation loses its owner, recovery needs a new successful sweep.
    // Remembering its presentation must never reactivate the old binding commit.
    this.lineage.withdrawn ??= new Set<string>();
    for (const parent of lineage.parents)
      if (this.classify(parent, lineage.proofs.get(parent.id)) !== "current")
        this.lineage.withdrawn.add(parent.id);
    this.accepted = new Set(
      this.lineage.failed ? [] : [...this.candidates.keys()].filter((id) => this.valid(id)),
    );
    this.retained = new Set([...this.historical.keys()].filter((id) => this.retainHistory(id)));
  }
  private classify(
    parent: ObserverInputRow,
    proof: FooterProof | undefined,
  ): "current" | "uncertain" | "replaced" {
    const live = this.s.coreRows.find((row) => row.id === parent.id);
    if (this.s.herdrSource.health !== "available") return "uncertain";
    if (!live) return "replaced";
    const currentProof = this.s.identityProofs.get(parent.id);
    if (this.replaced(parent, live, proof)) return "replaced";
    return parent.inspectionIdentity &&
      sameIdentity(parent, live) &&
      !(parent.identitySource === "footer" && !proof) &&
      sameProof(proof, currentProof)
      ? "current"
      : "uncertain";
  }
  private replaced(
    parent: ObserverInputRow,
    live: ObserverInputRow,
    proof: FooterProof | undefined,
  ) {
    const currentProof = this.s.identityProofs.get(parent.id);
    return (
      live.provider !== parent.provider ||
      live.source !== parent.source ||
      !!(live.inspectionIdentity && live.inspectionIdentity !== parent.inspectionIdentity) ||
      !!(live.sessionId && live.sessionId !== parent.sessionId) ||
      !!(currentProof && !sameProof(proof, currentProof))
    );
  }
  private retainHistory(id: string, seen = new Set<string>()): boolean {
    const row = this.historical.get(id);
    if (!row || seen.has(id) || seen.size >= MAX_ANCESTRY || this.accepted.has(id)) return false;
    const visited = new Set(seen).add(id);
    if (row.source !== "helper" && this.classify(row, this.previous?.proofs.get(id)) === "replaced")
      return false;
    return this.retainLinks(row, visited);
  }
  private retainLinks(row: ObserverInputRow, visited: Set<string>): boolean {
    const owner = this.previous?.groupOwners.get(row.id);
    if (owner && !this.retainHistory(owner, new Set(visited))) return false;
    return Object.hasOwn(row, "parentId")
      ? typeof row.parentId === "string" && this.retainHistory(row.parentId, visited)
      : row.source !== "helper";
  }
  private validParent(id: string, parent: ObserverInputRow) {
    return (
      !this.lineage.withdrawn?.has(id) &&
      this.classify(parent, this.lineage.proofs.get(id)) === "current"
    );
  }
  private valid(id: string | null | undefined, seen = new Set<string>()): boolean {
    if (typeof id !== "string") return false;
    const row = this.candidates.get(id);
    if (!row || seen.has(id) || seen.size >= MAX_ANCESTRY) return false;
    const visited = new Set(seen).add(id);
    const parent = this.lineage.parents.find((value) => value.id === id);
    if (parent && !this.validParent(id, parent)) return false;
    if (!parent && row.source !== "helper") return false;
    return this.validLinks(row, visited, parent);
  }
  private validLinks(
    row: ObserverInputRow,
    visited: Set<string>,
    parent: ObserverInputRow | undefined,
  ) {
    const ownerId = this.result.groupOwners?.get(row.id);
    if (ownerId && !this.valid(ownerId, new Set(visited))) return false;
    return Object.hasOwn(row, "parentId") ? this.valid(row.parentId, visited) : !!parent;
  }
  private currentGrouping(id: string): ReturnType<typeof grouping> {
    const row = required(this.candidates.get(id)),
      ownerId = row.parentId || this.result.groupOwners?.get(id);
    return ownerId
      ? this.currentGrouping(ownerId)
      : grouping(required(this.s.coreRows.find((value) => value.id === id)));
  }
  roots(rows: ObserverInputRow[]) {
    return rows.map((row) => {
      if (this.accepted.has(row.id))
        return {
          ...row,
          ...this.result.annotations.get(row.id),
          ...this.currentGrouping(row.id),
          helperOverflow: this.result.overflow.get(row.id) || 0,
        };
      const previous = this.historical.get(row.id);
      // Native inventory owns status, identity and observation time. Only its
      // last-known relationship and grouping survive an uncertain ancestor.
      return previous && this.retained.has(row.id) && this.previous?.annotated.has(row.id)
        ? { ...previous, ...row, ...grouping(previous), helperOverflow: previous.helperOverflow }
        : row;
    });
  }
  children(): ObserverInputRow[] {
    const current = this.result.rows
      .filter((row) => this.accepted.has(row.id))
      .map((row) => ({
        ...row,
        ...this.currentGrouping(row.id),
        helperOverflow: this.result.overflow.get(row.id) || 0,
      }));
    const historical = [...this.historical.values()]
      .filter((row) => row.source === "helper" && this.retained.has(row.id))
      .map((row) => ({ ...row, inventoryHealth: "unavailable" as const }));
    return [...current, ...historical].slice(0, MAX_ANCESTRY);
  }
  commit() {
    // This synchronous install and row publication form a single observable commit.
    if (this.s.herdrSource.health !== "available") this.lineage.failed = true;
    const rows = [
      ...[...this.candidates.values()]
        .filter((row) => row.source !== "helper" && this.accepted.has(row.id))
        .map((row) => ({
          ...row,
          ...this.currentGrouping(row.id),
          helperOverflow: this.result.overflow.get(row.id) || 0,
        })),
      ...[...this.historical.values()].filter(
        (row) => row.source !== "helper" && this.retained.has(row.id),
      ),
      ...this.children(),
    ];
    const ids = new Set(rows.map((row) => row.id));
    this.result.commitBindings?.(new Set([...this.accepted].filter((id) => ids.has(id))));
    this.s.publishedLineage = {
      rows,
      proofs: new Map(
        [
          ...[...(this.previous?.proofs || [])].filter(([id]) => !this.accepted.has(id)),
          ...[...this.lineage.proofs].filter(([id]) => this.accepted.has(id)),
        ].filter(([id]) => ids.has(id)),
      ),
      groupOwners: new Map(
        [
          ...[...(this.previous?.groupOwners || [])].filter(([id]) => !this.accepted.has(id)),
          ...[...(this.result.groupOwners || [])].filter(([id]) => this.accepted.has(id)),
        ].filter(([id]) => ids.has(id)),
      ),
      annotated: new Set([
        ...[...(this.previous?.annotated || [])].filter((id) => this.retained.has(id)),
        ...[...this.accepted].filter((id) => this.hasAnnotation(id)),
      ]),
    };
  }
  private hasAnnotation(id: string) {
    return (
      this.result.annotations.has(id) ||
      this.result.groupOwners?.has(id) ||
      this.result.overflow.has(id)
    );
  }
}
