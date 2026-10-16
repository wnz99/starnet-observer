import type { PanelStack } from "./panel-stack.js";
import type { SpriteResource } from "../sprites/types.js";
import type { AppControls } from "./controls.js";
import type { AppEvent, AppNode } from "./dom.js";
import type { AppState } from "./state.js";
import { NodeEvents, type AppUi } from "./ui.js";

const PROVIDERS: Readonly<Record<string, string>> = { claude: "Claude", codex: "Codex" };
interface OverlayOptions<N extends AppNode, R extends SpriteResource> {
  ui: AppUi<N, R>;
  state: AppState;
  controls: AppControls<N, R>;
  enabled: boolean;
  panels: Pick<PanelStack<N, R>, "top" | "closeTop">;
  select(id: string): void;
  overview(): void;
  refresh(): void;
}
interface Chooser<N> {
  root: N;
  provider: N;
  describe(): void;
}
export class Overlays<N extends AppNode, R extends SpriteResource> {
  private readonly events: NodeEvents;
  private chooser: Chooser<N> | null = null;
  constructor(private readonly options: OverlayOptions<N, R>) {
    this.events = new NodeEvents(() => !options.state.disposed);
    const { ui } = options;
    this.events.on(ui.get("controls-help"), "click", () => {
      this.setHelp({ open: !this.helpOpen() });
    });
    this.events.on(ui.document, "pointerdown", (event) => {
      this.pointerDown(event);
    });
    this.events.on(ui.document, "keydown", (event) => {
      this.keyDown(event);
    });
  }
  private helpOpen() {
    return !this.options.ui.get("controls-help-popover").hidden;
  }
  /* Station controls help is a disclosure, not a dialog: the trigger names and controls it. Opening a panel closes it,
     so throughout its open state it remains the newest layer and Escape closes it first, returning focus to the trigger. A press
     anywhere outside dismisses it without moving focus. */
  private setHelp({ open, restoreFocus }: { open: boolean; restoreFocus?: boolean }) {
    if (this.helpOpen() === open) return;
    const { ui } = this.options;
    ui.get("controls-help-popover").hidden = !open;
    ui.get("controls-help").setAttribute("aria-expanded", String(open));
    if (!open && restoreFocus) ui.get("controls-help").focus();
  }
  closeHelp() {
    this.setHelp({ open: false });
  }
  private pointerDown(event: AppEvent) {
    const { ui } = this.options;
    if (
      this.helpOpen() &&
      !ui.document.contains(ui.get("controls-help-popover"), event.target) &&
      !ui.document.contains(ui.get("controls-help"), event.target)
    )
      this.closeHelp();
  }
  private keyDown(event: AppEvent) {
    if (event.key !== "Escape") return;
    const { document } = this.options.ui;
    if (this.chooser && document.dialogOpen(this.chooser.root)) {
      event.preventDefault();
      this.closeChooser();
      return;
    }
    // The innermost layer closes first: help, then the top panel only, then the worker focus or platform zoom.
    if (this.helpOpen()) {
      event.preventDefault();
      this.setHelp({ open: false, restoreFocus: true });
      return;
    }
    if (this.options.panels.top()) {
      event.preventDefault();
      this.options.panels.closeTop();
      return;
    }
    if (this.options.state.selected || this.options.state.zoomed) {
      this.options.overview();
      this.options.refresh();
    }
  }
  private closeChooser() {
    const { ui } = this.options;
    if (!this.chooser || !ui.document.dialogOpen(this.chooser.root)) return;
    ui.document.closeDialog(this.chooser.root);
    ui.get("world").focus();
  }
  private existingOverseer() {
    const { state } = this.options;
    const data = state.latest?.data;
    return data?.sessions.find(
      (row) => row.role === "overseer" && row.source === "herdr" && !row.host,
    );
  }
  private confirmChooser(provider: N) {
    const { document } = this.options.ui;
    const chosen = document.value(provider);
    if (!["claude", "codex"].includes(chosen)) return;
    this.closeChooser();
    // A poll may have found the singleton during the time the chooser was open.
    const row = this.existingOverseer();
    if (row) {
      this.options.select(row.id);
      return;
    }
    void this.options.controls.overseer(this.options.ui.get("world"), chosen);
  }
  private makeChooser() {
    const { ui } = this.options;
    const root = ui.text("dialog", "overseer-chooser", "");
    root.id = "overseer-chooser";
    const title = ui.text("h2", "", "Start an overseer");
    title.id = "overseer-chooser-title";
    const label = ui.text("label", "", "Provider");
    label.setAttribute("for", "overseer-provider");
    const provider = ui.text("select", "", "");
    provider.id = "overseer-provider";
    provider.setAttribute("aria-label", "Overseer provider");
    for (const value of ["claude", "codex"]) {
      const option = ui.text("option", "", PROVIDERS[value] ?? "");
      ui.document.setValue(option, value);
      ui.document.attach(provider, option);
    }
    const confirmation = ui.text("p", "", "");
    confirmation.id = "overseer-confirmation";
    const describe = () => {
      confirmation.textContent =
        "Start " +
        String(PROVIDERS[ui.document.value(provider)]) +
        " in a new Herdr workspace with a brief on watching the other agents, unattended? Use ⇱ to attach.";
    };
    this.events.on(provider, "change", describe);
    const actions = this.chooserActions(root, provider);
    ui.document.attach(root, title, label, provider, confirmation, actions);
    root.setAttribute("aria-labelledby", title.id);
    root.setAttribute("aria-describedby", confirmation.id);
    ui.document.attach(ui.document.body, root);
    return { root, provider, describe };
  }
  private chooserActions(root: N, provider: N) {
    const { ui } = this.options;
    const actions = ui.text("div", "overseer-actions", "");
    const start = ui.text("button", "", "Start");
    ui.document.setType(start, "button");
    start.id = "overseer-start";
    const cancel = ui.text("button", "", "Cancel");
    ui.document.setType(cancel, "button");
    cancel.id = "overseer-cancel";
    this.events.on(cancel, "click", () => {
      this.closeChooser();
    });
    this.events.on(root, "cancel", (event) => {
      event.preventDefault();
      this.closeChooser();
    });
    this.events.on(start, "click", () => {
      this.confirmChooser(provider);
    });
    ui.document.attach(actions, start, cancel);
    return actions;
  }
  private openChooser() {
    const { ui } = this.options;
    if (ui.document.disabled(ui.get("world"))) return;
    this.chooser ??= this.makeChooser();
    this.closeHelp();
    ui.document.setValue(this.chooser.provider, "claude");
    this.chooser.describe();
    if (!ui.document.dialogOpen(this.chooser.root))
      ui.document.showDialog(this.chooser.root, { modal: true });
    this.chooser.provider.focus();
  }
  /* Observatory click: select the seated overseer, or (with control on) offer to start one. */
  observatoryClicked() {
    if (this.options.state.disposed) return;
    const row = this.existingOverseer();
    if (row) {
      this.options.select(row.id);
      return;
    }
    if (!this.options.enabled) {
      this.options.controls.error(
        "No overseer. Start the observer with OBSERVER_CONTROL=1 to spawn one from here.",
      );
      return;
    }
    this.openChooser();
  }
  dispose() {
    this.closeHelp();
    this.events.dispose();
    if (this.chooser) {
      const { document } = this.options.ui;
      if (document.dialogOpen(this.chooser.root)) document.closeDialog(this.chooser.root);
      this.chooser.root.remove();
      this.chooser = null;
    }
  }
}
