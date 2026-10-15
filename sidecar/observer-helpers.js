"use strict";
const crypto = require("node:crypto");
const path = require("node:path");
const os = require("node:os");
const { makePrivateSnapshotQuery } = require("./observer-bus.js");

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const MAX_HELPERS = 64,
  MAX_DEPTH = 3,
  NEARBY = 8,
  MAX_EDGES = 4096;
const identity = (row) => row.provider + ":" + row.sessionId;
const grouping = (row) => ({
  projectId: row.projectId,
  project: row.project,
  projectKind: row.projectKind,
  repoId: row.repoId,
  repo: row.repo,
  worktreeId: row.worktreeId,
  checkoutId: row.checkoutId,
  checkoutKind: row.checkoutKind,
  folder: row.folder,
  worktree: row.worktree,
  ...(row.arrangement ? { arrangement: row.arrangement } : {}),
});
const helperId = (binding) =>
  "obs_" +
  crypto
    .createHash("sha256")
    .update(JSON.stringify([binding.provider, binding.parentSessionId, binding.sessionId]))
    .digest("hex")
    .slice(0, 24);

function lifecycle(provider, relationship, task) {
  if (provider === "codex") {
    if (relationship === "open" && task?.source === "codex:shutdown_complete")
      return {
        state: "closed",
        reason: "closed",
        source: task.source,
        observedAt: task.observedAt,
      };
    return {
      state: relationship,
      reason: relationship === "closed" ? "closed" : null,
      source: "codex:thread_spawn_edges",
      observedAt: null,
    };
  }
  if (["killed", "stopped"].includes(task?.status))
    return {
      state: "closed",
      reason: task.status === "killed" ? "killed" : "closed",
      source: task.source,
      observedAt: task.observedAt,
    };
  return { state: "unknown", reason: null, source: null, observedAt: null };
}
// Background Claude helpers rarely emit a fresh 'running' task event, so a conversation row the helper itself wrote
// in the last 20s also counts as working. That is evidence of activity, not process liveness: with no recent row and
// no terminal event the helper stays unknown.
const ACTIVE_ROW_MS = 20000;
function ownStatus(task, at, lastActivityAt = null) {
  if (["completed", "failed", "killed", "stopped"].includes(task?.status)) return "done";
  if (
    task?.status === "running" &&
    Number.isFinite(task.observedAt) &&
    at >= task.observedAt &&
    at - task.observedAt <= 6000
  )
    return "working";
  const active = typeof lastActivityAt === "string" ? Date.parse(lastActivityAt) : NaN;
  return Number.isFinite(active) && at >= active && at - active <= ACTIVE_ROW_MS
    ? "working"
    : "unknown";
}

// Shared bounded selector: production runs this in the SQLite worker; direct fixtures can inject SQLite.
function readHelperEdges(options = {}) {
  return makePrivateSnapshotQuery({
    file:
      options.file ||
      path.join(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), "state_5.sqlite"),
    loadSqlite: options.loadSqlite,
    tempRoot: options.tempRoot,
    copyFile: options.copyFile,
  })((database) => ({
    rows: database
      .query(
        "SELECT parent_thread_id, child_thread_id, status FROM thread_spawn_edges LIMIT " +
          (MAX_EDGES + 1),
      )
      .all(),
  }));
}

