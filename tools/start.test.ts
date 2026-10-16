import { test } from "bun:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fixtureFile } from "./start.fixture.js";
import { requiredHttpValue } from "../src/server/http.fixture.js";
async function waitFile(file: string) {
  const deadline = Date.now() + 3000;
  for (;;) {
    try {
      return await fs.readFile(file, "utf8");
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      assert(Date.now() < deadline, "fixture readiness deadline");
      await Bun.sleep(5);
    }
  }
}
async function fixture(env: NodeJS.ProcessEnv) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "observer-start-")));
  await fs.writeFile(path.join(root, ".env"), "STARNET_FIXTURE_DOTENV=must-not-load\n");
  const caller = path.join(root, "caller");
  await fs.mkdir(caller);
  await fs.writeFile(path.join(caller, ".env"), "STARNET_FIXTURE_DOTENV=must-not-load\n");
  const child = spawn(process.execPath, ["--no-env-file", fixtureFile, "runner", root], {
    env: { ...process.env, ...env },
    cwd: caller,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output: Buffer[] = [],
    errors: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => output.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => errors.push(chunk));
  const exited = new Promise<number | null>((resolve, reject) => {
    child.once("exit", resolve);
    child.once("error", reject);
  });
  const deadline = setTimeout(() => child.kill("SIGKILL"), 5000);
  return {
    root,
    child,
    exited,
    output,
    errors,
    async close() {
      clearTimeout(deadline);
      if (child.exitCode === null) child.kill("SIGKILL");
      await exited;
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}
test("launcher builds first, forwards args/environment, disables dotenv, and propagates child exits", async () => {
  for (const buildCode of [0, 7]) {
    const run = await fixture({
      STARNET_FIXTURE_BUILD_CODE: String(buildCode),
      STARNET_FIXTURE_EXIT_CODE: "6",
      STARNET_FIXTURE_EXPORTED: "kept",
    });
    try {
      assert.equal(await run.exited, buildCode || 6, Buffer.concat(run.errors).toString());
      assert.match(Buffer.concat(run.output).toString(), /fixture build/);
      assert.equal(await fs.readFile(path.join(run.root, "build-cwd"), "utf8"), run.root);
      if (buildCode)
        await assert.rejects(fs.access(path.join(run.root, "started")), { code: "ENOENT" });
      else {
        const started: unknown = JSON.parse(await waitFile(path.join(run.root, "started")));
        assert.deepEqual(started, {
          args: [
            "--no-env-file",
            path.join(run.root, "dist/runtime/src/server/main.js"),
            "--presentation",
            "--config",
            "has spaces.json",
          ],
          cwd: path.join(run.root, "caller"),
          exported: "kept",
          dotenv: null,
        });
      }
    } finally {
      await run.close();
    }
  }
});
test("parent and terminal-group signals reach child once and await asynchronous shutdown", async () => {
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    for (const group of [false, true]) {
      const run = await fixture({ STARNET_FIXTURE_WAIT: "1" });
      try {
        await waitFile(path.join(run.root, "started"));
        process.kill((group ? -1 : 1) * requiredHttpValue(run.child.pid), signal);
        assert.equal(
          await run.exited,
          0,
          signal + " group=" + String(group) + ": " + Buffer.concat(run.errors).toString(),
        );
        assert.equal(await fs.readFile(path.join(run.root, "signals"), "utf8"), signal + "\n");
        assert.equal(await fs.readFile(path.join(run.root, "closed"), "utf8"), "observer closed");
      } finally {
        await run.close();
      }
    }
});

test("launcher propagates signal exits and does not start main after interrupted build", async () => {
  for (const build of [false, true]) {
    const run = await fixture(
      build ? { STARNET_FIXTURE_BUILD_WAIT: "1" } : { STARNET_FIXTURE_SELF_SIGNAL: "SIGTERM" },
    );
    try {
      if (build) {
        await waitFile(path.join(run.root, "building"));
        run.child.kill("SIGTERM");
      }
      assert.equal(await run.exited, 143, Buffer.concat(run.errors).toString());
      if (build)
        await assert.rejects(fs.access(path.join(run.root, "started")), { code: "ENOENT" });
    } finally {
      await run.close();
    }
  }
});
