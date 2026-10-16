import type { ObserverRow } from "../../shared/observer.js";
type DisplayTool = Omit<ObserverRow["tool"], "last"> & {
  last?: Partial<NonNullable<ObserverRow["tool"]["last"]>> | null;
};
export type DisplayRow = Partial<
  Omit<
    ObserverRow,
    | "provider"
    | "source"
    | "observedAt"
    | "tool"
    | "taskEvidence"
    | "taskStatusEvidence"
    | "lifecycleEvidence"
    | "task"
  >
> & {
  observedAt?: number | string | null;
  provider?: string;
  source?: string;
  tool?: DisplayTool;
  taskEvidence?: Partial<NonNullable<ObserverRow["taskEvidence"]>> | null;
  taskStatusEvidence?: Partial<NonNullable<ObserverRow["taskStatusEvidence"]>> | null;
  lifecycleEvidence?: Partial<NonNullable<ObserverRow["lifecycleEvidence"]>> | null;
  task?: unknown;
};
export type LayoutRow = DisplayRow & { id: string };
export interface Block {
  repo: string;
  label: string;
  section: string;
  checkoutId?: string | null;
  checkoutKind?: string | null;
  worktree?: string | null;
  repoLabel?: string;
  checkoutLabel?: string;
  folder?: string;
}
export interface Pane {
  project: string;
  repo: string;
  section: string;
  block: number;
  seat: number;
}
export interface Helper extends Pane {
  rootId: string;
  parentId: string | null;
  helperSlot: number | null;
}
interface RoomRow {
  row: LayoutRow;
  kind: "session" | "helper";
  block: number;
  seat?: number;
  rootId?: string;
  parentId?: string | null;
  helperSlot?: number | null;
}
export interface Unit {
  key: string;
  projectId: string;
  name: string;
  annex: number;
  host?: string;
  blocks: Block[];
  rows: RoomRow[];
}
export interface Room extends Unit {
  slot: number;
  floor: string;
  accent: string;
}
export function required<K, V>(map: ReadonlyMap<K, V>, key: K): V {
  const value = map.get(key);
  if (value === undefined) throw new Error("Observer layout invariant failed");
  return value;
}
export function element<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined) throw new Error("Observer layout index is unavailable");
  return value;
}
