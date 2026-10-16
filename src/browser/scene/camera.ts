import { project, unproject, projectedBounds, contains } from "./geometry.js";
import type { Viewport, Bounds, Camera, Point, Scene, HitRegion } from "./types.js";
const CAMERA = {
  minimumFit: 0.0001,
  maximumZoom: 3,
  minimumZoom: 0.15,
  fitPadding: 48,
  edgePadding: 24,
  focusZoom: 1.25,
  focusWidth: 100,
  focusHeight: 0.6,
  platformHeight: 3.2,
};
const HALVES = 2;
const viewportOf = (v: Viewport) => ({
  width: Number.isFinite(v.width) && v.width > 0 ? v.width : 1,
  height: Number.isFinite(v.height) && v.height > 0 ? v.height : 1,
});
const fitZoom = (bounds: Bounds, v: Viewport) =>
  Math.max(
    CAMERA.minimumFit,
    Math.min(
      CAMERA.maximumZoom,
      Math.max(1, v.width - CAMERA.fitPadding) / Math.max(1, bounds.maxX - bounds.minX),
      Math.max(1, v.height - CAMERA.fitPadding) / Math.max(1, bounds.maxY - bounds.minY),
    ),
  );
const clampZoom = (zoom: number, bounds: Bounds, v: Viewport) =>
  Math.max(Math.min(CAMERA.minimumZoom, fitZoom(bounds, v)), Math.min(CAMERA.maximumZoom, zoom));
function constrain(camera: Camera, bounds: Bounds, viewport: Viewport) {
  const v = viewportOf(viewport),
    zoom = clampZoom(camera.zoom, bounds, v),
    result = { zoom, tx: camera.tx, ty: camera.ty };
  for (const [offset, low, high, size] of [
    ["tx", "minX", "maxX", "width"],
    ["ty", "minY", "maxY", "height"],
  ] as const) {
    result[offset] =
      (bounds[high] - bounds[low]) * zoom <= v[size] - CAMERA.fitPadding
        ? (v[size] - (bounds[low] + bounds[high]) * zoom) / HALVES
        : Math.max(
            CAMERA.edgePadding - bounds[high] * zoom,
            Math.min(v[size] - CAMERA.edgePadding - bounds[low] * zoom, result[offset]),
          );
  }
  return result;
}
export function fit(bounds: Bounds, viewport: Viewport) {
  const v = viewportOf(viewport),
    zoom = fitZoom(bounds, v);
  return {
    zoom,
    tx: (v.width - (bounds.minX + bounds.maxX) * zoom) / HALVES,
    ty: (v.height - (bounds.minY + bounds.maxY) * zoom) / HALVES,
  };
}
export function focus(point: Point, bounds: Bounds, viewport: Viewport) {
  const v = viewportOf(viewport),
    at = project(point),
    zoom = clampZoom(
      Math.max(fitZoom(bounds, v), Math.min(CAMERA.focusZoom, v.width / CAMERA.focusWidth)),
      bounds,
      v,
    );
  return constrain(
    { zoom, tx: v.width / HALVES - at.x * zoom, ty: v.height * CAMERA.focusHeight - at.y * zoom },
    bounds,
    v,
  );
}
export function platformBounds(scene: Scene, key: string) {
  const platform = scene.platforms.find((platform) => platform.key === key);
  return platform
    ? projectedBounds([{ rect: platform.rect, height: CAMERA.platformHeight }])
    : null;
}
export function focusPlatform(scene: Scene, key: string, viewport: Viewport) {
  const bounds = platformBounds(scene, key);
  if (!bounds) return null;
  return constrain(fit(bounds, viewport), scene.bounds, viewport);
}
export function hitPlatform(point: Point, scene: Scene, camera: Camera) {
  const floor = fromScreen(point, camera);
  return (
    scene.platforms
      .filter((platform) => contains(platform.rect, floor))
      .sort((a, b) => a.key.localeCompare(b.key))[0]?.key || null
  );
}
export function zoomAt(
  ...[camera, screenPoint, factor, bounds, viewport]: [Camera, Point, number, Bounds, Viewport]
) {
  const v = viewportOf(viewport),
    zoom = clampZoom(camera.zoom * factor, bounds, v),
    ratio = zoom / camera.zoom;
  return constrain(
    {
      zoom,
      tx: screenPoint.x - (screenPoint.x - camera.tx) * ratio,
      ty: screenPoint.y - (screenPoint.y - camera.ty) * ratio,
    },
    bounds,
    v,
  );
}
export const pan = (camera: Camera, delta: Point, bounds: Bounds, viewport: Viewport) =>
  constrain({ ...camera, tx: camera.tx + delta.x, ty: camera.ty + delta.y }, bounds, viewport);
export function toScreen(point: Point, camera: Camera) {
  const p = project(point);
  return { x: camera.tx + p.x * camera.zoom, y: camera.ty + p.y * camera.zoom };
}
export const fromScreen = (point: Point, camera: Camera) =>
  unproject({ x: (point.x - camera.tx) / camera.zoom, y: (point.y - camera.ty) / camera.zoom });
export function hitTest(point: Point, regions: readonly HitRegion[]) {
  let chosen: HitRegion | null = null;
  for (const r of regions)
    if (
      point.x >= r.left &&
      point.x <= r.left + r.width &&
      point.y >= r.top &&
      point.y <= r.top + r.height &&
      (!chosen || r.depth >= chosen.depth)
    )
      chosen = r;
  return chosen ? chosen.id : null;
}
