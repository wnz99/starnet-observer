import { test } from "bun:test";
import assert from "node:assert/strict";
import type { Provider } from "./contracts.js";
import { consume, createProjection, snapshot } from "./index.js";

const SESSION = "00000000-0000-0000-0000-000000000001";
const AT = "2026-10-16T00:00:00Z";

test("Claude JSON discriminators cannot fabricate ordinary rows or native assignments", () => {
  for (const type of [["user"], ["assistant"], {}]) {
    const state = createProjection();
    consume(
      state,
      { type, sessionId: SESSION, timestamp: AT, message: { content: "invalid" } },
      "claude",
      0,
      SESSION,
    );
    assert.equal(state.turns.size, 0);
    assert.equal(state.lastActivityAt, null);
    assert.equal(state.lastEntryAt, null);
  }
  for (const name of [["Agent"], ["Task"], {}, "Agent", "Task"]) {
    const state = createProjection();
    consume(
      state,
      {
        type: "assistant",
        sessionId: SESSION,
        timestamp: AT,
        message: {
          content: [{ type: "tool_use", id: "call", name, input: { description: "assignment" } }],
        },
      },
      "claude",
      0,
      SESSION,
    );
    assert.equal(state.helperCalls.size, typeof name === "string" ? 1 : 0);
  }
});

test("message and tool text use exact block and role discriminators", () => {
  const providers: Provider[] = ["claude", "codex"];
  for (const provider of providers) {
    const state = createProjection();
    const content = [
      { type: ["text"], text: "invalid" },
      { type: "text", text: "valid" },
    ];
    const record =
      provider === "claude"
        ? { type: "user", sessionId: SESSION, message: { content } }
        : { type: "response_item", payload: { type: "message", role: "user", content } };
    consume(state, record, provider, 0, SESSION);
    assert.deepEqual(
      snapshot(state, provider, 0).turns.map((turn) => turn.text),
      ["valid"],
    );
  }
  for (const role of [["user"], ["assistant"], {}]) {
    const state = createProjection();
    consume(
      state,
      { type: "response_item", payload: { type: "message", role, content: "invalid" } },
      "codex",
      0,
      SESSION,
    );
    assert.equal(state.turns.size, 0);
  }
  for (const type of [
    ["function_call"],
    ["custom_tool_call"],
    ["function_call_output"],
    ["custom_tool_call_output"],
  ]) {
    const state = createProjection();
    consume(
      state,
      {
        type: "response_item",
        payload: {
          type,
          call_id: "call",
          name: "exec_command",
          arguments: "invalid",
          output: "invalid",
        },
      },
      "codex",
      0,
      SESSION,
    );
    assert.equal(state.turns.size, 0);
  }
  const state = createProjection();
  consume(
    state,
    {
      type: "response_item",
      payload: {
        type: "function_call_output",
        call_id: "call",
        output: [
          { type: ["text"], text: "invalid" },
          { type: "output_text", text: "valid output" },
        ],
      },
    },
    "codex",
    0,
    SESSION,
  );
  assert.equal(snapshot(state, "codex", 0).turns[0]?.text, "valid output");
});

test("Codex activity and item discriminators require exact literals", () => {
  for (const type of [["response_item"], ["event_msg"], ["token_usage_record"], {}]) {
    const state = createProjection();
    consume(state, { type, timestamp: AT, payload: {} }, "codex", 0, SESSION);
    assert.equal(state.lastActivityAt, null);
    assert.equal(state.lastEntryAt, null);
  }
  for (const kind of [["started"], ["completed"], {}, "started", "completed"]) {
    const state = createProjection();
    consume(
      state,
      {
        type: "event_msg",
        payload: { type: "sub_agent_activity", kind, agent_thread_id: "child" },
      },
      "codex",
      0,
      SESSION,
    );
    assert.equal(state.helperEvents.size, typeof kind === "string" ? 1 : 0);
  }
  for (const type of [["item_started"], ["item_completed"], {}, "item_started", "item_completed"]) {
    const state = createProjection();
    consume(
      state,
      {
        type: "event_msg",
        payload: {
          type,
          item: {
            type: "CollabAgentToolCall",
            tool: "spawn_agent",
            status: "completed",
            sender_thread_id: SESSION,
            receiver_thread_ids: ["child"],
          },
        },
      },
      "codex",
      0,
      SESSION,
    );
    assert.equal(state.helperSpawns.size, typeof type === "string" ? 1 : 0);
  }
});

test("only exact analysis and summary channels exclude ordinary Codex messages", () => {
  for (const channel of [
    undefined,
    null,
    {},
    ["analysis"],
    ["summary"],
    "final",
    "analysis",
    "summary",
  ]) {
    const state = createProjection();
    consume(
      state,
      {
        type: "response_item",
        payload: { type: "message", role: "assistant", channel, content: "answer" },
      },
      "codex",
      0,
      SESSION,
    );
    assert.equal(state.turns.size, channel === "analysis" || channel === "summary" ? 0 : 1);
  }
});
