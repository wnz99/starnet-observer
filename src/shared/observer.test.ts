import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "bun:test";
import type { ObserverSnapshot } from "./observer.js";

const require = createRequire(import.meta.url);
const snapshotBoundary: unknown = require("../../sidecar/observer-remotes.js");
function sanitize(value: unknown): unknown {
  if (
    !snapshotBoundary ||
    typeof snapshotBoundary !== "object" ||
    !("sanitizeSnapshot" in snapshotBoundary) ||
    typeof snapshotBoundary.sanitizeSnapshot !== "function"
  )
    throw new Error("Snapshot sanitizer unavailable");
  const result: unknown = Reflect.apply(snapshotBoundary.sanitizeSnapshot, undefined, [
    "fixture",
    value,
    100,
  ]);
  return result;
}
test("unknown remote snapshots require runtime narrowing", () => {
  const invalid: unknown = JSON.parse('{"sessions":null,"health":"available"}');
  assert.throws(() => sanitize(invalid), /invalid snapshot/);
  const valid: Pick<ObserverSnapshot, "sessions" | "health"> = {
    sessions: [],
    health: "available",
  };
  const result = sanitize(valid);
  assert.ok(result && typeof result === "object" && "rows" in result);
  assert.deepEqual(result.rows, []);
});
