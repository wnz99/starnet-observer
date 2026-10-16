import crypto from "node:crypto";
import { ADDRESS, busRecord } from "./types.js";
import type { BusRow, RemoteView, Relay } from "./types.js";
import type { SnapshotDatabase } from "../sqlite/snapshots.js";

/* llm-bus remote relay (wnz99/llm-bus PR #39): optional tables beside the native mailbox, present once a bridge has run.
   Only routing metadata is selected: the relay's host name and this machine's id (remote_binding), each relayed message's
   direction, peer machine, shared repo and delivery state (remote_outbox / remote_imports), and the cached remote roster
   counted per machine (remote_peers). Credentials never live in the bus; URL paths, native session ids and bodies are
   never read here. The roster cache is not proof of connectivity: liveness is judged from its newest activity time. */
const REMOTE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const REMOTE_ADDRESS =
  /^([A-Za-z0-9_-]{1,128})\/([A-Za-z0-9_-]{1,128})\/(claude|codex):[A-Za-z0-9._-]{1,200}$/;
const RELAY_STATES = new Set([
  "queued_local",
  "accepted_remote",
  "delivered_local",
  "acknowledged",
  "expired",
]);
const REMOTE_TABLES = [
  "remote_binding",
  "remote_outbox",
  "remote_imports",
  "remote_peers",
  "remote_publications",
];
const PEER_IDLE_MS = 24 * 3600 * 1000;
const MAX_PEERS = 2000;
const MAX_MACHINES = 32;
const MAX_PEER_AGENTS = 48;
const MAX_REPOS = 16;
const MAX_HOSTNAME = 253;
const FUTURE_SKEW_MS = 60000;
const PEER_HASH_LENGTH = 24;
type PeerAgent = RemoteView["peers"][number]["list"][number];
interface Machine {
  machine: string;
  repos: Set<string>;
  agents: number;
  lastSeen: number | null;
  list: PeerAgent[];
}
// The page identity is an opaque hash of the complete relay address. Native session ids remain private.
// The same agent has an exact identity join between its messages and roster entry.
function peerOf(
  address: string,
): { machine: string; repo: string; provider: "codex" | "claude"; peer: string } | null {
  const match = REMOTE_ADDRESS.exec(address);
  if (!match) return null;
  const [, machine, repo, provider] = match;
  if (!machine || !repo || (provider !== "codex" && provider !== "claude")) return null;
  const peer =
    "peer_" +
    crypto
      .createHash("sha256")
      .update("starnet-relay-peer-v1\0" + address)
      .digest("hex")
      .slice(0, PEER_HASH_LENGTH);
  return { machine, repo, provider, peer };
}
// "url|machine_id" (llm-bus Config.connection): the URL's host name only, never its path, port, query or user info.
export function relayBinding(connection: unknown) {
  if (typeof connection !== "string") return null;
  const bar = connection.lastIndexOf("|"),
    machine = connection.slice(bar + 1);
  if (bar < 1 || !REMOTE_ID.test(machine)) return null;
  try {
    const url = new URL(connection.slice(0, bar));
    return /^https?:$/.test(url.protocol) && url.hostname
      ? { relay: url.hostname.slice(0, MAX_HOSTNAME), machine }
      : null;
  } catch {
    return null;
  }
}
function payload(value: unknown) {
  if (!busRecord(value) || typeof value.payload !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(value.payload);
    return busRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
function validPeer(
  value: Record<string, unknown>,
): value is Record<string, unknown> & { machine_id: string; repo_id: string } {
  return (
    typeof value.machine_id === "string" &&
    REMOTE_ID.test(value.machine_id) &&
    typeof value.repo_id === "string" &&
    REMOTE_ID.test(value.repo_id)
  );
}
function relayState(value: unknown): Relay["state"] {
  if (typeof value !== "string" || !RELAY_STATES.has(value)) return "unknown";
  switch (value) {
    case "queued_local":
    case "accepted_remote":
    case "delivered_local":
    case "acknowledged":
    case "expired":
      return value;
    default:
      return "unknown";
  }
}
class RemoteSelection {
  private readonly present: Set<unknown>;
  private lastActivityAt: number | null = null;
  private expiresAt = Infinity;
  private readonly machines = new Map<string, Machine>();
  constructor(
    private readonly database: SnapshotDatabase,
    private readonly rows: BusRow[],
    private readonly at: number,
  ) {
    this.present = new Set(
      database
        .query(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('" +
            REMOTE_TABLES.join("','") +
            "')",
        )
        .all()
        .flatMap((row) => (busRecord(row) ? [row.name] : [])),
    );
  }
  private changesAt(value: number) {
    if (value > this.at) this.expiresAt = Math.min(this.expiresAt, value);
  }
  private seen(value: unknown) {
    const ms = typeof value === "string" ? Date.parse(value) : NaN;
    if (!Number.isFinite(ms)) return null;
    if (ms <= this.at + FUTURE_SKEW_MS)
      this.lastActivityAt = Math.max(this.lastActivityAt ?? 0, ms);
    else this.changesAt(ms - FUTURE_SKEW_MS);
    return ms;
  }
  private routes() {
    const oldest = this.rows.reduce((min, row) => Math.min(min, row.id), Infinity);
    const outbox = new Map<unknown, unknown>(),
      imports = new Set<unknown>();
    if (!Number.isFinite(oldest)) return { outbox, imports };
    if (this.present.has("remote_outbox"))
      for (const row of this.database
        .query("SELECT local_id, state FROM remote_outbox WHERE local_id >= ?")
        .all(oldest))
        if (busRecord(row)) outbox.set(row.local_id, row.state);
    if (this.present.has("remote_imports"))
      for (const row of this.database
        .query("SELECT local_id FROM remote_imports WHERE local_id >= ?")
        .all(oldest))
        if (busRecord(row)) imports.add(row.local_id);
    return { outbox, imports };
  }
  private messages() {
    const { outbox, imports } = this.routes();
    for (const row of this.rows) {
      const out = outbox.has(row.id);
      const peer = out ? peerOf(row.recipient) : imports.has(row.id) ? peerOf(row.sender) : null;
      if (!peer) continue;
      const state = out
        ? relayState(outbox.get(row.id))
        : row.acknowledgedAt
          ? "acknowledged"
          : "delivered_local";
      row.relay = {
        direction: out ? "out" : "in",
        machine: peer.machine,
        repo: peer.repo,
        provider: peer.provider,
        peer: peer.peer,
        state,
      };
      this.seen(row.sentAt);
    }
  }
  private roster(machine: string) {
    if (!this.present.has("remote_peers")) return;
    for (const raw of this.database
      .query("SELECT payload FROM remote_peers LIMIT " + String(MAX_PEERS))
      .all()) {
      const peer = payload(raw);
      if (!peer || !validPeer(peer) || peer.machine_id === machine) continue;
      if (!this.machines.has(peer.machine_id) && this.machines.size >= MAX_MACHINES) continue;
      const entry = this.machines.get(peer.machine_id) ?? {
        machine: peer.machine_id,
        repos: new Set<string>(),
        agents: 0,
        lastSeen: null,
        list: [],
      };
      this.machines.set(peer.machine_id, entry);
      entry.repos.add(peer.repo_id);
      this.machines.set(entry.machine, this.agent(entry, peer));
    }
  }
  private agent(entry: Machine, peer: Record<string, unknown>) {
    const last = this.seen(peer.last_seen);
    // llm-bus's own roster rule: a session that reported its end, or has been idle 24 hours, is not listed.
    if (!peer.ended && last !== null && this.at - last < PEER_IDLE_MS) {
      this.changesAt(last + PEER_IDLE_MS);
      const next = { ...entry, list: entry.list.slice(), agents: entry.agents + 1 };
      const agent = this.listedAgent(peer, last);
      if (agent && entry.list.length < MAX_PEER_AGENTS) next.list.push(agent);
      return { ...next, lastSeen: Math.max(entry.lastSeen ?? 0, last) };
    }
    if (last === null) return entry;
    return { ...entry, lastSeen: Math.max(entry.lastSeen ?? 0, last) };
  }
  private listedAgent(peer: Record<string, unknown>, lastSeen: number) {
    const who = peerOf(typeof peer.address === "string" ? peer.address : "");
    return who && who.machine === peer.machine_id
      ? { id: who.peer, provider: who.provider, repo: who.repo, lastSeen }
      : null;
  }
  /* Which of this machine's own sessions are on the relay: the bridge publishes exactly the sessions of repositories its
     config maps, and records each publication here ("repo/native address" → payload). An ended or day-old publication
     is not counted, matching llm-bus's own roster rule. Native addresses stay in this process (joined in publicBus). */
  private publications() {
    const published: RemoteView["published"] = [];
    if (!this.present.has("remote_publications")) return published;
    for (const raw of this.database
      .query("SELECT address, payload FROM remote_publications LIMIT " + String(MAX_PEERS))
      .all()) {
      const value = payload(raw);
      if (!busRecord(raw) || !value || !this.validPublication(raw, value)) continue;
      const last = typeof value.last_seen === "string" ? Date.parse(value.last_seen) : NaN;
      if (Number.isFinite(last) && this.at - last < PEER_IDLE_MS) {
        this.changesAt(last + PEER_IDLE_MS);
        published.push({ address: value.native_address, repo: value.repo_id });
      }
    }
    return published;
  }
  private validPublication(
    raw: Record<string, unknown>,
    value: Record<string, unknown>,
  ): value is Record<string, unknown> & { native_address: string; repo_id: string } {
    return (
      typeof value.native_address === "string" &&
      ADDRESS.test(value.native_address) &&
      typeof value.repo_id === "string" &&
      REMOTE_ID.test(value.repo_id) &&
      raw.address === value.repo_id + "/" + value.native_address &&
      !value.ended
    );
  }
  select() {
    if (!this.present.has("remote_binding")) return null;
    const row = this.database.query("SELECT connection FROM remote_binding WHERE id = 1").all()[0];
    const binding = relayBinding(busRecord(row) ? row.connection : null);
    if (!binding) return null;
    this.messages();
    this.roster(binding.machine);
    const published = this.publications();
    const peers = [...this.machines.values()]
      .map((entry) => ({
        machine: entry.machine,
        repos: [...entry.repos].sort().slice(0, MAX_REPOS),
        agents: entry.agents,
        lastSeen: entry.lastSeen,
        list: entry.list
          .slice()
          .sort((a, b) => a.repo.localeCompare(b.repo) || a.id.localeCompare(b.id)),
      }))
      .sort((a, b) => a.machine.localeCompare(b.machine));
    return {
      view: { ...binding, peers, lastActivityAt: this.lastActivityAt, published },
      expiresAt: this.expiresAt,
    };
  }
}
export function selectRemote(database: SnapshotDatabase, rows: BusRow[], at: number) {
  return new RemoteSelection(database, rows, at).select();
}
