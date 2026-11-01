import type { Scene } from "../scene/types.js";
import type { AppRow } from "./data.js";
import { record } from "../theme/validation.js";

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
