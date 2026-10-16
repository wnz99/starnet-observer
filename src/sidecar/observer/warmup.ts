import type { Row, Sweep } from "./contracts.js";
import type { State } from "./state.js";
import { capture } from "./ownership.js";
import { currentOwner } from "./ownership.js";
import { inspect } from "./inspection.js";
export class Warmup {
  constructor(private readonly state: State) {}
  expected(row: Row) {
    return (
      row.inspectionIdentity +
      (row.source === "helper" || Object.hasOwn(row, "parentId") ? "|" + row.parentId : "")
    );
  }
  scheduleWarmup(sweep: Sweep) {
    if (this.state.closed || this.state.options.warmDetails === false) return;
    let count = 0;
    for (const row of this.state.lastGood) {
      if (
        row.source === "desktop" ||
        !row.inspectionIdentity ||
        row.inventoryHealth !== "available" ||
        (row.source !== "helper" && !row.tool?.available)
      )
        continue;
      if (count++ >= 32) break;
      const owners = capture(this.state, row);
      if (!owners) continue;
      const key = JSON.stringify(
        owners.map(({ row, proof }) => [
          row.id,
          row.provider,
          row.sessionId,
          row.inspectionIdentity,
          row.source,
          row.identitySource,
          row.parentId,
          proof?.terminalId,
          proof?.sessionId,
          proof?.birth?.pid,
          proof?.birth?.startSeconds,
          proof?.birth?.startMicroseconds,
        ]),
      );
      if (sweep.warmed.has(key) || sweep.warmed.size >= 32) continue;
      const previous = this.state.warmScheduled.get(row.id);
      if (previous?.key === key && this.state.now() - previous.at < 60000) continue;
      sweep.warmed.add(key);
      this.state.warmQueue.set(row.id, { row, owners, key });
    }
    this.pumpWarmup();
  }
  pumpWarmup() {
    while (!this.state.closed && this.state.warmRunning.size < 2 && this.state.warmQueue.size > 0) {
      const entry = this.state.warmQueue.entries().next();
      if (entry.done) break;
      const [id, target] = entry.value;
      this.state.warmQueue.delete(id);
      if (!currentOwner(this.state, target.owners)) continue;
      this.state.warmScheduled.set(id, { key: target.key, at: this.state.now() });
      const job = Promise.resolve()
        .then(() =>
          currentOwner(this.state, target.owners) && !this.state.closed
            ? inspect(this.state, id, this.expected(target.row), true)
            : null,
        )
        .catch(() => {})
        .finally(() => {
          this.state.warmRunning.delete(job);
          this.pumpWarmup();
        });
      this.state.warmRunning.add(job);
    }
  }
}
