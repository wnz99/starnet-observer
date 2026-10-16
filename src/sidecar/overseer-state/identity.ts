import os from "node:os";
import path from "node:path";

const ID = /^[A-Za-z0-9:_-]{1,120}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const CONFLICT_STATUS = 409;
export const unavailable = () =>
  Object.assign(new Error("overseer-unavailable"), { status: CONFLICT_STATUS });
export const defaultOverseerHome = () =>
  path.join(os.homedir(), ".local", "share", "starnet-observer", "overseer");
export const resolveEndpoint = (options: { endpoint?: string }) =>
  options.endpoint ||
  process.env.HERDR_SOCKET_PATH ||
  path.join(os.homedir(), ".config/herdr/herdr.sock");
export function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}
function validId(value: unknown): value is string {
  return typeof value === "string" && ID.test(value);
}
export function paneId(value: unknown) {
  if (!validId(value)) throw unavailable();
  return value;
}
function nativeSession(pane: Record<string, unknown>) {
  const session = pane.agent_session;
  return object(session) &&
    session.agent === pane.agent &&
    session.kind === "id" &&
    typeof session.value === "string" &&
    UUID.test(session.value)
    ? session.value
    : null;
}
export function identity(pane: unknown, endpoint: string) {
  if (!object(pane) || (pane.agent !== "claude" && pane.agent !== "codex")) throw unavailable();
  if (pane.agent_session !== null && pane.agent_session !== undefined && !nativeSession(pane))
    throw unavailable();
  return {
    version: 1,
    endpoint,
    paneId: paneId(pane.pane_id),
    workspaceId: paneId(pane.workspace_id),
    terminalId: paneId(pane.terminal_id),
    provider: pane.agent,
    sessionId: nativeSession(pane),
  };
}
