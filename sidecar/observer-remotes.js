/* sidecar/observer-remotes.js — remote observers federated over SSH.

   Each configured remote runs its own read-only observer; the hub keeps one long-lived `ssh … bun scripts/stream.js`
   per remote and reads one NDJSON snapshot per line. No port, token or HTTP surface exists on the remote: the trust
   boundary is the operator's SSH key. A remote is still another machine, so every row it sends is treated as
   untrusted input: only known fields survive, text is bounded and stripped of control characters, enums are checked,
   and ids are re-derived under the host so a remote can never collide with (or impersonate) a local row. */
"use strict";
const crypto = require("node:crypto");
const childProcess = require("../src/sidecar/child-env.ts").guardChildProcess(
  require("node:child_process"),
);
const { aggregateRows } = require("./observer.js");
const { unavailable } = require("../src/sidecar/inspector/fields.ts");

const MAX_LINE = 4 * 1024 * 1024,
  MAX_ROWS = 512,
  FRESH_MS = 10000,
  CONTROL_FRESH_MS = 6000,
  BACKOFF = [2000, 5000, 10000, 30000, 60000];
const ID = /^obs_[a-f0-9]{24}$/,
  UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const STATUSES = new Set(["working", "blocked", "idle", "done", "unknown"]),
  PROVIDERS = new Set(["claude", "codex"]);
const SOURCES = new Set(["herdr", "helper"]),
  HEALTH = new Set(["available", "unavailable"]);
const COUNTERS = ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens"];
const hash = (...parts) => crypto.createHash("sha256").update(parts.join("\0")).digest("hex");
const text = (value, length) =>
  typeof value === "string" ? value.replace(/[\x00-\x1f\x7f]/g, " ").slice(0, length) : null;
const word = (value, length = 40) =>
  typeof value === "string" && /^[A-Za-z0-9._:-]{1,40}$/.test(value)
    ? value.slice(0, length)
    : null;
const time = (value) =>
  Number.isFinite(value) && value >= 0
    ? value
    : typeof value === "string" && !Number.isNaN(Date.parse(value))
      ? text(value, 40)
      : null;
const count = (value) => (Number.isSafeInteger(value) && value >= 0 ? value : null);
const oneOf = (value, set, fallback = null) => (set.has(value) ? value : fallback);

function counters(usage) {
  if (!usage || typeof usage !== "object") return null;
  const result = {};
  for (const key of COUNTERS) {
    const value = usage[key];
    result[key] =
      value && typeof value === "object"
        ? { value: count(value.value), state: word(value.state, 20) }
        : null;
  }
  result.coverage = word(usage.coverage, 40);
  result.observedAt = time(usage.observedAt);
  return result;
}
function tool(value) {
  if (!value || typeof value !== "object") return { available: false };
  const result = { available: value.available === true };
  if (value.last && typeof value.last === "object")
    result.last = {
      name: text(value.last.name, 80),
      phase: word(value.last.phase, 20),
      outcome: word(value.last.outcome, 20),
      at: time(value.last.at),
    };
  if (value.usage) result.usage = counters(value.usage);
  return result;
}
const opaque = (prefix, host, value) =>
  typeof value === "string" && value ? prefix + hash(host, value).slice(0, 20) : null;
const prefixOf = (value, fallback) =>
  typeof value === "string" && /^(prj|repo|dir)_/.test(value)
    ? value.slice(0, value.indexOf("_") + 1)
    : fallback;
const remap = (host, id) => "obs_" + hash(host, id).slice(0, 24);

