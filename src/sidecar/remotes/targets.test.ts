import { test } from "bun:test";
import assert from "node:assert/strict";
import { sanitizeTargets } from "./targets.js";

test("target proofs consume only readonly source, pane and health rows", () => {
  const target = {
    pane_id: "w1:p1",
    workspace_id: "w1",
    terminal_id: "t1",
    agent: "codex",
  };
  const rows = Object.freeze([
    { source: "herdr" as const, paneId: "vm/w1:p1", inventoryHealth: "available" as const },
  ]);
  assert.deepEqual(sanitizeTargets([target], rows).get("w1:p1"), {
    ...target,
    agent_session: null,
    cwd: null,
    foreground_cwd: null,
  });
  assert.equal(
    sanitizeTargets([target], [{ ...rows[0], source: "desktop", inventoryHealth: "available" }])
      .size,
    0,
  );
});
