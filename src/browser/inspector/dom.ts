/* DOM ports retain native nodes and model only the operations used by panels. */
export interface InspectorNode {
  id: string;
  className: string;
  textContent: string | null;
  hidden: boolean | string;
  readonly dataset: Record<string, string | undefined>;
  title: string;
  tabIndex: number;
  scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
  type?: string;
  disabled?: boolean;
  open?: boolean;
  setAttribute(name: string, value: string): void;
  addEventListener(name: string, listener: () => void): void;
  removeEventListener(name: string, listener: () => void): void;
  remove(): void;
  focus(): void;
}
export interface InspectorDocument<N extends InspectorNode> {
  createElement(tag: string): N;
  children(node: N): readonly N[];
  attach(parent: N, ...children: N[]): void;
  replaceChildren(parent: N, ...children: N[]): void;
  insertBefore(parent: N, node: N, before: N | null): void;
}
export function panelMaker<N extends InspectorNode>(
  document: InspectorDocument<N>,
  number: number,
) {
  const parts = new Map<string, N>();
  function make(tag: string, part?: string | null, className?: string, text?: string | null) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    if (part) {
      parts.set(part, node);
      node.id = `${part}-${String(number)}`;
    }
    return node;
  }
  function get(part: string) {
    const node = parts.get(part);
    if (!node) throw new Error(`Unknown inspector part: ${part}`);
    return node;
  }
  return { make, get };
}
