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
const nativeHeader = (id: string, parent: string) => ({
  id,
  session_id: PARENT,
  parent_thread_id: parent,
  multi_agent_version: "v2",
  history_mode: "paginated",
  thread_source: "subagent",
  source: { subagent: { thread_spawn: { parent_thread_id: parent } } },
});
test("shared-root observed generations retain ownership through bounded discovery", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "observer-native-generations-"));
  try {
    const ids = [
      PARENT,
      CHILD,
      OTHER,
      ...[4, 5, 6, 7].map((id) => "00000000-0000-0000-0000-" + String(id).padStart(12, "0")),
    ];
    const edges = ids.slice(1).map((child, index) => ({
      parent_thread_id: required(ids[index]),
      child_thread_id: child,
      status: "open",
    }));
    async function writeGenerations() {
      for (const [index, id] of ids.entries()) {
        const records: unknown[] = [
          {
            ordinal: 0,
            type: "session_meta",
            payload: index ? nativeHeader(id, required(ids[index - 1])) : { id },
          },
        ];
        records.push({
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "own-" + id }],
          },
        });
        const next = ids[index + 1];
        if (next)
          records.push(
            {
              type: "response_item",
              payload: {
                type: "function_call",
                name: "spawn_agent",
                call_id: "spawn-" + id,
                arguments: JSON.stringify({ task_name: "Nested" }),
              },
            },
            {
              type: "event_msg",
              payload: {
                type: "item_completed",
                item: {
                  type: "SubAgentActivity",
                  id: "spawn-" + id,
                  kind: "started",
                  agent_thread_id: next,
                },
              },
            },
          );
        if (index === 1)
          records.push({ type: "ignored", payload: { padding: "x".repeat(300000) } });
        await fs.writeFile(path.join(root, id + ".jsonl"), records.map(line).join(""));
      }
    }
    await writeGenerations();
    const transcripts = makeTranscriptObserver({ roots: { codex: root }, now: () => 1000 });
    const observed = ids.slice(0, 6).map((sessionId, index): HelperRow => ({
      id: "pane-" + String(index),
      provider: "codex",
      sessionId,
      inspectionIdentity: sessionId,
      inventoryHealth: "available",
      tool: { available: true },
      projectId: index ? "old" : "project",
      repoId: index ? "old" : "repo",
      worktreeId: index ? "old" : "worktree",
    }));
    for (const database of [false, true]) {
      const panes = database ? observed : observed.slice(0, 3);
      const helpers = makeHelperObserver({
        transcripts,
        now: () => 1000,
        readEdges: () => ({ rows: database ? edges : [] }),
      });
      for (const input of [
        panes,
        panes.slice().reverse(),
        [...panes.slice(2), ...panes.slice(0, 2)],
      ]) {
        await helpers.children(input);
        await transcripts.spawnIndexIdle();
        const found = await helpers.children(input);
        function assertOwnership() {
          for (let depth = 1; depth < panes.length; depth++) {
            const annotation = found.annotations.get("pane-" + String(depth));
            assert(
              annotation,
              JSON.stringify({ database, depth, annotations: [...found.annotations] }),
            );
            assert.equal(annotation.projectId, "project");
            assert.equal(annotation.repoId, "repo");
            assert.equal(annotation.worktreeId, "worktree");
            assert.equal(annotation.parentId, depth <= 3 ? "pane-" + String(depth - 1) : undefined);
          }
        }
        assertOwnership();
        assert.equal(
          found.rows.length,
          database ? 0 : 1,
          "observed descendants never restart omitted subtrees",
        );
        const detail = await helpers.inspect(required(observed[2]));
        assert(detail.available);
        assert(JSON.stringify(detail).includes("own-" + OTHER));
        assert(!JSON.stringify(detail).includes("own-" + CHILD));
      }
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
test("native v2 parent alias requires matching spawn provenance", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "observer-native-v2-"));
  try {
    const file = path.join(root, CHILD + ".jsonl");
    const header = {
      id: CHILD,
      session_id: PARENT,
      parent_thread_id: PARENT,
      multi_agent_version: "v2",
      history_mode: "paginated",
      thread_source: "subagent",
      source: { subagent: { thread_spawn: { parent_thread_id: PARENT } } },
    };
    const write = (payload: Record<string, unknown>) =>
      fs.writeFile(
        file,
        [
          { ordinal: 0, type: "session_meta", payload },
          {
            type: "token_usage_record",
            payload: {
              session_id: CHILD,
              thread_token_usage: { input_tokens: 7 },
            },
          },
        ]
          .map(line)
          .join(""),
      );
    const transcripts = makeTranscriptObserver({ roots: { codex: root }, now: () => 1000 });
    await write(header);
    const binding = await transcripts.bindChild("codex", CHILD, PARENT);
    assert(binding);
    assert.equal(binding.codexMetadata?.historyStartOrdinal, undefined);
    assert.equal(binding.usage?.inputTokens?.value, 7);
    const grandchildFile = path.join(root, OTHER + ".jsonl");
    await fs.writeFile(
      grandchildFile,
      line({
        ordinal: 0,
        type: "session_meta",
        payload: {
          ...header,
          id: OTHER,
          parent_thread_id: CHILD,
          source: { subagent: { thread_spawn: { parent_thread_id: CHILD } } },
        },
      }),
    );
    const nested = await transcripts.bindChild(
      "codex",
      OTHER,
      CHILD,
      grandchildFile,
      undefined,
      binding,
    );
    assert(nested, "nested child uses registered parent's shared root proof");
    assert.equal(nested.codexMetadata?.rootSessionId, PARENT);
    assert.equal(await transcripts.bindChild("codex", OTHER, CHILD, grandchildFile), null);
    assert(Object.isFrozen(binding.codexMetadata));
    assert((await transcripts.inspectChild("native", binding)).available);
    await write({ ...header, session_id: OTHER });
    assert.equal((await transcripts.inspectChild("native", binding)).available, false);
    assert.equal(binding.codexMetadata?.rootSessionId, PARENT, "frozen proof is never rewritten");
    await write(header);
    const rebound = await transcripts.bindChild("codex", CHILD, PARENT);
    assert(rebound);
    assert((await transcripts.inspectChild("native", rebound)).available);
    await fs.appendFile(file, line({ ordinal: 0, type: "session_meta", payload: header }));
    assert.equal(
      await transcripts.bindChild("codex", CHILD, PARENT),
      null,
      "duplicate own metadata rejects",
    );
    for (const change of [
      { source: { subagent: { thread_spawn: { parent_thread_id: OTHER } } } },
      { source: undefined },
      { session_id: OTHER },
      { parent_thread_id: OTHER },
      { forked_from_id: OTHER },
      { subagent_history_start_ordinal: 0 },
      { thread_source: "cli" },
    ]) {
      await write({ ...header, ...change });
      assert.equal(await transcripts.bindChild("codex", CHILD, PARENT), null);
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
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
        ordinal: 4,
        type: "response_item",
        payload: {
          type: "function_call",
          name: "spawn_agent",
          call_id: "inherited-spawn",
          arguments: JSON.stringify({ task_name: "INHERITED SPAWN" }),
        },
      },
      {
        ordinal: 4,
        type: "event_msg",
        payload: {
          type: "item_completed",
          item: {
            type: "SubAgentActivity",
            id: "inherited-spawn",
            kind: "started",
            agent_thread_id: OTHER,
          },
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
    const binding = await transcripts.bindChild("codex", CHILD, PARENT);
    assert(binding);
    await transcripts.codexMetadata("fork", CHILD, binding);
    await transcripts.spawnIndexIdle();
    const indexed = await transcripts.codexMetadata("fork", CHILD, binding);
    assert.equal(indexed?.helperSpawns.has(OTHER), false, "inherited spawn claims stay excluded");
    await fs.writeFile(
      childFile,
      records
        .map((record) =>
          line(
            record.ordinal === 0
              ? { ...record, payload: { ...header, subagent_history_start_ordinal: 6 } }
              : record,
          ),
        )
        .join(""),
    );
    assert.equal((await transcripts.inspectChild("fork", binding)).available, false);
    const contradicted = await transcripts.codexMetadata("fork", CHILD, binding);
    assert.equal(contradicted?.helperSpawns.size, 0);
    assert.equal(contradicted.helperClaimsPartial, true);
    const rebound = await transcripts.bindChild("codex", CHILD, PARENT);
    assert(rebound);
    assert.equal(required(rebound.codexMetadata).historyStartOrdinal, 6);
    const reread = await transcripts.inspectChild("fork", rebound);
    assert(reread.available);
    assert.notEqual(reread.stats.inputTokens.value, 7);
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
