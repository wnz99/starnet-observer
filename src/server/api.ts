import { MESSAGE_IDENTITY } from "../sidecar/bus/types.js";
import { STATUS } from "./status.js";
import { errorField } from "./security.js";
import type { HttpObserver, JsonReply } from "./contracts.js";
const SESSION_IDENTITY =
  /^(?:(?:codex|claude):[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}|(?:helper:)?obs_[a-f0-9]{24})(?:\|obs_[a-f0-9]{24})?$/i;
const MAX_IDENTITY_LENGTH = 128;
const REMOTE_HOST_GROUP = 2;
function inspectionReason(data: unknown) {
  if (data === null || data === undefined)
    throw new TypeError(String(data) + " is not an object (evaluating 'data.reason')");
  return errorField(data, "reason");
}
function invalidSessionIdentity(identities: string[]) {
  return (
    identities.length > 1 ||
    (identities.length === 1 &&
      ((identities[0] ?? "").length > MAX_IDENTITY_LENGTH ||
        !SESSION_IDENTITY.test(identities[0] ?? "")))
  );
}
async function session(id: string, identities: string[], observer: HttpObserver, json: JsonReply) {
  if (invalidSessionIdentity(identities)) {
    json(STATUS.BAD_REQUEST, { id, health: "unavailable", reason: "invalid-identity", turns: [] });
    return;
  }
  if (!observer.inspect) throw new TypeError("observer.inspect is not a function");
  const data = await observer.inspect(id, identities[0]);
  json(inspectionReason(data) === "unknown-session" ? STATUS.NOT_FOUND : STATUS.OK, data);
}
function remoteMessage(url: URL, identities: string[], json: JsonReply) {
  // A remote host's message is addressed id@host; its body lives on that host's disk, so it is never inspectable here.
  const remote = url.pathname.match(
    /^\/api\/observer\/messages\/([1-9][0-9]{0,15})@([a-z0-9][a-z0-9-]{0,31})\/inspect$/,
  );
  const id = remote?.[1],
    host = remote?.[REMOTE_HOST_GROUP];
  if (!id || !host || !Number.isSafeInteger(Number(id))) return false;
  const invalid = identities.length > 0;
  json(invalid ? STATUS.BAD_REQUEST : STATUS.OK, {
    id: id + "@" + host,
    identity: null,
    health: "unavailable",
    reason: invalid ? "invalid-identity" : "remote-inspect",
    text: null,
  });
  return true;
}
async function localMessage(
  id: number,
  identities: string[],
  observer: HttpObserver,
  json: JsonReply,
) {
  if (
    identities.length > 1 ||
    (identities.length === 1 && !MESSAGE_IDENTITY.test(identities[0] ?? ""))
  ) {
    json(STATUS.BAD_REQUEST, {
      id,
      identity: null,
      health: "unavailable",
      reason: "invalid-identity",
      text: null,
    });
    return;
  }
  if (!observer.inspectMessage) throw new TypeError("observer.inspectMessage is not a function");
  const data = await observer.inspectMessage(id, identities[0]);
  json(inspectionReason(data) === "missing-message" ? STATUS.NOT_FOUND : STATUS.OK, data);
}
export async function observerApi(url: URL, observer: HttpObserver, json: JsonReply) {
  if (url.pathname === "/api/observer/sessions") {
    json(STATUS.OK, await observer.get());
    return;
  }
  const identities = url.searchParams.getAll("identity");
  const sessionId = url.pathname.match(
    /^\/api\/observer\/sessions\/(obs_[a-f0-9]{24})\/inspect$/,
  )?.[1];
  if (sessionId) {
    await session(sessionId, identities, observer, json);
    return;
  }
  if (remoteMessage(url, identities, json)) return;
  const mailId = url.pathname.match(
    /^\/api\/observer\/messages\/([1-9][0-9]{0,15})\/inspect$/,
  )?.[1];
  if (mailId && Number.isSafeInteger(Number(mailId))) {
    await localMessage(Number(mailId), identities, observer, json);
    return;
  }
  json(STATUS.NOT_FOUND, { error: "Unknown observer route" });
}
