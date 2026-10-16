export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function object(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}
export function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
export function string(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
export function timestamp(value: unknown): string | null {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
    ? new Date(value).toISOString()
    : null;
}
export function counter(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
export function positiveTime(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}
export function textBlocks(content: unknown): string {
  if (typeof content === "string") return content;
  return list(content)
    .map(object)
    .filter(
      (block) =>
        (block.type === "text" || block.type === "input_text" || block.type === "output_text") &&
        typeof block.text === "string",
    )
    .map((block) => string(block.text) ?? "")
    .join("\n");
}
