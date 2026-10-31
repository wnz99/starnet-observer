import { busRecord } from "../bus/types.js";
import { identity } from "./evidence.js";
import type { Candidate, HelperRow, Root, ChildBinding, HelperTranscripts } from "./contracts.js";
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
type Prove = (
  provider: Root["provider"],
  child: string,
  parent: string,
) => Promise<ChildBinding | null>;
function validIds(parent: string, child: string) {
  return UUID.test(parent) && UUID.test(child);
}
function nativeCandidates(parent: Root, projection: ChildBinding["projection"]): Candidate[] {
  return [...(projection?.helperSpawns ?? [])].flatMap(([child, spawn]) =>
    spawn && validIds(parent.sessionId, child)
      ? [{ child, state: "unknown", spawn, event: projection?.helperEvents.get(child) ?? null }]
      : [],
  );
}
export class HelperGraph {
  private readonly native = new Map<string, ChildBinding["projection"]>();
  readonly exact = new Map<string, Root | null>();
  readonly byParent = new Map<string, Candidate[]>();
  readonly incoming = new Map<string, string>();
  readonly invalid = new Set<string>();
  constructor(parents: HelperRow[]) {
    for (const row of parents) {
      if (row.inventoryHealth !== "available" || !row.sessionId || !row.inspectionIdentity)
        continue;
      const key = identity(row);
      this.exact.set(key, this.exact.has(key) ? null : { ...row, sessionId: row.sessionId });
    }
  }
  async roots(read: (row: Root) => { available: boolean } | Promise<{ available: boolean }>) {
    const roots: Root[] = [];
    const exact = [...this.exact.values()]
      .filter((row): row is Root => row !== null)
      .sort((a, b) => identity(a).localeCompare(identity(b)));
    for (const row of exact)
      if (
        ["codex", "claude"].includes(row.provider) &&
        (row.tool?.available === true || (await read(row)).available)
      )
        roots.push(row);
    return roots;
  }
  edges(edges: unknown[]) {
    for (const edge of edges) {
      if (!busRecord(edge)) continue;
      const parent = edge.parent_thread_id,
        child = edge.child_thread_id;
      if (typeof parent !== "string" || typeof child !== "string") continue;
      if (!validIds(parent, child)) continue;
      if (edge.status !== "open" && edge.status !== "closed") {
        this.invalid.add(child);
        continue;
      }
      if (this.incoming.has(child)) this.invalid.add(child);
      this.incoming.set(child, parent);
      const candidates = this.byParent.get(parent) ?? [];
      candidates.push({ child, state: edge.status });
      this.byParent.set(parent, candidates);
    }
    this.rejectCycles();
  }
  private rejectCycles() {
    // Reject every node in a cycle, including a verified root. A visited set also bounds each traversal.
    for (const start of this.incoming.keys()) {
      const visited = new Set<string>();
      let node = start;
      while (this.incoming.has(node) && !visited.has(node)) {
        visited.add(node);
        const parent = this.incoming.get(node);
        if (!parent) break;
        node = parent;
      }
      if (visited.has(node)) for (const member of visited) this.invalid.add(member);
    }
  }
  async nativeRoots(roots: Root[], transcripts: HelperTranscripts) {
    for (const root of roots) {
      if (root.provider !== "codex") continue;
      const projection =
        (await transcripts.codexMetadata?.(root.id, root.sessionId, undefined)) ??
        transcripts.helperMetadata?.(root.id);
      this.native.set(root.id, projection);
      for (const candidate of nativeCandidates(root, projection))
        this.recordNative(root, candidate);
    }
    this.rejectCycles();
  }
  private recordNative(root: Root, candidate: Candidate) {
    const existing = this.incoming.get(candidate.child);
    if (existing) {
      if (existing !== root.sessionId) this.invalid.add(candidate.child);
      return;
    }
    this.incoming.set(candidate.child, root.sessionId);
    const candidates = this.byParent.get(root.sessionId) ?? [];
    candidates.push(candidate);
    this.byParent.set(root.sessionId, candidates);
  }
  depth(row: Root) {
    const ancestors = new Set<string>();
    let sessionId = row.sessionId;
    while (row.provider === "codex" && this.incoming.has(sessionId) && !ancestors.has(sessionId)) {
      ancestors.add(sessionId);
      const parent = this.incoming.get(sessionId);
      if (!parent) break;
      sessionId = parent;
    }
    return ancestors.size;
  }
  private chain(row: Root, observed: Map<string, Root>) {
    const chain: { child: string; parent: string }[] = [],
      seen = new Set<string>();
    let child = row.sessionId;
    while (
      row.provider === "codex" &&
      this.incoming.has(child) &&
      !seen.has(child) &&
      !this.invalid.has(child) &&
      (!this.exact.has("codex:" + child) || this.exact.get("codex:" + child))
    ) {
      seen.add(child);
      const parent = this.incoming.get(child);
      if (!parent) break;
      chain.push({ child, parent });
      const ancestor = observed.get("codex:" + parent);
      if (ancestor) return { chain, ancestor };
      child = parent;
    }
    return null;
  }
  async ownership(roots: Root[], prove: Prove) {
    const observed = new Map(roots.map((row) => [identity(row), row])),
      ownership = new Map<string, Root>();
    for (const row of roots) {
      const found = this.chain(row, observed);
      // DB edges supply candidates only. Every intervening transcript must prove
      // the chain before an observed pane loses its independent-root ownership.
      if (!found || this.invalid.has(found.ancestor.sessionId)) continue;
      let proved = true;
      for (const edge of found.chain) {
        if (!(await prove("codex", edge.child, edge.parent))) {
          proved = false;
          break;
        }
      }
      if (proved) ownership.set(row.id, ownership.get(found.ancestor.id) || found.ancestor);
    }
    return ownership;
  }
  async candidates(
    parent: Root,
    binding: ChildBinding | undefined,
    transcripts: HelperTranscripts,
  ): Promise<Candidate[]> {
    if (parent.provider === "codex") return this.codexCandidates(parent, binding, transcripts);
    const candidates =
      (await transcripts.claudeCandidates?.(parent.sessionId, binding, parent.id)) ?? [];
    return candidates.map((value) => ({ ...value, child: value.sessionId, state: "verified" }));
  }
  private async codexCandidates(
    parent: Root,
    binding: ChildBinding | undefined,
    transcripts: HelperTranscripts,
  ) {
    const candidates = new Map(
      (this.byParent.get(parent.sessionId) || []).map((candidate) => [candidate.child, candidate]),
    );
    const projection = binding
      ? ((await transcripts.codexMetadata?.(parent.id, parent.sessionId, binding)) ??
        binding.projection)
      : this.native.get(parent.id);
    // Native activity supplies candidates when the host omits SQLite edges. The
    // traversal still verifies the child's own transcript and exact parentage.
    for (const candidate of nativeCandidates(parent, projection))
      if (!candidates.has(candidate.child)) candidates.set(candidate.child, candidate);
    return [...candidates.values()].sort((a, b) => a.child.localeCompare(b.child));
  }
}
