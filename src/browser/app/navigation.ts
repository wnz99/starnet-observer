import type { ConfigInput } from "../../shared/observer.js";
import type { SpriteResource } from "../sprites/types.js";
import type { AppView } from "./contracts.js";
import type { AppNode } from "./dom.js";
import type { createPreferences } from "./preferences.js";
import type { AppState } from "./state.js";
import { NodeEvents, setText, type AppUi } from "./ui.js";

const CAMERA_ZOOM = { in: 1.25, out: 0.8 };
interface NavigationOptions<N extends AppNode, R extends SpriteResource> {
  ui: AppUi<N, R>;
  state: AppState;
  view: AppView;
  prefs: ReturnType<typeof createPreferences<R>>;
  theme: NonNullable<ConfigInput["theme"]>;
  hostsPresent(): boolean;
  resetCouriers(): void;
  rebaseCouriers(): void;
  resetFloor(): void;
  scrollTo(id: string): void;
  refresh(): void;
  refreshRoster(options: { canvas: boolean }): void;
  arrangeChanged(): void;
}
export class Navigation<N extends AppNode, R extends SpriteResource> {
  private readonly events: NodeEvents;
  constructor(private readonly options: NavigationOptions<N, R>) {
    this.events = new NodeEvents(() => !options.state.disposed);
    this.restore();
    this.bind();
  }
  private restore() {
    const { ui, state, prefs, theme } = this.options;
    const savedPage = Number(prefs.get("page"));
    state.page = Number.isInteger(savedPage) && savedPage >= 0 && savedPage < 1000 ? savedPage : 0;
    const savedFilter = prefs.get("filter");
    state.filter = ui.document
      .querySelectorAll(ui.get("filters"), "button")
      .some((button) => button.dataset.filter === savedFilter)
      ? (savedFilter ?? "all")
      : "all";
    state.arrangeOn = prefs.flag("arrange", theme.arrange === true);
    ui.document
      .getElementById("arrange-toggle")
      ?.setAttribute("aria-pressed", String(state.arrangeOn));
    if (ui.document.getElementById("fx-toggle") && typeof this.options.view.setFx === "function")
      this.applyFx(prefs.flag("fx", typeof theme.fx === "boolean" ? theme.fx : false));
  }
  private bind() {
    const { ui, view, state, prefs } = this.options;
    const on = (id: string, callback: () => void) => {
      this.events.on(ui.get(id), "click", callback);
    };
    on("overview", () => {
      this.overview();
      this.options.refreshRoster({ canvas: true });
    });
    // A removable chip names the zoomed platform; it and Escape both restore the overview.
    on("zoom-chip", () => {
      this.overview();
      this.options.refreshRoster({ canvas: true });
      ui.get("world").focus();
    });
    this.bindFx();
    on("zoom-in", () => {
      view.zoomBy(CAMERA_ZOOM.in);
    });
    on("zoom-out", () => {
      view.zoomBy(CAMERA_ZOOM.out);
    });
    on("previous-page", () => {
      this.changePage(-1);
    });
    on("next-page", () => {
      this.changePage(1);
    });
    const arrange = ui.document.getElementById("arrange-toggle");
    if (arrange)
      this.events.on(arrange, "click", () => {
        this.applyArrange({ arrangeOn: !state.arrangeOn });
      });
    this.events.on(ui.get("search"), "input", () => {
      this.options.refreshRoster({ canvas: false });
    });
    const filters = ui.document.querySelectorAll(ui.get("filters"), "button");
    for (const button of filters) {
      button.setAttribute("aria-pressed", String(button.dataset.filter === state.filter));
      this.events.on(button, "click", () => {
        state.filter = button.dataset.filter ?? "all";
        prefs.set("filter", state.filter);
        for (const option of filters)
          option.setAttribute("aria-pressed", String(option === button));
        this.options.refreshRoster({ canvas: false });
      });
    }
  }
  private bindFx() {
    const { ui, view, prefs } = this.options;
    const button = ui.document.getElementById("fx-toggle");
    if (!button || typeof view.setFx !== "function") return;
    // Ambient sky effects (Matrix rain, pixies, nebulae): off on startup unless explicitly configured.
    this.events.on(button, "click", () => {
      if (typeof view.fx !== "function") throw new TypeError("View.fx is not a function");
      const enabled = !view.fx();
      this.applyFx(enabled);
      prefs.set("fx", enabled ? 1 : 0);
    });
  }
  private applyFx(value: boolean) {
    this.options.view.setFx?.(value);
    const { document } = this.options.ui;
    document.getElementById("fx-toggle")?.setAttribute("aria-pressed", String(value));
  }
  private applyArrange({ arrangeOn }: { arrangeOn: boolean }) {
    const { state, prefs, ui } = this.options;
    state.arrangeOn = arrangeOn;
    ui.document.getElementById("arrange-toggle")?.setAttribute("aria-pressed", String(arrangeOn));
    prefs.set("arrange", arrangeOn ? 1 : 0);
    state.layout = state.model.createLayout({ projectAccents: state.pack.scene.projectAccents });
    this.options.resetFloor();
    state.selectedRepoId = null;
    this.options.rebaseCouriers();
    this.options.arrangeChanged();
  }
  setPage(next: number) {
    if (next === this.options.state.page) return;
    this.options.state.page = next;
    this.options.resetCouriers();
    this.options.prefs.set("page", next);
  }
  select(id: string, options: { scroll?: boolean } = {}) {
    const { state, view } = this.options;
    if (state.disposed) return;
    const row = state.byId.get(id);
    if (!row) return;
    const page = state.page;
    const host = state.selectedHost;
    state.selected = id;
    this.selectHost(row.host || null);
    const target = state.layout.pageFor(id);
    if ((row.role !== "overseer" || row.host) && Number.isInteger(target)) this.setPage(target); // the local overseer sits on every page
    this.refreshSelection(page, host);
    view.focus(id);
    if (options.scroll) this.options.scrollTo(id);
  }
  private refreshSelection(page: number, host: string | null) {
    const { state } = this.options;
    if (state.page !== page || state.selectedHost !== host) this.options.refresh();
    else this.options.refreshRoster({ canvas: true });
  }
  private selectHost(host: string | null) {
    const { state, prefs } = this.options;
    if (!this.options.hostsPresent() || host === state.selectedHost) return;
    state.selectedHost = host;
    state.mailSelected = null;
    prefs.rememberHost(host);
  }
  overview() {
    this.options.state.selected = null;
    this.options.view.overview();
  }
  showZoom(key: string | null) {
    const { ui, state } = this.options;
    state.zoomed = key;
    const platform = key && state.scene?.platforms.find((value) => value.key === key);
    const chip = ui.get("zoom-chip");
    chip.hidden = !platform;
    if (platform) {
      const name = platform.name || "Unassigned";
      setText(chip, "Zoomed · " + name + " ✕");
      chip.setAttribute("aria-label", "Leave the " + name + " platform zoom");
    }
  }
  // The project heading's zoom button: the keyboard equivalent of double-clicking a platform.
  zoomProject(key: string) {
    const { state, view } = this.options;
    const data = state.latest?.data;
    const root = data?.sessions.find(
      (row) => state.model.projectKey(row) === key && state.layout.seatFor(row.id) !== undefined,
    );
    if (!root) return;
    state.selected = null;
    this.setPage(state.layout.pageFor(root.id));
    this.options.refresh();
    const room = state.layout.onPage(state.page).find((value) => value.projectId === key);
    if (room) view.focusPlatform(room.key);
  }
  private changePage(offset: number) {
    const { state } = this.options;
    const next = Math.max(0, Math.min(state.layout.pages() - 1, state.page + offset));
    if (next === state.page) return;
    this.setPage(next);
    this.overview();
    this.options.refresh();
  }
  /* Repository highlight: one exact repository id, never a label or the parent-folder project. It selects, never
     filters or moves the camera, and does not request anything: the list and the floor just repaint. */
  toggleRepository(repoId: string) {
    const { state } = this.options;
    const data = state.latest?.data;
    if (!data?.sessions.some((row) => row.repoId === repoId)) return;
    state.selectedRepoId = state.selectedRepoId === repoId ? null : repoId;
    this.options.refreshRoster({ canvas: true });
  }
  dispose() {
    this.events.dispose();
  }
}
