import type { PanelStack } from "./panel-stack.js";
import type { QuerySnapshot } from "../queryspine/types.js";
import type { SpriteResource } from "../sprites/types.js";
import { isAppSnapshot } from "./admission.js";
import type { AppQuerySnapshot } from "./data.js";
import type { PendingSpawn } from "./controls.js";
import type { AppNode } from "./dom.js";
import type { AppView } from "./contracts.js";
import type { Couriers } from "./couriers.js";
import type { FreshnessDeadline } from "./deadline.js";
import type { Floor } from "./floor.js";
import type { Hosts } from "./hosts.js";
import type { Ledger } from "./ledger.js";
import type { AppRoster } from "./roster-ports.js";
import type { AppState } from "./state.js";
import type { Totals } from "./totals.js";
import { renderHeader } from "./header.js";
import { setText, type AppUi } from "./ui.js";

interface RenderOptions<N extends AppNode, R extends SpriteResource> {
  ui: AppUi<N, R>;
  state: AppState;
  view: Pick<AppView, "invalidate">;
  enabled: boolean;
  hosts: Hosts<N, R>;
  floor: Floor;
  couriers: Couriers;
  ledger: Ledger<N, R>;
  roster: AppRoster<N>;
  totals: Totals<N, R>;
  deadline: FreshnessDeadline;
  panels: Pick<PanelStack<N, R>, "resume" | "resumeMailrooms" | "roster">;
  select(id: string): void;
  now(): number;
}
/* Health, freshness and ages follow every notification; content work follows changed content or an explicit
   view change. QuerySpine re-notifies the old data during the entire time a request is pending: that is metadata only. */
