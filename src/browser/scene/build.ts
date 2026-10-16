import { projectedBounds } from "./geometry.js";
import { locateShips, mailroomAt } from "./site.js";
import { observatoryFor } from "./observatory.js";
import { populateRooms } from "./rooms.js";
import { finishCrew } from "./crew-topology.js";
import { buildHulls } from "./hulls.js";
import { buildHighways } from "./highways.js";
import { revisionFor } from "./revision.js";
import type { SceneRooms, BuildOptions, Scene, Host, Extent } from "./types.js";
export function build(rooms: SceneRooms, page: number, extras: BuildOptions = {}): Scene {
  const locations = locateShips(rooms, extras);
  const mail = mailroomAt(0);
  const relayMembers =
    extras.relayMembers instanceof Map ? extras.relayMembers : new Map<string, { host?: Host }>();
  const geometry = populateRooms(rooms, locations, mail, relayMembers);
  const { platforms, walkways, workers, helperOverflow } = geometry;
  const observatory = finishCrew(geometry, mail, observatoryFor(), extras);
  const { ships, links } = buildHulls({ locations, geometry, mail, observatory, extras });
  const relays = buildHighways({ locations, geometry, mail, observatory, extras, relayMembers });
  const extents = [
    mail.rect,
    ...platforms.map((p) => p.rect),
    ...walkways.map((w) => w.rect),
    ...ships.map((ship) => ship.rect),
  ]
    .map((rect): Extent => ({ rect }))
    .concat(observatory.extents);
  const bounds = projectedBounds(extents);
  const revision = revisionFor({ page, observatory, rooms, ships, relays, walkways, workers });
  return {
    page,
    revision,
    platforms,
    walkways,
    workers,
    helperOverflow,
    observatory,
    mail,
    bounds,
    ...(ships.length > 0 ? { ships, links } : {}),
    ...(relays.length > 0 ? { relays } : {}),
  };
}
