import type { ThemeContents } from "../../shared/theme.js";
import { createModel } from "../model.js";
import type { Scene } from "../scene/types.js";
import type { AppClock } from "./dom.js";
import type { AppQuerySnapshot, AppRow, AppSnapshot } from "./data.js";

export const FRESH_MS = 6000;
type Model = ReturnType<typeof createModel>;
export class AppState {
  readonly model: Model;
  layout: ReturnType<Model["createLayout"]>;
  latest: AppQuerySnapshot | null = null;
  rawLatest: AppQuerySnapshot | null = null;
  selected: string | null = null;
  selectedRepoId: string | null = null;
  selectedHost: string | null = null;
  mailSelected: number | null = null;
  page = 0;
  filter = "all";
  zoomed: string | null = null;
  scene: Scene | null = null;
  byId = new Map<string, AppRow>();
  active = false;
  disposed = false;
  resumedAt = 0;
  awaitingProof = false;
  cachedAtResume: AppSnapshot | null | undefined;
  arrangeOn = false;
  private arrangedFrom: AppSnapshot | null = null;
  private arrangedTo: AppSnapshot | null = null;
  constructor(
    readonly pack: ThemeContents,
    private readonly clock: AppClock,
    model: Model = createModel(pack),
  ) {
    this.model = model;
    this.layout = this.model.createLayout({ projectAccents: pack.scene.projectAccents });
  }
  fresh(at: unknown): at is number {
    return typeof at === "number" && Number.isFinite(at) && this.clock.now() - at <= FRESH_MS;
  }
  // Overall freshness means at least one source refreshed; it never makes another source's rows live.
  isStale(state: AppQuerySnapshot | null = this.latest) {
    return (
      !state ||
      !!state.error ||
      !state.data ||
      state.data.health !== "available" ||
      !this.fresh(state.data.observedAt)
    );
  }
  // A row is live only on its own source health and observation time (rows without them use the inventory's).
  rowStale(row: AppRow | undefined, state: AppQuerySnapshot | null = this.latest) {
    if (!row || this.isStale(state)) return true;
    const inventory = state?.data;
    return (
      (row.inventoryHealth || inventory?.health) !== "available" ||
      !this.fresh(this.rowObservedAt(row, state))
    );
  }
  private rowObservedAt(row: AppRow, state: AppQuerySnapshot | null) {
    return typeof row.observedAt === "number" && Number.isFinite(row.observedAt)
      ? row.observedAt
      : state?.data?.observedAt;
  }
  // A named source; an inventory without per-source records is the Herdr inventory itself.
  sourceStale(name: "herdr" | "desktop", state: AppQuerySnapshot | null = this.latest) {
    const sources = state?.data?.sources;
    if (this.isStale(state)) return true;
    return sources ? !this.observedLive(sources[name]) : name !== "herdr";
  }
  private observedLive(source: { health?: string; observedAt?: number | null } | null | undefined) {
    return source?.health === "available" && this.fresh(source.observedAt);
  }
  // Couriers fly between Herdr panes, so a fresh Desktop source never launches them over a stale Herdr floor.
  mailStale(state: AppQuerySnapshot | null = this.latest) {
    return this.isStale(state) || this.sourceStale("herdr", state);
  }
  remoteMailStale(host: string, state: AppQuerySnapshot | null = this.latest) {
    const data = state?.data;
    const sources = data?.sources;
    return (
      this.isStale(state) ||
      !this.observedLive(sources?.hosts?.[host]) ||
      !this.observedLive(data?.hostBus?.[host])
    );
  }
  /* Mail is proved by the observer transport, not by Herdr or Desktop: the latest inventory request succeeded within
     six seconds and its bus was readable. The bus's own observedAt is the last copy time and stays old during the time the
     source is unchanged, so it is not a freshness test. */
  busLive(state: AppQuerySnapshot | null = this.latest) {
    return !!(
      state?.hasData &&
      !state.error &&
      this.fresh(state.updatedAt) &&
      state.data?.bus?.health === "available"
    );
  }
  // The mail panel lists the selected host's own bus (this machine's unless a remote host tab is chosen).
  panelBus() {
    const data = this.latest?.data;
    return (
      (this.selectedHost && data?.hostBus?.[this.selectedHost]) ||
      (this.selectedHost ? null : data?.bus) ||
      null
    );
  }
  messageFor(id: number) {
    return this.panelBus()?.messages?.find((message) => message.id === id);
  }
  /* ARRANGE: the page draws either the folder grouping or the sidecar's dynamic arrangement. The arranged copy is
     memoised per snapshot so unchanged data keeps its identity; toggling rebuilds the layout once (desks then hold). */
  arrangedState(state: AppQuerySnapshot): AppQuerySnapshot {
    if (!this.arrangeOn || !state.data) return state;
    if (this.arrangedFrom !== state.data) {
      this.arrangedFrom = state.data;
      this.arrangedTo = { ...state.data, sessions: state.data.sessions.map(this.model.arranged) };
    }
    return { ...state, data: this.arrangedTo };
  }
}