export class AppRenderer<N extends AppNode, R extends SpriteResource> {
  private inventoryStale = true;
  private mailProof: boolean | null = null;
  private pendingSpawn: PendingSpawn | null = null;
  constructor(private readonly options: RenderOptions<N, R>) {}
  ingest(snapshot: QuerySnapshot) {
    const data = snapshot.data;
    if (data !== null && data !== undefined && !isAppSnapshot(data)) return;
    const state: AppQuerySnapshot = { ...snapshot, data };
    this.options.state.rawLatest = state;
    this.render(this.options.state.arrangedState(state));
  }
  refresh() {
    const latest = this.options.state.latest;
    if (latest) this.render(latest, { refresh: true });
  }
  refreshRoster(options: { canvas: boolean }) {
    const { state, hosts, roster, view, floor } = this.options;
    const snapshot = state.latest;
    if (!this.active() || !snapshot) return;
    const rows = floor.displayedRows;
    const hasHosts = hosts.list().length > 0;
    const panelRows = hasHosts
      ? rows.filter((row) => (row.host || null) === state.selectedHost)
      : rows;
    const bus = this.busFor(snapshot, hasHosts ? state.selectedHost : null);
    roster.render(panelRows, state.isStale(snapshot), bus?.messages ?? [], bus);
    this.emptyHost(snapshot, hosts.list().length, panelRows.length);
    if (options.canvas) view.invalidate();
  }
  arrangeChanged() {
    const { state } = this.options;
    if (state.rawLatest) this.render(state.arrangedState(state.rawLatest), { refresh: true });
  }
  spawned(target: PendingSpawn) {
    this.pendingSpawn = target;
  }
  private proveResume(snapshot: AppQuerySnapshot, stale: boolean) {
    const { state, panels } = this.options;
    /* Proof is the read resume started: invalidation bumps the resource generation, so a request issued before the
       page was hidden can settle but never replaces the data. New data, settled after resume and live, proves it. */
    if (
      snapshot.data &&
      snapshot.data !== state.cachedAtResume &&
      !snapshot.error &&
      !snapshot.pending &&
      snapshot.updatedAt >= state.resumedAt
    ) {
      panels.resumeMailrooms();
      if (state.awaitingProof && !stale) {
        state.awaitingProof = false;
        panels.resume();
      }
    }
  }
  private presentation(snapshot: AppQuerySnapshot) {
    const { ui, enabled } = this.options;
    const presentation = snapshot.data?.presentation;
    const brand = ui.document.querySelector(".brand h1");
    const badge = ui.document.querySelector(".read-only");
    if (brand)
      setText(
        brand,
        presentation ? String(presentation.company) + " · Observer" : "Local observer",
      );
    if (badge)
      setText(
        badge,
        presentation
          ? "LIVE · FICTIONAL LABELS" + (enabled ? " · CONTROLS ON" : "")
          : enabled
            ? "CONTROLS ON"
            : "READ ONLY",
      );
  }
  private selectSpawned(snapshot: AppQuerySnapshot) {
    if (!this.pendingSpawn) return;
    const paneId = this.pendingSpawn.paneId;
    const spawned = snapshot.data?.sessions.find((row) => row.paneId === paneId);
    if (spawned) {
      this.pendingSpawn = null;
      void Promise.resolve().then(() => {
        const { state } = this.options;
        if (!state.disposed && state.active) this.options.select(spawned.id);
      });
    } else if (this.options.now() > this.pendingSpawn.until) this.pendingSpawn = null;
  }
  private counts(
    snapshot: AppQuerySnapshot,
    panelRows: NonNullable<AppQuerySnapshot["data"]>["sessions"],
  ) {
    const { ui, state } = this.options;
    const stale = state.isStale(snapshot);
    // Working and waiting count only rows whose own source is live; the rest are reported as last known.
    const current = stale ? panelRows : panelRows.filter((row) => !state.rowStale(row, snapshot));
    const behind = panelRows.length - current.length;
    const working = current.filter((row) => row.status === "working").length;
    const blocked = current.filter((row) => row.status === "blocked").length;
    setText(
      ui.get("counts"),
      (stale ? "Last known: " : "") +
        String(working) +
        " working · " +
        String(blocked) +
        " waiting · " +
        String(panelRows.length) +
        " total" +
        (behind ? " · " + String(behind) + " last known" : ""),
    );
  }
  private deckCounts(rows: NonNullable<AppQuerySnapshot["data"]>["sessions"], onFloor: number) {
    const { ui, state } = this.options;
    setText(
      ui.get("page-label"),
      "Deck " +
        String(state.page + 1) +
        (state.layout.pages() > 1 ? " / " + String(state.layout.pages()) : ""),
    );
    ui.document.setDisabled(ui.get("previous-page"), { disabled: state.page === 0 });
    ui.document.setDisabled(ui.get("next-page"), {
      disabled: state.page + 1 >= state.layout.pages(),
    });
    const projects = new Set(rows.map(state.model.projectKey));
    setText(
      ui.get("room-count"),
      String(projects.size) + " projects · " + String(onFloor) + " workers on this deck",
    );
  }
  private busFor(snapshot: AppQuerySnapshot, host: string | null) {
    return host ? (snapshot.data?.hostBus?.[host] ?? null) : (snapshot.data?.bus ?? null);
  }
  private mailroom(snapshot: AppQuerySnapshot, hasHosts: boolean) {
    const { state, ui, couriers, ledger } = this.options;
    // The mailroom section lists the selected host's own bus; with remotes, the title names whose it is.
    const host = hasHosts ? state.selectedHost : null;
    const bus = this.busFor(snapshot, host);
    ledger.render(bus, host ? couriers.forHost(host) : couriers.local);
    if (hasHosts)
      setText(
        ui.get("mail-title"),
        "Mailroom · " +
          (state.selectedHost || "this machine") +
          " · recent " +
          String(Number.isInteger(bus?.window) ? bus?.window : 100),
      );
    return bus;
  }
  private reconcileRepository(rows: NonNullable<AppQuerySnapshot["data"]>["sessions"]) {
    const { state } = this.options;
    if (state.selectedRepoId !== null && !rows.some((row) => row.repoId === state.selectedRepoId))
      state.selectedRepoId = null;
  }
  private emptyHost(snapshot: AppQuerySnapshot, hosts: number, rows: number) {
    const { state, ui } = this.options;
    if (hosts > 0 && rows === 0 && !state.isStale(snapshot))
      setText(ui.get("empty"), "No sessions on " + (state.selectedHost || "this machine") + ".");
  }
  private content(snapshot: AppQuerySnapshot, refresh: boolean) {
    const { state, hosts, floor, couriers, roster, totals } = this.options;
    this.presentation(snapshot);
    const hostSources = snapshot.data?.sources?.hosts;
    const hostList = hosts.update(hostSources);
    this.selectSpawned(snapshot);
    const { displayedRows: rows, onFloor, floorRows } = floor.render(snapshot, hostList, refresh);
    // A repository whose last displayed row left clears its highlight.
    this.reconcileRepository(rows);
    totals.render(snapshot, rows);
    const panelRows =
      hostList.length > 0 ? rows.filter((row) => (row.host || null) === state.selectedHost) : rows;
    couriers.update(snapshot, floorRows);
    this.deckCounts(rows, onFloor.length);
    this.counts(snapshot, panelRows);
    hosts.render(hostSources, rows, panelRows);
    const bus = this.mailroom(snapshot, hostList.length > 0);
    roster.render(panelRows, state.isStale(snapshot), bus?.messages ?? [], bus);
    this.emptyHost(snapshot, hostList.length, panelRows.length);
    this.options.panels.roster("agent");
  }
  private sameContent(
    previous: AppQuerySnapshot | null,
    snapshot: AppQuerySnapshot,
    stale: boolean,
    proof: boolean,
  ) {
    return (
      previous !== null &&
      snapshot.data === previous.data &&
      stale === this.inventoryStale &&
      proof === this.mailProof
    );
  }
  private active() {
    const { state } = this.options;
    return !state.disposed && state.active;
  }
  render(snapshot: AppQuerySnapshot, options: { refresh?: boolean } = {}) {
    const { state, ui, totals, deadline } = this.options;
    if (!this.active()) return;
    const previous = state.latest;
    const stale = state.isStale(snapshot);
    state.latest = snapshot;
    state.byId = new Map((snapshot.data?.sessions ?? []).map((row) => [row.id, row]));
    renderHeader(ui, state, snapshot, this.options.now());
    deadline.arm(snapshot);
    if (!this.active()) return;
    /* Mail eligibility is its own transport proof, independent of agent staleness. QuerySpine keeps the same data
       object on a failed request, so a change in that proof must reach the mail panels even when nothing else did. */
    const proof = state.busLive(snapshot);
    const presentationChanged = this.options.floor.observe(snapshot);
    if (
      !options.refresh &&
      !presentationChanged &&
      this.sameContent(previous, snapshot, stale, proof)
    ) {
      totals.render(snapshot, this.options.floor.displayedRows);
      return;
    }
    this.mailProof = proof;
    this.inventoryStale = stale;
    this.proveResume(snapshot, stale);
    this.content(snapshot, options.refresh === true);
  }
  dispose() {
    this.pendingSpawn = null;
  }
}
