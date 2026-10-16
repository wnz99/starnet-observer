import { redactText } from "../inspector/fields.js";
import { callId, toolKind } from "../inspector/tool-kind.js";
import type { ToolKind } from "../inspector/tool-kind.js";
import { isRecord, list, object, timestamp } from "../inspector/values.js";
import type { ReadState } from "./contracts.js";
import { cleanName } from "./identity.js";
const MAX_CALLS = 512;
// Only tool identity/outcome and numeric usage cross this boundary. Conversation bodies stay on disk.
export class ToolConsumer {
  constructor(private readonly state: ReadState) {}
  private start(
    block: Record<string, unknown>,
    kind: ToolKind,
    record: Record<string, unknown>,
    position: number,
  ) {
    const id = cleanName(callId(block, kind)),
      name = cleanName(typeof block.name === "string" ? redactText(block.name) : "");
    if (!id || !name || this.state.calls.has(id)) return;
    this.state.calls.add(id);
    if (this.state.calls.size > MAX_CALLS) {
      const first = this.state.calls.values().next();
      if (!first.done) this.state.calls.delete(first.value);
    }
    this.state.tool = {
      callId: id,
      name,
      phase: "started",
      outcome: "unknown",
      at: timestamp(record.timestamp),
      position,
    };
  }
  private finish(block: Record<string, unknown>, kind: ToolKind) {
    const tool = this.state.tool;
    if (!tool || tool.callId !== cleanName(callId(block, kind))) return;
    tool.phase = "finished";
    tool.outcome =
      kind === "result" && typeof block.is_error === "boolean"
        ? block.is_error
          ? "error"
          : "ok"
        : "unknown";
  }
  private consumeBlock(
    block: Record<string, unknown>,
    record: Record<string, unknown>,
    position: number,
  ) {
    const kind = toolKind(block, record, {
      provider: this.state.provider,
      sessionId: this.state.sessionId,
    });
    if (!kind) return;
    if (kind === "call" || kind === "use") this.start(block, kind, record, position);
    else this.finish(block, kind);
  }
  consumeRecord(raw: unknown, position: number) {
    const record = object(raw),
      payload = this.state.provider === "codex" ? record.payload : record.message;
    if (!payload || typeof payload !== "object") return;
    const content = object(payload).content;
    const blocks =
      this.state.provider === "claude" && Array.isArray(content) ? list(content) : [payload];
    for (const block of blocks) {
      if (!isRecord(block)) continue;
      this.consumeBlock(block, record, position);
    }
  }
}
