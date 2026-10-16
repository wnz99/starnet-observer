import type { SessionContext } from "./contracts.js";
const CODEX_CALL_TYPES: readonly unknown[] = ["function_call", "custom_tool_call"];
const CODEX_OUTPUT_TYPES: readonly unknown[] = ["function_call_output", "custom_tool_call_output"];
export type ToolKind = "call" | "use" | "output" | "result";
export function toolKind(
  block: Record<string, unknown>,
  record: Record<string, unknown>,
  context: SessionContext,
): ToolKind | null {
  if (context.provider === "codex" && record.type === "response_item") {
    if (CODEX_CALL_TYPES.includes(block.type)) return "call";
    if (CODEX_OUTPUT_TYPES.includes(block.type)) return "output";
  }
  if (context.provider === "claude") {
    if (record.type === "assistant" && block.type === "tool_use") return "use";
    if (record.type === "user" && block.type === "tool_result") return "result";
  }
  return null;
}
export function callId(block: Record<string, unknown>, kind: ToolKind): unknown {
  if (kind === "call" || kind === "output") return block.call_id;
  return kind === "use" ? block.id : block.tool_use_id;
}
