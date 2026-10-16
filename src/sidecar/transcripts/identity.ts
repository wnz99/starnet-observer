const MAX_NAME_CHARS = 120;
const LINE_FEED = 10;
import { cleanControls } from "../inspector/helper-state.js";
import { recordBelongsToSession } from "../inspector/index.js";
import { object, string } from "../inspector/values.js";
import { redactText } from "../inspector/fields.js";
import type { ChildBinding, Provider } from "./contracts.js";
export const cleanName = (value: unknown) =>
  typeof value === "string" ? cleanControls(value).slice(0, MAX_NAME_CHARS) : "";
export function childMetadata(data: Buffer, binding: ChildBinding) {
  return new ChildIdentity(binding).read(data);
}
class ChildIdentity {
  private verified = false;
  private nickname: string | null = null;
  constructor(private readonly binding: ChildBinding) {}
  private consume(record: Record<string, unknown>) {
    const binding = this.binding;
    if (binding.provider === "codex" && record.type === "session_meta") {
      if (
        this.verified ||
        !recordBelongsToSession(record, binding.provider, binding.sessionId, binding)
      )
        return false;
      this.verified = true;
      const name = string(object(record.payload).agent_nickname);
      this.nickname = name === undefined ? null : cleanName(redactText(name));
    }
    if (claudeIdentity(record, binding)) {
      if (!recordBelongsToSession(record, binding.provider, binding.sessionId, binding))
        return false;
      this.verified = true;
    }
    return true;
  }
  read(data: Buffer) {
    const complete = data.subarray(0, Math.max(0, data.lastIndexOf(LINE_FEED)));
    for (const line of complete.toString("utf8").split("\n")) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      if (!this.consume(object(parsed))) return null;
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
