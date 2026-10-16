import { LIMITS } from "./limits.js";
import type { ObserverSnapshot } from "../../shared/observer.js";
import { PROVIDERS, matches, has, record } from "./fields.js";
/* That host's llm-bus relay view (src/sidecar/bus/relay.ts selectRemote): the same closed vocabulary, re-checked here. Times are
   the remote machine's own clock, as with every other remote timestamp. */
const RELAY_ID = /^[A-Za-z0-9_-]{1,128}$/,
  RELAY_HOST = /^[A-Za-z0-9.-]{1,253}$/;
const RELAY_STATES = new Set([
  "queued_local",
  "accepted_remote",
  "delivered_local",
  "acknowledged",
  "expired",
  "unknown",
] as const);
const epoch = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null,
  PEER = /^peer_[a-f0-9]{24}$/;
export function sanitizeRelay(
  relay: unknown,
): NonNullable<ObserverSnapshot["bus"]>["messages"][number]["relay"] | null {
  if (
    !record(relay) ||
    (relay.direction !== "out" && relay.direction !== "in") ||
    !matches(RELAY_ID, relay.machine) ||
    !matches(RELAY_ID, relay.repo)
  )
    return null;
  return {
    direction: relay.direction,
    machine: relay.machine,
    repo: relay.repo,
    provider: has(PROVIDERS, relay.provider) ? relay.provider : null,
    ...(matches(PEER, relay.peer) ? { peer: relay.peer } : {}),
    state: has(RELAY_STATES, relay.state) ? relay.state : "unknown",
  };
}
export function sanitizeRemote(
  remote: unknown,
  rowId: (value: unknown) => string | null = () => null,
): NonNullable<ObserverSnapshot["bus"]>["remote"] | null {
  if (!record(remote) || !matches(RELAY_HOST, remote.relay) || !matches(RELAY_ID, remote.machine))
    return null;
  const peers = remotePeers(remote);
  // That host's own panes on the relay, re-identified like its rows; anything not naming a surviving row is dropped.
  const onRelay = (Array.isArray(remote.onRelay) ? remote.onRelay : [])
    .slice(0, LIMITS.MESSAGES)
    .flatMap((entry) => {
      if (!record(entry)) return [];
      const id = rowId(entry.id);
      return id && matches(RELAY_ID, entry.repo) ? [{ id, repo: entry.repo }] : [];
    });
  return {
    relay: remote.relay,
    machine: remote.machine,
    lastActivityAt: epoch(remote.lastActivityAt),
    peers,
    onRelay,
  };
}

function remotePeers(remote: Record<string, unknown>) {
  return (Array.isArray(remote.peers) ? remote.peers : [])
    .slice(0, LIMITS.PEERS)
    .filter(record)
    .flatMap((peer) => {
      if (!matches(RELAY_ID, peer.machine) || peer.machine === remote.machine) return [];
      return [
        {
          machine: peer.machine,
          repos: (Array.isArray(peer.repos) ? peer.repos : [])
            .filter((repo) => matches(RELAY_ID, repo))
            .slice(0, LIMITS.REPOS),
          agents:
            typeof peer.agents === "number" && Number.isSafeInteger(peer.agents) && peer.agents >= 0
              ? Math.min(peer.agents, LIMITS.AGENTS)
              : 0,
          lastSeen: epoch(peer.lastSeen),
          list: (Array.isArray(peer.list) ? peer.list : [])
            .slice(0, LIMITS.AGENT_LIST)
            .filter(record)
            .flatMap((agent) => {
              if (
                !matches(PEER, agent.id) ||
                !has(PROVIDERS, agent.provider) ||
                !matches(RELAY_ID, agent.repo)
              )
                return [];
              return [
                {
                  id: agent.id,
                  provider: agent.provider,
                  repo: agent.repo,
                  lastSeen: epoch(agent.lastSeen),
                },
              ];
            }),
        },
      ];
    });
}
