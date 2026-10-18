import { test } from "bun:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Root } from "./contracts.js";
import { makeHelperObserver } from "./index.js";
import { makeTranscriptObserver } from "../transcripts/index.js";

test("Claude helpers stay discovered when their spawn indexes exceed cache capacity", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "observer-helper-pressure-"));
  const sessionId = "00000000-0000-0000-0000-000000000001";
  const line = (record: unknown) => JSON.stringify(record) + "\n";
  const spawn = (child: string, canonical = sessionId, agentId?: string) =>
    line({
      type: "assistant",
      sessionId: canonical,
      ...(agentId ? { agentId, isSidechain: true } : {}),
      message: {
        content: [{ type: "tool_use", name: "Agent", id: child, input: { description: child } }],
      },
    }) +
    line({
      type: "user",
      sessionId: canonical,
      ...(agentId ? { agentId, isSidechain: true } : {}),
      toolUseResult: { status: "async_launched", agentId: child },
      message: { content: [{ type: "tool_result", tool_use_id: child }] },
    });
  const padding = line({
    type: "user",
    sessionId,
    message: { content: "x".repeat(10000) },
  }).repeat(30);
  const children = Array.from({ length: 64 }, (_, i) => "child-" + String(i).padStart(2, "0"));
  const parent: Root = {
    id: "parent",
    provider: "claude",
    sessionId,
    inspectionIdentity: "claude:" + sessionId,
    source: "herdr",
    inventoryHealth: "available",
    projectId: "project",
  };
  const transcripts = makeTranscriptObserver({ now: () => 1000, roots: { claude: root } });
  const helpers = makeHelperObserver({ now: () => 1000, transcripts });
  try {
    const directory = path.join(root, sessionId, "subagents");
    await fs.mkdir(directory, { recursive: true });
    const parentFile = path.join(root, sessionId + ".jsonl");
    await fs.writeFile(
      parentFile,
      padding +
        children
          .slice(0, 60)
          .map((child) => spawn(child))
          .join("") +
        padding +
        children
          .slice(60)
          .map((child) => spawn(child))
          .join(""),
    );
    await Promise.all(
      children.map((agentId) =>
        fs.writeFile(
          path.join(directory, "agent-" + agentId + ".jsonl"),
          line({
            type: "assistant",
            sessionId,
            agentId,
            isSidechain: true,
            message: { content: "Child" },
          }) + spawn("missing-grandchild-" + agentId, sessionId, agentId),
        ),
      ),
    );
    const discovered: number[] = [];
    for (let sweep = 0; sweep < 4; sweep++) {
      transcripts.beginDiscovery();
      await transcripts.read(parent.id, parent.provider, parent.sessionId);
      const result = await helpers.children([parent]);
      discovered.push(result.rows.length);
      await transcripts.spawnIndexIdle();
    }
    assert.deepEqual(discovered, [4, 64, 64, 64]);

    const secondSessionId = "00000000-0000-0000-0000-000000000002";
    const secondParent: Root = {
      ...parent,
      id: "second-parent",
      sessionId: secondSessionId,
      inspectionIdentity: "claude:" + secondSessionId,
    };
    const secondDirectory = path.join(root, secondSessionId, "subagents");
    await fs.mkdir(secondDirectory, { recursive: true });
    await fs.writeFile(
      path.join(root, secondSessionId + ".jsonl"),
      padding.replaceAll(sessionId, secondSessionId) +
        spawn("second-child", secondSessionId) +
        padding.replaceAll(sessionId, secondSessionId),
    );
    await fs.writeFile(
      path.join(secondDirectory, "agent-second-child.jsonl"),
      line({
        type: "assistant",
        sessionId: secondSessionId,
        agentId: "second-child",
        isSidechain: true,
        message: { content: "Second child" },
      }),
    );
    await fs.writeFile(
      parentFile,
      padding +
        children
          .slice(0, 63)
          .map((child) => spawn(child))
          .join("") +
        padding,
    );
    const shared: number[] = [];
    for (let sweep = 0; sweep < 4; sweep++) {
      transcripts.beginDiscovery();
      for (const row of [parent, secondParent])
        await transcripts.read(row.id, row.provider, row.sessionId);
      shared.push((await helpers.children([parent, secondParent])).rows.length);
      await transcripts.spawnIndexIdle();
    }
    assert.deepEqual(
      shared,
      [64, 64, 64, 64],
      "missing grandchildren must not starve a later root",
    );

    // A warm parent index must still revalidate changed evidence under pressure.
    await fs.writeFile(parentFile, padding);
    transcripts.beginDiscovery();
    await transcripts.read(parent.id, parent.provider, parent.sessionId);
    assert.equal((await helpers.children([parent])).rows.length, 0);
  } finally {
    await transcripts.spawnIndexIdle();
    await fs.rm(root, { recursive: true, force: true });
  }
});
