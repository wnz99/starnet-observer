"use strict";
const fs = require("node:fs");
const crypto = require("node:crypto");
const os = require("node:os");
const path = require("node:path");
const { redactText } = require("./observer-inspector.js");
const { note: failNote } = require("./failopen.js");

/* Read-only view of local llm-bus delivery metadata. Bodies are read only for explicit inspection; folders and wake reasons are never selected;
   raw addresses stay in this process and only exact pane joins or 'external'/'ambiguous' reach the browser. */
const WINDOW = 100,
  MAX_TEXT_CHARS = 32768,
  MAX_RAW_CHARS = 65536;
const QUERY =
  "SELECT id, sender, recipient, sent_at, acknowledged_at, wake_status FROM messages ORDER BY id DESC LIMIT " +
  WINDOW;
const WAKES = new Set(["requested", "failed", "unsupported"]);
const MESSAGE_IDENTITY = /^mail_[a-f0-9]{64}$/;
const ADDRESS = /^(claude|codex):[A-Za-z0-9._-]{1,200}$/;
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
const PEER_IDLE_MS = 24 * 3600 * 1000,
  MAX_PEERS = 2000,
  MAX_MACHINES = 32;
const MAX_PEER_AGENTS = 48;
// A remote agent's page identity: an opaque hash of its full relay address, so the far side's native session id never
// leaves this process, while a message and the roster entry for the same agent still join exactly.
const peerId = (address) =>
  "peer_" +
  crypto
    .createHash("sha256")
    .update("starnet-relay-peer-v1\0" + address)
    .digest("hex")
    .slice(0, 24);
