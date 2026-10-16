import { strip } from "./geometry.js";
import { element } from "../model/types.js";
import type { ShipLocations } from "./site.js";
import type { RoomsGeometry } from "./rooms.js";
import type { BuildOptions, Mailroom, Observatory, SceneRelay, RelayLink, Host } from "./types.js";
interface HighwayInput {
  locations: ShipLocations;
  geometry: RoomsGeometry;
  mail: Mailroom;
  observatory: Observatory;
  extras: BuildOptions;
  relayMembers: NonNullable<BuildOptions["relayMembers"]>;
}
const ROUTE = { laneGap: 3, localExit: 5, stripOffset: 2 };
/* Relay highways: llm-bus relays mail mailroom to mailroom, so each network joins its members' mailrooms to each
     other and to every shadow ship's mailroom with a ground walkway routed around the floors. A member-to-member highway
     runs down the column's centre line (between the room banks); a highway to a shadow ship climbs to a lane just
     north of both ships' top rows, crosses, and comes down into the shadow mailroom. Couriers carrying relayed mail follow
     it. A highway's state is its observed member's (active, quiet or unknown); it is 'verified' only once a relayed
     message actually crossed it (delivered to, or received from, that machine), otherwise only the roster is seen. */
class Highways {
  constructor(private input: HighwayInput) {}
  private hubOf(host: Host) {
    const { mail, locations } = this.input;
    return host === null ? mail : (locations.mailrooms.get(host) ?? null);
  }
  private topsOf(host: Host) {
    const { mail, observatory, geometry } = this.input;
    return host === null
      ? [
          mail.rect.y,
          observatory.rect.y,
          ...geometry.platforms.filter((p) => !p.host).map((p) => p.rect.y),
        ]
      : [
          (this.hubOf(host) ?? mail).rect.y,
          ...geometry.platforms.filter((p) => p.host === host).map((p) => p.rect.y),
        ];
  }
  private highwayPath(from: Host, to: Host, shadow: boolean) {
    const A = this.hubOf(from) ?? this.input.mail,
      B = this.hubOf(to) ?? this.input.mail,
      up = A.rect.y <= B.rect.y;
    if (!shadow) {
      // Down the centre line between the room banks: front edge of the upper mailroom to the back edge of the lower one.
      const [top, bottom] = up ? ([A, B] as const) : ([B, A] as const),
        path = [
          top.hub,
          { x: top.hub.x, y: top.rect.y + top.rect.h, z: 0 },
          { x: bottom.hub.x, y: bottom.rect.y, z: 0 },
          bottom.hub,
        ];
      return {
        path: up ? path : path.slice().reverse(),
        strips: [[element(path, 1), element(path, ROUTE.stripOffset)]],
      };
    }
    const lane = Math.min(...this.topsOf(from), ...this.topsOf(to)) - ROUTE.laneGap;
    // This machine's mailroom is boxed in by the observatory to its north, so its highway leaves east to the gap
    // before the right-hand room bank and climbs there; a remote mailroom leaves straight off its back edge.
    const exit =
      from === null
        ? [
            { x: A.rect.x + A.rect.w, y: A.hub.y, z: 0 },
            { x: A.rect.x + A.rect.w + ROUTE.localExit, y: A.hub.y, z: 0 },
          ]
        : [{ x: A.hub.x, y: A.rect.y, z: 0 }];
    const climb = element(exit, exit.length - 1),
      path = [
        A.hub,
        ...exit,
        { x: climb.x, y: lane, z: 0 },
        { x: B.hub.x, y: lane, z: 0 },
        { x: B.hub.x, y: B.rect.y, z: 0 },
        B.hub,
      ];
    return {
      path,
      strips: path
        .slice(1, -ROUTE.stripOffset)
        .map((point, index) => [point, element(path, index + ROUTE.stripOffset)]),
    };
  }
  network(net: NonNullable<BuildOptions["relays"]>[number]): SceneRelay | null {
    const { geometry, relayMembers } = this.input;
    const members = net.members.filter((member) => this.hubOf(member.host)),
      shadows = (net.shadows || []).filter((shadow) => this.hubOf(shadow.host));
    if (members.length === 0) return null;
    const links: RelayLink[] = [];
    members.forEach((member, index) => {
      for (const other of [
        ...members
          .slice(index + 1)
          .map((value) => ({ host: value.host, machine: value.machine, shadow: false })),
        ...shadows.map((value) => ({ host: value.host, machine: value.machine, shadow: true })),
      ]) {
        const { path, strips } = this.highwayPath(member.host, other.host, other.shadow);
        const verified = (member.crossed || []).includes(other.machine);
        for (const segment of strips)
          geometry.walkways.push({
            ...strip(element(segment, 0), element(segment, 1), "relay-highway"),
            host: "relay",
            relay: verified ? "verified" : "unverified",
          });
        links.push({
          from: member.host,
          to: other.host,
          machine: other.machine,
          shadow: other.shadow,
          state: member.state,
          lastActivityAt: member.lastActivityAt,
          verified,
          path,
        });
      }
    });
    // Each highway counts the agents on the relay at its observed end.
    for (const link of links)
      link.carried = [...relayMembers.values()].filter(
        (member) => (member.host ?? null) === link.from,
      ).length;
    return {
      key: "relay:" + net.relay,
      relay: net.relay,
      members: members.map((member) => ({
        host: member.host,
        machine: member.machine,
        state: member.state,
        lastActivityAt: member.lastActivityAt,
      })),
      links,
    };
  }
}
export function buildHighways(input: HighwayInput) {
  const highways = new Highways(input);
  return (Array.isArray(input.extras.relays) ? input.extras.relays : []).flatMap((net) => {
    const value = highways.network(net);
    return value ? [value] : [];
  });
}
