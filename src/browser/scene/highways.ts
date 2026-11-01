import { strip } from "./geometry.js";
import { mailroomAt } from "./site.js";
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
  clearance: 6,
  relaySpacing: 24,
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
  private rightEdge() {
    const { mail, observatory, geometry, locations } = this.input;
    return (
      Math.max(
        ...[
          mail.rect,
          observatory.rect,
          ...geometry.platforms.map((platform) => platform.rect),
          ...[...locations.mailrooms.values()].map((value) => value.rect),
        ].map((rect) => rect.x + rect.w),
      ) + ROUTE.clearance
    );
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
  private relayMail(index: number) {
    const { mail, locations } = this.input;
    const mailrooms = [mail, ...locations.mailrooms.values()];
    const top = mailrooms.reduce((sum, mail) => sum + mail.rect.y, 0) / mailrooms.length;
    return mailroomAt(top + index * ROUTE.relaySpacing, this.rightEdge() + ROUTE.relaySpacing);
  }
  private obstacles(host: Host) {
    const { observatory, geometry, mail, locations, ships, extras } = this.input;
    return [
      observatory.rect,
      ...geometry.platforms.map((platform) => platform.rect),
      mail.rect,
      ...[...locations.mailrooms.values()].map((value) => value.rect),
      ...ships.filter((ship) => ship.id !== host).map((ship) => ship.rect),
      ...(extras.relays ?? []).map((_net, index) => this.relayMail(index).rect),
    ].map((rect) => ({
      x: rect.x - ROUTE.margin,
      y: rect.y - ROUTE.margin,
      w: rect.w + ROUTE.margin * ROUTE.sides,
      h: rect.h + ROUTE.margin * ROUTE.sides,
    }));
  }
  private spoke(
    member: Pick<RelaySpoke, "host" | "machine">,
    index: number,
    count: number,
    hub: Mailroom,
  ): RelaySpoke {
    const { host, machine } = member;
    const exit = this.exit(host, requiredMail(this.hubOf(host)));
    const portY = hub.rect.y + (hub.rect.h * (index + 1)) / (count + 1);
    const approach = { x: hub.rect.x - ROUTE.margin, y: portY };
    const routed = tunnelPath(element(exit, exit.length - 1), approach, this.obstacles(host));
    const path = [
      ...exit,
      ...routed.slice(1),
      { x: hub.rect.x, y: portY },
      { x: hub.hub.x, y: portY },
      hub.hub,
    ];
    return {
      host,
      machine,
      state: "unknown",
      lastActivityAt: null,
      verified: false,
      carried: [...this.input.relayMembers.values()].filter(
        (member) => (member.host ?? null) === host,
      ).length,
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
      geometry.walkways.push({
        ...strip(from, to, "relay-highway"),
        host: "relay",
        relay: spoke.verified ? "verified" : "unverified",
      });
    }
  }
  network(net: Network, index: number): SceneRelay | null {
    const members = net.members.filter((member) => this.hubOf(member.host));
    const shadows = (net.shadows ?? []).filter((shadow) => this.hubOf(shadow.host));
    if (members.length === 0) return null;
    const participants = [...members, ...shadows];
    const mail = this.relayMail(index);
    const spokes = participants.map((member, spokeIndex) => {
      const spoke = this.spoke(member, spokeIndex, participants.length, mail);
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
      links: courierLinks(members, shadows, spokes, mail.hub),
    };
  }
}
function requiredMail(mail: Mailroom | null): Mailroom {
  if (!mail) throw new Error("Relay participant has no mailroom");
  return mail;
}
function courierLinks(
  members: Network["members"],
  shadows: NonNullable<Network["shadows"]>,
  spokes: RelaySpoke[],
  relayHub: Point,
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
      state: member.state,
      lastActivityAt: member.lastActivityAt,
      verified: (member.crossed ?? []).includes(other.machine),
      relayHub,
      path: [
        ...required(byHost, member.host).path,
        ...required(byHost, other.host).path.slice().reverse().slice(1),
      ],
    })),
  );
}
export function buildHighways(input: HighwayInput) {
  const highways = new Highways(input);
  return (input.extras.relays ?? []).flatMap((net, index) => {
    const value = highways.network(net, index);
    return value ? [value] : [];
  });
}
