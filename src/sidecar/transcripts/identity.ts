const MAX_NAME_CHARS = 120;
const LINE_FEED = 10;
import { cleanControls } from "../inspector/helper-state.js";
import { recordBelongsToSession } from "../inspector/index.js";
import { object, string } from "../inspector/values.js";
import { redactText } from "../inspector/fields.js";
import type { ChildBinding, Provider } from "./contracts.js";
import { decodeCodexChildMetadata, inheritedRecord } from "../inspector/identity.js";
export const cleanName = (value: unknown) =>
  typeof value === "string" ? cleanControls(value).slice(0, MAX_NAME_CHARS) : "";
export function childMetadata(data: Buffer, binding: ChildBinding) {
  return new ChildIdentity(binding).read(data);
}
function paginatedHeaderOrdinal(ordinal: unknown, firstLine: boolean) {
  if (ordinal === 0 || (firstLine && ordinal === 1)) return ordinal;
  return null;
}
class ChildIdentity {
  private verified = false;
  private nickname: string | null = null;
  constructor(private readonly binding: ChildBinding) {}
  private prepareMetadata(record: Record<string, unknown>, firstLine: boolean) {
    const binding = this.binding;
    const payload = object(record.payload);
    const decoded = decodeCodexChildMetadata(
      payload,
      binding.sessionId,
      binding.parentSessionId,
      binding.codexMetadata?.rootSessionId ?? binding.parentSessionId,
    );
    if (!decoded) return false;
    if (payload.history_mode === "paginated") {
      const ordinal = paginatedHeaderOrdinal(record.ordinal, firstLine);
      if (ordinal === null) return false;
      decoded.headerOrdinal = ordinal;
    }
    if (!Object.isFrozen(binding)) binding.codexMetadata = Object.freeze(decoded);
    return (
      binding.codexMetadata?.rootSessionId === decoded.rootSessionId &&
      binding.codexMetadata.headerOrdinal === decoded.headerOrdinal &&
      binding.codexMetadata.historyStartOrdinal === decoded.historyStartOrdinal
    );
  }
  private codex(record: Record<string, unknown>, firstLine: boolean) {
    const binding = this.binding;
    if (this.verified && inheritedRecord(record, binding)) return true;
    if (!this.prepareMetadata(record, firstLine)) return false;
    if (
      this.verified ||
      !recordBelongsToSession(record, binding.provider, binding.sessionId, binding)
    )
      return false;
    this.verified = true;
    const name = string(object(record.payload).agent_nickname);
    this.nickname = name === undefined ? null : cleanName(redactText(name));
    return true;
  }
  private consume(record: Record<string, unknown>, firstLine: boolean) {
    const binding = this.binding;
    if (binding.provider === "codex" && record.type === "session_meta")
      return this.codex(record, firstLine);
    if (claudeIdentity(record, binding)) {
      if (!recordBelongsToSession(record, binding.provider, binding.sessionId, binding))
        return false;
      this.verified = true;
    }
    return true;
  }
  read(data: Buffer) {
    const complete = data.subarray(0, Math.max(0, data.lastIndexOf(LINE_FEED)));
    for (const [index, line] of complete.toString("utf8").split("\n").entries()) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      if (!this.consume(object(parsed), index === 0)) return null;
    }
    return this.verified ? { nickname: this.nickname } : null;
  }
}
export function recordIdentityConflicts(
  raw: unknown,
  provider: Provider,
  sessionId: string,
  binding?: ChildBinding | null,
): boolean {
  const record = object(raw);
  if (provider === "codex" && inheritedRecord(record, binding)) return false;
  const identity =
    (provider === "codex" && record.type === "session_meta") ||
    (provider === "claude" &&
      record.isMeta !== true &&
      (record.type === "user" || record.type === "assistant"));
  return identity && !recordBelongsToSession(record, provider, sessionId, binding);
}

function claudeIdentity(record: Record<string, unknown>, binding: ChildBinding) {
  return (
    binding.provider === "claude" &&
    (record.type === "user" || record.type === "assistant") &&
    record.isMeta !== true
  );
}