/* One remote row → a hub row. Unknown fields are dropped; ids are host-scoped; observedAt is the hub's receipt time. */
function sanitizeRow(host, row, receivedAt) {
  if (
    !row ||
    typeof row !== "object" ||
    !ID.test(row.id) ||
    !PROVIDERS.has(row.provider) ||
    !SOURCES.has(row.source)
  )
    return null;
  const helper = row.source === "helper" || Object.hasOwn(row, "parentId");
  const sessionId =
    typeof row.sessionId === "string" &&
    (UUID.test(row.sessionId) || (helper && /^[A-Za-z0-9-]{1,64}$/.test(row.sessionId)))
      ? row.sessionId
      : null;
  const id = remap(host, row.id);
  let inspectionIdentity = null;
  if (typeof row.inspectionIdentity === "string") {
    if (/^helper:obs_[a-f0-9]{24}$/.test(row.inspectionIdentity))
      inspectionIdentity = "helper:" + id;
    else if (sessionId && row.inspectionIdentity === row.provider + ":" + sessionId)
      inspectionIdentity = row.inspectionIdentity;
  }
  const safe = {
    id,
    host,
    provider: row.provider,
    source: row.source,
    role: row.role === "overseer" ? "overseer" : null,
    // A remote pane id is namespaced so it can never match a local Herdr pane: control actions reject it outright.
    paneId: word(row.paneId, 100) ? host + "/" + row.paneId : null,
    title: text(row.title, 160) || row.provider,
    projectId: opaque(prefixOf(row.projectId, "prj_"), host, row.projectId),
    project: text(row.project, 120) || "Unassigned",
    projectKind: word(row.projectKind, 20),
    repoId: opaque(prefixOf(row.repoId, "dir_"), host, row.repoId),
    repo: text(row.repo, 120) || "Unassigned",
    repoKind: word(row.repoKind, 20),
    checkoutId: opaque("checkout_", host, row.checkoutId),
    checkoutKind:
      typeof row.checkoutId === "string" && row.checkoutId
        ? oneOf(row.checkoutKind, new Set(["main", "worktree", "folder"]))
        : null,
    worktree: text(row.worktree, 120),
    folder: text(row.folder, 160) || "",
    status: oneOf(row.status, STATUSES, "unknown"),
    sessionId,
    identitySource: word(row.identitySource, 20),
    identityHealth: oneOf(row.identityHealth, HEALTH, "unavailable"),
    tool: tool(row.tool),
    usage: counters(row.usage),
    observedAt: receivedAt,
    inventoryHealth: oneOf(row.inventoryHealth, HEALTH, "unavailable"),
    inspectionIdentity,
    presence: word(row.presence, 30),
    helperOverflow: count(row.helperOverflow) || 0,
  };
  if (Number.isFinite(row.lastActivityAt)) safe.lastActivityAt = row.lastActivityAt;
  if (row.projectHome === true) safe.projectHome = true;
  if (helper) {
    safe.parentId = ID.test(row.parentId) ? remap(host, row.parentId) : null;
    safe.lineageState = word(row.lineageState, 30);
    const task = row.taskEvidence || {};
    safe.taskEvidence = {
      state: word(task.state, 20) || "unavailable",
      summary: text(task.summary, 240),
      source: word(task.source, 30),
      observedAt: time(task.observedAt),
    };
    const status = row.taskStatusEvidence || {};
    safe.taskStatusEvidence = {
      status: word(status.status, 20),
      source: word(status.source, 30),
      observedAt: time(status.observedAt),
    };
    const life = row.lifecycleEvidence || {};
    safe.lifecycleEvidence = { state: word(life.state, 30), reason: text(life.reason, 160) };
    safe.task = text(row.task, 240) || "Task unavailable.";
  }
  return safe;
}
function sanitizeSnapshot(host, value, receivedAt) {
  if (!value || typeof value !== "object" || !Array.isArray(value.sessions))
    throw new Error("invalid snapshot");
  // This host exports Herdr/helper rows. Desktop or bus success cannot prove that inventory.
  const inventoryHealth = Object.hasOwn(value, "sources")
    ? value.sources?.herdr?.health
    : value.health;
  const health =
    value.health === "available" ? oneOf(inventoryHealth, HEALTH, "unavailable") : "unavailable";
  const rows = [];
  for (const row of value.sessions.slice(0, MAX_ROWS)) {
    const safe = sanitizeRow(host, row, receivedAt);
    if (safe) rows.push(safe);
  }
  // A helper whose parent did not survive sanitising would be an orphan: drop it rather than guess a parent.
  const ids = new Set(rows.map((row) => row.id));
  const kept = rows.filter(
    (row) => !Object.hasOwn(row, "parentId") || (row.parentId && ids.has(row.parentId)),
  );
  return {
    health,
    rows:
      health === "available"
        ? kept
        : kept.map((row) => ({ ...row, inventoryHealth: "unavailable" })),
    bus: sanitizeBus(host, value.bus, new Set(kept.map((row) => row.id)), receivedAt),
    targets: health === "available" ? sanitizeTargets(value.targets, kept) : new Map(),
  };
}

/* Native pane proofs a remote published for control: only the identity fields the local control matches, each
   shape-checked, and only for panes that also survived as rows of that host. Never shown to the browser. */
