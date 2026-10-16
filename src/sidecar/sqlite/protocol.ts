import type { BusState, RawInspection } from "../bus/types.js";
import { MESSAGE_IDENTITY, MAX_RAW_CHARS, WINDOW, busRecord } from "../bus/types.js";
import type { HelperEdges } from "../helpers/edges.js";
import { MAX_EDGES } from "../helpers/edges.js";
import { validBusState } from "./validate-bus.js";
export interface WorkerPaths {
  busFile: string;
  helperFile: string;
  tempRoot: string;
}
export type Operation = "bus.read" | "bus.inspect" | "helpers.edges";
interface Correlation {
  request: number;
  now: number;
}
export type WorkerRequest =
  | (Correlation & { op: "bus.read" | "helpers.edges" })
  | (Correlation & { op: "bus.inspect"; id: number; expectedIdentity?: string });
export type WorkerResult = BusState | RawInspection | HelperEdges;
const MAX_PATH_CHARS = 32768;
const REASONS = new Set([
  "missing",
  "unsupported",
  "unstable",
  "unreadable",
  "missing-message",
  "invalid-message",
  "invalid-identity",
  "identity-mismatch",
]);
const MAX_EDGE_FIELD_CHARS = 4096;
const FINGERPRINT_PARTS = 3;
const MAX_FINGERPRINT_CHARS = 512;
function keys(value: Record<string, unknown>, allowed: string[]) {
  return Object.keys(value).every((key) => allowed.includes(key));
}
function path(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_PATH_CHARS &&
    !value.includes("\0")
  );
}
export function validWorkerPaths(value: unknown): value is WorkerPaths {
  return (
    busRecord(value) &&
    keys(value, ["busFile", "helperFile", "tempRoot"]) &&
    path(value.busFile) &&
    path(value.helperFile) &&
    path(value.tempRoot)
  );
}
export function closing(value: unknown) {
  return busRecord(value) && value.op === "close" && keys(value, ["op"]);
}
function correlation(value: unknown): value is Record<string, unknown> & Correlation {
  return (
    busRecord(value) &&
    typeof value.request === "number" &&
    Number.isSafeInteger(value.request) &&
    value.request > 0 &&
    typeof value.now === "number" &&
    Number.isFinite(value.now)
  );
}
function identity(value: unknown) {
  return value === undefined || (typeof value === "string" && MESSAGE_IDENTITY.test(value));
}
export function validRequest(value: unknown): value is WorkerRequest {
  if (!correlation(value)) return false;
  if (value.op === "bus.read" || value.op === "helpers.edges")
    return keys(value, ["request", "op", "now"]);
  if (
    value.op !== "bus.inspect" ||
    !keys(value, ["request", "op", "now", "id", "expectedIdentity"])
  )
    return false;
  return (
    typeof value.id === "number" &&
    Number.isSafeInteger(value.id) &&
    value.id > 0 &&
    identity(value.expectedIdentity)
  );
}
export function validReply(value: unknown): value is { request: number; result: unknown } {
  return (
    busRecord(value) &&
    keys(value, ["request", "result"]) &&
    typeof value.request === "number" &&
    Number.isSafeInteger(value.request) &&
    value.request > 0 &&
    "result" in value
  );
}
function reason(value: unknown) {
  return value === undefined || (typeof value === "string" && REASONS.has(value));
}

function rawBody(value: Record<string, unknown>) {
  return (
    typeof value.identity === "string" &&
    MESSAGE_IDENTITY.test(value.identity) &&
    typeof value.body === "string" &&
    value.body.length <= MAX_RAW_CHARS + 1
  );
}
export function validRawInspection(value: unknown): value is RawInspection {
  if (
    !busRecord(value) ||
    !keys(value, ["id", "identity", "body", "reason"]) ||
    typeof value.id !== "number" ||
    !Number.isSafeInteger(value.id)
  )
    return false;
  if (value.reason !== undefined)
    return reason(value.reason) && value.body === undefined && value.identity === undefined;
  return rawBody(value);
}
function fingerprint(value: unknown) {
  return (
    value === undefined ||
    (Array.isArray(value) &&
      value.length === FINGERPRINT_PARTS &&
      value.every(
        (part: unknown) =>
          part === null || (typeof part === "string" && part.length <= MAX_FINGERPRINT_CHARS),
      ))
  );
}
function edgeField(value: unknown) {
  return (
    value === null ||
    (typeof value === "string" && value.length <= MAX_EDGE_FIELD_CHARS) ||
    typeof value === "number"
  );
}
function edge(value: unknown) {
  return (
    busRecord(value) &&
    keys(value, ["parent_thread_id", "child_thread_id", "status"]) &&
    edgeField(value.parent_thread_id) &&
    edgeField(value.child_thread_id) &&
    edgeField(value.status)
  );
}
export function validHelperEdges(value: unknown): value is HelperEdges {
  if (
    !busRecord(value) ||
    !keys(value, ["rows", "reason", "fingerprint"]) ||
    !reason(value.reason) ||
    !fingerprint(value.fingerprint)
  )
    return false;
  if (value.rows === undefined) return typeof value.reason === "string";
  return Array.isArray(value.rows) && value.rows.length <= MAX_EDGES + 1 && value.rows.every(edge);
}
export function validResult(op: Operation, result: unknown) {
  switch (op) {
    case "bus.read":
      return validBusState(result, WINDOW);
    case "bus.inspect":
      return validRawInspection(result);
    case "helpers.edges":
      return validHelperEdges(result);
  }
}
