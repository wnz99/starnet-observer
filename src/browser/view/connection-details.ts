import { toScreen, fromScreen } from "../scene/index.js";
import { contains } from "../scene/geometry.js";
import type { Camera, Host, Point, Scene } from "../scene/types.js";

const HIT_RADIUS = 6;
const RELAY_ACTIVITY: Record<string, string> = {
  active: "recent relay activity",
  quiet: "no recent relay activity",
};

export function connectionHostAt(scene: Scene, camera: Camera, point: Point): Host | undefined {
  const floor = fromScreen(point, camera);
  const shadow = scene.ships?.find((ship) => ship.shadow && contains(ship.rect, floor));
  if (shadow) return shadow.id;
  const paths = [
    ...(scene.links ?? []).map((link) => ({ host: link.host, path: link.path })),
    ...(scene.relays ?? []).flatMap((relay) => relay.spokes),
  ];
  let distance = HIT_RADIUS;
  let host: Host | undefined;
  for (const connection of paths)
    for (let index = 1; index < connection.path.length; index++) {
      const before = connection.path[index - 1],
        after = connection.path[index];
      if (!before || !after) continue;
      const next = segmentDistance(point, toScreen(before, camera), toScreen(after, camera));
      if (next < distance) {
        distance = next;
        host = connection.host;
      }
    }
  return host;
}

function segmentDistance(point: Point, from: Point, to: Point) {
  const dx = to.x - from.x,
    dy = to.y - from.y;
  const length = dx * dx + dy * dy;
  const fraction =
    length === 0
      ? 0
      : Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / length));
  return Math.hypot(point.x - from.x - fraction * dx, point.y - from.y - fraction * dy);
}

export function connectionDetails(scene: Scene, host: Host) {
  const ship = scene.ships?.find((ship) => ship.id === host);
  const observation = observationNote(scene, host);
  const notes = (scene.relays ?? []).flatMap((relay) => {
    const spoke = relay.spokes.find((spoke) => spoke.host === host);
    if (!spoke) return [];
    const state = RELAY_ACTIVITY[spoke.state] ?? "bus unreadable";
    return [`${relay.relay}: ${state}; ${spoke.verified ? "mail has crossed" : "roster only"}`];
  });
  return `${ship?.machine ?? host ?? "This machine"} · SSH ${observation}${notes.length > 0 ? " · " + notes.join(" · ") : ""}`;
}

function observationNote(scene: Scene, host: Host) {
  const ship = scene.ships?.find((ship) => ship.id === host);
  const wire = scene.links?.find((wire) => wire.host === host);
  return ship?.shadow
    ? "not observed"
    : wire?.health === "available"
      ? "observing"
      : (wire?.health ?? (host === null ? "local" : "unavailable"));
}
