"use strict";
const crypto = require("node:crypto");
const { redact } = require("../src/sidecar/redaction.ts");

const {
  INSPECTION_WINDOW: WINDOW,
  field,
  redactText,
} = require("../src/sidecar/inspector/fields.ts");
const KEYS = [
  "model",
  "inputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheWriteTokens",
  "startedAt",
  "lastActivityAt",
  "durationMs",
];
const timestamp = (value) =>
  typeof value === "string" && Number.isFinite(Date.parse(value))
    ? new Date(value).toISOString()
    : null;
const number = (value) => (Number.isSafeInteger(value) && value >= 0 ? value : null);
const hash = (value) =>
  crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 24);
const textBlocks = (content) =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content
          .filter(
            (b) =>
              b &&
              ["text", "input_text", "output_text"].includes(b.type) &&
              typeof b.text === "string",
          )
          .map((b) => b.text)
          .join("\n")
      : "";
function recordBelongsToSession(record, provider, sessionId, binding) {
  if (binding && (binding.provider !== provider || binding.sessionId !== sessionId)) return false;
  const claudeSession = binding ? binding.parentSessionId : sessionId;
  // SDK SessionMessage.session_id is derived from canonical disk sessionId.
  // A raw snake-case transport field is not a second transcript identity.
  const claudeIdentity = record.sessionId === claudeSession;
  if (binding && provider === "claude")
    return (
      record.isSidechain === true &&
      record.isMeta !== true &&
      record.agentId === binding.sessionId &&
      claudeIdentity &&
      ["user", "assistant"].includes(record.type)
    );
  if (provider === "claude")
    return (
      record.isSidechain !== true &&
      record.isMeta !== true &&
      ["user", "assistant"].includes(record.type) &&
      claudeIdentity
    );
  const p = record.payload;
  if (provider === "codex" && record.type === "session_meta")
    return (
      !!p &&
      (p.id === sessionId || p.session_id === sessionId) &&
      ["id", "session_id", "thread_id"].every(
        (key) => p[key] === undefined || p[key] === sessionId,
      ) &&
      (!binding || p.parent_thread_id === binding.parentSessionId)
    );
  if (binding && p?.parent_thread_id && p.parent_thread_id !== binding.parentSessionId)
    return false;
  return (
    !!p &&
    (!p.session_id || p.session_id === sessionId) &&
    (!p.thread_id || p.thread_id === sessionId)
  );
}
function redactStringLeaves(value) {
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map(redactStringLeaves);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactStringLeaves(item)]),
    );
  return value;
}
function toolText(raw) {
  if (raw && typeof raw === "object") return JSON.stringify(redact(redactStringLeaves(raw)));
  if (typeof raw !== "string") return "";
  // JSON arguments/results retain field-aware redaction, including whole credential objects.
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object")
      return JSON.stringify(redact(redactStringLeaves(parsed)));
    if (typeof parsed === "string") return redactText(parsed);
  } catch (_) {
    /* Ordinary tool text is redacted by put(). */ return raw;
  }
  return raw;
}

// Provider task records remain separate from process liveness and Herdr status.
function assignment(value, source, observedAt) {
  const safe = typeof value === "string" ? redactText(value).replace(/[\x00-\x1f\x7f]/g, " ") : "";
  return { summary: safe.slice(0, 240) || null, partial: safe.length > 240, source, observedAt };
}
const positiveTime = (value) => (Number.isSafeInteger(value) && value > 0 ? value : null);
const evidenceTime = (record) =>
  timestamp(record.timestamp) ? Date.parse(record.timestamp) : null;
