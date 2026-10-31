import { test } from "bun:test";
import { Database } from "bun:sqlite";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { makeObserver } from "./index.js";
import { makeTranscriptObserver } from "../transcripts/index.js";
import { busFixture, must, settled } from "./testing.fixture.js";

test("default observer discovers and inspects native descendants through middle-window spawns", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "observer-native-default-"));
  const ids = [1, 2, 3].map((id) => "00000000-0000-0000-0000-" + String(id).padStart(12, "0"));
  const parent = must(ids[0]);
  const line = (record: unknown) => JSON.stringify(record) + "\n";
  const padding = line({ type: "ignored", payload: { padding: "x".repeat(16000) } }).repeat(20);
  let clock = 1000;
  const transcripts = makeTranscriptObserver({ now: () => clock, roots: { codex: root } });
  for (const [index, id] of ids.entries()) {
    const immediateParent = ids[index - 1];
    const next = ids[index + 1];
    await fs.writeFile(
      path.join(root, id + ".jsonl"),
      line({
        ordinal: 0,
        type: "session_meta",
        payload: immediateParent
          ? {
              id,
              session_id: parent,
              parent_thread_id: immediateParent,
              multi_agent_version: "v2",
              history_mode: "paginated",
              thread_source: "subagent",
              source: { subagent: { thread_spawn: { parent_thread_id: immediateParent } } },
            }
          : { id },
      }) +
        padding +
        (next
          ? [
              {
                type: "response_item",
                payload: {
                  type: "function_call",
                  name: "spawn_agent",
                  call_id: id,
                  arguments: JSON.stringify({ task_name: "Nested" }),
                },
              },
              {
                type: "event_msg",
                payload: {
                  type: "item_completed",
                  item: { type: "SubAgentActivity", id, kind: "started", agent_thread_id: next },
                },
              },
            ]
              .map(line)
              .join("")
          : "") +
        padding +
        line({
          type: "response_item",
          payload: { type: "message", role: "assistant", content: "own-" + id },
        }),
    );
  }
  const database = new Database(path.join(root, "state_5.sqlite"));
  database.run(
    "CREATE TABLE thread_spawn_edges(parent_thread_id TEXT, child_thread_id TEXT, status TEXT)",
  );
  database.close();
  const previousHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = root;
  const adapter = Object.create(transcripts) as typeof transcripts;
  const observer = makeObserver({
    now: () => clock,
    transcripts: adapter,
    identities: { resolveMany: () => settled(() => [{ sessionId: parent, source: "native" }]) },
    execute: () =>
      settled(() => ({
        stdout: JSON.stringify({
          result: { agents: [{ pane_id: "native", agent: "codex", cwd: root }] },
        }),
      })),
    projects: { resolveMany: () => settled(() => [{}]) },
    desktop: { inventory: () => settled(() => ({ health: "unavailable", windows: [] })) },
    bus: { read: () => busFixture() },
  });
  if (previousHome === undefined) delete process.env.CODEX_HOME;
  else process.env.CODEX_HOME = previousHome;
  let metadataCalls = 0;
  const metadata = transcripts.codexMetadata;
  transcripts.codexMetadata = function (...args) {
    assert.equal(this, adapter, "default adapter preserves inherited method receiver");
    metadataCalls++;
    return metadata(...args);
  };
  try {
    let snapshot = await observer.get();
    for (let attempt = 0; attempt < 100 && snapshot.sessions.length < 3; attempt++) {
      await transcripts.spawnIndexIdle();
      await new Promise((resolve) => setTimeout(resolve, 10));
      if (attempt % 20 === 19) clock += 3000;
      snapshot = await observer.get();
    }
    assert.equal(snapshot.sessions.length, 3, JSON.stringify(snapshot));
    const rootRow = must(snapshot.sessions.find((row) => row.source === "herdr"));
    const child = must(snapshot.sessions.find((row) => row.parentId === rootRow.id));
    const grandchild = must(snapshot.sessions.find((row) => row.parentId === child.id));
    for (const [row, id] of [
      [child, must(ids[1])],
      [grandchild, must(ids[2])],
    ] as const) {
      const detail = await observer.inspect(
        row.id,
        must(row.inspectionIdentity) + "|" + String(row.parentId),
      );
      assert.equal(detail.health, "available");
      assert(detail.turns.some((turn) => turn.text === "own-" + id));
      assert(!detail.turns.some((turn) => turn.text === "own-" + parent));
      assert.equal((await observer.inspect(row.id, "codex:" + parent)).health, "unavailable");
    }
    assert(metadataCalls > 0, "default adapter resolves the current inherited method");
  } finally {
    await observer.close();
    await fs.rm(root, { recursive: true, force: true });
  }
}, 30000);
