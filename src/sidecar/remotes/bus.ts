const MAX_BUS_WINDOW = 1000,
  DEFAULT_BUS_WINDOW = 100;
import { sanitizeRelay, sanitizeRemote } from "./relay.js";
import { LIMITS } from "./limits.js";
import type { ObserverSnapshot } from "../../shared/observer.js";
import { ID, remap, matches, has, record, text, time } from "./fields.js";
/* A remote host's own llm-bus, as its observer published it (publicBus shape). Each host's bus stands alone: message
   ids stay that host's integers, and every message also carries its hub-wide key "id@host" and its host. Endpoints are
   re-derived exactly like the rows (remap), and anything that does not name a surviving row of that host becomes
   'external'. Message identities are dropped: a remote body is never inspectable from the hub. */
// Same vocabulary as the local reader (src/sidecar/bus/index.ts): anything else from a remote reads as 'unknown'.
const FAILED_WAKE = "failed";
const WAKES = new Set(["requested", FAILED_WAKE, "unsupported", "none", "unknown"] as const);
const MAX_MESSAGES = 200;
export function sanitizeBus(
  host: string,
  bus: unknown,
  rowIds: Set<string>,
  receivedAt: number,
): ObserverSnapshot["bus"] {
  if (!record(bus) || !Array.isArray(bus.messages)) return null;
  const endpoint = (value: unknown) =>
    value === "external" || value === "ambiguous"
      ? value
      : matches(ID, value) && rowIds.has(remap(host, value))
        ? remap(host, value)
        : "external";
  const messages = bus.messages.slice(0, MAX_MESSAGES).flatMap((message: unknown) => {
    const safe = sanitizeMessage(message, host, endpoint);
    return safe ? [safe] : [];
  });
  const health = bus.health === "available" ? "available" : "unavailable",
    remote = sanitizeRemote(bus.remote, (value) =>
      matches(ID, value) && rowIds.has(remap(host, value)) ? remap(host, value) : null,
    );
  return {
    health,
    reason: health === "available" ? null : text(bus.reason, LIMITS.LABEL) || "unreadable",
    observedAt: health === "available" ? receivedAt : null,
    window: busWindow(bus.window),
    messages,
    ...(remote ? { remote } : {}),
  };
}

function sanitizeMessage(
  message: unknown,
  host: string,
  endpoint: (value: unknown) => string,
): NonNullable<ObserverSnapshot["bus"]>["messages"][number] | null {
  if (
    !record(message) ||
    typeof message.id !== "number" ||
    !Number.isSafeInteger(message.id) ||
    message.id < 1
  )
    return null;
  const relay = sanitizeRelay(message.relay);
  return {
    id: message.id,
    key: `${String(message.id)}@${host}`,
    host,
    from: endpoint(message.from),
    to: endpoint(message.to),
    sentAt: time(message.sentAt),
    acknowledgedAt: time(message.acknowledgedAt),
    wake: has(WAKES, message.wake) ? message.wake : "unknown",
    ...(relay ? { relay } : {}),
  };
}

function busWindow(value: unknown) {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= MAX_BUS_WINDOW
    ? value
    : DEFAULT_BUS_WINDOW;
}
