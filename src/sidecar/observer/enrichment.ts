import type { State } from "./state.js";
import type { Sweep, Tool, Row } from "./contracts.js";
import { currentOwner, sameIdentity, sameProof } from "./ownership.js";
import { required } from "./required.js";
const SUMMARY_CONCURRENCY = 4;
type Summaries = Map<string, ReturnType<Enrichment["deferred"]>>;
export class Enrichment {
  constructor(private readonly state: State) {}
  deferred() {
    let finish: (tool: Tool) => void = () => {
      throw new Error("Summary not initialized");
    };
    const promise = new Promise<Tool>((resolve) => {
      finish = resolve;
    });
    return { promise, resolve: finish };
  }
  private observedTool(tool: Tool, readAt: number) {
    const observedAt = tool.usage?.observedAt ?? readAt;
    const usage = tool.usage;
    return {
      observedAt,
      tool:
        usage && (usage.observedAt === null || usage.observedAt === undefined)
          ? { ...tool, usage: { ...usage, observedAt } }
          : tool,
    };
  }
  async readSummary(target: Sweep, row: Row, results: Summaries) {
    const result = required(results.get(row.id)),
      owners = target.owners.get(row.id);
    if (row.inspectionIdentity && !currentOwner(this.state, owners)) {
      result.resolve({ available: false });
      return;
    }
    const readAt = this.state.now();
    let tool: Tool;
    try {
      tool = await required(this.state.transcripts.read).call(
        this.state.transcripts,
        row.id,
        row.provider,
        row.sessionId,
      );
    } catch {
      tool = { available: false };
    }
    result.resolve(tool);
    if (this.state.closed || !currentOwner(this.state, owners)) return;
    // Timestamp-less injected adapters use the captured read start, never a later core poll.
    const observed = this.observedTool(tool, readAt);
    this.state.summaries.set(row.id, { owners, ...observed });
    this.state.publication.publish();
    this.state.warmup.scheduleWarmup(target);
  }
  async summaries(target: Sweep, results: Summaries) {
    const rows = target.parents.values();
    const next = async () => {
      for (let entry = rows.next(); !this.state.closed && !entry.done; entry = rows.next())
        await this.readSummary(target, entry.value, results);
    };
    try {
      await Promise.all(
        Array.from({ length: Math.min(SUMMARY_CONCURRENCY, target.parents.length) }, next),
      );
    } finally {
      // Closed sweeps may leave queued rows unread. Never strand helper work.
      for (const result of results.values()) result.resolve({ available: false });
    }
  }
  async helperWork(target: Sweep, results: Summaries) {
    try {
      const result = await (this.state.helpers.prepareChildren
        ? this.state.helpers.prepareChildren(target.parents, async (row) => {
            const tool = await required(results.get(row.id)).promise;
            return !this.state.closed && currentOwner(this.state, target.owners.get(row.id))
              ? tool
              : { available: false };
          })
        : required(this.state.helpers.children).call(this.state.helpers, target.parents));
      if (this.state.closed) return;
      if (result.health === "unavailable" && result.reason !== "unsupported") {
        result.commitBindings?.(new Set<string>());
        if (this.state.lineage) this.state.lineage.failed = true;
      } else this.state.lineage = { ...target, result };
      this.state.publication.publish();
      this.state.warmup.scheduleWarmup(target);
    } catch {
      if (!this.state.closed) {
        if (this.state.lineage) this.state.lineage.failed = true;
        this.state.publication.publish();
      }
    }
  }
  sameSweep(target: Sweep, next: Sweep) {
    return (
      target.parents.length === next.parents.length &&
      target.parents.every(
        (row, index) =>
          sameIdentity(row, next.parents[index]) &&
          sameProof(target.proofs.get(row.id), next.proofs.get(row.id)),
      )
    );
  }
  startEnrichment() {
    if (this.state.closed || this.state.enrichment || !this.state.enrichmentTarget) return;
    const target = this.state.enrichmentTarget;
    this.state.enrichmentTarget = null;
    this.state.transcripts.beginDiscovery?.();
    // Helper root eligibility consumes this sweep's bounded reads, including failures, instead of starting distinct reads in its own identity order.
    const results = new Map(target.parents.map((row) => [row.id, this.deferred()]));
    this.state.enrichment = Promise.all([
      this.summaries(target, results),
      this.helperWork(target, results),
    ]).finally(() => {
      this.state.enrichment = null;
      // A newer core only needs another sweep when its owner actually changed.
      if (this.state.enrichmentTarget && this.sameSweep(target, this.state.enrichmentTarget))
        this.state.enrichmentTarget = null;
      this.startEnrichment();
    });
  }
}
