import type { State } from "./state.js";
import type { Row } from "./contracts.js";
import { currentOwner } from "./ownership.js";
import { Publication } from "./lineage.js";
export class Publisher {
  constructor(private readonly state: State) {}
  retain() {
    const retained = new Set(
      this.state.lastGood.filter((row) => row.source !== "desktop").map((row) => row.id),
    );
    this.state.transcripts.retain(retained);
    for (const id of this.state.summaries.keys())
      if (!retained.has(id)) this.state.summaries.delete(id);
    for (const id of this.state.warmScheduled.keys())
      if (!retained.has(id)) this.state.warmScheduled.delete(id);
    for (const [id, target] of this.state.warmQueue)
      if (!currentOwner(this.state, target.owners)) this.state.warmQueue.delete(id);
  }
  publish() {
    if (this.state.closed) return;
    let roots = this.state.coreRows.map((row) => {
      if (row.inventoryHealth === "available") return row;
      const previous = this.state.rowsBySource.herdr.find((value) => value.id === row.id);
      return { ...row, tool: previous?.tool || row.tool, usage: previous?.usage || null };
    });
    let children: Row[] =
      this.state.sources.herdr.health === "available"
        ? []
        : this.state.rowsBySource.helper.map((row) => ({ ...row, inventoryHealth: "unavailable" }));
    if (this.state.lineage) {
      const publication = new Publication(this.state, this.state.lineage, roots);
      roots = publication.roots(roots);
      if (this.state.sources.herdr.health === "available") children = publication.children();
      publication.commit();
    }
    const roster = [...roots, ...children];
    roots = roots.map((row) => {
      const summary = this.state.summaries.get(row.id);
      return summary && currentOwner(this.state, summary.owners, roster)
        ? { ...row, tool: summary.tool, usage: summary.tool.usage || null }
        : row;
    });
    this.state.rowsBySource.herdr = roots;
    this.state.rowsBySource.helper = children;
    this.state.lastGood = [...roots, ...this.state.rowsBySource.desktop, ...children];
    this.retain();
  }
}
