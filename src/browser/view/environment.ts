import type { SpriteResource } from "../sprites/types.js";
import type { ViewEnvironment } from "./types.js";
import { present } from "./values.js";
export function drawingEnvironment<R extends SpriteResource, B extends R>(
  env: ViewEnvironment<R, B>,
) {
  const win = env.window ?? {};
  return {
    win,
    raf:
      env.raf ??
      ((callback: (now: number) => void) => {
        if (!win.requestAnimationFrame) throw new Error("Missing View animation scheduler");
        return win.requestAnimationFrame(callback);
      }),
    caf:
      env.caf ??
      ((frame: number) => {
        if (!win.cancelAnimationFrame) throw new Error("Missing View animation cancellation");
        win.cancelAnimationFrame(frame);
      }),
    dprOf: env.dpr ?? (() => win.devicePixelRatio || 1),
    makeCanvas:
      env.createCanvas ??
      ((width: number, height: number) => {
        const document = present(win.document);
        if (!document.createElement) throw new Error("Missing View canvas factory");
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        return canvas;
      }),
    clock: env.now ?? (() => (typeof performance === "undefined" ? Date.now() : performance.now())),
  };
}
