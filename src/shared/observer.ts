export interface ConfigInput {
  presentation?: boolean;
  company?: string;
  repoPrefix?: string;
  rooms?: { name: string; repos: string[] }[];
  theme?: {
    pack?: string;
    fx?: boolean;
    arrange?: boolean;
    colors?: Partial<Record<"accent" | "background" | "panel" | "text", string>>;
  };
  roomsFile?: string;
  remotes?: { id: string; ssh: string; dir: string }[];
}
export interface ObserverConfig {
  presentation: boolean;
  labels: {
    company: string;
    repoPrefix: string;
    rooms: readonly { name: string; repos: readonly string[] }[];
  };
  theme: NonNullable<ConfigInput["theme"]>;
  roomsFile: string;
  remotes: NonNullable<ConfigInput["remotes"]>;
}
export type Health = "available" | "unavailable";
type Provider = "codex" | "claude";
interface SourceHealth {
  health: Health | "stale";
  observedAt: number | null;
  reason: string | null;
}
interface Counter {
  value: number | null;
  state: string | null;
}
interface Usage {
  inputTokens: Counter | null;
  outputTokens: Counter | null;
  cacheReadTokens: Counter | null;
  cacheWriteTokens: Counter | null;
  coverage?: string | null;
  observedAt?: number | string | null;
}
export interface ObserverRow {
  id: string;
  provider: Provider;
  source: "herdr" | "helper" | "desktop";
  role?: "overseer" | null;
  host?: string | null;
  paneId?: string | null;
  title: string;
  projectId: string | null;
  project: string;
  projectKind: string | null;
  projectHome?: boolean;
  repoId: string | null;
  repo: string;
  repoKind?: string | null;
  checkoutId?: string | null;
  checkoutKind?: "main" | "worktree" | "folder" | null;
  worktree?: string | null;
  checkoutObservation?: {
    source: "shell-entry";
    observedAt: number;
    state: "observed" | "stale";
    repoId: string | null;
    repo: string;
    checkoutId: string | null;
    checkoutKind: "main" | "worktree" | "folder" | null;
    worktree: string | null;
  };
  folder?: string;
  status: "working" | "blocked" | "idle" | "done" | "unknown";
  sessionId: string | null;
  identitySource?: string | null;
  identityHealth?: Health;
  inspectionIdentity: string | null;
  presence: string | null;
  observedAt: number | null;
  inventoryHealth: Health;
  usage?: Usage | null;
  tool: {
    available: boolean;
    observedAt?: number | string | null | undefined;
    lastEntryAt?: number | null;
    last?: {
      name: string | null;
      phase: string | null;
      outcome: string | null;
      at: number | string | null;
    } | null;
    usage?: Usage | null;
  };
  lastActivityAt?: number | null;
  parentId?: string | null;
  helperSlot?: number | null;
  helperOverflow?: number;
  worktreeId?: string | null;
  arrangement?: { roomId: string; room: string; sectionId: string; section: string };
  lineageState?: string | null;
  task?: string;
  taskEvidence?: {
    state: string;
    summary: string | null;
    source: string | null;
    observedAt: number | string | null;
  };
  taskStatusEvidence?: {
    status: string | null;
    source: string | null;
    observedAt: number | string | null;
  };
  lifecycleEvidence?: {
    state: string | null;
    reason: string | null;
    source?: string | null;
    observedAt?: number | null;
  };
}
export interface ObserverSnapshot {
  sessions: ObserverRow[];
  aggregate: {
    agents: {
      observed: number;
      verifiedSessions: number;
      presenceOnly: number;
      statuses: Record<ObserverRow["status"], number>;
      stale: number;
    };
    usage: Record<
      "inputTokens" | "outputTokens" | "cacheReadTokens" | "cacheWriteTokens",
      { value: number | null; state: "available" | "partial" | "unavailable" }
    >;
    coverage: Coverage & {
      conflicting: number;
      counters: Record<
        "inputTokens" | "outputTokens" | "cacheReadTokens" | "cacheWriteTokens",
        Coverage
      >;
    };
    usageObservedAt: number | null;
  };
  observedAt: number | null;
  health: Health;
  error: string | null;
  sources: {
    herdr: SourceHealth;
    desktop: SourceHealth;
    hosts?: Record<string, SourceHealth & { agents: number }>;
  };
  hostBus?: Record<string, PublicBus | null>;
  bus: PublicBus | null;
}
interface Coverage {
  eligible: number;
  available: number;
  partial: number;
  unavailable: number;
  stale: number;
}
type BusObservationStatus = "available" | "partial" | "unavailable";
interface PublicBus {
  health: Health;
  reason: string | null;
  observedAt: number | null;
  window: number;
  coordination?: {
    overview?: {
      asOf: number;
      agents: { status: BusObservationStatus; codex: number | null; claude: number | null };
      messages: {
        status: BusObservationStatus;
        total: number | null;
        local: number | null;
        remote: number | null;
      };
      awaiting: { status: BusObservationStatus; count: number | null; oldestAt: number | null };
      wakes: {
        pending: { status: BusObservationStatus; count: number | null };
        failed: { status: BusObservationStatus; count: number | null };
      };
      attention: {
        status: BusObservationStatus;
        truncated: boolean;
        rows: { id: number; sentAt: number; reasons: ("unacknowledged" | "wake-failed")[] }[];
      };
      resources: {
        status: BusObservationStatus;
        truncated: boolean;
        rows: {
          resource: string;
          scope: "shared" | "repository";
          holder?: string;
          acquiredAt: number | null;
          expiresAt: number | null;
          checkAt: number | null;
          waiters: { agent: string; requestedAt: number | null }[];
        }[];
      };
      remoteActivity: {
        status: BusObservationStatus;
        truncated: boolean;
        rows: {
          machine: string;
          sentAt: number;
          state: NonNullable<PublicBus["messages"][number]["relay"]>["state"];
        }[];
      };
    };
    sections: {
      title: string;
      available: boolean;
      truncated: boolean;
      rows: { label: string; detail: string; agent?: string }[];
    }[];
  };
  messages: {
    id: number;
    identity?: string;
    key?: string;
    host?: string;
    from: string;
    to: string;
    sentAt: number | string | null;
    acknowledgedAt: number | string | null;
    wake: "none" | "requested" | "failed" | "unsupported" | "unknown";
    replyTo?: number | null;
    relay?: {
      direction: "in" | "out";
      machine: string;
      repo: string;
      provider: Provider | null;
      peer?: string | null;
      state:
        | "queued_local"
        | "accepted_remote"
        | "delivered_local"
        | "acknowledged"
        | "expired"
        | "unknown";
    };
  }[];
  remote?: {
    relay: string;
    machine: string;
    lastActivityAt: number | null;
    onRelay: { id: string; repo: string }[];
    peers: {
      machine: string;
      repos: string[];
      agents: number;
      lastSeen: number | null;
      list: { id: string; provider: Provider; repo: string; lastSeen: number | null }[];
    }[];
  };
}
