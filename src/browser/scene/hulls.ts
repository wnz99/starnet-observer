import { hullAround } from "./site.js";
import { required } from "../model/types.js";
import type { ShipLocations } from "./site.js";
import type { RoomsGeometry } from "./rooms.js";
import type {
  BuildOptions,
  Mailroom,
  Observatory,
  Ship,
  ObservationLink,
  RemoteHost,
} from "./types.js";
const HULL = {
  remoteMargin: 2,
  localExit: 19,
  exitGap: 2,
  remoteApproach: 10,
  half: 2,
  laneGap: 3,
};
interface HullInput {
  locations: ShipLocations;
  geometry: RoomsGeometry;
  mail: Mailroom;
  observatory: Observatory;
  extras: BuildOptions;
}
function remoteShip(host: RemoteHost, own: Mailroom, geometry: RoomsGeometry): Ship {
  const { platforms, walkways } = geometry;
  const parts = [
    own.rect,
    ...platforms.filter((p) => p.host === host.id).map((p) => p.rect),
    ...walkways.filter((w) => w.host === host.id).map((w) => w.rect),
  ];
  return {
    id: host.id,
    local: false,
    health: host.health || "unavailable",
    observedAt: host.observedAt ?? null,
    reason: host.reason || null,
    agents: host.agents ?? 0,
    mail: own,
    rect: hullAround(parts, HULL.remoteMargin),
    ...(host.shadow
      ? { shadow: true, machine: host.machine, relay: host.relay, lastSeen: host.lastSeen ?? null }
      : {}),
  };
}
export function buildHulls(input: HullInput) {
  const { locations, geometry, mail, observatory, extras } = input,
    { remoteHosts, mailrooms } = locations,
    { platforms, walkways } = geometry;
  // Hulls: one per host when remotes exist. The flagship wraps this machine's whole station; a remote ship wraps its
  // mailroom and rooms, or just its mailroom when the host has no agents (or has not been reached yet).
  const ships: Ship[] = [],
    links: ObservationLink[] = [];
  if (remoteHosts.length === 0) return { ships, links };
  const flagship = hullAround([
    mail.rect,
    observatory.rect,
    ...platforms.filter((p) => !p.host).map((p) => p.rect),
    ...walkways.filter((w) => !w.host).map((w) => w.rect),
  ]);
  ships.push({
    id: null,
    local: true,
    health: extras.localHealth || "available",
    rect: flagship,
  });
  for (const host of remoteHosts) {
    const ship = remoteShip(host, required(mailrooms, host.id), geometry),
      { health } = ship;
    ships.push(ship);
    // Each SSH stream originates on this machine. Shadows have no observation stream.
    if (!host.shadow) {
      const from = mail.hub,
        to = required(mailrooms, host.id).hub;
      links.push({ host: host.id, health, from, to, path: [], label: from });
    }
  }
  return {
    ships,
    links: routeLinks(ships, links, flagship.y + flagship.h + HULL.exitGap),
  };
}

function routeLinks(ships: Ship[], links: ObservationLink[], exit: number) {
  const right = Math.max(...ships.map((ship) => ship.rect.x + ship.rect.w));
  return links.map((link, index) => {
    const lane = right + HULL.laneGap * (index + 1);
    const approach = link.to.y - HULL.remoteApproach;
    return {
      ...link,
      label: { x: lane, y: (exit + approach) / HULL.half },
      path: [
        link.from,
        { x: HULL.localExit, y: link.from.y },
        { x: HULL.localExit, y: exit },
        { x: lane, y: exit },
        { x: lane, y: approach },
        { x: link.to.x, y: approach },
        link.to,
      ],
    };
  });
}
