import type { CodexChildMetadata, SessionContext } from "./contracts.js";
import { object } from "./values.js";
function historyOrdinal(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}
export function decodeCodexChildMetadata(
  payload: Record<string, unknown>,
  child: string,
  parent: string,
  root: string,
): CodexChildMetadata | null {
  const paginated = payload.multi_agent_version === "v2" && payload.history_mode === "paginated";
  const spawn = object(object(object(payload.source).subagent).thread_spawn);
  const native = payload.thread_source === "subagent" && spawn.parent_thread_id === parent;
  const shared = payload.session_id !== undefined && payload.session_id !== child;
  if (!childAliases(payload, child, parent)) return null;
  if (shared && (payload.session_id !== root || !paginated)) return null;
  if (!supportedFormat(payload, paginated)) return null;
  if (!validNativeSource(payload, native)) return null;
  return decodeHistory(payload, { root, parent, paginated, native, shared });
}
function validNativeSource(payload: Record<string, unknown>, native: boolean) {
  return (
    (object(payload.source).subagent === undefined && payload.thread_source !== "subagent") ||
    native
  );
}
function historyBaseAllowed(value: unknown, fork: boolean) {
  return value === undefined || value === null || (fork && validHistoryBase(value));
}
function childAliases(payload: Record<string, unknown>, child: string, parent: string) {
  return (
    (payload.id === child || (payload.id === undefined && payload.session_id === child)) &&
    (payload.thread_id === undefined || payload.thread_id === child) &&
    payload.parent_thread_id === parent
  );
}
function supportedFormat(payload: Record<string, unknown>, paginated: boolean) {
  return (
    (payload.multi_agent_version === undefined && payload.history_mode === undefined) || paginated
  );
}
function validHistoryBase(value: unknown) {
  const base = object(value);
  return (
    typeof base.thread_id === "string" &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(base.thread_id) &&
    [base.end_ordinal_exclusive, base.end_byte_offset].every(
      (value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0,
    )
  );
}
function decodeHistory(
  payload: Record<string, unknown>,
  context: {
    root: string;
    parent: string;
    paginated: boolean;
    native: boolean;
    shared: boolean;
  },
): CodexChildMetadata | null {
  const { root, parent, paginated, native, shared } = context;
  const boundary = payload.subagent_history_start_ordinal;
  const fork = payload.forked_from_id !== undefined || boundary !== undefined;
  if (fork && !validFork(payload, parent, paginated)) return null;
  if (!fork && (shared || paginated) && !native) return null;
  if (!historyBaseAllowed(payload.history_base, fork)) return null;
  return { rootSessionId: root, ...(fork ? { historyStartOrdinal: boundary as number } : {}) };
}
function validFork(payload: Record<string, unknown>, parent: string, paginated: boolean) {
  return (
    paginated &&
    payload.forked_from_id === parent &&
    historyOrdinal(payload.subagent_history_start_ordinal) !== null
  );
}
export function inheritedRecord(
  record: Record<string, unknown>,
  binding: SessionContext["binding"],
) {
  const boundary = binding?.codexMetadata?.historyStartOrdinal;
  return (
    boundary !== undefined &&
    typeof record.ordinal === "number" &&
    Number.isSafeInteger(record.ordinal) &&
    record.ordinal > 0 &&
    record.ordinal < boundary
  );
}
function ownForkRecord(record: Record<string, unknown>, binding: SessionContext["binding"]) {
  const boundary = binding?.codexMetadata?.historyStartOrdinal;
  if (boundary === undefined) return true;
  const ordinal = record.ordinal;
  if (typeof ordinal !== "number" || !Number.isSafeInteger(ordinal)) return false;
  return ordinal >= boundary || (ordinal === 0 && record.type === "session_meta");
}
function codexMetadata(payload: Record<string, unknown>, context: SessionContext) {
  const { sessionId, binding } = context;
  if (binding) {
    const proof = binding.codexMetadata;
    const decoded = decodeCodexChildMetadata(
      payload,
      sessionId,
      binding.parentSessionId,
      proof?.rootSessionId ?? binding.parentSessionId,
    );
    return (
      decoded !== null &&
      decoded.rootSessionId === proof?.rootSessionId &&
      decoded.historyStartOrdinal === proof.historyStartOrdinal
    );
  }
  return (
    (payload.id === sessionId || payload.session_id === sessionId) &&
    ["id", "session_id", "thread_id"].every(
      (key) => payload[key] === undefined || payload[key] === sessionId,
    )
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
