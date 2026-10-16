import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
const repository = path.resolve(import.meta.dir, "..");
const OUTPUT_LIMIT = 16777216,
  COMMAND_TIMEOUT = 600000;
export function command(cwd: string, program: string, args: string[]) {
  const result = spawnSync(program, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: OUTPUT_LIMIT,
    timeout: COMMAND_TIMEOUT,
    env: {
      ...process.env,
      FORCE_COLOR: "0",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_OPTIONAL_LOCKS: "0",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_AUTHOR_NAME: "Package fixture",
      GIT_AUTHOR_EMAIL: "fixture@example.invalid",
      GIT_COMMITTER_NAME: "Package fixture",
      GIT_COMMITTER_EMAIL: "fixture@example.invalid",
    },
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result.stdout + result.stderr;
}
export async function fixture<T>(action: (root: string) => Promise<T>): Promise<T> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "observer-package-"));
  try {
    const files = command(repository, "git", ["ls-files", "-z"]).split("\0").filter(Boolean);
    for (const file of files) {
      assert.ok(!/^\.env(?:\.|$)/.test(file));
      const target = path.join(root, file);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.copyFile(path.join(repository, file), target);
      await fs.chmod(target, (await fs.stat(path.join(repository, file))).mode);
    }
    command(root, "git", ["init", "-q"]);
    await fs.writeFile(path.join(root, ".git/info/exclude"), "/node_modules\n");
    command(root, "git", ["add", "."]);
    command(root, "git", ["-c", "core.hooksPath=/dev/null", "commit", "-qm", "fixture"]);
    command(root, process.execPath, ["--no-env-file", "install", "--frozen-lockfile"]);
    return await action(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}
