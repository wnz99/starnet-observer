import type { Point, Rect, Extent } from "./types.js";
import { element } from "../model/types.js";
const FUTURE_BLOCKS = [1, 2];
const STRIP_WIDTH = 2;
const ROOT_COLUMNS = [2, 6, 12, 16];
const PARTITION_STARTS = [1, 11];
const ROOM = {
  seats: 24,
  seatsPerBlock: 8,
  columns: 4,
  deskRow: 6,
  blockHeight: 7,
  rowHeight: 3,
  deskWidth: 2,
  partitionRow: 3,
  partitionWidth: 8,
  chairApron: 0.51,
};
const PROJECTION = {
  halfWidth: 24,
  halfHeight: 12,
  width: 48,
  depth: 24,
  floorBottom: -2.5,
  defaultHeight: 3.2,
};
export const project = ({ x, y, z = 0 }: Point) => ({
  x: PROJECTION.halfWidth * (x - y),
  y: PROJECTION.halfHeight * (x + y) - PROJECTION.depth * z,
});
export const unproject = ({ x, y }: Point) => ({
  x: x / PROJECTION.width + y / PROJECTION.depth,
  y: y / PROJECTION.depth - x / PROJECTION.width,
  z: 0,
});
export const contains = (rect: Rect, point: Point) =>
  point.x >= rect.x && point.x < rect.x + rect.w && point.y >= rect.y && point.y < rect.y + rect.h;
export const pointAt = (rect: Rect, x: number, y: number, z = 0) => ({
  x: rect.x + x,
  y: rect.y + y,
  z,
});
// Remote walkways carry their host; local ones keep the single-host shape exactly.
export const onHost = <T>(walkway: T, host: string | undefined) =>
  host ? { ...walkway, host } : walkway;
export const strip = (a: Point, b: Point, kind: string) => ({
  kind,
  rect: {
    x: Math.min(a.x, b.x) - 1,
    y: Math.min(a.y, b.y) - 1,
    w: Math.abs(b.x - a.x) + STRIP_WIDTH,
    h: Math.abs(b.y - a.y) + STRIP_WIDTH,
  },
});
export const deskFor = (rect: Rect, block: number, seat: number) => ({
  x: rect.x + element(ROOT_COLUMNS, seat % ROOM.columns),
  y:
    rect.y +
    ROOM.deskRow +
    block * ROOM.blockHeight +
    Math.floor(seat / ROOM.columns) * ROOM.rowHeight,
  w: ROOM.deskWidth,
  h: 1,
});

export const partitionsFor = (rect: Rect, block: number) =>
  PARTITION_STARTS.map((x) => ({
    x: rect.x + x,
    y: rect.y + ROOM.partitionRow + block * ROOM.blockHeight,
    w: ROOM.partitionWidth,
    h: 1,
  }));

export const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
export const rootObstacles = (rect: Rect) =>
  Array.from({ length: ROOM.seats }, (_, seat) =>
    deskFor(rect, Math.floor(seat / ROOM.seatsPerBlock), seat % ROOM.seatsPerBlock),
  ).concat(FUTURE_BLOCKS.flatMap((block) => partitionsFor(rect, block)));
export const helperStationFor = (rect: Rect, block: number, offset: Rect) => ({
  x: rect.x + offset.x,
  y: rect.y + block * ROOM.blockHeight + offset.y - ROOM.chairApron,
  w: offset.w,
  h: offset.h + ROOM.chairApron,
});
export function projectedBounds(extents: readonly Extent[]) {
  const corners = extents.flatMap(({ rect, height = PROJECTION.defaultHeight }) =>
    [rect.x, rect.x + rect.w].flatMap((x) =>
      [rect.y, rect.y + rect.h].flatMap((y) => [
        project({ x, y, z: height }),
        project({ x, y, z: PROJECTION.floorBottom }),
      ]),
    ),
  );
  return {
    minX: Math.min(...corners.map((p) => p.x)) - PROJECTION.width,
    maxX: Math.max(...corners.map((p) => p.x)) + PROJECTION.width,
    minY: Math.min(...corners.map((p) => p.y)) - PROJECTION.depth,
    maxY: Math.max(...corners.map((p) => p.y)) + PROJECTION.depth,
  };
}