// Persisted lineage proves a relationship, never a running task.
function makeHelperObserver(options = {}) {
  const { transcripts, now } = options;
  if (typeof now !== "function")
    throw new TypeError("Helper observer requires an injected now clock");
  if (!transcripts) throw new TypeError("Helper observer requires transcripts");
  const readEdges = options.readEdges || (() => readHelperEdges(options));
  let bindings = new Map();

  async function prepareChildren(
    parents,
    readSummary = (row) => transcripts.read(row.id, row.provider, row.sessionId),
  ) {
    const rows = [],
      annotations = new Map(),
      overflow = new Map(),
      nextBindings = new Map(),
      groupOwners = new Map();
    function commitBindings(acceptedIds) {
      bindings = new Map([...nextBindings].filter(([id]) => acceptedIds.has(id)));
    }
    const directParents = new Map(),
      ambiguousBindings = new Set(),
      capped = new Map();
    if (
      typeof transcripts.bindChild !== "function" ||
      typeof transcripts.claudeCandidates !== "function"
    ) {
      return {
        rows,
        annotations,
        overflow,
        health: "unavailable",
        reason: "unsupported",
        commitBindings,
      };
    }
    const exact = new Map();
    for (const row of parents) {
      if (row.inventoryHealth !== "available" || !row.sessionId || !row.inspectionIdentity)
        continue;
      const key = identity(row);
      exact.set(key, exact.has(key) ? null : row);
    }
    const roots = [];
    for (const row of [...exact.values()]
      .filter(Boolean)
      .sort((a, b) => identity(a).localeCompare(identity(b)))) {
      if (
        ["codex", "claude"].includes(row.provider) &&
        (row.tool?.available === true || (await readSummary(row)).available)
      )
        roots.push(row);
    }
    let source = { rows: [] };
    if (roots.some((row) => row.provider === "codex")) {
      try {
        source = await readEdges();
      } catch (_) {
        source = { reason: "unreadable" };
      }
    }
    if (Array.isArray(source.rows) && source.rows.length > MAX_EDGES)
      source = { reason: "too-many-edges" };
    const edges = source.rows;
    const byParent = new Map(),
      incoming = new Map(),
      invalid = new Set();
    if (Array.isArray(edges) && edges.length <= MAX_EDGES) {
      for (const edge of edges) {
        const parent = edge.parent_thread_id,
          child = edge.child_thread_id;
        if (!UUID.test(parent || "") || !UUID.test(child || "")) continue;
        if (!["open", "closed"].includes(edge.status)) {
          invalid.add(child);
          continue;
        }
        if (incoming.has(child)) invalid.add(child);
        incoming.set(child, parent);
        if (!byParent.has(parent)) byParent.set(parent, []);
        byParent.get(parent).push({ child, state: edge.status });
      }
      // Reject every node in a cycle, including a verified root. A visited set also bounds each traversal.
      for (const start of incoming.keys()) {
        const visited = new Set();
        let node = start;
        while (incoming.has(node) && !visited.has(node)) {
          visited.add(node);
          node = incoming.get(node);
        }
        if (visited.has(node)) for (const member of visited) invalid.add(member);
      }
    }
    const provedBindings = new Map();
    async function proveChild(provider, child, parent, file, spawn) {
      const key = JSON.stringify([provider, child, parent, file || null]);
      if (!provedBindings.has(key))
        provedBindings.set(key, await transcripts.bindChild(provider, child, parent, file, spawn));
      return provedBindings.get(key);
    }
    let accepted = 0;
    async function visit(parent, depth, visited, claudeAncestors = []) {
      if (
        depth >= MAX_DEPTH ||
        visited.has(identity(parent)) ||
        (parent.provider === "codex" && invalid.has(parent.sessionId))
      )
        return;
      const ancestry = new Set(visited);
      ancestry.add(
        parent.provider === "claude" && nextBindings.has(parent.id)
          ? "claude:" + nextBindings.get(parent.id).parentSessionId + ":" + parent.sessionId
          : identity(parent),
      );
      const parentBinding = nextBindings.get(parent.id);
      const parentProjection = parentBinding?.projection || transcripts.helperMetadata?.(parent.id);
      const candidates =
        parent.provider === "codex"
          ? (byParent.get(parent.sessionId) || []).sort((a, b) => a.child.localeCompare(b.child))
          : parent.provider === "claude"
            ? (
                await transcripts.claudeCandidates(
                  parent.sessionId,
                  nextBindings.get(parent.id),
                  parent.id,
                )
              ).map((value) => ({ ...value, child: value.sessionId, state: "verified" }))
            : [];
      const parentClaims =
        parent.provider === "claude" ? transcripts.claudeClaims?.(parent.id) : null;
      for (const candidate of candidates) {
        const key =
          parent.provider +
          ":" +
          (parent.provider === "claude" ? candidate.canonical + ":" : "") +
          candidate.child;
        if (
          (parent.provider === "codex" && invalid.has(candidate.child)) ||
          ancestry.has(key) ||
          (exact.has(key) && !exact.get(key))
        )
          continue;
        const binding = await proveChild(
          parent.provider,
          candidate.child,
          candidate.canonical || parent.sessionId,
          candidate.file,
          candidate.spawn,
        );
        if (!binding) continue;
        const existing = exact.get(key);
        const id = existing?.id || helperId(binding);
        if (
          parent.provider === "claude" &&
          claudeAncestors.some(
            (ancestor) =>
              ancestor.canonical === binding.parentSessionId &&
              (!ancestor.claims?.available || ancestor.claims.has(candidate.child)),
          )
        ) {
          ambiguousBindings.add(id);
          if (nextBindings.delete(id)) accepted--;
          annotations.delete(id);
          continue;
        }
        if (ambiguousBindings.has(id)) continue;
        if (nextBindings.has(id)) {
          if (directParents.get(id) !== parent.id) {
            ambiguousBindings.add(id);
            nextBindings.delete(id);
            annotations.delete(id);
            accepted--;
          }
          continue;
        }
        if (accepted >= MAX_HELPERS) {
          capped.set(parent.id, (capped.get(parent.id) || 0) + 1);
          continue;
        }
        directParents.set(id, parent.id);
        nextBindings.set(id, binding);
        accepted++;
        const projection = binding.projection;
        const assignment = candidate.spawn || parentProjection?.helperSpawns.get(candidate.child);
        const parentEvent =
          parent.provider === "claude"
            ? candidate.event
            : parentProjection?.helperEvents.get(candidate.child);
        let taskStatus = projection?.ownTask || parentEvent || null;
        if (
          projection?.ownTask &&
          parentEvent &&
          parentEvent.observedAt != null &&
          (projection.ownTask.observedAt == null ||
            parentEvent.observedAt > projection.ownTask.observedAt)
        )
          taskStatus = parentEvent;
        const taskEvidence = {
          state: assignment?.summary
            ? assignment.partial
              ? "partial"
              : "available"
            : "unavailable",
          summary: assignment?.summary || null,
          source: assignment?.source || null,
          observedAt: assignment?.observedAt ?? null,
        };
        const lifecycleEvidence = lifecycle(parent.provider, candidate.state, taskStatus);
        const lineage = {
          ...grouping(parent),
          usage: binding.usage || null,
          parentId: parent.id,
          lineageState: candidate.state,
          taskEvidence,
          lifecycleEvidence,
          taskStatusEvidence: {
            status: taskStatus?.status || null,
            source: taskStatus?.source || null,
            observedAt: taskStatus?.observedAt ?? null,
          },
          task: taskEvidence.summary || "Task unavailable.",
        };
        const child = existing
          ? { ...existing, ...lineage }
          : {
              id,
              provider: parent.provider,
              sessionId: candidate.child,
              title: binding.nickname || "Helper",
              source: "helper",
              presence: "verified-lineage",
              status: ownStatus(
                taskStatus,
                now(),
                parent.provider === "claude" ? projection?.lastActivityAt : null,
              ),
              tool: { available: false },
              observedAt: now(),
              inventoryHealth: "available",
              inspectionIdentity: "helper:" + id,
              ...lineage,
            };
        if (existing) annotations.set(id, lineage);
        else rows.push(child);
        await visit(
          child,
          depth + 1,
          ancestry,
          parent.provider === "claude"
            ? [
                ...claudeAncestors,
                {
                  canonical: parentBinding?.parentSessionId || parent.sessionId,
                  claims: parentClaims,
                },
              ]
            : [],
        );
      }
    }
    function lineageDepth(row) {
      const ancestors = new Set();
      let sessionId = row.sessionId;
      while (row.provider === "codex" && incoming.has(sessionId) && !ancestors.has(sessionId)) {
        ancestors.add(sessionId);
        sessionId = incoming.get(sessionId);
      }
      return ancestors.size;
    }
    // Visit ancestors first so an independently observed child cannot claim its
    // descendants using its old room before the parent supplies inherited grouping.
    roots.sort(
      (a, b) => lineageDepth(a) - lineageDepth(b) || identity(a).localeCompare(identity(b)),
    );
    const observedRoots = new Map(roots.map((row) => [identity(row), row]));
    const ownership = new Map();
    for (const row of roots) {
      const chain = [],
        seen = new Set();
      let child = row.sessionId,
        ancestor = null;
      while (
        row.provider === "codex" &&
        incoming.has(child) &&
        !seen.has(child) &&
        !invalid.has(child) &&
        (!exact.has("codex:" + child) || exact.get("codex:" + child))
      ) {
        seen.add(child);
        const parent = incoming.get(child);
        chain.push({ child, parent });
        ancestor = observedRoots.get("codex:" + parent);
        if (ancestor) break;
        child = parent;
      }
      // DB edges supply candidates only. Every intervening transcript must prove
      // the chain before an observed pane loses its independent-root ownership.
      if (!ancestor || invalid.has(ancestor.sessionId)) continue;
      let proved = true;
      for (const edge of chain) {
        if (!(await proveChild("codex", edge.child, edge.parent))) {
          proved = false;
          break;
        }
      }
      if (proved) {
        const inherited = ownership.get(ancestor.id);
        ownership.set(row.id, { root: inherited?.root || ancestor });
      }
    }
    for (const parent of roots) {
      // Proved ownership suppresses independent rediscovery of an ancestor's subtree.
      if (!nextBindings.has(parent.id) && !ownership.has(parent.id))
        await visit(parent, 0, new Set());
    }
    for (const [id, owner] of ownership) {
      // A depth or total limit may omit an authoritative pane from the represented
      // subtree. Keep its proved grouping without advertising a helper parent.
      if (!nextBindings.has(id)) {
        annotations.set(id, grouping(owner.root));
        groupOwners.set(id, owner.root.id);
      }
    }
    // Conflicting direct-parent claims cannot leave a guessed child or orphaned subtree.
    let removed = true;
    while (removed) {
      removed = false;
      for (const [id, parentId] of directParents)
        if (ambiguousBindings.has(parentId) && !ambiguousBindings.has(id)) {
          ambiguousBindings.add(id);
          nextBindings.delete(id);
          annotations.delete(id);
          removed = true;
        }
    }
    for (let index = rows.length - 1; index >= 0; index--)
      if (ambiguousBindings.has(rows[index].id)) rows.splice(index, 1);
    const represented = new Map();
    for (const item of [...rows, ...annotations.values()])
      if (item.parentId) {
        const count = (represented.get(item.parentId) || 0) + 1;
        represented.set(item.parentId, count);
        item.helperSlot = count <= NEARBY ? count - 1 : null;
      }
    for (const parentId of new Set([...represented.keys(), ...capped.keys()])) {
      const count =
        Math.max(0, (represented.get(parentId) || 0) - NEARBY) + (capped.get(parentId) || 0);
      if (count) overflow.set(parentId, count);
    }
    return {
      rows,
      annotations,
      overflow,
      groupOwners,
      commitBindings,
      health: source.reason ? "unavailable" : "available",
      reason: source.reason || null,
    };
  }
  async function children(parents) {
    const result = await prepareChildren(parents);
    result.commitBindings(
      new Set([...result.rows.map((row) => row.id), ...result.annotations.keys()]),
    );
    return result;
  }
  async function inspect(row) {
    const binding = bindings.get(row.id);
    if (!binding || row.sessionId !== binding.sessionId || row.provider !== binding.provider)
      return { available: false };
    const result = await transcripts.inspectChild(row.id, binding);
    if (bindings.get(row.id) !== binding) return { available: false };
    return result.available
      ? {
          ...result,
          taskEvidence: row.taskEvidence,
          taskStatusEvidence: row.taskStatusEvidence,
          lifecycleEvidence: row.lifecycleEvidence,
        }
      : result;
  }
  return { children, prepareChildren, inspect };
}
module.exports = { makeHelperObserver, readHelperEdges, grouping };
