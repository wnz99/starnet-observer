import { readHelperEdges, MAX_EDGES } from "./edges.js";
import type { HelperEdges } from "./edges.js";
import { HelperTraversal } from "./traversal.js";
import type {
  ChildBinding,
  HelperOptions,
  HelperRow,
  HelperTranscripts,
  Root,
} from "./contracts.js";
// Persisted lineage proves a relationship, never a running task.
class HelperObserver {
  private bindings = new Map<string, ChildBinding>();
  constructor(
    private readonly transcripts: HelperTranscripts,
    private readonly now: () => number,
    private readonly readEdges: () => HelperEdges | Promise<HelperEdges>,
  ) {}
  private async source(roots: Root[]): Promise<HelperEdges> {
    if (!roots.some((row) => row.provider === "codex")) return { rows: [] };
    let source;
    try {
      source = await this.readEdges();
    } catch {
      return { reason: "unreadable" };
    }
    return source.rows && source.rows.length > MAX_EDGES ? { reason: "too-many-edges" } : source;
  }
  async prepareChildren(
    parents: HelperRow[],
    readSummary = (row: Root) => this.transcripts.read(row.id, row.provider, row.sessionId),
  ) {
    const traversal = new HelperTraversal(parents, this.transcripts, this.now);
    const graph = traversal.graph;
    const commitBindings = (ids: Set<string>) => {
      this.bindings = new Map([...traversal.bindings].filter(([id]) => ids.has(id)));
    };
    if (
      typeof this.transcripts.bindChild !== "function" ||
      typeof this.transcripts.claudeCandidates !== "function"
    )
      return {
        rows: traversal.rows,
        annotations: traversal.annotations,
        overflow: traversal.overflow,
        health: "unavailable",
        reason: "unsupported",
        commitBindings,
      };
    const roots = await graph.roots(readSummary),
      source = await this.source(roots);
    if (source.rows) graph.edges(source.rows);
    await graph.nativeRoots(roots, this.transcripts);
    await traversal.discover(roots);
    return {
      rows: traversal.rows,
      annotations: traversal.annotations,
      overflow: traversal.overflow,
      groupOwners: traversal.groupOwners,
      commitBindings,
      health: source.reason ? "unavailable" : "available",
      reason: source.reason || null,
    };
  }
  async children(parents: HelperRow[]) {
    const result = await this.prepareChildren(parents);
    result.commitBindings(
      new Set([...result.rows.map((row) => row.id), ...result.annotations.keys()]),
    );
    return result;
  }
  async inspect(row: HelperRow) {
    const binding = this.bindings.get(row.id);
    if (!binding || row.sessionId !== binding.sessionId || row.provider !== binding.provider)
      return { available: false };
    const result = await this.transcripts.inspectChild(row.id, binding);
    if (this.bindings.get(row.id) !== binding) return { available: false };
    return result.available
      ? {
          ...result,
          taskEvidence: row.taskEvidence,
          taskStatusEvidence: row.taskStatusEvidence,
          lifecycleEvidence: row.lifecycleEvidence,
        }
      : result;
  }
}
export function makeHelperObserver(options: HelperOptions = {}) {
  const { transcripts, now } = options;
  if (typeof now !== "function")
    throw new TypeError("Helper observer requires an injected now clock");
  if (!transcripts) throw new TypeError("Helper observer requires transcripts");
  const observer = new HelperObserver(
    transcripts,
    now,
    options.readEdges || (() => readHelperEdges(options)),
  );
  return {
    children: (parents: HelperRow[]) => observer.children(parents),
    prepareChildren: (
      parents: HelperRow[],
      readSummary?: (row: Root) => { available: boolean } | Promise<{ available: boolean }>,
    ) => observer.prepareChildren(parents, readSummary),
    inspect: (row: HelperRow) => observer.inspect(row),
  };
}
