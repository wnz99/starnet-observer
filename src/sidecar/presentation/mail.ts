import type { Message, Relay, Remote, Bus } from "./types.js";
import type { Aliases } from "./aliases.js";
function relayOf(aliases: Aliases) {
  return (relay: Relay | undefined) =>
    relay
      ? {
          direction: relay.direction,
          machine: aliases.alias("machine", "Machine", relay.machine),
          repo: aliases.alias("repo", "Shared repo", relay.repo),
          provider: relay.provider,
          ...(relay.peer ? { peer: relay.peer } : {}),
          state: relay.state,
        }
      : undefined;
}
function remoteOf(aliases: Aliases) {
  return (remote: Remote | undefined) =>
    remote
      ? {
          relay: aliases.alias("relay", "Relay", remote.relay),
          machine: aliases.alias("machine", "Machine", remote.machine),
          lastActivityAt: remote.lastActivityAt,
          onRelay: remote.onRelay.map((entry) => ({
            id: entry.id,
            repo: aliases.alias("repo", "Shared repo", entry.repo),
          })),
          peers: remote.peers.map((peer) => ({
            machine: aliases.alias("machine", "Machine", peer.machine),
            repos: peer.repos.map((repo) => aliases.alias("repo", "Shared repo", repo)),
            agents: peer.agents,
            lastSeen: peer.lastSeen,
            list: peer.list.map((agent) => ({
              id: agent.id,
              provider: agent.provider,
              repo: aliases.alias("repo", "Shared repo", agent.repo),
              lastSeen: agent.lastSeen,
            })),
          })),
        }
      : undefined;
}
function mailOf(aliases: Aliases) {
  return (message: Message, extra: { key?: string; host?: string | null | undefined } = {}) => {
    const relay = relayOf(aliases)(message.relay);
    return {
      id: message.id,
      ...extra,
      from: message.from,
      to: message.to,
      sentAt: message.sentAt,
      acknowledgedAt: message.acknowledgedAt,
      wake: message.wake,
      ...(relay ? { relay } : {}),
    };
  };
}
export function makeMail(aliases: Aliases) {
  const mail = mailOf(aliases),
    remote = remoteOf(aliases);
  function bus(value: Bus | null) {
    return value
      ? {
          health: value.health,
          reason: value.reason,
          observedAt: value.observedAt,
          window: value.window,
          messages: value.messages.map((message) => mail(message)),
          ...(value.remote ? { remote: remote(value.remote) } : {}),
        }
      : null;
  }
  function hostBus(values: Record<string, Bus | null>) {
    return Object.fromEntries(
      Object.entries(values).map(([id, nullable]) => {
        const value = requireBus(nullable);
        const host = aliases.host(id);
        return [
          host,
          {
            health: value.health,
            observedAt: value.observedAt,
            window: value.window,
            messages: value.messages.map((message) =>
              mail(message, { key: String(message.id) + "@" + host, host }),
            ),
            ...(value.remote ? { remote: remote(value.remote) } : {}),
          },
        ] as const;
      }),
    );
  }
  return { bus, hostBus };
}
function requireBus(value: Bus | null) {
  if (value === null) throw new TypeError("Cannot read properties of null");
  return value;
}
