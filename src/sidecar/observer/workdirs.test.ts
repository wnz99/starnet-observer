import { test, expect } from "bun:test";
import assert from "node:assert/strict";
import { makeObserver } from "./index.js";
import type { ObserverOptions } from "./contracts.js";
import type { ShellEntryObservation } from "../tool-workdirs/contracts.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { makeProjectResolver } from "../projects/index.js";
const execute = promisify(execFile);
const SESSION = "12345678-1234-1234-1234-123456789abc";
const CHILD = "12345678-1234-1234-1234-123456789abd";
const START = 100000000;
function fixture() {
  let now = START;
  let event: ShellEntryObservation | null = {
    version: 1,
    provider: "codex",
    sessionId: SESSION,
    source: "shell-entry",
    cwd: "/tool",
    observedAt: START,
  };
  const reads: string[] = [];
  const options: ObserverOptions = {
    now: () => now,
    execute: () =>
      Promise.resolve({
        stdout: JSON.stringify({
          result: { agents: [{ pane_id: "pane", agent: "codex", cwd: "/terminal" }] },
        }),
      }),
    identities: { resolve: () => ({ sessionId: SESSION, source: "native" }) },
    overseerState: { read: () => Promise.resolve({ state: "empty" }), match: () => false },
    desktop: { inventory: () => ({ health: "unavailable", windows: [] }) },
    bus: { read: () => ({ rows: [], observedAt: now, health: "available", reason: null }) },
    transcripts: { retain: () => {} },
    helpers: { children: () => ({ rows: [], annotations: new Map(), overflow: new Map() }) },
    projects: {
      resolveMany: (cwds) =>
        cwds.map((cwd) => ({
          repoId: cwd === "/tool" ? "other" : "terminal",
          repo: "same-name",
          checkoutId: String(cwd),
          checkoutKind: "main",
          worktree: null,
          projectId: "project",
          project: "Project",
          projectKind: "folder",
        })),
    },
    workdirs: ({ sessionId }) => {
      reads.push(sessionId);
      return Promise.resolve(event);
    },
    warmDetails: false,
  };
  return {
    options,
    reads,
    tick: (ms: number) => {
      now += ms;
    },
    event: (value: ShellEntryObservation | null) => {
      event = value;
    },
  };
}
async function flush(observer: ReturnType<typeof makeObserver>) {
  await observer.get();
  for (let i = 0; i < 10; i++) await new Promise<void>((resolve) => setImmediate(resolve));
  return observer.get();
}
test("tool event preserves terminal grouping, original time, age and read failure withdrawal", async () => {
  const f = fixture(),
    observer = makeObserver(f.options);
  try {
    let result = await flush(observer);
    expect(result.sessions[0]?.repoId).toBe("terminal");
    expect(result.sessions[0]?.checkoutObservation).toEqual({
      source: "shell-entry",
      observedAt: START,
      state: "observed",
      repoId: "other",
      repo: "same-name",
      checkoutId: "/tool",
      checkoutKind: "main",
      worktree: null,
    });
    expect(f.reads).toEqual([SESSION]);
    f.tick(300001);
    result = await flush(observer);
    const aged = result.sessions[0]?.checkoutObservation;
    expect(aged?.state).toBe("stale");
    expect(aged?.observedAt).toBe(START);
    f.event(null);
    f.tick(2001);
    result = await flush(observer);
    expect(result.sessions[0]?.checkoutObservation).toBeUndefined();
  } finally {
    await observer.close();
  }
});
test("wrong thread, source, provider and expired events never project", async () => {
  for (const patch of [
    { sessionId: CHILD },
    { source: "terminal" },
    { provider: "claude" },
    { observedAt: 1 },
    { observedAt: START + 30001 },
  ]) {
    const f = fixture();
    f.event({
      version: 1,
      provider: "codex",
      sessionId: SESSION,
      source: "shell-entry",
      cwd: "/tool",
      observedAt: START,
      ...patch,
    } as ShellEntryObservation);
    const observer = makeObserver(f.options);
    try {
      expect((await flush(observer)).sessions[0]?.checkoutObservation).toBeUndefined();
    } finally {
      await observer.close();
    }
  }
});
test("unverified identity sources never read workdir state", async () => {
  const f = fixture();
  f.options.identities = { resolve: () => ({ sessionId: SESSION, source: "transcript-guess" }) };
  const observer = makeObserver(f.options);
  try {
    const result = await flush(observer);
    expect(result.sessions[0]?.checkoutObservation).toBeUndefined();
    expect(f.reads).toEqual([]);
  } finally {
    await observer.close();
  }
});
test("close ignores a pending exact-session read", async () => {
  const f = fixture();
  let finish: ((value: ShellEntryObservation | null) => void) | undefined;
  f.options.workdirs = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const observer = makeObserver(f.options);
  await observer.get();
  await observer.close();
  finish?.({
    version: 1,
    provider: "codex",
    sessionId: SESSION,
    source: "shell-entry",
    cwd: "/tool",
    observedAt: START,
  });
  expect((await flush(observer)).sessions[0]?.checkoutObservation).toBeUndefined();
});
test("replaced thread cannot receive the prior thread's pending observation", async () => {
  const f = fixture();
  let finish: ((value: ShellEntryObservation | null) => void) | undefined;
  f.options.workdirs = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const observer = makeObserver(f.options);
  try {
    await observer.get();
    assert.ok(f.options.identities);
    f.options.identities.resolve = () => ({ sessionId: CHILD, source: "native" });
    f.tick(2001);
    await observer.get();
    f.options.workdirs = () => Promise.resolve(null);
    finish?.({
      version: 1,
      provider: "codex",
      sessionId: SESSION,
      source: "shell-entry",
      cwd: "/tool",
      observedAt: START,
    });
    const result = await flush(observer);
    expect(result.sessions[0]?.sessionId).toBe(CHILD);
    expect(result.sessions[0]?.checkoutObservation).toBeUndefined();
  } finally {
    await observer.close();
  }
});
test("real main and linked nested cwd use Git evidence and canonical paths", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "observer-workdirs-"));
  const main = path.join(root, "main"),
    linked = path.join(root, "linked"),
    alias = path.join(root, "alias");
  let observer: ReturnType<typeof makeObserver> | undefined;
  try {
    await fs.mkdir(main);
    await execute("git", ["-C", main, "init"]);
    await execute("git", [
      "-C",
      main,
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "--allow-empty",
      "-m",
      "fixture",
    ]);
    await execute("git", ["-C", main, "worktree", "add", "--detach", linked]);
    await fs.mkdir(path.join(linked, "nested"));
    await fs.symlink(path.join(linked, "nested"), alias);
    const f = fixture();
    f.options.execute = () =>
      Promise.resolve({
        stdout: JSON.stringify({
          result: { agents: [{ pane_id: "pane", agent: "codex", cwd: main }] },
        }),
      });
    f.options.projects = makeProjectResolver({ execute, now: () => START, home: root });
    f.event({
      version: 1,
      provider: "codex",
      sessionId: SESSION,
      source: "shell-entry",
      cwd: alias,
      observedAt: START,
    });
    observer = makeObserver(f.options);
    await observer.get();
    const result = await waitForCheckout(observer);
    const terminal = result.sessions[0];
    assert.ok(terminal);
    const tool = terminal.checkoutObservation;
    assert.ok(tool);
    expect(terminal.checkoutKind).toBe("main");
    expect(terminal.worktree).toBeNull();
    expect(tool.checkoutKind).toBe("worktree");
    expect(tool.repoId).toBe(terminal.repoId ?? null);
    expect(tool.checkoutId).not.toBe(terminal.checkoutId ?? null);
  } finally {
    await observer?.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
async function waitForCheckout(observer: ReturnType<typeof makeObserver>) {
  let result = await flush(observer);
  for (let i = 0; i < 100 && !result.sessions[0]?.checkoutObservation; i++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    result = await observer.get();
  }
  return result;
}
test("verified helper reads only its own thread and never inherits parent event", async () => {
  const f = fixture();
  f.options.helpers = {
    children: (parents) => ({
      rows: [
        {
          id: "child",
          provider: "codex",
          source: "helper",
          parentId: parents[0]?.id,
          sessionId: CHILD,
          inspectionIdentity: "helper:child",
          presence: "verified-lineage",
          inventoryHealth: "available",
        },
      ],
      annotations: new Map(),
      overflow: new Map(),
    }),
  };
  const observer = makeObserver(f.options);
  try {
    const result = await flush(observer);
    const child = result.sessions.find((row) => row.id === "child");
    expect(child).toBeDefined();
    expect(child?.checkoutObservation).toBeUndefined();
    expect(f.reads).toEqual([SESSION, CHILD]);
  } finally {
    await observer.close();
  }
});
test("sweep bounds reads to 32 and four concurrent operations without a publication loop", async () => {
  const f = fixture();
  f.options.execute = () =>
    Promise.resolve({
      stdout: JSON.stringify({
        result: {
          agents: Array.from({ length: 40 }, (_, i) => ({
            pane_id: "pane" + String(i),
            agent: "codex",
            cwd: "/terminal",
          })),
        },
      }),
    });
  let reads = 0,
    active = 0,
    peak = 0;
  f.options.workdirs = async () => {
    reads++;
    active++;
    peak = Math.max(peak, active);
    await new Promise<void>((resolve) => setImmediate(resolve));
    active--;
    return null;
  };
  const observer = makeObserver(f.options);
  try {
    await flush(observer);
    await flush(observer);
    expect(reads).toBe(32);
    expect(peak).toBe(4);
  } finally {
    await observer.close();
  }
});
