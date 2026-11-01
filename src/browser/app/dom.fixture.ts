import { ThemeFixtureDocument } from "../theme/dom.fixture.js";
import { DrawingContext } from "../view/drawing.fixture.js";
import type { Resource } from "../view/drawing.fixture.js";
import type { InputName, ViewCanvas, ViewEvent } from "../view/types.js";
import type { AppDocument, AppNode } from "./dom.js";
import {
  AppFixtureEvents,
  AppFixtureWindow,
  AppFixtureScheduler,
  fixtureEvent,
} from "./environment.fixture.js";
export { AppFixtureWindow, AppFixtureScheduler, AppFixtureMedia } from "./environment.fixture.js";

export class AppFixtureNode extends AppFixtureEvents implements AppNode {
  id = "";
  className = "";
  textContent = "";
  hidden: boolean | string = false;
  title = "";
  tabIndex = 0;
  scrollTop = 0;
  scrollHeight = 1000;
  clientHeight = 200;
  // InspectorNode consumers assign this optional property; Fallow 3.27.0 misses the protocol use.
  // fallow-ignore-next-line unused-class-member
  type = "";
  value = "";
  disabled = false;
  open = false;
  inert = false;
  mode: "show" | "modal" | null = null;
  readonly dataset: Record<string, string | undefined> = {};
  readonly attributes = new Map<string, string>();
  readonly properties = new Map<string, string>();
  readonly style = {
    setProperty: (name: string, value: string) => {
      this.properties.set(name, value);
    },
  };
  readonly classList: AppNode["classList"] = {
    add: (name: string) => {
      const classes = new Set(this.className.split(/\s+/).filter(Boolean));
      classes.add(name);
      this.className = [...classes].join(" ");
    },
    toggle: (name, force) => {
      const classes = new Set(this.className.split(/\s+/).filter(Boolean));
      const enabled = force ?? !classes.has(name);
      if (enabled) classes.add(name);
      else classes.delete(name);
      this.className = [...classes].join(" ");
      return enabled;
    },
  };
  readonly children: AppFixtureNode[] = [];
  parent: AppFixtureNode | null = null;
  readonly scrollCalls: { block: "nearest" }[] = [];
  readonly focusCalls: ({ preventScroll?: boolean } | undefined)[] = [];
  constructor(
    readonly document: AppFixtureDocument,
    readonly tag: string,
  ) {
    super();
  }
  get events() {
    return this;
  }
  get isConnected(): boolean {
    return this === this.document.body || (this.parent?.isConnected ?? false);
  }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
  removeAttribute(name: string) {
    this.attributes.delete(name);
  }
  replaceChildren(...text: string[]) {
    for (const child of [...this.children]) child.remove();
    this.textContent = text.join("");
  }
  focus(options?: { preventScroll?: boolean }) {
    if (!this.isConnected) return;
    this.focusCalls.push(options);
    this.document.activeElement = this;
  }
  scrollIntoView(options: { block: "nearest" }) {
    this.scrollCalls.push(options);
  }
  click() {
    if (!this.disabled) this.emit("click", { ...fixtureEvent(), target: this });
  }
  remove() {
    if (this.isConnected && this.document.contains(this, this.document.activeElement))
      this.document.activeElement = this.document.body;
    if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1);
    this.parent = null;
  }
  connect(parent: AppFixtureNode) {
    this.remove();
    this.parent = parent;
  }
  update(values: Partial<Pick<AppFixtureNode, "value" | "type" | "disabled">>) {
    Object.assign(this, values);
  }
  show(mode: "show" | "modal") {
    this.open = true;
    this.mode = mode;
  }
  close() {
    this.open = false;
  }
  attach(node: AppFixtureNode, before: AppFixtureNode | null = null) {
    if (node === before) return;
    node.connect(this);
    const index = before ? this.children.indexOf(before) : -1;
    if (index < 0) this.children.push(node);
    else this.children.splice(index, 0, node);
  }
}
function descendants(node: AppFixtureNode): AppFixtureNode[] {
  return node.children.flatMap((child) => [child, ...descendants(child)]);
}
function matches(node: AppFixtureNode, selector: string) {
  if (selector.startsWith(".")) return node.className.split(/\s+/).includes(selector.slice(1));
  if (selector.startsWith("[data-") && selector.endsWith("]")) {
    const name = selector
      .slice("[data-".length, -1)
      .replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
    return node.dataset[name] !== undefined;
  }
  return node.tag === selector;
}
const CANVAS_WIDTH = 800,
  CANVAS_HEIGHT = 600;
