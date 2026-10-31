import type { AppBus } from "./data.js";
import { age } from "../model/description.js";

function peerLines(peer: unknown, now: number) {
  if (!peer || typeof peer !== "object" || !("machine" in peer)) return ["Unknown peer"];
  const value = peer as {
    machine: unknown;
    agents?: number;
    repos?: string[];
    lastSeen?: number | null;
    list?: { provider: string; repo: string; lastSeen?: number | null }[];
  };
  const heading =
    String(value.machine) +
    " · " +
    String(value.agents || 0) +
    " agents · " +
    (value.repos || []).join(", ") +
    " · " +
    age(value.lastSeen, now);
  return [
    heading,
    ...(value.list || []).map(
      (agent) => "  " + agent.provider + " · " + agent.repo + " · " + age(agent.lastSeen, now),
    ),
  ];
}
function sections(bus: AppBus | null, participant: (id: string) => string) {
  const lines: string[] = [];
  if (!bus?.coordination) lines.push("Coordination details: unavailable from this observer");
  for (const section of bus?.coordination?.sections || []) {
    lines.push("", section.title + (section.truncated ? " · first 100 rows" : ""));
    lines.push(sectionStatus(section.available, section.rows.length));
    for (const row of section.rows)
      lines.push(
        row.label + (row.agent ? " · " + participant(row.agent) : "") + "\n  " + row.detail,
      );
  }
  return lines;
}
function sectionStatus(available: boolean, rows: number) {
  if (!available) return "Unavailable in this mailbox";
  return rows === 0 ? "None recorded" : "";
}
export function busSummary(bus: AppBus | null, participant: (id: string) => string, now: number) {
  const lines = [
    "Observed: " + (bus?.observedAt ? new Date(bus.observedAt).toISOString() : "unavailable"),
  ];
  if (bus?.remote) lines.push(...relayLines(bus.remote, participant, now));
  else lines.push("Relay: unavailable");
  return [...lines, ...sections(bus, participant)].join("\n");
}
function relayLines(
  remote: NonNullable<AppBus["remote"]>,
  participant: (id: string) => string,
  now: number,
) {
  return [
    "Relay: " + String(remote.relay) + " · machine: " + String(remote.machine),
    "Local publications:",
    ...(remote.onRelay || []).map((entry) => participant(entry.id) + " · " + entry.repo),
    "Cached remote roster (not proof of connectivity):",
    ...(remote.peers || []).flatMap((peer) => peerLines(peer, now)),
  ];
}
