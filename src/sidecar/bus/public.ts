import { ADDRESS, WINDOW } from "./types.js";
import type { BusState, BusPane } from "./types.js";
// Exact identity join: one pane with this provider:session gets its observer id; two or more stay ambiguous.
export function publicBus(state: BusState, sessions: BusPane[]) {
  const panes = new Map<string, string>();
  for (const row of sessions) {
    if (!row.sessionId) continue;
    const address = row.provider + ":" + row.sessionId;
    panes.set(address, panes.has(address) ? "ambiguous" : row.id);
  }
  const endpoint = (address: string) => (ADDRESS.test(address) && panes.get(address)) || "external";
  return {
    health: state.health,
    reason: state.reason,
    observedAt: state.observedAt,
    window: WINDOW,
    messages: state.rows.map((row) => ({
      id: row.id,
      ...(row.identity === undefined ? {} : { identity: row.identity }),
      from: endpoint(row.sender),
      to: endpoint(row.recipient),
      sentAt: row.sentAt,
      acknowledgedAt: row.acknowledgedAt,
      wake: row.wake,
      ...(row.relay ? { relay: { ...row.relay } } : {}),
    })),
    ...(state.remote
      ? {
          remote: {
            relay: state.remote.relay,
            machine: state.remote.machine,
            lastActivityAt: state.remote.lastActivityAt,
            // This machine's panes on the relay: exact pane joins only, as observer ids with their shared repo.
            onRelay: state.remote.published.flatMap((entry) => {
              const id = ADDRESS.test(entry.address) && panes.get(entry.address);
              return id && id !== "ambiguous" ? [{ id, repo: entry.repo }] : [];
            }),
            peers: state.remote.peers.map((peer) => ({
              ...peer,
              repos: peer.repos.slice(),
              list: peer.list.map((agent) => ({ ...agent })),
            })),
          },
        }
      : {}),
  };
}
