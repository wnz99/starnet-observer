import { contains, deskFor, rootObstacles, helperStationFor, overlaps } from "./geometry.js";
import { helperStations } from "../model/identity.js";
import { element } from "../model/types.js";
import type { Room } from "../model/types.js";
import type { Rect, Section, Point, Mailroom, Worker, Overflow } from "./types.js";
const SEATS = {
  chairX: 1,
  chairY: 0.5,
  laneOffset: 0.75,
  aisleX: 10,
  localDockY: 6,
  helperChairY: 0.36,
  helperScale: 0.72,
  half: 2,
  inset: 0.001,
};
interface RouteGeometry {
  entry: Point;
  elbow: Point;
  join: Point;
  own: Mailroom;
  spineX: number;
}
export function rootWorkers(
  room: Room,
  rect: Rect,
  sections: Section[],
  route: RouteGeometry,
): Worker[] {
  return room.rows
    .filter((value) => value.kind !== "helper")
    .map(({ row, block, seat }) => {
      const desk = deskFor(rect, block, seat ?? NaN);
      const chair = { x: desk.x + SEATS.chairX, y: desk.y - SEATS.chairY, z: 0 };
      const laneY = chair.y - SEATS.laneOffset;
      const home =
        sections.find((section) =>
          contains(section.rect, { x: desk.x + SEATS.chairX, y: desk.y + SEATS.chairY }),
        ) ?? null;
      return {
        id: row.id,
        row,
        kind: "session",
        parentId: null,
        scale: 1,
        platformKey: room.key,
        accent: room.accent,
        desk,
        chair,
        home: home ? { ...home.rect } : null,
        section: home?.section ?? null,
        // Remote crew end at their own ship's mailroom (up the spine into it); they never cross to another ship.
        route: [
          chair,
          { x: chair.x, y: laneY, z: 0 },
          { x: rect.x + SEATS.aisleX, y: laneY, z: 0 },
          route.entry,
          route.elbow,
          route.join,
          ...(room.host ? [] : [{ x: route.spineX, y: SEATS.localDockY, z: 0 }]),
          route.own.hub,
        ],
      };
    });
}
const LANES = {
  blocks: [0, 1, 2],
  rows: [4.75, 7.75],
  left: 1,
  halfWidth: 0.25,
  width: 18,
  height: 0.5,
  blockHeight: 7,
  spineX: 9.5,
  spineY: 3,
  spineWidth: 1,
  spineHeight: 22,
};
function reservedLanes(rect: Rect) {
  return LANES.blocks
    .flatMap((block) =>
      LANES.rows.map((y) => ({
        x: rect.x + LANES.left,
        y: rect.y + block * LANES.blockHeight + y - LANES.halfWidth,
        w: LANES.width,
        h: LANES.height,
      })),
    )
    .concat([
      {
        x: rect.x + LANES.spineX,
        y: rect.y + LANES.spineY,
        w: LANES.spineWidth,
        h: LANES.spineHeight,
      },
    ]);
}
function helperCandidate(room: Room, rect: Rect, sections: Section[], value: Room["rows"][number]) {
  const { block, helperSlot } = value;
  const offset =
    helperSlot === null || helperSlot === undefined ? null : helperStations[helperSlot];
  if (!offset) return null;
  const desk = {
    x: rect.x + offset.x,
    y: rect.y + block * LANES.blockHeight + offset.y,
    w: offset.w,
    h: offset.h,
  };
  const chair = { x: desk.x + desk.w / SEATS.half, y: desk.y - SEATS.helperChairY, z: 0 };
  const station = helperStationFor(rect, block, offset);
  const section = sections.find(
    (section) => section.repo === element(room.blocks, block).repo && contains(section.rect, chair),
  );
  if (!section) return null;
  if (!contains(section.rect, station)) return null;
  if (
    !contains(section.rect, {
      x: station.x + station.w - SEATS.inset,
      y: station.y + station.h - SEATS.inset,
    })
  )
    return null;
  return { desk, chair, station };
}
export function helperWorkers(room: Room, rect: Rect, sections: Section[]) {
  const workers: Worker[] = [],
    helperOverflow: Overflow[] = [],
    stations: Rect[] = [];
  const reserved = rootObstacles(rect).concat(reservedLanes(rect));
  for (const value of room.rows.filter((value) => value.kind === "helper")) {
    const { row, parentId, rootId, helperSlot } = value;
    const candidate = helperCandidate(room, rect, sections, value);
    if (
      !candidate ||
      [...reserved, ...stations].some((obstacle) => overlaps(candidate.station, obstacle))
    ) {
      helperOverflow.push({
        id: row.id,
        row,
        parentId,
        rootId,
        platformKey: room.key,
        reason: "No collision-free helper station",
      });
      continue;
    }
    const { desk, chair, station } = candidate;
    stations.push(station);
    workers.push({
      id: row.id,
      row,
      kind: "helper",
      parentId,
      rootId,
      scale: SEATS.helperScale,
      platformKey: room.key,
      accent: room.accent,
      desk,
      chair,
      station,
      helperSlot,
      route: null,
      anchor: null,
      connector: null,
    });
  }
  return { workers, helperOverflow, stations };
}
