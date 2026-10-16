import assert from "node:assert/strict";
import { test } from "bun:test";
import type { ObserverSnapshot } from "./observer.js";
import { sanitizeSnapshot } from "../sidecar/remotes/index.js";
test("unknown remote snapshots require runtime narrowing", () => {
  const invalid: unknown = JSON.parse('{"sessions":null,"health":"available"}');
  assert.throws(() => sanitizeSnapshot("fixture", invalid, 100), /invalid snapshot/);
  const valid: Pick<ObserverSnapshot, "sessions" | "health"> = {
    sessions: [],
    health: "available",
  };
  const result = sanitizeSnapshot("fixture", valid, 100);
  assert.ok(typeof result === "object" && "rows" in result);
  assert.deepEqual(result.rows, []);
});
