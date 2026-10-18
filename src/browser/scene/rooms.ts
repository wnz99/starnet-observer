import { partitionsFor, pointAt, strip, onHost } from "./geometry.js";
import { element, required } from "../model/types.js";
import { roomY, remoteRoomRect } from "./site.js";
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
  slots: 8,
  banks: 2,
  rightX: 24,
  leftX: -30,
  width: 20,
  height: 26,
  spineX: 7,
  rightSpine: 19,
  leftSpine: -5,
  entryX: 10,
  entryY: 25,
  elbowY: 28,
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
    const rect = { x: 0, y: 0, w: ROOM.width, h: ROOM.height };
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
  const slot = room.slot % ROOM.slots,
    bank = slot % ROOM.banks,
    index = Math.floor(slot / ROOM.banks);
  const own = room.host ? required(locations.mailrooms, room.host) : mail;
  const rect = room.host
    ? remoteRoomRect(required(locations.tops, room.host), slot, locations.dxs.get(room.host) || 0)
    : { x: bank ? ROOM.rightX : ROOM.leftX, y: roomY(bank, index), w: ROOM.width, h: ROOM.height };
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
function buildRoom(input: {
  room: Room;
  locations: ShipLocations;
  mail: Mailroom;
  relayMembers: NonNullable<BuildOptions["relayMembers"]>;
}) {
  const { room, locations, mail, relayMembers } = input;
  const route = locationFor(room, locations, mail),
    { rect, entry, elbow, join } = route;
  // A room holding any agent the relay carries (published by its bus, or a shadow ship's roster) lays its walkways in
  // the relay's colour all the way to its mailroom: those agents' mail can continue onto the relay highway.
  const relayRoom = room.rows.some((value) => relayMembers.has(value.row.id));
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
  };
  const walkways = [strip(entry, elbow, "connector"), strip(elbow, join, "connector")].map(
    (value) => {
      const walkway = onHost(value, room.host);
      return relayRoom ? { ...walkway, relay: true } : walkway;
    },
  );
  return {
    platform,
    workers: rootWorkers(helpers.roots, rect, sections, route).concat(helpers.workers),
    helperOverflow: helpers.helperOverflow,
    walkways,
    route,
    relayRoom,
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
  for (const room of rooms) {
    const result = buildRoom({ room, locations, mail, relayMembers });
    const { route, relayRoom } = result,
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
    bank.ys.push(join.y);
    if (relayRoom) bank.relay = true;
    platforms.push(result.platform);
    walkways.push(...result.walkways);
    workers.push(...result.workers);
    helperOverflow.push(...result.helperOverflow);
  }
  return { platforms, walkways, workers, helperOverflow, banks };
}
export type RoomsGeometry = ReturnType<typeof populateRooms>;
