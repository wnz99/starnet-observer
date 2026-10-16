import { toolKind, callId } from "./tool-kind.js";
import type { ToolKind } from "./tool-kind.js";
import crypto from "node:crypto";
import { redact } from "../redaction.js";
import { INSPECTION_WINDOW as WINDOW, redactText } from "./fields.js";
import type { Projection, SessionContext, Turn } from "./contracts.js";
import { ordinaryMessage } from "./metadata.js";
import { isRecord, list, object, string, textBlocks, timestamp } from "./values.js";
const HASH_CHARS = 24;
const MAX_CALL_ID = 200;
const MAX_TOOL_NAME = 120;
const hash = (value: string) =>
  crypto.createHash("sha256").update(value).digest("hex").slice(0, HASH_CHARS);
function redactStringLeaves(value: unknown): unknown {
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map(redactStringLeaves);
  if (isRecord(value))
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactStringLeaves(item)]),
    );
  return value;
}
function toolText(raw: unknown): string {
  if (raw && typeof raw === "object") return JSON.stringify(redact(redactStringLeaves(raw)));
  if (typeof raw !== "string") return "";
  // JSON arguments/results retain field-aware redaction, including whole credential objects.
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object")
      return JSON.stringify(redact(redactStringLeaves(parsed)));
    if (typeof parsed === "string") return redactText(parsed);
  } catch {
    /* Ordinary tool text is redacted by put(). */ return raw;
  }
  return raw;
}
function outputText(raw: unknown): string {
  if (!Array.isArray(raw)) return toolText(raw);
  return raw
    .map(object)
    .filter(
      (block) =>
        (block.type === "text" || block.type === "input_text" || block.type === "output_text") &&
        typeof block.text === "string",
    )
    .map((block) => toolText(block.text))
    .join("\n");
}

export class Conversation {
  constructor(private readonly state: Projection) {}
  private put(key: string, entry: Omit<Turn, "id" | "text" | "textTruncated">, raw: string) {
    if (!raw && !entry.tool) return;
    // Redact BEFORE clipping so a key straddling the display limit cannot leak a prefix.
    const safe = redactText(raw);
    const turn: Turn = {
      ...entry,
      id: this.state.generation + ":" + hash(key),
      text: safe.slice(0, WINDOW.maxTextChars),
      textTruncated: safe.length > WINDOW.maxTextChars,
    };
    if (turn.textTruncated) this.state.truncated = true;
    this.state.turns.set(key, turn);
    let chars = Array.from(this.state.turns.values()).reduce(
      (sum, value) => sum + value.text.length,
      0,
    );
    while (this.state.turns.size > WINDOW.maxTurns || chars > WINDOW.maxTotalChars) {
      const first = this.state.turns.entries().next();
      if (first.done) break;
      const [key, turn] = first.value;
      chars -= turn.text.length;
      this.state.turns.delete(key);
      this.state.truncated = true;
    }
  }
  private startTool(
    key: string,
    block: Record<string, unknown>,
    kind: ToolKind,
    at: string | null,
  ) {
    if (this.state.turns.has(key)) return;
    this.put(
      key,
      {
        role: "tool",
        at,
        tool: {
          name: redactText(string(block.name) ?? "Tool").slice(0, MAX_TOOL_NAME),
          phase: "started",
          outcome: "unknown",
        },
      },
      toolText(kind === "call" ? (block.arguments ?? block.input) : block.input),
    );
  }
  private finishTool(
    key: string,
    block: Record<string, unknown>,
    kind: ToolKind,
    at: string | null,
  ) {
    const previous = this.state.turns.get(key);
    const outcome =
      kind === "result" && typeof block.is_error === "boolean"
        ? block.is_error
          ? "error"
          : "ok"
        : "unknown";
    this.put(
      key,
      {
        role: "tool",
        at: previous?.at || at,
        tool: { name: previous?.tool?.name || "Tool", phase: "finished", outcome },
      },
      outputText(kind === "output" ? block.output : block.content),
    );
  }
  private consumeTool(
    block: Record<string, unknown>,
    record: Record<string, unknown>,
    context: SessionContext,
  ) {
    const kind = toolKind(block, record, context);
    if (!kind) return;
    const id = string(callId(block, kind));
    if (id === undefined || id.length > MAX_CALL_ID) return;
    const key = "tool:" + id,
      at = timestamp(record.timestamp);
    if (kind === "call" || kind === "use") this.startTool(key, block, kind, at);
    else this.finishTool(key, block, kind, at);
  }
  private message(record: Record<string, unknown>, context: SessionContext, position: number) {
    const payload = object(context.provider === "codex" ? record.payload : record.message),
      at = timestamp(record.timestamp);
    if (context.provider === "claude") {
      // Claude emits multiple blocks per message. UUID identifies each record; message id identifies usage.
      this.put(
        "message:" + String(string(record.uuid) || position),
        { role: record.type === "user" ? "user" : "assistant", at },
        textBlocks(payload.content),
      );
    } else if (ordinaryMessage(record, context.provider, payload))
      this.put(
        "message:" + String(position),
        { role: payload.role === "user" ? "user" : "assistant", at },
        textBlocks(payload.content),
      );
  }
  conversation(record: Record<string, unknown>, context: SessionContext, position: number) {
    const payload = object(context.provider === "codex" ? record.payload : record.message);
    this.message(record, context, position);
    const blocks =
      context.provider === "claude" && Array.isArray(payload.content)
        ? list(payload.content)
        : [payload];
    for (const block of blocks) if (isRecord(block)) this.consumeTool(block, record, context);
  }
}
