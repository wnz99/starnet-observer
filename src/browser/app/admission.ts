import { record } from "../theme/validation.js";
import type { AppSnapshot } from "./data.js";

type Check = (value: unknown) => boolean;
const string: Check = (value) => typeof value === "string";
const number: Check = (value) => typeof value === "number";
const boolean: Check = (value) => typeof value === "boolean";
const nullable =
  (check: Check): Check =>
  (value) =>
    value === null || check(value);
const time = nullable((value) => number(value) || string(value));
const names =
  (values: readonly string[]): Check =>
  (value) =>
    typeof value === "string" && values.includes(value);
const optional = (value: unknown, check: Check) => value === undefined || check(value);
function fields(value: Record<string, unknown>, checks: Readonly<Record<string, Check>>) {
  return Object.entries(checks).every(([key, check]) => optional(value[key], check));
}
const object =
  (checks: Readonly<Record<string, Check>>): Check =>
  (value) =>
    record(value) && fields(value, checks);
const dictionary =
  (check: Check): Check =>
  (value) =>
    record(value) && Object.values(value).every(check);
const array =
  (check: Check): Check =>
  (value) =>
    Array.isArray(value) && value.every(check);
const health = names(["available", "unavailable"]);
const status = names(["working", "blocked", "idle", "done", "unknown"]);
const counter: Check = (value) =>
  record(value) && nullable(number)(value.value) && nullable(string)(value.state);
const usage: Check = (value) =>
  record(value) &&
  ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens"].every((key) =>
    nullable(counter)(value[key]),
  ) &&
  fields(value, { coverage: nullable(string), observedAt: time });
const last = object({
  name: nullable(string),
  phase: nullable(string),
  outcome: nullable(string),
  at: time,
});
const tool: Check = (value) =>
  record(value) &&
  boolean(value.available) &&
  fields(value, {
    observedAt: time,
    lastEntryAt: nullable(number),
    last: nullable(last),
    usage: nullable(usage),
  });
const evidence = nullable(
  object({ state: string, summary: nullable(string), source: nullable(string), observedAt: time }),
);
const taskStatus = nullable(
  object({ status: nullable(string), source: nullable(string), observedAt: time }),
);
const lifecycle = nullable(
  object({
    state: nullable(string),
    reason: nullable(string),
    source: nullable(string),
    observedAt: nullable(number),
  }),
);
const arrangement: Check = (value) =>
  record(value) && ["roomId", "room", "sectionId", "section"].every((key) => string(value[key]));
const rowStrings = {
  provider: string,
  source: string,
  title: string,
  project: string,
  repo: string,
  folder: string,
  projectId: nullable(string),
  projectKind: nullable(string),
  repoId: nullable(string),
  repoKind: nullable(string),
  host: nullable(string),
  paneId: nullable(string),
  checkoutId: nullable(string),
  worktree: nullable(string),
  sessionId: nullable(string),
  identitySource: nullable(string),
  inspectionIdentity: nullable(string),
  presence: nullable(string),
  parentId: nullable(string),
  worktreeId: nullable(string),
  lineageState: nullable(string),
};
const row: Check = (value) =>
  record(value) &&
  string(value.id) &&
  fields(value, {
    ...rowStrings,
    role: nullable(names(["overseer"])),
    status,
    observedAt: time,
    inventoryHealth: health,
    identityHealth: health,
    projectHome: boolean,
    checkoutKind: nullable(names(["main", "worktree", "folder"])),
    helperSlot: nullable(number),
    helperOverflow: number,
    lastActivityAt: nullable(number),
    tool,
    usage: nullable(usage),
    arrangement,
    taskEvidence: evidence,
    taskStatusEvidence: taskStatus,
    lifecycleEvidence: lifecycle,
  });
const relay = object({
  direction: string,
  machine: string,
  repo: string,
  provider: nullable(names(["codex", "claude"])),
  peer: nullable(string),
  state: string,
});
const WAKE_STATES = ["none", "requested", "failed", "unsupported", "unknown"];
const message: Check = (value) =>
  record(value) &&
  number(value.id) &&
  fields(value, {
    identity: nullable(string),
    key: string,
    host: string,
    from: string,
    to: string,
    sentAt: time,
    acknowledgedAt: time,
    wake: names(WAKE_STATES),
    relay: (entry) =>
      record(entry) &&
      string(entry.machine) &&
      string(entry.state) &&
      string(entry.direction) &&
      relay(entry),
  });
const remote = object({
  relay: string,
  machine: string,
  lastActivityAt: nullable(number),
  onRelay: array((value) => record(value) && string(value.id) && string(value.repo)),
  peers: Array.isArray,
});
const bus = object({
  health,
  reason: nullable(string),
  observedAt: nullable(number),
  window: number,
  messages: array(message),
  remote,
});
const source = object({
  health: names(["available", "unavailable", "stale"]),
  observedAt: nullable(number),
  reason: nullable(string),
  agents: number,
});
const coverage = object({
  eligible: number,
  available: number,
  partial: number,
  unavailable: number,
  stale: number,
  conflicting: number,
});
const counterTotal: Check = (value) =>
  record(value) &&
  nullable(number)(value.value) &&
  names(["available", "partial", "unavailable"])(value.state);
const totals = (check: Check) =>
  object({
    inputTokens: check,
    outputTokens: check,
    cacheReadTokens: check,
    cacheWriteTokens: check,
  });
const aggregate = object({
  usageObservedAt: nullable(number),
  agents: object({
    observed: number,
    verifiedSessions: number,
    presenceOnly: number,
    stale: number,
    statuses: object({
      working: number,
      blocked: number,
      idle: number,
      done: number,
      unknown: number,
    }),
  }),
  usage: totals(counterTotal),
  coverage: (value) =>
    record(value) && coverage(value) && fields(value, { counters: totals(coverage) }),
});

/* Admission checks the display fields read by this app. It neither projects a new body nor proves a full server snapshot. */
export function isAppSnapshot(value: unknown): value is AppSnapshot {
  return (
    record(value) &&
    Array.isArray(value.sessions) &&
    value.sessions.every(row) &&
    names(["available", "unknown", "unavailable"])(value.health) &&
    fields(value, {
      observedAt: nullable(number),
      error: nullable(string),
      aggregate,
      bus: nullable(bus),
      hostBus: dictionary(nullable(bus)),
      sources: object({ herdr: source, desktop: source, hosts: dictionary(source) }),
      presentation: nullable(object({ company: string, label: string })),
    })
  );
}
