import type { Row, Sweep } from "./contracts.js";
import type { State } from "./state.js";
import { capture } from "./ownership.js";
import { currentOwner } from "./ownership.js";
import { inspect, expectedInspectionIdentity, PREPARE_INSPECTION } from "./inspection.js";
const WARMUP_LIMIT = 32;
const WARMUP_CONCURRENCY = 2;
const WARMUP_CACHE_AGE = 60000;
function eligible(row: Row) {
  return (
    row.source !== "desktop" &&
    !!row.inspectionIdentity &&
    row.inventoryHealth === "available" &&
    (row.source === "helper" || !!row.tool?.available)
  );
}
export class Warmup {
  constructor(private readonly state: State) {}
  scheduleWarmup(sweep: Sweep) {
    if (this.state.closed || this.state.options.warmDetails === false) return;
    const { warmed } = sweep;
    let count = 0;
    for (const row of this.state.lastGood) {
      if (!eligible(row)) continue;
      if (count++ >= WARMUP_LIMIT) break;
      const key = this.scheduleRow(row, warmed);
      if (key !== undefined) warmed.add(key);
    }
    this.pumpWarmup();
  }
  private scheduleRow(row: Row, warmed: Set<string>) {
    const owners = capture(this.state, row);
    if (!owners) return;
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
        proof?.birth.pid,
        proof?.birth.startSeconds,
        proof?.birth.startMicroseconds,
      ]),
    );
    if (warmed.has(key) || warmed.size >= WARMUP_LIMIT) return;
    const previous = this.state.warmScheduled.get(row.id);
    if (previous?.key === key && this.state.now() - previous.at < WARMUP_CACHE_AGE) return;
    this.state.warmQueue.set(row.id, { row, owners, key });
    return key;
  }
  pumpWarmup() {
    while (
      !this.state.closed &&
      this.state.warmRunning.size < WARMUP_CONCURRENCY &&
      this.state.warmQueue.size > 0
    ) {
      const entry = this.state.warmQueue.entries().next();
      if (entry.done) break;
      const [id, target] = entry.value;
      this.state.warmQueue.delete(id);
      if (!currentOwner(this.state, target.owners)) continue;
      this.state.warmScheduled.set(id, { key: target.key, at: this.state.now() });
      const job = Promise.resolve()
        .then(() =>
          currentOwner(this.state, target.owners) && !this.state.closed
            ? inspect(this.state, id, expectedInspectionIdentity(target.row), PREPARE_INSPECTION)
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
