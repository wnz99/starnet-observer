import type { InspectorDocument, InspectorNode } from "./dom.js";
import type { QuerySnapshot, QuerySpec } from "../queryspine/types.js";
export interface HelperDescription {
  readonly id: string;
  readonly identity: string;
  readonly eligible: boolean;
  readonly name: string;
  readonly stale: boolean;
  readonly status: string;
  readonly task?: string;
  readonly lifecycle?: string;
  readonly title?: string;
}
export interface RosterDescription {
  readonly name: string;
  readonly status: string;
  readonly stale: boolean;
  readonly title: string;
  readonly meta: readonly string[];
  readonly identity: string | null;
  readonly inventory: string;
  readonly helpers?: readonly HelperDescription[];
}
export interface ViewOptions<N extends InspectorNode> {
  readonly get: (part: string) => N;
  readonly document: InspectorDocument<N>;
  readonly now?: () => number;
  readonly inspectHelper?: (id: string, identity: string, button: N) => void;
}
export interface InspectorOptions<N extends InspectorNode> extends ViewOptions<N> {
  readonly QuerySpine: {
    define(key: string, spec: QuerySpec): unknown;
    subscribe(key: string, listener: (snapshot: QuerySnapshot) => void): () => void;
  };
  readonly describe: (id: string) => RosterDescription | null;
  readonly onChange?: (id: string | null) => void;
  readonly requestClose?: (() => void) | null;
}
