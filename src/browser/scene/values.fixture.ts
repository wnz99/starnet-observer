import assert from "node:assert/strict";
export function present<T>(value: T | undefined | null): T {
  assert(value !== null && value !== undefined, "required fixture value");
  return value;
}
