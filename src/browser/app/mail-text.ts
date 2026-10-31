import { age } from "../model/description.js";
import type { AppBus, AppMessage, AppRow } from "./data.js";

const PROVIDERS: Readonly<Record<string, string>> = {
  codex: "Codex",
  claude: "Claude",
  chatgpt: "ChatGPT",
};
// Relayed mail's delivery as llm-bus's bridge last synchronized it: storage and delivery are never proof of handling.
const RELAY_TEXT: Readonly<Record<string, string>> = {
  queued_local: "queued here for the relay",
  accepted_remote: "held at the relay",
  delivered_local: "delivered to the far machine, not acknowledged",
  acknowledged: "acknowledged",
  expired: "expired at the relay (30 days)",
  unknown: "relay state unknown",
};
// Wake is a request to the recipient's host, never proof the message was read.
const WAKE_TEXT: Readonly<Record<string, string>> = {
  requested: "wake requested",
  failed: "wake failed",
  unsupported: "wake unsupported",
  unknown: "wake state unknown",
  none: "no wake recorded",
};
export const mailPending = (message: AppMessage) =>
  !message.acknowledgedAt && message.relay?.state !== "expired";
export function mailStatus(message: AppMessage) {
  if (message.relay && (message.relay.direction === "out" || message.relay.state === "expired"))
    return RELAY_TEXT[message.relay.state] || "relay state unknown";
  return message.acknowledgedAt
    ? "acknowledged"
    : "not acknowledged · " + (WAKE_TEXT[message.wake ?? ""] || "wake state unknown");
}
export function busHealth(bus: AppBus | null, now: number) {
  if (!bus) return "Bus not read yet";
  if (bus.health === "available")
    return (
      "Live · llm-bus" +
      (bus.remote
        ? " · relay " + String(bus.remote.machine) + " ⇄ " + String(bus.remote.relay)
        : "")
    );
  const reasons: Readonly<Record<string, string>> = {
    missing: "No bus database found",
    unsupported: "Bus SQLite support unavailable; use the supported Bun runtime",
    unreadable: "Bus unreadable",
    unstable: "Bus busy while copying · retrying",
  };
  const reason = reasons[bus.reason ?? ""] || "Bus unavailable";
  return reason + (bus.observedAt ? " · last known " + age(bus.observedAt, now) : "");
}
interface MailTextOptions {
  rowFor(id: string): AppRow | undefined;
  workerName(row: AppRow): string;
  now(): number;
}
export function createMailText(options: MailTextOptions) {
  function endpointLabel(id: string | undefined, message: AppMessage, side: "from" | "to") {
    if (id === "ambiguous") return "Ambiguous session";
    const row = id ? options.rowFor(id) : undefined;
    if (row) return options.workerName(row) + " · " + (row.project || "Unassigned");
    // The far side of relayed mail: the machine, shared repo and provider llm-bus routed it by (never a session id).
    const relay = message.relay;
    const far = relay && (relay.direction === "out") === (side === "to");
    return far
      ? (relay.provider ? PROVIDERS[relay.provider] || relay.provider : "Agent") +
          " on " +
          relay.machine +
          " · " +
          String(relay.repo) +
          " (via relay)"
      : "Outside the observer";
  }
  function mailDetail(message: AppMessage) {
    return (
      "Message #" +
      String(message.id) +
      " · from " +
      endpointLabel(message.from, message, "from") +
      " · to " +
      endpointLabel(message.to, message, "to") +
      " · sent " +
      (age(message.sentAt, options.now()) || "at an unknown time") +
      " · " +
      mailStatus(message) +
      (message.replyTo ? " · reply to #" + String(message.replyTo) : "") +
      (message.to && options.rowFor(message.to)
        ? ""
        : message.from && options.rowFor(message.from)
          ? message.relay
            ? " · the recipient is on another machine; showing sender"
            : " · recipient is not an observed pane; showing sender"
          : " · neither side is an observed pane")
    );
  }
  return { endpointLabel, mailDetail };
}
