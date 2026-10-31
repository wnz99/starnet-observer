import type { SnapshotDatabase } from "../sqlite/snapshots.js";
import type { BusState } from "./types.js";
import { busRecord } from "./types.js";

const LIMIT = 100;
// Fixed queries deliberately exclude bodies, envelopes, sockets, paths and credentials.
// Every optional table degrades independently, including on older bus schemas.
type Section = NonNullable<BusState["coordination"]>["sections"][number];
function readSection(database: SnapshotDatabase, title: string, sql: string): Section {
  try {
    const agent = sql.includes(" AS agent ") ? "substr(agent,1,256) AS agent" : "NULL AS agent";
    const rows = database
      .query(
        "SELECT substr(label,1,160) AS label, substr(detail,1,1024) AS detail, " +
          agent +
          " FROM (" +
          sql +
          ") LIMIT " +
          String(LIMIT + 1),
      )
      .all();
    return {
      title,
      available: true,
      truncated: rows.length > LIMIT,
      rows: rows.slice(0, LIMIT).flatMap((raw) =>
        busRecord(raw) && typeof raw.label === "string" && typeof raw.detail === "string"
          ? [
              {
                label: raw.label,
                detail: raw.detail,
                ...(typeof raw.agent === "string" ? { agent: raw.agent } : {}),
              },
            ]
          : [],
      ),
    };
  } catch {
    return { title, available: false, truncated: false, rows: [] };
  }
}
export function selectCoordination(database: SnapshotDatabase): BusState["coordination"] {
  const sections: Section[] = [];
  const select = (title: string, sql: string) => sections.push(readSection(database, title, sql));
  select(
    "Registrations",
    "SELECT kind AS label, 'Last seen: ' || last_seen || CASE WHEN ended_at IS NULL THEN ' · no recorded end' ELSE ' · ended: ' || ended_at END AS detail, address AS agent FROM agents ORDER BY last_seen DESC",
  );
  select(
    "Mailbox totals",
    "SELECT 'All retained messages' AS label, CAST(COUNT(*) AS TEXT) || ' · unacknowledged: ' || COALESCE(SUM(CASE WHEN acknowledged_at IS NULL THEN 1 ELSE 0 END),0) AS detail FROM messages",
  );
  select(
    "Resource catalog",
    "SELECT resource AS label, substr(description,1,512) || CASE WHEN scope='shared' THEN ' · shared across repositories' ELSE ' · repository scoped' END AS detail FROM resource_catalog ORDER BY last_used_at DESC",
  );
  select(
    "Resource locks",
    "SELECT substr(resource,1,160) AS label, CASE WHEN scope='shared' THEN 'Shared across repositories' ELSE 'Repository scoped' END || ' · acquired: ' || acquired_at || ' · expires: ' || expires_at || ' · check: ' || check_at AS detail, holder AS agent FROM resource_locks ORDER BY acquired_at DESC",
  );
  select(
    "Lock waiters",
    "SELECT substr(resource,1,160) AS label, 'Requested: ' || requested_at AS detail, waiter AS agent FROM resource_lock_waiters ORDER BY requested_at",
  );
  select(
    "Wake dispatch",
    "SELECT 'Pending wake' AS label, 'Attempts: ' || attempts || ' · retry: ' || COALESCE(next_attempt_at,'none') || ' · lease until: ' || COALESCE(lease_until,'none') AS detail, recipient AS agent FROM wake_dispatch WHERE next_attempt_at IS NOT NULL OR lease_until IS NOT NULL ORDER BY next_attempt_at",
  );
  select(
    "Wake coverage",
    "SELECT 'Message #' || message_id AS label, CASE WHEN status IN ('requested','failed','unknown','unsupported','coalesced') THEN status ELSE 'unknown' END || ' · checked: ' || checked_at AS detail FROM wake_coverage ORDER BY message_id DESC",
  );
  select(
    "Synchronization",
    "SELECT CASE WHEN kind IN ('transport','report','reports','outbox','peer','peers') THEN kind ELSE 'Bus synchronization' END AS label, 'Attempts: ' || attempts || ' · last success: ' || COALESCE(last_success_at,'none') || ' · next attempt: ' || COALESCE(next_attempt_at,'none') || CASE WHEN error_code IS NULL THEN '' ELSE ' · error recorded' END AS detail FROM remote_sync_work ORDER BY last_attempt_at DESC",
  );
  select(
    "Work reports",
    "SELECT 'Message #' || o.local_id AS label, CASE WHEN json_extract(r.payload,'$.status') IN ('received','proceeding','not_proceeding','completed','failed') THEN json_extract(r.payload,'$.status') ELSE 'Report recorded' END || CASE WHEN json_extract(r.payload,'$.reason') IN ('started','resumed','needs_approval','missing_information','dependency_blocked','out_of_scope','declined','validation_failed','execution_failed','permission_denied','unavailable') THEN ' · ' || json_extract(r.payload,'$.reason') ELSE '' END AS detail FROM remote_reports r JOIN remote_outbox o ON o.id=r.id ORDER BY o.local_id DESC",
  );
  select(
    "Human-only monitor",
    "SELECT 'Retained messages' AS label, CAST(COUNT(*) AS TEXT) || ' · text stays outside agent inboxes' AS detail FROM remote_monitor",
  );
  select(
    "Report submissions",
    "SELECT 'Awaiting synchronization' AS label, CAST(COUNT(*) AS TEXT) AS detail FROM remote_report_submissions WHERE synced=0",
  );
  return { sections };
}
