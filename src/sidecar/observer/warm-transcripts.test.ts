import { settled } from './testing.fixture.js';
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { makeTranscriptObserver } from "../transcripts/index.js";
import { test } from "bun:test";
import assert from "node:assert/strict";
import { makeObserver } from "./index.js";
import { must, busFixture, deferred } from "./testing.fixture.js";
const ID = "00000000-0000-0000-0000-000000000001";
const line = (record: unknown) => JSON.stringify(record) + "\n";
const meta = (id: string) => ({ type: "session_meta", payload: { id } });
async function observerWarmReuse(temp: string) {
  const directory = path.join(temp, "warm-reuse");
  await fs.mkdir(directory);
  const file = path.join(directory, ID + ".jsonl");
  const body = (text: string) =>
    line(meta(ID)) +
    line({
      type: "response_item",
      payload: { type: "message", role: "assistant", content: text },
    });
  await fs.writeFile(file, body("WARM CONTENT"));
  let clock = 1000,
    reads = 0,
    detailedReads = 0,
    warmStartReads = 0;
  const released = deferred(),
    started = deferred();
  const release = released.resolve,
    entered = started.resolve;
  const opening = started.promise;
  const gate = released.promise;
  const transcripts = makeTranscriptObserver({
    now: () => clock,
    roots: { codex: directory },
    fs: {
      ...fs,
      open: async (...args: Parameters<typeof fs.open>) => {
        const handle = await fs.open(...args);
        return {
          stat: () => handle.stat(),
          close: () => handle.close(),
          read:  (buffer: Buffer, offset: number, length: number, position: number) => { return settled(() => {
            reads++;
            return handle.read(buffer, offset, length, position);
          }); },
        };
      },
    },
  });
  const inspect = transcripts.inspect;
  const observer = makeObserver({
    now: () => clock,
    identities: { resolveMany:  () => settled(() => [{ sessionId: ID, source: "native" }]) },
    execute:  () => settled(() => ({
      stdout: JSON.stringify({
        result: { agents: [{ pane_id: "warm", agent: "codex", cwd: directory }] },
      }),
    })),
    projects: { resolveMany:  () => settled(() => [{}]) },
    desktop: { inventory:  () => settled(() => ({ health: "unavailable", windows: [] })) },
    helpers: {
      prepareChildren:  () => settled(() => ({
        rows: [],
        annotations: new Map(),
        overflow: new Map(),
        commitBindings() {},
      })),
    },
    bus: { read: () => busFixture({ health: "available", rows: [] }) },
    transcripts: {
      ...transcripts,
      inspect: async (...args) => {
        detailedReads++;
        if (detailedReads === 1) warmStartReads = reads;
        const pending = inspect(...args);
        if (detailedReads === 1) {
          entered();
          await gate;
        }
        return pending;
      },
    },
  });
  try {
    const initial = await observer.get();
    const row = must(initial.sessions[0]);
    await opening;
    // The warm path has entered the actual detail reader. Explicit demand shares its pending key.
    const concurrent = observer.inspect(row.id, "codex:" + ID);
    release();
    const warmed = await concurrent;
    assert(warmed.turns.some((turn) => turn.text === "WARM CONTENT"));
    assert.equal(
      reads - warmStartReads,
      2,
      "overlapping warm and explicit reads share one cold projection read",
    );
    const before = reads;
    const reused = await observer.inspect(row.id, "codex:" + ID);
    assert.equal(
      reads - before,
      2,
      "warm projection needs only fresh prefix/window validation on click",
    );
    assert.equal(reused.generation, warmed.generation);
    clock += 60001;
    const beforeExpiry = reads;
    const expired = await transcripts.inspect(row.id, "codex", ID);
    assert(expired.available);
    assert.notEqual(
      expired.generation,
      reused.generation,
      "an expired detail projection is rebuilt",
    );
    assert.equal(
      reads - beforeExpiry,
      2,
      "expiry takes the bounded cold path rather than a second response cache",
    );
    await fs.writeFile(file + ".new", body("REPLACEMENT"));
    await fs.rename(file + ".new", file);
    const replaced = await observer.inspect(row.id, "codex:" + ID);
    assert(!JSON.stringify(replaced).includes("WARM CONTENT"));
    assert(replaced.turns.some((turn) => turn.text === "REPLACEMENT"));
    await fs.unlink(file);
    assert.equal(
      (await observer.inspect(row.id, "codex:" + ID)).health,
      "unavailable",
      "warm projection cannot outlive deleted source",
    );
    console.log(
      "observer warm projection: cached click performs 2 validation reads; replacement and deletion revoke old content",
    );
  } finally {
    release();
    await observer.close();
  }
}

test("observer warm transcript projection regression contracts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "starnet-observer-warm-"));
  try {
    await observerWarmReuse(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}, 30000);
