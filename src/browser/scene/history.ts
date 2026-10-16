import { element } from "../model/types.js";
import type { Actor, Point, HistoryTarget } from "./types.js";
const HISTORY = { arcBucket: 0.8 };
export function historyAt(parent: Actor, arc: number, side = 0): HistoryTarget | null {
  for (let i = 1; i < parent.trail.length; i++) {
    const a = element(parent.trail, i - 1),
      b = element(parent.trail, i);
    if (a.arc <= arc && b.arc >= arc && b.arc > a.arc) {
      const t = (arc - a.arc) / (b.arc - a.arc),
        dx = (b.point.x - a.point.x) / (b.arc - a.arc),
        dy = (b.point.y - a.point.y) / (b.arc - a.arc);
      return {
        arc,
        dx,
        dy,
        point: {
          x: a.point.x + (b.point.x - a.point.x) * t - dy * side,
          y: a.point.y + (b.point.y - a.point.y) * t + dx * side,
          z: 0,
        },
      };
    }
  }
  return null;
}
export function trailTarget(parent: Actor, spacing: number, side = 0) {
  // Quantized arc targets avoid a new grid search per animation frame.
  return historyAt(
    parent,
    Math.floor((parent.arc - spacing) / HISTORY.arcBucket) * HISTORY.arcBucket,
    side,
  );
}
export function historicalPath(
  parent: Actor,
  fromArc: number,
  target: HistoryTarget | null,
  side: number,
): Point[] {
  if (!target) return [];
  const first = historyAt(parent, fromArc, side);
  if (!first) return [];
  const points = [first.point];
  for (let i = 1; i < parent.trail.length - 1; i++) {
    const node = element(parent.trail, i),
      next = element(parent.trail, i + 1);
    if (node.arc < fromArc || node.arc >= target.arc) continue;
    // Both sides of a historical vertex are explicit; their connector must also be safe.
    points.push((historyAt(parent, node.arc, side) ?? { point: node.point }).point);
    const length = next.arc - node.arc;
    points.push({
      x: node.point.x - ((next.point.y - node.point.y) / length) * side,
      y: node.point.y + ((next.point.x - node.point.x) / length) * side,
      z: 0,
    });
  }
  points.push(target.point);
  return points;
}
