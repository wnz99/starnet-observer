interface ExecuteSettings {
  timeout: number;
  maxBuffer: number;
}
export type IdentityExecute = (
  command: string,
  args: string[],
  settings: ExecuteSettings,
) => Promise<{ stdout: string }>;
export type IdentityRpc = (method: string, params: Record<string, unknown>) => Promise<unknown>;
export type FooterMode = "configured" | "unconfigured" | "unavailable";
export interface RefreshState {
  endpointTimedOut?: boolean;
  processBirthUnavailable?: boolean;
}
export interface Terminal {
  paneId: string;
  provider: "codex";
  terminalId: string;
}
export interface ProcessBirth {
  pid: number;
  startSeconds: number;
  startMicroseconds: number;
}
export interface FooterProof extends Terminal {
  sessionId: string;
  birth: ProcessBirth;
  contentRevision: number;
  observedAt: number;
}
export type IdentityResolution =
  | { sessionId: string; source: "footer"; proof: FooterProof; reason: null }
  | { sessionId: string; source: "native"; proof: null; reason: null }
  | { sessionId: null; source: "unavailable"; proof: null; reason: string };
export interface IdentityOptions {
  now?: () => number;
  endpoint?: string;
  rpc?: IdentityRpc;
  execute?: IdentityExecute | undefined;
  readConfiguration?: (() => Promise<FooterMode>) | undefined;
  readProcessBirth?: ((pid: number) => Promise<unknown>) | undefined;
}
export const MAX_RESPONSE = 32768;
export const TIMEOUT = 1500;
export const UUID_TEXT = "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";
export const UUID = new RegExp("^" + UUID_TEXT + "$", "i");
export const unavailable = (reason: string): IdentityResolution => ({
  sessionId: null,
  source: "unavailable",
  proof: null,
  reason,
});
function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
export function object(value: unknown): Record<string, unknown> {
  return isObject(value) ? value : {};
}
export function result(value: unknown) {
  return object(object(value).result);
}
export function code(value: unknown) {
  return object(value).code;
}
