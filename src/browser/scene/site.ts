import { required } from "../model/types.js";
import { roomRect } from "./room-placement.js";
import { observatoryFor } from "./observatory.js";
import type { Rect, SceneRooms, BuildOptions, Mailroom } from "./types.js";
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
  localLeft: -33,
  localRight: 47,
  connectorDepth: 3,
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
  sides: 2,
};
function envelope(rooms: SceneRooms, host: string | null, top = 0, dx = 0) {
  const parts = [
    mailroomAt(top, dx).rect,
    ...rooms
      .filter((room) => (room.host || null) === host)
      .map((room) => {
        const rect = roomRect(room, top, dx);
        return { ...rect, h: rect.h + SITE.connectorDepth };
      }),
    ...(host === null ? [observatoryFor().rect] : []),
  ];
  const hull = hullAround(parts, host === null ? HULL_MARGIN : REMOTE_MARGIN);
  const left = Math.min(hull.x, dx + (host === null ? SITE.localLeft : REMOTE_LEFT)),
    right = Math.max(hull.x + hull.w, dx + (host === null ? SITE.localRight : REMOTE_RIGHT));
  return { ...hull, x: left, w: right - left };
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
  const local = envelope(rooms, null);
  let cursor = local.y + local.h;
  const tops = new Map<string, number>(),
    mailrooms = new Map<string, Mailroom>(),
    dxs = new Map<string, number>();
  for (const host of remoteHosts.filter((host) => !host.shadow)) {
    const top = cursor + SHIP_GAP_Y + REMOTE_MARGIN;
    tops.set(host.id, top);
    mailrooms.set(host.id, mailroomAt(top));
    dxs.set(host.id, 0);
    const hull = envelope(rooms, host.id, top);
    cursor = hull.y + hull.h;
  }
  dockShadows(rooms, { remoteHosts, tops, mailrooms, dxs });

  return { remoteHosts, tops, mailrooms, dxs };
}
export type ShipLocations = ReturnType<typeof locateShips>;

function dockShadows(rooms: SceneRooms, locations: ShipLocations) {
  const { remoteHosts, tops, mailrooms, dxs } = locations;
  /* A shadow ship (an unobserved machine on a relay) docks beside the observed ship it is linked to, level with that
     ship's mailroom, so the column of observed ships and their ssh links never change; several shadows line up east. */
  const occupied = [
    envelope(rooms, null),
    ...remoteHosts
      .filter((host) => !host.shadow)
      .map((host) => envelope(rooms, host.id, required(tops, host.id))),
  ];
  for (const host of remoteHosts.filter((host) => host.shadow)) {
    const member =
      host.member !== undefined && (host.member === null || tops.has(host.member))
        ? host.member
        : null;
    const top = member === null ? 0 : required(tops, member),
      own = envelope(rooms, host.id, top);
    const overlaps = occupied.filter(
      (other) => own.y < other.y + other.h && own.y + own.h > other.y,
    );
    const dx = Math.max(0, ...overlaps.map((other) => other.x + other.w + SHADOW_GAP - own.x));
    tops.set(host.id, top);
    dxs.set(host.id, dx);
    mailrooms.set(host.id, mailroomAt(top, dx));
    occupied.push({ ...own, x: own.x + dx });
  }
}