const peerOf = (address) => {
  const match = REMOTE_ADDRESS.exec(address);
  return match
    ? { machine: match[1], repo: match[2], provider: match[3], peer: peerId(address) }
    : null;
};
// "url|machine_id" (llm-bus Config.connection): the URL's host name only, never its path, port, query or user info.
function relayBinding(connection) {
  if (typeof connection !== "string") return null;
  const bar = connection.lastIndexOf("|"),
    machine = connection.slice(bar + 1);
  if (bar < 1 || !REMOTE_ID.test(machine)) return null;
  try {
    const url = new URL(connection.slice(0, bar));
    return /^https?:$/.test(url.protocol) && url.hostname
      ? { relay: url.hostname.slice(0, 253), machine }
      : null;
  } catch (_) {
    return null;
  }
}
function selectRemote(database, rows, at) {
  const present = new Set(
    database
      .query(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('" +
          REMOTE_TABLES.join("','") +
          "')",
      )
      .all()
      .map((row) => row.name),
  );
  if (!present.has("remote_binding")) return null;
  const binding = relayBinding(
    database.query("SELECT connection FROM remote_binding WHERE id = 1").all()[0]?.connection,
  );
  if (!binding) return null;
  const oldest = rows.reduce((min, row) => Math.min(min, row.id), Infinity),
    outbox = new Map(),
    imports = new Set();
  if (Number.isFinite(oldest)) {
    if (present.has("remote_outbox"))
      for (const row of database
        .query("SELECT local_id, state FROM remote_outbox WHERE local_id >= ?")
        .all(oldest))
        outbox.set(row.local_id, row.state);
    if (present.has("remote_imports"))
      for (const row of database
        .query("SELECT local_id FROM remote_imports WHERE local_id >= ?")
        .all(oldest))
        imports.add(row.local_id);
  }
  let lastActivityAt = null,
    expiresAt = Infinity;
  const changesAt = (value) => {
    if (value > at) expiresAt = Math.min(expiresAt, value);
  };
  const seen = (value) => {
    const ms = typeof value === "string" ? Date.parse(value) : NaN;
    if (Number.isFinite(ms)) {
      if (ms <= at + 60000) lastActivityAt = Math.max(lastActivityAt ?? 0, ms);
      else changesAt(ms - 60000);
    }
    return Number.isFinite(ms) ? ms : null;
  };
  for (const row of rows) {
    const out = outbox.has(row.id),
      peer = out ? peerOf(row.recipient) : imports.has(row.id) ? peerOf(row.sender) : null;
    if (!peer) continue;
    const state = out
      ? RELAY_STATES.has(outbox.get(row.id))
        ? outbox.get(row.id)
        : "unknown"
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
    seen(row.sentAt);
  }
  const machines = new Map();
  if (present.has("remote_peers"))
    for (const { payload } of database
      .query("SELECT payload FROM remote_peers LIMIT " + MAX_PEERS)
      .all()) {
      let peer;
      try {
        peer = JSON.parse(payload);
      } catch (_) {
        continue;
      }
      if (
        !peer ||
        !REMOTE_ID.test(peer.machine_id) ||
        !REMOTE_ID.test(peer.repo_id) ||
        peer.machine_id === binding.machine
      )
        continue;
      if (!machines.has(peer.machine_id) && machines.size >= MAX_MACHINES) continue;
      const entry = machines.get(peer.machine_id) || {
        machine: peer.machine_id,
        repos: new Set(),
        agents: 0,
        lastSeen: null,
        list: [],
      };
      machines.set(peer.machine_id, entry);
      entry.repos.add(peer.repo_id);
      const last = seen(peer.last_seen),
        address = typeof peer.address === "string" ? peer.address : "",
        who = peerOf(address);
      // llm-bus's own roster rule: a session that reported its end, or has been idle 24 hours, is not listed.
      if (!peer.ended && last !== null && at - last < PEER_IDLE_MS) {
        changesAt(last + PEER_IDLE_MS);
        entry.agents++;
        if (who && who.machine === peer.machine_id && entry.list.length < MAX_PEER_AGENTS)
          entry.list.push({ id: who.peer, provider: who.provider, repo: who.repo, lastSeen: last });
      }
      if (last !== null) entry.lastSeen = Math.max(entry.lastSeen ?? 0, last);
    }
  /* Which of this machine's own sessions are on the relay: the bridge publishes exactly the sessions of repositories its
     config maps, and records each publication here ("repo/native address" → payload). An ended or day-old publication
     is not counted, matching llm-bus's own roster rule. Native addresses stay in this process (joined in publicBus). */
  const published = [];
  if (present.has("remote_publications"))
    for (const { address: key, payload } of database
      .query("SELECT address, payload FROM remote_publications LIMIT " + MAX_PEERS)
      .all()) {
      let value;
      try {
        value = JSON.parse(payload);
      } catch (_) {
        continue;
      }
      if (
        !value ||
        !ADDRESS.test(value.native_address) ||
        !REMOTE_ID.test(value.repo_id) ||
        key !== value.repo_id + "/" + value.native_address ||
        value.ended
      )
        continue;
      const last = typeof value.last_seen === "string" ? Date.parse(value.last_seen) : NaN;
      if (Number.isFinite(last) && at - last < PEER_IDLE_MS) {
        changesAt(last + PEER_IDLE_MS);
        published.push({ address: value.native_address, repo: value.repo_id });
      }
    }
  const peers = [...machines.values()]
    .map((entry) => ({
      machine: entry.machine,
      repos: [...entry.repos].sort().slice(0, 16),
      agents: entry.agents,
      lastSeen: entry.lastSeen,
      list: entry.list.sort((a, b) => a.repo.localeCompare(b.repo) || a.id.localeCompare(b.id)),
    }))
    .sort((a, b) => a.machine.localeCompare(b.machine));
  return {
    view: { relay: binding.relay, machine: binding.machine, peers, lastActivityAt, published },
    expiresAt,
  };
}

// Mirrors llm-bus default_path(): LLM_BUS_DB (with ~), else the per-user data folder.
function defaultBusPath(env = process.env, platform = process.platform, home = os.homedir()) {
  const configured = env.LLM_BUS_DB;
  if (configured)
    return configured === "~"
      ? home
      : /^~[\\/]/.test(configured)
        ? path.join(home, configured.slice(2))
        : configured;
  if (platform === "win32")
    return path.join(
      env.LOCALAPPDATA || path.join(home, "AppData", "Local"),
      "llm-bus",
      "bus.sqlite3",
    );
  return path.join(home, ".local", "share", "llm-bus", "bus.sqlite3");
}
// Load native SQLite on first read; loader failures leave this optional source unavailable.
const loadBunSqlite = () => require("bun:sqlite");
const instant = (value) => {
  const milliseconds = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
};

/* SQLite never opens the live bus: even a readOnly connection to a WAL database creates -wal/-shm beside it.
   Each read copies the database and any journal into a private 0700 folder, opens that copy (SQLite replays
   the committed WAL frames there), and removes the folder. A copy is only trusted when size, times and inode
   of every file are unchanged across it, so a writer mid-commit or mid-checkpoint is retried, then reported. */
const PARTS = ["", "-wal", "-journal"],
  ATTEMPTS = 3,
  MAX_COPY_BYTES = 64n * 1024n * 1024n;
function fingerprint(file) {
  let bytes = 0n;
  return PARTS.map((suffix) => {
    try {
      const stat = fs.statSync(file + suffix, { bigint: true });
      bytes += stat.size;
      if (!stat.isFile() || bytes > MAX_COPY_BYTES)
        throw new Error("Bus snapshot exceeds its bounded read size");
      return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs, stat.birthtimeNs].join(
        ":",
      );
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  });
}
function stableCopy(file, copy, copyFile) {
  for (const suffix of [...PARTS, "-shm"]) fs.rmSync(copy + suffix, { force: true });
  const before = fingerprint(file);
  PARTS.forEach((suffix, index) => {
    if (before[index] === null) return;
    // A journal vanishing mid-copy (checkpoint) changes the fingerprint and is retried by query.
    try {
      copyFile(file + suffix, copy + suffix);
      fs.chmodSync(copy + suffix, 0o600);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  });
  return fingerprint(file).join("|") === before.join("|") ? before : null;
}

// Selectors use database.query() so Bun owns and finalizes their statements at close(true).
function makePrivateSnapshotQuery({
  file,
  loadSqlite = loadBunSqlite,
  tempRoot = os.tmpdir(),
  copyFile = fs.copyFileSync,
}) {
  return function query(select) {
    if (!fs.existsSync(file)) return { reason: "missing" };
    let Database;
    try {
      ({ Database } = loadSqlite());
    } catch (_) {
      return { reason: "unsupported" };
    }
    if (typeof Database !== "function") return { reason: "unsupported" };
    let folder = null,
      database = null;
    try {
      folder = fs.mkdtempSync(path.join(tempRoot, "starnet-observer-bus-"));
      fs.chmodSync(folder, 0o700);
      const copy = path.join(folder, "bus.sqlite3");
      for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
        const copiedFingerprint = stableCopy(file, copy, copyFile);
        if (!copiedFingerprint) continue;
        database = new Database(copy);
        const result = select(database, copiedFingerprint);
        database.close(true);
        database = null;
        // Bind the queried rows to the source that produced the copy, never a later fingerprint.
        if (fingerprint(file).join("|") === copiedFingerprint.join("|")) {
          return { ...result, fingerprint: copiedFingerprint };
        }
      }
      return { reason: "unstable" };
    } catch (_) {
      return { reason: "unreadable" };
    } finally {
      if (database)
        try {
          database.close(true);
        } catch (_) {
          failNote("observer.bus.close", new Error("Bus snapshot handle cleanup failed"));
        }
      // The private copy never outlives the read, including after a failed copy or open.
      if (folder)
        try {
          fs.rmSync(folder, { recursive: true, force: true });
        } catch (_) {
          failNote("observer.bus.remove", new Error("Bus snapshot folder cleanup failed"));
        }
    }
  };
}

// Installed llm-bus inserts immutable id/sender/recipient/sent_at; later writes only delivery/routing fields.
// Source incarnation uses device/inode/birth time from the verified copy proof, not changing file times or WAL.
// Hash a versioned tuple to keep file identity and raw addresses private; never read bodies for metadata identity.
function messageIdentity(sourceFingerprint, row) {
  const [device, inode, , , , birth] = sourceFingerprint[0].split(":");
  if (!birth || birth === "0") throw new Error("Bus source incarnation unavailable");
  return (
    "mail_" +
    crypto
      .createHash("sha256")
      .update(
        JSON.stringify([
          "starnet-mail-v1",
          device,
          inode,
          birth,
          row.id,
          row.sender,
          row.recipient,
          row.sent_at,
        ]),
      )
      .digest("hex")
  );
}

function makeBusReader({
  file = defaultBusPath(),
  loadSqlite = loadBunSqlite,
  now,
  tempRoot = os.tmpdir(),
  copyFile = fs.copyFileSync,
} = {}) {
  if (typeof now !== "function") throw new TypeError("Bus reader requires an injected now clock");
  let rows = [],
    remote = null,
    observedAt = null,
    health = "unknown",
    reason = null,
    reusableFingerprint = null;
  let remoteSelectedAt = null,
    remoteExpiresAt = Infinity;
  const query = makePrivateSnapshotQuery({ file, loadSqlite, tempRoot, copyFile });
  const selectRows = (database, sourceFingerprint) => {
    const result = [];
    for (const row of database.query(QUERY).all()) {
      if (
        !Number.isSafeInteger(row.id) ||
        row.id < 1 ||
        typeof row.sender !== "string" ||
        typeof row.recipient !== "string" ||
        typeof row.sent_at !== "string"
      )
        continue;
      result.push({
        id: row.id,
        identity: messageIdentity(sourceFingerprint, row),
        sender: row.sender,
        recipient: row.recipient,
        sentAt: instant(row.sent_at),
        acknowledgedAt: instant(row.acknowledged_at),
        wake:
          row.wake_status == null
            ? "none"
            : WAKES.has(row.wake_status)
              ? row.wake_status
              : "unknown",
      });
    }
    // Relay metadata is optional: a bus without (or with unreadable) remote tables still reads as a plain local bus.
    let relayView = null,
      expiresAt = Infinity;
    const selectedAt = now();
    try {
      const selection = selectRemote(database, result, selectedAt);
      relayView = selection?.view || null;
      expiresAt = selection?.expiresAt ?? Infinity;
    } catch (_) {
      relayView = null;
      for (const row of result) delete row.relay;
    }
    return { rows: result, remote: relayView, selectedAt, expiresAt };
  };
  // A failed read keeps the last good rows and their observedAt, so the browser sees them as stale.
  function read() {
    let result;
    try {
      const current = fingerprint(file);
      if (current[0] === null) result = { reason: "missing" };
      // A stable database does not freeze the relay's clock-dependent roster/publications.
      else if (
        reusableFingerprint &&
        current.join("|") === reusableFingerprint.join("|") &&
        (!remote || (now() >= remoteSelectedAt && now() < remoteExpiresAt))
      ) {
        return { rows, remote, observedAt, health: "available", reason: null };
      }
    } catch (_) {
      result = { reason: "unreadable" };
    }
    result = result || query(selectRows);
    if (result.rows) {
      const unchanged =
        reusableFingerprint && result.fingerprint.join("|") === reusableFingerprint.join("|");
      rows = result.rows;
      remote = result.remote || null;
      remoteSelectedAt = result.selectedAt;
      remoteExpiresAt = result.expiresAt;
      if (!unchanged) observedAt = now();
      health = "available";
      reason = null;
      reusableFingerprint = result.fingerprint;
    } else {
      health = "unavailable";
      reason = result.reason;
      reusableFingerprint = null;
    }
    return { rows, remote, observedAt, health, reason };
  }

  // Private raw results are confined to the worker transport and the shared sanitizer below.
  function inspectRaw(id, expectedIdentity) {
    if (!Number.isSafeInteger(id) || id < 1) return { id, reason: "invalid-message" };
    if (
      expectedIdentity !== undefined &&
      (typeof expectedIdentity !== "string" || !MESSAGE_IDENTITY.test(expectedIdentity))
    )
      return { id, reason: "invalid-identity" };
    const result = query((database, sourceFingerprint) => {
      // Bound transfer into JavaScript; scrub before the smaller display cap. A cut quoted value stays redacted.
      const row = database
        .query(
          "SELECT id, sender, recipient, sent_at, substr(body, 1, ?) AS body FROM messages WHERE id = ?",
        )
        .get(MAX_RAW_CHARS + 1, id);
      if (!row) return { reason: "missing-message" };
      if (
        typeof row.sender !== "string" ||
        typeof row.recipient !== "string" ||
        typeof row.sent_at !== "string"
      )
        return { reason: "unreadable" };
      const identity = messageIdentity(sourceFingerprint, row);
      if (expectedIdentity !== undefined && identity !== expectedIdentity)
        return { reason: "identity-mismatch" };
      if (typeof row.body !== "string") return { reason: "unreadable" };
      return { identity, body: row.body.slice(0, MAX_RAW_CHARS + 1) };
    });
    if (result.reason) reusableFingerprint = null;
    return {
      id,
      ...(result.reason
        ? { reason: result.reason }
        : { identity: result.identity, body: result.body }),
    };
  }
  return {
    read,
    inspectRaw,
    inspect: (id, expectedIdentity) =>
      sanitizeMessageInspection(inspectRaw(id, expectedIdentity), now()),
  };
}

// Both synchronous fixtures and the parent worker adapter use the main process's live known-value redaction.
function sanitizeMessageInspection(raw, now) {
  const base = {
    id: raw.id,
    identity: null,
    health: "unavailable",
    reason: null,
    asOf: new Date(now).toISOString(),
    text: null,
    truncated: false,
    window: { maxTextChars: MAX_TEXT_CHARS },
  };
  if (raw.reason) return { ...base, reason: raw.reason };
  if (
    typeof raw.body !== "string" ||
    raw.body.length > MAX_RAW_CHARS + 1 ||
    !MESSAGE_IDENTITY.test(raw.identity || "")
  )
    return { ...base, reason: "unreadable" };
  const safe = redactText(raw.body);
  return {
    ...base,
    health: "available",
    identity: raw.identity,
    text: safe.slice(0, MAX_TEXT_CHARS),
    truncated: raw.body.length > MAX_RAW_CHARS || safe.length > MAX_TEXT_CHARS,
  };
}

// Exact identity join: one pane with this provider:session gets its observer id; two or more stay ambiguous.
function publicBus(state, sessions) {
  const panes = new Map();
  for (const row of sessions) {
    if (!row.sessionId) continue;
    const address = row.provider + ":" + row.sessionId;
    panes.set(address, panes.has(address) ? "ambiguous" : row.id);
  }
  const endpoint = (address) => (ADDRESS.test(address) && panes.get(address)) || "external";
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
            onRelay: (state.remote.published || []).flatMap((entry) => {
              const id = ADDRESS.test(entry.address) && panes.get(entry.address);
              return id && id !== "ambiguous" ? [{ id, repo: entry.repo }] : [];
            }),
            peers: state.remote.peers.map((peer) => ({
              ...peer,
              repos: peer.repos.slice(),
              list: (peer.list || []).map((agent) => ({ ...agent })),
            })),
          },
        }
      : {}),
  };
}
module.exports = {
  makeBusReader,
  publicBus,
  defaultBusPath,
  WINDOW,
  makePrivateSnapshotQuery,
  sanitizeMessageInspection,
  relayBinding,
  RELAY_STATES,
};
