/* Synthetic classic-controller callers retain their own nodes until Task 7 ports their suites. */
import { canonicalTheme } from "./theme.fixture.js";
import { createModel } from "./model.js";
import { createMail } from "./mail.js";
import { createThemePack } from "./theme.js";
import * as Inspector from "./inspector.js";
import * as MailInspector from "./mail-inspector.js";
import type { InspectorNode, InspectorDocument } from "./inspector/dom.js";
import type { InspectorOptions } from "./inspector/types.js";
interface ClassicNode<N> extends InspectorNode {
  readonly children: readonly N[];
  appendChild(node: N): void;
  replaceChildren(...nodes: N[]): void;
  insertBefore(node: N, before: N | null): void;
}
interface ClassicDocument<N> {
  createElement(tag: string): N;
}
function adaptDocument<N extends ClassicNode<N>>(
  document: ClassicDocument<N>,
): InspectorDocument<N> {
  return {
    createElement: (tag) => document.createElement(tag),
    children: (node) => node.children,
    attach: (parent, ...children) => {
      for (const child of children) parent.appendChild(child);
    },
    replaceChildren: (parent, ...children) => {
      parent.replaceChildren(...children);
    },
    insertBefore: (parent, node, before) => {
      parent.insertBefore(node, before);
    },
  };
}
function createInspector<N extends ClassicNode<N>>(
  options: Omit<InspectorOptions<N>, "document"> & { readonly document: ClassicDocument<N> },
) {
  return Inspector.createInspector({ ...options, document: adaptDocument(options.document) });
}
export function legacyModules() {
  const defaults = canonicalTheme();
  return {
    Model: createModel(defaults),
    Mail: createMail(defaults),
    ThemePack: createThemePack(defaults),
    Inspector: {
      ...Inspector,
      buildPanel: <N extends ClassicNode<N>>(document: ClassicDocument<N>, number: number) =>
        Inspector.buildPanel(adaptDocument(document), number),
      createInspector,
    },
    MailInspector: {
      ...MailInspector,
      buildPanel: <N extends ClassicNode<N>>(document: ClassicDocument<N>, number: number) =>
        MailInspector.buildPanel(adaptDocument(document), number),
    },
  };
}
