import assert from "node:assert/strict";
export function required<T>(value: T): NonNullable<T> {
  assert(value !== null && value !== undefined, "expected fixture result to be present");
  return value;
}
export function deferred() {
  let settle: () => void = () => {
    throw new Error("Deferred not initialized");
  };
  const promise = new Promise<void>((resolve) => {
    settle = resolve;
  });
  return {
    promise,
    resolve: () => {
      settle();
    },
  };
}
import type { Snapshot } from "../inspector/contracts.js";
import type { ReadResult, LightSuccess } from "./contracts.js";
export function detail<T extends Snapshot>(value: T | { available: boolean }): T {
  assert("turns" in value, "expected detailed transcript projection");
  return value;
}
export function metadataResult(value: ReadResult): LightSuccess {
  assert(value.available && "last" in value, "expected transcript metadata");
  return value;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function fixtureRecord(value: unknown): Record<string, unknown> {
  assert(isRecord(value), "expected fixture record");
  return value;
}
export function parseRecord(text: string): Record<string, unknown> {
  const value: unknown = JSON.parse(text);
  return fixtureRecord(value);
}
export function firstContent(value: unknown): Record<string, unknown> {
  const content = fixtureRecord(fixtureRecord(value).message).content;
  assert(Array.isArray(content), "expected fixture content array");
  return fixtureRecord(content[0]);
}
export function expectBoolean(check: {
  actual: boolean;
  expected: boolean;
  message?: string;
}): void {
  assert.equal(check.actual, check.expected, check.message);
}