export class AppFixtureCanvas implements ViewCanvas<Resource> {
  width = CANVAS_WIDTH;
  height = CANVAS_HEIGHT;
  clientWidth = CANVAS_WIDTH;
  clientHeight = CANVAS_HEIGHT;
  readonly style: { cursor?: string } = {};
  readonly context = new DrawingContext();
  readonly added: { name: InputName; listener: (event: ViewEvent) => void; capture: boolean }[] =
    [];
  readonly removed: typeof this.added = [];
  readonly listeners: typeof this.added = [];
  getContext() {
    return this.context;
  }
  getBoundingClientRect() {
    return { left: 0, top: 0 };
  }
  addEventListener: ViewCanvas<Resource>["addEventListener"] = (name, listener, options) => {
    const capture = options?.capture ?? false;
    const entry = { name, listener, capture };
    this.added.push(entry);
    if (
      !this.listeners.some(
        (item) => item.name === name && item.listener === listener && item.capture === capture,
      )
    )
      this.listeners.push(entry);
  };
  removeEventListener: ViewCanvas<Resource>["removeEventListener"] = (name, listener, options) => {
    const index = this.listeners.findIndex(
      (item) =>
        item.name === name &&
        item.listener === listener &&
        item.capture === (options?.capture ?? false),
    );
    const entry = this.listeners[index];
    if (entry) {
      this.listeners.splice(index, 1);
      this.removed.push(entry);
    }
  };
}
export class AppFixtureDocument
  extends AppFixtureEvents
  implements AppDocument<AppFixtureNode, Resource>
{
  readonly body = new AppFixtureNode(this, "body");
  readonly themeDocument = new ThemeFixtureDocument();
  readonly canvas = new AppFixtureCanvas();
  hidden = false;
  activeElement: AppFixtureNode | null = null;
  private readonly closeEvents: (() => void)[] = [];
  createElement(tag: string) {
    return new AppFixtureNode(this, tag);
  }
  children(node: AppFixtureNode) {
    return node.children;
  }
  attach(parent: AppFixtureNode, ...nodes: AppFixtureNode[]) {
    for (const node of nodes) parent.attach(node);
  }
  replaceChildren(parent: AppFixtureNode, ...nodes: AppFixtureNode[]) {
    for (const child of [...parent.children]) child.remove();
    this.attach(parent, ...nodes);
  }
  insertBefore(parent: AppFixtureNode, node: AppFixtureNode, before: AppFixtureNode | null) {
    parent.attach(node, before);
  }
  register(id: string, tag = "div") {
    const node = this.createElement(tag);
    node.id = id;
    this.attach(this.body, node);
    return node;
  }
  getElementById(id: string) {
    return descendants(this.body).find((node) => node.id === id) ?? null;
  }
  node(id: string) {
    const node = this.getElementById(id);
    if (!node) throw new Error(`Missing app fixture node: ${id}`);
    return node;
  }
  querySelector(selector: string) {
    return this.querySelectorAll(this.body, selector)[0] ?? null;
  }
  querySelectorAll(node: AppFixtureNode, selector: string) {
    return descendants(node).filter((child) => matches(child, selector));
  }
  contains(node: AppFixtureNode, target: unknown) {
    return (
      target instanceof AppFixtureNode && (node === target || descendants(node).includes(target))
    );
  }
  value(node: AppFixtureNode) {
    return node.value;
  }
  setValue(node: AppFixtureNode, value: string) {
    node.update({ value });
  }
  setType(node: AppFixtureNode, type: "button") {
    node.update({ type });
  }
  disabled(node: AppFixtureNode) {
    return node.disabled;
  }
  setDisabled: AppDocument<AppFixtureNode, Resource>["setDisabled"] = (node, options) => {
    node.update({ disabled: options.disabled });
  };
  dialogOpen(node: AppFixtureNode) {
    return node.open;
  }
  showDialog(node: AppFixtureNode, options: { modal: boolean }) {
    node.show(options.modal ? "modal" : "show");
  }
  closeDialog(node: AppFixtureNode) {
    if (!node.open) return;
    node.close();
    // Dialog doubles queue their native close event, as browsers do.
    this.closeEvents.push(() => {
      node.emit("close");
    });
  }
  flushCloseEvents() {
    for (const close of this.closeEvents.splice(0)) close();
  }
}
const HTML_IDS =
  "brand-logo health observed theme-status room-count station-stats station-stats-summary station-totals zoom-chip overview zoom-out zoom-in previous-page page-label next-page arrange-toggle fx-toggle controls-help controls-help-popover controls-help-title stage world console host-tabs crew-title host-health counts source-health search filters mail mail-title mail-health mail-counts mail-ledger mail-empty mail-detail host-spawn sessions empty panels";
export function createAppFixture() {
  const document = new AppFixtureDocument();
  for (const id of HTML_IDS.split(" ")) document.register(id);
  for (const id of [
    "visual-settings",
    "visual-settings-popover",
    "visual-settings-title",
    "startup-animation-toggle",
  ])
    document.register(id);
  document.node("visual-settings-popover").hidden = true;
  document.attach(
    document.node("visual-settings-popover"),
    document.node("startup-animation-toggle"),
    document.node("fx-toggle"),
  );
  for (const filter of ["all", "working", "blocked"]) {
    const button = document.createElement("button");
    button.dataset.filter = filter;
    document.attach(document.node("filters"), button);
  }
  return { document, window: new AppFixtureWindow(), scheduler: new AppFixtureScheduler() };
}
