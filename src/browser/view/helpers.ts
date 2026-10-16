import type { Bounds, Scene, Viewport } from "../scene/types.js";
import { CACHE, LOD } from "./primitives.js";
import type { Envelope, Plate } from "./types.js";
export { CREW_HEIGHT, MIN_HIT, SPRITE_SCALE, ZOOM_STEP } from "./primitives.js";
const IDLE_TINT = { grayscale: 0.85, darkness: 0.55, precision: 2 };
const CACHE_MIN_RESOLUTION = 0.01;
const CACHE_MAX_BUCKET = 2;
const ENVELOPE_ANCHOR_PRECISION = 100;
const ENVELOPE_STACK_LIFT = 14;
// A fresh blocked row identifies a prompt or dialog awaiting input.
export const needsAttention = (
  worker: { row?: { status?: string } } | null | undefined,
  stale: boolean,
) => !stale && worker?.row?.status === "blocked";
/* Crew tint progresses from unchanged to greyscale and darkness. Model quantisation limits filter churn. */
export function idleFilter(level: unknown) {
  const t = Math.max(0, Math.min(1, Number(level) || 0));
  return t
    ? `grayscale(${(IDLE_TINT.grayscale * t).toFixed(IDLE_TINT.precision)}) brightness(${(1 - IDLE_TINT.darkness * t).toFixed(IDLE_TINT.precision)})`
    : "none";
}
export const lodFor = (zoom: number) =>
  zoom < LOD.overview ? "overview" : zoom < LOD.detail ? "sections" : "detail";
// One static-layer resolution per zoom bucket, capped by the pixel budget so huge decks never allocate unbounded canvases.
export function cacheResolution(bounds: Bounds, zoom: number, dpr: number) {
  const want = Math.max(CACHE_MIN_RESOLUTION, zoom * dpr),
    bucket = CACHE.buckets.find((value) => value >= want) || CACHE_MAX_BUCKET;
  const w = Math.max(1, bounds.maxX - bounds.minX),
    h = Math.max(1, bounds.maxY - bounds.minY);
  return Math.min(bucket, CACHE.axis / w, CACHE.axis / h, Math.sqrt(CACHE.pixels / (w * h)));
}
export function statusSignature(scene: Scene) {
  const statuses = scene.workers.map((worker) => worker.id + ":" + String(worker.row.status));
  statuses.sort();
  return statuses.join("|");
}
// Greedy by priority: a plate is dropped, never overlapped, when it collides with an accepted higher-priority plate.
export function placePlates<T extends Plate>(plates: readonly T[]) {
  const accepted: T[] = [],
    ordered = [...plates];
  ordered.sort((a, b) => b.priority - a.priority);
  for (const plate of ordered) {
    const hit = accepted.some(
      (other) =>
        plate.x < other.x + other.w &&
        other.x < plate.x + plate.w &&
        plate.y < other.y + other.h &&
        other.y < plate.y + plate.h,
    );
    if (!hit) accepted.push(plate); // `force` only keeps a plate on stage (stagePlates); priority alone settles collisions
  }
  return accepted;
}
/* Plates whose anchor is off stage are discarded, except forced hover/focus plates, which are clamped into view.
   Clamping happens before collision resolution, so what is accepted is exactly what is drawn. */
export function stagePlates<T extends Plate>(plates: readonly T[], viewport: Viewport, margin = 4) {
  return plates
    .filter(
      (plate) =>
        plate.force ||
        (plate.x + plate.w > 0 &&
          plate.x < viewport.width &&
          plate.y + plate.h > 0 &&
          plate.y < viewport.height),
    )
    .map((plate) => ({
      ...plate,
      x: Math.max(margin, Math.min(viewport.width - plate.w - margin, plate.x)),
      y: Math.max(margin, Math.min(viewport.height - plate.h - margin, plate.y)),
    }));
}
/* Shared logical envelope anchors stack in stable label/colour order, 14 design pixels apart. Scene coordinates stay untouched. */
export function stackEnvelopes<T extends Envelope>(envelopes: readonly T[]) {
  const groups = new Map<string, T[]>();
  for (const envelope of envelopes) {
    const key = [envelope.point.x, envelope.point.y, envelope.point.z || 0]
      .map((value) => Math.round(value * ENVELOPE_ANCHOR_PRECISION))
      .join(",");
    let group = groups.get(key);
    if (!group) {
      group = [];
      groups.set(key, group);
    }
    group.push(envelope);
  }
  return [...groups.values()].flatMap((group) => {
    const ordered = [...group];
    ordered.sort(
      (a, b) => (a.label || "").localeCompare(b.label || "") || a.color.localeCompare(b.color),
    );
    return ordered.map((envelope, index) => ({ envelope, lift: index * ENVELOPE_STACK_LIFT }));
  });
}
