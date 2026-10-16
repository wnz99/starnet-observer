import type {
  TaskEvent,
  Spawn,
  ChildBinding,
  Projection,
  ChildInspection,
} from "../inspector/contracts.js";
export type { TaskEvent, ChildBinding } from "../inspector/contracts.js";
import type { ObserverRow } from "../../shared/observer.js";
import type { HelperEdges } from "./edges.js";
import type { SnapshotOptions } from "../sqlite/snapshots.js";
export type HelperRow = { id: string; provider: ObserverRow["provider"] } & {
  [K in keyof ObserverRow]?: ObserverRow[K] | undefined;
};
export type Root = HelperRow & { sessionId: string };
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
  helperMetadata?(id: string): Projection | undefined;
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
