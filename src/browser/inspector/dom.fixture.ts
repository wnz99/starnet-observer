import type { InspectorDocument, InspectorNode } from "./dom.js";
export const focusCalls: FixtureNode[] = [];
export class FixtureNode implements InspectorNode {
  id = "";
  className = "";
  textContent = "";
  hidden = false;
  readonly dataset: Record<string, string | undefined> = {};
  readonly attributes = new Map<string, string>();
  readonly handlers = new Map<string, () => void>();
  title = "";
  tabIndex = 0;
  scrollTop = 0;
  scrollHeight = 1000;
  clientHeight = 200;
  // Inspector builders assign this optional property through InspectorNode; Fallow 3.27.0 misses it.
  // fallow-ignore-next-line unused-class-member
  type = "";
  disabled = false;
  open = false;
  readonly children: FixtureNode[] = [];
  parent: FixtureNode | null = null;
  constructor(readonly tag: string) {}
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
  addEventListener(name: string, listener: () => void) {
    this.handlers.set(name, listener);
  }
  removeEventListener(name: string, listener: () => void) {
    if (this.handlers.get(name) === listener) this.handlers.delete(name);
  }
  focus() {
    focusCalls.push(this);
  }
  child(index: number): FixtureNode {
    const node = this.children[index];
    if (!node) throw new Error(`Missing fixture child ${String(index)}`);
    return node;
  }
  emit(name: string) {
    const handler = this.handlers.get(name);
    if (!handler) throw new Error(`Missing fixture handler ${name}`);
    handler();
  }
  remove() {
    const siblings = this.parent?.children;
    if (siblings) {
      const index = siblings.indexOf(this);
      if (index >= 0) siblings.splice(index, 1);
    }
    this.parent = null;
  }
  connect(parent: FixtureNode) {
    this.remove();
    this.parent = parent;
  }
  attach(node: FixtureNode, before: FixtureNode | null = null) {
    node.connect(this);
    const index = before ? this.children.indexOf(before) : -1;
    if (index < 0) this.children.push(node);
    else this.children.splice(index, 0, node);
  }
  replace(nodes: readonly FixtureNode[]) {
    for (const child of this.children.slice()) child.remove();
    for (const node of nodes) this.attach(node);
  }
  click() {
    this.handlers.get("click")?.();
  }
}
export const fixtureDocument: InspectorDocument<FixtureNode> = {
  createElement: (tag) => new FixtureNode(tag),
  children: (node) => node.children,
  attach(parent, ...children) {
    for (const node of children) parent.attach(node);
  },
  replaceChildren(parent, ...children) {
    parent.replace(children);
  },
  insertBefore(parent, node, before) {
    parent.attach(node, before);
  },
};
