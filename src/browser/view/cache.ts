import type { SpriteResource } from "../sprites/types.js";
import type { Bounds } from "../scene/types.js";
import { cacheResolution } from "./helpers.js";
import { CACHE } from "./primitives.js";
import type { ViewRuntime } from "./runtime.js";
import { present as required } from "./values.js";
export class Cache<R extends SpriteResource, B extends R = R> {
  constructor(readonly view: ViewRuntime<R, B>) {}

  staticFor = () => {
    const { camera, viewport, dpr } = this.view,
      visible = {
        minX: -camera.tx / camera.zoom,
        minY: -camera.ty / camera.zoom,
        maxX: (viewport.width - camera.tx) / camera.zoom,
        maxY: (viewport.height - camera.ty) / camera.zoom,
      },
      margin = CACHE.margin / camera.zoom;
    let b = {
      minX: visible.minX - margin,
      minY: visible.minY - margin,
      maxX: visible.maxX + margin,
      maxY: visible.maxY + margin,
    };
    let resolution = cacheResolution(b, camera.zoom, dpr);
    // Prefer visible detail when the panning margin would force a lower resolution.
    if (resolution < camera.zoom * dpr) {
      b = visible;
      resolution = cacheResolution(b, camera.zoom, dpr);
    }
    const key =
      this.view.activeScene.revision +
      "#" +
      this.view.signature +
      "#" +
      String(resolution) +
      "#" +
      this.view.resources.artMode();
    const previous = this.view.staticLayer;
    if (
      previous &&
      previous.key === key &&
      previous.bounds.minX <= visible.minX &&
      previous.bounds.minY <= visible.minY &&
      previous.bounds.maxX >= visible.maxX &&
      previous.bounds.maxY >= visible.maxY
    )
      return previous;
    return this.build(b, resolution, key);
  };

  private build(b: Bounds, resolution: number, key: string) {
    const previous = this.view.staticLayer;
    // Floored backing dimensions retain the continuous pixel and per-axis budgets.
    const spanX = Math.max(1, b.maxX - b.minX),
      spanY = Math.max(1, b.maxY - b.minY);
    const width = Math.max(1, Math.floor(spanX * resolution)),
      height = Math.max(1, Math.floor(spanY * resolution));
    const layer = previous?.canvas ?? this.view.makeCanvas(width, height);
    this.view.staticLayer = null;
    // Reset the backing store instead of retaining old and new scene images. Clear the
    // width first so an aspect-ratio change cannot transiently exceed the pixel budget.
    layer.width = 0;
    layer.height = height;
    layer.width = width;
    const layerCtx = required(layer.getContext("2d")),
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
      builds: (previous?.builds ?? 0) + 1,
    };
    return this.view.staticLayer;
  }
}
