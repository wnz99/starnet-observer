import type { SpriteResource } from "../sprites/types.js";
import type { AppDocument, AppEvent, AppNode } from "./dom.js";

export function createUi<N extends AppNode, R extends SpriteResource>(document: AppDocument<N, R>) {
  function get(id: string) {
    const node = document.getElementById(id);
    if (!node) throw new Error(`Observer element is unavailable: ${id}`);
    return node;
  }
  function text(tag: string, className: string, value: string) {
    const element = document.createElement(tag);
    element.className = className;
    element.textContent = value;
    return element;
  }
  // Children in this exact order; existing nodes are moved, never rebuilt. Returns whether anything moved.
  function arrange(parent: N, nodes: readonly N[]) {
    const children = document.children(parent);
    if (children.length === nodes.length && nodes.every((node, index) => children[index] === node))
      return false;
    document.replaceChildren(parent, ...nodes);
    return true;
  }
  return { get, text, arrange, document };
}
export function setText(node: AppNode, value: string) {
  if (node.textContent === value) return;
  if (value.length === 0) node.replaceChildren();
  else node.replaceChildren(value);
}
export type AppUi<N extends AppNode, R extends SpriteResource> = ReturnType<typeof createUi<N, R>>;

/* Each keyed row releases its listeners when evicted. The mount separately owns persistent controls. */
export class NodeEvents {
  private readonly releases: (() => void)[] = [];
  constructor(private readonly live: () => boolean) {}
  on(
    node: Pick<AppNode, "addEventListener" | "removeEventListener">,
    name: string,
    callback: (event: AppEvent) => void,
  ) {
    const listener = (event: AppEvent) => {
      if (this.live()) callback(event);
    };
    node.addEventListener(name, listener);
    this.releases.push(() => {
      node.removeEventListener(name, listener);
    });
  }
  dispose() {
    for (const release of this.releases.splice(0)) release();
  }
}
