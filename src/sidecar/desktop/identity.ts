import crypto from "node:crypto";
import type { ObserverRow } from "../../shared/observer.js";

// Regular ChatGPT and Claude Desktop monitoring is deferred; retain Codex only.
const APPS = Object.freeze({
  "com.openai.codex": { name: "Codex", provider: "codex" },
} satisfies Record<string, { name: string; provider: ObserverRow["provider"] }>);
const MAX_PID = 2147483647;
const MAX_WINDOW_ID = 4294967295;
const ROW_DIGEST_CHARS = 24;
const APP_DIGEST_CHARS = 20;
export const digest = (value: string | Buffer) =>
  crypto.createHash("sha256").update(value).digest("hex");
export interface DesktopIdentity {
  bundleId: keyof typeof APPS;
  pid: number;
  processStart: string;
  windowId: number;
}
export function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}
function validProcess(value: Record<string, unknown>) {
  return (
    typeof value.pid === "number" &&
    Number.isSafeInteger(value.pid) &&
    value.pid > 0 &&
    value.pid <= MAX_PID &&
    typeof value.processStart === "string" &&
    /^[0-9]{1,16}\.[0-9]{6}$/.test(value.processStart)
  );
}
function validWindow(value: unknown): value is number {
  return (
    typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= MAX_WINDOW_ID
  );
}
export function validIdentity(value: unknown): value is DesktopIdentity {
  return (
    object(value) &&
    typeof value.bundleId === "string" &&
    Object.hasOwn(APPS, value.bundleId) &&
    validProcess(value) &&
    validWindow(value.windowId)
  );
}
const identityKey = (value: DesktopIdentity) =>
  [value.bundleId, value.pid, value.processStart, value.windowId].join("\0");
export const rowId = (value: DesktopIdentity) =>
  "obs_" + digest("desktop\0" + identityKey(value)).slice(0, ROW_DIGEST_CHARS);
export const sameIdentity = (a: unknown, b: unknown) =>
  validIdentity(a) && validIdentity(b) && identityKey(a) === identityKey(b);
export function desktopRow(
  id: string,
  identity: DesktopIdentity,
  observedAt: number,
): ObserverRow & { inspectionIdentity: string } {
  const { name, provider } = APPS[identity.bundleId];
  return {
    id,
    paneId: null,
    provider,
    title: name,
    projectId: "desktop",
    project: "Desktop",
    projectKind: "group",
    repoId: "app_" + digest(identity.bundleId).slice(0, APP_DIGEST_CHARS),
    repo: name,
    repoKind: "application",
    worktree: null,
    status: "unknown",
    sessionId: null,
    tool: { available: false },
    source: "desktop",
    observedAt,
    inventoryHealth: "available",
    inspectionIdentity: id,
    presence: "window",
  };
}
