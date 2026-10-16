import { STATUS } from "./status.js";
import type { IncomingMessage } from "node:http";
import { PANE, TARGET } from "../sidecar/control/index.js";
import type { JsonReply } from "./contracts.js";
const BODY_LIMIT = 4096;
export type ControlAction =
  | { action: "attach" | "spawn" | "close"; paneId: string }
  | { action: "overseer"; provider: "claude" | "codex" }
  | { action: "spawn-host"; host: string; folder: string | null };
export function actionName(url: string | undefined) {
  const name = /^\/api\/control\/(attach|spawn|close|overseer|spawn-host)$/.exec(url ?? "")?.[1];
  return name === "attach" ||
    name === "spawn" ||
    name === "close" ||
    name === "overseer" ||
    name === "spawn-host"
    ? name
    : null;
}
export async function readBody(req: IncomingMessage, json: JsonReply) {
  const chunks: Buffer[] = [];
  let bytes = 0;
  try {
    for await (const chunk of req) {
      const data: unknown = chunk;
      if (!Buffer.isBuffer(data)) throw new TypeError("Expected HTTP body buffer");
      bytes += data.length;
      if (bytes > BODY_LIMIT) {
        json(STATUS.TOO_LARGE, { error: "Body too large" });
        return;
      }
      chunks.push(data);
    }
  } catch {
    json(STATUS.BAD_REQUEST, { error: "Body unreadable" });
    return;
  }
  try {
    const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      json(STATUS.BAD_REQUEST, { error: "JSON object required" });
      return;
    }
    return body;
  } catch {
    json(STATUS.BAD_REQUEST, { error: "Invalid JSON" });
    return;
  }
}
export function validateAction(
  action: NonNullable<ReturnType<typeof actionName>>,
  body: object,
  json: JsonReply,
): ControlAction | undefined {
  if (action === "overseer") {
    const provider: unknown = Reflect.get(body, "provider");
    if (provider === "claude" || provider === "codex") return { action, provider };
    json(STATUS.BAD_REQUEST, { error: "invalid-provider" });
    return;
  }
  // Pane ids may be host-namespaced (`herdr-dev-2/w1:p1`); control refuses hosts that are not configured remotes.
  if (action !== "spawn-host") {
    const paneId: unknown = Reflect.get(body, "paneId");
    if (typeof paneId === "string" && TARGET.test(paneId)) return { action, paneId };
    json(STATUS.BAD_REQUEST, { error: "paneId required" });
    return;
  }
  return validateHost(body, json);
}
function validateHost(body: object, json: JsonReply): ControlAction | undefined {
  const host: unknown = Reflect.get(body, "host"),
    folder: unknown = Reflect.get(body, "folder");
  if (
    typeof host === "string" &&
    (folder === undefined || folder === null || typeof folder === "string")
  )
    return { action: "spawn-host", host, folder: folder ?? null };
  json(STATUS.BAD_REQUEST, { error: "host and folder must be strings" });
  return;
}
export function remoteAction(action: ControlAction["action"], body: object) {
  const paneId: unknown = Reflect.get(body, "paneId");
  return action === "spawn-host" || (typeof paneId === "string" && !PANE.test(paneId));
}
