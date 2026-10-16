import type { ViewEnvironment, ViewSprites } from "./types.js";
export type BrowserResource = HTMLCanvasElement | HTMLImageElement;
// Native resources remain native; only the observer callback is narrowed to this view's actual canvas.
export function browserViewEnvironment<B extends BrowserResource = BrowserResource>(
  canvas: HTMLCanvasElement,
  sprites: ViewSprites<BrowserResource, B> | null,
  browser: Window & Pick<typeof globalThis, "Image" | "ResizeObserver"> = window,
): ViewEnvironment<BrowserResource, B> {
  return {
    raf: (callback) => browser.requestAnimationFrame(callback),
    caf: (frame) => {
      browser.cancelAnimationFrame(frame);
    },
    dpr: () => browser.devicePixelRatio || 1,
    now: () => browser.performance.now(),
    createCanvas: (width, height) => {
      const layer = browser.document.createElement("canvas");
      layer.width = width;
      layer.height = height;
      return layer;
    },
    sprites,
    Image: browser.Image,
    ResizeObserver: class {
      private readonly observer: ResizeObserver;
      constructor(changed: () => void) {
        this.observer = new browser.ResizeObserver(changed);
      }
      observe() {
        this.observer.observe(canvas);
      }
      disconnect() {
        this.observer.disconnect();
      }
    },
    window: {
      matchMedia: (query) => browser.matchMedia(query),
      document: { fonts: browser.document.fonts },
    },
  };
}