const PANE = /^[A-Za-z0-9:_-]{1,100}$/;
const pathText = (value) =>
  typeof value === "string" &&
  value.startsWith("/") &&
  value.length <= 4096 &&
  !/[\x00-\x1f\x7f]/.test(value)
    ? value
    : null;
function sanitizeTargets(targets, rows) {
  const panes = new Set(
    rows
      .filter((row) => row.source === "herdr" && row.paneId && row.inventoryHealth === "available")
      .map((row) => row.paneId.slice(row.paneId.indexOf("/") + 1)),
  );
  const result = new Map();
  if (!Array.isArray(targets)) return result;
  for (const pane of targets.slice(0, MAX_ROWS)) {
    if (
      !pane ||
      typeof pane !== "object" ||
      !PROVIDERS.has(pane.agent) ||
      ![pane.pane_id, pane.workspace_id, pane.terminal_id].every(
        (value) => typeof value === "string" && PANE.test(value),
      )
    )
      continue;
    if (!panes.has(pane.pane_id) || result.has(pane.pane_id)) continue;
    const session =
      pane.agent_session && typeof pane.agent_session === "object"
        ? {
            agent: oneOf(pane.agent_session.agent, PROVIDERS),
            kind: word(pane.agent_session.kind, 20),
            value:
              typeof pane.agent_session.value === "string" && UUID.test(pane.agent_session.value)
                ? pane.agent_session.value
                : null,
          }
        : null;
    if (pane.agent_session && (!session.agent || !session.kind || !session.value)) continue; // unproven native session: no proof
    result.set(pane.pane_id, {
      pane_id: pane.pane_id,
      workspace_id: pane.workspace_id,
      terminal_id: pane.terminal_id,
      agent: pane.agent,
      agent_session: session,
      cwd: pathText(pane.cwd),
      foreground_cwd: pathText(pane.foreground_cwd),
    });
  }
  return result;
}

/* A remote host's own llm-bus, as its observer published it (publicBus shape). Each host's bus stands alone: message
   ids stay that host's integers, and every message also carries its hub-wide key "id@host" and its host. Endpoints are
   re-derived exactly like the rows (remap), and anything that does not name a surviving row of that host becomes
   'external'. Message identities are dropped: a remote body is never inspectable from the hub. */
// Same vocabulary as the local reader (src/sidecar/bus/index.ts): anything else from a remote reads as 'unknown'.
const WAKES = new Set(["requested", "failed", "unsupported", "none", "unknown"]);
const MAX_MESSAGES = 200;
function sanitizeBus(host, bus, rowIds, receivedAt) {
  if (!bus || typeof bus !== "object" || !Array.isArray(bus.messages)) return null;
  const endpoint = (value) =>
    value === "external" || value === "ambiguous"
      ? value
      : ID.test(value) && rowIds.has(remap(host, value))
        ? remap(host, value)
        : "external";
  const messages = [];
  for (const message of bus.messages.slice(0, MAX_MESSAGES)) {
    if (!message || !Number.isSafeInteger(message.id) || message.id < 1) continue;
    const relay = sanitizeRelay(message.relay);
    messages.push({
      id: message.id,
      key: message.id + "@" + host,
      host,
      from: endpoint(message.from),
      to: endpoint(message.to),
      sentAt: time(message.sentAt),
      acknowledgedAt: time(message.acknowledgedAt),
      wake: WAKES.has(message.wake) ? message.wake : "unknown",
      ...(relay ? { relay } : {}),
    });
  }
  const health = bus.health === "available" ? "available" : "unavailable",
    remote = sanitizeRemote(bus.remote, (value) =>
      ID.test(value) && rowIds.has(remap(host, value)) ? remap(host, value) : null,
    );
  return {
    health,
    reason: health === "available" ? null : text(bus.reason, 120) || "unreadable",
    observedAt: health === "available" ? receivedAt : null,
    window:
      Number.isSafeInteger(bus.window) && bus.window > 0 && bus.window <= 1000 ? bus.window : 100,
    messages,
    ...(remote ? { remote } : {}),
  };
}
/* That host's llm-bus relay view (src/sidecar/bus/relay.ts selectRemote): the same closed vocabulary, re-checked here. Times are
   the remote machine's own clock, as for every other remote timestamp. */
