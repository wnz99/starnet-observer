import type { Flight, Point } from "./types.js";
export const LEG = 3200;
export const SORT = 800;
export const FLIGHT = LEG * 2 + SORT;
export const FADE = 600;
export const GAP = 6000;
export const MAX_AIRBORNE = 6;
export const MAX_QUEUE = 24;
export function along(points: readonly Point[], progress: number): Point {
  const last = points.at(-1);
  if (!last) throw new Error("Courier route requires a waypoint");
  const segments = points.slice(1).map((end, index) => {
    const start = points[index];
    if (!start) throw new Error("Courier route is incomplete");
    return { start, end, length: Math.hypot(end.x - start.x, end.y - start.y) };
  });
  let distance =
    Math.max(0, Math.min(1, progress)) * segments.reduce((sum, segment) => sum + segment.length, 0);
  for (const segment of segments) {
    if (distance <= segment.length && segment.length > 0) {
      const share = distance / segment.length;
      return {
        x: segment.start.x + (segment.end.x - segment.start.x) * share,
        y: segment.start.y + (segment.end.y - segment.start.y) * share,
      };
    }
    distance -= segment.length;
  }
  return { ...last };
}
export function position(flight: Pick<Flight, "from" | "to" | "start">, now: number) {
  const elapsed = now - flight.start;
  if (elapsed < LEG) return { phase: "pickup", ...along(flight.from, elapsed / LEG) };
  if (elapsed < LEG + SORT) return { phase: "sort", ...along(flight.from, 1) };
  return { phase: "outbound", ...along(flight.to.slice().reverse(), (elapsed - LEG - SORT) / LEG) };
}