function boundedSet(map, key, value) {
  map.set(key, value);
  if (map.size <= 512) return false;
  map.delete(map.keys().next().value);
  return true;
}
// Evicted calls can hide later spawn results; evicted spawns can hide conflicts.
function putClaim(state, map, key, value) {
  if (boundedSet(map, key, value)) state.helperClaimsPartial = true;
}
function putSpawn(state, child, spawn) {
  const previous = state.helperSpawns.get(child);
  putClaim(
    state,
    state.helperSpawns,
    child,
    previous === null || (previous && previous.toolUseId !== spawn.toolUseId) ? null : spawn,
  );
}
function putEvent(state, child, event) {
  const previous = state.helperEvents.get(child);
  if (
    previous?.observedAt != null &&
    (event.observedAt == null || event.observedAt < previous.observedAt)
  )
    return;
  boundedSet(state.helperEvents, child, event);
}
function consumeHelperMetadata(state, record, provider, sessionId, binding) {
  const belongs = recordBelongsToSession(record, provider, sessionId, binding);
  const canonical = binding?.parentSessionId || sessionId;
  const at = evidenceTime(record);
  if (provider === "claude") {
    if (belongs && record.type === "assistant" && Array.isArray(record.message?.content)) {
      for (const block of record.message.content)
        if (
          block?.type === "tool_use" &&
          ["Agent", "Task"].includes(block.name) &&
          typeof block.id === "string"
        ) {
          putClaim(
            state,
            state.helperCalls,
            block.id,
            assignment(block.input?.description, "claude:Agent", at),
          );
        }
    }
    if (
      belongs &&
      record.type === "user" &&
      record.toolUseResult?.status === "async_launched" &&
      /^[A-Za-z0-9_-]{1,100}$/.test(record.toolUseResult.agentId || "")
    ) {
      const results = record.message?.content;
      if (Array.isArray(results))
        for (const block of results) {
          const call =
            block?.type === "tool_result" &&
            !block.is_error &&
            state.helperCalls.get(block.tool_use_id);
          if (call)
            putSpawn(state, record.toolUseResult.agentId, {
              ...call,
              toolUseId: block.tool_use_id,
            });
        }
    }
    // Native envelopes only. Strip result bodies before reading direct XML children.
    const native =
      record.sessionId === canonical &&
      ((record.type === "queue-operation" && record.operation === "enqueue") ||
        (belongs && record.type === "user" && record.origin?.kind === "task-notification"));
    const content =
      record.type === "queue-operation" ? record.content : textBlocks(record.message?.content);
    if (native && typeof content === "string" && content.length <= WINDOW.readBytes) {
      const envelope = content
        .trim()
        .match(/^<task-notification>\s*([\s\S]*?)\s*<\/task-notification>$/);
      if (envelope) {
        // Reject nested envelopes, duplicate fields and tags hidden inside arbitrary elements.
        const body = envelope[1].replace(/<(result|usage)>[\s\S]*?<\/\1>/g, "");
        const fields = {};
        let valid = true;
        const rest = body.replace(/<([a-z-]+)>([^<>]*)<\/\1>/g, (_, key, value) => {
          if (Object.hasOwn(fields, key)) valid = false;
          fields[key] = value.trim();
          return "";
        });
        if (
          valid &&
          !rest.trim() &&
          fields["task-id"] &&
          ["running", "completed", "failed", "killed", "stopped"].includes(fields.status)
        )
          putEvent(state, fields["task-id"], {
            status: fields.status,
            toolUseId: fields["tool-use-id"] || null,
            source:
              "claude:" +
              (record.type === "queue-operation"
                ? "notification-enqueued"
                : "notification-delivered"),
            observedAt: at,
          });
      }
    }
    const a = record.attachment;
    if (
      record.sessionId === canonical &&
      record.type === "attachment" &&
      a?.type === "task_status" &&
      a.taskType === "local_agent" &&
      typeof a.taskId === "string" &&
      ["running", "completed", "failed", "killed", "stopped"].includes(a.status)
    )
      putEvent(state, a.taskId, {
        status: a.status,
        toolUseId: null,
        source: "claude:local_agent-snapshot",
        observedAt: at,
      });
  } else if (belongs) {
    const p = record.payload;
    if (
      record.type === "event_msg" &&
      [
        "task_started",
        "turn_started",
        "task_complete",
        "turn_complete",
        "shutdown_complete",
      ].includes(p?.type)
    ) {
      const terminal = ["task_complete", "turn_complete"].includes(p.type);
      const seconds = terminal ? p.completed_at : p.started_at;
      const observedAt =
        at ?? (Number.isSafeInteger(seconds) && seconds > 0 ? positiveTime(seconds * 1000) : null);
      const event = {
        status:
          p.type === "shutdown_complete"
            ? "stopped"
            : terminal
              ? p.error
                ? "failed"
                : "completed"
              : "running",
        source: "codex:" + p.type,
        observedAt,
      };
      if (
        !state.ownTask ||
        state.ownTask.observedAt == null ||
        (observedAt != null && observedAt >= state.ownTask.observedAt)
      )
        state.ownTask = event;
    }
    if (
      record.type === "response_item" &&
      p?.type === "function_call" &&
      p.name === "spawn_agent"
    ) {
      try {
        const args = JSON.parse(p.arguments);
        putClaim(
          state,
          state.helperCalls,
          p.call_id,
          assignment(args.task_name, "codex:spawn_agent", at),
        );
      } catch (_) {
        /* Invalid native arguments carry no assignment. */
      }
    }
    if (
      record.type === "event_msg" &&
      p?.type === "collab_agent_spawn_begin" &&
      p.sender_thread_id === sessionId
    )
      putClaim(
        state,
        state.helperCalls,
        p.call_id,
        assignment(null, "codex:collab_agent_spawn", at ?? positiveTime(p.started_at_ms)),
      );
    if (
      record.type === "event_msg" &&
      p?.type === "collab_agent_spawn_end" &&
      p.sender_thread_id === sessionId &&
      p.new_thread_id &&
      state.helperCalls.has(p.call_id)
    )
      putSpawn(state, p.new_thread_id, {
        ...state.helperCalls.get(p.call_id),
        toolUseId: p.call_id,
      });
    const item =
      record.type === "event_msg" && ["item_started", "item_completed"].includes(p?.type)
        ? p.item
        : null;
    if (
      item?.type === "CollabAgentToolCall" &&
      item.tool === "spawn_agent" &&
      item.status === "completed" &&
      item.sender_thread_id === sessionId &&
      Array.isArray(item.receiver_thread_ids)
    )
      for (const child of item.receiver_thread_ids)
        putSpawn(state, child, {
          ...assignment(null, "codex:CollabAgentToolCall", at),
          toolUseId: item.id,
        });
    const activity =
      item?.type === "SubAgentActivity"
        ? item
        : record.type === "event_msg" && p?.type === "sub_agent_activity"
          ? p
          : null;
    if (activity && typeof activity.agent_thread_id === "string") {
      const callId = activity.id || activity.event_id,
        call = state.helperCalls.get(callId);
      const observedAt = at ?? positiveTime(activity.occurred_at_ms);
      if (call && activity.kind === "started")
        putSpawn(state, activity.agent_thread_id, { ...call, toolUseId: callId });
      if (["started", "completed"].includes(activity.kind))
        putEvent(state, activity.agent_thread_id, {
          status: activity.kind === "started" ? "running" : "completed",
          source: "codex:SubAgentActivity",
          observedAt,
        });
    }
  }
}

