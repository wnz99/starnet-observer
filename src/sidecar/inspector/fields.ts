import { redact } from "../redaction.js";
import type { InspectionField, SessionInspection } from "../../shared/inspection.js";

const MAX_TURNS = 200;
const MAX_TEXT_CHARS = 8000;
const MAX_TOTAL_CHARS = 131072;
const READ_BYTES = 262144;
const MAX_DISK_READ_BYTES = 790528;

// readBytes is the conversation chunk; cold identity verification and rewrite-prefix checking add bounded IO.
// Revalidating the previous bounded window adds at most another readBytes of IO.
export const INSPECTION_WINDOW = Object.freeze({
  maxTurns: MAX_TURNS,
  maxTextChars: MAX_TEXT_CHARS,
  maxTotalChars: MAX_TOTAL_CHARS,
  readBytes: READ_BYTES,
  maxDiskReadBytes: MAX_DISK_READ_BYTES,
});
export function field<T>(
  value: T | null | undefined,
  state: "available" | "partial" = "available",
): InspectionField<T> {
  return {
    value: value ?? null,
    state: value === null || value === undefined ? "unavailable" : state,
  };
}
// External sessions can contain credentials unknown to this sidecar. Consume the entire
// quoted assignment, including spaces/escaped quotes, before the generic shape redactor.
export function redactText(raw: string): string {
  return redact(
    raw.replace(
      /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|private[_-]?key|secret[_-]?key|bot[_-]?token|webhook[_-]?secret|password|passwd|authorization)\b(["']?\s*[=:]\s*)("(?:\\[\s\S]|[^"\\])*(?:"|$)|'(?:\\[\s\S]|[^'\\])*(?:'|$))/gi,
      "$1$2[redacted-secret]",
    ),
  );
}

export function unavailable(id: string, reason: string, now: number): SessionInspection {
  return {
    id,
    health: "unavailable",
    asOf: new Date(now).toISOString(),
    reason,
    stats: {
      model: field<string>(null),
      inputTokens: field<number>(null),
      outputTokens: field<number>(null),
      cacheReadTokens: field<number>(null),
      cacheWriteTokens: field<number>(null),
      startedAt: field<string>(null),
      lastActivityAt: field<string>(null),
      durationMs: field<number>(null),
    },
    turns: [],
    truncated: false,
    window: INSPECTION_WINDOW,
    generation: null,
  };
}
