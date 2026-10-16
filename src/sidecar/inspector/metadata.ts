import { field, redactText } from "./fields.js";
import type {
  ConsumeOptions,
  Projection,
  Provider,
  SessionContext,
  Snapshot,
  Totals,
  UsageKey,
} from "./contracts.js";
import { belongs } from "./identity.js";
import { counter, object, string, timestamp } from "./values.js";
const MAX_USAGE_MESSAGES = 512;
const MAX_MODEL_CHARS = 160;
const USAGE_KEYS: UsageKey[] = [
  "inputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheWriteTokens",
];
export function ordinaryMessage(
  record: Record<string, unknown>,
  provider: Provider,
  payload: Record<string, unknown>,
): boolean {
  return (
    provider === "claude" ||
    (record.type === "response_item" &&
      payload.type === "message" &&
      (payload.role === "user" || payload.role === "assistant") &&
      payload.channel !== "analysis" &&
      payload.channel !== "summary")
  );
}
export function metadata(state: Projection, provider: Provider, now: number): Snapshot["stats"] {
  const stats: Snapshot["stats"] = {
    model: field(state.model, state.modelPartial ? "partial" : "available"),
    startedAt: field(state.startedAt),
    lastActivityAt: field(state.lastActivityAt),
    durationMs: field(state.startedAt ? Math.max(0, now - Date.parse(state.startedAt)) : null),
    inputTokens: field<number>(null),
    outputTokens: field<number>(null),
    cacheReadTokens: field<number>(null),
    cacheWriteTokens: field<number>(null),
  };
  for (const key of USAGE_KEYS) {
    if (provider === "codex") stats[key] = field(state.totals?.[key]);
    else {
      const values = Array.from(state.usage.values()).map((usage) => usage[key]);
      const present = values.filter((value) => value !== null);
      stats[key] = field(
        present.length > 0 ? counter(present.reduce((sum, value) => sum + value, 0)) : null,
        state.bounded || state.usagePartial || present.length !== values.length
          ? "partial"
          : "available",
      );
    }
  }
  return stats;
}

export class MetadataConsumer {
  constructor(private readonly state: Projection) {}
  private activity(
    record: Record<string, unknown>,
    context: SessionContext,
    options: ConsumeOptions,
  ) {
    const payload = object(context.provider === "codex" ? record.payload : record.message);
    const at = timestamp(record.timestamp);
    const ordinary = ordinaryMessage(record, context.provider, payload);
    if (options.header || !at) return;
    if (
      (ordinary ||
        record.type === "response_item" ||
        record.type === "event_msg" ||
        record.type === "token_usage_record") &&
      (!this.state.lastActivityAt || at > this.state.lastActivityAt)
    )
      this.state.lastActivityAt = at;
    // Idle age: only timestamped conversation rows count. Claude rewrites and appends untimestamped bookkeeping rows
    // (and touches files on startup), so neither file mtime nor non-conversation rows are evidence of activity.
    this.entryActivity(record, context, at);
  }
  private entryActivity(record: Record<string, unknown>, context: SessionContext, at: string) {
    const entry =
      context.provider === "claude"
        ? record.type === "user" || record.type === "assistant"
        : record.type === "response_item" || record.type === "event_msg";
    if (entry && (!this.state.lastEntryAt || at > this.state.lastEntryAt))
      this.state.lastEntryAt = at;
  }
  private codexUsage(record: Record<string, unknown>, payload: Record<string, unknown>) {
    const total =
      record.type === "token_usage_record"
        ? payload.thread_token_usage
        : record.type === "event_msg" && payload.type === "token_count"
          ? object(payload.info).total_token_usage
          : null;
    if (total && typeof total === "object") {
      const usage = object(total);
      this.state.totals = {
        inputTokens: counter(usage.input_tokens),
        outputTokens: counter(usage.output_tokens),
        cacheReadTokens: counter(usage.cached_input_tokens),
        cacheWriteTokens: counter(usage.cache_write_input_tokens),
      };
    }
  }
  private claudeUsage(record: Record<string, unknown>, payload: Record<string, unknown>) {
    if (record.type !== "assistant") return;
    const id = string(payload.id);
    if (!id || !payload.usage || typeof payload.usage !== "object") {
      this.state.usagePartial = true;
      return;
    }
    const usage = object(payload.usage);
    const next: Totals = {
      inputTokens: counter(usage.input_tokens),
      outputTokens: counter(usage.output_tokens),
      cacheReadTokens: counter(usage.cache_read_input_tokens),
      cacheWriteTokens: counter(usage.cache_creation_input_tokens),
    };
    this.mergeUsage(id, next);
  }
  private mergeUsage(id: string, next: Totals) {
    const merged = { ...next };
    const previous = this.state.usage.get(id);
    // Streaming blocks repeat the message usage; merge observations of the SAME message, never sum them.
    if (previous)
      for (const key of USAGE_KEYS) {
        const before = previous[key],
          after = next[key];
        merged[key] = after === null ? before : before === null ? after : Math.max(before, after);
      }
    this.state.usage.set(id, merged);
    if (this.state.usage.size > MAX_USAGE_MESSAGES) {
      const first = this.state.usage.keys().next();
      if (!first.done) this.state.usage.delete(first.value);
      this.state.usagePartial = true;
    }
  }
  consumeStats(
    record: Record<string, unknown>,
    context: SessionContext,
    options: ConsumeOptions & { position: number },
  ) {
    const rawPayload = context.provider === "codex" ? record.payload : record.message;
    if (!rawPayload || typeof rawPayload !== "object") return;
    const payload = object(rawPayload);
    if (!belongs(record, context)) return;
    this.activity(record, context, options);
    this.sessionMetadata(record, context, options);
    if (options.header) return;
    if (context.provider === "codex") this.codexUsage(record, payload);
    else this.claudeUsage(record, payload);
  }
  private sessionMetadata(
    record: Record<string, unknown>,
    context: SessionContext,
    options: ConsumeOptions & { position: number },
  ) {
    const payload = object(context.provider === "codex" ? record.payload : record.message);
    const at = timestamp(record.timestamp);
    if (context.provider === "codex" && record.type === "session_meta")
      this.state.startedAt = timestamp(payload.timestamp) || at;
    if (
      context.provider === "claude" &&
      !this.state.startedAt &&
      (options.beginning || options.position === 0)
    )
      this.state.startedAt = at;
    this.model(record, context, payload);
  }
  private model(
    record: Record<string, unknown>,
    context: SessionContext,
    payload: Record<string, unknown>,
  ) {
    if (
      (context.provider === "codex" && record.type === "turn_context") ||
      (context.provider === "claude" && record.type === "assistant")
    ) {
      if (typeof payload.model === "string") {
        this.state.model = redactText(payload.model).slice(0, MAX_MODEL_CHARS);
        this.state.modelPartial = false;
      }
    }
  }
}
