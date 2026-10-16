import { required } from "../model/types.js";
import type { Rect, SceneRooms, BuildOptions, Host, Mailroom } from "./types.js";
/* Remote ships sit in a line below the flagship (this machine), with a clear gap between hulls. llm-bus is per host,
   so each remote ship has its OWN mailroom (same furniture as the flagship's) on its top edge, with its rooms flanking
   it and a short spine down from it; that host's crew and couriers stay inside its own ship. Nothing physical joins
   the ships: an observation link (the hub's ssh stream, not a mail path) spans the gap. Cross-machine mail exists only
   through an llm-bus relay, drawn from each bus's own relay binding (see relayNetworks below), never from config. */
const SHIP_GAP_Y = 8,
  HULL_MARGIN = 3,
  REMOTE_MARGIN = 2;
// `dx` shifts a whole ship sideways: zero in the column of observed ships, positive on a shadow ship docked beside one.
export const mailroomAt = (top: number, dx = 0) => ({
  rect: { x: dx, y: top, w: SITE.mailWidth, h: SITE.mailHeight },
  hub: { x: dx + SITE.hubX, y: top + SITE.hubY, z: 0 },
  tower: { x: dx + SITE.towerX, y: top + 1, w: SITE.towerWidth, h: SITE.towerHeight },
  pads: SITE.pads.map((x) => ({ x: dx + x, y: top + SITE.padY, z: 0 })),
  pod: [
    { x: dx + SITE.podX, y: top + SITE.padY, z: 0 },
    { x: dx + SITE.podX, y: top + SITE.hubY, z: 0 },
    { x: dx + SITE.hubX, y: top + SITE.hubY, z: 0 },
  ],
  chute: [
    { x: dx + SITE.chuteX, y: top + SITE.padY, z: 0 },
    { x: dx + SITE.chuteX, y: top + SITE.hubY, z: 0 },
    { x: dx + SITE.hubX, y: top + SITE.hubY, z: 0 },
  ],
});
export const remoteRoomRect = (top: number, slot: number, dx = 0) => ({
  x: dx + (slot % SITE.banks ? SITE.remoteOddX : SITE.remoteEvenX),
  y: top + SITE.rowSpacing * Math.floor(slot / SITE.banks),
  w: SITE.roomWidth,
  h: SITE.roomHeight,
});
const SHADOW_GAP = 14,
  REMOTE_LEFT = -24,
  REMOTE_RIGHT = 38;
export const hullAround = (rects: readonly Rect[], margin = HULL_MARGIN) => {
  const minX = Math.min(...rects.map((r) => r.x)),
    minY = Math.min(...rects.map((r) => r.y));
  const maxX = Math.max(...rects.map((r) => r.x + r.w)),
    maxY = Math.max(...rects.map((r) => r.y + r.h));
  return {
    x: minX - margin,
    y: minY - margin,
    w: maxX - minX + SITE.sides * margin,
    h: maxY - minY + SITE.sides * margin,
  };
};
const SITE = {
  oddY: -42,
  evenY: -48,
  rowSpacing: 32,
  slots: 8,
  banks: 2,
  localRight: 47,
  roomHullBottom: 29,
  mailWidth: 14,
  mailHeight: 12,
  hubX: 7,
  hubY: 6,
  towerX: 5,
  towerWidth: 4,
  towerHeight: 3,
  pads: [4, 7, 10],
  padY: 9,
  podX: 11,
  chuteX: 2,
  remoteOddX: 16,
  remoteEvenX: -22,
  roomWidth: 20,
  roomHeight: 26,
  sides: 2,
};
export function roomY(bank: number, index: number) {
  return (bank ? SITE.oddY : SITE.evenY) + SITE.rowSpacing * index;
}
export function locateShips(rooms: SceneRooms, extras: BuildOptions) {
  // Ships appear only when remote hosts are configured; a single-host station is laid out exactly as before.
  const remoteHosts = Array.isArray(extras.hosts) ? extras.hosts.map((host) => ({ ...host })) : [];
  const shipIndex = (host: string) => {
    let index = remoteHosts.findIndex((value) => value.id === host);
    if (index < 0) {
      remoteHosts.push({ id: host, health: "unavailable" });
      index = remoteHosts.length - 1;
    }
    return index;
  };
  for (const room of rooms) if (room.host) shipIndex(room.host);
  // Ship tops: below the flagship hull's bottom edge (its lowest connector), then below each remote hull in turn.
  const rowTop = (room: SceneRooms[number]) => {
    const slot = room.slot % SITE.slots;
    return roomY(slot % SITE.banks, Math.floor(slot / SITE.banks));
  };
  let cursor =
    Math.max(
      SITE.mailHeight,
      ...rooms.filter((room) => !room.host).map((room) => rowTop(room) + SITE.roomHullBottom),
    ) + HULL_MARGIN;
  const tops = new Map<string, number>(),
    mailrooms = new Map<string, Mailroom>(),
    dxs = new Map<string, number>();
  for (const host of remoteHosts.filter((host) => !host.shadow)) {
    const top = cursor + SHIP_GAP_Y + REMOTE_MARGIN,
      own = rooms.filter((room) => room.host === host.id);
    tops.set(host.id, top);
    mailrooms.set(host.id, mailroomAt(top));
    dxs.set(host.id, 0);
    cursor =
      Math.max(
        top + SITE.mailHeight,
        ...own.map((room) => remoteRoomRect(top, room.slot % SITE.slots).y + SITE.roomHullBottom),
      ) + REMOTE_MARGIN;
  }
  dockShadows(rooms, { remoteHosts, tops, mailrooms, dxs });

  return { remoteHosts, tops, mailrooms, dxs };
}
export type ShipLocations = ReturnType<typeof locateShips>;

function dockShadows(rooms: SceneRooms, locations: ShipLocations) {
  const { remoteHosts, tops, mailrooms, dxs } = locations;
  /* A shadow ship (an unobserved machine on a relay) docks beside the observed ship it is linked to, level with that
     ship's mailroom, so the column of observed ships and their ssh links never change; several shadows line up east. */
  const localRight = Math.max(
      SITE.localRight,
      ...rooms
        .filter((room) => !room.host)
        .map((room) => ((room.slot % SITE.slots) % SITE.banks ? SITE.localRight : 0)),
    ),
    eastOf = new Map<Host, number>();
  for (const host of remoteHosts.filter((host) => host.shadow)) {
    const member =
      host.member !== undefined && (host.member === null || tops.has(host.member))
        ? host.member
        : null;
    const right = eastOf.get(member) ?? (member === null ? localRight : REMOTE_RIGHT),
      dx = right + SHADOW_GAP - REMOTE_LEFT,
      top = member === null ? 0 : required(tops, member);
    tops.set(host.id, top);
    dxs.set(host.id, dx);
    mailrooms.set(host.id, mailroomAt(top, dx));
    eastOf.set(member, dx + REMOTE_RIGHT);
  }
}
