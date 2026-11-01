import { element } from "../model/types.js";
import { longestSegmentMidpoint } from "./geometry.js";
import type { ObservationLink, SceneRelay, Point } from "./types.js";
const WIRE = { offset: 1.6, roomTail: 3, junctionGap: 3 };
const alongside = (point: Point) => ({ x: point.x - WIRE.offset, y: point.y - WIRE.offset, z: 0 });

// SSH stays end-to-end. Its cable follows the tunnel edges and bypasses the external relay room.
export function observationLinks(
  links: ObservationLink[],
  relays: SceneRelay[],
): ObservationLink[] {
  return links.map((link) => {
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
    const x = relay.mail.rect.x - WIRE.junctionGap;
    const path = [...start, { x, y: a.y }, { x, y: b.y }, ...end].map(alongside);
    return {
      ...link,
      path,
      from: element(path, 0),
      to: element(path, path.length - 1),
      label: alongside(longestSegmentMidpoint(end)),
    };
  });
}
