import crypto from "node:crypto";
import type { ObserverRow } from "../../shared/observer.js";
import type { HelperRow, ChildBinding, TaskEvent, Candidate } from "./contracts.js";
const ACTIVE_ROW_MS = 20000;
const ACTIVE_TASK_MS = 6000;
const HELPER_ID_LENGTH = 24;
const FAILED = "failed";
const TERMINAL = new Set(["completed", FAILED, "killed", "stopped"]);
export const identity = (row: HelperRow) => row.provider + ":" + (row.sessionId ?? "");
export const grouping = (row: HelperRow) => ({
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
export const helperId = (binding: ChildBinding) =>
  "obs_" +
  crypto
    .createHash("sha256")
    .update(JSON.stringify([binding.provider, binding.parentSessionId, binding.sessionId]))
    .digest("hex")
    .slice(0, HELPER_ID_LENGTH);
function lifecycle(
  provider: ObserverRow["provider"],
  relationship: string,
  task: TaskEvent | null,
): NonNullable<ObserverRow["lifecycleEvidence"]> {
  if (provider === "codex") {
    if (relationship !== "closed" && task?.source === "codex:shutdown_complete")
      return {
        state: "closed",
        reason: "closed",
        source: task.source,
        observedAt: task.observedAt,
      };
    return {
      state: relationship,
      reason: relationship === "closed" ? "closed" : null,
      source: relationship === "unknown" ? "codex:spawn_agent" : "codex:thread_spawn_edges",
      observedAt: null,
    };
  }
  return claudeLifecycle(task);
}
function claudeLifecycle(task: TaskEvent | null): NonNullable<ObserverRow["lifecycleEvidence"]> {
  if (task?.status === "killed" || task?.status === "stopped")
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
export function ownStatus(
  task: TaskEvent | null,
  at: number,
  lastActivityAt: string | null = null,
): ObserverRow["status"] {
  if (task && TERMINAL.has(task.status)) return "done";
  if (running(task, at)) return "working";
  const active = typeof lastActivityAt === "string" ? Date.parse(lastActivityAt) : NaN;
  return Number.isFinite(active) && at >= active && at - active <= ACTIVE_ROW_MS
    ? "working"
    : "unknown";
}
function running(task: TaskEvent | null, at: number) {
  return (
    task?.status === "running" &&
    task.observedAt !== null &&
    Number.isFinite(task.observedAt) &&
    at >= task.observedAt &&
    at - task.observedAt <= ACTIVE_TASK_MS
  );
}
function newer(own: TaskEvent, event: TaskEvent) {
  return (
    event.observedAt !== null && (own.observedAt === null || event.observedAt > own.observedAt)
  );
}
function taskStatus(
  binding: ChildBinding,
  parent: HelperProjectionInput,
  candidate: Candidate,
  provider: ObserverRow["provider"],
) {
  const own = binding.projection?.ownTask;
  const event =
    candidate.event ?? (provider === "codex" ? parent?.helperEvents.get(candidate.child) : null);
  if (!own) return event || null;
  if (!event) return own;
  return newer(own, event) ? event : own;
}

type HelperProjectionInput = ChildBinding["projection"] | undefined;
function assignmentEvidence(assignment: Candidate["spawn"] | null | undefined) {
  return {
    state: assignment?.summary ? (assignment.partial ? "partial" : "available") : "unavailable",
    summary: assignment?.summary || null,
    source: assignment?.source || null,
    observedAt: assignment?.observedAt ?? null,
  };
}
function statusEvidence(status: TaskEvent | null) {
  return {
    status: status?.status || null,
    source: status?.source || null,
    observedAt: status?.observedAt ?? null,
  };
}
export function lineage(
  parent: HelperRow,
  binding: ChildBinding,
  candidate: Candidate,
  projection: HelperProjectionInput,
) {
  const assignment = candidate.spawn || projection?.helperSpawns.get(candidate.child);
  const status = taskStatus(binding, projection, candidate, parent.provider);
  const taskEvidence = assignmentEvidence(assignment);
  return {
    status,
    value: {
      ...grouping(parent),
      usage: binding.usage || null,
      parentId: parent.id,
      lineageState: candidate.state,
      taskEvidence,
      lifecycleEvidence: lifecycle(parent.provider, candidate.state, status),
      taskStatusEvidence: statusEvidence(status),
      task: taskEvidence.summary || "Task unavailable.",
    },
  };
}
