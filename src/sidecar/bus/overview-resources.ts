import type { ObserverSnapshot } from "../../shared/observer.js";
import type { SnapshotDatabase } from "../sqlite/snapshots.js";
import { busRecord } from "./types.js";
import { overviewTime } from "./overview-time.js";
type Resources = NonNullable<
  NonNullable<NonNullable<ObserverSnapshot["bus"]>["coordination"]>["overview"]
>["resources"];
type Resource = Resources["rows"][number];
const LIMIT = 100;
const LABEL_CHARS = 160;
const ADDRESS_CHARS = 256;
const ACQUIRED = overviewTime.replaceAll("sent_at", "acquired_at");
const EXPIRES = overviewTime.replaceAll("sent_at", "expires_at");
const CHECK = overviewTime.replaceAll("sent_at", "check_at");
const REQUESTED = overviewTime.replaceAll("sent_at", "requested_at");
const timestamp = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
function readable(database: SnapshotDatabase, sql: string) {
  try {
    database.query(sql).all();
    return true;
  } catch {
    return false;
  }
}
function resourceKey(
  value: unknown,
): value is { resource: string; scope: "shared" | "repository" } {
  return (
    busRecord(value) &&
    typeof value.resource === "string" &&
    value.resource.length <= LABEL_CHARS &&
    (value.scope === "shared" || value.scope === "repository")
  );
}
function sourceStatus(held: boolean, waiting: boolean): Resources["status"] {
  return held && waiting ? "available" : held || waiting ? "partial" : "unavailable";
}
function invalidSources(database: SnapshotDatabase, held: boolean, waiting: boolean) {
  const invalidKey =
    "resource IS NULL OR length(resource)>160 OR scope IS NULL OR scope NOT IN ('shared','repository')";
  const locks =
    held &&
    database
      .query(
        "SELECT 1 FROM resource_locks WHERE " +
          invalidKey +
          " OR holder IS NULL OR length(holder)>256 OR " +
          ACQUIRED +
          " IS NULL OR " +
          EXPIRES +
          " IS NULL OR " +
          CHECK +
          " IS NULL LIMIT 1",
      )
      .all()[0];
  const waiters =
    waiting &&
    database
      .query(
        "SELECT 1 FROM resource_lock_waiters WHERE " +
          invalidKey +
          " OR waiter IS NULL OR length(waiter)>256 OR " +
          REQUESTED +
          " IS NULL LIMIT 1",
      )
      .all()[0];
  return Boolean(locks || waiters);
}
export function resources(database: SnapshotDatabase): Resources {
  try {
    return selectResources(database);
  } catch {
    return { status: "unavailable", truncated: false, rows: [] };
  }
}
function selectResources(database: SnapshotDatabase): Resources {
  const held = readable(
    database,
    "SELECT resource,scope,holder,acquired_at,expires_at,check_at FROM resource_locks LIMIT 0",
  );
  const waiting = readable(
    database,
    "SELECT resource,scope,waiter,requested_at FROM resource_lock_waiters LIMIT 0",
  );
  const result: Resources = {
    status: sourceStatus(held, waiting),
    truncated: false,
    rows: [],
  };
  if (!held && !waiting) return result;
  if (invalidSources(database, held, waiting)) result.status = "partial";
  const keys = [
    held ? "SELECT resource,scope FROM resource_locks" : "",
    waiting ? "SELECT resource,scope FROM resource_lock_waiters" : "",
  ]
    .filter(Boolean)
    .join(" UNION ");
  const rows = database
    .query(
      "SELECT DISTINCT substr(resource,1,161) AS resource,scope FROM (" +
        keys +
        ") ORDER BY scope,resource LIMIT 101",
    )
    .all();
  result.truncated = rows.length > LIMIT;
  for (const raw of rows.slice(0, LIMIT)) {
    if (!resourceKey(raw)) {
      result.status = "partial";
      continue;
    }
    const selected = resourceDetails(database, raw, { held, waiting });
    if (selected.invalid) result.status = "partial";
    if (selected.truncated) result.truncated = true;
    result.rows.push(selected.row);
  }
  return result;
}
function resourceDetails(
  database: SnapshotDatabase,
  raw: Pick<Resource, "resource" | "scope">,
  sources: { held: boolean; waiting: boolean },
) {
  const lock = sources.held
    ? heldResource(database, raw)
    : { fields: { acquiredAt: null, expiresAt: null, checkAt: null }, invalid: false };
  const waiters = sources.waiting
    ? resourceWaiters(database, raw)
    : { rows: [], invalid: false, truncated: false };
  return {
    invalid: lock.invalid || waiters.invalid,
    truncated: waiters.truncated,
    row: {
      resource: raw.resource,
      scope: raw.scope,
      ...lock.fields,
      waiters: waiters.rows,
    },
  };
}
function heldResource(database: SnapshotDatabase, key: Pick<Resource, "resource" | "scope">) {
  const raw = database
    .query(
      "SELECT substr(holder,1,257) AS holder," +
        ACQUIRED +
        " AS acquired_at," +
        EXPIRES +
        " AS expires_at," +
        CHECK +
        " AS check_at FROM resource_locks WHERE resource=? AND scope=? LIMIT 1",
    )
    .all(key.resource, key.scope)[0];
  const fields: Pick<Resource, "holder" | "acquiredAt" | "expiresAt" | "checkAt"> = {
    acquiredAt: null,
    expiresAt: null,
    checkAt: null,
  };
  if (!busRecord(raw)) return { fields, invalid: false };
  const validHolder = typeof raw.holder === "string" && raw.holder.length <= ADDRESS_CHARS;
  if (typeof raw.holder === "string" && validHolder) fields.holder = raw.holder;
  fields.acquiredAt = timestamp(raw.acquired_at);
  fields.expiresAt = timestamp(raw.expires_at);
  fields.checkAt = timestamp(raw.check_at);
  return {
    fields,
    invalid:
      !validHolder ||
      fields.acquiredAt === null ||
      fields.expiresAt === null ||
      fields.checkAt === null,
  };
}
function resourceWaiters(database: SnapshotDatabase, key: Pick<Resource, "resource" | "scope">) {
  const raw = database
    .query(
      "SELECT substr(waiter,1,257) AS agent," +
        REQUESTED +
        " AS requested_at FROM resource_lock_waiters WHERE resource=? AND scope=? ORDER BY requested_at LIMIT 101",
    )
    .all(key.resource, key.scope);
  const result = { rows: [] as Resource["waiters"], invalid: false, truncated: raw.length > LIMIT };
  for (const waiter of raw.slice(0, LIMIT)) {
    if (
      !busRecord(waiter) ||
      typeof waiter.agent !== "string" ||
      waiter.agent.length > ADDRESS_CHARS
    ) {
      result.invalid = true;
      continue;
    }
    const requestedAt = timestamp(waiter.requested_at);
    if (requestedAt === null) result.invalid = true;
    result.rows.push({ agent: waiter.agent, requestedAt });
  }
  return result;
}
