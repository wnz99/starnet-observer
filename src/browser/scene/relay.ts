/* llm-bus relay networks, from what each observed bus reports about its own binding (publicBus `remote`): one network
   per relay host. A member is an observed mailroom bound to it (host null = this machine). A shadow is a machine the
   relay's roster names that this observer does not watch: the page draws it as a ghosted ship of its own (see
   shadowRows), with one desk per agent the roster lists, in a room per shared repo. A member is 'active' when its bus
   saw relay activity (a relayed message or a peer's activity time) in the last 15 minutes, 'quiet' otherwise, and
   'unknown' when its bus is not currently readable: the cached roster is not proof that a bridge is running. */
import type { LayoutRow } from "../model/types.js";
import type { RelayNetwork, RelayMember, RelayShadow, PeerAgent } from "./types.js";
const RELAY_ACTIVE_MS = 15 * 60000;
const MAX_RELAYS = 4;
const MAX_SHADOWS = 6;
const PEER = /^peer_[a-f0-9]{24}$/;
const ACTIVE = "active";
type Peer = Omit<RelayShadow, "host">;
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}
function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}
function values(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
function finite(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function crossedMachines(bus: Record<string, unknown>) {
  return [
    ...new Set(
      values(bus.messages).flatMap((value) => {
        const relay = record(record(value).relay);
        const crossed =
          relay.direction === "in" ||
          ["delivered_local", "acknowledged"].includes(
            typeof relay.state === "string" ? relay.state : "",
          );
        return typeof relay.machine === "string" && crossed ? [relay.machine] : [];
      }),
    ),
  ];
}
function memberFor(host: string | null, bus: Record<string, unknown>, now: number): RelayMember {
  const remote = record(bus.remote);
  const last = finite(remote.lastActivityAt);
  let state = "quiet";
  if (bus.health !== "available") state = "unknown";
  else if (last !== null && now - last < RELAY_ACTIVE_MS) state = ACTIVE;
  return {
    host,
    machine: String(remote.machine),
    lastActivityAt: last,
    crossed: crossedMachines(bus),
    state,
  };
}
function mergeAgents(known: Peer | undefined, peer: Record<string, unknown>) {
  const list = new Map<string, PeerAgent>((known?.list ?? []).map((agent) => [agent.id, agent]));
  for (const value of values(peer.list)) {
    const agent = record(value);
    if (typeof agent.id !== "string" || !PEER.test(agent.id) || typeof agent.repo !== "string")
      continue;
    list.set(agent.id, {
      id: agent.id,
      provider: agent.provider,
      repo: agent.repo,
      lastSeen: finite(agent.lastSeen),
    });
  }
  return [...list.values()];
}
function mergePeer(known: Peer | undefined, peer: Record<string, unknown>, machine: string): Peer {
  const agents =
    typeof peer.agents === "number" && Number.isSafeInteger(peer.agents) ? peer.agents : 0;
  return {
    machine,
    agents: Math.max(known?.agents ?? 0, agents),
    repos: [
      ...new Set([
        ...(known?.repos ?? []),
        ...values(peer.repos).filter((repo): repo is string => typeof repo === "string"),
      ]),
    ].sort(),
    lastSeen: Math.max(known?.lastSeen ?? -Infinity, finite(peer.lastSeen) ?? -Infinity),
    list: mergeAgents(known, peer),
  };
}
class RelayRoster {
  readonly members: RelayMember[] = [];
  private readonly peers = new Map<string, Peer>();
  constructor(readonly relay: string) {}
  add(host: string | null, bus: Record<string, unknown>, now: number) {
    this.members.push(memberFor(host, bus, now));
    for (const value of values(record(bus.remote).peers)) {
      const peer = record(value);
      if (typeof peer.machine !== "string") continue;
      this.peers.set(peer.machine, mergePeer(this.peers.get(peer.machine), peer, peer.machine));
    }
  }
  snapshot(): RelayNetwork {
    const machines = new Set(this.members.map((member) => member.machine));
    const shadows = [...this.peers.values()]
      .filter((peer) => !machines.has(peer.machine))
      .map((peer) => ({
        ...peer,
        host: `relay:${peer.machine}`,
        lastSeen: finite(peer.lastSeen),
        list: peer.list
          .slice()
          .sort((a, b) => a.repo.localeCompare(b.repo) || a.id.localeCompare(b.id)),
      }))
      .sort((a, b) => b.agents - a.agents || a.machine.localeCompare(b.machine))
      .slice(0, MAX_SHADOWS);
    const members = this.members.slice().sort((a, b) => {
      if (a.host === null) return -1;
      if (b.host === null) return 1;
      return a.host.localeCompare(b.host);
    });
    return { relay: this.relay, members, shadows };
  }
}
export function relayNetworks(buses: Iterable<readonly [string | null, unknown]>, now: number) {
  const nets = new Map<string, RelayRoster>();
  for (const [host, value] of buses) {
    const bus = record(value),
      remote = record(bus.remote);
    if (typeof remote.relay !== "string" || typeof remote.machine !== "string") continue;
    let net = nets.get(remote.relay);
    if (!net) {
      if (nets.size >= MAX_RELAYS) continue;
      net = new RelayRoster(remote.relay);
      nets.set(remote.relay, net);
    }
    net.add(host, bus, now);
  }
  return [...nets.values()]
    .map((net) => net.snapshot())
    .sort((a, b) => a.relay.localeCompare(b.relay));
}
/* The shadow crew: one floor row per agent a relay roster lists on an unobserved machine, laid out on that machine's
   own ship exactly like observed crew, but never selectable, inspectable or controllable. Status is 'unknown': the
   roster says only that the agent was active in the last day, and when it was last seen. */
export function shadowRows(nets: readonly RelayNetwork[]) {
  const seen = new Set<string>();
  return nets.flatMap((net) =>
    net.shadows.flatMap((shadow) =>
      shadow.list.flatMap((agent) => {
        if (seen.has(agent.id)) return [];
        seen.add(agent.id);
        const row: LayoutRow & { shadow: boolean; relay: string; machine: string } = {
          id: agent.id,
          host: shadow.host,
          shadow: true,
          source: "relay",
          relay: net.relay,
          machine: shadow.machine,
          provider: agent.provider === "codex" ? "codex" : "claude",
          status: "unknown",
          project: agent.repo,
          projectId: `relay:${shadow.machine}:${agent.repo}`,
          projectKind: "repository",
          repo: agent.repo,
          repoId: agent.repo,
          title: `${agent.repo} on ${shadow.machine}`,
          lastActivityAt: agent.lastSeen,
          tool: { available: false },
        };
        return [row];
      }),
    ),
  );
}
