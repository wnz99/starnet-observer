import { strip } from "./geometry.js";
import { tunnelPath } from "./tunnel-path.js";
import { element, required } from "../model/types.js";
import type { ShipLocations } from "./site.js";
import type { RoomsGeometry } from "./rooms.js";
import type {
  BuildOptions,
  Mailroom,
  Observatory,
  SceneRelay,
  RelayLink,
  RelaySpoke,
  Host,
  Point,
  Ship,
} from "./types.js";
interface HighwayInput {
  locations: ShipLocations;
  geometry: RoomsGeometry;
  mail: Mailroom;
  observatory: Observatory;
  extras: BuildOptions;
  relayMembers: NonNullable<BuildOptions["relayMembers"]>;
  ships: Ship[];
}
type Network = NonNullable<BuildOptions["relays"]>[number];
const ROUTE = {
  laneGap: 3,
  localExit: 5,
  insideHub: 3,
  margin: 3,
  sides: 2,
};
// A relay is an external mailroom. Each machine owns one spoke to it; pairwise courier routes join there.
class Highways {
  constructor(private input: HighwayInput) {}
  private hubOf(host: Host) {
    const { mail, locations } = this.input;
    return host === null ? mail : (locations.mailrooms.get(host) ?? null);
  }
  private exit(host: Host, mail: Mailroom): Point[] {
    if (host !== null)
      return [
        mail.hub,
        { x: mail.hub.x, y: mail.rect.y },
        { x: mail.hub.x, y: mail.rect.y - ROUTE.laneGap },
      ];
    const x = mail.rect.x + mail.rect.w + ROUTE.localExit;
    return [mail.hub, { x: mail.rect.x + mail.rect.w, y: mail.hub.y }, { x, y: mail.hub.y }];
  }
  private obstacles(host: Host) {
    const { observatory, geometry, mail, locations, ships } = this.input;
    return [
      observatory.rect,
      ...geometry.platforms.map((platform) => platform.rect),
      mail.rect,
      ...[...locations.mailrooms.values()].map((value) => value.rect),
      ...ships.filter((ship) => ship.id !== host).map((ship) => ship.rect),
      ...[...locations.relayMailrooms.values()].map((relay) => relay.rect),
    ].map((rect) => ({
      x: rect.x - ROUTE.margin,
      y: rect.y - ROUTE.margin,
      w: rect.w + ROUTE.margin * ROUTE.sides,
      h: rect.h + ROUTE.margin * ROUTE.sides,
    }));
  }
  private spoke(member: Pick<RelaySpoke, "host" | "machine">, hub: Mailroom): RelaySpoke {
    const { host, machine } = member;
    const own = requiredMail(this.hubOf(host));
    const exit = this.exit(host, own);
    const port = { x: hub.hub.x, y: hub.rect.y + (host === null ? 0 : hub.rect.h) };
    const approach = { x: port.x, y: port.y + (host === null ? -ROUTE.margin : ROUTE.margin) };
    const junction = { x: own.hub.x, y: approach.y };
    const routed =
      host === null
        ? tunnelPath(element(exit, exit.length - 1), approach, this.obstacles(host))
        : [element(exit, exit.length - 1), junction, approach];
    const path = [...exit, ...routed.slice(1), port, { x: hub.hub.x, y: port.y }, hub.hub];
    return {
      host,
      machine,
      state: "unknown",
      lastActivityAt: null,
      verified: false,
      carried: [...this.input.relayMembers.values()].filter(
        (member) => (member.host ?? null) === host,
      ).length,
      ...(host === null ? {} : { junction }),
      path,
    };
  }
  private draw(spoke: RelaySpoke) {
    const { geometry } = this.input;
    const path = spoke.path;
    for (let index = 1; index < path.length - ROUTE.insideHub; index++) {
      const from = element(path, index),
        to = element(path, index + 1);
      if (from.x === to.x && from.y === to.y) continue;
      if (
        spoke.junction &&
        ((from.y === spoke.junction.y && to.y === spoke.junction.y) ||
          index === path.length - ROUTE.insideHub - 1)
      )
        continue;
      geometry.walkways.push({
        ...strip(from, to, "relay-highway"),
        host: "relay",
        relay: spoke.verified ? "verified" : "unverified",
      });
    }
  }
  network(net: Network): SceneRelay | null {
    const members = net.members.filter((member) => this.hubOf(member.host));
    const shadows = (net.shadows ?? []).filter((shadow) => this.hubOf(shadow.host));
    if (members.length === 0) return null;
    const participants = [...members, ...shadows];
    const { locations } = this.input;
    const mail = required(locations.relayMailrooms, net.relay);
    const spokes = participants.map((member) => {
      const spoke = this.spoke(member, mail);
      const observed = members.find((value) => value.host === member.host);
      return {
        ...spoke,
        state: observed?.state ?? "unknown",
        lastActivityAt: observed?.lastActivityAt ?? null,
        verified: observed
          ? (observed.crossed ?? []).length > 0
          : members.some((value) => (value.crossed ?? []).includes(member.machine)),
      };
    });
    spokes.forEach((spoke) => {
      this.draw(spoke);
    });
    this.drawSpine(spokes, mail);
    return {
      key: "relay:" + net.relay,
      relay: net.relay,
      mail,
      spokes,
      members: members.map(({ host, machine, state, lastActivityAt }) => ({
        host,
        machine,
        state,
        lastActivityAt,
      })),
      links: courierLinks(members, shadows, spokes),
    };
  }
  private drawSpine(spokes: RelaySpoke[], mail: Mailroom) {
    const { walkways } = this.input.geometry;
    const branches = spokes.filter((spoke) => spoke.junction);
    if (branches.length > 0) {
      const y = mail.rect.y + mail.rect.h + ROUTE.margin;
      const xs = [mail.hub.x, ...branches.map((spoke) => requiredJunction(spoke).x)];
      const verified = branches.some((spoke) => spoke.verified);
      for (const [from, to] of [
        [
          { x: Math.min(...xs), y },
          { x: Math.max(...xs), y },
        ],
        [
          { x: mail.hub.x, y },
          { x: mail.hub.x, y: mail.rect.y + mail.rect.h },
        ],
      ] as const)
        walkways.push({
          ...strip(from, to, "relay-highway"),
          host: "relay",
          relay: verified ? "verified" : "unverified",
        });
    }
  }
}
function requiredJunction(spoke: RelaySpoke): Point {
  if (!spoke.junction) throw new Error("Relay branch has no spine junction");
  return spoke.junction;
}
function requiredMail(mail: Mailroom | null): Mailroom {
  if (!mail) throw new Error("Relay participant has no mailroom");
  return mail;
}
function courierLinks(
  members: Network["members"],
  shadows: NonNullable<Network["shadows"]>,
  spokes: RelaySpoke[],
): RelayLink[] {
  const byHost = new Map(spokes.map((spoke) => [spoke.host, spoke]));
  return members.flatMap((member, index) =>
    [
      ...members.slice(index + 1).map((value) => ({ ...value, shadow: false })),
      ...shadows.map((value) => ({ ...value, shadow: true })),
    ].map((other) => ({
      from: member.host,
      to: other.host,
      machine: other.machine,
      shadow: other.shadow,
      verified: (member.crossed ?? []).includes(other.machine),
      path: [
        ...required(byHost, member.host).path,
        ...required(byHost, other.host).path.slice().reverse().slice(1),
      ],
    })),
  );
}
export function buildHighways(input: HighwayInput) {
  const highways = new Highways(input);
  return (input.extras.relays ?? []).flatMap((net) => {
    const value = highways.network(net);
    return value ? [value] : [];
  });
}
