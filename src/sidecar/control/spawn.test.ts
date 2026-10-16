import assert from "node:assert/strict";
import { test } from "bun:test";
import { makeControl } from "./index.js";

function hostSpawn(inventory: unknown) {
  const calls: string[] = [];
  const control = makeControl({
    endpoint: "/fixture/spawn.sock",
    execute: (command, args) => {
      assert.equal(command, "herdr");
      const action = args.slice(0, 2).join(" ");
      calls.push(action);
      if (action === "workspace list") {
        if (inventory instanceof Error) return Promise.reject(inventory);
        return Promise.resolve({ stdout: JSON.stringify({ result: inventory }) });
      }
      if (action === "workspace create")
        return Promise.resolve({
          stdout: JSON.stringify({ result: { root_pane: { pane_id: "w3:p1" } } }),
        });
      return Promise.resolve({ stdout: JSON.stringify({ result: {} }) });
    },
  });
  return { control, calls };
}

test("truthy malformed workspace inventory rejects before any mutation", async () => {
  for (const workspaces of [{}, true, 1, "unavailable"]) {
    const { control, calls } = hostSpawn({ workspaces });
    await assert.rejects(control.spawnHost("local"), TypeError);
    assert.deepEqual(calls, ["workspace list"]);
  }
});

test("absent, falsy, and empty workspace inventory retain host spawn fallback", async () => {
  for (const workspaces of [undefined, null, false, 0, "", []]) {
    const { control, calls } = hostSpawn({ workspaces });
    const result = await control.spawnHost("local");
    assert.equal(result.paneId, "w3:p1");
    assert.deepEqual(calls, [
      "workspace list",
      "workspace create",
      "pane wait-output",
      "agent start",
    ]);
  }
});

test("failed workspace query retains host spawn fallback", async () => {
  const { control, calls } = hostSpawn(new Error("workspace query unavailable"));
  const result = await control.spawnHost("local");
  assert.equal(result.paneId, "w3:p1");
  assert.deepEqual(calls, [
    "workspace list",
    "workspace create",
    "pane wait-output",
    "agent start",
  ]);
});
