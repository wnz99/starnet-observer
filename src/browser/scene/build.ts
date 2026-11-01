import { projectedBounds } from "./geometry.js";
import { locateShips, mailroomAt } from "./site.js";
import { observatoryFor } from "./observatory.js";
import { populateRooms } from "./rooms.js";
import { finishCrew } from "./crew-topology.js";
import { buildHulls } from "./hulls.js";
import { buildHighways } from "./highways.js";
import { revisionFor } from "./revision.js";
import { observationLinks } from "./observation.js";
import type { SceneRooms, BuildOptions, Scene, Host, Extent } from "./types.js";
export function build(rooms: SceneRooms, page: number, extras: BuildOptions = {}): Scene {
  const locations = locateShips(rooms, extras);
  const mail = mailroomAt(0);
  const relayMembers =
    extras.relayMembers instanceof Map ? extras.relayMembers : new Map<string, { host?: Host }>();
  const geometry = populateRooms(rooms, locations, mail, relayMembers);
  const { platforms, walkways, workers, helperOverflow } = geometry;
  const observatory = finishCrew(geometry, mail, observatoryFor(), extras);
  const { ships, links: plainLinks } = buildHulls({
    locations,
    geometry,
    mail,
    observatory,
    extras,
  });
  const relays = buildHighways({
    locations,
    geometry,
    mail,
    observatory,
    extras,
    relayMembers,
    ships,
  });
  const links = observationLinks(plainLinks, relays);
  const revision = revisionFor({
    page,
    observatory,
    rooms,
    platforms,
    ships,
    relays,
    walkways,
    workers,
  });
  return {
    page,
    revision,
    platforms,
    walkways,
    workers,
    helperOverflow,
    observatory,
    mail,
    bounds: sceneBounds({ mail, platforms, walkways, ships, links, observatory, relays }),
    ...(ships.length > 0 ? { ships, links } : {}),
    ...(relays.length > 0 ? { relays } : {}),
  };
}

function sceneBounds(
  input: Pick<
    Scene,
    "mail" | "platforms" | "walkways" | "ships" | "links" | "observatory" | "relays"
  >,
) {
  const extents = [
    input.mail.rect,
    ...input.platforms.map((p) => p.rect),
    ...input.walkways.map((walkway) => walkway.rect),
    ...(input.ships ?? []).map((ship) => ship.rect),
    ...(input.relays ?? []).map((relay) => relay.mail.rect),
    ...(input.links ?? []).flatMap((link) => link.path.map((point) => ({ ...point, w: 0, h: 0 }))),
  ]
    .map((rect): Extent => ({ rect }))
    .concat(input.observatory.extents);
  return projectedBounds(extents);
}
