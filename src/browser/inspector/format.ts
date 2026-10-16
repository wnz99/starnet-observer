import { age } from "../model/description.js";
import { record } from "../theme/validation.js";
const TIME_PAD_WIDTH = 2;
const MILLISECONDS_PER_SECOND = 1000;
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_MINUTE = 60;
export const MOBILE = "(max-width: 850px)";
export const REASONS: Readonly<Record<string, string>> = {
  "unknown-session": "This session is no longer known to the observer.",
  "inventory-unavailable":
    "This session's source is unavailable or not refreshed, so no conversation is shown.",
  "identity-unavailable":
    "The conversation behind this row could not be identified, so none is shown.",
  "transcript-unavailable": "The transcript for this session could not be read.",
  "loaded-ui-unavailable": "No loaded conversation text could be read from this app window.",
  "identity-mismatch": "This row now shows a different session; open it again to read it.",
  "invalid-identity": "This session could not be identified, so no conversation is shown.",
};
export function count(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.round(value).toLocaleString("en-US")
    : null;
}
export function formatDuration(ms: unknown) {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return null;
  const seconds = Math.floor(ms / MILLISECONDS_PER_SECOND),
    hours = Math.floor(seconds / SECONDS_PER_HOUR),
    minutes = Math.floor((seconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  if (hours) return `${String(hours)}h ${String(minutes).padStart(TIME_PAD_WIDTH, "0")}m`;
  return minutes
    ? `${String(minutes)}m ${String(seconds % SECONDS_PER_MINUTE).padStart(TIME_PAD_WIDTH, "0")}s`
    : `${String(seconds)}s`;
}
const FIELDS: readonly (readonly [
  string,
  string,
  (value: unknown, now: number) => string | null,
])[] = [
  ["model", "Model", (value) => (typeof value === "string" && value.trim() ? value.trim() : null)],
  ["inputTokens", "Input tokens", count],
  ["outputTokens", "Output tokens", count],
  ["cacheReadTokens", "Cache read", count],
  ["cacheWriteTokens", "Cache write", count],
  ["durationMs", "Duration", formatDuration],
  [
    "startedAt",
    "Started",
    (value, now) => (typeof value === "string" ? age(value, now) || null : null),
  ],
  [
    "lastActivityAt",
    "Latest activity",
    (value, now) => (typeof value === "string" ? age(value, now) || null : null),
  ],
];
function statRow(
  key: string,
  label: string,
  format: (value: unknown, now: number) => string | null,
  options: { stats: unknown; now: number },
) {
  const field: unknown = record(options.stats) ? options.stats[key] : null;
  const state =
    record(field) && (field.state === "available" || field.state === "partial")
      ? field.state
      : "unavailable";
  const value =
    state === "unavailable" ? null : format(record(field) ? field.value : null, options.now);
  if (value === null) return { key, label, state: "unavailable", text: "Unavailable" };
  return { key, label, state, text: state === "partial" ? value + " · partial" : value };
}
export function statRows(stats: unknown, now = Date.now()) {
  return FIELDS.map(([key, label, format]) => statRow(key, label, format, { stats, now }));
}
const ROLES: Readonly<Record<string, string>> = {
  user: "USER",
  assistant: "ASSISTANT",
  tool: "TOOL",
};
const OUTCOMES: Readonly<Record<string, string>> = {
  unknown: "outcome unknown",
  ok: "ok",
  error: "error",
};
function toolParts(turn: Record<string, unknown>) {
  if (turn.role !== "tool" || !record(turn.tool)) return null;
  const tool = turn.tool;
  return {
    name: typeof tool.name === "string" && tool.name ? tool.name : "tool",
    phase: tool.phase === "started" || tool.phase === "finished" ? tool.phase : "started",
    outcome:
      typeof tool.outcome === "string"
        ? (OUTCOMES[tool.outcome] ?? "outcome unknown")
        : "outcome unknown",
  };
}
export function turnParts(turn: unknown, loaded = false) {
  if (!record(turn) || typeof turn.role !== "string") return null;
  const label = ROLES[turn.role] || (loaded && turn.role === "unknown" ? "LOADED UI TEXT" : null);
  if (!label || (typeof turn.id !== "string" && typeof turn.id !== "number")) return null;
  return normalizedTurn(turn, { id: turn.id, role: turn.role, label });
}
function normalizedTurn(
  turn: Record<string, unknown>,
  identity: { id: string | number; role: string; label: string },
) {
  const tool = toolParts(turn);
  const parts = {
    id: String(identity.id),
    role: identity.role,
    label: identity.label,
    at: typeof turn.at === "string" ? turn.at : null,
    text: typeof turn.text === "string" ? turn.text : "",
    truncated: turn.textTruncated === true,
    tool,
  };
  return {
    ...parts,
    key: JSON.stringify([parts.role, parts.at, parts.text, parts.truncated, tool]),
  };
}
export function clock(iso: string | undefined) {
  const at = Date.parse(iso ?? "");
  return Number.isFinite(at)
    ? new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : "time unknown";
}
