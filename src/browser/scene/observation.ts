import { element } from "../model/types.js";
import { longestSegmentMidpoint } from "./geometry.js";
import { tunnelPath } from "./tunnel-path.js";
import type { ObservationLink, SceneRelay, Point } from "./types.js";
const WIRE = { offset: 1.2, laneWidth: 1.2, roomTail: 3, clearance: 3, sides: 2 };

// SSH stays end-to-end. Its cable follows the tunnel edges and bypasses the external relay room.
export function observationLinks(
  links: ObservationLink[],
  relays: SceneRelay[],
): ObservationLink[] {
  return links.map((link, index) => {
    const offset = WIRE.offset + (WIRE.laneWidth * index) / links.length;
    const alongside = (point: Point) => ({ x: point.x + offset, y: point.y + offset, z: 0 });
    const relay = relays.find(
      (network) =>
        network.spokes.some((spoke) => spoke.host === null) &&
        network.spokes.some((spoke) => spoke.host === link.host),
    );
    const local = relay?.spokes.find((spoke) => spoke.host === null);
    const remote = relay?.spokes.find((spoke) => spoke.host === link.host);
    if (!relay || !local || !remote) return link;
    const start = local.path.slice(0, -WIRE.roomTail),
      end = remote.path.slice(0, -WIRE.roomTail).reverse();
    const a = element(start, start.length - 1),
      b = element(end, 0);
    const obstacles = relays.map(({ mail }) => ({
      x: mail.rect.x - WIRE.clearance,
      y: mail.rect.y - WIRE.clearance,
      w: mail.rect.w + WIRE.clearance * WIRE.sides,
      h: mail.rect.h + WIRE.clearance * WIRE.sides,
    }));
    const bypass = tunnelPath(a, b, obstacles);
    const path = [...start, ...bypass.slice(1, -1), ...end].map(alongside);
    return {
      ...link,
      path,
      from: element(path, 0),
      to: element(path, path.length - 1),
      label: alongside(longestSegmentMidpoint(end)),
    };
  });
}
