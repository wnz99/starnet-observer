import type { SpriteResource } from "../sprites/types.js";
import { isAppSnapshot } from "./admission.js";
import type { AppView, MountOptions, ObserverApp } from "./contracts.js";
import { createControls } from "./controls.js";
import { FreshnessDeadline } from "./deadline.js";
import type { AppNode } from "./dom.js";
import { Floor } from "./floor.js";
import { Hosts } from "./hosts.js";
import type { Ledger } from "./ledger.js";
import { AppLifecycle } from "./lifecycle.js";
import { createAppCore, type AppCore } from "./mount-core.js";
import { createStationView, type MountLinks } from "./mount-view.js";
import { StationPanels } from "./mount-panels.js";
import { initializeCrew } from "./mount-sprites.js";
import { Navigation } from "./navigation.js";
import type { Overlays } from "./overlays.js";
import type { PanelStack } from "./panel-stack.js";
import { AppRenderer } from "./render.js";
import type { AppRoster } from "./roster-ports.js";
import { Totals } from "./totals.js";
import { NodeEvents } from "./ui.js";
const OBSERVER_QUERY = {
  path: "/api/observer/sessions",
  ttlMs: 2000,
  pollMs: 2000,
  timeoutMs: 10000,
  validate: isAppSnapshot,
};
class ObserverMount<N extends AppNode, R extends SpriteResource, B extends R>
  implements ObserverApp, MountLinks<N, R>
{
  readonly core: AppCore<N, R, B>;
  readonly view: AppView;
  readonly controls: ReturnType<typeof createControls<N, R>>;
  navigation?: Navigation<N, R>;
  hosts?: Hosts<N, R>;
  panels?: PanelStack<N, R>;
  overlays?: Overlays<N, R>;
  renderer?: AppRenderer<N, R>;
  roster?: AppRoster<N>;
  floor?: Floor;
  ledger?: Ledger<N, R>;
  private readonly deadline: FreshnessDeadline;
  private readonly lifecycle: AppLifecycle<N, R>;
  private readonly events: NodeEvents;
  private readonly pagehide: () => void;
  private readonly pageshow: () => void;
  constructor(options: MountOptions<N, R, B>) {
    this.core = createAppCore(options);
    this.view = createStationView(this.core, this);
    this.controls = this.createControls();
    const navigation = this.createNavigation();
    this.navigation = navigation;
    const hosts = this.createHosts();
    this.hosts = hosts;
    const panelOwners = new StationPanels(this.core, this, navigation, this.controls);
    const { panels, roster, ledger } = panelOwners;
    this.panels = panels;
    this.overlays = panelOwners.overlays;
    this.roster = roster;
    this.ledger = ledger;
    const floor = this.createFloor(navigation, panels);
    this.floor = floor;
    const deadline = this.createDeadline(panels);
    this.deadline = deadline;
    const renderer = this.createRenderer({
      hosts,
      panels,
      roster,
      ledger,
      floor,
      deadline,
      navigation,
    });
    this.renderer = renderer;
    this.core.query.define("observer.sessions", OBSERVER_QUERY);
    this.lifecycle = this.createLifecycle(panels, renderer);
    this.events = new NodeEvents(() => !this.core.state.disposed);
    this.events.on(options.document, "visibilitychange", () => {
      this.lifecycle.visibilityChanged();
    });
    this.pagehide = () => {
      this.lifecycle.pagehide();
    };
    this.pageshow = () => {
      this.lifecycle.resume();
    };
    options.window.addEventListener("pagehide", this.pagehide);
    options.window.addEventListener("pageshow", this.pageshow);
    initializeCrew(this.core, this.view);
    this.lifecycle.resume();
  }
  private createControls() {
    const { options, bootstrap, state, ui, harness } = this.core;
    const controls = createControls({
      ui,
      enabled: bootstrap.control,
      active: () => state.active,
      disposed: () => state.disposed,
      clock: options.clock,
      scheduler: options.scheduler,
      post: (path, body, init) => harness.api.post(path, body, init),
      spawned: (target) => {
        this.renderer?.spawned(target);
      },
    });
    const { body } = ui.document;
    if (bootstrap.control) body.classList.add("control");
    return controls;
  }
  private createNavigation() {
    const { bootstrap, state, ui, prefs, couriers } = this.core;
    const { view } = this;
    const navigationOwner = new Navigation({
      ui,
      state,
      view,
      prefs,
      theme: bootstrap.theme,
      hostsPresent: () => (this.hosts?.list().length ?? 0) > 0,
      resetCouriers: () => {
        couriers.reset();
      },
      rebaseCouriers: () => {
        couriers.rebase();
      },
      resetFloor: () => {
        this.floor?.reset();
      },
      scrollTo: (id) => {
        this.roster?.scrollTo(id);
      },
      refresh: () => {
        this.renderer?.refresh();
      },
      refreshRoster: (options) => {
        this.renderer?.refreshRoster(options);
      },
      arrangeChanged: () => {
        this.renderer?.arrangeChanged();
      },
    });
    return navigationOwner;
  }
  private createHosts() {
    const { options, bootstrap, state, ui, prefs } = this.core;
    const { controls } = this;
    const hostOwner = new Hosts({
      ui,
      state,
      controls,
      enabled: bootstrap.control,
      remembered: prefs.host(),
      remember: (host) => {
        prefs.rememberHost(host);
      },
      render: () => {
        this.renderer?.refresh();
      },
      now: () => options.clock.now(),
    });
    return hostOwner;
  }
  private createFloor(navigationOwner: Navigation<N, R>, stack: PanelStack<N, R>) {
    const { options, state, couriers } = this.core;
    const { view } = this;
    const floorOwner = new Floor({
      state,
      view,
      refresh: () => this.renderer?.refresh(),
      now: () => options.clock.now(),
      frame: () => options.clock.frame(),
      mailFrame: (now) => couriers.frame(now),
      inspected: () => stack.inspectedAgent(),
      repositoryToggle: (repo) => {
        navigationOwner.toggleRepository(repo);
      },
      showZoom: (key) => {
        navigationOwner.showZoom(key);
      },
      overview: () => {
        navigationOwner.overview();
      },
      setPage: (page) => {
        navigationOwner.setPage(page);
      },
    });
    return floorOwner;
  }
  private createDeadline(stack: PanelStack<N, R>) {
    const { options, state } = this.core;
    const deadline = new FreshnessDeadline({
      state,
      scheduler: options.scheduler,
      now: () => options.clock.now(),
      hasMailPanel: () => stack.hasMail(),
      render: () => {
        this.renderer?.refresh();
      },
    });
    return deadline;
  }
  private createRenderer(owners: {
    hosts: Hosts<N, R>;
    floor: Floor;
    ledger: Ledger<N, R>;
    roster: AppRoster<N>;
    deadline: FreshnessDeadline;
    panels: PanelStack<N, R>;
    navigation: Navigation<N, R>;
  }) {
    const { options, bootstrap, state, ui, couriers } = this.core;
    const renderOwner = new AppRenderer({
      ui,
      state,
      view: this.view,
      enabled: bootstrap.control,
      hosts: owners.hosts,
      floor: owners.floor,
      couriers,
      ledger: owners.ledger,
      roster: owners.roster,
      totals: new Totals(ui, state),
      deadline: owners.deadline,
      panels: owners.panels,
      select: (id) => {
        owners.navigation.select(id, { scroll: true });
      },
      now: () => options.clock.now(),
    });
    return renderOwner;
  }
  private createLifecycle(stack: PanelStack<N, R>, renderOwner: AppRenderer<N, R>) {
    const { options, state, couriers, query } = this.core;
    const { view, controls } = this;
    const { auth } = this.core;
    const lifecycle = new AppLifecycle({
      document: options.document,
      state,
      query,
      view,
      panels: stack,
      now: () => options.clock.now(),
      resetCouriers: () => {
        couriers.rebase();
      },
      clearDeadline: () => {
        this.deadline.clear();
      },
      suspendControls: () => {
        controls.suspend();
      },
      resumeAuth: () => {
        auth.resume();
      },
      suspendAuth: () => {
        auth.suspend();
      },
      ingest: (snapshot) => {
        renderOwner.ingest(snapshot);
      },
      render: () => {
        renderOwner.refresh();
      },
    });
    return lifecycle;
  }
  dispose() {
    const { state, options, auth, couriers, theme } = this.core;
    if (state.disposed) return;
    state.disposed = true;
    this.events.dispose();
    options.window.removeEventListener("pagehide", this.pagehide);
    options.window.removeEventListener("pageshow", this.pageshow);
    this.lifecycle.dispose();
    this.overlays?.dispose();
    this.panels?.dispose();
    this.roster?.dispose();
    this.ledger?.dispose();
    this.navigation?.dispose();
    this.hosts?.dispose();
    auth.dispose();
    this.controls.dispose();
    this.renderer?.dispose();
    this.floor?.dispose();
    couriers.dispose();
    theme.dispose();
    state.byId.clear();
    state.latest = null;
    state.rawLatest = null;
    state.scene = null;
  }
}
/* External panes are display identities only. No App, roster, run bus or station save is loaded.
   Mail couriers draw recent llm-bus metadata read by the sidecar; this page never sends, acknowledges or wakes. */
export function mountObserver<N extends AppNode, R extends SpriteResource, B extends R = R>(
  options: MountOptions<N, R, B>,
): ObserverApp {
  return new ObserverMount(options);
}
