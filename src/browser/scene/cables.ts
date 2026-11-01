import { element } from "../model/types.js";
import type { Point, Rect, Scene } from "./types.js";
const MIDPOINT_DIVISOR = 2;
export const CABLE_HEIGHT = 0.1;
const MAIL_OFFSET = -1.6;

export const cableSurfaces = (scene: Scene): Rect[] => [
  ...scene.platforms.map((platform) => platform.rect),
  ...scene.walkways.map((walkway) => walkway.rect),
  scene.mail.rect,
  scene.observatory.rect,
  ...(scene.ships ?? []).flatMap((ship) => (ship.mail ? [ship.mail.rect] : [])),
  ...(scene.relays ?? []).map((relay) => relay.mail.rect),
];

// Translate the orthogonal path to a corridor edge, keeping its terminals connected.
export function mailCablePath(path: readonly Point[]): Point[] {
  if (path.length === 0) return [];
  return [
    { ...element(path, 0), z: CABLE_HEIGHT },
    ...path.map((point) => ({
      x: point.x + MAIL_OFFSET,
      y: point.y + MAIL_OFFSET,
      z: CABLE_HEIGHT,
    })),
    { ...element(path, path.length - 1), z: CABLE_HEIGHT },
  ];
}

function coveredInterval(from: Point, to: Point, rect: Rect): [number, number] | null {
  let enter = 0,
    leave = 1;
  const axes: [number, number, number, number][] = [
    [from.x, to.x, rect.x, rect.x + rect.w],
    [from.y, to.y, rect.y, rect.y + rect.h],
  ];
  for (const [start, end, min, max] of axes) {
    const delta = end - start;
    if (delta === 0) {
      if (start <= min || start >= max) return null;
    } else {
      const first = (min - start) / delta,
        last = (max - start) / delta;
      enter = Math.max(enter, Math.min(first, last));
      leave = Math.min(leave, Math.max(first, last));
    }
  }
  return enter < leave ? [enter, leave] : null;
}

export function cableRuns(path: readonly Point[], surfaces: readonly Rect[]) {
  return path.slice(1).flatMap((to, index) => {
    const from = element(path, index);
    const intervals = surfaces.flatMap((rect) => {
      const interval = coveredInterval(from, to, rect);
      return interval ? [interval] : [];
    });
    const cuts = [...new Set([0, 1, ...intervals.flat()])].sort((a, b) => a - b);
    const at = (fraction: number): Point => ({
      x: from.x + (to.x - from.x) * fraction,
      y: from.y + (to.y - from.y) * fraction,
    });
    return cuts.slice(1).flatMap((end, part) => {
      const start = element(cuts, part),
        middle = (start + end) / MIDPOINT_DIVISOR;
      if (from.x === to.x && from.y === to.y) return [];
      return [
        {
          from: at(start),
          to: at(end),
          covered: intervals.some(([a, b]) => middle > a && middle < b),
        },
      ];
    });
  });
}
