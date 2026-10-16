import { InventoryReader } from "./inventory.js";
import { Publisher } from "./publication.js";
import { Enrichment } from "./enrichment.js";
import { Warmup } from "./warmup.js";
import { Refresh } from "./refresh.js";
import { Snapshots } from "./snapshot.js";
import { Lifecycle } from "./lifecycle.js";
import type { ObserverSnapshot } from "../../shared/observer.js";
import type { FooterProof } from "../identity/types.js";
import type { BusState } from "../bus/types.js";
import type { makeSqliteClient } from "../sqlite/client.js";
import type {
  Row,
  Tool,
  Owners,
  Sweep,
  Lineage,
  WarmTarget,
  Inventory,
  ObserverOptions,
  Execute,
  Projects,
  Transcripts,
  Helpers,
  Desktop,
  Bus,
  Identities,
  OverseerState,
  ControlProof,
} from "./contracts.js";
export class State {
  inventory = new InventoryReader(this);
  publication = new Publisher(this);
  enricher = new Enrichment(this);
  warmup = new Warmup(this);
  refresh = new Refresh(this);
  snapshot = new Snapshots(this);
  lifecycle = new Lifecycle(this);

  identityProofs = new Map<string, FooterProof>();
  controlTargets = new Map<string, ControlProof>();
  lastGood: Row[] = [];
  coreRows: Row[] = [];
  refreshStartedAt: number | null = null;
  pending: Promise<Inventory> | null = null;
  mail: BusState | null = null;
  closed = false;
  enrichment: Promise<unknown> | null = null;
  enrichmentTarget: Sweep | null = null;
  lineage: Lineage | null = null;
  desktopPending: Promise<void> | null = null;
  busPending: Promise<void> | null = null;
  summaries = new Map<string, { owners: Owners; tool: Tool; observedAt: number | string }>();
  warmQueue = new Map<string, WarmTarget>();
  warmScheduled = new Map<string, { key: string; at: number }>();
  warmRunning = new Set<Promise<unknown>>();
  sources: ObserverSnapshot["sources"] = {
    herdr: { health: "unavailable", observedAt: null, reason: "not-observed" },
    desktop: { health: "unavailable", observedAt: null, reason: "not-observed" },
  };
  rowsBySource: Record<"herdr" | "desktop" | "helper", Row[]> = {
    herdr: [],
    desktop: [],
    helper: [],
  };
  closePromise: Promise<void> | null = null;
  constructor(
    readonly dependencies: {
      options: ObserverOptions;
      now: () => number;
      execute: Execute;
      projects: Projects;
      transcripts: Transcripts;
      sqlite: ReturnType<typeof makeSqliteClient> | null;
      helpers: Helpers;
      bus: Bus;
      desktop: Desktop;
      endpoint: string;
      overseerState: OverseerState;
      identities: Identities;
    },
  ) {}
  get options() {
    return this.dependencies.options;
  }
  get now() {
    return this.dependencies.now;
  }
  get execute() {
    return this.dependencies.execute;
  }
  get projects() {
    return this.dependencies.projects;
  }
  get transcripts() {
    return this.dependencies.transcripts;
  }
  get sqlite() {
    return this.dependencies.sqlite;
  }
  get helpers() {
    return this.dependencies.helpers;
  }
  get bus() {
    return this.dependencies.bus;
  }
  get desktop() {
    return this.dependencies.desktop;
  }
  get endpoint() {
    return this.dependencies.endpoint;
  }
  get overseerState() {
    return this.dependencies.overseerState;
  }
  get identities() {
    return this.dependencies.identities;
  }
}
