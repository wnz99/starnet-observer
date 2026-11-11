import type { Scene } from "../scene/types.js";
import type { CoordinationView } from "../model/coordination.js";
import type { AppBus, AppRow } from "./data.js";
import { BENCH_SEATS } from "../scene/observatory.js";
import { record } from "../theme/validation.js";

export interface Seat {
  row: AppRow;
  host: string | null;
  accent: string;
}

/* Observed coordinators other than the overseer take the bench: local first, then by host, then id. The seat host is
   the row's own host, so its mail route can never fall back to the local chute. */
export function benchSeats(
  coordination: CoordinationView,
  rows: readonly AppRow[],
  overseer: AppRow | null,
): Seat[] {
  const hues = new Map(coordination.teams.map((facts) => [facts.teamKey, facts.hue]));
  const byId = new Map(rows.map((row) => [row.id, row]));
  const seats = new Map<string, Seat>();
  for (const { id, teamKey } of coordination.coordinators) {
    const row = byId.get(id);
    const accent = hues.get(teamKey);
    if (row && row.id !== overseer?.id && accent && !seats.has(id))
      seats.set(id, { row, host: row.host || null, accent });
  }
  return Array.from(seats.values())
    .sort(
      (a, b) =>
        Number(a.host !== null) - Number(b.host !== null) ||
        (a.host ?? "").localeCompare(b.host ?? "") ||
        a.row.id.localeCompare(b.row.id),
    )
    .slice(0, BENCH_SEATS);
}

// Bus fields the floor paints or hovers; a frozen floor repaints only when they change.
export const busKey = (bus: AppBus | null | undefined) =>
  bus && [bus.health, bus.reason, bus.messages ?? [], bus.coordination?.teams];

export function geometryField(name: string, value: unknown) {
  if (name !== "row" || !record(value)) return value;
  const lifecycle = record(value.lifecycleEvidence) ? value.lifecycleEvidence : null;
  return [
    value.id,
    value.status,
    value.provider,
    value.worktree,
    value.checkoutId,
    value.checkoutKind,
    value.folder,
    value.lineageState,
    lifecycle?.state,
  ];
}

/** Refresh display evidence without disturbing cached geometry or helper movement. */
export function refreshSceneRows(scene: Scene | null, rows: AppRow[]) {
  const current = new Map(rows.map((row) => [row.id, row]));
  for (const worker of scene?.workers ?? []) worker.row = current.get(worker.id) ?? worker.row;
}
