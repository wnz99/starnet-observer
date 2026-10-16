import { BoundedMap } from "./helper-state.js";
import crypto from "node:crypto";
import type { ChildBinding, ConsumeOptions, Projection, Provider, Snapshot } from "./contracts.js";
import { INSPECTION_WINDOW } from "./fields.js";
import { belongs } from "./identity.js";
import { claudeHelpers } from "./claude-helpers.js";
import { codexHelpers } from "./codex-helpers.js";
import { MetadataConsumer, metadata } from "./metadata.js";
import { Conversation } from "./conversation.js";
import { isRecord, timestamp } from "./values.js";
export { metadata };
export function createProjection(): Projection {
  return {
    generation: crypto.randomUUID(),
    turns: new Map(),
    usage: new Map(),
    totals: null,
    model: null,
    helperCalls: new BoundedMap(),
    helperSpawns: new BoundedMap(),
    helperEvents: new BoundedMap(),
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
export function recordBelongsToSession(
  raw: unknown,
  provider: Provider,
  sessionId: string,
  binding?: ChildBinding | null,
): boolean {
  return isRecord(raw) && belongs(raw, { provider, sessionId, binding });
}
export function consumeHelperMetadata(
  ...[state, raw, provider, sessionId, binding]: [
    state: Projection,
    raw: unknown,
    provider: Provider,
    sessionId: string,
    binding?: ChildBinding | null,
  ]
) {
  if (!isRecord(raw)) return;
  const context = { provider, sessionId, binding };
  const at = timestamp(raw.timestamp),
    observedAt = at ? Date.parse(at) : null;
  const valid = belongs(raw, context);
  // Provider task records remain separate from process liveness and Herdr status.
  if (provider === "claude") claudeHelpers(state, raw, context, { belongs: valid, at: observedAt });
  else if (valid) codexHelpers(state, raw, sessionId, observedAt);
}
export function consumeMetadata(
  ...[state, raw, provider, position, sessionId, binding, options = {}]: [
    state: Projection,
    raw: unknown,
    provider: Provider,
    position: number,
    sessionId: string,
    binding?: ChildBinding | null,
    options?: ConsumeOptions,
  ]
) {
  consumeHelperMetadata(state, raw, provider, sessionId, binding);
  if (!isRecord(raw)) return;
  new MetadataConsumer(state).consumeStats(
    raw,
    { provider, sessionId, binding },
    { ...options, position },
  );
}
export function consume(
  ...[state, raw, provider, position, sessionId, binding, options]: [
    state: Projection,
    raw: unknown,
    provider: Provider,
    position: number,
    sessionId: string,
    binding?: ChildBinding | null,
    options?: ConsumeOptions,
  ]
) {
  consumeMetadata(state, raw, provider, position, sessionId, binding, options);
  const context = { provider, sessionId, binding };
  if (isRecord(raw) && belongs(raw, context))
    new Conversation(state).conversation(raw, context, position);
}
export function snapshot(state: Projection, provider: Provider, now: number): Snapshot {
  return {
    health: "available",
    reason: null,
    stats: metadata(state, provider, now),
    turns: Array.from(state.turns.values()),
    truncated: state.truncated,
    window: INSPECTION_WINDOW,
    generation: state.generation,
  };
}
