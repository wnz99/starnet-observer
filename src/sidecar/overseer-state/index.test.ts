import { test } from "bun:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { makeOverseerState } from "./index.js";
import { fileURLToPath } from "node:url";

const MATCHES = true;
const DOES_NOT_MATCH = false;

test("overseer-state regression contracts", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "overseer-state-"));
  const file = path.join(dir, "private", "identity.json"),
    endpoint = "/fixture/herdr.sock";
  const pane = {
    pane_id: "p1",
    workspace_id: "w1",
    terminal_id: "t1",
    agent: "claude",
    name: "anything",
  };
  try {
    const state = makeOverseerState({ file, endpoint });
    const owner = await state.reserve();
    await assert.rejects(makeOverseerState({ file, endpoint }).reserve(), /overseer-unavailable/);
    const child = await promisify(execFile)(
      process.execPath,
      [
        "--no-env-file",
        "-e",
        "const {makeOverseerState}=require(" +
          JSON.stringify(fileURLToPath(new URL("./index.ts", import.meta.url))) +
          ");" +
          "makeOverseerState(" +
          JSON.stringify({ file, endpoint }) +
          ").reserve().then(()=>process.exit(2),error=>console.log(error.message));",
      ],
      { timeout: 3000 },
    );
    assert.match(
      child.stdout,
      /overseer-unavailable/,
      "another process cannot reserve an active launch",
    );
    assert.equal(
      await state.releaseMissing([], await state.read()),
      DOES_NOT_MATCH,
      "active launch owns recovery too",
    );
    await state.notePane(owner, "p1");
    await state.commit(owner, pane);
    assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
    assert.equal((await fs.stat(path.dirname(file))).mode & 0o777, 0o700);
    const restarted = makeOverseerState({ file, endpoint });
    assert.equal(
      await restarted.match({ ...pane, name: "renamed", terminal_title_stripped: "random" }),
      MATCHES,
    );
    for (const change of [
      { terminal_id: "t2" },
      { workspace_id: "w2" },
      { agent: "codex" },
      { terminal_id: null },
    ]) {
      assert.equal(await restarted.match({ ...pane, ...change }), DOES_NOT_MATCH);
    }
    assert.equal(
      await makeOverseerState({ file, endpoint: "/other.sock" }).match(pane),
      DOES_NOT_MATCH,
    );
    await assert.rejects(restarted.reserve(), /overseer-unavailable/);
    assert.equal(await restarted.releaseMissing([pane], await restarted.read()), DOES_NOT_MATCH);
    const old = await restarted.read();
    assert.equal(await restarted.releaseMissing([], old), MATCHES);
    const next = await restarted.reserve();
    await restarted.notePane(next, "p1");
    const native = {
      ...pane,
      agent_session: {
        agent: "claude",
        kind: "id",
        value: "00000000-0000-0000-0000-000000000001",
      },
    };
    await restarted.commit(next, native);
    assert.equal(
      await restarted.releaseMissing([], old),
      DOES_NOT_MATCH,
      "stale absence proof cannot clear a committed replacement",
    );
    assert.equal(await restarted.match(pane), DOES_NOT_MATCH);
    assert.equal(await restarted.match(native), MATCHES);
    assert.equal(
      await restarted.match({
        ...native,
        agent_session: { ...native.agent_session, value: "00000000-0000-0000-0000-000000000002" },
      }),
      DOES_NOT_MATCH,
    );
    await restarted.releaseMissing([], await restarted.read());
    const uncertain = await restarted.reserve();
    await restarted.notePane(uncertain, "p1");
    await restarted.abandon(uncertain);
    assert.equal(
      await restarted.releaseMissing([], await restarted.read()),
      MATCHES,
      "confirmed absence clears a failed known-pane launch",
    );
    const missingProof = await restarted.reserve();
    await assert.rejects(
      restarted.commit(missingProof, { ...pane, terminal_id: null }),
      /overseer-unavailable/,
    );
    await restarted.abandon(missingProof);
    assert.equal(
      await restarted.releaseMissing([], await restarted.read()),
      DOES_NOT_MATCH,
      "unknown target uncertainty cannot be cleared",
    );
    await fs.writeFile(file, "{broken");
    assert.equal(await restarted.match(native), DOES_NOT_MATCH);
    await assert.rejects(restarted.reserve(), /overseer-unavailable/);
    assert.equal(await restarted.releaseMissing([], await restarted.read()), DOES_NOT_MATCH);
    await fs.writeFile(file, "x".repeat(4097));
    assert.equal((await restarted.read()).state, "unavailable");
    await fs.unlink(file);
    const codexOwner = await restarted.reserve();
    await restarted.notePane(codexOwner, "p1");
    await restarted.commit(codexOwner, { ...pane, agent: "codex" });
    assert.equal(
      await makeOverseerState({ file, endpoint }).match({ ...pane, agent: "codex" }),
      MATCHES,
      "terminal proof works without common Codex native session",
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
  console.log(
    "overseer-state: private persistence, restart, exact proof, reservation and corrupt fail-closed OK",
  );
}, 30000);
