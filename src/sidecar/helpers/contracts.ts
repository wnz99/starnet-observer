import type { ObserverRow } from "../../shared/observer.js";
import type { SessionInspection } from "../../shared/inspection.js";
import type { HelperEdges } from "./edges.js";
import type { SnapshotOptions } from "../sqlite/snapshots.js";
export type HelperRow = { id: string; provider: ObserverRow["provider"] } & {
  [K in keyof ObserverRow]?: ObserverRow[K] | undefined;
};
export type Root = HelperRow & { sessionId: string };
export interface TaskEvent {
  status: string;
  source: string;
  observedAt: number | null;
  toolUseId?: string | null;
}
interface Spawn {
  summary: string | null;
  source: string;
  observedAt: number | null;
  partial?: boolean;
  toolUseId?: string;
  parentId?: string;
  parentBinding?: ChildBinding | null;
  parentSessionId?: string;
  parentFile?: string;
}
interface HelperProjection {
  helperSpawns: Map<string, Spawn | null>;
  helperEvents: Map<string, TaskEvent>;
  ownTask: TaskEvent | null;
  lastActivityAt: string | null;
}
export interface ChildBinding {
  provider: ObserverRow["provider"];
  sessionId: string;
  parentSessionId: string;
  file?: string;
  nickname?: string | null;
  projection?: HelperProjection;
  usage?: ObserverRow["usage"];
  spawn?: Spawn | undefined;
}
export interface Candidate {
  child: string;
  state: string;
  sessionId?: string;
  canonical?: string;
  file?: string;
  spawn?: Spawn;
  event?: TaskEvent | null;
}
interface Claims {
  available: boolean;
  has(child: string): boolean;
}
type Awaitable<T> = T | Promise<T>;
interface ChildInspection {
  available: boolean;
  inspection?: SessionInspection;
  usage?: ObserverRow["usage"];
  lastEntryAt?: number | null;
  last?: ObserverRow["tool"]["last"];
}
export interface HelperTranscripts {
  read(
    id: string,
    provider: ObserverRow["provider"],
    sessionId: string | null | undefined,
  ): Awaitable<{ available: boolean }>;
  bindChild?(
    provider: ObserverRow["provider"],
    child: string,
    parent: string,
    file?: string,
    spawn?: Spawn,
  ): Awaitable<ChildBinding | null>;
  claudeCandidates?(
    parent: string,
    binding: ChildBinding | undefined,
    id: string,
  ): Awaitable<(Omit<Candidate, "child" | "state"> & { sessionId: string })[]>;
  helperMetadata?(id: string): HelperProjection | undefined;
  claudeClaims?(id: string): Claims | undefined;
  inspectChild(id: string, binding: ChildBinding): Awaitable<ChildInspection>;
}
export interface HelperOptions extends Partial<SnapshotOptions> {
  now?: () => number;
  transcripts?: HelperTranscripts;
  readEdges?: () => Awaitable<HelperEdges>;
}
export interface Ancestor {
  canonical: string;
  claims: Claims | null | undefined;
}
