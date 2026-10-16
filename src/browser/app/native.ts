import { browserInspectorDocument } from "../inspector/native.js";
import { readBootstrap } from "../bootstrap.js";
import type { ObserverBootstrap } from "../../shared/bootstrap.js";
import { browserThemeDocument, browserThemeFont } from "../theme/native.js";
import type { ViewSprites } from "../view/types.js";
import { browserViewEnvironment, type BrowserResource } from "../view/native.js";
import type { AppDocument, AppWindow } from "./dom.js";

function input(node: HTMLElement) {
  return node instanceof HTMLButtonElement ||
    node instanceof HTMLInputElement ||
    node instanceof HTMLSelectElement ||
    node instanceof HTMLTextAreaElement ||
    node instanceof HTMLOptionElement
    ? node
    : null;
}
function dialog(node: HTMLElement) {
  if (!(node instanceof HTMLDialogElement)) throw new Error("Observer dialog is unavailable");
  return node;
}
export function browserAppDocument(
  document: Document,
): AppDocument<HTMLElement, BrowserResource> & { canvas: HTMLCanvasElement } {
  const canvas = document.getElementById("world");
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error("Observer canvas is unavailable");
  return {
    ...browserInspectorDocument(document),
    body: document.body,
    canvas,
    themeDocument: browserThemeDocument(document),
    get hidden() {
      return document.hidden;
    },
    get activeElement() {
      return document.activeElement instanceof HTMLElement ? document.activeElement : null;
    },
    getElementById: (id) => document.getElementById(id),
    querySelector: (selector) => document.querySelector<HTMLElement>(selector),
    querySelectorAll: (node, selector) => [...node.querySelectorAll<HTMLElement>(selector)],
    contains: (node, target) => target instanceof Node && node.contains(target),
    value: (node) => input(node)?.value ?? "",
    setValue(node, value) {
      const field = input(node);
      if (field) field.value = value;
    },
    setType(node) {
      if (node instanceof HTMLButtonElement) node.setAttribute("type", "button");
    },
    disabled: (node) => Boolean(Reflect.get(node, "disabled")),
    setDisabled(node, options) {
      Object.assign(node, { disabled: options.disabled });
    },
    dialogOpen: (node) => dialog(node).open,
    showDialog(node, options) {
      if (options.modal) dialog(node).showModal();
      else dialog(node).show();
    },
    closeDialog(node) {
      dialog(node).close();
    },
    addEventListener: (name, listener) => {
      document.addEventListener(name, listener);
    },
    removeEventListener: (name, listener) => {
      document.removeEventListener(name, listener);
    },
  };
}
export function browserAppWindow<B extends BrowserResource>(
  browser: Window & Pick<typeof globalThis, "Image" | "ResizeObserver" | "FontFace">,
  canvas: HTMLCanvasElement,
  sprites: ViewSprites<BrowserResource, B>,
  bootstrap: ObserverBootstrap = readBootstrap(browser),
): AppWindow<BrowserResource, B> {
  const themeFont = browserThemeFont(browser, browser.document);
  return {
    bootstrap,
    ...(themeFont ? { themeFont } : {}),
    viewEnvironment: browserViewEnvironment(canvas, sprites, browser),
    get localStorage() {
      return browser.localStorage;
    },
    matchMedia: (query) => browser.matchMedia(query),
    confirm: (message) => browser.confirm(message),
    reload() {
      browser.location.reload();
    },
    addEventListener: (name, listener) => {
      browser.addEventListener(name, listener);
    },
    removeEventListener: (name, listener) => {
      browser.removeEventListener(name, listener);
    },
  };
}
