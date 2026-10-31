import type { SessionContext } from "./contracts.js";
import { object } from "./values.js";
export function forkHistoryStart(
  payload: Record<string, unknown>,
  sessionId: string,
  parent: string,
) {
  const ordinal = payload.subagent_history_start_ordinal;
  return payload.id === sessionId &&
    payload.session_id === parent &&
    payload.parent_thread_id === parent &&
    payload.forked_from_id === parent &&
    payload.multi_agent_version === "v2" &&
    payload.history_mode === "paginated" &&
    typeof ordinal === "number" &&
    Number.isSafeInteger(ordinal) &&
    ordinal > 0
    ? ordinal
    : null;
}
export function inheritedRecord(
  record: Record<string, unknown>,
  binding: SessionContext["binding"],
) {
  const boundary = binding?.historyStartOrdinal;
  return (
    boundary !== undefined &&
    typeof record.ordinal === "number" &&
    Number.isSafeInteger(record.ordinal) &&
    record.ordinal > 0 &&
    record.ordinal < boundary
  );
}
function ownForkRecord(record: Record<string, unknown>, binding: SessionContext["binding"]) {
  const boundary = binding?.historyStartOrdinal;
  if (boundary === undefined) return true;
  const ordinal = record.ordinal;
  if (typeof ordinal !== "number" || !Number.isSafeInteger(ordinal)) return false;
  return ordinal >= boundary || (ordinal === 0 && record.type === "session_meta");
}
function codexMetadata(payload: Record<string, unknown>, context: SessionContext) {
  const { sessionId, binding } = context;
  const fork = binding ? forkHistoryStart(payload, sessionId, binding.parentSessionId) : null;
  return (
    (payload.id === sessionId || payload.session_id === sessionId) &&
    ["id", "session_id", "thread_id"].every(
      (key) =>
        payload[key] === undefined ||
        payload[key] === sessionId ||
        (key === "session_id" && fork !== null && binding?.historyStartOrdinal === fork),
    ) &&
    (!binding || payload.parent_thread_id === binding.parentSessionId)
  );
}
function codexRecord(record: Record<string, unknown>, context: SessionContext) {
  const { sessionId, binding } = context,
    payload = object(record.payload);
  if (!ownForkRecord(record, binding)) return false;
  if (record.type === "session_meta") return codexMetadata(payload, context);
  if (binding && payload.parent_thread_id && payload.parent_thread_id !== binding.parentSessionId)
    return false;
  return (
    !!record.payload &&
    (!payload.session_id || payload.session_id === sessionId) &&
    (!payload.thread_id || payload.thread_id === sessionId)
  );
}
function claudeRecord(
  record: Record<string, unknown>,
  identity: boolean,
  child: string | undefined,
) {
  const ordinary =
    record.isMeta !== true && (record.type === "user" || record.type === "assistant") && identity;
  return (
    ordinary &&
    (child === undefined
      ? record.isSidechain !== true
      : record.isSidechain === true && record.agentId === child)
  );
}
export function belongs(record: Record<string, unknown>, context: SessionContext): boolean {
  const { provider, sessionId, binding } = context;
  if (binding && (binding.provider !== provider || binding.sessionId !== sessionId)) return false;
  const canonical = binding ? binding.parentSessionId : sessionId;
  // SDK SessionMessage.session_id is derived from canonical disk sessionId.
  // A raw snake-case transport field is not a second transcript identity.
  if (provider === "claude")
    return claudeRecord(record, record.sessionId === canonical, binding?.sessionId);
  return codexRecord(record, context);
}
