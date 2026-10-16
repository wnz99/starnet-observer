import type { DisplayRow } from "./types.js";
import { isHelper } from "./identity.js";
const MILLISECONDS_PER_SECOND = 1000;
const MILLISECONDS_PER_MINUTE = 60000;
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const PROVIDERS: Readonly<Record<string, string>> = {
  codex: "Codex",
  claude: "Claude",
  chatgpt: "ChatGPT",
};
export function activity(row: DisplayRow) {
  const last = row.tool && row.tool.available && row.tool.last;
  if (!last)
    return row.tool && row.tool.available ? "No recent tool observed" : "Tool detail unavailable";
  const words: readonly (readonly [RegExp, string])[] = [
    [/^(Bash|exec_command|shell|local_shell|write_stdin)$/i, "Running a command"],
    [/^(Read|NotebookRead|view_image)$/i, "Reading files"],
    [/^(Edit|MultiEdit|Write|NotebookEdit|apply_patch)$/i, "Editing files"],
    [/^(Grep|Glob|LS)$/i, "Searching the codebase"],
    [/^(WebFetch|WebSearch|web_search|web__run)$/i, "Searching the web"],
    [/^functions\.exec$/, "Running a tool batch"],
    [/^(functions\.wait|wait)$/, "Waiting for a tool"],
    [/^(mcp__cua|cua_repl)/, "Interacting with the browser"],
    [/^(Task|Agent|spawn_agent)$/i, "Delegating work"],
    [/^(TodoWrite|update_plan)$/i, "Updating a plan"],
  ];
  const match = words.find(([pattern]) => pattern.test(last.name ?? ""));
  const description = match ? match[1] : "Using " + (last.name ?? "null");
  // A missing result is not proof that a tool is still running between polls.
  return (
    "Last observed: " +
    description.toLowerCase() +
    (last.phase === "finished"
      ? last.outcome === "error"
        ? " · error"
        : " · finished"
      : " · result not yet observed")
  );
}
export function age(timestamp: number | string | null | undefined, now = Date.now()) {
  const milliseconds = typeof timestamp === "number" ? timestamp : Date.parse(timestamp ?? "");
  if (!Number.isFinite(milliseconds)) return "";
  const seconds = Math.max(0, Math.floor((now - milliseconds) / MILLISECONDS_PER_SECOND));
  return seconds < SECONDS_PER_MINUTE
    ? String(seconds) + "s ago"
    : seconds < SECONDS_PER_HOUR
      ? String(Math.floor(seconds / SECONDS_PER_MINUTE)) + "m ago"
      : String(Math.floor(seconds / SECONDS_PER_HOUR)) + "h ago";
}
/* Idle appearance reflects elapsed time after the sidecar last saw this agent do anything (transcript write or tool event; a working
     pane is active now). Under ten minutes it is fresh; from there the level eases in on a log scale and reaches full at
     eight hours. Levels are quantised to IDLE_STEPS so a slowly ageing body changes look a handful of times, not every
     frame. Rows without a timestamp (helpers, desktop, presentation without evidence) never age. */
const IDLE_FRESH = 10 * 60000,
  IDLE_FULL = 8 * 3600000,
  IDLE_STEPS = 6;
/* Sparkle runs on a longer clock than the tint so days stay distinguishable: full vigour on fresh bodies, fading on a square-root
     curve to none at three days, in eighths. Fresh bodies show more sparks and old bodies show fewer. */
const SPARK_GONE = 72 * 3600000,
  SPARK_STEPS = 8;
function idleLabel(ms: number) {
  const minutes = Math.floor(ms / MILLISECONDS_PER_MINUTE),
    hours = Math.floor(minutes / MINUTES_PER_HOUR),
    days = Math.floor(hours / HOURS_PER_DAY);
  if (ms < IDLE_FRESH) return "";
  if (days >= 1) return `idle ${String(days)}d ${String(hours % HOURS_PER_DAY)}h`;
  if (hours >= 1) return `idle ${String(hours)}h ${String(minutes % MINUTES_PER_HOUR)}m`;
  return `idle ${String(minutes)}m`;
}
export function idleAge(row: DisplayRow | null, now = Date.now()) {
  const at = row && row.status !== "working" ? row.lastActivityAt : null;
  if (typeof at !== "number" || !Number.isFinite(at))
    return { ms: null, level: 0, vigour: 1, label: "" };
  const ms = Math.max(0, now - at);
  const t =
    ms <= IDLE_FRESH
      ? 0
      : Math.min(1, Math.log(ms / IDLE_FRESH) / Math.log(IDLE_FULL / IDLE_FRESH));
  const label = idleLabel(ms);
  const fade =
    ms <= IDLE_FRESH ? 0 : Math.min(1, Math.sqrt((ms - IDLE_FRESH) / (SPARK_GONE - IDLE_FRESH)));
  return {
    ms,
    level: Math.ceil(t * IDLE_STEPS) / IDLE_STEPS,
    vigour: 1 - Math.ceil(fade * SPARK_STEPS) / SPARK_STEPS,
    label,
  };
}
/* Canvas hover plate: provider plus Herdr's generated tab title. Herdr publishes the title after the conversation
     starts and the sidecar falls back to the bare agent name until then, so a provider-only title is unpublished. */
export function taskTitle(row: DisplayRow) {
  const title = (row.title || "").replace(/\s+/g, " ").trim();
  return title && !/^(claude|codex|claude code)$/i.test(title) ? title : null; // provider defaults shown before Herdr names the task
}
function displayTask(row: DisplayRow) {
  const assignment = row.taskEvidence?.state !== "unavailable" && row.taskEvidence?.summary;
  if (isHelper(row))
    return (taskTitle(row) || "Helper") + " · " + (assignment || "task unavailable");
  return taskTitle(row) || "title unavailable";
}
function herdrLabel(row: DisplayRow, now: number) {
  const idle = idleAge(row, now).label;
  return (taskTitle(row) || "title not yet published by Herdr") + (idle ? " · " + idle : "");
}
function rosterSource(row: DisplayRow) {
  return (!row.source || row.source === "herdr") && !isHelper(row);
}
function providerLabel(row: DisplayRow) {
  return PROVIDERS[row.provider ?? ""] || row.provider || "Agent";
}
export function hoverLabel(row: DisplayRow, stale = false, now = Date.now()) {
  const provider = providerLabel(row);
  const unavailable = stale || row.inventoryHealth === "unavailable";
  const suffix = unavailable ? " · stale" : "";
  if (rosterSource(row)) return provider + " — " + herdrLabel(row, now) + suffix;
  const observed = age(row.observedAt, now);
  return (
    provider +
    " — " +
    displayTask(row) +
    " · " +
    (row.status || "unknown") +
    suffix +
    (observed ? " · last observed " + observed : "")
  );
}
