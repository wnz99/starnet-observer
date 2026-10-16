import type { Projection } from "./contracts.js";
import { assignment, HelperClaims } from "./helper-state.js";
import { list, object, positiveTime, string } from "./values.js";
const MILLISECONDS_PER_SECOND = 1000;
const FAILED = "failed";
const TASKS = [
  "task_started",
  "turn_started",
  "task_complete",
  "turn_complete",
  "shutdown_complete",
];
function ownTask(
  state: Projection,
  record: Record<string, unknown>,
  payload: Record<string, unknown>,
  at: number | null,
) {
  const type = string(payload.type);
  if (record.type !== "event_msg" || !type || !TASKS.includes(type)) return;
  const terminal = ["task_complete", "turn_complete"].includes(type);
  const seconds = terminal ? payload.completed_at : payload.started_at;
  const observedAt =
    at ??
    (positiveTime(seconds) === null
      ? null
      : positiveTime(Number(seconds) * MILLISECONDS_PER_SECOND));
  const event = {
    status: taskStatus(type, terminal, payload.error),
    source: "codex:" + type,
    observedAt,
  };
  new HelperClaims(state).own(event);
}
function nativeCall(
  state: Projection,
  record: Record<string, unknown>,
  payload: Record<string, unknown>,
  at: number | null,
) {
  if (
    record.type !== "response_item" ||
    payload.type !== "function_call" ||
    payload.name !== "spawn_agent"
  )
    return;
  try {
    const args: unknown = JSON.parse(string(payload.arguments) ?? "");
    new HelperClaims(state).call(
      payload.call_id,
      assignment(object(args).task_name, "codex:spawn_agent", at),
    );
  } catch {
    /* Invalid native arguments carry no assignment. */
  }
}
function spawnEvents(
  state: Projection,
  record: Record<string, unknown>,
  sessionId: string,
  at: number | null,
) {
  const payload = object(record.payload);
  if (record.type !== "event_msg" || payload.sender_thread_id !== sessionId) return;
  if (payload.type === "collab_agent_spawn_begin")
    new HelperClaims(state).call(
      payload.call_id,
      assignment(null, "codex:collab_agent_spawn", at ?? positiveTime(payload.started_at_ms)),
    );
  const id = string(payload.call_id),
    call = id ? state.helperCalls.get(id) : undefined;
  if (payload.type === "collab_agent_spawn_end" && payload.new_thread_id && call)
    new HelperClaims(state).spawn(payload.new_thread_id, { ...call, toolUseId: id });
}
function spawnItem(
  state: Projection,
  item: Record<string, unknown>,
  sessionId: string,
  at: number | null,
) {
  if (
    item.type !== "CollabAgentToolCall" ||
    item.tool !== "spawn_agent" ||
    item.status !== "completed" ||
    item.sender_thread_id !== sessionId
  )
    return;
  for (const child of list(item.receiver_thread_ids))
    new HelperClaims(state).spawn(child, {
      ...assignment(null, "codex:CollabAgentToolCall", at),
      toolUseId: string(item.id),
    });
}
function activityEvent(state: Projection, activity: Record<string, unknown>, at: number | null) {
  if (typeof activity.agent_thread_id !== "string") return;
  const callId = string(activity.id || activity.event_id),
    call = callId ? state.helperCalls.get(callId) : undefined;
  const observedAt = at ?? positiveTime(activity.occurred_at_ms);
  if (call && activity.kind === "started")
    new HelperClaims(state).spawn(activity.agent_thread_id, { ...call, toolUseId: callId });
  if (activity.kind === "started" || activity.kind === "completed")
    new HelperClaims(state).event(activity.agent_thread_id, {
      status: activity.kind === "started" ? "running" : "completed",
      source: "codex:SubAgentActivity",
      observedAt,
    });
}
export function codexHelpers(
  state: Projection,
  record: Record<string, unknown>,
  sessionId: string,
  at: number | null,
) {
  const payload = object(record.payload);
  ownTask(state, record, payload, at);
  nativeCall(state, record, payload, at);
  spawnEvents(state, record, sessionId, at);
  const item =
    record.type === "event_msg" &&
    (payload.type === "item_started" || payload.type === "item_completed")
      ? object(payload.item)
      : {};
  spawnItem(state, item, sessionId, at);
  const activity =
    item.type === "SubAgentActivity"
      ? item
      : record.type === "event_msg" && payload.type === "sub_agent_activity"
        ? payload
        : {};
  activityEvent(state, activity, at);
}

function taskStatus(type: string, terminal: boolean, error: unknown) {
  if (type === "shutdown_complete") return "stopped";
  if (!terminal) return "running";
  return error ? FAILED : "completed";
}
