import { LIMITS } from "./limits.js";
import type { ObserverRow } from "../../shared/observer.js";
import {
  ID,
  UUID,
  PROVIDERS,
  HEALTH,
  hash,
  text,
  word,
  time,
  count,
  oneOf,
  remap,
  matches,
  has,
  record,
} from "./fields.js";
const SOURCES = new Set(["herdr", "helper"] as const);
const STATUSES = new Set(["working", "blocked", "idle", "done", "unknown"] as const);
const EVENT_SKEW = 30000;
const EVENT_EXPIRY = 24 * 60 * 60 * 1000;
const EVENT_STALE = 5 * 60 * 1000;
function counters(usage: unknown) {
  if (!record(usage)) return null;
  const counter = (value: unknown) =>
    record(value)
      ? { value: count(value.value), state: word(value.state, LIMITS.WORD_SHORT) }
      : null;
  const result = {
    inputTokens: counter(usage.inputTokens),
    outputTokens: counter(usage.outputTokens),
    cacheReadTokens: counter(usage.cacheReadTokens),
    cacheWriteTokens: counter(usage.cacheWriteTokens),
    coverage: word(usage.coverage, LIMITS.WORD_MAX),
    observedAt: time(usage.observedAt),
  };
  return result;
}
function tool(value: unknown) {
  if (!record(value)) return { available: false };
  const result: ObserverRow["tool"] = { available: value.available === true };
  if (record(value.last))
    result.last = {
      name: text(value.last.name, LIMITS.TOOL_NAME),
      phase: word(value.last.phase, LIMITS.WORD_SHORT),
      outcome: word(value.last.outcome, LIMITS.WORD_SHORT),
      at: time(value.last.at),
    };
  if (value.usage) result.usage = counters(value.usage);
  return result;
}
const opaque = (prefix: string, host: string, value: unknown) =>
  typeof value === "string" && value
    ? prefix + hash(host, value).slice(0, LIMITS.OPAQUE_HASH)
    : null;
const prefixOf = (value: unknown, fallback: string) =>
  typeof value === "string" && /^(prj|repo|dir)_/.test(value)
    ? value.slice(0, value.indexOf("_") + 1)
    : fallback;

function rowIdentity(host: string, row: Record<string, unknown>) {
  const helper = row.source === "helper" || Object.hasOwn(row, "parentId");
  const sessionId =
    typeof row.sessionId === "string" &&
    (UUID.test(row.sessionId) || (helper && /^[A-Za-z0-9-]{1,64}$/.test(row.sessionId)))
      ? row.sessionId
      : null;
  const id = remap(host, String(row.id));
  let inspectionIdentity = null;
  if (typeof row.inspectionIdentity === "string") {
    if (/^helper:obs_[a-f0-9]{24}$/.test(row.inspectionIdentity))
      inspectionIdentity = "helper:" + id;
    else if (sessionId && row.inspectionIdentity === String(row.provider) + ":" + sessionId)
      inspectionIdentity = row.inspectionIdentity;
  }
  return { id, helper, sessionId, inspectionIdentity };
}
function projectFields(host: string, row: Record<string, unknown>) {
  return {
    projectId: opaque(prefixOf(row.projectId, "prj_"), host, row.projectId),
    project: text(row.project, LIMITS.LABEL) || "Unassigned",
    projectKind: word(row.projectKind, LIMITS.WORD_SHORT),
    repoId: opaque(prefixOf(row.repoId, "dir_"), host, row.repoId),
    repo: text(row.repo, LIMITS.LABEL) || "Unassigned",
    repoKind: word(row.repoKind, LIMITS.WORD_SHORT),
    checkoutId: opaque("checkout_", host, row.checkoutId),
    checkoutKind:
      typeof row.checkoutId === "string" && row.checkoutId
        ? oneOf(row.checkoutKind, new Set(["main", "worktree", "folder"] as const))
        : null,
    worktree: text(row.worktree, LIMITS.LABEL),
    folder: text(row.folder, LIMITS.TITLE) || "",
  };
}
function helperFields(host: string, row: Record<string, unknown>) {
  const result: Partial<ObserverRow> = {};
  result.parentId = matches(ID, row.parentId) ? remap(host, row.parentId) : null;
  result.lineageState = word(row.lineageState, LIMITS.WORD_MEDIUM);
  const task = record(row.taskEvidence) ? row.taskEvidence : {};
  result.taskEvidence = {
    state: word(task.state, LIMITS.WORD_SHORT) || "unavailable",
    summary: text(task.summary, LIMITS.TASK),
    source: word(task.source, LIMITS.WORD_MEDIUM),
    observedAt: time(task.observedAt),
  };
  const status = record(row.taskStatusEvidence) ? row.taskStatusEvidence : {};
  result.taskStatusEvidence = {
    status: word(status.status, LIMITS.WORD_SHORT),
    source: word(status.source, LIMITS.WORD_MEDIUM),
    observedAt: time(status.observedAt),
  };
  const life = record(row.lifecycleEvidence) ? row.lifecycleEvidence : {};
  result.lifecycleEvidence = {
    state: word(life.state, LIMITS.WORD_MEDIUM),
    reason: text(life.reason, LIMITS.TITLE),
  };
  result.task = text(row.task, LIMITS.TASK) || "Task unavailable.";
  return result;
}
/* One remote row → a hub row. Unknown fields are dropped; ids are host-scoped; observedAt is the hub's receipt time. */
export function sanitizeRow(host: string, row: unknown, receivedAt: number): ObserverRow | null {
  if (
    !record(row) ||
    !matches(ID, row.id) ||
    !has(PROVIDERS, row.provider) ||
    !has(SOURCES, row.source)
  )
    return null;
  const identity = rowIdentity(host, row);
  const safe: ObserverRow = {
    id: identity.id,
    host,
    provider: row.provider,
    source: row.source,
    role: row.role === "overseer" ? "overseer" : null,
    // A remote pane id is namespaced so it can never match a local Herdr pane: control actions reject it outright.
    paneId: word(row.paneId, LIMITS.PANE_TEXT) ? host + "/" + String(row.paneId) : null,
    title: text(row.title, LIMITS.TITLE) || row.provider,
    ...projectFields(host, row),
    status: oneOf(row.status, STATUSES, "unknown"),
    sessionId: identity.sessionId,
    identitySource: word(row.identitySource, LIMITS.WORD_SHORT),
    identityHealth: oneOf(row.identityHealth, HEALTH, "unavailable"),
    tool: tool(row.tool),
    usage: counters(row.usage),
    observedAt: receivedAt,
    inventoryHealth: oneOf(row.inventoryHealth, HEALTH, "unavailable"),
    inspectionIdentity: identity.inspectionIdentity,
    presence: word(row.presence, LIMITS.WORD_MEDIUM),
    helperOverflow: count(row.helperOverflow) || 0,
  };
  Object.assign(safe, optionalFields(row));
  if (identity.helper) Object.assign(safe, helperFields(host, row));
  Object.assign(safe, checkoutFields(host, row.checkoutObservation, receivedAt));
  return safe;
}

