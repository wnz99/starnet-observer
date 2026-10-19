import { partitionsFor, pointAt, strip, onHost } from "./geometry.js";
import { element, required } from "../model/types.js";
import { roomRect } from "./room-placement.js";
import { rootWorkers, helperWorkers } from "./room-workers.js";
import type { ShipLocations } from "./site.js";
import type { Room, LayoutRow } from "../model/types.js";
import type {
  SceneRooms,
  Host,
  Mailroom,
  Platform,
  Walkway,
  Worker,
  Overflow,
  Point,
  Section,
  Rect,
  BuildOptions,
} from "./types.js";
const ROOM = {
  quarters: { x: 14, y: 2.6, w: 3, h: 1, entryX: 15.5, entryY: 3.5 },
  banks: 2,
  spineX: 7,
  rightSpine: 19,
  leftSpine: -5,
  entryX: 10,
  entryY: 25,
  elbowY: 28,
  localDockY: 6,
  sectionX: 1,
  sectionY: 4,
  blockHeight: 7,
  sectionWidth: 18,
  signX: 1.5,
  signHeight: 1.25,
  platformSignX: 10,
};
interface Bank {
  x: number;
  host: Host;
  dock: Point;
  ys: number[];
  relay: boolean;
}
function sectionsFor(room: Room, rect: Rect) {
  const sections: Section[] = [];
  for (let block = 0; block < room.blocks.length; block++) {
    const value = element(room.blocks, block),
      previous = sections.at(-1);
    if (previous && (previous.section || previous.repo) === (value.section || value.repo))
      previous.rect.h += ROOM.blockHeight;
    else
      sections.push({
        repo: value.repo,
        section: value.section || value.repo,
        label: value.label,
        checkoutId: value.checkoutId ?? null,
        checkoutKind: value.checkoutKind ?? null,
        repoLabel: value.repoLabel,
        checkoutLabel: value.checkoutLabel,
        worktree: value.worktree,
        folder: value.folder,
        partitions: block ? partitionsFor(rect, block) : [],
        rect: {
          x: rect.x + ROOM.sectionX,
          y: rect.y + ROOM.sectionY + block * ROOM.blockHeight,
          w: ROOM.sectionWidth,
          h: ROOM.blockHeight,
        },
        sign: pointAt(rect, ROOM.signX, ROOM.sectionY + block * ROOM.blockHeight, ROOM.signHeight),
      });
  }
  return sections;
}
function roomCrew(room: Room, rect: Rect, sections: Section[]) {
  const helpers = helperWorkers(room, rect, sections);
  const represented = new Set(
    room.rows.filter((value) => value.kind !== "helper").map((value) => value.row.id),
  );
  const pending = [...helpers.workers];
  const workers: Worker[] = [];
  while (pending.length > 0) {
    const index = pending.findIndex(
      (worker) => !!worker.parentId && represented.has(worker.parentId),
    );
    if (index < 0) break;
    const worker = element(pending.splice(index, 1), 0);
    represented.add(worker.id);
    workers.push(worker);
  }
  const helperIds = new Set(workers.map((worker) => worker.id));
  return {
    ...helpers,
    workers,
    roots: {
      ...room,
      rows: room.rows.filter((value) => value.kind !== "helper" && !helperIds.has(value.row.id)),
    },
  };
}
export function representedRows(rooms: SceneRooms): LayoutRow[] {
  return rooms.flatMap((room) => {
    const rect = roomRect(room);
    const crew = roomCrew(room, rect, sectionsFor(room, rect));
    return [
      ...crew.roots.rows.map((value) => value.row),
      ...crew.workers.map((worker) => worker.row),
    ];
  });
}
const DECORATION = [
  { kind: "wall", edge: "rear-y", rect: { x: 2, y: 0.5, w: 16, h: 2 } },
  { kind: "wall", edge: "rear-x", rect: { x: 0.2, y: 4, w: 0.6, h: 18 } },
  { kind: "corner", rect: { x: 18.5, y: 1, w: 1, h: 2 } },
  { kind: "apron", rect: { x: 1, y: 24, w: 2, h: 1 } },
  { kind: "apron", rect: { x: 17, y: 24, w: 2, h: 1 } },
];
function locationFor(room: Room, locations: ShipLocations, mail: Mailroom) {
  const bank = room.slot % ROOM.banks;
  const own = room.host ? required(locations.mailrooms, room.host) : mail;
  const rect = roomRect(
    room,
    room.host ? required(locations.tops, room.host) : 0,
    room.host ? locations.dxs.get(room.host) || 0 : 0,
  );
  const spineX = room.host
    ? ROOM.spineX + (locations.dxs.get(room.host) || 0)
    : bank
      ? ROOM.rightSpine
      : ROOM.leftSpine;
  const entry = pointAt(rect, ROOM.entryX, ROOM.entryY),
    elbow = pointAt(rect, ROOM.entryX, ROOM.elbowY),
    join = { x: spineX, y: elbow.y, z: 0 };
  return { own, rect, spineX, entry, elbow, join, bankKey: room.host || bank };
}
type RoomLocation = ReturnType<typeof locationFor>;
interface FamilyRoute extends RoomLocation {
  path: readonly Point[];
  predecessor?: Point;
  relayRoom: boolean;
  relayTraffic: boolean;
}
function familiesFor(rooms: SceneRooms) {
  const families = new Map<string | undefined, Map<string, Room[]>>();
  for (const room of rooms) {
    let projects = families.get(room.host);
    if (!projects) families.set(room.host, (projects = new Map<string, Room[]>()));
    const family = projects.get(room.projectId) ?? [];
    family.push(room);
    projects.set(room.projectId, family);
  }
  return Array.from(families.values()).flatMap((projects) => Array.from(projects.values()));
}
function routesForFamily(
  rooms: readonly Room[],
  locations: ShipLocations,
  mail: Mailroom,
  relayMembers: NonNullable<BuildOptions["relayMembers"]>,
) {
  const routes = new Map<Room, FamilyRoute>();
  const family = rooms.slice().sort((a, b) => a.annex - b.annex);
  const parent = element(family, 0);
  if (parent.annex !== 0) throw new Error(`Missing parent for ${parent.key}`);
  const parentLocation = locationFor(parent, locations, mail);
  const suffix = [
    parentLocation.join,
    ...(parent.host ? [] : [{ x: parentLocation.spineX, y: ROOM.localDockY, z: 0 }]),
    parentLocation.own.hub,
  ];
  let previous: FamilyRoute | undefined;
  for (const [index, room] of family.entries()) {
    if (room.annex !== index) throw new Error(`Missing predecessor for ${room.key}`);
    const location = locationFor(room, locations, mail);
    const path = previous
      ? [location.entry, location.elbow, ...previous.path.slice(1)]
      : [location.entry, location.elbow, ...suffix];
    const route: FamilyRoute = {
      ...location,
      path,
      ...(previous ? { predecessor: previous.elbow } : {}),
      relayRoom: room.rows.some((value) => relayMembers.has(value.row.id)),
      relayTraffic: false,
    };
    routes.set(room, route);
    previous = route;
  }
  let relayTraffic = false;
  for (const room of family.slice().reverse()) {
    const route = required(routes, room);
    relayTraffic ||= route.relayRoom;
    route.relayTraffic = relayTraffic;
  }
  return routes;
}
function buildRoom(input: { room: Room; route: FamilyRoute }) {
  const { room, route } = input,
    { rect, entry, elbow, join, predecessor, relayRoom } = route;
  // A room holding any agent the relay carries (published by its bus, or a shadow ship's roster) lays its walkways in
  // the relay's colour all the way to its mailroom: those agents' mail can continue onto the relay highway.
  const sections = sectionsFor(room, rect),
    helpers = roomCrew(room, rect, sections);
  const platform: Platform = {
    key: room.key,
    projectId: room.projectId,
    name: room.name,
    annex: room.annex,
    accent: room.accent,
    rect,
    sections,
    ...(room.host ? { host: room.host } : {}),
    ...(relayRoom ? { relay: true } : {}),
    decorationRegions: DECORATION.map((value) => ({
      ...value,
      rect: { ...value.rect, x: rect.x + value.rect.x, y: rect.y + value.rect.y },
    })),
    entry: { point: entry, edge: "front-y" },
    sign: pointAt(rect, ROOM.platformSignX, 0, ROOM.signHeight),
    helperStations: helpers.stations,
    quarters: {
      rect: { ...ROOM.quarters, x: rect.x + ROOM.quarters.x, y: rect.y + ROOM.quarters.y },
      entry: pointAt(rect, ROOM.quarters.entryX, ROOM.quarters.entryY),
    },
  };
  const walkways = [
    { ...strip(entry, elbow, "connector"), ...(relayRoom ? { relay: true } : {}) },
    {
      ...strip(elbow, predecessor ?? join, predecessor ? "annex-link" : "connector"),
      ...(predecessor ? { accent: room.accent } : {}),
      ...(route.relayTraffic ? { relay: true } : {}),
    },
  ].map((value) => onHost(value, room.host));
  return {
    platform,
    workers: rootWorkers(helpers.roots, rect, sections, route).concat(helpers.workers),
    helperOverflow: helpers.helperOverflow,
    walkways,
    route,
  };
}
export function populateRooms(
  rooms: SceneRooms,
  locations: ShipLocations,
  mail: Mailroom,
  relayMembers: NonNullable<BuildOptions["relayMembers"]>,
) {
  const platforms: Platform[] = [],
    walkways: Walkway[] = [{ kind: "observatory-link", rect: { x: 11, y: -4, w: 2, h: 4 } }],
    workers: Worker[] = [],
    helperOverflow: Overflow[] = [];
  const banks = new Map<string | number, Bank>();
  const routes = new Map(
    familiesFor(rooms).flatMap((family) =>
      Array.from(routesForFamily(family, locations, mail, relayMembers)),
    ),
  );
  for (const room of rooms) {
    const result = buildRoom({ room, route: required(routes, room) });
    const { route } = result,
      { bankKey, spineX, own, join } = route;
    if (!banks.has(bankKey))
      banks.set(bankKey, {
        x: spineX,
        host: room.host || null,
        dock: own.hub,
        ys: [],
        relay: false,
      });
    const bank = required(banks, bankKey);
    if (room.annex === 0) bank.ys.push(join.y);
    if (route.relayTraffic) bank.relay = true;
    platforms.push(result.platform);
    walkways.push(...result.walkways);
    workers.push(...result.workers);
    helperOverflow.push(...result.helperOverflow);
  }
  return { platforms, walkways, workers, helperOverflow, banks };
}
export type RoomsGeometry = ReturnType<typeof populateRooms>;
