import { build, relayNetworks, shadowRows, representedRows } from "../scene/index.js";
import type { RemoteHost, Scene, RelayNetwork } from "../scene/types.js";
import type { MailFrame } from "../view/types.js";
import type { AppView } from "./contracts.js";
import type { AppBus, AppQuerySnapshot, AppRow } from "./data.js";
import type { AppState } from "./state.js";
import { HelperPresentation } from "./helper-presentation.js";
import { geometryField, refreshSceneRows } from "./floor-rows.js";

interface FloorOptions {
  state: AppState;
  view: AppView;
  now(): number;
  frame(): number;
  mailFrame(now: number): MailFrame;
  inspected(): string | null;
  repositoryToggle(repo: string): void;
  showZoom(key: string): void;
  overview(): void;
  setPage(page: number): void;
  refresh(): void;
}
const MINUTE_MS = 60000;
type ShadowRow = ReturnType<typeof shadowRows>[number];
type RelayMember = { host: string | null; repo: string };
/* llm-bus relays come from each observed bus's own binding. Each unobserved machine on a relay becomes a shadow ship
   of ghost crew from the relay roster: on the floor only, never in byId, so nothing selects, inspects or controls it. */
export class Floor {
  displayedRows: AppRow[] = [];
  readonly shadows = new Map<string, ShadowRow>();
  readonly relayMembers = new Map<string, RelayMember>();
  private sceneKey: string | null = null;
  private contentKey: string | null = null;
  private readonly presentation: HelperPresentation;
  private candidates: AppRow[] = [];
  private presentationKey = "";
  private generation = 0;
  private startupEligibilityDelivered = false;
  private resumedAt: number | null = null;
  constructor(private readonly options: FloorOptions) {
    this.presentation = new HelperPresentation(options.state);
  }
  observe(snapshot: AppQuerySnapshot) {
    if (this.resumedAt !== this.options.state.resumedAt) {
      this.resumedAt = this.options.state.resumedAt;
      this.reset();
    }
    this.candidates = this.presentation.reconcile(snapshot.data?.sessions ?? [], {
      snapshot,
      now: this.options.now(),
    });
    const key = JSON.stringify(
      this.candidates.map((row) => [row.id, this.presentation.phase(row.id)]),
    );
    const changed = key !== this.presentationKey;
    this.presentationKey = key;
    return changed;
  }
  reset() {
    this.sceneKey = null;
    this.generation++;
    this.presentation.reset();
  }
  private relays(buses: [string | null, AppBus | null][]) {
    const nets = relayNetworks(buses, this.options.now());
    const ghosts = shadowRows(nets);
    this.shadows.clear();
    for (const row of ghosts) this.shadows.set(row.id, row);
    // Who the relay carries: each bus's own published panes (exact pane joins, by its host) and every shadow agent.
    this.relayMembers.clear();
    for (const [host, bus] of buses)
      for (const entry of bus?.remote?.onRelay ?? [])
        this.relayMembers.set(entry.id, { host, repo: entry.repo });
    for (const row of ghosts)
      this.relayMembers.set(row.id, { host: row.host ?? null, repo: row.repo ?? "" });
    return { nets, ghosts };
  }
  private sceneHosts(hosts: RemoteHost[], nets: RelayNetwork[], ghosts: ShadowRow[]): RemoteHost[] {
    const shadows = nets.flatMap((net) =>
      net.shadows.map((shadow) => ({
        id: shadow.host,
        shadow: true,
        health: "shadow",
        machine: shadow.machine,
        relay: net.relay,
        member: net.members[0]?.host ?? null,
        agents: Math.max(shadow.agents, ghosts.filter((row) => row.host === shadow.host).length),
        lastSeen: shadow.lastSeen,
      })),
    );
    // Each shadow ship docks beside the first observed ship on its relay (this machine first, when it is a member).
    return [
      ...hosts,
      ...shadows.filter(
        (host, index) => shadows.findIndex((other) => other.id === host.id) === index,
      ),
    ];
  }
  private relayKey(hosts: RemoteHost[], nets: RelayNetwork[]) {
    return JSON.stringify([
      [...this.relayMembers.keys()].sort(),
      hosts.filter((host) => host.shadow).map((host) => [host.id, host.agents]),
      nets.map((net) => [
        net.relay,
        net.members.map((member) => [
          member.host,
          member.state,
          member.crossed,
          member.lastActivityAt &&
            Math.floor((this.options.now() - member.lastActivityAt) / MINUTE_MS),
        ]),
      ]),
    ]);
  }
  private reconcile(
    rows: AppRow[],
    ghosts: ShadowRow[],
    overseer: AppRow | null,
    hasData: boolean,
  ) {
    const { state } = this.options;
    state.layout.reconcile([...rows.filter((row) => row !== overseer), ...ghosts]);
    if (hasData && state.page >= state.layout.pages())
      this.options.setPage(state.layout.pages() - 1);
    const first = rows[0];
    if (state.layout.onPage(state.page).length === 0 && first) {
      this.options.setPage(state.layout.pageFor(first.id));
    }
  }
  private geometryKey(hosts: RemoteHost[], overseer: AppRow | null) {
    const { state } = this.options;
    const fields: unknown[] = [
      state.page,
      state.layout.onPage(state.page),
      overseer && [overseer.id, overseer.status, overseer.provider],
    ];
    if (hosts.length > 0)
      fields.push(
        hosts.map((host) => [
          host.id,
          host.health,
          host.agents,
          host.reason,
          host.health === "available"
            ? null
            : Math.floor((this.options.frame() - (host.observedAt || 0)) / MINUTE_MS),
        ]),
      );
    // Geometry and row fields consumed by floor paint or movement; titles and tools are read live by the hover callbacks.
    return JSON.stringify(fields, geometryField);
  }
  private update(scene: Scene) {
    const { state, view } = this.options;
    const generation = ++this.generation;
    const rowStale = (id: string) => {
      const raw = state.byId.get(id);
      return raw
        ? state.rowStale(raw)
        : !state.latest ||
            (this.presentation.returnStale(id, state.latest, this.options.now()) ?? true);
    };
    // Row freshness is read from the current roster by id: the cached scene's row objects can be older.
    view.update(scene, {
      startupEligible: !!state.latest?.data,
      stale: () => state.isStale(),
      rowStale: (worker) => rowStale(worker.id),
      onHelperSettled: (id, phase) => {
        if (generation !== this.generation || state.disposed || !state.active || rowStale(id))
          return;
        if (this.presentation.settle(id, phase)) this.options.refresh();
      },
      mailFrame: (now) => this.options.mailFrame(now),
      inspected: () => this.options.inspected(),
      repositorySelection: () => state.selectedRepoId,
      onRepositoryToggle: (repo) => {
        this.options.repositoryToggle(repo);
      },
    });
    if (state.latest?.data) this.startupEligibilityDelivered = true;
    if (state.zoomed) this.options.showZoom(state.zoomed);
  }
  private content(snapshot: AppQuerySnapshot) {
    const data = snapshot.data;
    const bus = data?.bus;
    const messages = bus?.messages ?? [];
    // Hover text, plates and pending envelopes read rows and bus live; a frozen floor repaints only when they change.
    return JSON.stringify([
      this.options.state.isStale(snapshot),
      data?.health,
      data?.sessions ?? [],
      bus && [bus.health, bus.reason, messages],
      Object.entries(data?.hostBus ?? {}).map(([id, value]) => [
        id,
        value?.health,
        value?.messages,
      ]),
    ]);
  }
  private buildScene(
    snapshot: AppQuerySnapshot,
    hosts: RemoteHost[],
    nets: RelayNetwork[],
    overseer: AppRow | null,
  ) {
    const { state } = this.options;
    const sources = snapshot.data?.sources;
    const local = sources?.hosts?.local;
    const colors = state.pack.scene.colors;
    return build(state.layout.onPage(state.page), state.page, {
      overseer,
      overseerAccent: colors.cyan,
      relays: nets,
      relayMembers: this.relayMembers,
      ...(hosts.length > 0
        ? { hosts, ...(local?.health ? { localHealth: local.health } : {}) }
        : {}),
    });
  }
  private observedRelays(snapshot: AppQuerySnapshot, hosts: RemoteHost[]) {
    const data = snapshot.data;
    const buses: [string | null, AppBus | null][] = [
      [null, data?.bus ?? null],
      ...Object.entries(data?.hostBus ?? {}).filter(([id]) => hosts.some((host) => host.id === id)),
    ];
    return this.relays(buses);
  }
  private crew(rows: AppRow[], overseer: AppRow | null) {
    const { state } = this.options;
    refreshSceneRows(state.scene, [...rows, ...this.shadows.values()]);
    const observed = (ids: readonly string[]) => {
      const represented = new Set(ids);
      return rows.filter((row) => represented.has(row.id));
    };
    this.displayedRows = observed([
      ...representedRows(state.layout.allRooms()).map((row) => row.id),
      ...(overseer ? [overseer.id] : []),
    ]);
    if (state.selected && !this.displayedRows.some((row) => row.id === state.selected))
      this.options.overview();
    return observed(state.scene?.workers.map((worker) => worker.id) ?? []);
  }
  private settleOffPage(snapshot: AppQuerySnapshot) {
    const { state } = this.options;
    const onPage = new Set(representedRows(state.layout.onPage(state.page)).map((row) => row.id));
    const changed = this.presentation.settleOffPage(onPage);
    if (changed) this.observe(snapshot);
    return changed;
  }
  private phases(scene: Scene) {
    for (const worker of scene.workers) {
      const phase = this.presentation.phase(worker.id);
      if (phase && worker.kind === "helper" && worker.row.source === "helper") {
        worker.helperPhase = phase;
        const platform = scene.platforms.find((value) => value.key === worker.platformKey);
        if (platform) worker.quartersEntry = platform.quarters.entry;
      }
    }
  }
  private needsEligibility(snapshot: AppQuerySnapshot) {
    return !!snapshot.data && !this.startupEligibilityDelivered;
  }
  render(snapshot: AppQuerySnapshot, hosts: RemoteHost[], refresh: boolean) {
    const { state, view } = this.options;
    let rows = this.candidates;
    const overseer =
      rows.find((row) => row.role === "overseer" && row.source === "herdr" && !row.host) ?? null;
    const { nets, ghosts } = this.observedRelays(snapshot, hosts);
    const sceneHosts = this.sceneHosts(hosts, nets, ghosts);
    this.reconcile(rows, ghosts, overseer, !!snapshot.data);
    if (this.settleOffPage(snapshot)) {
      rows = this.candidates;
      this.reconcile(rows, ghosts, overseer, !!snapshot.data);
    }
    const key =
      this.geometryKey(hosts, overseer) +
      this.relayKey(sceneHosts, nets) +
      JSON.stringify(rows.map((row) => [row.id, this.presentation.phase(row.id)]));
    const content = this.content(snapshot);
    if (key !== this.sceneKey || !state.scene) {
      this.sceneKey = key;
      state.scene = this.buildScene(snapshot, sceneHosts, nets, overseer);
      this.phases(state.scene);
      this.update(state.scene);
    } else if (this.needsEligibility(snapshot)) this.update(state.scene);
    else if (refresh || content !== this.contentKey) view.invalidate();
    this.contentKey = content;
    const onFloor = this.crew(rows, overseer);
    return {
      displayedRows: this.displayedRows,
      onFloor,
      floorRows: [...(snapshot.data?.sessions ?? []), ...ghosts],
    };
  }
  dispose() {
    this.generation++;
    this.presentation.dispose();
    this.candidates = [];
    this.displayedRows = [];
    for (const map of [this.shadows, this.relayMembers]) map.clear();
  }
}
