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
const HULL = { remoteMargin: 2, linkX: 12 };
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
  ships.push({ id: null, local: true, health: extras.localHealth || "available", rect: flagship });
  let above = flagship;
  for (const host of remoteHosts) {
    const ship = remoteShip(host, required(mailrooms, host.id), geometry),
      { rect, health } = ship;
    ships.push(ship);
    // Observation link: the hub's ssh stream to this host, hull to hull across the gap. Its state is the stream's
    // real health, never the config; it is telemetry, not a corridor or a mail path. A shadow ship is not observed.
    if (!host.shadow) {
      links.push({
        host: host.id,
        health,
        from: { x: HULL.linkX, y: above.y + above.h },
        to: { x: HULL.linkX, y: rect.y },
      });
      above = rect;
    }
  }
  return { ships, links };
}
