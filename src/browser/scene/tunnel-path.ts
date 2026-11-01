import { crosses } from "./navigation.js";
import { element, required } from "../model/types.js";
import type { Point, Rect } from "./types.js";
interface Step {
  x: number;
  y: number;
  cost: number;
  key: string;
}
const keyFor = (x: number, y: number) => String(x) + ":" + String(y);
const coordinates = (values: number[]) => [...new Set(values)].sort((a, b) => a - b);

// Compressed rectangle edges keep routing independent of world size; tunnels never enter another machine.
export function tunnelPath(from: Point, to: Point, obstacles: Rect[]): Point[] {
  const xs = coordinates([from.x, to.x, ...obstacles.flatMap((r) => [r.x, r.x + r.w])]);
  const ys = coordinates([from.y, to.y, ...obstacles.flatMap((r) => [r.y, r.y + r.h])]);
  const start = {
    x: xs.indexOf(from.x),
    y: ys.indexOf(from.y),
    cost: 0,
    key: keyFor(xs.indexOf(from.x), ys.indexOf(from.y)),
  };
  const target = keyFor(xs.indexOf(to.x), ys.indexOf(to.y));
  const queue = [start],
    costs = new Map([[start.key, 0]]),
    previous = new Map<string, string>();
  const points = new Map<string, Point>([[start.key, from]]);
  while (queue.length > 0) {
    queue.sort((a, b) => b.cost - a.cost);
    const current = queue.pop();
    if (!current || current.cost !== costs.get(current.key)) continue;
    if (current.key === target) return reconstruct(previous, points, target);
    const a = required(points, current.key);
    for (const next of neighbors(current, xs, ys)) {
      const b = { x: element(xs, next.x), y: element(ys, next.y), z: 0 };
      if (obstacles.some((rect) => crosses(rect, a, b))) continue;
      const cost = current.cost + Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
      if (cost >= (costs.get(next.key) ?? Infinity)) continue;
      costs.set(next.key, cost);
      previous.set(next.key, current.key);
      points.set(next.key, b);
      queue.push({ ...next, cost });
    }
  }
  throw new Error("No clear external relay tunnel route");
}
function neighbors(point: Step, xs: number[], ys: number[]) {
  return [
    [point.x - 1, point.y],
    [point.x + 1, point.y],
    [point.x, point.y - 1],
    [point.x, point.y + 1],
  ]
    .filter(([x = -1, y = -1]) => x >= 0 && y >= 0 && x < xs.length && y < ys.length)
    .map(([x = -1, y = -1]) => ({ x, y, key: keyFor(x, y) }));
}
function reconstruct(previous: Map<string, string>, points: Map<string, Point>, target: string) {
  const path: Point[] = [];
  for (let key: string | undefined = target; key !== undefined; key = previous.get(key))
    path.unshift(required(points, key));
  return path.filter((point, index) => {
    const before = path[index - 1],
      after = path[index + 1];
    return (
      !before ||
      !after ||
      !(
        (before.x === point.x && point.x === after.x) ||
        (before.y === point.y && point.y === after.y)
      )
    );
  });
}
