import {
  DECISION_STATUSES,
  GATE_STATUSES,
  INSTRUCTION_AUDIENCES,
  INSTRUCTION_KINDS,
  TEAM_SOURCES,
  WORKER_STATUSES,
} from "../../shared/teams.js";
import { busRecord, isListed, TEAM_KEY, TEAM_LIMITS } from "../bus/types.js";
import type { RawTeams } from "../bus/types.js";

const OBSERVATIONS = ["available", "partial", "unavailable"] as const;

const rawText = (value: unknown) =>
  typeof value === "string" && value.length <= TEAM_LIMITS.rawUnits;
const optionalText = (value: unknown) => value === undefined || rawText(value);
const instant = (value: unknown) =>
  value === null || (typeof value === "number" && Number.isFinite(value));
const count = (value: unknown) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const counter = (value: unknown) => value === null || count(value);
const list = (value: unknown, limit: number, check: (entry: unknown) => boolean) =>
  Array.isArray(value) && value.length <= limit && value.every(check);

function claim(value: unknown) {
  return (
    value === undefined || (busRecord(value) && rawText(value.ticket) && rawText(value.branch))
  );
}
function worker(value: unknown) {
  return (
    busRecord(value) &&
    rawText(value.agent) &&
    isListed(WORKER_STATUSES, value.status) &&
    claim(value.claim)
  );
}
function decision(value: unknown) {
  return (
    busRecord(value) &&
    rawText(value.class) &&
    isListed(DECISION_STATUSES, value.status) &&
    rawText(value.question) &&
    optionalText(value.worker) &&
    instant(value.createdAt) &&
    instant(value.deadlineAt)
  );
}
function gate(value: unknown) {
  return (
    busRecord(value) &&
    typeof value.pr === "number" &&
    Number.isSafeInteger(value.pr) &&
    rawText(value.ticket) &&
    isListed(GATE_STATUSES, value.status) &&
    instant(value.submittedAt) &&
    instant(value.decidedAt)
  );
}
function latestInstruction(value: unknown) {
  return (
    value === undefined ||
    (busRecord(value) &&
      isListed(INSTRUCTION_AUDIENCES, value.audience) &&
      isListed(INSTRUCTION_KINDS, value.kind) &&
      rawText(value.text) &&
      instant(value.recordedAt))
  );
}
function latestAmendment(value: unknown) {
  return (
    value === undefined || (busRecord(value) && rawText(value.text) && instant(value.recordedAt))
  );
}
function identity(value: Record<string, unknown>) {
  return (
    typeof value.key === "string" &&
    TEAM_KEY.test(value.key) &&
    [value.label, value.generation, value.coordinator, value.objective].every(rawText)
  );
}
function counts(value: Record<string, unknown>) {
  return (
    (value.unobservedWorkers === undefined || count(value.unobservedWorkers)) &&
    instant(value.grantExpiresAt) &&
    counter(value.instructions) &&
    counter(value.amendments)
  );
}
function team(value: unknown) {
  return (
    busRecord(value) &&
    identity(value) &&
    counts(value) &&
    list(value.workers, TEAM_LIMITS.workers, worker) &&
    latestInstruction(value.latestInstruction) &&
    latestAmendment(value.latestAmendment) &&
    list(value.decisions, TEAM_LIMITS.decisions, decision) &&
    list(value.gates, TEAM_LIMITS.gates, gate)
  );
}
function sources(value: unknown) {
  return (
    busRecord(value) &&
    Object.keys(value).length === TEAM_SOURCES.length &&
    TEAM_SOURCES.every((name) => typeof value[name] === "boolean")
  );
}
function uniqueKeys(value: unknown[]) {
  return new Set(value.map((entry) => (busRecord(entry) ? entry.key : null))).size === value.length;
}
// Checks the raw worker shape; the public shape is a subset, so one validator accepts both local and remote input.
export function validTeams(value: unknown): value is RawTeams {
  return (
    busRecord(value) &&
    typeof value.asOf === "number" &&
    Number.isFinite(new Date(value.asOf).getTime()) &&
    isListed(OBSERVATIONS, value.status) &&
    typeof value.truncated === "boolean" &&
    sources(value.sources) &&
    list(value.projects, TEAM_LIMITS.projects, team) &&
    uniqueKeys(value.projects as unknown[])
  );
}
