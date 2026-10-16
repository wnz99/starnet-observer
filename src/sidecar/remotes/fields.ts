import { LIMITS } from "./limits.js";
import crypto from "node:crypto";
export const MAX_LINE = 4 * 1024 * 1024;
export const MAX_ROWS = 512;
export const FRESH_MS = 10000;
export const CONTROL_FRESH_MS = 6000;
export const BACKOFF = [2000, 5000, 10000, 30000, 60000];
export const ID = /^obs_[a-f0-9]{24}$/;
export const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export const PROVIDERS = new Set(["claude", "codex"] as const);
export const HEALTH = new Set(["available", "unavailable"] as const);
export const hash = (...parts: string[]) =>
  crypto.createHash("sha256").update(parts.join("\0")).digest("hex");
export function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}
export function matches(pattern: RegExp, value: unknown): value is string {
  return typeof value === "string" && pattern.test(value);
}
export function has<T>(values: ReadonlySet<T>, value: unknown): value is T {
  return [...values].some((entry) => entry === value);
}
export const text = (value: unknown, length: number) =>
  typeof value === "string" ? stripControls(value).slice(0, length) : null;
export const word = (value: unknown, length = 40) =>
  matches(/^[A-Za-z0-9._:-]{1,40}$/, value) ? value.slice(0, length) : null;
export const time = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : typeof value === "string" && !Number.isNaN(Date.parse(value))
      ? text(value, LIMITS.WORD_MAX)
      : null;
export const count = (value: unknown) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
export function oneOf<T>(value: unknown, values: ReadonlySet<T>): T | null;
export function oneOf<T, F>(value: unknown, values: ReadonlySet<T>, fallback: F): T | F;
export function oneOf<T, F>(
  value: unknown,
  values: ReadonlySet<T>,
  fallback: F | null = null,
): T | F | null {
  return has(values, value) ? value : fallback;
}
export const remap = (host: string, id: string) =>
  "obs_" + hash(host, id).slice(0, LIMITS.ROW_HASH);

const CONTROL_START = 32,
  DELETE_CODE = 127;
export function controlCharacter(character: string) {
  const code = character.charCodeAt(0);
  return code < CONTROL_START || code === DELETE_CODE;
}
function stripControls(value: string) {
  return value
    .split("")
    .map((character) => (controlCharacter(character) ? " " : character))
    .join("");
}
