import net from "node:net";
import { StringDecoder } from "node:string_decoder";
import { object, code, CONTENT_CHANGED_CODE, MAX_RESPONSE, TIMEOUT } from "./types.js";
import { TIMEOUT_CODE } from "./refresh.js";
import type { IdentityRpc } from "./types.js";
const ALLOWED_METHODS = [
  "agent.get",
  "pane.read",
  "pane.get",
  "pane.copy_motion",
  "pane.process_info",
];
function responseFrame(text: string, id: string) {
  const response = object(JSON.parse(text));
  if (response.id === id && object(response.error).code === "stale_content")
    throw Object.assign(new Error("Live footer changed during capture"), {
      code: CONTENT_CHANGED_CODE,
    });
  if (response.id !== id || response.error || !response.result)
    throw new Error("Invalid identity response");
  return response;
}
function responseError(error: unknown) {
  return code(error) === CONTENT_CHANGED_CODE && error instanceof Error
    ? error
    : new Error("Invalid identity response");
}
// Herdr protocol 22: newline-delimited request/response. Every call closes its socket.
export function makeIdentityRpc(endpoint: string): IdentityRpc {
  let sequence = 0;
  return (method, params) =>
    new Promise<unknown>((resolve, reject) => {
      if (!ALLOWED_METHODS.includes(method)) {
        reject(new Error("Unsupported identity command"));
        return;
      }
      const id = `starnet-identity:${String(++sequence)}`;
      const socket = net.createConnection(endpoint);
      const decoder = new StringDecoder("utf8");
      let bytes = 0,
        chunks = "",
        settled = false;
      function finish(error: Error | null, response?: unknown) {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        socket.destroy();
        if (error) reject(error);
        else resolve(response);
      }
      const deadline = setTimeout(() => {
        finish(Object.assign(new Error("Identity read timed out"), { code: TIMEOUT_CODE }));
      }, TIMEOUT);
      socket.on("connect", () => socket.write(JSON.stringify({ id, method, params }) + "\n"));
      socket.on("error", () => {
        finish(new Error("Identity socket unavailable"));
      });
      socket.on("close", () => {
        finish(new Error("Identity socket closed"));
      });
      socket.on("data", (chunk) => {
        bytes += chunk.length;
        if (bytes > MAX_RESPONSE) {
          finish(new Error("Identity response too large"));
          return;
        }
        chunks += decoder.write(chunk);
        const end = chunks.indexOf("\n");
        if (end < 0) return;
        try {
          finish(null, responseFrame(chunks.slice(0, end), id));
        } catch (error) {
          finish(responseError(error));
        }
      });
    });
}
