import type { SceneRooms, Scene } from "./types.js";
export function revisionFor(input: {
  page: number;
  observatory: Scene["observatory"];
  rooms: SceneRooms;
  ships: NonNullable<Scene["ships"]>;
  relays: NonNullable<Scene["relays"]>;
  walkways: Scene["walkways"];
  workers: Scene["workers"];
}) {
  const { page, observatory, rooms, ships, relays, walkways, workers } = input;
  return JSON.stringify([
    page,
    observatory.extents,
    observatory.overseer || null,
    rooms
      .map((r) => [
        r.key,
        r.slot,
        r.blocks.map((b) => [b.section || b.repo, b.label, b.checkoutKind]),
      ])
      .sort(),
    ...(ships.length > 0 ? [ships.map((ship) => [ship.id, ship.health, ship.rect])] : []),
    ...(relays.length > 0
      ? [
          relays.map((relay) => [
            relay.key,
            relay.links.map((link) => [link.from, link.to, link.verified]),
          ]),
        ]
      : []),
    walkways
      .filter((walkway) => walkway.relay)
      .map((walkway) => [walkway.kind, walkway.rect.x, walkway.rect.y]),
    workers.map((w) => [w.id, w.kind, w.parentId, w.chair.x, w.chair.y]).sort(),
  ]);
}
