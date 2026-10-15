"use strict";
const { unavailable } = require("./observer-inspector.js");
const { PANE } = require("./control.js");
const { DEFAULT_LABELS } = require("../src/sidecar/config/index.ts");
const TOOL_NAMES = new Set([
  "Bash",
  "exec_command",
  "shell",
  "local_shell",
  "write_stdin",
  "Read",
  "NotebookRead",
  "view_image",
  "Edit",
  "MultiEdit",
  "Write",
  "NotebookEdit",
  "apply_patch",
  "Grep",
  "Glob",
  "LS",
  "WebFetch",
  "WebSearch",
  "web_search",
  "web__run",
  "functions.exec",
  "functions.wait",
  "wait",
  "Task",
  "Agent",
  "spawn_agent",
  "TodoWrite",
  "update_plan",
]);

// A server-side allowlist, not a text replacement: private labels never reach the recording page.
// Opaque ownership IDs and live status/freshness remain unchanged; aliases are display identities only.
function makePresentationObserver(observer, now = Date.now, labels = DEFAULT_LABELS) {
  let closePromise = null;
  const projects = new Map(),
    repos = new Map(),
    worktrees = new Map(),
    hosts = new Map(),
    folders = new Map();
  // Remote host ids are operator-chosen names (often real machine names): they become fictional ship names.
  const host = (id) => {
    if (id == null) return null;
    if (!hosts.has(id)) hosts.set(id, "Ship " + (hosts.size + 1));
    return hosts.get(id);
  };
  // llm-bus relay names (relay host, machine ids, shared repo ids) are real names too: each gets a stable fictional alias.
  const aliases = new Map(),
    alias = (kind, prefix, id) => {
      const key = kind + "\0" + id;
      if (!aliases.has(key))
        aliases.set(
          key,
          prefix + " " + ([...aliases.keys()].filter((k) => k.startsWith(kind + "\0")).length + 1),
        );
      return aliases.get(key);
    };
  const relayOf = (relay) =>
    relay
      ? {
          direction: relay.direction,
          machine: alias("machine", "Machine", relay.machine),
          repo: alias("repo", "Shared repo", relay.repo),
          provider: relay.provider,
          ...(relay.peer ? { peer: relay.peer } : {}),
          state: relay.state,
        }
      : undefined;
  const remoteOf = (remote) =>
    remote
      ? {
          relay: alias("relay", "Relay", remote.relay),
          machine: alias("machine", "Machine", remote.machine),
          lastActivityAt: remote.lastActivityAt,
          onRelay: (remote.onRelay || []).map((entry) => ({
            id: entry.id,
            repo: alias("repo", "Shared repo", entry.repo),
          })),
          peers: (remote.peers || []).map((peer) => ({
            machine: alias("machine", "Machine", peer.machine),
            repos: (peer.repos || []).map((repo) => alias("repo", "Shared repo", repo)),
            agents: peer.agents,
            lastSeen: peer.lastSeen,
            list: (peer.list || []).map((agent) => ({
              id: agent.id,
              provider: agent.provider,
              repo: alias("repo", "Shared repo", agent.repo),
              lastSeen: agent.lastSeen,
            })),
          })),
        }
      : undefined;
  const mailOf = (message, extra = {}) => {
    const relay = relayOf(message.relay);
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

  // Dynamic-arrangement labels are private too: fictional bay/section names in the same sorted allocation pass.
  const bays = new Map(),
    sections = new Map();
  const bay = (id) => {
    if (!bays.has(id)) bays.set(id, "Bay " + (bays.size + 1));
    return bays.get(id);
  };
  const section = (id) => {
    if (!sections.has(id)) sections.set(id, "Section " + (sections.size + 1));
    return sections.get(id);
  };
  const arrangementOf = (value) =>
    value &&
    typeof value === "object" &&
    typeof value.roomId === "string" &&
    typeof value.sectionId === "string"
      ? {
          roomId: value.roomId,
          room: value.roomId === "unassigned" ? "Unassigned" : bay(value.roomId),
          sectionId: value.sectionId,
          section: value.sectionId === "unassigned" ? "" : section(value.sectionId),
        }
      : null;
  const roomNames = new Set(labels.rooms.map((room) => room.name.toLowerCase()));
  const repoNames = new Set(
    labels.rooms.flatMap((room) => room.repos).map((name) => name.toLowerCase()),
  );
  function project(id) {
    if (!projects.has(id)) {
      const index = projects.size,
        room = labels.rooms[index];
      let name = room?.name,
        suffix = index + 1;
      if (!room) {
        do {
          name = "Studio " + suffix++;
        } while (roomNames.has(name.toLowerCase()));
        roomNames.add(name.toLowerCase());
      }
      projects.set(id, { name, repos: room?.repos || [], count: 0 });
    }
    return projects.get(id);
  }
  function repo(row, room) {
    if (!repos.has(row.repoId)) {
      const index = room.count++;
      let name = room.repos[index];
      if (!name) {
        const stem =
          labels.repoPrefix +
          "-" +
          (room.name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "") || "studio");
        let suffix = index + 1;
        do {
          name = stem + "-" + suffix++;
        } while (repoNames.has(name.toLowerCase()));
        repoNames.add(name.toLowerCase());
      }
      repos.set(row.repoId, name);
    }
    return repos.get(row.repoId);
  }
  function rowProjection(row) {
    const room = project(row.projectId),
      repoName = repo(row, room);
    const checkoutId = typeof row.checkoutId === "string" && row.checkoutId ? row.checkoutId : null;
    const checkoutKind =
      checkoutId && ["main", "worktree", "folder"].includes(row.checkoutKind)
        ? row.checkoutKind
        : null;
    if (checkoutKind === "worktree" && !worktrees.has(checkoutId))
      worktrees.set(checkoutId, "Checkout " + (worktrees.size + 1));
    const folderKey = JSON.stringify([checkoutId, row.folder]);
    if (checkoutId && row.folder && !folders.has(folderKey))
      folders.set(folderKey, "Folder " + (folders.size + 1));
    const helper = row.source === "helper" || Object.hasOwn(row, "parentId");
    const safe = {
      id: row.id,
      host: host(row.host),
      provider: row.provider,
      source: row.source,
      status: row.status,
      projectId: row.projectId,
      project: room.name,
      projectKind: row.projectKind,
      repoId: row.repoId,
      repo: repoName,
      repoKind: row.repoKind,
      checkoutId,
      checkoutKind,
      worktree: checkoutKind === "worktree" ? worktrees.get(checkoutId) : null,
      folder: checkoutId && row.folder ? folders.get(folderKey) : "",
      paneId: typeof row.paneId === "string" && PANE.test(row.paneId) ? row.paneId : null,
      role: row.role === "overseer" && row.source === "herdr" ? "overseer" : null,
      title: helper
        ? "Helper"
        : "Live " + (row.provider === "claude" ? "Claude" : "Codex") + " session",
      inspectionIdentity: null,
      observedAt: row.observedAt,
      inventoryHealth: row.inventoryHealth,
      presence: row.presence,
      helperOverflow: row.helperOverflow,
      usage: row.usage,
      lastActivityAt: Number.isFinite(row.lastActivityAt) ? row.lastActivityAt : null,
      tool: { available: row.tool?.available === true },
    };
    const arrangement = arrangementOf(row.arrangement);
    if (arrangement) safe.arrangement = arrangement;
    if (Number.isFinite(row.tool?.observedAt)) safe.tool.observedAt = row.tool.observedAt;
    if (row.tool?.last)
      safe.tool.last = {
        name: TOOL_NAMES.has(row.tool.last.name) ? row.tool.last.name : "Tool",
        phase: row.tool.last.phase,
        outcome: row.tool.last.outcome,
        at: row.tool.last.at,
      };
    if (helper) {
      safe.parentId = row.parentId;
      safe.lineageState = row.lineageState;
      safe.taskEvidence = { state: "unavailable", summary: null };
      safe.taskStatusEvidence = { status: row.taskStatusEvidence?.status || null };
      safe.lifecycleEvidence = {
        state: row.lifecycleEvidence?.state,
        reason: row.lifecycleEvidence?.reason,
      };
    }
    return safe;
  }
  return {
    presentation: true,
    async get() {
      const inventory = await observer.get();
      // Sort only alias allocation; preserve the source roster's order and room/repository ownership.
      const sorted = [...inventory.sessions].sort(
        (a, b) =>
          String(a.projectId).localeCompare(String(b.projectId)) ||
          String(a.repoId).localeCompare(String(b.repoId)) ||
          a.id.localeCompare(b.id),
      );
      for (const row of sorted) rowProjection(row);
      const source = (value) =>
        value ? { health: value.health, observedAt: value.observedAt } : undefined;
      const bus = inventory.bus;
      return {
        presentation: {
          company: labels.company,
          label: "Live activity · fictional company labels",
        },
        sessions: inventory.sessions.map(rowProjection),
        aggregate: inventory.aggregate,
        health: inventory.health,
        observedAt: inventory.observedAt,
        error: inventory.error ? "Local session inventory unavailable" : null,
        sources: {
          herdr: source(inventory.sources?.herdr),
          desktop: source(inventory.sources?.desktop),
          ...(inventory.sources?.hosts
            ? {
                hosts: Object.fromEntries(
                  Object.entries(inventory.sources.hosts).map(([id, value]) => [
                    id === "local" ? "local" : host(id),
                    { health: value.health, observedAt: value.observedAt, agents: value.agents },
                  ]),
                ),
              }
            : {}),
        },
        bus: bus
          ? {
              health: bus.health,
              reason: bus.reason,
              observedAt: bus.observedAt,
              window: bus.window,
              messages: bus.messages.map((message) => mailOf(message)),
              ...(bus.remote ? { remote: remoteOf(bus.remote) } : {}),
            }
          : null,
        // Each remote host's own mail, masked like local mail and keyed by the host's fictional ship name.
        ...(inventory.hostBus
          ? {
              hostBus: Object.fromEntries(
                Object.entries(inventory.hostBus).map(([id, value]) => [
                  host(id),
                  {
                    health: value.health,
                    observedAt: value.observedAt,
                    window: value.window,
                    messages: (value.messages || []).map((message) =>
                      mailOf(message, { key: message.id + "@" + host(id), host: host(id) }),
                    ),
                    ...(value.remote ? { remote: remoteOf(value.remote) } : {}),
                  },
                ]),
              ),
            }
          : {}),
      };
    },
    async inspect(id) {
      return unavailable(id, "presentation-mode", now());
    },
    close() {
      return closePromise || (closePromise = Promise.resolve().then(() => observer.close?.()));
    },
    inspectMessage(id) {
      return { id, identity: null, health: "unavailable", reason: "presentation-mode", text: null };
    },
  };
}
module.exports = { makePresentationObserver };
