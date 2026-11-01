const LIST_TOOL = "LS";
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
  LIST_TOOL,
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

import { PANE } from "../control/index.js";
import { NumberedAliases } from "./aliases.js";
import type { Aliases } from "./aliases.js";
import type { Row, ProjectedRow } from "./types.js";
type Checkout = Pick<ProjectedRow, "checkoutId" | "checkoutKind" | "worktree" | "folder">;
function makeCheckouts() {
  const worktrees = new NumberedAliases("Checkout"),
    folders = new NumberedAliases("Folder");
  return (row: Row): Checkout => {
    const checkoutId = checkoutIdentity(row.checkoutId);
    const kind = row.checkoutKind;
    const checkoutKind =
      checkoutId && (kind === "main" || kind === "worktree" || kind === "folder") ? kind : null;
    const worktree = checkoutKind === "worktree" ? worktrees.get(checkoutId || "") : null;
    const folder =
      checkoutId && row.folder ? folders.get(JSON.stringify([checkoutId, row.folder])) : "";
    return { checkoutId, checkoutKind, worktree, folder };
  };
}
function toolOf(row: Row): ProjectedRow["tool"] {
  const tool: ProjectedRow["tool"] = { available: row.tool?.available === true };
  if (typeof row.tool?.observedAt === "number" && Number.isFinite(row.tool.observedAt))
    tool.observedAt = row.tool.observedAt;
  if (row.tool?.last)
    tool.last = {
      name: TOOL_NAMES.has(row.tool.last.name || "") ? row.tool.last.name : "Tool",
      phase: row.tool.last.phase,
      outcome: row.tool.last.outcome,
      at: row.tool.last.at,
    };
  return tool;
}
function helperEvidence(row: Row) {
  return {
    parentId: row.parentId,
    lineageState: row.lineageState,
    taskEvidence: { state: "unavailable", summary: null },
    taskStatusEvidence: { status: row.taskStatusEvidence?.status || null },
    lifecycleEvidence: {
      state: row.lifecycleEvidence?.state,
      reason: row.lifecycleEvidence?.reason,
    },
  };
}
function rowProjection(row: Row, aliases: Aliases, checkout: (row: Row) => Checkout): ProjectedRow {
  const room = aliases.project(row.projectId),
    repo = aliases.repo(row, room);
  const helper = row.source === "helper" || Object.hasOwn(row, "parentId");
  const arrangement = aliases.arrangement(row.arrangement);
  return {
    id: row.id,
    host: aliases.host(row.host),
    provider: row.provider,
    source: row.source,
    status: row.status,
    projectId: row.projectId,
    project: room.name,
    projectKind: row.projectKind,
    repoId: row.repoId,
    repo,
    repoKind: row.repoKind,
    ...checkout(row),
    ...observationProjection(row, aliases, checkout),
    paneId: typeof row.paneId === "string" && PANE.test(row.paneId) ? row.paneId : null,
    role: row.role === "overseer" && row.source === "herdr" ? "overseer" : null,
    title: titleOf(row, helper),
    inspectionIdentity: null,
    observedAt: row.observedAt,
    inventoryHealth: row.inventoryHealth,
    presence: row.presence,
    helperOverflow: row.helperOverflow,
    usage: row.usage,
    lastActivityAt:
      typeof row.lastActivityAt === "number" && Number.isFinite(row.lastActivityAt)
        ? row.lastActivityAt
        : null,
    tool: toolOf(row),
    ...(arrangement ? { arrangement } : {}),
    ...(helper ? helperEvidence(row) : {}),
  };
}
function observationProjection(row: Row, aliases: Aliases, checkout: (row: Row) => Checkout) {
  const value = row.checkoutObservation;
  if (!value) return {};
  const names = checkout({
    id: row.id,
    checkoutId: value.checkoutId,
    checkoutKind: value.checkoutKind,
  });
  return {
    checkoutObservation: {
      source: value.source,
      observedAt: value.observedAt,
      state: value.state,
      repoId: value.repoId,
      repo: aliases.repo(
        { id: row.id, repoId: value.repoId, projectId: row.projectId },
        aliases.project(row.projectId),
      ),
      checkoutId: names.checkoutId,
      checkoutKind: names.checkoutKind,
      worktree: names.worktree || null,
    },
  };
}
export function makeRows(aliases: Aliases) {
  const checkout = makeCheckouts();
  return (row: Row) => rowProjection(row, aliases, checkout);
}

function checkoutIdentity(value: Row["checkoutId"]) {
  return typeof value === "string" && value ? value : null;
}

function titleOf(row: Row, helper: boolean) {
  return helper
    ? "Helper"
    : "Live " + (row.provider === "claude" ? "Claude" : "Codex") + " session";
}
