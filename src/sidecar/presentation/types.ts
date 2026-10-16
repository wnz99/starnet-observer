import type { Inventory } from "../observer/contracts.js";
import type { ObserverSnapshot } from "../../shared/observer.js";
type InventoryRow = Inventory["sessions"][number];
type Tool = NonNullable<InventoryRow["tool"]>;
export type Row = Pick<InventoryRow, "id"> &
  Partial<
    Pick<
      InventoryRow,
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
      | "host"
      | "checkoutId"
      | "checkoutKind"
      | "worktree"
      | "folder"
      | "paneId"
      | "role"
      | "arrangement"
    >
  > & {
    lastActivityAt?: unknown;
    tool?:
      | (Pick<Tool, "last"> & {
          available?: Tool["available"];
          observedAt?: unknown;
        })
      | undefined;
    taskStatusEvidence?:
      Pick<NonNullable<InventoryRow["taskStatusEvidence"]>, "status"> | undefined;
    lifecycleEvidence?:
      Pick<NonNullable<InventoryRow["lifecycleEvidence"]>, "state" | "reason"> | undefined;
  };
type InventoryBus = NonNullable<Inventory["bus"]> | NonNullable<ObserverSnapshot["bus"]>;
export type Bus = Partial<Pick<InventoryBus, "health" | "reason" | "observedAt" | "window">> &
  Pick<InventoryBus, "messages"> & { remote?: Remote };
export type HostBus = Omit<Bus, "messages"> & { messages?: Bus["messages"] };
export type Message = Bus["messages"][number];
export type Relay = NonNullable<Message["relay"]>;
type InventoryRemote = NonNullable<InventoryBus["remote"]>;
type Peer = InventoryRemote["peers"][number];
export type Remote = Omit<InventoryRemote, "onRelay" | "peers"> & {
  onRelay?: InventoryRemote["onRelay"];
  peers?: (Omit<Peer, "repos" | "list"> & Partial<Pick<Peer, "repos" | "list">>)[];
};
export type SourceHealth = Partial<
  Pick<ObserverSnapshot["sources"]["herdr"], "health" | "observedAt">
>;
export interface PresentationInput {
  sessions: Row[];
  aggregate?: unknown;
  health?: Inventory["health"];
  observedAt?: Inventory["observedAt"];
  error?: Inventory["error"];
  sources?: {
    herdr?: SourceHealth;
    desktop?: SourceHealth;
    hosts?: Record<
      string,
      Pick<NonNullable<Inventory["sources"]["hosts"]>[string], "health" | "observedAt" | "agents">
    >;
  };
  bus?: Bus | null;
  hostBus?: Record<string, HostBus | null>;
}
export interface PresentationSource<Snapshot extends PresentationInput> {
  get: () => Snapshot | Promise<Snapshot>;
  close?: () => unknown;
}
export type ProjectedRow = Pick<Row, "id"> & {
  [
    Key in
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
  ]?: Row[Key] | undefined;
} & {
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
  tool: Omit<Tool, "observedAt"> & { observedAt?: number };
  arrangement?: NonNullable<Row["arrangement"]>;
  taskEvidence?: { state: string; summary: null };
  taskStatusEvidence?: { status: string | null };
  lifecycleEvidence?: { state: string | null | undefined; reason: string | null | undefined };
};
