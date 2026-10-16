import type { SpriteResource } from "../sprites/types.js";
import { cacheResolution } from "./helpers.js";
import type { ViewRuntime } from "./runtime.js";
import { present as required } from "./values.js";
export class Cache<R extends SpriteResource, B extends R = R> {
  constructor(readonly view: ViewRuntime<R, B>) {}

  staticFor = () => {
    const resolution = cacheResolution(
      this.view.activeScene.bounds,
      this.view.camera.zoom,
      this.view.dpr,
    );
    const key =
      this.view.activeScene.revision +
      "#" +
      this.view.signature +
      "#" +
      String(resolution) +
      "#" +
      this.view.resources.artMode();
    if (this.view.staticLayer && this.view.staticLayer.key === key) return this.view.staticLayer;
    // Floored backing dimensions retain the continuous pixel and per-axis budgets.
    const b = this.view.activeScene.bounds,
      spanX = Math.max(1, b.maxX - b.minX),
      spanY = Math.max(1, b.maxY - b.minY);
    const width = Math.max(1, Math.floor(spanX * resolution)),
      height = Math.max(1, Math.floor(spanY * resolution));
    const layer = this.view.makeCanvas(width, height),
      layerCtx = required(layer.getContext("2d")),
      sx = width / spanX,
      sy = height / spanY;
    layerCtx.setTransform(sx, 0, 0, sy, -b.minX * sx, -b.minY * sy);
    // Office pixel art stays crisp when magnified; it is only smoothed when the bucket shrinks it.
    if (this.view.resources.artMode() === "office") layerCtx.imageSmoothingEnabled = resolution < 1;
    this.view.resources.artPainters().paintStatic(layerCtx, this.view.activeScene);
    this.view.staticLayer = {
      key,
      canvas: layer,
      resolution,
      bounds: b,
      builds: (this.view.staticLayer ? this.view.staticLayer.builds : 0) + 1,
    };
    return this.view.staticLayer;
  };
}