function validEventTime(value: unknown, now: number): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= now + EVENT_SKEW &&
    now - value <= EVENT_EXPIRY
  );
}
function checkoutFields(host: string, value: unknown, now: number): Partial<ObserverRow> {
  const checkoutObservation = remoteCheckout(host, value, now);
  return checkoutObservation ? { checkoutObservation } : {};
}
function nullableText(value: unknown) {
  return value === null || typeof value === "string";
}
function checkoutLabels(value: Record<string, unknown>) {
  return (
    typeof value.repo === "string" &&
    nullableText(value.repoId) &&
    nullableText(value.checkoutId) &&
    nullableText(value.worktree)
  );
}
export function ageCheckoutObservation(
  value: ObserverRow["checkoutObservation"],
  now: number,
): ObserverRow["checkoutObservation"] {
  if (!value || !validEventTime(value.observedAt, now)) return undefined;
  return { ...value, state: now - value.observedAt > EVENT_STALE ? "stale" : value.state };
}
function remoteCheckout(
  host: string,
  value: unknown,
  now: number,
): ObserverRow["checkoutObservation"] {
  if (
    !record(value) ||
    value.source !== "shell-entry" ||
    !has(new Set(["observed", "stale"] as const), value.state) ||
    !validEventTime(value.observedAt, now) ||
    !has(new Set(["main", "worktree", "folder", null]), value.checkoutKind) ||
    !checkoutLabels(value)
  )
    return undefined;
  return ageCheckoutObservation(
    {
      source: "shell-entry",
      observedAt: value.observedAt,
      state: value.state,
      repoId: opaque(prefixOf(value.repoId, "dir_"), host, value.repoId),
      repo: text(value.repo, LIMITS.LABEL) || "Unassigned",
      checkoutId: opaque("checkout_", host, value.checkoutId),
      checkoutKind: oneOf(value.checkoutKind, new Set(["main", "worktree", "folder"] as const)),
      worktree: text(value.worktree, LIMITS.LABEL),
    },
    now,
  );
}

function optionalFields(row: Record<string, unknown>) {
  const extra: Partial<ObserverRow> = {};
  if (typeof row.lastActivityAt === "number" && Number.isFinite(row.lastActivityAt))
    extra.lastActivityAt = row.lastActivityAt;
  if (row.projectHome === true) extra.projectHome = true;
  return extra;
}
