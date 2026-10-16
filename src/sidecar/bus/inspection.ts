import { redactText } from "../inspector/fields.js";
import { MAX_TEXT_CHARS, MAX_RAW_CHARS, MESSAGE_IDENTITY } from "./types.js";
import type { RawInspection } from "./types.js";
import type { MessageInspection } from "../../shared/inspection.js";
// Both synchronous fixtures and the parent worker adapter use the main process's live known-value redaction.
export function sanitizeMessageInspection(raw: RawInspection, now: number): MessageInspection {
  const base: MessageInspection = {
    id: raw.id,
    identity: null,
    health: "unavailable",
    reason: null,
    asOf: new Date(now).toISOString(),
    text: null,
    truncated: false,
    window: { maxTextChars: MAX_TEXT_CHARS },
  };
  if (raw.reason) return { ...base, reason: raw.reason };
  if (
    typeof raw.body !== "string" ||
    raw.body.length > MAX_RAW_CHARS + 1 ||
    !MESSAGE_IDENTITY.test(raw.identity || "")
  )
    return { ...base, reason: "unreadable" };
  const safe = redactText(raw.body);
  return {
    ...base,
    health: "available",
    identity: raw.identity ?? null,
    text: safe.slice(0, MAX_TEXT_CHARS),
    truncated: raw.body.length > MAX_RAW_CHARS || safe.length > MAX_TEXT_CHARS,
  };
}
