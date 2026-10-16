import { errorMessage } from "./security.js";
import { STATUS } from "./status.js";
import type { IncomingMessage } from "node:http";
import { actionName, readBody, validateAction, remoteAction } from "./control-body.js";
import type { ControlAction } from "./control-body.js";
import { controlResult, controlStatus, publicControlError } from "./control-result.js";
import type { HttpControl, HttpControlResult, JsonReply } from "./contracts.js";
import { redact } from "../sidecar/redaction.js";
function dispatch(control: HttpControl, request: ControlAction) {
  if (request.action === "overseer") {
    if (!control.overseer) throw new TypeError("control.overseer is not a function");
    return control.overseer(request.provider);
  }
  if (request.action === "spawn-host") {
    if (!control.spawnHost) throw new TypeError("control.spawnHost is not a function");
    return control.spawnHost(request.host, request.folder);
  }
  const method = control[request.action];
  if (!method) throw new TypeError("control[action[1]] is not a function");
  return method(request.paneId);
}
async function execute(
  control: HttpControl,
  request: ControlAction,
  presentation: boolean,
  json: JsonReply,
) {
  try {
    const result: HttpControlResult = await dispatch(control, request);
    json(STATUS.OK, controlResult({ presentation, action: request.action, result }));
  } catch (thrown) {
    const error = thrown instanceof Error ? thrown : new Error(String(thrown));
    const status = controlStatus(error);
    const body = controlResult({ presentation, action: request.action, error });
    if (status >= STATUS.INTERNAL_ERROR)
      console.warn(
        "[observer control]",
        presentation ? publicControlError(error) : redact(errorMessage(error)),
      );
    json(status, body);
  }
}
// Control actions are the one mutating surface, present only when the operator opted in at launch.
export async function controlRequest({
  req,
  control,
  presentation,
  authorized,
  json,
}: {
  req: IncomingMessage;
  control: HttpControl | null;
  presentation: boolean;
  authorized: () => boolean;
  json: JsonReply;
}) {
  const action = control && req.method === "POST" ? actionName(req.url) : null;
  if (!action || !control) return false;
  if (!admitted(req, authorized, json)) return true;
  const body = await readBody(req, json);
  if (!body) return true;
  const request = validateAction(action, body, json);
  if (!request) return true;
  // Presentation masks host identities, so remote control (which would echo them) is unavailable there.
  if (presentation && remoteAction(action, body)) {
    json(
      STATUS.FORBIDDEN,
      controlResult({ presentation, action, error: new Error("control-unavailable") }),
    );
    return true;
  }
  await execute(control, request, presentation, json);
  return true;
}

function admitted(req: IncomingMessage, authorized: () => boolean, json: JsonReply) {
  if (!authorized()) {
    json(STATUS.FORBIDDEN, { error: "Observer token required; reload the page" });
    return false;
  }
  if (!/^application\/json\b/.test(req.headers["content-type"] || "")) {
    json(STATUS.BAD_REQUEST, { error: "JSON body required" });
    return false;
  }
  return true;
}
