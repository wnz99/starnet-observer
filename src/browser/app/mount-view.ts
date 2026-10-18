import type { SpriteResource } from "../sprites/types.js";
import { createViewFactory } from "../view/index.js";
import type { ViewOptions } from "../view/types.js";
import type { AppNode } from "./dom.js";
import type { AppCore } from "./mount-core.js";
import type { Navigation } from "./navigation.js";
import type { Hosts } from "./hosts.js";
import type { PanelStack } from "./panel-stack.js";
import type { Overlays } from "./overlays.js";
import type { AppRenderer } from "./render.js";
import type { AppRoster } from "./roster-ports.js";
import type { Floor } from "./floor.js";
import type { Ledger } from "./ledger.js";

const PROVIDERS: Readonly<Record<string, string>> = {
  codex: "Codex",
  claude: "Claude",
  chatgpt: "ChatGPT",
};
const RELAY_LABEL = { active: " · active " };
export interface MountLinks<N extends AppNode, R extends SpriteResource> {
  navigation?: Navigation<N, R>;
  hosts?: Hosts<N, R>;
  panels?: PanelStack<N, R>;
  overlays?: Overlays<N, R>;
  renderer?: AppRenderer<N, R>;
  roster?: AppRoster<N>;
  floor?: Floor;
  ledger?: Ledger<N, R>;
}
function viewActions<N extends AppNode, R extends SpriteResource, B extends R>(
  core: AppCore<N, R, B>,
  links: MountLinks<N, R>,
): Pick<
  ViewOptions<R, B>,
  | "onSelect"
  | "onObservatory"
  | "onShip"
  | "hostSelection"
  | "onTitleToggle"
  | "onPlatform"
  | "onMode"
> {
  const { state, descriptions, ui } = core;
  return {
    onSelect: (id) => {
      if (!state.disposed) links.navigation?.select(id, { scroll: true });
    },
    onObservatory: () => {
      links.overlays?.observatoryClicked();
    },
    onShip: (host) => {
      links.hosts?.clicked(host);
    },
    hostSelection: () => (links.hosts?.list().length ? state.selectedHost : undefined),
    // A worker's canvas title toggles the same exact panel as its list title and magnifier; focus returns to the station.
    onTitleToggle: (id) => {
      const row = state.byId.get(id);
      if (row) links.panels?.togglePanel(descriptions.agentTarget(row), ui.get("world"));
    },
    // Platform zoom never selects a worker; it only clears a previous worker selection.
    onPlatform: () => {
      if (!state.disposed) {
        state.selected = null;
        links.renderer?.refreshRoster({ canvas: true });
      }
    },
    onMode: ({ mode, platform }) => {
      if (!state.disposed) links.navigation?.showZoom(mode === "platform" ? platform : null);
    },
  };
}
function viewLabels<N extends AppNode, R extends SpriteResource, B extends R>(
  core: AppCore<N, R, B>,
  links: MountLinks<N, R>,
): Pick<ViewOptions<R, B>, "hoverLabel" | "idleLevel" | "idleVigour" | "nameFor"> {
  const { state, options, format } = core;
  return {
    // Read every frame, so a title Herdr publishes later replaces the fallback throughout the hover.
    hoverLabel: (id) => {
      const row = state.byId.get(id);
      const carried = links.floor?.relayMembers.get(id);
      if (row)
        return (
          state.model.hoverLabel(row, state.rowStale(row), options.clock.now()) +
          (carried ? " · on relay (" + carried.repo + ")" : "")
        );
      const ghost = links.floor?.shadows.get(id); // a relay roster entry: what llm-bus lists, nothing observed
      return ghost
        ? (PROVIDERS[ghost.provider ?? ""] || "Agent") +
            " on " +
            ghost.machine +
            " · " +
            String(ghost.repo) +
            (ghost.lastActivityAt
              ? RELAY_LABEL.active + state.model.age(ghost.lastActivityAt, options.clock.now())
              : "") +
            " · via relay, not observed"
        : null;
    },
    idleLevel: (id) => {
      const row = state.byId.get(id);
      return row ? state.model.idleAge(row, options.clock.now()).level : 0;
    },
    idleVigour: (id) => {
      const row = state.byId.get(id);
      return row ? state.model.idleAge(row, options.clock.now()).vigour : 1;
    },
    nameFor: (id) => {
      const row = state.byId.get(id);
      if (row) return format.workerName(row);
      const ghost = links.floor?.shadows.get(id);
      return ghost ? (PROVIDERS[ghost.provider ?? ""] || "Agent") + " · " + ghost.machine : "";
    },
  };
}
export function createStationView<N extends AppNode, R extends SpriteResource, B extends R>(
  core: AppCore<N, R, B>,
  links: MountLinks<N, R>,
) {
  const { options, bootstrap, theme, pack, reducedMotion, state, ui } = core;
  const create =
    options.collaborators?.createView ??
    ((settings: ViewOptions<R, B>) =>
      createViewFactory(bootstrap.defaultTheme, theme).create<R, B>(settings));
  const document = options.document;
  return create({
    theme: pack,
    canvas: document.canvas,
    reducedMotion,
    env: {
      ...options.window.viewEnvironment,
      sprites: options.sprites,
      now: () => options.clock.frame(),
    },
    ...viewActions(core, links),
    ...viewLabels(core, links),
    onCamera: ({ canZoomIn, canZoomOut }) => {
      if (state.disposed) return;
      document.setDisabled(ui.get("zoom-in"), { disabled: !canZoomIn });
      document.setDisabled(ui.get("zoom-out"), { disabled: !canZoomOut });
    },
  });
}