const RELAY_ID = /^[A-Za-z0-9_-]{1,128}$/,
  RELAY_HOST = /^[A-Za-z0-9.-]{1,253}$/;
const RELAY_STATES = new Set([
  "queued_local",
  "accepted_remote",
  "delivered_local",
  "acknowledged",
  "expired",
  "unknown",
]);
const epoch = (value) => (Number.isFinite(value) && value > 0 ? value : null),
  PEER = /^peer_[a-f0-9]{24}$/;
function sanitizeRelay(relay) {
  if (
    !relay ||
    typeof relay !== "object" ||
    !["out", "in"].includes(relay.direction) ||
    !RELAY_ID.test(relay.machine) ||
    !RELAY_ID.test(relay.repo)
  )
    return null;
  return {
    direction: relay.direction,
    machine: relay.machine,
    repo: relay.repo,
    provider: PROVIDERS.has(relay.provider) ? relay.provider : null,
    ...(PEER.test(relay.peer) ? { peer: relay.peer } : {}),
    state: RELAY_STATES.has(relay.state) ? relay.state : "unknown",
  };
}
function sanitizeRemote(remote, rowId = () => null) {
  if (
    !remote ||
    typeof remote !== "object" ||
    !RELAY_HOST.test(remote.relay) ||
    !RELAY_ID.test(remote.machine)
  )
    return null;
  const peers = (Array.isArray(remote.peers) ? remote.peers : [])
    .slice(0, 32)
    .filter((peer) => peer && RELAY_ID.test(peer.machine) && peer.machine !== remote.machine)
    .map((peer) => ({
      machine: peer.machine,
      repos: (Array.isArray(peer.repos) ? peer.repos : [])
        .filter((repo) => RELAY_ID.test(repo))
        .slice(0, 16),
      agents:
        Number.isSafeInteger(peer.agents) && peer.agents >= 0 ? Math.min(peer.agents, 2000) : 0,
      lastSeen: epoch(peer.lastSeen),
      list: (Array.isArray(peer.list) ? peer.list : [])
        .slice(0, 48)
        .filter(
          (agent) =>
            agent &&
            PEER.test(agent.id) &&
            PROVIDERS.has(agent.provider) &&
            RELAY_ID.test(agent.repo),
        )
        .map((agent) => ({
          id: agent.id,
          provider: agent.provider,
          repo: agent.repo,
          lastSeen: epoch(agent.lastSeen),
        })),
    }));
  // That host's own panes on the relay, re-identified like its rows; anything not naming a surviving row is dropped.
  const onRelay = (Array.isArray(remote.onRelay) ? remote.onRelay : [])
    .slice(0, 200)
    .flatMap((entry) => {
      const id = entry && rowId(entry.id);
      return id && RELAY_ID.test(entry.repo) ? [{ id, repo: entry.repo }] : [];
    });
  return {
    relay: remote.relay,
    machine: remote.machine,
    lastActivityAt: epoch(remote.lastActivityAt),
    peers,
    onRelay,
  };
}
// The remote command is fixed; only `dir` varies, and it is validated by config and single-quoted for the remote shell.
const quote = (value) => "'" + String(value).replace(/'/g, "'\\''") + "'";
function remoteCommand(dir) {
  const cd = dir.startsWith("~/")
    ? 'cd "$HOME"/' + quote(dir.slice(2))
    : dir === "~"
      ? 'cd "$HOME"'
      : "cd " + quote(dir);
  return (
    cd + ' && PATH="$HOME/.bun/bin:$HOME/.local/bin:$PATH" exec bun --no-env-file scripts/stream.js'
  );
}
function sshArgs(remote) {
  if (
    typeof remote.ssh !== "string" ||
    remote.ssh.startsWith("-") ||
    !/^[A-Za-z0-9._-]+(@[A-Za-z0-9.-]+)?$/.test(remote.ssh)
  )
    throw new Error("Invalid ssh target");
  return [
    "-T",
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=10",
    "-o",
    "ServerAliveInterval=15",
    "-o",
    "ServerAliveCountMax=2",
    "--",
    remote.ssh,
    remoteCommand(remote.dir || "~/starnet-observer"),
  ];
}
// ssh's own diagnostics can name hosts, users and paths; the page gets one short, known category instead.
function reasonFrom(stderr, code) {
  const value = String(stderr || "");
  if (/Permission denied/i.test(value)) return "SSH authentication failed";
  if (/Could not resolve hostname/i.test(value)) return "Host name did not resolve";
  if (/Connection refused/i.test(value)) return "SSH connection refused";
  if (/timed out/i.test(value)) return "SSH connection timed out";
  if (/Host key verification failed/i.test(value)) return "SSH host key not trusted";
  if (/command not found|No such file or directory/i.test(value))
    return "Remote observer not installed";
  return code === null ? "SSH stream ended" : "SSH stream exited (" + code + ")";
}

function makeRemoteHosts({
  remotes = [],
  spawn = childProcess.spawn,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  const hosts = remotes.map((remote) => ({
    remote,
    child: null,
    rows: [],
    bus: null,
    targets: new Map(),
    receivedAt: null,
    reason: "Connecting",
    failures: 0,
    timer: null,
    health: "unavailable",
  }));
  let closed = false;
  function connect(host) {
    if (closed) return;
    host.timer = null;
    let child;
    try {
      child = spawn("ssh", sshArgs(host.remote), { stdio: ["pipe", "pipe", "pipe"] });
    } catch (_) {
      host.reason = "SSH unavailable";
      return schedule(host);
    }
    host.child = child;
    let buffer = "",
      stderr = "",
      overflow = false;
    child.stdout.setEncoding?.("utf8");
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        if (overflow) {
          overflow = false;
          continue;
        } // the tail of an oversized line
        if (line.length > MAX_LINE) {
          host.reason = "Remote snapshot too large";
          continue;
        }
        if (!line.trim()) continue;
        try {
          const receivedAt = now();
          const snap = sanitizeSnapshot(host.remote.id, JSON.parse(line), receivedAt);
          host.health = snap.health;
          host.targets = snap.targets;
          host.failures = 0;
          if (snap.health === "available") {
            host.rows = snap.rows;
            host.bus = snap.bus;
            host.receivedAt = receivedAt;
            host.reason = null;
          } else {
            // Unavailable empty envelopes cannot erase the last observed crew or renew its proof.
            if (snap.rows.length) host.rows = snap.rows;
            if (!host.bus) host.bus = snap.bus;
            host.reason = "Remote inventory unavailable";
          }
        } catch (_) {
          host.reason = "Remote sent an unreadable snapshot";
        }
      }
      if (buffer.length > MAX_LINE) {
        buffer = "";
        overflow = true;
        host.reason = "Remote snapshot too large";
      }
    });
    child.stderr?.on("data", (chunk) => {
      if (stderr.length < 8192) stderr += chunk;
    });
    child.on("error", () => {
      if (host.child !== child) return;
      host.health = "unavailable";
      host.targets.clear();
      host.reason = "SSH unavailable";
    });
    child.on("close", (code) => {
      if (host.child !== child) return;
      host.child = null;
      host.health = "unavailable";
      host.targets.clear();
      host.reason = reasonFrom(stderr, code);
      schedule(host);
    });
  }
  function schedule(host) {
    if (closed || host.timer) return;
    const delay = BACKOFF[Math.min(host.failures, BACKOFF.length - 1)];
    host.failures++;
    host.timer = setTimer(() => connect(host), delay);
  }
  for (const host of hosts) connect(host);

  function snapshot() {
    const at = now(),
      rows = [],
      sources = {},
      buses = {};
    for (const host of hosts) {
      const fresh =
        host.health === "available" &&
        host.receivedAt !== null &&
        at >= host.receivedAt &&
        at - host.receivedAt < FRESH_MS;
      const health = fresh
        ? "available"
        : host.health === "unavailable" || host.receivedAt === null
          ? "unavailable"
          : "stale";
      // Stale rows stay on screen (the last truthful observation) but are never presented as live.
      for (const row of host.rows)
        rows.push(fresh ? row : { ...row, inventoryHealth: "unavailable" });
      // A quiet host's mail is its last observation: kept for the ledger, never presented as a live bus.
      const bus =
        host.bus &&
        (fresh
          ? host.bus
          : {
              ...host.bus,
              health: "unavailable",
              reason: "Host not currently observed",
              observedAt: host.bus.observedAt,
            });
      if (bus) buses[host.remote.id] = bus;
      sources[host.remote.id] = {
        health,
        observedAt: host.receivedAt,
        reason: fresh ? null : host.reason || "No recent snapshot",
        agents: host.rows.filter((row) => row.source !== "helper").length,
      };
    }
    return { rows, sources, buses };
  }
  function close() {
    closed = true;
    for (const host of hosts) {
      if (host.timer) clearTimer(host.timer);
      host.timer = null;
      if (host.child) {
        const child = host.child;
        host.child = null;
        try {
          child.stdin?.end();
          child.kill("SIGTERM");
        } catch (_) {}
      }
    }
  }
  // Control proof for `host`'s pane, stamped with the hub's receipt time; control re-checks it on that host over ssh.
  function controlTarget(hostId, paneId) {
    const host = hosts.find((value) => value.remote.id === hostId);
    if (
      closed ||
      !host ||
      host.health !== "available" ||
      host.receivedAt === null ||
      now() - host.receivedAt > CONTROL_FRESH_MS ||
      now() < host.receivedAt
    )
      return null;
    const proof = host.targets.get(paneId);
    return proof
      ? { ...structuredClone(proof), endpoint: "remote:" + hostId, observedAt: host.receivedAt }
      : null;
  }
  return { snapshot, close, controlTarget, ids: () => hosts.map((host) => host.remote.id) };
}

