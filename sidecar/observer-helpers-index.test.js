"use strict";
const { test } = require("bun:test");

test("observer-helpers-index regression contracts", async () => {
  const assert = require("node:assert/strict");
  const fs = require("node:fs/promises");
  const path = require("node:path");
  const os = require("node:os");
  const { makeHelperObserver } = require("./observer-helpers.js");
  const { makeTranscriptObserver } = require("./observer-transcripts.js");
  const ID = "00000000-0000-0000-0000-000000000001";
  const line = (row) => JSON.stringify(row) + "\n";
  const spawn = (child, call = "spawn-" + child, description = "Task " + child) =>
    [
      {
        type: "assistant",
        sessionId: ID,
        timestamp: "2026-10-15T10:00:00Z",
        message: {
          content: [
            {
              type: "tool_use",
              name: "Agent",
              id: call,
              input: { description, prompt: "PRIVATE PROMPT" },
            },
          ],
        },
      },
      {
        type: "user",
        sessionId: ID,
        toolUseResult: { status: "async_launched", agentId: child },
        message: { content: [{ type: "tool_result", tool_use_id: call }] },
      },
    ]
      .map(line)
      .join("");
  // Ordinary parent conversation, well past the bounded tail window (≈790KB) so early spawns fall out of it.
  const padding = (rows, tag = "p") =>
    Array.from({ length: rows }, (_, i) =>
      line({
        type: "user",
        sessionId: ID,
        timestamp: "2026-10-15T10:30:00Z",
        message: { content: tag + i + " " + "x".repeat(600) },
      }),
    ).join("");
  const childRow = (child, timestamp) =>
    line({
      type: "assistant",
      sessionId: ID,
      agentId: child,
      isSidechain: true,
      timestamp,
      message: { id: "m-" + child, usage: { input_tokens: 3 }, content: "CHILD " + child },
    });
  const notification = (child, status) =>
    line({
      type: "queue-operation",
      operation: "enqueue",
      sessionId: ID,
      timestamp: "2026-10-15T11:00:00Z",
      content:
        "<task-notification><task-id>" +
        child +
        "</task-id><tool-use-id>spawn-" +
        child +
        "</tool-use-id><status>" +
        status +
        "</status><summary>s</summary></task-notification>",
    });

  await (async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "starnet-helper-index-"));
    try {
      let clock = Date.parse("2026-10-15T12:00:00Z");
      const now = () => clock;
      const claude = path.join(root, "claude"),
        codex = path.join(root, "codex");
      await fs.mkdir(codex);
      const directory = path.join(claude, ID, "subagents");
      await fs.mkdir(directory, { recursive: true });
      const parentFile = path.join(claude, ID + ".jsonl");
      const child = async (name, { meta = "spawn-" + name, at = "2026-10-15T10:01:00Z" } = {}) => {
        await fs.writeFile(path.join(directory, "agent-" + name + ".jsonl"), childRow(name, at));
        if (meta)
          await fs.writeFile(
            path.join(directory, "agent-" + name + ".meta.json"),
            JSON.stringify({ toolUseId: meta }),
          );
      };
      await child("early1");
      await child("early2");
      await child("nometa", { meta: null });
      await child("badmeta", { meta: "spawn-other" });
      await child("late");
      const head = line({
        type: "user",
        sessionId: ID,
        timestamp: "2026-10-15T09:59:00Z",
        message: { content: "PARENT START" },
      });
      // Early spawns sit past the verified 256KB head and far before the tail, as in a long orchestrator session.
      await fs.writeFile(
        parentFile,
        head +
          padding(500, "h") +
          spawn("early1") +
          spawn("early2") +
          spawn("nometa") +
          spawn("badmeta") +
          padding(1700) +
          spawn("late"),
      );
      assert((await fs.stat(parentFile)).size > 1024 * 1024, "fixture parent exceeds 1MB");
      const transcripts = makeTranscriptObserver({ now, roots: { claude, codex } });
      const helpers = makeHelperObserver({ now, transcripts, readEdges: () => ({ rows: [] }) });
      const parent = {
        id: "parent",
        provider: "claude",
        sessionId: ID,
        inspectionIdentity: "claude:" + ID,
        source: "herdr",
        inventoryHealth: "available",
        projectId: "p",
        project: "P",
      };
      const names = (result) => result.rows.map((row) => row.sessionId).sort();

      // First pass sees only the tail window; the full-file index builds in the background.
      let result = await helpers.children([parent]);
      assert.deepEqual(names(result), ["late"], "tail window alone holds only the latest spawn");
      await transcripts.spawnIndexIdle();
      result = await helpers.children([parent]);
      assert.deepEqual(
        names(result),
        ["early1", "early2", "late", "nometa"],
        "index finds spawns far outside the window; mismatched sidecar is rejected",
      );
      assert.equal(
        result.rows.find((row) => row.sessionId === "early1").taskEvidence.summary,
        "Task early1",
      );
      assert(!JSON.stringify(result.rows).includes("PRIVATE PROMPT"));
      const early = result.rows.find((row) => row.sessionId === "early1");
      assert.equal(
        (await helpers.inspect(early)).available,
        true,
        "index-proven helper stays inspectable",
      );

      // Appends are followed incrementally, even when the new spawn is itself pushed out of the tail.
      await child("appended");
      await fs.appendFile(parentFile, spawn("appended") + padding(1700, "q"));
      result = await helpers.children([parent]);
      assert(
        names(result).includes("appended"),
        "appended spawn found through the incremental index",
      );
      assert(names(result).includes("early2"));

      // Rewrite only middle bytes, preserving the inode, length, prefix and entire bounded tail.
      // A previously granted private binding must be revoked before a refresh can commit new bindings.
      for (const append of [false, true]) {
        await child("revoked");
        const before = head + padding(500, "h") + spawn("revoked") + padding(1700, "z");
        await fs.writeFile(parentFile, before);
        result = await helpers.children([parent]);
        const revoked = result.rows.find((row) => row.sessionId === "revoked");
        assert(revoked);
        assert.equal((await helpers.inspect(revoked)).available, true);
        const after = before.replace('"Agent"', '"Other"');
        assert.equal(Buffer.byteLength(after), Buffer.byteLength(before));
        await fs.writeFile(
          parentFile,
          after + (append ? padding(20, "appended-after-rewrite") : ""),
        );
        assert.equal(
          (await helpers.inspect(revoked)).available,
          false,
          "middle rewrite revokes private inspection, including when followed by append",
        );
        result = await helpers.children([parent]);
        assert(
          !names(result).includes("revoked"),
          "middle rewrite removes the helper relationship",
        );
      }
      // Restore the append/event scenario after the independent rewrite cases.
      await fs.writeFile(
        parentFile,
        head + padding(500, "h") + spawn("early1") + spawn("early2") + padding(1700),
      );
      result = await helpers.children([parent]);

      // Terminal events outside the tail are indexed too, so a finished early helper reads done, not unknown.
      await fs.appendFile(parentFile, notification("early2", "completed"));
      result = await helpers.children([parent]);
      assert.equal(result.rows.find((row) => row.sessionId === "early2").status, "done");

      // A conflicting second spawn claim for the same child is ambiguous and drops it.
      await fs.appendFile(parentFile, spawn("early1", "spawn-early1-again"));
      result = await helpers.children([parent]);
      assert(
        !names(result).includes("early1"),
        "repeated claim with another tool use id fails closed",
      );

      // A rewrite that keeps the same prefix but different later bytes restarts the index from the first byte.
      await fs.writeFile(
        parentFile,
        head + padding(500, "h") + spawn("early1") + padding(2600, "r"),
      );
      result = await helpers.children([parent]);
      assert.deepEqual(names(result), ["early1"], "rewrite drops spawns that no longer exist");
      // Replacement by rename (new inode) also resets.
      await fs.writeFile(
        parentFile + ".tmp",
        head + padding(500, "h") + spawn("late") + padding(1700, "s"),
      );
      await fs.rename(parentFile + ".tmp", parentFile);
      result = await helpers.children([parent]);
      assert.deepEqual(names(result), ["late"], "replacement drops spawns that no longer exist");

      // Liveness: the helper's own recent conversation row means working; old rows stay unknown; terminal means done.
      await fs.writeFile(parentFile, head + padding(500, "h") + spawn("live") + padding(1700, "t"));
      await child("live", { at: new Date(clock - 5000).toISOString() });
      result = await helpers.children([parent]);
      await transcripts.spawnIndexIdle();
      result = await helpers.children([parent]);
      assert.equal(
        result.rows.find((row) => row.sessionId === "live").status,
        "working",
        "own row 5s ago reads working",
      );
      clock += 30000;
      result = await helpers.children([parent]);
      assert.equal(
        result.rows.find((row) => row.sessionId === "live").status,
        "unknown",
        "own row 35s ago is not evidence of work",
      );
      await fs.writeFile(
        path.join(directory, "agent-live.jsonl"),
        childRow("live", new Date(clock - 1000).toISOString()),
      );
      await fs.appendFile(parentFile, notification("live", "completed"));
      result = await helpers.children([parent]);
      assert.equal(
        result.rows.find((row) => row.sessionId === "live").status,
        "done",
        "terminal event wins over a recent row",
      );

      // Root ambiguity lives outside both bounded windows. A nested valid claim cannot
      // choose a parent for that same canonical child, even when root's merged value is null.
      await child("scout");
      await child("nested");
      const scoutFile = path.join(directory, "agent-scout.jsonl");
      const nestedSpawn = spawn("nested", "spawn-nested", "Nested task")
        .split("\n")
        .filter(Boolean)
        .map((row) => line({ ...JSON.parse(row), agentId: "scout", isSidechain: true }))
        .join("");
      await fs.appendFile(scoutFile, nestedSpawn);
      await fs.writeFile(parentFile, head + padding(500, "h") + spawn("scout") + padding(1700));
      result = await helpers.children([parent]);
      await transcripts.spawnIndexIdle();
      result = await helpers.children([parent]);
      const nested = result.rows.find((row) => row.sessionId === "nested");
      assert(nested, "nested helper starts with an unambiguous immediate parent");
      assert.equal((await helpers.inspect(nested)).available, true);
      await fs.writeFile(
        parentFile,
        head +
          padding(500, "h") +
          spawn("scout") +
          spawn("nested", "root-one") +
          spawn("nested", "root-two") +
          padding(1700),
      );
      assert.equal(
        (await helpers.inspect(nested)).available,
        false,
        "indexed ambiguous ancestor revokes the existing private binding",
      );
      result = await helpers.children([parent]);
      assert.deepEqual(
        names(result),
        ["scout"],
        "indexed ambiguous ancestor claim prevents a guessed nested parent",
      );

      // Delay only the root's full index read. The first snapshot must finish with
      // its valid tail helper, but no guessed nested ancestry or private transcript.
      await fs.writeFile(
        parentFile,
        head +
          padding(500, "h") +
          spawn("nested", "root-one") +
          spawn("nested", "root-two") +
          padding(1700) +
          spawn("scout"),
      );
      const indexedFile = await fs.realpath(parentFile);
      let releaseIndex, indexStarted;
      const indexGate = new Promise((resolve) => {
        releaseIndex = resolve;
      });
      const started = new Promise((resolve) => {
        indexStarted = resolve;
      });
      const delayedFs = Object.create(fs);
      delayedFs.open = async (file, ...args) => {
        const handle = await fs.open(file, ...args);
        return new Proxy(handle, {
          get(target, name) {
            if (name === "read")
              return async (buffer, offset, length, position) => {
                if (file === indexedFile && length > 256 * 1024) {
                  indexStarted();
                  await indexGate;
                }
                return target.read(buffer, offset, length, position);
              };
            const value = target[name];
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
      };
      const coldTranscripts = makeTranscriptObserver({
        now,
        fs: delayedFs,
        roots: { claude, codex },
      });
      const coldHelpers = makeHelperObserver({
        now,
        transcripts: coldTranscripts,
        readEdges: () => ({ rows: [] }),
      });
      let deadline;
      const timeout = new Promise((_, reject) => {
        deadline = setTimeout(
          () => reject(new Error("Cold-index snapshot or inspection blocked on background scan")),
          3000,
        );
      });
      try {
        await Promise.race([
          (async () => {
            result = await coldHelpers.children([parent]);
            await started;
            assert.deepEqual(
              names(result),
              ["scout"],
              "cold snapshot keeps tail helper but withholds nested ancestry until ancestor claims are complete",
            );
            assert.equal(
              (await coldHelpers.inspect(result.rows[0])).available,
              false,
              "pending full index denies private inspection even for a valid tail helper",
            );
            // Exercise the private transcript boundary using real proved child bindings,
            // independently of traversal's new rule withholding the nested public row.
            const scoutCandidate = (
              await coldTranscripts.claudeCandidates(ID, undefined, parent.id)
            ).find((value) => value.sessionId === "scout");
            const scoutBinding = await coldTranscripts.bindChild(
              "claude",
              "scout",
              ID,
              scoutCandidate.file,
              scoutCandidate.spawn,
            );
            const nestedCandidate = (
              await coldTranscripts.claudeCandidates("scout", scoutBinding, "cold-scout")
            ).find((value) => value.sessionId === "nested");
            assert(nestedCandidate);
            const nestedBinding = await coldTranscripts.bindChild(
              "claude",
              "nested",
              ID,
              nestedCandidate.file,
              nestedCandidate.spawn,
            );
            assert(nestedBinding);
            assert.equal(
              (await coldTranscripts.inspectChild("cold-nested", nestedBinding)).available,
              false,
              "pending ancestor index cannot authorize private nested content",
            );
          })(),
          timeout,
        ]);
      } finally {
        clearTimeout(deadline);
        releaseIndex();
        await coldTranscripts.spawnIndexIdle();
      }
      result = await coldHelpers.children([parent]);
      assert.deepEqual(
        names(result),
        ["scout"],
        "completed root ambiguity continues to suppress nested helper",
      );
      assert.equal(
        (await coldHelpers.inspect(result.rows[0])).available,
        true,
        "complete proof unlocks valid tail helper inspection",
      );

      // Preserve the bounded reader's exact prefix/tail/mtime while changing an
      // unvalidated header spawn and making a middle run too large to index fully.
      await child("partial-header");
      const partialTime = new Date("2026-10-15T13:00:00Z");
      const headerPrefix = head + padding(20, "header");
      const partialMiddle = padding(600, "merge");
      const partialBefore =
        headerPrefix +
        spawn("partial-header") +
        padding(500, "gap") +
        partialMiddle +
        padding(1700, "tail");
      await fs.writeFile(parentFile, partialBefore);
      await fs.utimes(parentFile, partialTime, partialTime);
      result = await helpers.children([parent]);
      const partialSelected = result.rows.find((row) => row.sessionId === "partial-header");
      assert(partialSelected);
      assert.equal((await helpers.inspect(partialSelected)).available, true);
      const partialAfter = partialBefore
        .replace('"Agent"', '"Other"')
        .replace(partialMiddle, partialMiddle.replaceAll("\n", " "));
      assert.equal(Buffer.byteLength(partialAfter), Buffer.byteLength(partialBefore));
      await fs.writeFile(parentFile, partialAfter);
      await fs.utimes(parentFile, partialTime, partialTime);
      assert.equal(
        (await helpers.inspect(partialSelected)).available,
        false,
        "partial index denies private stale-header proof",
      );
      result = await helpers.children([parent]);
      assert.deepEqual(
        names(result),
        [],
        "partial full index cannot resurrect stale header claim during discovery",
      );
      assert.equal(
        (await helpers.inspect(partialSelected)).available,
        false,
        "private denial persists after stale row withdrawal",
      );

      // Losing either a spawn or its pending call makes negative ancestry evidence
      // incomplete. Exercise each cap independently; status-only eviction is separate.
      const splitSpawn = (name, call) => spawn(name, call).trim().split("\n").map(JSON.parse);
      const [fillerCall, fillerResult] = splitSpawn("filler", "filler-call");
      const [firstCall, firstResult] = splitSpawn("nested", "root-one");
      const [secondCall, secondResult] = splitSpawn("nested", "root-two");
      const manyResults = Array.from({ length: 513 }, (_, i) =>
        line({
          ...fillerResult,
          toolUseResult: { status: "async_launched", agentId: "filler-" + i },
        }),
      ).join("");
      const manyCalls = Array.from({ length: 513 }, (_, i) =>
        line({
          ...fillerCall,
          message: { content: [{ ...fillerCall.message.content[0], id: "call-" + i }] },
        }),
      ).join("");
      const oversized = line({
        ...firstCall,
        message: {
          content: [
            {
              ...firstCall.message.content[0],
              input: { description: "Large task", prompt: "PRIVATE OVERSIZED ".repeat(80000) },
            },
          ],
        },
      });
      for (const [label, incomplete] of [
        [
          "spawn cap",
          line(firstCall) +
            line(firstResult) +
            line(secondCall) +
            line(secondResult) +
            line(fillerCall) +
            manyResults,
        ],
        [
          "call cap",
          line(firstCall) + line(secondCall) + manyCalls + line(firstResult) + line(secondResult),
        ],
        [
          "oversized complete row",
          oversized.replace(
            "PRIVATE OVERSIZED ".repeat(80000),
            "PRIVATE OVERSIZED ".repeat(20000),
          ) + line(firstResult),
        ],
        ["oversized chunk-spanning row", oversized + line(firstResult)],
      ]) {
        await fs.writeFile(parentFile, head + padding(500, "h") + padding(1700) + spawn("scout"));
        result = await helpers.children([parent]);
        await transcripts.spawnIndexIdle();
        result = await helpers.children([parent]);
        const selected = result.rows.find((row) => row.sessionId === "nested");
        assert(selected, label + ": complete evidence initially permits nested helper");
        assert.equal((await helpers.inspect(selected)).available, true);
        await fs.writeFile(
          parentFile,
          head + padding(500, "h") + incomplete + padding(1700) + spawn("scout"),
        );
        assert.equal(
          (await helpers.inspect(selected)).available,
          false,
          label + ": incomplete ancestor proof revokes private binding",
        );
        result = await helpers.children([parent]);
        assert.deepEqual(
          names(result),
          [],
          label +
            ": incomplete index cannot prove a unique helper even with readable tail metadata",
        );
        assert(!JSON.stringify(result).includes("PRIVATE OVERSIZED"));
      }

      // JSON escapes preserve native identity; a byte-substring prefilter cannot
      // prove that rows without literal Agent/status markers contain no claims.
      const escapedConflict = (spawn("nested", "root-one") + spawn("nested", "root-two"))
        .replaceAll('"Agent"', '"\\u0041gent"')
        .replaceAll("async_launched", "async_\\u006caunched");
      await fs.writeFile(
        parentFile,
        head + padding(500, "h") + escapedConflict + padding(1700) + spawn("scout"),
      );
      result = await helpers.children([parent]);
      assert.deepEqual(
        names(result),
        ["scout"],
        "escaped native ancestor conflicts remain authoritative outside bounded windows",
      );

      const manyEvents = Array.from({ length: 513 }, (_, i) =>
        notification("event-" + i, "completed"),
      ).join("");
      await fs.writeFile(
        parentFile,
        head + padding(500, "h") + manyEvents + padding(1700) + spawn("scout"),
      );
      result = await helpers.children([parent]);
      const afterEventOverflow = result.rows.find((row) => row.sessionId === "nested");
      assert(
        afterEventOverflow,
        "status-event eviction does not erase complete spawn-absence proof",
      );
      assert.equal(
        (await helpers.inspect(afterEventOverflow)).available,
        true,
        "status-only overflow does not deny complete private ancestry proof",
      );

      // The header projection validates only its short prefix and tail on reuse.
      // Restore exact mtime after a header-only edit: the full index must still own absence.
      await child("header");
      const fixedTime = new Date("2026-10-15T12:00:00Z");
      const rewriteAtFixedTime = async (text) => {
        await fs.writeFile(parentFile, text);
        await fs.utimes(parentFile, fixedTime, fixedTime);
      };
      const headerClaim = head + padding(20, "header") + spawn("header") + padding(1700, "tail");
      await rewriteAtFixedTime(headerClaim);
      result = await helpers.children([parent]);
      const selectedHeader = result.rows.find((row) => row.sessionId === "header");
      assert(selectedHeader);
      assert.equal((await helpers.inspect(selectedHeader)).available, true);
      await rewriteAtFixedTime(headerClaim.replace('"Agent"', '"Other"'));
      assert.equal(
        (await helpers.inspect(selectedHeader)).available,
        false,
        "full-index absence revokes stale header proof before discovery despite restored mtime",
      );
      result = await helpers.children([parent]);
      assert.deepEqual(
        names(result),
        [],
        "full-index absence withdraws the helper despite cached header claim",
      );
      assert.equal(
        (await helpers.inspect(selectedHeader)).available,
        false,
        "revocation persists after discovery",
      );

      // A rejected stale header claim must not survive as an undefined map entry
      // whose presence would wrongly contradict a valid nested immediate parent.
      const headerAncestor =
        head +
        padding(20, "header") +
        spawn("nested", "root-header") +
        padding(1700, "tail") +
        spawn("scout");
      await rewriteAtFixedTime(headerAncestor);
      result = await helpers.children([parent]);
      assert.deepEqual(names(result), ["scout"]);
      await rewriteAtFixedTime(headerAncestor.replace('"Agent"', '"Other"'));
      result = await helpers.children([parent]);
      assert.deepEqual(
        names(result),
        ["nested", "scout"],
        "absent indexed claim is absent from ancestor presence lookup",
      );
      assert.equal(
        (await helpers.inspect(result.rows.find((row) => row.sessionId === "nested"))).available,
        true,
      );

      const headerEvent =
        head +
        padding(20, "header") +
        spawn("header") +
        notification("header", "completed") +
        padding(1700, "tail");
      await rewriteAtFixedTime(headerEvent);
      result = await helpers.children([parent]);
      assert.equal(result.rows[0].status, "done");
      await rewriteAtFixedTime(
        headerEvent.replace("<status>completed</status>", "<status>unrelated</status>"),
      );
      result = await helpers.children([parent]);
      assert.equal(
        result.rows[0].status,
        "unknown",
        "full-index event absence withdraws stale cached terminal status",
      );

      // The bounded reader must revalidate all retained header metadata, including
      // a header that grew after its first projection, independently of index proof.
      const headerProof = makeTranscriptObserver({ now, roots: { claude, codex } });
      await rewriteAtFixedTime(head);
      await headerProof.read("header-proof", "claude", ID);
      await rewriteAtFixedTime(headerClaim);
      await headerProof.read("header-proof", "claude", ID);
      assert(headerProof.helperMetadata("header-proof").helperSpawns.has("header"));
      await rewriteAtFixedTime(headerClaim.replace('"Agent"', '"Other"'));
      await headerProof.read("header-proof", "claude", ID);
      assert.equal(
        headerProof.helperMetadata("header-proof").helperSpawns.has("header"),
        false,
        "grown header proof covers every retained helper record",
      );

      // A failed or rejected full scan is unavailable proof, never a fresh cold
      // scan whose bounded positive metadata can establish uniqueness by fallback.
      await rewriteAtFixedTime(headerClaim);
      let failIndexReads = false,
        holdIndexRead = null;
      const unavailableFs = Object.create(fs),
        unavailableParentFile = await fs.realpath(parentFile);
      unavailableFs.open = async (file, ...args) => {
        const handle = await fs.open(file, ...args);
        return new Proxy(handle, {
          get(target, name) {
            if (name === "read")
              return async (buffer, offset, length, position) => {
                if (file === unavailableParentFile && length > 256 * 1024) {
                  if (failIndexReads) throw new Error("Index read unavailable");
                  if (holdIndexRead) await holdIndexRead;
                }
                return target.read(buffer, offset, length, position);
              };
            const value = target[name];
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
      };
      const unavailableTranscripts = makeTranscriptObserver({
        now,
        fs: unavailableFs,
        roots: { claude, codex },
      });
      const unavailableHelpers = makeHelperObserver({
        now,
        transcripts: unavailableTranscripts,
        readEdges: () => ({ rows: [] }),
      });
      await unavailableHelpers.children([parent]);
      await unavailableTranscripts.spawnIndexIdle();
      result = await unavailableHelpers.children([parent]);
      const beforeFailure = result.rows.find((row) => row.sessionId === "header");
      assert(beforeFailure);
      failIndexReads = true;
      assert.equal((await unavailableHelpers.inspect(beforeFailure)).available, false);
      result = await unavailableHelpers.children([parent]);
      assert.deepEqual(
        names(result),
        [],
        "failed warm index cannot fall back to a readable positive header claim",
      );
      failIndexReads = false;
      result = await unavailableHelpers.children([parent]);
      assert.deepEqual(
        names(result),
        ["header"],
        "a failed scan recovers on the next successful full proof",
      );
      await fs.truncate(parentFile, 128 * 1024 * 1024 + 1);
      result = await unavailableHelpers.children([parent]);
      assert.deepEqual(
        names(result),
        [],
        "oversized-file rejection cannot fall back to a readable positive header claim",
      );
      await unavailableTranscripts.spawnIndexIdle();
      await rewriteAtFixedTime(headerClaim);
      result = await unavailableHelpers.children([parent]);
      assert.deepEqual(
        names(result),
        ["header"],
        "oversized rejection clears old digest evidence and recovers after shrink",
      );
      assert.equal((await unavailableHelpers.inspect(result.rows[0])).available, true);

      await rewriteAtFixedTime(head + manyCalls + spawn("header") + padding(1700, "tail"));
      let releasePartialCold;
      holdIndexRead = new Promise((resolve) => {
        releasePartialCold = resolve;
      });
      const partialColdTranscripts = makeTranscriptObserver({
        now,
        fs: unavailableFs,
        roots: { claude, codex },
      });
      const partialColdHelpers = makeHelperObserver({
        now,
        transcripts: partialColdTranscripts,
        readEdges: () => ({ rows: [] }),
      });
      try {
        result = await partialColdHelpers.children([parent]);
        assert.deepEqual(
          names(result),
          [],
          "an explicitly partial bounded projection cannot authorize cold helper discovery",
        );
      } finally {
        releasePartialCold();
        holdIndexRead = null;
        await partialColdTranscripts.spawnIndexIdle();
      }

      // Saturating cold discovery must not detach pending scans from their cache
      // entries or shutdown tracking. Delay each index while ordinary reads finish.
      const capacityRoot = path.join(root, "capacity");
      await fs.mkdir(capacityRoot);
      const capacityIds = Array.from(
        { length: 66 },
        (_, i) => "10000000-0000-0000-0000-" + String(i).padStart(12, "0"),
      );
      const opens = new Map(),
        gates = new Map();
      let startedCount = 0,
        closedCount = 0,
        allStarted,
        othersClosed,
        released = false;
      const started64 = new Promise((resolve) => {
        allStarted = resolve;
      });
      const closed63 = new Promise((resolve) => {
        othersClosed = resolve;
      });
      const capacityFs = Object.create(fs);
      capacityFs.open = async (file, ...args) => {
        const count = (opens.get(file) || 0) + 1;
        opens.set(file, count);
        const handle = await fs.open(file, ...args);
        if (count === 1) return handle;
        let release;
        const gate = new Promise((resolve) => {
          release = resolve;
        });
        gates.set(file, release);
        if (released) release();
        let startedScan = false;
        return new Proxy(handle, {
          get(target, name) {
            if (name === "read")
              return async (...values) => {
                if (!startedScan) {
                  startedScan = true;
                  if (++startedCount === 64) allStarted();
                }
                await gate;
                return target.read(...values);
              };
            if (name === "close")
              return async () => {
                await target.close();
                if (++closedCount === 63) othersClosed();
              };
            const value = target[name];
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
      };
      const capacityTranscripts = makeTranscriptObserver({
        now,
        fs: capacityFs,
        roots: { claude: capacityRoot, codex },
      });
      let capacityDeadline;
      const capacityTimeout = new Promise((_, reject) => {
        capacityDeadline = setTimeout(
          () => reject(new Error("Capacity scan tracking did not settle")),
          3000,
        );
      });
      try {
        await Promise.race([
          (async () => {
            for (const id of capacityIds)
              await fs.writeFile(
                path.join(capacityRoot, id + ".jsonl"),
                line({ type: "user", sessionId: id, message: { content: "Identity" } }) +
                  (id === capacityIds[64]
                    ? spawn("refused")
                        .trim()
                        .split("\n")
                        .map((row) => line({ ...JSON.parse(row), sessionId: id }))
                        .join("")
                    : ""),
              );
            const refusedDirectory = path.join(capacityRoot, capacityIds[64], "subagents");
            await fs.mkdir(refusedDirectory, { recursive: true });
            await fs.writeFile(
              path.join(refusedDirectory, "agent-refused.jsonl"),
              childRow("refused", "2026-10-15T10:00:00Z"),
            );
            for (const id of capacityIds) {
              assert.equal((await capacityTranscripts.read(id, "claude", id)).available, true);
              const candidates = await capacityTranscripts.claudeCandidates(id, undefined, id);
              if (id === capacityIds[64])
                assert.deepEqual(
                  candidates,
                  [],
                  "capacity refusal cannot authorize a bounded positive claim",
                );
            }
            await started64;
            const firstFile = await fs.realpath(path.join(capacityRoot, capacityIds[0] + ".jsonl"));
            await capacityTranscripts.claudeCandidates(capacityIds[0], undefined, capacityIds[0]);
            assert.equal(startedCount, 64, "only 64 full scans may remain pending");
            for (const id of capacityIds.slice(64))
              assert.equal(
                capacityTranscripts.claudeClaims(id).available,
                false,
                "capacity refusal exposes unavailable proof",
              );
            let idle = false;
            const settling = capacityTranscripts.spawnIndexIdle().then(() => {
              idle = true;
            });
            for (const [file, release] of gates) if (file !== firstFile) release();
            await closed63;
            assert.equal(
              idle,
              false,
              "idle still tracks the oldest pending scan after later roots arrive",
            );
            gates.get(firstFile)();
            await settling;
            assert.equal(
              startedCount,
              64,
              "repeated discovery does not start duplicate pending scans",
            );
            assert.equal(closedCount, 64, "idle waits for every launched scan to close");
            assert.equal(
              opens.get(firstFile),
              2,
              "oldest parent retains its one ordinary read and one shared scan",
            );
            released = true;
            await capacityTranscripts.claudeCandidates(capacityIds[64], undefined, capacityIds[64]);
            await capacityTranscripts.spawnIndexIdle();
            assert.equal(
              startedCount,
              65,
              "a refused root can start after a settled slot becomes available",
            );
            assert.equal(closedCount, 65, "the replacement scan remains tracked through closure");
          })(),
          capacityTimeout,
        ]);
      } finally {
        clearTimeout(capacityDeadline);
        released = true;
        for (const release of gates.values()) release();
        await capacityTranscripts.spawnIndexIdle();
      }

      console.log(
        "observer helpers index: spawns outside the tail, append, conflict, rewrite/replacement reset, sidecar corroboration and activity status PASS",
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  })();
}, 30000);
