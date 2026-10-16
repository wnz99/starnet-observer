import { grouping } from "../helpers/evidence.js";
import { sameIdentity, sameProof } from "./ownership.js";
import { required } from "./required.js";
import type { State } from "./state.js";
import type { ObserverInputRow, Lineage, HelperResult } from "./contracts.js";
const MAX_ANCESTRY = 64;
export class Publication {
  private readonly candidates: Map<string, ObserverInputRow>;
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
    this.accepted = new Set([...this.candidates.keys()].filter((id) => this.valid(id)));
  }
  private validParent(id: string, parent: ObserverInputRow) {
    return (
      !(parent.identitySource === "footer" && !this.lineage.proofs.has(id)) &&
      sameIdentity(
        parent,
        this.s.coreRows.find((row) => row.id === id),
      ) &&
      sameProof(this.lineage.proofs.get(id), this.s.identityProofs.get(id))
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
    return rows.map((row) =>
      !this.lineage.failed && this.accepted.has(row.id)
        ? {
            ...row,
            ...this.result.annotations.get(row.id),
            ...this.currentGrouping(row.id),
            helperOverflow: this.result.overflow.get(row.id) || 0,
          }
        : row,
    );
  }
  children(): ObserverInputRow[] {
    return this.result.rows
      .filter((row) => this.accepted.has(row.id))
      .map((row) => ({
        ...row,
        ...(this.lineage.failed ? { inventoryHealth: "unavailable" as const } : {}),
        ...this.currentGrouping(row.id),
        helperOverflow: this.result.overflow.get(row.id) || 0,
      }));
  }
  commit() {
    // This synchronous install and row publication form a single observable commit.
    if (this.s.herdrSource.health !== "available") this.lineage.failed = true;
    this.result.commitBindings?.(this.lineage.failed ? new Set<string>() : this.accepted);
  }
}