function createProjection() {
  return {
    generation: crypto.randomUUID(),
    turns: new Map(),
    usage: new Map(),
    totals: null,
    model: null,
    helperCalls: new Map(),
    helperSpawns: new Map(),
    helperEvents: new Map(),
    helperClaimsPartial: false,
    ownTask: null,
    startedAt: null,
    lastActivityAt: null,
    lastEntryAt: null,
    truncated: false,
    bounded: false,
    usagePartial: false,
    modelPartial: false,
  };
}
function put(state, key, role, at, raw, tool) {
  if (!raw && !tool) return;
  // Redact BEFORE clipping so a key straddling the display limit cannot leak a prefix.
  const safe = redactText(raw);
  const entry = {
    id: state.generation + ":" + hash(key),
    role,
    at,
    text: safe.slice(0, WINDOW.maxTextChars),
    textTruncated: safe.length > WINDOW.maxTextChars,
    ...(tool ? { tool } : {}),
  };
  if (entry.textTruncated) state.truncated = true;
  state.turns.set(key, entry);
  let chars = Array.from(state.turns.values()).reduce((sum, value) => sum + value.text.length, 0);
  while (state.turns.size > WINDOW.maxTurns || chars > WINDOW.maxTotalChars) {
    const first = state.turns.keys().next().value;
    chars -= state.turns.get(first).text.length;
    state.turns.delete(first);
    state.truncated = true;
  }
}
function ordinaryMessage(record, provider, payload) {
  return (
    provider === "claude" ||
    (record.type === "response_item" &&
      payload.type === "message" &&
      ["user", "assistant"].includes(payload.role) &&
      !["analysis", "summary"].includes(payload.channel))
  );
}
function consumeMetadata(state, record, provider, position, sessionId, binding, options = {}) {
  consumeHelperMetadata(state, record, provider, sessionId, binding);
  const p = provider === "codex" ? record.payload : record.message;
  if (!p || typeof p !== "object") return;
  if (!recordBelongsToSession(record, provider, sessionId, binding)) return;
  const at = timestamp(record.timestamp);
  const ordinary = ordinaryMessage(record, provider, p);
  if (
    !options.header &&
    at &&
    (ordinary ||
      record.type === "response_item" ||
      record.type === "event_msg" ||
      record.type === "token_usage_record") &&
    (!state.lastActivityAt || at > state.lastActivityAt)
  )
    state.lastActivityAt = at;
  // Idle age: only timestamped conversation rows count. Claude rewrites and appends untimestamped bookkeeping rows
  // (and touches files on startup), so neither file mtime nor non-conversation rows are evidence of activity.
  const entry =
    provider === "claude"
      ? ["user", "assistant"].includes(record.type)
      : ["response_item", "event_msg"].includes(record.type);
  if (!options.header && at && entry && (!state.lastEntryAt || at > state.lastEntryAt))
    state.lastEntryAt = at;
  if (provider === "codex" && record.type === "session_meta")
    state.startedAt = timestamp(p.timestamp) || at;
  if (provider === "claude" && !state.startedAt && (options.beginning || position === 0))
    state.startedAt = at;
  if (
    (provider === "codex" && record.type === "turn_context") ||
    (provider === "claude" && record.type === "assistant")
  ) {
    if (typeof p.model === "string") {
      state.model = redactText(p.model).slice(0, 160);
      state.modelPartial = false;
    }
  }
  if (options.header) return;
  if (provider === "codex") {
    const total =
      record.type === "token_usage_record"
        ? p.thread_token_usage
        : record.type === "event_msg" && p.type === "token_count"
          ? p.info?.total_token_usage
          : null;
    if (total && typeof total === "object")
      state.totals = {
        inputTokens: number(total.input_tokens),
        outputTokens: number(total.output_tokens),
        cacheReadTokens: number(total.cached_input_tokens),
        cacheWriteTokens: number(total.cache_write_input_tokens),
      };
  } else {
    if (record.type === "assistant" && p.id && p.usage && typeof p.usage === "object") {
      const next = {
        inputTokens: number(p.usage.input_tokens),
        outputTokens: number(p.usage.output_tokens),
        cacheReadTokens: number(p.usage.cache_read_input_tokens),
        cacheWriteTokens: number(p.usage.cache_creation_input_tokens),
      };
      const prev = state.usage.get(p.id);
      // Streaming blocks repeat the message usage; merge observations of the SAME message, never sum them.
      if (prev)
        for (const key of Object.keys(next))
          next[key] =
            next[key] == null
              ? prev[key]
              : prev[key] == null
                ? next[key]
                : Math.max(prev[key], next[key]);
      state.usage.set(p.id, next);
      if (state.usage.size > 512) {
        state.usage.delete(state.usage.keys().next().value);
        state.usagePartial = true;
      }
    } else if (record.type === "assistant") state.usagePartial = true;
  }
}
function consume(state, record, provider, position, sessionId, binding, options) {
  consumeMetadata(state, record, provider, position, sessionId, binding, options);
  const p = provider === "codex" ? record.payload : record.message;
  if (!p || typeof p !== "object" || !recordBelongsToSession(record, provider, sessionId, binding))
    return;
  const at = timestamp(record.timestamp);
  const ordinary = ordinaryMessage(record, provider, p);
  if (provider === "codex") {
    if (ordinary) put(state, "message:" + position, p.role, at, textBlocks(p.content));
  } else {
    // Claude emits multiple blocks for one message. UUID identifies each record; message id identifies usage.
    put(state, "message:" + (record.uuid || position), record.type, at, textBlocks(p.content));
  }
  const blocks = provider === "claude" && Array.isArray(p.content) ? p.content : [p];
  for (const b of blocks) {
    if (!b || typeof b !== "object") continue;
    const call =
      provider === "codex" &&
      record.type === "response_item" &&
      ["function_call", "custom_tool_call"].includes(b.type);
    const use = provider === "claude" && record.type === "assistant" && b.type === "tool_use";
    const output =
      provider === "codex" &&
      record.type === "response_item" &&
      ["function_call_output", "custom_tool_call_output"].includes(b.type);
    const result = provider === "claude" && record.type === "user" && b.type === "tool_result";
    const callId = call || output ? b.call_id : use ? b.id : result ? b.tool_use_id : null;
    if (typeof callId !== "string" || callId.length > 200) continue;
    const key = "tool:" + callId,
      previous = state.turns.get(key);
    if ((call || use) && !previous)
      put(state, key, "tool", at, toolText(call ? (b.arguments ?? b.input) : b.input), {
        name: redactText(typeof b.name === "string" ? b.name : "Tool").slice(0, 120),
        phase: "started",
        outcome: "unknown",
      });
    if (output || result) {
      const raw = output ? b.output : b.content;
      const body = Array.isArray(raw)
        ? raw
            .filter(
              (b) =>
                b &&
                ["text", "input_text", "output_text"].includes(b.type) &&
                typeof b.text === "string",
            )
            .map((b) => toolText(b.text))
            .join("\n")
        : toolText(raw);
      put(state, key, "tool", previous?.at || at, body, {
        name: previous?.tool.name || "Tool",
        phase: "finished",
        outcome:
          result && typeof b.is_error === "boolean" ? (b.is_error ? "error" : "ok") : "unknown",
      });
    }
  }
}
function metadata(state, provider, now) {
  const stats = Object.fromEntries(KEYS.map((key) => [key, field(null)]));
  stats.model = field(state.model, state.modelPartial ? "partial" : "available");
  stats.startedAt = field(state.startedAt);
  stats.lastActivityAt = field(state.lastActivityAt);
  stats.durationMs = field(state.startedAt ? Math.max(0, now - Date.parse(state.startedAt)) : null);
  for (const key of ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens"]) {
    if (provider === "codex") stats[key] = field(state.totals?.[key]);
    else {
      const values = Array.from(state.usage.values()).map((u) => u[key]);
      const present = values.filter((v) => v != null);
      stats[key] = field(
        present.length ? number(present.reduce((sum, v) => sum + v, 0)) : null,
        state.bounded || state.usagePartial || present.length !== values.length
          ? "partial"
          : "available",
      );
    }
  }
  return stats;
}
function snapshot(state, provider, now) {
  const stats = metadata(state, provider, now);
  return {
    health: "available",
    reason: null,
    stats,
    turns: Array.from(state.turns.values()),
    truncated: state.truncated,
    window: WINDOW,
    generation: state.generation,
  };
}
module.exports = {
  createProjection,
  consumeMetadata,
  consumeHelperMetadata,
  metadata,
  consume,
  snapshot,
  recordBelongsToSession,
};
