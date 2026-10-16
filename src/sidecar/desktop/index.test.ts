import { test } from "bun:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { makeDesktopObserver } from "./index.js";
import type { Execute } from "./cache.js";

test("observer-desktop regression contracts", async () => {
  const identity = {
    bundleId: "com.openai.codex",
    pid: 17,
    processStart: "1234.567890",
    windowId: 21,
  };

  assert.throws(() => makeDesktopObserver(), /injected now/);
  const clock = 1000;
  const unsupported = makeDesktopObserver({
    now: () => clock,
    platform: "linux",
    execute: () => {
      throw Error("must not run");
    },
  });
  assert.equal((await unsupported.inventory()).health, "unavailable");
  const temp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "observer-desktop-")));
  await fs.chmod(temp, 0o700);
  try {
    let compilations = 0,
      probes = 0,
      inspections = 0,
      mode = "good";
    let held = false;
    let release: () => void = () => {
      throw new Error("inspection not held");
    };
    let started: () => void = () => {
      throw new Error("inspection not admitted");
    };
    let fixtureExecute: Execute;
    const inspectionStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    function inventoryAvailability(fixtureMode: string) {
      if (fixtureMode === "mapping-unavailable")
        return {
          stdout: JSON.stringify({
            health: "available",
            reason: "window-mapping-unavailable",
            windows: [],
          }),
        };
      if (fixtureMode === "duplicate")
        return {
          stdout: JSON.stringify({ health: "available", windows: [identity, identity] }),
        };
      if (fixtureMode === "too-many")
        return {
          stdout: JSON.stringify({
            health: "available",
            windows: Array.from({ length: 17 }, () => identity),
          }),
        };
      if (fixtureMode === "denied")
        return {
          stdout: JSON.stringify({
            health: "unavailable",
            reason: "permission-denied",
            windows: [],
          }),
        };
      return undefined;
    }
    function inventoryIdentity(fixtureMode: string) {
      if (fixtureMode === "malformed")
        return {
          stdout: JSON.stringify({
            health: "available",
            windows: [{ ...identity, pid: -1 }],
          }),
        };
      if (fixtureMode === "disabled-chatgpt" || fixtureMode === "disabled-claude")
        return {
          stdout: JSON.stringify({
            health: "available",
            windows: [
              {
                ...identity,
                bundleId:
                  fixtureMode === "disabled-chatgpt"
                    ? "com.openai.ChatGPT"
                    : "com.anthropic.claudefordesktop",
              },
            ],
          }),
        };
      if (fixtureMode === "not-allowlisted")
        return {
          stdout: JSON.stringify({
            health: "available",
            windows: [{ ...identity, bundleId: "private.app" }],
          }),
        };
      return undefined;
    }
    function inventoryFixture(fixtureMode: string) {
      const failure = inventoryAvailability(fixtureMode) ?? inventoryIdentity(fixtureMode);
      if (failure) return failure;
      return {
        stdout: JSON.stringify({
          health: "available",
          reason: null,
          windows: [
            {
              ...identity,
              processStart: fixtureMode === "reused" ? "9999.000000" : identity.processStart,
              windowId: fixtureMode === "window-reused" ? 22 : identity.windowId,
            },
          ],
        }),
      };
    }
    function inspectionFixture() {
      if (mode === "stdout-oversized") return { stdout: "x".repeat(262145) };
      if (mode === "timeout") throw Error("SECRET stderr timeout");
      return {
        stdout: JSON.stringify({
          health: "available",
          identity: mode === "changed" ? { ...identity, windowId: 22 } : identity,
          text:
            mode === "clipped"
              ? ["x".repeat(7990) + ' password="boundary canary"']
              : mode === "oversized"
                ? ["x".repeat(131073)]
                : mode === "empty"
                  ? []
                  : [
                      'Loaded excerpt password="private canary" sk-ant-123456789ABC',
                      "Model: 42 Tokens: 123",
                    ],
          truncated: false,
        }),
      };
    }
    const observer = makeDesktopObserver({
      now: () => clock,
      platform: "darwin",
      cacheDir: temp,
      execute: (fixtureExecute = async (command, args, settings) => {
        if (command === "swiftc" && args[0] === "--version") return { stdout: "fixture Swift 6" };
        if (command === "swiftc") {
          assert.equal(settings.timeout, 30000);
          compilations++;
          await fs.writeFile(
            args[args.indexOf("-o") + 1] ??
              (() => {
                throw new Error("missing output");
              })(),
            "fixture binary",
            { mode: 0o700 },
          );
          return { stdout: "" };
        }
        assert.equal(settings.timeout, 2000);
        assert.equal(settings.maxBuffer, 262144);
        if (args[0] === "inventory") {
          probes++;
          return inventoryFixture(mode);
        }
        assert.equal(args[0], "inspect");
        inspections++;
        assert.deepEqual(args.slice(1), [identity.bundleId, "17", identity.processStart, "21"]);
        if (held)
          await new Promise<void>((resolve) => {
            release = resolve;
            started();
          });
        return inspectionFixture();
      }),
    });
    const cold = await observer.inventory();
    assert.equal(cold.reason, "native-reader-building");
    async function settled(reader: ReturnType<typeof makeDesktopObserver>) {
      for (let attempt = 0; attempt < 100; attempt++) {
        const value = await reader.inventory();
        if (value.reason !== "native-reader-building") return value;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      throw Error("fixture build did not settle");
    }
    const a = await settled(observer),
      b = await observer.inventory();
    assert.equal(compilations, 1);
    assert.equal(inspections, 0, "inventory never reads bodies");
    assert(a.windows[0]);
    assert(b.windows[0]);
    assert.equal(a.windows[0].id, b.windows[0].id);
    assert.equal(a.windows[0].sessionId, null);
    assert.equal(a.windows[0].projectId, "desktop");
    assert.equal(a.windows[0].presence, "window");
    assert(!JSON.stringify(a).includes("processStart"));
    assert(!JSON.stringify(a).includes("Loaded excerpt"));
    const row = a.windows[0],
      one = await observer.inspect(row.inspectionIdentity),
      two = await observer.inspect(row.inspectionIdentity);
    assert.equal(one.health, "available");
    assert.equal(one.provenance?.coverage, "partial-loaded-ui");
    assert(one.turns.every((turn) => turn.role === "unknown"));
    assert.notEqual(one.generation, two.generation);
    assert(Object.values(one.stats).every((field) => field.state === "unavailable"));
    assert(!JSON.stringify(one).includes("private canary"));
    assert(!JSON.stringify(one).includes("123456789ABC"));
    mode = "clipped";
    const clipped = await observer.inspect(row.inspectionIdentity);
    assert.equal(clipped.health, "available");
    assert(clipped.turns[0]);
    const firstText = clipped.turns[0].text;
    assert.equal(firstText.length, 8000);
    assert(clipped.truncated);
    assert(
      !JSON.stringify(clipped).includes("boundary canary"),
      "redaction precedes clipping at the display boundary",
    );
    mode = "stdout-oversized";
    assert.equal((await observer.inspect(row.inspectionIdentity)).health, "unavailable");
    mode = "oversized";
    assert.equal((await observer.inspect(row.inspectionIdentity)).reason, "loaded-ui-unavailable");
    mode = "empty";
    assert.equal((await observer.inspect(row.inspectionIdentity)).reason, "loaded-ui-unavailable");
    mode = "changed";
    assert.equal((await observer.inspect(row.inspectionIdentity)).health, "unavailable");
    mode = "timeout";
    assert.equal((await observer.inspect(row.inspectionIdentity)).health, "unavailable");
    mode = "good";
    held = true;
    const late = observer.inspect(row.inspectionIdentity);
    await inspectionStarted;
    mode = "reused";
    const reused = await observer.inventory();
    assert(reused.windows[0]);
    assert.notEqual(reused.windows[0].id, row.id);
    release();
    held = false;
    assert.equal((await late).health, "unavailable");
    for (mode of [
      "denied",
      "malformed",
      "not-allowlisted",
      "disabled-chatgpt",
      "disabled-claude",
      "too-many",
      "duplicate",
    ]) {
      const denied = await observer.inventory();
      assert.equal(denied.health, "unavailable");
      assert.deepEqual(denied.windows, []);
      assert(!JSON.stringify(denied).includes("SECRET"));
    }
    mode = "window-reused";
    const nextWindow = (await observer.inventory()).windows[0];
    assert(nextWindow);
    assert.notEqual(
      nextWindow.id,
      row.id,
      "new native window ID cannot reuse old inspector identity",
    );
    mode = "mapping-unavailable";
    const unmapped = await observer.inventory();
    assert.equal(unmapped.health, "available");
    assert.equal(unmapped.reason, "window-mapping-unavailable");
    assert.deepEqual(unmapped.windows, []);
    assert.equal((await observer.inspect(row.inspectionIdentity)).reason, "identity-unavailable");
    assert.equal(compilations, 1);
    assert(probes > 1);
    mode = "good";
    const cached = makeDesktopObserver({
      now: () => clock,
      platform: "darwin",
      cacheDir: temp,
      execute: fixtureExecute,
    });
    assert.equal((await settled(cached)).health, "available");
    assert.equal(compilations, 1, "a new owner reuses the source/toolchain-keyed binary");
    const executable = path.join(
      temp,
      (await fs.readdir(temp)).find((name) => name.endsWith(".native")) ??
        (() => {
          throw new Error("missing executable");
        })(),
    );
    await fs.chmod(executable, 0o755);
    assert.equal((await cached.inventory()).health, "unavailable");
    await fs.chmod(executable, 0o700);
    const savedExecutable = executable + ".saved";
    await fs.rename(executable, savedExecutable);
    await fs.symlink(savedExecutable, executable);
    assert.equal((await cached.inventory()).health, "unavailable");
    await fs.unlink(executable);
    await fs.rename(savedExecutable, executable);
    const alias = path.join(temp, "alias");
    await fs.symlink(temp, alias);
    const aliased = makeDesktopObserver({
      now: () => clock,
      platform: "darwin",
      cacheDir: alias,
      execute: fixtureExecute,
    });
    assert.equal((await settled(aliased)).health, "unavailable");
    // Unsafe cache roots and failed builds never run a native probe; build failure is sticky.
    const unsafe = path.join(temp, "unsafe");
    await fs.mkdir(unsafe, { mode: 0o755 });
    let calls = 0;
    const rejected = makeDesktopObserver({
      now: () => clock,
      platform: "darwin",
      cacheDir: unsafe,
      execute: () => {
        calls++;
        throw Error("secret");
      },
    });
    assert.equal((await settled(rejected)).health, "unavailable");
    assert.equal(calls, 0);
    const failedDir = path.join(temp, "failed");
    const failed = makeDesktopObserver({
      now: () => clock,
      platform: "darwin",
      cacheDir: failedDir,
      execute: () => {
        calls++;
        throw Error("private compiler");
      },
    });
    await settled(failed);
    const attempts = calls;
    await failed.inventory();
    assert.equal(calls, attempts);
    const buildFailedDir = path.join(temp, "build-failed");
    let builds = 0;
    const buildFailed = makeDesktopObserver({
      now: () => clock,
      platform: "darwin",
      cacheDir: buildFailedDir,
      execute: (_command, args) => {
        if (args[0] === "--version") return Promise.resolve({ stdout: "fixture Swift" });
        builds++;
        throw Error("private build error");
      },
    });
    assert.equal((await settled(buildFailed)).reason, "native-reader-unavailable");
    assert.equal(builds, 1);
    assert.deepEqual(
      await fs.readdir(buildFailedDir),
      [],
      "failed compile removes exclusive temporary output",
    );
    console.log(
      "observer desktop: compile-once, private cache, allowlist, independent identity, unknown partial evidence, redaction, reuse and late withdrawal OK",
    );
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}, 30000);
