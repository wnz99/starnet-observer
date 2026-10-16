import type { BoundedMap } from "./helper-state.js";
import type { ObserverRow } from "../../shared/observer.js";
import type { SessionInspection } from "../../shared/inspection.js";
export type Provider = ObserverRow["provider"];
export type Turn = SessionInspection["turns"][number];
export type Snapshot = Pick<
  SessionInspection,
  "health" | "reason" | "stats" | "turns" | "truncated" | "window" | "generation"
>;
export interface TaskEvent {
  status: string;
  source: string;
  observedAt: number | null;
  toolUseId?: string | null | undefined;
}
export interface Assignment {
  summary: string | null;
  source: string;
  observedAt: number | null;
  partial?: boolean | undefined;
}
export interface Spawn extends Assignment {
  toolUseId?: string | undefined;
  parentId?: string | undefined;
  parentBinding?: ChildBinding | null | undefined;
  parentSessionId?: string | undefined;
  parentFile?: string | undefined;
}
export interface ChildBinding {
  provider: Provider;
  sessionId: string;
  parentSessionId: string;
  file?: string | undefined;
  nickname?: string | null | undefined;
  projection?: Projection | undefined;
  usage?: ObserverRow["usage"] | undefined;
  spawn?: Spawn | undefined;
}
export type UsageKey = "inputTokens" | "outputTokens" | "cacheReadTokens" | "cacheWriteTokens";
export type Totals = Record<UsageKey, number | null>;
export interface Projection {
  generation: string;
  turns: Map<string, Turn>;
  usage: Map<string, Totals>;
  totals: Totals | null;
  model: string | null;
  helperCalls: BoundedMap<Assignment>;
  helperSpawns: BoundedMap<Spawn | null>;
  helperEvents: BoundedMap<TaskEvent>;
  helperClaimsPartial: boolean;
  ownTask: TaskEvent | null;
  startedAt: string | null;
  lastActivityAt: string | null;
  lastEntryAt: string | null;
  truncated: boolean;
  bounded: boolean;
  usagePartial: boolean;
  modelPartial: boolean;
}
export interface SessionContext {
  provider: Provider;
  sessionId: string;
  binding?: ChildBinding | null | undefined;
}
export interface ConsumeOptions {
  header?: boolean;
  beginning?: boolean;
}
export type ChildInspection = { available: false } | ({ available: true } & Snapshot);
