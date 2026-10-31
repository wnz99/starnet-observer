import { test } from "bun:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { makeHelperObserver } from "./index.js";
import { makeTranscriptObserver } from "../transcripts/index.js";
import type { HelperRow } from "./contracts.js";
import { required } from "../transcripts/testing.fixture.js";

const PARENT = "00000000-0000-0000-0000-000000000001";
const CHILD = "00000000-0000-0000-0000-000000000002";
const OTHER = "00000000-0000-0000-0000-000000000003";
const line = (value: unknown) => JSON.stringify(value) + "\n";
test("indexed native spawn and paginated fork exclude inherited parent usage and messages", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "observer-fork-child-"));
  try {
    const pad = line({ type: "ignored", payload: { padding: "x".repeat(300000) } });
    await fs.writeFile(
      path.join(root, PARENT + ".jsonl"),
      line({ type: "session_meta", payload: { id: PARENT } }) +
        pad +
        [
          {
            type: "response_item",
            payload: {
              type: "function_call",
              name: "spawn_agent",
              call_id: "indexed",
              arguments: JSON.stringify({ task_name: "Indexed audit" }),
            },
          },
          {
            type: "event_msg",
            payload: {
              type: "item_completed",
              item: {
                type: "SubAgentActivity",
                id: "indexed",
                kind: "started",
                agent_thread_id: CHILD,
              },
            },
          },
        ]
          .map(line)
          .join("") +
        pad,
    );
    const header = {
      id: CHILD,
      session_id: PARENT,
      parent_thread_id: PARENT,
      forked_from_id: PARENT,
      multi_agent_version: "v2",
      history_mode: "paginated",
      subagent_history_start_ordinal: 5,
    };
    const childFile = path.join(root, CHILD + ".jsonl");
    const records = [
      { ordinal: 0, type: "session_meta", payload: header },
      { ordinal: 1, type: "session_meta", payload: { id: PARENT } },
      {
        ordinal: 2,
        type: "token_usage_record",
        payload: { session_id: PARENT, thread_token_usage: { input_tokens: 999 } },
      },
      {
        ordinal: 3,
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "INHERITED CANARY" }],
        },
      },
      {
        ordinal: 5,
        type: "token_usage_record",
        payload: { session_id: CHILD, thread_token_usage: { input_tokens: 7 } },
      },
    ];
    await fs.writeFile(childFile, records.map(line).join(""));
    const transcripts = makeTranscriptObserver({ roots: { codex: root }, now: () => 1000 });
    const helpers = makeHelperObserver({
      transcripts,
      now: () => 1000,
      readEdges: () => ({ rows: [] }),
    });
    const parent: HelperRow = {
      id: "parent",
      provider: "codex",
      sessionId: PARENT,
      inspectionIdentity: PARENT,
      inventoryHealth: "available",
    };
    await helpers.children([parent]);
    await transcripts.spawnIndexIdle();
    const found = await helpers.children([parent]);
    const child = required(found.rows[0]);
    assert.equal(required(child.taskEvidence).summary, "Indexed audit");
    assert.equal(required(child.usage).inputTokens?.value, 7);
    const detail = await helpers.inspect(child);
    assert(detail.available);
    assert(!JSON.stringify(detail).includes("INHERITED CANARY"));
    await transcripts.spawnIndexIdle();
    await fs.writeFile(
      childFile,
      records
        .map((record) =>
          line(
            record.ordinal === 0
              ? { ...record, payload: { ...header, forked_from_id: OTHER } }
              : record,
          ),
        )
        .join(""),
    );
    assert.equal(
      await transcripts.bindChild("codex", CHILD, PARENT),
      null,
      "a parent alias without exact fork provenance fails closed",
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
test("native spawn discovers a verified child without SQLite edges and preserves closure authority", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "observer-native-child-"));
  try {
    await fs.writeFile(
      path.join(root, PARENT + ".jsonl"),
      [
        { type: "session_meta", payload: { id: PARENT } },
        {
          type: "response_item",
          payload: {
            type: "function_call",
            name: "spawn_agent",
            call_id: "call",
            arguments: JSON.stringify({ task_name: "Audit" }),
          },
        },
        {
          type: "event_msg",
          timestamp: "2026-10-31T11:00:00Z",
          payload: {
            type: "item_completed",
            item: { type: "SubAgentActivity", id: "call", kind: "started", agent_thread_id: CHILD },
          },
        },
      ]
        .map(line)
        .join(""),
    );
    const childFile = path.join(root, CHILD + ".jsonl");
    const writeChild = (parent: string) =>
      fs.writeFile(
        childFile,
        line({ type: "session_meta", payload: { id: CHILD, parent_thread_id: parent } }),
      );
    await writeChild(PARENT);
    const transcripts = makeTranscriptObserver({
      roots: { codex: root },
      now: () => Date.parse("2026-10-31T11:00:01Z"),
    });
    const parent: HelperRow = {
      id: "parent",
      provider: "codex",
      sessionId: PARENT,
      inspectionIdentity: PARENT,
      inventoryHealth: "available",
      project: "Project",
    };
    let edges: unknown[] = [];
    const helpers = makeHelperObserver({
      transcripts,
      now: () => Date.parse("2026-10-31T11:00:01Z"),
      readEdges: () => ({ rows: edges }),
    });
    const found = await helpers.children([parent]);
    assert.equal(found.rows.length, 1);
    const child = required(found.rows[0]);
    assert.equal(child.sessionId, CHILD);
    assert.equal(required(child.taskEvidence).summary, "Audit");
    assert.equal(required(child.lifecycleEvidence).state, "unknown");
    assert.equal(child.status, "working");
    const independent = {
      ...parent,
      id: "child-pane",
      sessionId: CHILD,
      inspectionIdentity: CHILD,
    };
    const joined = await helpers.children([parent, independent]);
    assert.equal(joined.annotations.get("child-pane")?.parentId, "parent");
    edges = [{ parent_thread_id: PARENT, child_thread_id: CHILD, status: "closed" }];
    const closed = await helpers.children([parent]);
    assert.equal(required(required(closed.rows[0]).lifecycleEvidence).state, "closed");
    edges = [];
    await writeChild(OTHER);
    assert.equal(
      (await helpers.children([parent])).rows.length,
      0,
      "parent claim cannot replace child identity proof",
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
