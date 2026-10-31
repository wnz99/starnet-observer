import type { ObserverSnapshot } from "../../shared/observer.js";
import type { SnapshotDatabase } from "../sqlite/snapshots.js";
import { busRecord } from "./types.js";

type Overview = NonNullable<NonNullable<ObserverSnapshot["bus"]>["coordination"]>["overview"];
const TIME = "ROUND((julianday(sent_at)-2440587.5)*86400000)";
const MAX_MACHINES = 32;
function sourceStatus(
  outbox: boolean,
  imports: boolean,
): NonNullable<Overview>["remoteActivity"]["status"] {
  return outbox && imports ? "available" : outbox || imports ? "partial" : "unavailable";
}
const timestamp = (value: unknown) => {
  const at = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(at) ? at : null;
};
export function remoteActivity(
  database: SnapshotDatabase,
  outbox: boolean,
  imports: boolean,
  asOf: number,
) {
  const result: NonNullable<Overview>["remoteActivity"] = {
    status: sourceStatus(outbox, imports),
    truncated: false,
    rows: [],
  };
  if (!outbox && !imports) return result;
  // Fixed metadata-only SQL parses the same machine/repository/provider grammar as relay peers.
  // Window ranking stays inside SQLite; at most 33 machine observations cross the boundary.
  const prefix = routePrefix(outbox, imports);
  try {
    const bad = database
      .query(prefix + "SELECT COUNT(*) AS n FROM valid WHERE valid=0")
      .all(asOf)[0];
    if (busRecord(bad) && bad.n) result.status = "partial";
    const rows = database
      .query(
        prefix +
          ", ranked AS (SELECT *,ROW_NUMBER() OVER(PARTITION BY machine ORDER BY " +
          TIME +
          " DESC,id DESC) AS rank FROM valid WHERE valid=1) SELECT machine,sent_at,state FROM ranked WHERE rank=1 ORDER BY machine LIMIT 33",
      )
      .all(asOf);
    result.truncated = rows.length > MAX_MACHINES;
    for (const raw of rows.slice(0, MAX_MACHINES)) {
      const row = remoteRow(raw);
      if (row) result.rows.push(row);
      else result.status = "partial";
    }
  } catch {
    result.status = "unavailable";
  }
  return result;
}
function routePrefix(outbox: boolean, imports: boolean) {
  const routes = [
    outbox
      ? "SELECT id,recipient AS address,sent_at,(SELECT state FROM remote_outbox o WHERE o.local_id=m.id ORDER BY state LIMIT 1) AS state FROM messages m WHERE EXISTS(SELECT 1 FROM remote_outbox o WHERE o.local_id=m.id)"
      : "",
    imports
      ? "SELECT id,sender AS address,sent_at,CASE WHEN acknowledged_at IS NULL THEN 'delivered_local' ELSE 'acknowledged' END AS state FROM messages m WHERE EXISTS(SELECT 1 FROM remote_imports i WHERE i.local_id=m.id)" +
        (outbox ? " AND NOT EXISTS(SELECT 1 FROM remote_outbox o WHERE o.local_id=m.id)" : "")
      : "",
  ]
    .filter(Boolean)
    .join(" UNION ALL ");
  return (
    "WITH routes AS (" +
    routes +
    "), parts AS (SELECT *,substr(address,1,instr(address,'/')-1) AS machine,substr(address,instr(address,'/')+1) AS rest FROM routes), parsed AS (SELECT *,substr(rest,1,instr(rest,'/')-1) AS repo,substr(rest,instr(rest,'/')+1) AS agent FROM parts), valid AS (SELECT *,CASE WHEN length(machine) BETWEEN 1 AND 128 AND machine NOT GLOB '*[^A-Za-z0-9_-]*' AND length(repo) BETWEEN 1 AND 128 AND repo NOT GLOB '*[^A-Za-z0-9_-]*' AND (agent LIKE 'codex:%' OR agent LIKE 'claude:%') AND substr(agent,1,instr(agent,':')-1) IN ('codex','claude') AND length(substr(agent,instr(agent,':')+1)) BETWEEN 1 AND 200 AND substr(agent,instr(agent,':')+1) NOT GLOB '*[^A-Za-z0-9._-]*' AND " +
    TIME +
    " IS NOT NULL AND " +
    TIME +
    " <= ? THEN 1 ELSE 0 END AS valid FROM parsed) "
  );
}
function remoteRow(row: unknown): NonNullable<Overview>["remoteActivity"]["rows"][number] | null {
  if (!busRecord(row) || typeof row.machine !== "string") return null;
  const sentAt = timestamp(row.sent_at);
  if (sentAt === null) return null;
  const state =
    row.state === "queued_local" ||
    row.state === "accepted_remote" ||
    row.state === "delivered_local" ||
    row.state === "acknowledged" ||
    row.state === "expired"
      ? row.state
      : "unknown";
  return { machine: row.machine, sentAt, state };
}
