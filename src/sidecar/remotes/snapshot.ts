import { MAX_ROWS, HEALTH, oneOf, record } from "./fields.js";
import { sanitizeRow } from "./rows.js";
import { sanitizeBus } from "./bus.js";
import type { Target } from "./targets.js";
import { sanitizeTargets } from "./targets.js";
export function sanitizeSnapshot(host: string, value: unknown, receivedAt: number) {
  if (!record(value) || !Array.isArray(value.sessions)) throw new Error("invalid snapshot");
  // This host exports Herdr/helper rows. Desktop or bus success cannot prove that inventory.
  const health = inventoryHealth(value);
  const rows = [];
  for (const row of value.sessions.slice(0, MAX_ROWS)) {
    const safe = sanitizeRow(host, row, receivedAt);
    if (safe) rows.push(safe);
  }
  // A helper whose parent did not survive sanitising would be an orphan: drop it rather than guess a parent.
  const ids = new Set(rows.map((row) => row.id));
  const kept = rows.filter(
    (row) => !Object.hasOwn(row, "parentId") || (row.parentId && ids.has(row.parentId)),
  );
  return {
    health,
    rows:
      health === "available"
        ? kept
        : kept.map((row) => ({ ...row, inventoryHealth: "unavailable" as const })),
    bus: sanitizeBus(host, value.bus, new Set(kept.map((row) => row.id)), receivedAt),
    targets:
      health === "available" ? sanitizeTargets(value.targets, kept) : new Map<string, Target>(),
  };
}

function inventoryHealth(value: Record<string, unknown>) {
  const inventoryHealth = Object.hasOwn(value, "sources")
    ? record(value.sources) && record(value.sources.herdr)
      ? value.sources.herdr.health
      : undefined
    : value.health;
  return value.health === "available"
    ? oneOf(inventoryHealth, HEALTH, "unavailable")
    : "unavailable";
}
