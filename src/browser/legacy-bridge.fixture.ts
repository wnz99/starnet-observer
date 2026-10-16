import { fixtureRoot } from "./theme/root.fixture.js";
import { FixtureCanvas } from "./sprites/runtime.fixture.js";
import type { DrawLog } from "./sprites/runtime.fixture.js";
export class BrowserNode {
  id = "";
  className = "";
  textContent: string | null = "";
  hidden = false;
  readonly dataset: Record<string, string> = {};
  readonly attributes = new Map<string, string>();
  readonly children: BrowserNode[] = [];
  readonly handlers = new Map<string, () => void>();
  title = "";
  tabIndex = 0;
  scrollTop = 0;
  scrollHeight = 1000;
  clientHeight = 200;
  type = "";
  disabled = false;
  open = false;
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
  removeAttribute(name: string) {
    this.attributes.delete(name);
  }
  addEventListener(name: string, callback: () => void) {
    this.handlers.set(name, callback);
  }
  appendChild(node: BrowserNode) {
    this.children.push(node);
    return node;
  }
  replaceChildren(...nodes: BrowserNode[]) {
    this.children.splice(0, this.children.length, ...nodes);
  }
  insertBefore(node: BrowserNode, before: BrowserNode | null) {
    const at = before ? this.children.indexOf(before) : -1;
    this.children.splice(at < 0 ? this.children.length : at, 0, node);
  }
  remove() {}
  focus() {}
  showModal() {
    this.open = true;
  }
  close() {
    this.open = false;
  }
}
const IMAGE_SIZE = 92;
const TRANSPARENT_ROWS = 20;
export class BrowserImage {
  width = IMAGE_SIZE;
  height = IMAGE_SIZE;
  naturalWidth = IMAGE_SIZE;
  naturalHeight = IMAGE_SIZE;
  decoding = "";
  __id = "img";
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private source = "";
  get src() {
    return this.source;
  }
  set src(value: string) {
    this.source = value;
    this.__id = "img:" + value;
    queueMicrotask(() => this.onload?.());
  }
  decode() {
    return Promise.resolve();
  }
}
export class BrowserFont {
  constructor(
    readonly family: string,
    readonly source: string,
    readonly descriptors: { display: string; weight: string; style: string },
  ) {}
  load() {
    return Promise.resolve(this);
  }
}
export class BrowserDocument {
  private readonly root = fixtureRoot();
  readonly properties = this.root.properties;
  readonly attributes = this.root.attributes;
  readonly region = new BrowserNode();
  readonly image = new BrowserNode();
  readonly mark = new BrowserNode();
  readonly created: BrowserNode[] = [];
  readonly faces: BrowserFont[] = [];
  readonly drawing: DrawLog = [];
  private readonly mounted: (() => void)[] = [];
  readonly readyState = "loading";
  readonly documentElement = this.root.documentElement;
  readonly fonts = {
    add: (face: BrowserFont) => {
      this.faces.push(face);
    },
  };
  constructor() {
    this.image.hidden = true;
    this.region.hidden = true;
  }
  createElement(tag: string) {
    if (tag === "canvas") return new FixtureCanvas("native-canvas", this.drawing, TRANSPARENT_ROWS);
    const node = new BrowserNode();
    this.created.push(node);
    return node;
  }
  getElementById(id: string) {
    return id === "theme-status" ? this.region : id === "brand-logo" ? this.image : null;
  }
  querySelector() {
    return this.mark;
  }
  addEventListener(_name: string, listener: () => void) {
    this.mounted.push(listener);
  }
  mount() {
    for (const listener of this.mounted.splice(0)) listener();
  }
}
