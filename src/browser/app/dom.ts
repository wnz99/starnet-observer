import type { InspectorDocument, InspectorNode } from "../inspector/dom.js";
import type { SpriteResource } from "../sprites/types.js";
import type { ViewCanvas, ViewEnvironment } from "../view/types.js";
import type { ObserverBootstrap } from "../../shared/bootstrap.js";
import type { ThemeDocument, ThemeFont } from "../theme/dom.js";

export interface AppEvent {
  readonly target?: unknown;
  readonly key?: string;
  preventDefault(): void;
}
export interface AppNode extends InspectorNode {
  inert: boolean;
  readonly isConnected?: boolean;
  readonly style: { setProperty(name: string, value: string): void };
  readonly classList: {
    add(name: string): void;
    toggle(name: string, force?: boolean): boolean;
  };
  removeAttribute(name: string): void;
  replaceChildren(...text: string[]): void;
  addEventListener(name: string, listener: (event: AppEvent) => void): void;
  removeEventListener(name: string, listener: (event: AppEvent) => void): void;
  focus(options?: { preventScroll?: boolean }): void;
  scrollIntoView(options: { block: "nearest" }): void;
}
export interface AppDocument<
  N extends AppNode,
  R extends SpriteResource,
> extends InspectorDocument<N> {
  readonly body: N;
  readonly hidden: boolean;
  readonly activeElement: N | null;
  readonly canvas: ViewCanvas<R>;
  readonly themeDocument: ThemeDocument;
  getElementById(id: string): N | null;
  querySelector(selector: string): N | null;
  querySelectorAll(node: N, selector: string): readonly N[];
  contains(node: N, target: unknown): boolean;
  value(node: N): string;
  setValue(node: N, value: string): void;
  setType(node: N, type: "button"): void;
  disabled(node: N): boolean;
  setDisabled(node: N, options: { disabled: boolean }): void;
  dialogOpen(node: N): boolean;
  showDialog(node: N, options: { modal: boolean }): void;
  closeDialog(node: N): void;
  addEventListener(name: string, listener: (event: AppEvent) => void): void;
  removeEventListener(name: string, listener: (event: AppEvent) => void): void;
}
export interface AppMedia {
  readonly matches: boolean;
  addEventListener(name: "change", listener: () => void): void;
  removeEventListener(name: "change", listener: () => void): void;
}
export interface AppWindow<R extends SpriteResource, B extends R = R> {
  readonly bootstrap: ObserverBootstrap;
  readonly themeFont?: ThemeFont;
  readonly viewEnvironment: ViewEnvironment<R, B>;
  readonly localStorage?: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  matchMedia(query: string): AppMedia;
  confirm(message: string): boolean;
  reload(): void;
  addEventListener(name: string, listener: () => void): void;
  removeEventListener(name: string, listener: () => void): void;
}
export interface AppClock {
  now(): number;
  frame(): number;
}
export interface AppScheduler {
  timeout(callback: () => void, milliseconds: number): () => void;
  interval(callback: () => void, milliseconds: number): () => void;
}
