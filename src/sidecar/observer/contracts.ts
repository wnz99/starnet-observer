import type { ObserverRow, ObserverSnapshot } from "../../shared/observer.js";
import type { SessionInspection, MessageInspection } from "../../shared/inspection.js";
import type { ChildInspection } from "../inspector/contracts.js";
import type { HelperRow, HelperTranscripts } from "../helpers/contracts.js";
import type { makeHelperObserver } from "../helpers/index.js";
import type {
  IdentityOptions,
  IdentityResolution,
  FooterProof,
  RefreshState,
} from "../identity/types.js";
import type { ProjectOptions, ProjectResolution } from "../projects/types.js";
import type { Loaded } from "../overseer-state/records.js";
import type { publicBus } from "../bus/public.js";
import type { BusState } from "../bus/types.js";
export type ObserverInputRow = HelperRow;
export type Tool = ObserverRow["tool"];
type Awaitable<T> = T | Promise<T>;
export type ObserverExecute = (
  command: string,
  args: string[],
  settings: { timeout: number; maxBuffer: number; env?: NodeJS.ProcessEnv },
) => Promise<{ stdout: string }>;
export interface Pane extends Record<string, unknown> {
  pane_id: string;
  agent: ObserverRow["provider"];
}
export type ControlProof = Pane & { endpoint: string; observedAt: number };
export type InjectedIdentity = Pick<IdentityResolution, "sessionId"> & {
  source: string;
  proof?: FooterProof | null;
  reason?: string | null;
};
export interface Identities {
  resolveMany?: (panes: Pane[], refresh: RefreshState) => Awaitable<InjectedIdentity[]>;
  resolve?: (pane: Pane, refresh: RefreshState) => Awaitable<InjectedIdentity>;
  revalidateAll?: (proofs: FooterProof[]) => Awaitable<boolean>;
  revalidate?: (proof: FooterProof) => Awaitable<boolean>;
  retain?: (panes: Set<string>) => void;
}
export interface Projects {
  resolveMany?: (cwds: unknown[]) => Awaitable<Partial<ProjectResolution>[]>;
  resolve?: (cwd: unknown) => Awaitable<Partial<ProjectResolution>>;
}
export type HelperResult = {
  rows: ObserverInputRow[];
  annotations: Map<string, Partial<ObserverInputRow>>;
  overflow: Map<string, number>;
  groupOwners?: Map<string, string>;
  commitBindings?: (ids: Set<string>) => void;
  health?: string;
  reason?: string | null;
};
export interface Helpers {
  prepareChildren?: (
    parents: ObserverInputRow[],
    readSummary: (row: ObserverInputRow) => Promise<Tool>,
  ) => Awaitable<HelperResult>;
  children?: (parents: ObserverInputRow[]) => Awaitable<HelperResult>;
  inspect?: (
    row: ObserverInputRow,
  ) => Awaitable<
    ChildInspection | Awaited<ReturnType<ReturnType<typeof makeHelperObserver>["inspect"]>>
  >;
  close?: () => Awaitable<void>;
}
export interface Transcripts extends Partial<Omit<HelperTranscripts, "read">> {
  read?: (
    id: string,
    provider: ObserverRow["provider"],
    sessionId: string | null | undefined,
  ) => Awaitable<Tool>;
  inspect?: (
    id: string,
    provider: ObserverRow["provider"],
    sessionId: string | null | undefined,
  ) => Awaitable<ChildInspection>;
  retain: (ids: Set<string>) => void;
  beginDiscovery?: () => void;
}
export interface Desktop {
  inventory: () => Awaitable<{
    health: string;
    windows: ObserverInputRow[];
    observedAt?: number | null;
    reason?: string | null;
  }>;
  inspect?: (identity: string) => Awaitable<SessionInspection>;
}
export interface ObserverBus {
  read: () => Awaitable<BusState>;
  inspect?: (id: number, expectedIdentity?: string) => Awaitable<MessageInspection>;
  close?: () => Awaitable<void>;
}
export interface OverseerState {
  endpoint?: string;
  read: () => Promise<Loaded>;
  match: (pane: Pane, proof: Loaded) => Awaitable<boolean>;
}
export interface ObserverOptions {
  now?: () => number;
  execute?: ObserverExecute;
  arrange?: ProjectOptions["arrange"];
  projects?: Projects;
  transcripts?: Transcripts;
  helpers?: Helpers;
  bus?: ObserverBus;
  desktop?: Desktop;
  endpoint?: string;
  overseerState?: OverseerState;
  identities?: Identities;
  readIdentityConfiguration?: IdentityOptions["readConfiguration"];
  readProcessBirth?: IdentityOptions["readProcessBirth"];
  warmDetails?: boolean;
}
export interface Owner {
  row: ObserverInputRow;
  proof: FooterProof | undefined;
}
export type Owners = Owner[] | null | undefined;
export interface Sweep {
  parents: ObserverInputRow[];
  proofs: Map<string, FooterProof>;
  owners: Map<string, Owners>;
  warmed: Set<string>;
}
export interface Lineage extends Sweep {
  result: HelperResult;
  failed?: boolean;
}
export interface WarmTarget {
  row: ObserverInputRow;
  owners: Owners;
  key: string;
}
export type Inventory = Omit<ObserverSnapshot, "sessions" | "bus"> & {
  sessions: ObserverInputRow[];
  bus: ReturnType<typeof publicBus> | null;
};
