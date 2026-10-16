import {
  expectBoolean,
  required,
  detail as detailedResult,
} from "../transcripts/testing.fixture.js";
import type { TranscriptHandle, TranscriptIO } from "../transcripts/contracts.js";
import type { Root } from "../helpers/contracts.js";
import { test } from "bun:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { Database } from "bun:sqlite";
import os from "node:os";
import { makeHelperObserver } from "./index.js";
import { makeTranscriptObserver } from "../transcripts/index.js";

test("observer-helpers regression contracts", async () => {
  const ID = "00000000-0000-0000-0000-000000000001";
  const CHILD = "00000000-0000-0000-0000-000000000002";
  const OTHER = "00000000-0000-0000-0000-000000000003";
  const line = (row: unknown) => JSON.stringify(row) + "\n";
  const meta = (id: string, parent?: string) => ({
    type: "session_meta",
    payload: { id, ...(parent ? { parent_thread_id: parent, agent_nickname: "Scout" } : {}) },
  });
  const message = (text: string) => ({
    type: "response_item",
    payload: { type: "message", role: "assistant", content: [{ type: "output_text", text }] },
  });
  await (async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "starnet-helpers-"));
    try {
      let clock = 1000;
      const now = () => clock;
      const codex = path.join(root, "codex"),
        claude = path.join(root, "claude");
      await fs.mkdir(codex);
      await fs.mkdir(claude);
      const parentFile = path.join(codex, ID + ".jsonl"),
        childFile = path.join(codex, CHILD + ".jsonl");
      await fs.writeFile(
        parentFile,
        line(meta(ID)) +
          line({
            type: "token_usage_record",
            payload: { thread_token_usage: { input_tokens: 100 } },
          }) +
          line(message("PARENT")),
      );
      await fs.writeFile(
        childFile,
        line(meta(CHILD, ID)) +
          line({
            type: "token_usage_record",
            payload: { thread_token_usage: { input_tokens: 7 } },
          }) +
          line(message('CHILD password="private canary"')),
      );
      const transcripts = makeTranscriptObserver({ now, roots: { codex, claude } });
      const parent: Root = {
        id: "parent",
        provider: "codex",
        sessionId: ID,
        inspectionIdentity: "codex:" + ID,
        source: "herdr",
        inventoryHealth: "available",
        projectId: "project",
        project: "Project",
      };
      let edges = [{ parent_thread_id: ID, child_thread_id: CHILD, status: "open" }];
      const helpers = makeHelperObserver({ now, transcripts, readEdges: () => ({ rows: edges }) });
      const before = await transcripts.inspect(parent.id, "codex", ID);
      const prepared = await helpers.prepareChildren([parent]);
      assert.equal(prepared.rows.length, 1);
      expectBoolean({
        actual: (await helpers.inspect(required(prepared.rows[0]))).available,
        expected: false,
        message: "preparation does not publish bindings",
      });
      prepared.commitBindings(new Set());
      expectBoolean({
        actual: (await helpers.inspect(required(prepared.rows[0]))).available,
        expected: false,
        message: "rejected helper binding never becomes inspectable",
      });
      prepared.commitBindings(new Set([required(prepared.rows[0]).id]));
      expectBoolean({
        actual: (await helpers.inspect(required(prepared.rows[0]))).available,
        expected: true,
      });
      const clearing = await helpers.prepareChildren([]);
      expectBoolean({
        actual: (await helpers.inspect(required(prepared.rows[0]))).available,
        expected: true,
        message: "another preparation leaves the live map intact",
      });
      clearing.commitBindings(new Set());
      expectBoolean({
        actual: (await helpers.inspect(required(prepared.rows[0]))).available,
        expected: false,
        message: "publication replaces bindings atomically",
      });
      let result = await helpers.children([parent]);
      assert.equal(result.rows.length, 1);
      const child = result.rows[0];
      assert.equal(required(child).parentId, parent.id);
      assert.equal(required(child).source, "helper");
      assert.equal(required(child).status, "unknown");
      assert.equal(required(child).lineageState, "open");
      assert.equal(required(child).projectId, "project");
      assert.equal(required(child).observedAt, clock);
      assert.deepEqual(required(child).lifecycleEvidence, {
        state: "open",
        reason: null,
        source: "codex:thread_spawn_edges",
        observedAt: null,
      });
      assert.equal(required(required(child).taskEvidence).state, "unavailable");
      assert.equal(required(required(required(child).usage).inputTokens).value, 7);
      assert(!JSON.stringify(result).includes("private canary"));
      const detail = await helpers.inspect(required(child));
      assert.equal(detailedResult(before).stats.inputTokens.value, 100);
      assert.equal(detailedResult(detail).stats.inputTokens.value, 7);
      assert(detailedResult(detail).turns.some((turn) => turn.text.includes("CHILD")));
      assert(!JSON.stringify(detail).includes("private canary"));
      assert(!JSON.stringify(detail).includes("PARENT"));
      assert.deepEqual(
        detailedResult(await transcripts.inspect(parent.id, "codex", ID)).stats,
        detailedResult(before).stats,
      );
      const codexTurn = (type: string, at: string) => ({
        type: "event_msg",
        timestamp: at,
        payload: { type, turn_id: "own" },
      });
      await fs.appendFile(
        parentFile,
        line({
          type: "event_msg",
          timestamp: "2026-10-12T00:00:00Z",
          payload: {
            type: "collab_agent_spawn_begin",
            call_id: "native",
            sender_thread_id: ID,
            prompt: 'Audit password="private assignment"',
          },
        }) +
          line({
            type: "event_msg",
            payload: {
              type: "collab_agent_spawn_end",
              call_id: "native",
              sender_thread_id: ID,
              new_thread_id: CHILD,
            },
          }),
      );
      await fs.appendFile(childFile, line(codexTurn("task_complete", "2026-10-12T00:01:00Z")));
      result = await helpers.children([parent]);
      assert.equal(required(required(result.rows[0]).taskStatusEvidence).status, "completed");
      assert.equal(required(result.rows[0]).status, "done");
      assert.equal(
        required(required(result.rows[0]).lifecycleEvidence).state,
        "open",
        "turn completion leaves resumable edge open",
      );
      assert.equal(
        required(required(result.rows[0]).taskEvidence).summary,
        null,
        "prompt-only assignment stays unavailable",
      );
      assert.equal(required(required(result.rows[0]).taskEvidence).state, "unavailable");
      assert(!JSON.stringify(result.rows).includes("private assignment"));
      assert.equal(
        required(required(result.rows[0]).taskEvidence).observedAt,
        Date.parse("2026-10-12T00:00:00Z"),
      );
      required(edges[0]).status = "closed";
      result = await helpers.children([parent]);
      assert.equal(required(required(result.rows[0]).lifecycleEvidence).reason, "closed");
      assert.equal(required(required(result.rows[0]).lifecycleEvidence).observedAt, null);
      required(edges[0]).status = "open";
      await fs.appendFile(childFile, line(codexTurn("task_started", "2026-10-12T00:02:00Z")));
      result = await helpers.children([parent]);
      assert.equal(required(required(result.rows[0]).taskStatusEvidence).status, "running");
      assert.equal(
        required(result.rows[0]).status,
        "unknown",
        "old running evidence cannot acquire refresh freshness",
      );
      assert.equal(required(required(result.rows[0]).lifecycleEvidence).state, "open");
      await fs.writeFile(childFile, line(meta(CHILD, ID)) + line(message("CHILD")));
      // A live exact pane supplies status, and one child identity must produce only one row.
      const pane: Root = {
        ...parent,
        id: "child-pane",
        sessionId: CHILD,
        inspectionIdentity: "codex:" + CHILD,
        status: "blocked",
      };
      result = await helpers.children([parent, pane]);
      assert.equal(result.rows.length, 0);
      assert.equal(required(result.annotations.get("child-pane")).parentId, "parent");
      required(edges[0]).status = "closed";
      result = await helpers.children([parent, pane]);
      assert.equal(
        required(required(result.annotations.get(pane.id)).lifecycleEvidence).state,
        "closed",
      );
      assert.equal(
        required(result.annotations.get(pane.id)).status,
        undefined,
        "provider closure cannot overwrite Herdr blocked status",
      );
      required(edges[0]).status = "open";
      // Rewrites/replacements/late identity loss cannot retain earlier child text.
      await fs.writeFile(childFile, line(meta(CHILD, OTHER)) + line(message("FOREIGN")));
      expectBoolean({
        actual: (await helpers.inspect(required(child))).available,
        expected: false,
      });
      assert.equal((await helpers.children([parent])).rows.length, 0);
      await fs.writeFile(childFile + ".new", line(meta(CHILD, ID)) + line(message("REPLACED")));
      await fs.rename(childFile + ".new", childFile);
      result = await helpers.children([parent]);
      assert(
        detailedResult(await helpers.inspect(required(result.rows[0]))).turns.some(
          (turn) => turn.text === "REPLACED",
        ),
      );
      // A contradictory identity in the bounded tail must not pass an earlier valid header.
      await fs.writeFile(
        childFile,
        line(meta(CHILD, ID)) + "x".repeat(300000) + "\n" + line(meta(CHILD, OTHER)),
      );
      expectBoolean({
        actual: (await helpers.inspect(required(result.rows[0]))).available,
        expected: false,
      });
      assert.equal(
        (await helpers.children([parent])).rows.length,
        0,
        "discovery rejects conflicting tail parent",
      );
      await fs.writeFile(
        childFile,
        line(meta(CHILD, ID)) + "x".repeat(300000) + "\n" + line(meta(OTHER, ID)),
      );
      assert.equal(
        (await helpers.children([parent])).rows.length,
        0,
        "discovery rejects conflicting tail child",
      );
      await fs.writeFile(childFile, line(meta(CHILD, ID)) + line(message("RESTORED")));
      edges.push({ parent_thread_id: OTHER, child_thread_id: CHILD, status: "closed" });
      assert.equal((await helpers.children([parent])).rows.length, 0);
      edges = [
        { parent_thread_id: ID, child_thread_id: CHILD, status: "open" },
        { parent_thread_id: CHILD, child_thread_id: ID, status: "open" },
      ];
      assert.equal((await helpers.children([parent])).rows.length, 0, "cycle rejected");
      assert.equal(
        (await helpers.children([{ ...parent, inventoryHealth: "unavailable" }])).rows.length,
        0,
      );
      edges = [{ parent_thread_id: ID, child_thread_id: CHILD, status: "open" }];
      const codexBinding = await transcripts.bindChild("codex", CHILD, ID);
      assert(codexBinding);
      async function rejectConflictingCodexAliases() {
        for (const alias of ["session_id", "thread_id"])
          for (const location of ["prefix", "tail"]) {
            await fs.writeFile(
              childFile,
              line(meta(CHILD, ID)) + line(message("SELECTED BEFORE CONFLICT")),
            );
            assert(
              detailedResult(
                await transcripts.inspectChild(required(child).id, required(codexBinding)),
              ).turns.some((turn) => turn.text === "SELECTED BEFORE CONFLICT"),
            );
            const conflict = {
              type: "session_meta",
              payload: { id: CHILD, [alias]: OTHER, parent_thread_id: ID },
            };
            await fs.writeFile(
              childFile,
              location === "prefix"
                ? line(conflict)
                : line(meta(CHILD, ID)) + "x".repeat(300000) + "\n" + line(conflict),
            );
            expectBoolean({
              actual: (await transcripts.inspectChild(required(child).id, required(codexBinding)))
                .available,
              expected: false,
              message: "Codex alias conflict withdraws selected text/stats",
            });
            assert.equal(
              (await helpers.children([parent])).rows.length,
              0,
              "Codex alias conflict withholds inventory",
            );
          }
      }
      await rejectConflictingCodexAliases();
      async function rejectConflictingCodexMetadata() {
        for (const payload of [
          { session_id: CHILD },
          { id: CHILD },
          { id: CHILD, session_id: CHILD, thread_id: CHILD },
        ]) {
          await fs.writeFile(
            childFile,
            line({ type: "session_meta", payload: { ...payload, parent_thread_id: ID } }),
          );
          assert.equal(
            (await helpers.children([parent])).rows.length,
            1,
            "supported Codex identity spelling",
          );
        }
      }
      await rejectConflictingCodexMetadata();
      await fs.writeFile(childFile, line(meta(CHILD, ID)) + line(message("RESTORED")));
      // Parent authority requires every present supported header alias to agree,
      // including complete contradictory headers beyond the bounded prefix.
      async function rejectAbsentCodexAliases() {
        for (const alias of ["session_id", "thread_id"])
          for (const value of [OTHER, null, ""]) {
            for (const location of ["prefix", "tail"]) {
              const conflict = { type: "session_meta", payload: { id: ID, [alias]: value } };
              await fs.writeFile(
                parentFile,
                location === "prefix"
                  ? line(conflict)
                  : line(meta(ID)) + "x".repeat(300000) + "\n" + line(conflict),
              );
              expectBoolean({
                actual: (await transcripts.read(parent.id, "codex", ID)).available,
                expected: false,
              });
              assert.equal(
                (await helpers.children([parent])).rows.length,
                0,
                "conflicting parent cannot authorize helpers",
              );
            }
          }
      }
      await rejectAbsentCodexAliases();
      await fs.writeFile(
        parentFile,
        line({ type: "session_meta", payload: { id: ID, session_id: ID, thread_id: ID } }),
      );
      assert.equal(
        (await helpers.children([parent])).rows.length,
        1,
        "agreeing parent aliases authorize helpers",
      );
      // Claude filename alone proves nothing. Complete sidechain identity must agree with path and parent.
      const cp = path.join(claude, ID + ".jsonl");
      const spawn = (
        canonical: string,
        child: string,
        call = "spawn-" + child,
        description = "Scout assignment",
      ) => [
        {
          type: "assistant",
          sessionId: canonical,
          timestamp: "2026-10-12T00:00:00Z",
          message: {
            content: [
              {
                type: "tool_use",
                name: "Agent",
                id: call,
                input: { description, prompt: "PRIVATE FULL PROMPT" },
              },
            ],
          },
        },
        {
          type: "user",
          sessionId: canonical,
          toolUseResult: { status: "async_launched", agentId: child },
          message: { content: [{ type: "tool_result", tool_use_id: call }] },
        },
      ];
      await fs.writeFile(
        cp,
        line({ type: "user", sessionId: ID, message: { content: "CLAUDE PARENT" } }),
      );
      const directory = path.join(claude, ID, "subagents");
      await fs.mkdir(directory, { recursive: true });
      const cf = path.join(directory, "agent-scout.jsonl");
      const record = {
        type: "assistant",
        sessionId: ID,
        agentId: "scout",
        isSidechain: true,
        message: { id: "c", usage: { input_tokens: 7 }, content: "CLAUDE CHILD" },
      };
      await fs.writeFile(cf, line(record));
      const claudeParent: Root = {
        ...parent,
        provider: "claude",
        inspectionIdentity: "claude:" + ID,
      };
      assert.equal(
        (await helpers.children([claudeParent])).rows.length,
        0,
        "candidate alone supplies no direct ancestry",
      );
      await fs.appendFile(cp, spawn(ID, "scout").map(line).join(""));
      result = await helpers.children([claudeParent]);
      assert.equal(result.rows.length, 1);
      assert.equal(required(result.rows[0]).status, "unknown");
      assert.equal(
        detailedResult(await helpers.inspect(required(result.rows[0]))).stats.inputTokens.value,
        7,
      );
      assert.equal(
        detailedResult(await transcripts.inspect("cp", "claude", ID)).stats.inputTokens.value,
        null,
      );
      assert.equal(required(required(result.rows[0]).taskEvidence).summary, "Scout assignment");
      assert.equal(required(required(required(result.rows[0]).usage).inputTokens).value, 7);
      assert(!JSON.stringify(result.rows).includes("PRIVATE FULL PROMPT"));
      await fs.writeFile(
        cp,
        spawn(ID, "scout", "spawn-scout", 'Label password="secret label" ' + "x".repeat(300))
          .map(line)
          .join(""),
      );
      result = await helpers.children([claudeParent]);
      assert.equal(required(required(result.rows[0]).taskEvidence).state, "partial");
      assert.equal(required(required(required(result.rows[0]).taskEvidence).summary).length, 240);
      assert(!JSON.stringify(result.rows).includes("secret label"));
      await fs.writeFile(cp, spawn(ID, "scout").map(line).join(""));
      const baseParent = await fs.readFile(cp, "utf8");
      const notification = (status: string, extra: Record<string, unknown> = {}) => ({
        type: "queue-operation",
        operation: "enqueue",
        sessionId: ID,
        timestamp: "2026-10-12T00:01:00Z",
        content:
          "<task-notification><task-id>scout</task-id><tool-use-id>spawn-scout</tool-use-id><status>" +
          status +
          "</status><summary>Done</summary></task-notification>",
        ...extra,
      });
      async function checkClaudeTerminalStatuses() {
        for (const status of ["completed", "failed", "killed", "stopped"]) {
          await fs.writeFile(cp, baseParent + line(notification(status)));
          result = await helpers.children([claudeParent]);
          const native = result.rows[0];
          assert.equal(required(required(native).taskStatusEvidence).status, status);
          assert.equal(
            required(required(native).lifecycleEvidence).state,
            ["killed", "stopped"].includes(status) ? "closed" : "unknown",
          );
          assert.equal(
            required(required(native).lifecycleEvidence).reason,
            status === "killed" ? "killed" : status === "stopped" ? "closed" : null,
          );
          if (status === "killed")
            assert.equal(
              required(required(native).lifecycleEvidence).observedAt,
              Date.parse("2026-10-12T00:01:00Z"),
            );
          expectBoolean({
            actual: (await helpers.inspect(required(native))).available,
            expected: true,
            message: "closed historical helper stays inspectable",
          });
        }
      }
      await checkClaudeTerminalStatuses();
      async function checkNativeClaudeNotifications() {
        for (const native of [
          {
            type: "user",
            sessionId: ID,
            origin: { kind: "task-notification" },
            timestamp: "2026-10-12T00:01:00Z",
            message: { content: notification("killed").content },
          },
          {
            type: "attachment",
            sessionId: ID,
            timestamp: "2026-10-12T00:01:00Z",
            attachment: {
              type: "task_status",
              taskType: "local_agent",
              taskId: "scout",
              status: "killed",
            },
          },
        ]) {
          await fs.writeFile(cp, baseParent + line(native));
          result = await helpers.children([claudeParent]);
          assert.equal(required(required(result.rows[0]).lifecycleEvidence).reason, "killed");
          assert.equal(
            required(required(result.rows[0]).lifecycleEvidence).observedAt,
            Date.parse("2026-10-12T00:01:00Z"),
          );
        }
      }
      await checkNativeClaudeNotifications();
      async function rejectUnsupportedClaudeNotifications() {
        for (const unsupported of [
          notification("killed", { operation: "remove" }),
          notification("killed", { sessionId: OTHER }),
          { type: "user", sessionId: ID, message: { content: notification("killed").content } },
          notification("killed", {
            content: notification("killed").content.replace("spawn-scout", "Bash-call"),
          }),
          notification("killed", {
            content:
              "<task-notification><task-id>scout</task-id><result><status>killed</status></result></task-notification>",
          }),
          {
            type: "attachment",
            sessionId: ID,
            attachment: {
              type: "task_status",
              taskType: "local_bash",
              taskId: "scout",
              status: "killed",
            },
          },
        ]) {
          await fs.writeFile(cp, baseParent + line(unsupported));
          result = await helpers.children([claudeParent]);
          assert.equal(required(required(result.rows[0]).lifecycleEvidence).state, "unknown");
          assert.equal(required(required(result.rows[0]).taskStatusEvidence).status, null);
        }
      }
      await rejectUnsupportedClaudeNotifications();
      await fs.writeFile(
        cp,
        baseParent +
          line(notification("killed")) +
          line({
            type: "attachment",
            sessionId: ID,
            timestamp: "2026-10-12T00:02:00Z",
            attachment: {
              type: "task_status",
              taskType: "local_agent",
              taskId: "scout",
              status: "running",
            },
          }),
      );
      result = await helpers.children([claudeParent]);
      assert.equal(
        required(required(result.rows[0]).lifecycleEvidence).state,
        "unknown",
        "newer native work supersedes killed task state",
      );
      assert.equal(required(required(result.rows[0]).taskStatusEvidence).status, "running");
      assert.equal(required(result.rows[0]).status, "unknown");
      clock = Date.parse("2026-10-12T00:02:01Z");
      result = await helpers.children([claudeParent]);
      assert.equal(
        required(result.rows[0]).status,
        "working",
        "fresh own native running snapshot maps status",
      );
      clock = 1000;
      await fs.writeFile(cp, baseParent);
      // Nested transcripts share root namespace; only their matched spawn establishes direct parentage.
      const nestedFile = path.join(directory, "agent-nested.jsonl");
      await fs.writeFile(
        nestedFile,
        line({
          ...record,
          agentId: "nested",
          message: { id: "nested-own", usage: { input_tokens: 3 }, content: "NESTED" },
        }),
      );
      await fs.appendFile(
        cf,
        spawn(ID, "nested")
          .map((row) => line({ ...row, agentId: "scout", isSidechain: true }))
          .join(""),
      );
      await fs.writeFile(
        nestedFile.slice(0, -6) + ".meta.json",
        JSON.stringify({ toolUseId: "spawn-nested", parentAgentId: "scout" }),
      );
      result = await helpers.children([claudeParent]);
      const direct = result.rows.find((row) => row.sessionId === "scout"),
        nested = result.rows.find((row) => row.sessionId === "nested");
      assert.equal(result.rows.length, 2);
      assert.equal(required(nested).parentId, required(direct).id);
      assert.equal(required(direct).parentId, claudeParent.id);
      assert.equal(required(required(required(nested).usage).inputTokens).value, 3);
      expectBoolean({
        actual: (await helpers.inspect(required(nested))).available,
        expected: true,
      });
      // A newly conflicting ancestor withdraws selected content and usage before and after the child read.
      const ancestryWithdrawals: Awaited<
          ReturnType<ReturnType<typeof makeHelperObserver>["inspect"]>
        >[] = [],
        selectedNestedFile = await fs.realpath(nestedFile);
      async function revokeConflictingAncestorBindings() {
        for (const timing of ["before", "during", "ambiguous-before"]) {
          let injectConflict = false,
            injected = false;
          const raceTranscripts = makeTranscriptObserver({
            now,
            roots: { codex, claude },
            fs: {
              ...fs,
              open: async (
                ...args: Parameters<TranscriptIO["open"]>
              ): Promise<TranscriptHandle> => {
                const handle = await fs.open(...args);
                if (args[0] !== selectedNestedFile) return handle;
                return {
                  stat: () => handle.stat(),
                  close: () => handle.close(),
                  read: async (...values: Parameters<TranscriptHandle["read"]>) => {
                    const read = await handle.read(...values);
                    if (injectConflict) {
                      injectConflict = false;
                      injected = true;
                      await fs.appendFile(
                        cp,
                        spawn(ID, "nested", "conflicting-root").map(line).join(""),
                      );
                    }
                    return read;
                  },
                };
              },
            },
          });
          const raceHelpers = makeHelperObserver({ now, transcripts: raceTranscripts });
          await raceHelpers.children([claudeParent]);
          await raceTranscripts.spawnIndexIdle();
          const selectedNested = (await raceHelpers.children([claudeParent])).rows.find(
            (row) => row.sessionId === "nested",
          );
          const selectedDetail = await raceHelpers.inspect(required(selectedNested));
          assert(detailedResult(selectedDetail).turns.some((turn) => turn.text === "NESTED"));
          assert.equal(detailedResult(selectedDetail).stats.inputTokens.value, 3);
          if (timing === "during") injectConflict = true;
          else {
            await fs.appendFile(cp, spawn(ID, "nested", "conflicting-root").map(line).join(""));
            if (timing === "ambiguous-before")
              await fs.appendFile(
                cp,
                spawn(ID, "nested", "second-conflicting-root").map(line).join(""),
              );
          }
          ancestryWithdrawals.push(await raceHelpers.inspect(required(selectedNested)));
          if (timing === "during")
            assert(injected, "ancestor claim is injected during selected child descriptor read");
          await fs.writeFile(cp, baseParent);
        }
      }
      await revokeConflictingAncestorBindings();
      assert.deepEqual(
        ancestryWithdrawals,
        [{ available: false }, { available: false }, { available: false }],
        "conflicting ancestor withholds selected content and stats before selection and after child await",
      );
      await fs.writeFile(
        nestedFile.slice(0, -6) + ".meta.json",
        JSON.stringify({ toolUseId: "spawn-nested", parentAgentId: "foreign" }),
      );
      expectBoolean({
        actual: (await helpers.inspect(required(nested))).available,
        expected: false,
        message: "selected nesting revalidates changed sidecar",
      });
      assert.equal(
        (await helpers.children([claudeParent])).rows.length,
        1,
        "conflicting nested sidecar fails closed",
      );
      await fs.unlink(nestedFile.slice(0, -6) + ".meta.json");
      assert.equal(
        (await helpers.children([claudeParent])).rows.length,
        2,
        "matched containing spawn proves parent without optional sidecar",
      );
      await fs.appendFile(cp, spawn(ID, "nested", "conflicting-root").map(line).join(""));
      result = await helpers.children([claudeParent]);
      assert.equal(
        result.rows.length,
        1,
        "two native immediate parents for one binding are ambiguous",
      );
      assert.equal(required(result.rows[0]).sessionId, "scout");
      await fs.appendFile(cp, spawn(ID, "nested", "second-conflicting-root").map(line).join(""));
      result = await helpers.children([claudeParent]);
      assert.deepEqual(
        result.rows.map((row) => row.sessionId),
        ["scout"],
        "ambiguous root spawn still contradicts a nested immediate-parent claim",
      );
      await fs.writeFile(cp, baseParent);
      const otherDirectory = path.join(claude, OTHER, "subagents");
      await fs.mkdir(otherDirectory, { recursive: true });
      await fs.writeFile(
        path.join(claude, OTHER + ".jsonl"),
        spawn(OTHER, "scout").concat(spawn(OTHER, "scout")).map(line).join(""),
      );
      await fs.writeFile(
        path.join(otherDirectory, "agent-scout.jsonl"),
        line({
          ...record,
          sessionId: OTHER,
          message: { id: "distinct", usage: { input_tokens: 11 }, content: "OTHER" },
        }),
      );
      const otherParent: Root = {
        ...claudeParent,
        id: "other-parent",
        sessionId: OTHER,
        inspectionIdentity: "claude:" + OTHER,
      };
      transcripts.beginDiscovery();
      result = await helpers.children([claudeParent, otherParent]);
      const scouts = result.rows.filter((row) => row.sessionId === "scout");
      assert.equal(scouts.length, 2);
      assert.notEqual(required(scouts[0]).id, required(scouts[1]).id);
      assert.deepEqual(
        scouts
          .map((row) => required(required(row.usage).inputTokens).value)
          .sort((a, b) => required(a) - required(b)),
        [7, 11],
      );
      await fs.unlink(nestedFile);
      await fs.writeFile(cf, line(record));
      result = await helpers.children([claudeParent]);
      const claudeChild = result.rows[0];
      const claudeBinding = await transcripts.bindChild("claude", "scout", ID, cf);
      assert(claudeBinding);
      async function rejectLateChildParentChanges() {
        for (const location of ["prefix", "tail"]) {
          const conflict = { ...record, sessionId: OTHER };
          await fs.writeFile(
            cf,
            location === "prefix"
              ? line(conflict)
              : line(record) + "x".repeat(300000) + "\n" + line(conflict),
          );
          expectBoolean({
            actual: (
              await transcripts.inspectChild(required(claudeChild).id, required(claudeBinding))
            ).available,
            expected: false,
            message: "Claude canonical parent conflict withdraws selected text/stats",
          });
          assert.equal(
            (await helpers.children([claudeParent])).rows.length,
            0,
            "Claude canonical parent conflict withholds inventory",
          );
        }
      }
      await rejectLateChildParentChanges();
      async function acceptUnrelatedTransportAliases() {
        for (const aliases of [
          { sessionId: ID },
          { sessionId: ID, session_id: OTHER },
          { sessionId: ID, session_id: ID },
        ]) {
          await fs.writeFile(cf, line({ ...record, ...aliases }));
          result = await helpers.children([claudeParent]);
          assert.equal(
            result.rows.length,
            1,
            "canonical Claude parent owns attribution regardless of transport ID",
          );
          assert.equal(
            detailedResult(await helpers.inspect(required(result.rows[0]))).stats.inputTokens.value,
            7,
          );
        }
      }
      await acceptUnrelatedTransportAliases();
      await fs.writeFile(cf, line({ ...record, sessionId: undefined, session_id: ID }));
      assert.equal(
        (await helpers.children([claudeParent])).rows.length,
        0,
        "snake-only transport ID is not canonical transcript identity",
      );
      async function rejectClaudeIdentityConflicts() {
        for (const conflict of [
          { agentId: "other" },
          { sessionId: OTHER },
          { isSidechain: false },
        ]) {
          await fs.writeFile(
            cf,
            line(record) + "x".repeat(300000) + "\n" + line({ ...record, ...conflict }),
          );
          expectBoolean({
            actual: (
              await transcripts.inspectChild(required(claudeChild).id, required(claudeBinding))
            ).available,
            expected: false,
          });
          assert.equal(
            (await helpers.children([claudeParent])).rows.length,
            0,
            "discovery rejects conflicting Claude tail",
          );
        }
      }
      await rejectClaudeIdentityConflicts();
      await fs.writeFile(cf, line({ ...record, agentId: "other" }));
      assert.equal((await helpers.children([claudeParent])).rows.length, 0);
      await fs.unlink(cf);
      await fs.symlink(cp, cf);
      assert.equal((await helpers.children([claudeParent])).rows.length, 0);
      await fs.unlink(cf);
      await fs.writeFile(cf, line(record));
      // The exact nested directory can never be replaced by a link, even to another contained directory.
      await fs.rename(directory, directory + "-real");
      await fs.symlink(directory + "-real", directory);
      assert.equal((await helpers.children([claudeParent])).rows.length, 0);
      // Late duplicate filenames revoke an already-selected Codex child, without awaiting index expiry.
      edges = [{ parent_thread_id: ID, child_thread_id: CHILD, status: "open" }];
      result = await helpers.children([parent]);
      const selected = result.rows[0];
      await fs.mkdir(path.join(codex, "duplicate"));
      await fs.writeFile(path.join(codex, "duplicate", CHILD + ".jsonl"), line(meta(CHILD, ID)));
      expectBoolean({
        actual: (await helpers.inspect(required(selected))).available,
        expected: false,
      });
      assert.equal((await helpers.children([parent])).rows.length, 0);
      await fs.rm(path.join(codex, "duplicate"), { recursive: true });
      // Nearby overflow keeps independently inspectable rows and bounds total helpers and depth.
      edges = [];
      async function writeOverflowChildren() {
        for (let index = 10; index < 80; index++) {
          const id = "00000000-0000-0000-0000-" + String(index).padStart(12, "0");
          edges.push({ parent_thread_id: ID, child_thread_id: id, status: "open" });
          await fs.writeFile(path.join(codex, id + ".jsonl"), line(meta(id, ID)));
        }
      }
      await writeOverflowChildren();
      transcripts.beginDiscovery();
      result = await helpers.children([parent]);
      assert.equal(result.rows.length, 64);
      assert.equal(result.rows.filter((row) => row.helperSlot !== null).length, 8);
      assert.equal(result.overflow.get(parent.id), 62);
      edges = [];
      let previous = ID;
      async function writeDeepChildren() {
        for (let index = 90; index < 94; index++) {
          const id = "00000000-0000-0000-0000-" + String(index).padStart(12, "0");
          edges.push({ parent_thread_id: previous, child_thread_id: id, status: "closed" });
          await fs.writeFile(path.join(codex, id + ".jsonl"), line(meta(id, previous)));
          previous = id;
        }
      }
      await writeDeepChildren();
      transcripts.beginDiscovery();
      result = await helpers.children([parent]);
      assert.equal(result.rows.length, 3);
      assert(result.rows.every((row) => row.status === "unknown" && row.lineageState === "closed"));
      // A live pane at depth three must inherit grouping without restarting at depth zero.
      const cutoffId = required(edges[2]).child_thread_id;
      const cutoffPane = {
        ...pane,
        id: "cutoff-pane",
        sessionId: cutoffId,
        inspectionIdentity: "codex:" + cutoffId,
        projectId: "old-room",
        repoId: "old-repo",
        worktreeId: "old-worktree",
      };
      const groupedParent: Root = {
        ...parent,
        repoId: "parent-repo",
        worktreeId: "parent-worktree",
      };
      async function inheritGroupingAtCutoff() {
        for (const parents of [
          [cutoffPane, groupedParent],
          [groupedParent, cutoffPane],
        ]) {
          result = await helpers.children(parents);
          assert.equal(
            result.rows.length,
            2,
            "depth-four descendant withheld despite live pane at cutoff",
          );
          assert(!result.rows.some((row) => row.sessionId === required(edges[3]).child_thread_id));
          assert.equal(
            required(result.annotations.get(cutoffPane.id)).parentId,
            required(result.rows[1]).id,
          );
          for (const grouping of [result.annotations.get(cutoffPane.id), ...result.rows]) {
            assert.equal(required(grouping).projectId, "project");
            assert.equal(required(grouping).repoId, "parent-repo");
            assert.equal(required(grouping).worktreeId, "parent-worktree");
          }
        }
      }
      await inheritGroupingAtCutoff();
      // When no verified ancestor is observed, the pane remains a legitimate independent root.
      result = await helpers.children([cutoffPane]);
      assert.equal(result.rows.length, 1);
      assert.equal(required(result.rows[0]).sessionId, required(edges[3]).child_thread_id);
      assert.equal(required(result.rows[0]).projectId, "old-room");
      assert.equal(required(result.rows[0]).parentId, cutoffPane.id);
      // Observed panes beyond the cutoff cannot restart a fully proved chain.
      async function writeDeeperChildren() {
        for (let index = 94; index < 96; index++) {
          const id = "00000000-0000-0000-0000-" + String(index).padStart(12, "0");
          edges.push({ parent_thread_id: previous, child_thread_id: id, status: "closed" });
          await fs.writeFile(path.join(codex, id + ".jsonl"), line(meta(id, previous)));
          previous = id;
        }
      }
      await writeDeeperChildren();
      transcripts.beginDiscovery();
      async function preserveObservedDepthOwnership() {
        for (const depth of [4, 5]) {
          const deepId = required(edges[depth - 1]).child_thread_id;
          const deepPane = {
            ...cutoffPane,
            id: "deep-pane",
            sessionId: deepId,
            inspectionIdentity: "codex:" + deepId,
          };
          for (const parents of [
            [deepPane, groupedParent],
            [groupedParent, deepPane],
          ]) {
            result = await helpers.children(parents);
            assert.equal(result.rows.length, 3, "deep pane does not restart helper discovery");
            assert.deepEqual(
              result.rows.map((row) => row.sessionId),
              edges.slice(0, 3).map((edge) => edge.child_thread_id),
            );
            const inherited = result.annotations.get(deepPane.id);
            assert.equal(required(inherited).projectId, "project");
            assert.equal(required(inherited).repoId, "parent-repo");
            assert.equal(required(inherited).worktreeId, "parent-worktree");
            assert.equal(
              required(inherited).parentId,
              undefined,
              "deep pane does not advertise an out-of-bound helper parent",
            );
          }
          result = await helpers.children([deepPane]);
          expectBoolean({ actual: result.annotations.has(deepPane.id), expected: false });
          assert.equal(required(result.rows[0]).parentId, deepPane.id);
          assert.equal(required(result.rows[0]).projectId, "old-room");
          const interveningId = required(edges[1]).child_thread_id;
          const interveningFile = path.join(codex, interveningId + ".jsonl");
          const original = await fs.readFile(interveningFile);
          for (const replacement of [
            null,
            line(meta(interveningId, OTHER)),
            line(message("UNPROVED")),
          ]) {
            if (replacement === null) await fs.unlink(interveningFile);
            else await fs.writeFile(interveningFile, replacement);
            result = await helpers.children([groupedParent, deepPane]);
            expectBoolean({
              actual: result.annotations.has(deepPane.id),
              expected: false,
              message: "DB alone cannot claim the pane",
            });
            const independent = result.rows.find((row) => row.parentId === deepPane.id);
            assert(independent);
            assert.equal(independent.projectId, "old-room");
            await fs.writeFile(interveningFile, original);
          }
        }
      }
      await preserveObservedDepthOwnership();
      // Real WAL database: only the private copy is opened; metadata-only SQL cannot expose private columns.
      const dbFile = path.join(root, "state.sqlite");
      await fs.writeFile(dbFile, "");
      const writer = new Database(dbFile);
      writer.run(
        "PRAGMA journal_mode=WAL; CREATE TABLE thread_spawn_edges(parent_thread_id TEXT, child_thread_id TEXT, status TEXT); CREATE TABLE threads(id TEXT, prompt TEXT)",
      );
      writer.query("INSERT INTO thread_spawn_edges VALUES (?, ?, ?)").run(ID, CHILD, "open");
      writer.query("INSERT INTO threads VALUES (?, ?)").run(CHILD, "PRIVATE DATABASE CANARY");
      let opened = 0;
      const fromDb = makeHelperObserver({
        now,
        transcripts,
        file: dbFile,
        tempRoot: root,
        loadSqlite: () => ({
          Database: class extends Database {
            constructor(file: string) {
              assert.notEqual(file, dbFile);
              super(file);
              opened++;
            }
          },
        }),
      });
      const listing = (await fs.readdir(root)).sort();
      result = await fromDb.children([parent]);
      assert.equal(result.rows.length, 1);
      assert.equal(opened, 1);
      assert(!JSON.stringify(result.rows).includes("PRIVATE DATABASE CANARY"));
      assert.deepEqual((await fs.readdir(root)).sort(), listing);
      const IMMEDIATE_CLOSE = true;
      writer.close(IMMEDIATE_CLOSE);
      const unsupported = makeHelperObserver({
        now,
        transcripts,
        file: dbFile,
        loadSqlite: () => {
          throw new Error("unsupported");
        },
      });
      result = await unsupported.children([parent]);
      assert.equal(result.health, "unavailable");
      assert.equal(result.reason, "unsupported");
      assert.equal(result.rows.length, 0);
      console.log(
        "observer helpers: exact lineage, conflict/cycle, independent projection, withdrawal and containment PASS",
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  })();
}, 30000);
