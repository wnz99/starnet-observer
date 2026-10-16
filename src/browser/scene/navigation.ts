import { contains, rootObstacles, helperStationFor, pointAt, project } from "./geometry.js";
import { helperStations } from "../model/identity.js";
import { element, required } from "../model/types.js";
import type { Platform, Graph, Rect, Point, Worker } from "./types.js";
const GRID = {
  blocks: [0, 1, 2],
  firstY: 3,
  backMargin: 2,
  cellCenter: 0.5,
  slabInset: 1e-8,
  axisEpsilon: 1e-10,
  headingSector: Math.PI / 4,
  headings: 8,
  collinearEpsilon: 1e-8,
};
const cellKey = (x: number, y: number) => `${String(x)},${String(y)}`;
const HEADINGS = [
  "east",
  "south-east",
  "south",
  "south-west",
  "west",
  "north-west",
  "north",
  "north-east",
];
export function graphFor(platform: Platform) {
  const cells = new Map<string, Point>(),
    r = platform.rect;
  // Reserve future desks and section partitions too: growth must never place an obstacle under a wandering worker.
  const obstacles = rootObstacles(r)
    // Reserve candidate stations before helpers arrive, so a new desk cannot appear on an in-flight path.
    .concat(
      GRID.blocks.flatMap((block) =>
        helperStations.map((offset) => helperStationFor(r, block, offset)),
      ),
    )
    .concat(platform.helperStations || [])
    .concat(platform.decorationRegions.filter((d) => d.kind !== "apron").map((d) => d.rect));
  for (let x = 1; x < r.w - 1; x++)
    for (let y = GRID.firstY; y < r.h - GRID.backMargin; y++) {
      const point = pointAt(r, x + GRID.cellCenter, y + GRID.cellCenter);
      if (!obstacles.some((o) => contains(o, point))) cells.set(cellKey(x, y), point);
    }
  const graph = { cells, rect: r, obstacles, edges: new Map<string, string[]>() };
  for (const [key, point] of cells) {
    const [x = NaN, y = NaN] = key.split(",").map(Number);
    graph.edges.set(
      key,
      [cellKey(x - 1, y), cellKey(x + 1, y), cellKey(x, y - 1), cellKey(x, y + 1)].filter(
        (next) => cells.has(next) && safeSegment(graph, point, required(cells, next)),
      ),
    );
  }
  return graph;
}
// Slab intersection tests the entire segment, including sub-cell furniture and endpoint joins.
export function crosses(rect: Rect, a: Point, b: Point) {
  let low = 0,
    high = 1;
  for (const [axis, size] of [
    ["x", "w"],
    ["y", "h"],
  ] as const) {
    const delta = b[axis] - a[axis],
      min = rect[axis] + GRID.slabInset,
      max = rect[axis] + rect[size] - GRID.slabInset;
    if (Math.abs(delta) < GRID.axisEpsilon) {
      if (a[axis] <= min || a[axis] >= max) return false;
    } else {
      const first = (min - a[axis]) / delta,
        second = (max - a[axis]) / delta;
      low = Math.max(low, Math.min(first, second));
      high = Math.min(high, Math.max(first, second));
      if (low > high) return false;
    }
  }
  return low <= high;
}
export function safeSegment(graph: Graph | undefined, a: Point, b: Point, worker?: Worker) {
  if (!graph || !contains(graph.rect, a) || !contains(graph.rect, b)) return false;
  return !graph.obstacles.some((obstacle) => {
    const own =
      worker?.station &&
      obstacle.x === worker.station.x &&
      obstacle.y === worker.station.y &&
      obstacle.w === worker.station.w &&
      obstacle.h === worker.station.h;
    // Only its owner can cross the chair apron. Its actual desk remains solid.
    return crosses(own ? worker.desk : obstacle, a, b);
  });
}
function nearest(graph: Graph, point: Point, worker?: Worker) {
  let best: string | undefined,
    distance = Infinity;
  for (const [key, p] of graph.cells) {
    const d = Math.hypot(p.x - point.x, p.y - point.y);
    if (d < distance && safeSegment(graph, point, p, worker)) {
      best = key;
      distance = d;
    }
  }
  return best;
}
function search(graph: Graph, start: string, end: string) {
  const queue = [start],
    previous = new Map<string, string | null>([[start, null]]);
  for (let index = 0; index < queue.length && !previous.has(end); index++) {
    const key = element(queue, index);
    for (const next of required(graph.edges, key))
      if (!previous.has(next)) {
        previous.set(next, key);
        queue.push(next);
      }
  }
  return previous;
}
export function pathTo(graph: Graph | undefined, from: Point, to: Point, worker?: Worker): Point[] {
  if (!graph) return [];
  const start = nearest(graph, from, worker),
    end = nearest(graph, to, worker);
  if (!start || !end) return [];
  const previous = search(graph, start, end);
  if (!previous.has(end)) return [];
  const keys = [];
  for (let key: string | null = end; key !== null; key = required(previous, key)) keys.unshift(key);
  const points = [
    { ...from },
    ...keys.map((key) => ({ ...required(graph.cells, key) })),
    { ...to },
  ];
  return simplifyPath(graph, points, worker);
}
function simplifyPath(graph: Graph, path: Point[], worker?: Worker) {
  const points = path.slice();
  for (let index = 1; index < points.length - 1;) {
    const a = element(points, index - 1),
      b = element(points, index),
      c = element(points, index + 1);
    if (
      Math.abs((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)) < GRID.collinearEpsilon &&
      safeSegment(graph, a, c, worker)
    )
      points.splice(index, 1);
    else index++;
  }
  return points.slice(1);
}
export function direction(dx: number, dy: number) {
  const p = project({ x: dx, y: dy });
  return element(
    HEADINGS,
    (Math.round(Math.atan2(p.y, p.x) / GRID.headingSector) + GRID.headings) % GRID.headings,
  );
}
