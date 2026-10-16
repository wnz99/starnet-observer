import { object, MESSAGE_IDENTITY } from "../bus/types.js";
import type { BusState, BusRow, Relay, RemoteView } from "../bus/types.js";
const WAKE_FAILED = "failed";
const MAX_FIELD_CHARS = 65536;
const MAX_MACHINES = 32;
const MAX_REPOS = 16;
const MAX_AGENTS = 48;
const MAX_PUBLICATIONS = 2000;
const MAX_WINDOW = 100;
function string(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_FIELD_CHARS;
}
function number(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}
function instant(value: unknown) {
  return value === null || (typeof value === "string" && Number.isFinite(Date.parse(value)));
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
    object(value) &&
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
  if (!object(value) || !messageId(value.id)) return false;
  if (!identity(value.identity)) return false;
  return (
    string(value.sender) &&
    string(value.recipient) &&
    instant(value.sentAt) &&
    instant(value.acknowledgedAt) &&
    wake(value.wake) &&
    optionalRelay(value.relay)
  );
}
function strings(value: unknown, max: number) {
  return Array.isArray(value) && value.length <= max && value.every(string);
}
function agent(value: unknown) {
  return (
    object(value) &&
    string(value.id) &&
    provider(value.provider) &&
    string(value.repo) &&
    number(value.lastSeen)
  );
}
function peer(value: unknown) {
  if (!object(value) || !string(value.machine) || !strings(value.repos, MAX_REPOS)) return false;
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
  return object(value) && string(value.address) && string(value.repo);
}
function remote(value: unknown): value is RemoteView {
  if (
    !object(value) ||
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
  if (!object(value) || !rows(value.rows, window) || !health(value.health)) return false;
  return (
    number(value.observedAt) &&
    (value.reason === null || string(value.reason)) &&
    optionalRemote(value.remote)
  );
}
