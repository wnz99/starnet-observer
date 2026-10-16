import type { SessionContext } from "./contracts.js";
import { object } from "./values.js";
function codexMetadata(payload: Record<string, unknown>, context: SessionContext) {
  const { sessionId, binding } = context;
  return (
    (payload.id === sessionId || payload.session_id === sessionId) &&
    ["id", "session_id", "thread_id"].every(
      (key) => payload[key] === undefined || payload[key] === sessionId,
    ) &&
    (!binding || payload.parent_thread_id === binding.parentSessionId)
  );
}
function codexRecord(record: Record<string, unknown>, context: SessionContext) {
  const { sessionId, binding } = context,
    payload = object(record.payload);
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
