import type { ObserverSnapshot } from "../../shared/observer.js";
import type { SnapshotDatabase } from "../sqlite/snapshots.js";
import { busRecord } from "./types.js";
import { resources } from "./overview-resources.js";
import { remoteActivity } from "./overview-remote.js";

type Overview = NonNullable<NonNullable<ObserverSnapshot["bus"]>["coordination"]>["overview"];
type Status = "available" | "partial" | "unavailable";
const TIME = "ROUND((julianday(sent_at)-2440587.5)*86400000)";
const RECENT = TIME + " BETWEEN ? AND ?";
const INVALID = TIME + " IS NULL OR " + TIME + " > ?";
const LAST_SEEN = TIME.replace("sent_at", "last_seen");
const LIMIT = 100;
const AGENT_WINDOW = 300000;
const FAILED_WAKE = "failed";
const FAILED_REASON = "wake-failed";
const timestamp = (value: unknown) => {
  const at = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(at) ? at : null;
};
function aggregate(database: SnapshotDatabase, sql: string, args: number[]) {
  try {
    const row = database.query(sql).all(...args)[0];
    return busRecord(row) ? row : null;
  } catch {
    return null;
  }
}
function count(row: Record<string, unknown> | null, key: string) {
  const value = row?.[key];
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
function status(row: Record<string, unknown> | null): Status {
  return row ? (row.invalid ? "partial" : "available") : "unavailable";
}
function readable(database: SnapshotDatabase, sql: string) {
  try {
    database.query(sql).all();
    return true;
  } catch {
    return false;
  }
}
function scalar(database: SnapshotDatabase, sql: string, bounds: number[]) {
  const row = aggregate(database, sql, bounds);
  return { status: status(row), count: count(row, "n") };
}
function attention(database: SnapshotDatabase, bounds: number[], source: Status) {
  const result: NonNullable<Overview>["attention"] = { status: source, truncated: false, rows: [] };
  try {
    const rows = database
      .query(
        "SELECT id, sent_at, acknowledged_at, wake_status FROM messages WHERE " +
          RECENT +
          " AND (acknowledged_at IS NULL OR wake_status='failed') ORDER BY id DESC LIMIT 101",
      )
      .all(...bounds);
    result.truncated = rows.length > LIMIT;
    for (const row of rows.slice(0, LIMIT)) {
      if (!busRecord(row)) continue;
      const at = timestamp(row.sent_at);
      if (
        typeof row.id !== "number" ||
        !Number.isSafeInteger(row.id) ||
        row.id < 1 ||
        at === null
      ) {
        result.status = "partial";
        continue;
      }
      result.rows.push({
        id: row.id,
        sentAt: at,
        reasons: [
          ...(row.acknowledged_at === null ? ["unacknowledged" as const] : []),
          ...(row.wake_status === FAILED_WAKE ? [FAILED_REASON as "wake-failed"] : []),
        ],
      });
    }
  } catch {
    result.status = "unavailable";
  }
  return result;
}
function agentsMetric(database: SnapshotDatabase, asOf: number) {
  const agents = aggregate(
    database,
    "SELECT COUNT(CASE WHEN kind='codex' AND " +
      LAST_SEEN +
      " BETWEEN ? AND ? THEN 1 END) AS codex, COUNT(CASE WHEN kind='claude' AND " +
      LAST_SEEN +
      " BETWEEN ? AND ? THEN 1 END) AS claude, COUNT(CASE WHEN " +
      LAST_SEEN +
      " IS NULL OR " +
      LAST_SEEN +
      " > ? OR kind NOT IN ('codex','claude') OR kind IS NULL THEN 1 END) AS invalid FROM agents",
    [asOf - AGENT_WINDOW, asOf, asOf - AGENT_WINDOW, asOf, asOf],
  );
  return { status: status(agents), codex: count(agents, "codex"), claude: count(agents, "claude") };
}
function messagesMetric(
  database: SnapshotDatabase,
  bounds: number[],
  asOf: number,
  routes: { outbox: boolean; imports: boolean },
) {
  const { outbox, imports } = routes;
  const messages = aggregate(
    database,
    "SELECT COUNT(DISTINCT CASE WHEN " +
      RECENT +
      " THEN id END) AS n, COUNT(CASE WHEN " +
      INVALID +
      " THEN 1 END) AS invalid FROM messages",
    [...bounds, asOf],
  );
  const routed = [
    outbox ? "EXISTS(SELECT 1 FROM remote_outbox o WHERE o.local_id=m.id)" : "",
    imports ? "EXISTS(SELECT 1 FROM remote_imports i WHERE i.local_id=m.id)" : "",
  ]
    .filter(Boolean)
    .join(" OR ");
  const split =
    outbox && imports
      ? aggregate(
          database,
          "SELECT COUNT(DISTINCT id) AS n FROM messages m WHERE " +
            RECENT +
            " AND (" +
            routed +
            ")",
          bounds,
        )
      : null;
  const total = count(messages, "n");
  const remote = count(split, "n");
  const source = status(messages);
  return {
    source,
    metric: {
      status: source === "unavailable" ? source : split ? source : "partial",
      total,
      remote,
      local: total !== null && remote !== null ? total - remote : null,
    },
  } as const;
}
function awaitingMetric(database: SnapshotDatabase, bounds: number[], source: Status) {
  const awaiting = aggregate(
    database,
    "SELECT COUNT(DISTINCT id) AS n, MIN(" +
      TIME +
      ") AS oldest FROM messages WHERE " +
      RECENT +
      " AND acknowledged_at IS NULL",
    bounds,
  );
  return {
    status: awaiting ? source : "unavailable",
    count: count(awaiting, "n"),
    oldestAt: typeof awaiting?.oldest === "number" ? Math.round(awaiting.oldest) : null,
  } as const;
}
function wakesMetric(database: SnapshotDatabase, bounds: number[], source: Status) {
  const failed = scalar(
    database,
    "SELECT COUNT(DISTINCT id) AS n FROM messages WHERE " + RECENT + " AND wake_status='failed'",
    bounds,
  );
  const pending = scalar(
    database,
    "SELECT COUNT(DISTINCT recipient) AS n FROM wake_dispatch w WHERE (next_attempt_at IS NOT NULL OR lease_until IS NOT NULL) AND EXISTS(SELECT 1 FROM messages WHERE messages.recipient=w.recipient AND acknowledged_at IS NULL AND " +
      RECENT +
      ")",
    bounds,
  );
  if (source === "partial") {
    if (failed.status === "available") failed.status = "partial";
    if (pending.status === "available") pending.status = "partial";
  }
  return { pending, failed };
}
export function selectBusOverview(database: SnapshotDatabase, asOf: number): Overview {
  const bounds = [asOf - 3600000, asOf];
  const outbox = readable(database, "SELECT local_id,state FROM remote_outbox LIMIT 0");
  const imports = readable(database, "SELECT local_id FROM remote_imports LIMIT 0");
  const { metric: messages, source } = messagesMetric(database, bounds, asOf, {
    outbox: outbox || readable(database, "SELECT local_id FROM remote_outbox LIMIT 0"),
    imports,
  });
  return {
    asOf,
    agents: agentsMetric(database, asOf),
    messages,
    awaiting: awaitingMetric(database, bounds, source),
    wakes: wakesMetric(database, bounds, source),
    attention: attention(database, bounds, source),
    resources: resources(database),
    remoteActivity: remoteActivity(database, outbox, imports, asOf),
  };
}
