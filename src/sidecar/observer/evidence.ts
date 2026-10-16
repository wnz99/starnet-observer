import type { Row } from "./contracts.js";
export const COUNTERS = [
  "inputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheWriteTokens",
] as const;
export type CounterKey = (typeof COUNTERS)[number];
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function freshObservation(at: unknown, now: number): at is number {
  return typeof at === "number" && Number.isFinite(at) && now - at <= 6000;
}
export const usageObservation = (row: Row) =>
  row.usage?.observedAt ?? (row.source === "helper" ? row.observedAt : null);
export function status(value: unknown) {
  switch (value) {
    case "working":
    case "blocked":
    case "idle":
    case "done":
      return value;
    default:
      return "unknown";
  }
}
// Idle-age shading uses the last sign of life. A working pane is active now; otherwise use the newest timestamped conversation
// entry or tool event. File mtime is not evidence (Claude touches transcripts without activity). Clamped to the
// inventory clock, so a skewed row time cannot read as the future.
export function lastActivity(
  value: unknown,
  tool:
    | {
        lastEntryAt?: number | null;
        last?: { at: number | string | null } | null;
        modifiedAt?: number;
        available?: boolean;
      }
    | null
    | undefined,
  now: number,
) {
  if (value === "working") return now;
  const at = tool?.last?.at;
  const times = [
    tool?.lastEntryAt,
    typeof at === "string" ? Date.parse(at) : Date.parse(String(at || "")),
  ].filter((time): time is number => typeof time === "number" && Number.isFinite(time));
  return times.length > 0 ? Math.min(now, Math.max(...times)) : null;
}
function helperIdentity(row: Row) {
  return (
    row.provider === "claude" &&
    row.source === "helper" &&
    row.presence === "verified-lineage" &&
    /^helper:obs_[a-f0-9]{24}$/.test(row.inspectionIdentity || "")
  );
}
export function identity(row: Row) {
  const helper = helperIdentity(row);
  const verified =
    helper ||
    (row.source !== "desktop" && UUID.test(row.sessionId || "") && !!row.inspectionIdentity);
  const value = helper
    ? `${row.provider}:${String(row.inspectionIdentity)}`
    : verified
      ? `${row.provider}:${String(row.sessionId?.toLowerCase())}`
      : "presence:" + row.id;
  return { verified, key: JSON.stringify([row.host || null, value]) };
}
export const fresh = (row: Row, now: number) =>
  row.inventoryHealth === "available" && freshObservation(row.observedAt, now);
export const freshUsage = (row: Row, now: number) =>
  fresh(row, now) && freshObservation(usageObservation(row), now);
const rank = (row: Row, now: number) =>
  [fresh(row, now) ? 1 : 0, row.observedAt ?? -1, row.source === "herdr" ? 1 : 0] as const;
export function compare(a: Row, b: Row, now: number) {
  const ar = rank(a, now),
    br = rank(b, now);
  return (
    br[0] - ar[0] ||
    br[1] - ar[1] ||
    br[2] - ar[2] ||
    Number(freshUsage(b, now)) - Number(freshUsage(a, now)) ||
    a.id.localeCompare(b.id)
  );
}
export function conflicting(rows: Row[], row: Row, now: number) {
  const signature = (value: Row) =>
    JSON.stringify(COUNTERS.map((key) => value.usage?.[key] || null));
  return rows
    .filter((value) => JSON.stringify(rank(value, now)) === JSON.stringify(rank(row, now)))
    .some(
      (value) =>
        status(value.status) !== status(row.status) ||
        (freshUsage(value, now) && signature(value) !== signature(row)),
    );
}
