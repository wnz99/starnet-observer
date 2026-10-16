import type { SpriteResource } from "../sprites/types.js";
import type { AppMedia, AppNode } from "./dom.js";
import type { PanelTarget } from "./roster-ports.js";
import type { AppState } from "./state.js";
import type { NodeEvents } from "./ui.js";
import { type AppUi } from "./ui.js";

const PANEL_CAP = 8;
export const panelKey = (target: PanelTarget) =>
  target.kind + "\u0000" + String(target.id) + "\u0000" + String(target.identity);
export interface AppPanelView<N extends AppNode> {
  close(): void;
  cover(): void;
  reveal(): void;
  suspend(): void;
  resume(): void;
  roster(): void;
  focusTarget(): N;
}
export interface PanelEntry<N extends AppNode> {
  key: string;
  target: PanelTarget;
  trigger: N | null;
  root: N;
  stack: N;
  get(part: string): N;
  view: AppPanelView<N>;
  open(): void;
  dispose(): void;
  events: NodeEvents;
}
interface StackOptions<N extends AppNode, R extends SpriteResource> {
  ui: AppUi<N, R>;
  state: AppState;
  narrow: AppMedia;
  createEntry(target: PanelTarget): PanelEntry<N>;
  triggerFor(target: PanelTarget): N | null;
  closeHelp(): void;
  changed(): void;
}
/* Detail panels form one stack, keyed by exact target: an agent row id plus the identity associated with its original opening, or a
   mail message id plus its body-free identity. Each entry owns its own inspector instance and DOM. Only the top entry
   is shown and polls; covered entries are hidden and inert. This controller alone owns showing, modality, Escape
   and focus. A row click keeps meaning "focus this worker on the floor". */
