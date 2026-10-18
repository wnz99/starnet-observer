import { MOBILE } from "../inspector.js";
import type { SpriteResource } from "../sprites/types.js";
import type { createControls } from "./controls.js";
import type { AppNode } from "./dom.js";
import { Ledger } from "./ledger.js";
import type { AppCore } from "./mount-core.js";
import type { MountLinks } from "./mount-view.js";
import type { Navigation } from "./navigation.js";
import { Overlays } from "./overlays.js";
import { PanelAdapter } from "./panel-adapter.js";
import { PanelStack } from "./panel-stack.js";
import { createRoster } from "./roster.js";
import type { AppRoster, RosterPanels } from "./roster-ports.js";
export class StationPanels<N extends AppNode, R extends SpriteResource, B extends R> {
  readonly panels: PanelStack<N, R>;
  readonly overlays: Overlays<N, R>;
  readonly roster: AppRoster<N>;
  readonly ledger: Ledger<N, R>;
  constructor(
    private readonly core: AppCore<N, R, B>,
    private readonly links: MountLinks<N, R>,
    navigation: Navigation<N, R>,
    private readonly controls: ReturnType<typeof createControls<N, R>>,
  ) {
    this.panels = this.createPanels();
    this.overlays = this.createOverlays(navigation, this.panels);
    const access = this.panelAccess(this.panels);
    this.roster = this.createRoster(navigation, access);
    this.ledger = this.createLedger(navigation, access);
  }
  private createPanels() {
    const { options, state, ui, query, harness, descriptions } = this.core;
    const adapter = new PanelAdapter({
      ui,
      state,
      descriptions,
      query,
      fetchJson: (path, init) => harness.api.get(path, init),
      now: () => options.clock.now(),
      close: (entry) => {
        this.links.panels?.close(entry);
      },
      toggle: (target, trigger) => {
        this.links.panels?.togglePanel(target, trigger);
      },
    });
    const stack = new PanelStack({
      ui,
      state,
      narrow: options.window.matchMedia(MOBILE),
      createEntry: (target) => adapter.create(target),
      triggerFor: (target) =>
        target.kind === "agent"
          ? (this.links.roster?.inspectTrigger(target.id) ?? null)
          : (this.links.ledger?.readTrigger(target.id) ?? null),
      closeHelp: () => {
        this.links.overlays?.closeHelp();
      },
      changed: () => {
        this.links.renderer?.refresh();
      },
    });
    return stack;
  }
  private createOverlays(navigationOwner: Navigation<N, R>, stack: PanelStack<N, R>) {
    const { bootstrap, state, ui } = this.core;
    const { controls } = this;
    const overlayOwner = new Overlays({
      ui,
      state,
      controls,
      enabled: bootstrap.control,
      panels: stack,
      select: (id) => {
        navigationOwner.select(id, { scroll: true });
      },
      overview: () => {
        navigationOwner.overview();
      },
      refresh: () => {
        this.links.renderer?.refresh();
      },
    });
    return overlayOwner;
  }
  private panelAccess(stack: PanelStack<N, R>) {
    const { descriptions } = this.core;
    const panelAccess: RosterPanels<N> & { roster(kind: "mail"): void } = {
      agentTarget: descriptions.agentTarget,
      panelFor: (target) => stack.panelFor(target),
      isOpenTarget: (target) => stack.isOpenTarget(target),
      togglePanel: (target, trigger) => {
        stack.togglePanel(target, trigger);
      },
      roster: (kind: "mail") => {
        stack.roster(kind);
      },
    };
    return panelAccess;
  }
  private createRoster(navigationOwner: Navigation<N, R>, panelAccess: RosterPanels<N>) {
    const { options, bootstrap, state, ui, format } = this.core;
    const { controls } = this;
    const rosterOwner = createRoster({
      ui,
      state,
      format,
      controls,
      panels: panelAccess,
      enabled: bootstrap.control,
      select: (id) => {
        navigationOwner.select(id);
      },
      toggleRepository: (repo) => {
        navigationOwner.toggleRepository(repo);
      },
      zoomProject: (key) => {
        navigationOwner.zoomProject(key);
      },
      confirm: (message) => options.window.confirm(message),
    });
    return rosterOwner;
  }
  private createLedger(
    navigationOwner: Navigation<N, R>,
    panelAccess: RosterPanels<N> & { roster(kind: "mail"): void },
  ) {
    const { options, state, ui, mail } = this.core;
    const ledgerOwner = new Ledger({
      ui,
      state,
      text: mail,
      panels: panelAccess,
      now: () => options.clock.now(),
      select: (id, settings) => {
        navigationOwner.select(id, settings);
        this.links.renderer?.refresh();
      },
      render: () => {
        this.links.renderer?.refresh();
      },
    });
    return ledgerOwner;
  }
}
