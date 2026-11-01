import path from "node:path";

export interface ShellEntryObservation {
  version: 1;
  provider: "codex";
  sessionId: string;
  source: "shell-entry";
  cwd: string;
  observedAt: number;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_PATH_BYTES = 4096;
const CLOCK_SKEW_MS = 30000;
const KEYS = "cwd,observedAt,provider,sessionId,source,version";
export const validSession = (value: unknown): value is string =>
  typeof value === "string" && UUID.test(value);
function validCwd(value: unknown): value is string {
  return (
    typeof value === "string" &&
    path.isAbsolute(value) &&
    Buffer.byteLength(value) <= MAX_PATH_BYTES &&
    !/\p{Cc}/u.test(value)
  );
}
function validTime(value: unknown, now: number): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= now + CLOCK_SKEW_MS
  );
}
function validHeader(event: Record<string, unknown>, sessionId: string) {
  return (
    event.version === 1 &&
    event.provider === "codex" &&
    event.source === "shell-entry" &&
    event.sessionId === sessionId &&
    validSession(sessionId)
  );
}
export function observation(
  value: unknown,
  sessionId: string,
  now: number,
): ShellEntryObservation | null {
  if (!value || typeof value !== "object" || Object.keys(value).sort().join() !== KEYS) return null;
  const event = value as Record<string, unknown>;
  if (!validHeader(event, sessionId)) return null;
  if (!validCwd(event.cwd) || !Number.isSafeInteger(now) || !validTime(event.observedAt, now))
    return null;
  return {
    version: 1,
    provider: "codex",
    source: "shell-entry",
    sessionId,
    cwd: event.cwd,
    observedAt: event.observedAt,
  };
}
