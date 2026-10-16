import { grouping, helperId, identity, lineage, ownStatus } from "./evidence.js";
import { HelperGraph } from "./graph.js";
import type {
  Ancestor,
  Candidate,
  ChildBinding,
  HelperRow,
  HelperTranscripts,
  Root,
} from "./contracts.js";
const MAX_HELPERS = 64;
const MAX_DEPTH = 3;
const NEARBY = 8;
export class HelperTraversal {
  readonly rows: Root[] = [];
  readonly annotations = new Map<string, ReturnType<typeof grouping> & Partial<HelperRow>>();
  readonly overflow = new Map<string, number>();
  readonly bindings = new Map<string, ChildBinding>();
  readonly groupOwners = new Map<string, string>();
  private readonly parents = new Map<string, string>();
  private readonly ambiguous = new Set<string>();
  private readonly capped = new Map<string, number>();
  private readonly proved = new Map<string, ChildBinding | null>();
  private accepted = 0;
  readonly graph: HelperGraph;
  constructor(
    parents: HelperRow[],
    readonly transcripts: HelperTranscripts,
    readonly now: () => number,
  ) {
    this.graph = new HelperGraph(parents);
  }
  async prove(
    provider: Root["provider"],
    child: string,
    parent: string,
    candidate?: Pick<Candidate, "file" | "spawn">,
  ) {
    const key = JSON.stringify([provider, child, parent, candidate?.file || null]);
    if (!this.proved.has(key))
      this.proved.set(
        key,
        (await this.transcripts.bindChild?.(
          provider,
          child,
          parent,
          candidate?.file,
          candidate?.spawn,
        )) ?? null,
      );
    return this.proved.get(key) ?? null;
  }
  private ambiguousClaim(
    id: string,
    binding: ChildBinding,
    claim: { candidate: Candidate; parent: Root; ancestors: Ancestor[] },
  ) {
    const { candidate, parent, ancestors } = claim;
    if (
      parent.provider === "claude" &&
      ancestors.some(
        (ancestor) =>
          ancestor.canonical === binding.parentSessionId &&
          (!ancestor.claims?.available || ancestor.claims.has(candidate.child)),
      )
    ) {
      this.ambiguous.add(id);
      if (this.bindings.delete(id)) this.accepted--;
      this.annotations.delete(id);
      return true;
    }
    if (this.ambiguous.has(id)) return true;
    if (!this.bindings.has(id)) return false;
    if (this.parents.get(id) !== parent.id) {
      this.ambiguous.add(id);
      this.bindings.delete(id);
      this.annotations.delete(id);
      this.accepted--;
    }
    return true;
  }
  private rejected(parent: Root, candidate: Candidate, ancestry: Set<string>) {
    const key =
      parent.provider +
      ":" +
      (parent.provider === "claude" ? (candidate.canonical ?? "undefined") + ":" : "") +
      candidate.child;
    return (
      (parent.provider === "codex" && this.graph.invalid.has(candidate.child)) ||
      ancestry.has(key) ||
      (this.graph.exact.has(key) && !this.graph.exact.get(key))
    );
  }
  private admit(parent: Root, binding: ChildBinding, candidate: Candidate, ancestors: Ancestor[]) {
    const key =
      parent.provider +
      ":" +
      (parent.provider === "claude" ? (candidate.canonical ?? "undefined") + ":" : "") +
      candidate.child;
    const existing = this.graph.exact.get(key),
      id = existing?.id || helperId(binding);
    if (this.ambiguousClaim(id, binding, { candidate, parent, ancestors })) return null;
    if (this.accepted >= MAX_HELPERS) {
      this.capped.set(parent.id, (this.capped.get(parent.id) || 0) + 1);
      return null;
    }
    this.parents.set(id, parent.id);
    this.bindings.set(id, binding);
    this.accepted++;
    const { child, value } = this.child(parent, binding, candidate, { id, existing });
    if (existing) this.annotations.set(id, value);
    else this.rows.push(child);
    return child;
  }
  private child(
    parent: Root,
    binding: ChildBinding,
    candidate: Candidate,
    match: { id: string; existing: Root | null | undefined },
  ) {
    const { id, existing } = match;
    const parentBinding = this.bindings.get(parent.id);
    const projection = parentBinding?.projection || this.transcripts.helperMetadata?.(parent.id);
    const evidence = lineage(parent, binding, candidate, projection);
    const child: Root = existing
      ? { ...existing, ...evidence.value }
      : {
          id,
          provider: parent.provider,
          sessionId: candidate.child,
          title: binding.nickname || "Helper",
          source: "helper",
          presence: "verified-lineage",
          status: ownStatus(
            evidence.status,
            this.now(),
            parent.provider === "claude" ? binding.projection?.lastActivityAt : null,
          ),
          tool: { available: false },
          observedAt: this.now(),
          inventoryHealth: "available",
          inspectionIdentity: "helper:" + id,
          ...evidence.value,
        };
    return { child, value: evidence.value };
  }
  private stopped(parent: Root, depth: number, visited: Set<string>) {
    return (
      depth >= MAX_DEPTH ||
      visited.has(identity(parent)) ||
      (parent.provider === "codex" && this.graph.invalid.has(parent.sessionId))
    );
  }
  private ancestry(parent: Root, visited: Set<string>, binding: ChildBinding | undefined) {
    const ancestry = new Set(visited);
    ancestry.add(
      parent.provider === "claude" && binding
        ? "claude:" + binding.parentSessionId + ":" + parent.sessionId
        : identity(parent),
    );
    return ancestry;
  }
  private ancestors(parent: Root, ancestors: Ancestor[], binding: ChildBinding | undefined) {
    if (parent.provider !== "claude") return [];
    return [
      ...ancestors,
      {
        canonical: binding?.parentSessionId || parent.sessionId,
        claims: this.transcripts.claudeClaims?.(parent.id),
      },
    ];
  }
  async visit(parent: Root, depth: number, visited: Set<string>, ancestors: Ancestor[] = []) {
    if (this.stopped(parent, depth, visited)) return;
    const binding = this.bindings.get(parent.id);
    const ancestry = this.ancestry(parent, visited, binding);
    const candidates = await this.graph.candidates(parent, binding, this.transcripts);
    const next = this.ancestors(parent, ancestors, binding);
    for (const candidate of candidates) {
      if (this.rejected(parent, candidate, ancestry)) continue;
      const proved = await this.prove(
        parent.provider,
        candidate.child,
        candidate.canonical || parent.sessionId,
        candidate,
      );
      if (!proved) continue;
      const child = this.admit(parent, proved, candidate, ancestors);
      if (!child) continue;
      await this.visit(child, depth + 1, ancestry, next);
    }
  }
  async discover(input: Root[]) {
    const roots = input.slice();
    // Visit ancestors first so an independently observed child cannot claim its
    // descendants using its old room before the parent supplies inherited grouping.
    roots.sort(
      (a, b) => this.graph.depth(a) - this.graph.depth(b) || identity(a).localeCompare(identity(b)),
    );
    const ownership = await this.graph.ownership(roots, (provider, child, parent) =>
      this.prove(provider, child, parent),
    );
    for (const parent of roots) {
      // Proved ownership suppresses independent rediscovery of an ancestor's subtree.
      if (!this.bindings.has(parent.id) && !ownership.has(parent.id))
        await this.visit(parent, 0, new Set());
    }
    for (const [id, root] of ownership) {
      // A depth or total limit may omit an authoritative pane from the represented
      // subtree. Keep its proved grouping without advertising a helper parent.
      if (!this.bindings.has(id)) {
        this.annotations.set(id, grouping(root));
        this.groupOwners.set(id, root.id);
      }
    }
    this.removeAmbiguous();
    this.slots();
  }
  private removeAmbiguous() {
    // Conflicting direct-parent claims cannot leave a guessed child or orphaned subtree.
    let removed = true;
    while (removed) {
      removed = false;
      for (const [id, parent] of this.parents) {
        if (this.ambiguous.has(parent) && !this.ambiguous.has(id)) {
          this.ambiguous.add(id);
          this.bindings.delete(id);
          this.annotations.delete(id);
          removed = true;
        }
      }
    }
    for (let index = this.rows.length - 1; index >= 0; index--) {
      const row = this.rows[index];
      if (row && this.ambiguous.has(row.id)) this.rows.splice(index, 1);
    }
  }
  private slots() {
    const represented = new Map<string, number>();
    for (const item of [...this.rows, ...this.annotations.values()]) {
      if (item.parentId) {
        const count = (represented.get(item.parentId) || 0) + 1;
        represented.set(item.parentId, count);
        item.helperSlot = count <= NEARBY ? count - 1 : null;
      }
    }
    for (const parent of new Set([...represented.keys(), ...this.capped.keys()])) {
      const count =
        Math.max(0, (represented.get(parent) || 0) - NEARBY) + (this.capped.get(parent) || 0);
      if (count) this.overflow.set(parent, count);
    }
  }
}