/* The hub's observer: the local snapshot plus every remote's rows. Local rows carry host: null. Aggregates are
   recomputed over the merged roster. `bus` keeps its local shape; each remote's own bus is under `hostBus[id]`
   (there is no cross-host mail: llm-bus is per host). */
function makeFederatedObserver(local, remoteHosts, now = Date.now) {
  async function get() {
    const inventory = await local.get(),
      remote = remoteHosts.snapshot();
    const sessions = [
      ...inventory.sessions.map((row) => {
        const source = inventory.sources?.[row.source === "helper" ? "herdr" : row.source];
        const observedAt = Number.isFinite(row.observedAt)
          ? row.observedAt
          : (source?.observedAt ?? inventory.observedAt ?? null);
        const health = source?.health || inventory.health;
        return {
          ...row,
          host: null,
          observedAt,
          inventoryHealth:
            health === "available" &&
            Number.isFinite(observedAt) &&
            row.inventoryHealth !== "unavailable"
              ? "available"
              : "unavailable",
        };
      }),
      ...remote.rows,
    ];
    const herdr = inventory.sources?.herdr;
    const available =
      inventory.health === "available" ||
      Object.values(remote.sources).some((host) => host.health === "available");
    const times = [
      inventory.observedAt,
      ...Object.values(remote.sources)
        .filter((host) => host.health === "available")
        .map((host) => host.observedAt),
    ].filter(Number.isFinite);
    return {
      ...inventory,
      sessions,
      aggregate: aggregateRows(sessions, now()),
      health: available ? "available" : inventory.health,
      observedAt: times.length ? Math.max(...times) : null,
      error: available ? null : inventory.error,
      sources: {
        ...inventory.sources,
        hosts: {
          local: {
            health: herdr?.health || "unavailable",
            observedAt: herdr?.observedAt ?? null,
            reason: herdr?.reason || null,
            agents: inventory.sessions.filter((row) => row.source === "herdr").length,
          },
          ...remote.sources,
        },
      },
      hostBus: remote.buses || {},
    };
  }
  async function inspect(id, expectedIdentity) {
    if (remoteHosts.snapshot().rows.some((row) => row.id === id))
      return unavailable(id, "remote-inspect", now());
    return local.inspect(id, expectedIdentity);
  }
  // `host/pane` ids resolve to that remote's streamed proof; plain ids are this machine's, as before.
  function controlTarget(id) {
    const slash = typeof id === "string" ? id.indexOf("/") : -1;
    if (slash < 0) return local.controlTarget?.(id) ?? null;
    return remoteHosts.controlTarget?.(id.slice(0, slash), id.slice(slash + 1)) ?? null;
  }
  return {
    get,
    inspect,
    controlTarget,
    inspectMessage: (id, expectedIdentity) => local.inspectMessage(id, expectedIdentity),
    close: async () => {
      remoteHosts.close();
      await local.close?.();
    },
  };
}

module.exports = {
  makeRemoteHosts,
  makeFederatedObserver,
  sanitizeRow,
  sanitizeSnapshot,
  sanitizeBus,
  sanitizeTargets,
  CONTROL_FRESH_MS,
  sshArgs,
  remoteCommand,
  reasonFrom,
  MAX_LINE,
  FRESH_MS,
  BACKOFF,
};
