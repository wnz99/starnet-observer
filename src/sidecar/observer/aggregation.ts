import type { ObserverInputRow } from "./contracts.js";
import { identity, compare, fresh, conflicting, status } from "./evidence.js";
import { Counters } from "./counters.js";
export { lastActivity } from "./evidence.js";
function grouped(rows: ObserverInputRow[]) {
  const groups = new Map<string, { verified: boolean; rows: ObserverInputRow[] }>();
  for (const row of rows) {
    const proof = identity(row),
      group = groups.get(proof.key);
    if (group) group.rows.push(row);
    else groups.set(proof.key, { verified: proof.verified, rows: [row] });
  }
  return groups.values();
}
export function aggregateRows(rows: ObserverInputRow[], now: number) {
  const agents = {
    observed: 0,
    verifiedSessions: 0,
    presenceOnly: 0,
    statuses: { working: 0, blocked: 0, idle: 0, done: 0, unknown: 0 },
    stale: 0,
  };
  const counters = new Counters();
  for (const group of grouped(rows)) {
    const candidates = group.rows.sort((a, b) => compare(a, b, now)),
      row = candidates[0];
    if (!row) continue;
    const stale = !fresh(row, now);
    if (group.verified && !stale && conflicting(candidates, row, now)) {
      counters.coverage.conflicting++;
      continue;
    }
    agents.observed++;
    if (stale) agents.stale++;
    else agents.statuses[status(row.status)]++;
    if (!group.verified) {
      agents.presenceOnly++;
      continue;
    }
    agents.verifiedSessions++;
    counters.contribute(row, stale, now);
  }
  return { agents, ...counters.finish() };
}
