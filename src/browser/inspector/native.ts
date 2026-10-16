import type { InspectorDocument } from "./dom.js";

export function browserInspectorDocument(document: Document): InspectorDocument<HTMLElement> {
  return {
    createElement: (tag) => document.createElement(tag),
    children: (node) =>
      Array.from(node.children).filter(
        (child): child is HTMLElement => child instanceof HTMLElement,
      ),
    attach(parent, ...children) {
      for (const child of children) parent.appendChild(child);
    },
    replaceChildren(parent, ...children) {
      parent.replaceChildren(...children);
    },
    insertBefore(parent, node, before) {
      parent.insertBefore(node, before);
    },
  };
}
