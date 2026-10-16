import { STATUS } from "./status.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import crypto from "node:crypto";
import { makeObserver } from "../sidecar/observer/index.js";
import { loadThemePack } from "../sidecar/themes/index.js";
import { redact } from "../sidecar/redaction.js";
import { resolveRuntimePaths } from "./runtime-paths.js";
import type { ServerOptions, JsonReply, HttpObserver } from "./contracts.js";
import { secureResponse, localOrigin, authorized, errorField, errorMessage } from "./security.js";
import { controlRequest } from "./control.js";
import { observerApi } from "./api.js";
import { staticFile, MIME } from "./static.js";
import { bootstrap } from "./bootstrap.js";
import { ownLifecycle } from "./lifecycle.js";
const TOKEN_BYTES = 32;
const ABSENT = "ENOENT",
  DIRECTORY = "EISDIR",
  NOT_DIRECTORY = "ENOTDIR";
const REQUEST_FAILED = "Observer request failed";
function requestFailure(error: unknown, json: JsonReply) {
  const code = errorField(error, "code");
  if (code === ABSENT || code === DIRECTORY || code === NOT_DIRECTORY) {
    json(STATUS.NOT_FOUND, { error: "Not found" });
    return;
  }
  if (error instanceof URIError) {
    json(STATUS.BAD_REQUEST, { error: "Invalid URL" });
    return;
  }
  console.warn("[observer]", redact(errorMessage(error)));
  json(STATUS.INTERNAL_ERROR, { error: REQUEST_FAILED });
}
async function readRequest(
  req: IncomingMessage,
  res: ServerResponse,
  options: {
    observer: HttpObserver;
    token: string;
    publicRoot: string;
    boot: () => string;
    json: JsonReply;
  },
) {
  try {
    const url = new URL(req.url ?? "", "http://" + String(req.headers.host));
    if (url.pathname.startsWith("/api/")) {
      if (!authorized(req, options.token)) {
        options.json(STATUS.FORBIDDEN, { error: "Observer token required; reload the page" });
        return;
      }
      await observerApi(url, options.observer, options.json);
      return;
    }
    await staticFile({
      root: options.publicRoot,
      url,
      req,
      res,
      json: options.json,
      boot: options.boot,
    });
  } catch (error) {
    requestFailure(error, options.json);
  }
}
export function createServer(options: ServerOptions = {}) {
  const { observer: source, token: suppliedToken, theme = {}, control = null } = options;
  const observer: HttpObserver = source === undefined ? makeObserver({ now: Date.now }) : source;
  const token =
    suppliedToken === undefined ? crypto.randomBytes(TOKEN_BYTES).toString("hex") : suppliedToken;
  const { publicRoot } = resolveRuntimePaths();
  const themePack = loadThemePack(theme, publicRoot);
  const boot = bootstrap({ token, theme, control, publicRoot }, themePack);
  const presentation = observer.presentation === true;
  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const address = server.address();
    const port = address && typeof address !== "string" ? address.port : undefined;
    const nonce = secureResponse(res);
    const json: JsonReply = (status, body) => {
      res.writeHead(status, { "Content-Type": MIME[".json"] ?? "application/json; charset=utf-8" });
      res.end(JSON.stringify(body));
    };
    if (!localOrigin(req, port)) {
      json(STATUS.FORBIDDEN, { error: "Local origin required" });
      return;
    }
    if (
      await controlRequest({
        req,
        control,
        presentation,
        authorized: () => authorized(req, token),
        json,
      })
    )
      return;
    if (req.method !== "GET") {
      json(STATUS.METHOD_NOT_ALLOWED, { error: "Read-only server: GET required" });
      return;
    }
    await readRequest(req, res, { observer, token, publicRoot, boot: () => boot(nonce), json });
  };
  const server = ownLifecycle((req, res) => {
    void handle(req, res);
  }, observer);
  return server;
}