export class PanelStack<N extends AppNode, R extends SpriteResource> {
  private entries: PanelEntry<N>[] = [];
  private readonly breakpointChanged = () => {
    this.resize();
  };
  constructor(private readonly options: StackOptions<N, R>) {
    options.narrow.addEventListener("change", this.breakpointChanged);
  }
  top() {
    return this.entries.at(-1) ?? null;
  }
  panelFor(target: PanelTarget | null) {
    return target ? (this.entries.find((entry) => entry.key === panelKey(target)) ?? null) : null;
  }
  isOpenTarget(target: PanelTarget | null) {
    return this.panelFor(target) !== null;
  }
  hasMail() {
    return this.entries.some((entry) => entry.target.kind === "mail");
  }
  hasAgents() {
    return this.entries.some((entry) => entry.target.kind === "agent");
  }
  inspectedAgent() {
    const top = this.top();
    return top?.target.kind === "agent" ? top.target.id : null;
  }
  // Only the top entry is shown: modal on narrow screens, a non-modal drawer otherwise. Covered entries are inert.
  private layout() {
    const top = this.top();
    const { document } = this.options.ui;
    for (const entry of this.entries)
      if (entry !== top) {
        if (document.dialogOpen(entry.root)) document.closeDialog(entry.root);
        entry.root.inert = true;
        entry.root.setAttribute("aria-hidden", "true");
      }
    if (!top) return;
    top.root.inert = false;
    top.root.removeAttribute("aria-hidden");
    const mode = this.options.narrow.matches ? "modal" : "drawer";
    if (document.dialogOpen(top.root) && top.root.dataset.mode !== mode)
      document.closeDialog(top.root);
    top.root.dataset.mode = mode;
    if (!document.dialogOpen(top.root))
      document.showDialog(top.root, { modal: this.options.narrow.matches });
    top.stack.textContent =
      this.entries.length > 1
        ? "Stack " + String(this.entries.length) + " · closing shows the previous panel"
        : "";
  }
  // The control that opened the panel when it is still on the page, otherwise that target's live magnifier, else the station.
  private focusBack(entry: PanelEntry<N>) {
    const { ui } = this.options;
    const back =
      [entry.trigger, this.options.triggerFor(entry.target)].find(
        (node) => node && node.isConnected !== false && !ui.document.disabled(node),
      ) || ui.get("world");
    back.focus();
  }
  // Closes this exact entry wherever it sits. Closing the top reveals the entry below with its own state; closing a
  // lower entry leaves the top and its focus alone.
  close(entry: PanelEntry<N>, options: { restoreFocus?: boolean } = {}) {
    if (!this.entries.includes(entry)) return;
    const wasTop = entry === this.top();
    this.entries = this.entries.filter((value) => value !== entry);
    this.remove(entry);
    const next = this.top();
    if (wasTop && next) next.view.reveal();
    this.layout();
    if (wasTop && options.restoreFocus !== false) {
      if (next) next.view.focusTarget().focus();
      else this.focusBack(entry);
    }
    this.options.changed();
  }
  private remove(entry: PanelEntry<N>) {
    entry.events.dispose();
    entry.view.close();
    entry.dispose();
    const { document } = this.options.ui;
    if (document.dialogOpen(entry.root)) document.closeDialog(entry.root);
    entry.root.remove();
  }
  closeTop() {
    const top = this.top();
    if (top) this.close(top);
  }
  private listen(entry: PanelEntry<N>) {
    const { document } = this.options.ui;
    // A native modal Escape or an outside close of the shown panel goes through the stack, never around it.
    entry.events.on(entry.root, "cancel", (event) => {
      event.preventDefault();
      if (entry === this.top()) this.close(entry);
    });
    entry.events.on(entry.root, "close", () => {
      if (entry === this.top() && !document.dialogOpen(entry.root)) this.close(entry);
    });
  }
  // The same title or magnifier toggles its exact panel: an open one closes wherever it is, a closed one opens on top.
  togglePanel(target: PanelTarget | null, trigger: N) {
    if (!target || this.options.state.disposed || !this.options.state.active) return;
    const existing = this.panelFor(target);
    if (existing) {
      this.close(existing);
      return;
    }
    this.options.closeHelp(); // a new panel is the newest layer; open help never sits above it
    // An older panel associated with the same row belongs to a session that row no longer shows; it is discarded quietly.
    for (const stale of this.entries.filter(
      (entry) => entry.target.kind === target.kind && entry.target.id === target.id,
    ))
      this.close(stale, { restoreFocus: false });
    // The ninth open disposes the oldest entry; focus moves only to the new top.
    while (this.entries.length >= PANEL_CAP) {
      const oldest = this.entries[0];
      if (oldest) this.close(oldest, { restoreFocus: false });
    }
    const covered = this.top();
    const entry = this.options.createEntry(target);
    entry.trigger = trigger;
    if (covered) covered.view.cover();
    const { ui } = this.options;
    ui.document.attach(ui.get("panels"), entry.root);
    this.entries.push(entry);
    this.listen(entry);
    entry.open();
    this.layout();
    entry.view.focusTarget().focus();
    this.options.changed();
  }
  // A viewport crossing the breakpoint swaps drawer and modal modes on the top entry without losing its scroll or focus.
  private resize() {
    if (this.options.state.disposed) return;
    const top = this.top();
    if (!top) return;
    this.options.closeHelp(); // the top panel may turn modal: help behind it could never take its Escape
    const { ui } = this.options;
    const active = ui.document.activeElement;
    const inside = active && ui.document.contains(top.root, active);
    const scroller = top.get(top.target.kind === "agent" ? "inspector-log" : "mail-inspector-body");
    const scroll = scroller.scrollTop;
    this.layout();
    scroller.scrollTop = scroll;
    (inside ? active : top.view.focusTarget()).focus();
  }
  roster(kind: "agent" | "mail") {
    for (const entry of this.entries) if (entry.target.kind === kind) entry.view.roster();
  }
  suspend() {
    for (const entry of this.entries) entry.view.suspend();
  }
  resume() {
    for (const entry of this.entries) entry.view.resume();
  }
  pagehide() {
    for (const entry of this.entries.slice().reverse()) this.close(entry, { restoreFocus: false });
  }
  dispose() {
    this.options.narrow.removeEventListener("change", this.breakpointChanged);
    const entries = this.entries;
    this.entries = [];
    for (const entry of entries.reverse()) this.remove(entry);
  }
}
