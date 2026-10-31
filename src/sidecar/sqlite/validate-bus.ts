import { busRecord, MESSAGE_IDENTITY } from "../bus/types.js";
import type { BusState, BusRow, Relay, RemoteView } from "../bus/types.js";
const WAKE_FAILED = "failed";
const MAX_FIELD_CHARS = 65536;
const MAX_MACHINES = 32;
const MAX_REPOS = 16;
const MAX_AGENTS = 48;
const MAX_PUBLICATIONS = 2000;
const MAX_WINDOW = 100;
const LABEL_CHARS = 160;
const ADDRESS_CHARS = 256;
const MACHINE_CHARS = 128;
const MAX_REASONS = 2;
const FAILED_REASON = "wake-failed";
function string(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_FIELD_CHARS;
}
function number(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}
function instant(value: unknown) {
  return value === null || (typeof value === "string" && Number.isFinite(Date.parse(value)));
}
function timestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(new Date(value).getTime());
}
function optionalTimestamp(value: unknown) {
  return value === null || timestamp(value);
}
function provider(value: unknown) {
  return value === "codex" || value === "claude";
}
function relayState(value: unknown) {
  return (
    value === "queued_local" ||
    value === "accepted_remote" ||
    value === "delivered_local" ||
    value === "acknowledged" ||
    value === "expired" ||
    value === "unknown"
  );
}
function relay(value: unknown): value is Relay {
  return (
    busRecord(value) &&
    (value.direction === "in" || value.direction === "out") &&
    string(value.machine) &&
    string(value.repo) &&
    provider(value.provider) &&
    string(value.peer) &&
    relayState(value.state)
  );
}
function wake(value: unknown) {
  return (
    value === "none" ||
    value === "requested" ||
    value === WAKE_FAILED ||
    value === "unsupported" ||
    value === "unknown"
  );
}
function identity(value: unknown) {
  return value === undefined || (typeof value === "string" && MESSAGE_IDENTITY.test(value));
}
function optionalRelay(value: unknown) {
  return value === undefined || relay(value);
}
function messageId(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
function row(value: unknown): value is BusRow {
  if (!busRecord(value) || !messageId(value.id)) return false;
  if (!identity(value.identity)) return false;
  return (
    string(value.sender) &&
    string(value.recipient) &&
    instant(value.sentAt) &&
    instant(value.acknowledgedAt) &&
    wake(value.wake) &&
    optionalMessageId(value.replyTo) &&
    optionalRelay(value.relay)
  );
}
function optionalMessageId(value: unknown) {
  return value === undefined || value === null || messageId(value);
}
function strings(value: unknown, max: number) {
  return Array.isArray(value) && value.length <= max && value.every(string);
}
function agent(value: unknown) {
  return (
    busRecord(value) &&
    string(value.id) &&
    provider(value.provider) &&
    string(value.repo) &&
    number(value.lastSeen)
  );
}
function peer(value: unknown) {
  if (!busRecord(value) || !string(value.machine) || !strings(value.repos, MAX_REPOS)) return false;
  return (
    typeof value.agents === "number" &&
    Number.isSafeInteger(value.agents) &&
    value.agents >= 0 &&
    number(value.lastSeen) &&
    Array.isArray(value.list) &&
    value.list.length <= MAX_AGENTS &&
    value.list.every(agent)
  );
}
function publication(value: unknown) {
  return busRecord(value) && string(value.address) && string(value.repo);
}
function remote(value: unknown): value is RemoteView {
  if (
    !busRecord(value) ||
    !string(value.relay) ||
    !string(value.machine) ||
    !number(value.lastActivityAt)
  )
    return false;
  if (!Array.isArray(value.peers) || value.peers.length > MAX_MACHINES || !value.peers.every(peer))
    return false;
  return (
    Array.isArray(value.published) &&
    value.published.length <= MAX_PUBLICATIONS &&
    value.published.every(publication)
  );
}
function optionalRemote(value: unknown) {
  return value === undefined || value === null || remote(value);
}
function health(value: unknown) {
  return value === "available" || value === "unavailable" || value === "unknown";
}
function rows(value: unknown, window: number) {
  return Array.isArray(value) && value.length <= window && value.every(row);
}
export function validBusState(value: unknown, window = MAX_WINDOW): value is BusState {
  if (!busRecord(value) || !rows(value.rows, window) || !health(value.health)) return false;
  return (
    number(value.observedAt) &&
    (value.reason === null || string(value.reason)) &&
    optionalRemote(value.remote) &&
    validCoordination(value.coordination)
  );
}
export function validCoordination(value: unknown): value is BusState["coordination"] {
  return (
    value === undefined ||
    (busRecord(value) &&
      (value.overview === undefined || validOverview(value.overview)) &&
      Array.isArray(value.sections) &&
      value.sections.length <= 12 &&
      value.sections.every(
        (section: unknown) =>
          busRecord(section) &&
          string(section.title) &&
          typeof section.available === "boolean" &&
          typeof section.truncated === "boolean" &&
          Array.isArray(section.rows) &&
          section.rows.length <= MAX_WINDOW &&
          section.rows.every(
            (entry: unknown) =>
              busRecord(entry) &&
              string(entry.label) &&
              string(entry.detail) &&
              (entry.agent === undefined || string(entry.agent)),
          ),
      ))
  );
}

function observation(value: unknown) {
  return value === "available" || value === "partial" || value === "unavailable";
}
function counter(value: unknown) {
  return value === null || (typeof value === "number" && Number.isSafeInteger(value) && value >= 0);
}
function metric(value: unknown, keys: string[]) {
  return (
    busRecord(value) &&
    observation(value.status) &&
    keys.every(
      (key) => counter(value[key]) && (value.status !== "unavailable" || value[key] === null),
    )
  );
}
function bounded(value: unknown, limit: number): value is string {
  return typeof value === "string" && value.length <= limit;
}
function detailList(value: unknown, limit: number, check: (row: unknown) => boolean) {
  return (
    busRecord(value) &&
    observation(value.status) &&
    typeof value.truncated === "boolean" &&
    Array.isArray(value.rows) &&
    value.rows.length <= limit &&
    value.rows.every(check)
  );
}
function attentionRow(value: unknown) {
  return (
    busRecord(value) &&
    messageId(value.id) &&
    timestamp(value.sentAt) &&
    Array.isArray(value.reasons) &&
    value.reasons.length > 0 &&
    value.reasons.length <= MAX_REASONS &&
    new Set(value.reasons).size === value.reasons.length &&
    value.reasons.every(
      (reason: unknown) => reason === "unacknowledged" || reason === FAILED_REASON,
    )
  );
}
function resourceRow(value: unknown) {
  return (
    busRecord(value) &&
    bounded(value.resource, LABEL_CHARS) &&
    (value.scope === "shared" || value.scope === "repository") &&
    (value.holder === undefined || bounded(value.holder, ADDRESS_CHARS)) &&
    optionalTimestamp(value.acquiredAt) &&
    optionalTimestamp(value.expiresAt) &&
    optionalTimestamp(value.checkAt) &&
    validWaiters(value.waiters)
  );
}
function validWaiters(value: unknown) {
  return (
    Array.isArray(value) &&
    value.length <= MAX_WINDOW &&
    value.every(
      (waiter: unknown) =>
        busRecord(waiter) &&
        bounded(waiter.agent, ADDRESS_CHARS) &&
        optionalTimestamp(waiter.requestedAt),
    )
  );
}
function validAwaiting(value: unknown) {
  return (
    metric(value, ["count"]) &&
    busRecord(value) &&
    optionalTimestamp(value.oldestAt) &&
    (value.status !== "unavailable" || value.oldestAt === null)
  );
}
function validWakes(value: unknown) {
  return busRecord(value) && metric(value.pending, ["count"]) && metric(value.failed, ["count"]);
}
export function validOverview(
  value: unknown,
): value is NonNullable<BusState["coordination"]>["overview"] {
  return (
    busRecord(value) &&
    timestamp(value.asOf) &&
    metric(value.agents, ["codex", "claude"]) &&
    metric(value.messages, ["total", "local", "remote"]) &&
    validAwaiting(value.awaiting) &&
    validWakes(value.wakes) &&
    detailList(value.attention, MAX_WINDOW, attentionRow) &&
    detailList(value.resources, MAX_WINDOW, resourceRow) &&
    detailList(
      value.remoteActivity,
      MAX_MACHINES,
      (row) =>
        busRecord(row) &&
        bounded(row.machine, MACHINE_CHARS) &&
        timestamp(row.sentAt) &&
        relayState(row.state),
    )
  );
}
