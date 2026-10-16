import type { Inventory } from "../observer/contracts.js";
import type { ObserverSnapshot } from "../../shared/observer.js";
export type Row = Inventory["sessions"][number];
export type Bus = NonNullable<Inventory["bus"]> | NonNullable<ObserverSnapshot["bus"]>;
export type Message = Bus["messages"][number];
export type Relay = NonNullable<Message["relay"]>;
export type Remote = NonNullable<Bus["remote"]>;
export type SourceHealth = ObserverSnapshot["sources"]["herdr"];
export interface PresentationSource {
  get: () => Inventory | Promise<Inventory>;
  close?: () => unknown;
}
export type ProjectedRow = Pick<
  Row,
  | "id"
  | "provider"
  | "source"
  | "status"
  | "projectId"
  | "projectKind"
  | "repoId"
  | "repoKind"
  | "observedAt"
  | "inventoryHealth"
  | "presence"
  | "helperOverflow"
  | "usage"
  | "parentId"
  | "lineageState"
> & {
  host: string | null;
  project: string;
  repo: string;
  checkoutId: string | null;
  checkoutKind: "main" | "worktree" | "folder" | null;
  worktree: string | null | undefined;
  folder: string | undefined;
  paneId: string | null;
  role: "overseer" | null;
  title: string;
  inspectionIdentity: null;
  lastActivityAt: number | null | undefined;
  tool: NonNullable<Row["tool"]>;
  arrangement?: NonNullable<Row["arrangement"]>;
  taskEvidence?: { state: string; summary: null };
  taskStatusEvidence?: { status: string | null };
  lifecycleEvidence?: { state: string | null | undefined; reason: string | null | undefined };
};
