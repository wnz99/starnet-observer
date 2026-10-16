import type { Projection, SessionContext } from "./contracts.js";
import { INSPECTION_WINDOW } from "./fields.js";
import { assignment, HelperClaims } from "./helper-state.js";
import { list, object, string } from "./values.js";
import { textBlocks } from "./values.js";
const STATUSES = ["running", "completed", "failed", "killed", "stopped"];
function calls(state: Projection, record: Record<string, unknown>, at: number | null) {
  if (record.type !== "assistant") return;
  for (const block of list(object(record.message).content).map(object)) {
    if (
      block.type === "tool_use" &&
      (block.name === "Agent" || block.name === "Task") &&
      typeof block.id === "string"
    )
      new HelperClaims(state).call(
        block.id,
        assignment(object(block.input).description, "claude:Agent", at),
      );
  }
}
function spawns(state: Projection, record: Record<string, unknown>) {
  const result = object(record.toolUseResult);
  if (
    record.type !== "user" ||
    result.status !== "async_launched" ||
    !/^[A-Za-z0-9_-]{1,100}$/.test(string(result.agentId) ?? "")
  )
    return;
  for (const block of list(object(record.message).content).map(object)) {
    const id = string(block.tool_use_id);
    const call =
      block.type === "tool_result" && !block.is_error && id ? state.helperCalls.get(id) : undefined;
    if (call) new HelperClaims(state).spawn(result.agentId, { ...call, toolUseId: id });
  }
}
function envelopeFields(content: string): Record<string, string> | null {
  const envelope = content
    .trim()
    .match(/^<task-notification>\s*([\s\S]*?)\s*<\/task-notification>$/);
  if (!envelope?.[1]) return null;
  // Reject nested envelopes, duplicate fields and tags hidden inside arbitrary elements.
  const body = envelope[1].replace(/<(result|usage)>[\s\S]*?<\/\1>/g, "");
  const fields: Record<string, string> = {};
  const duplicates = new Set<string>();
  const rest = body.replace(
    /<([a-z-]+)>([^<>]*)<\/\1>/g,
    (_: string, key: string, value: string) => {
      if (Object.hasOwn(fields, key)) duplicates.add(key);
      fields[key] = value.trim();
      return "";
    },
  );
  return duplicates.size === 0 && rest.trim().length === 0 ? fields : null;
}
function notification(state: Projection, record: Record<string, unknown>, at: number | null) {
  const content =
    record.type === "queue-operation" ? record.content : textBlocks(object(record.message).content);
  if (typeof content !== "string" || content.length > INSPECTION_WINDOW.readBytes) return;
  // Native envelopes only. Strip result bodies before reading direct XML children.
  const fields = taskFields(content);
  if (!fields) return;
  const { child, status } = fields;
  new HelperClaims(state).event(child, {
    status,
    toolUseId: fields.toolUseId,
    source:
      "claude:" +
      (record.type === "queue-operation" ? "notification-enqueued" : "notification-delivered"),
    observedAt: at,
  });
}
function snapshotEvent(state: Projection, record: Record<string, unknown>, at: number | null) {
  const attachment = object(record.attachment);
  const status = string(attachment.status);
  if (
    record.type === "attachment" &&
    attachment.type === "task_status" &&
    attachment.taskType === "local_agent" &&
    typeof attachment.taskId === "string" &&
    status &&
    STATUSES.includes(status)
  )
    new HelperClaims(state).event(attachment.taskId, {
      status,
      toolUseId: null,
      source: "claude:local_agent-snapshot",
      observedAt: at,
    });
}
export function claudeHelpers(
  state: Projection,
  record: Record<string, unknown>,
  context: SessionContext,
  evidence: { belongs: boolean; at: number | null },
) {
  const { belongs, at } = evidence;
  if (belongs) {
    calls(state, record, at);
    spawns(state, record);
  }
  const canonical = context.binding?.parentSessionId || context.sessionId;
  if (record.sessionId !== canonical) return;
  const native =
    (record.type === "queue-operation" && record.operation === "enqueue") ||
    (belongs && record.type === "user" && object(record.origin).kind === "task-notification");
  if (native) notification(state, record, at);
  snapshotEvent(state, record, at);
}

function taskFields(content: string) {
  const fields = envelopeFields(content),
    child = fields?.["task-id"],
    status = fields?.status;
  if (!child || !status || !STATUSES.includes(status)) return null;
  return { child, status, toolUseId: fields["tool-use-id"] || null };
}
