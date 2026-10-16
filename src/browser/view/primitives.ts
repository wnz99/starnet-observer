import { project as P } from "../scene/index.js";
import type { Point, Rect } from "../scene/types.js";
import { present as required } from "./values.js";
const HEX_RADIX = 16;
const RED_SHIFT = 16;
const GREEN_SHIFT = 8;
const BYTE_MASK = 255;
const HEX_COLOR_END = 7;
const HEX_CHANNEL_WIDTH = 2;
const RGB_SHIFTS = [16, 8, 0];
const FNV_OFFSET = 2166136261;
const FNV_PRIME = 16777619;
const FACE_EPSILON = 0.0001;
const LOD_BREAKPOINTS = { overview: 0.45, detail: 1.1 };
const CACHE_POLICY = { pixels: 4e6, axis: 4096, buckets: [0.25, 0.5, 1, 2] };
export const LOD = Object.freeze(LOD_BREAKPOINTS);
export const CACHE = Object.freeze(CACHE_POLICY);
/* Approved skins draw about 19 design px tall natively (76 source px at 0.25). Crew stand ~40 px: just under
   two height units beside 48x24 floor diamonds, matching the fallback silhouette so loading never resizes them. */
export const SPRITE_SCALE = 2.1,
  CREW_HEIGHT = 40,
  MIN_HIT = 20,
  ZOOM_STEP = 1.25;
// Six-digit hex or numeric rgba (the validated forms) as channels; dynamic opacity multiplies the colour's own alpha.
function channels(color: string): [number, number, number, number] {
  const hex = /^#([0-9a-f]{6})$/i.exec(color),
    rgba = /^rgba\((\d+),(\d+),(\d+),([\d.]+)\)$/.exec(color.replace(/\s+/g, ""));
  if (hex) {
    const value = parseInt(hex[1] || "", HEX_RADIX);
    return [
      (value >> RED_SHIFT) & BYTE_MASK,
      (value >> GREEN_SHIFT) & BYTE_MASK,
      value & BYTE_MASK,
      1,
    ];
  }
  return rgba ? [Number(rgba[1]), Number(rgba[2]), Number(rgba[3]), Number(rgba[4])] : [0, 0, 0, 1];
}
export function withAlpha(color: string, alpha: number) {
  const [r, g, b, a] = channels(color);
  return `rgba(${String(r)},${String(g)},${String(b)},${String(alpha * a)})`;
}
export function opaque(color: string) {
  const [r, g, b, a] = channels(color);
  return a === 1 ? `rgb(${String(r)},${String(g)},${String(b)})` : withAlpha(color, 1);
}
export function hash(text: unknown) {
  let value = FNV_OFFSET;
  for (const char of String(text)) value = Math.imul(value ^ char.charCodeAt(0), FNV_PRIME);
  return value >>> 0;
}
export const center = (rect: Rect) => ({ x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 });
export const middle = (rect: Rect) => rect.x + rect.w / 2 + rect.y + rect.h / 2;
export const corners = (rect: Rect) => [
  { x: rect.x, y: rect.y },
  { x: rect.x, y: rect.y + rect.h },
  { x: rect.x + rect.w, y: rect.y + rect.h },
  { x: rect.x + rect.w, y: rect.y },
];
export const rectPoly = (rect: Rect, z = 0) => [
  P({ x: rect.x, y: rect.y, z }),
  P({ x: rect.x + rect.w, y: rect.y, z }),
  P({ x: rect.x + rect.w, y: rect.y + rect.h, z }),
  P({ x: rect.x, y: rect.y + rect.h, z }),
];
/* Camera-facing side faces of a floor polygon wound like corners(): (x,y) → (x,y+h) → (x+w,y+h) → (x+w,y).
   The outward normal of edge a→b is (a.y-b.y, b.x-a.x); a face is visible when it points toward the viewer
   (nx+ny>0). `side` is right (lit, +x) or left (shaded, +y). */
export function visibleFaces(points: readonly Point[]) {
  const faces: { a: Point; b: Point; side: "right" | "left" | "mid" }[] = [];
  for (let index = 0; index < points.length; index++) {
    const a = required(points[index]),
      b = required(points[(index + 1) % points.length]),
      nx = a.y - b.y,
      ny = b.x - a.x;
    if (nx + ny <= FACE_EPSILON) continue;
    faces.push({
      a,
      b,
      side: nx > ny + FACE_EPSILON ? "right" : ny > nx + FACE_EPSILON ? "left" : "mid",
    });
  }
  return faces;
}
export function shade(color: string, amount: number) {
  const value = parseInt(color.slice(1, HEX_COLOR_END), HEX_RADIX);
  if (!Number.isFinite(value)) return color;
  const channels = RGB_SHIFTS.map((shift) => {
    const channel = Math.max(
      0,
      Math.min(BYTE_MASK, Math.round(((value >> shift) & BYTE_MASK) * (1 + amount))),
    );
    const hex = channel.toString(HEX_RADIX);
    return hex.padStart(HEX_CHANNEL_WIDTH, "0");
  });
  return "#" + channels.join("");
}
export interface BoxColors {
  top: string;
  left: string;
  right: string;
  mid?: string;
  edge?: string;
}

export const midpoint = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
