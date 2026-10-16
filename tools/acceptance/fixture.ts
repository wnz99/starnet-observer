import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
const DIAGNOSTIC_LIMIT = 4000,
  DIAGNOSTIC_HALF = 2000;
const OUTPUT_LIMIT = 16777216,
  COMMAND_TIMEOUT = 600000;
export const repository = path.resolve(import.meta.dir, "../..");
export function command(
  cwd: string,
  program: string,
  args: string[],
  options: { expected?: number; input?: string } = {},
) {
  const { expected = 0, input } = options;
  const lock = process.env["OBSERVER_ACCEPTANCE_LOCK"];
  const serialize = lock && program !== "git";
  const result = spawnSync(
    serialize ? "flock" : program,
    serialize ? [lock, program, ...args] : args,
    {
      input,
      cwd,
      encoding: "utf8",
      maxBuffer: OUTPUT_LIMIT,
      timeout: COMMAND_TIMEOUT,
      env: {
        ...process.env,
        OBSERVER_ACCEPTANCE_LOCK: serialize ? undefined : lock,
        FORCE_COLOR: "0",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_OPTIONAL_LOCKS: "0",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_AUTHOR_NAME: "Acceptance fixture",
        GIT_AUTHOR_EMAIL: "fixture@example.invalid",
        GIT_COMMITTER_NAME: "Acceptance fixture",
        GIT_COMMITTER_EMAIL: "fixture@example.invalid",
      },
    },
  );
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  const output = result.stdout + result.stderr;
  if (expected === 0) assert.equal(result.status, 0, output);
  else assert.notEqual(result.status, 0, output);
  if (expected !== 0) recordRejection([program, ...args], result.status, output);
  return output;
}
export function bun(cwd: string, args: string[], expected = 0) {
  return command(cwd, process.execPath, ["--no-env-file", ...args], { expected });
}
export async function fixture<T>(action: (root: string) => Promise<T>): Promise<T> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "observer-acceptance-"));
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
    bun(root, ["install", "--frozen-lockfile"]);
    return await action(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}
export async function maintainedDigest(root: string) {
  const files = command(root, "git", ["ls-files", "-z"]).split("\0").filter(Boolean);
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file);
    assert.ok(
      (await fs.lstat(path.join(root, file))).isFile(),
      `Unexpected maintained input: ${JSON.stringify(file)}`,
    );
    hash.update(await fs.readFile(path.join(root, file)));
  }
  const index = command(root, "git", ["rev-parse", "--git-path", "index"]).trim();
  hash.update(await fs.readFile(path.resolve(root, index)));
  hash.update(command(root, "git", ["status", "--porcelain"]));
  return hash.digest("hex");
}

function recordRejection(invocation: string[], status: number | null, output: string) {
  console.log(
    JSON.stringify({
      command: invocation,
      status,
      diagnostic:
        output.length > DIAGNOSTIC_LIMIT
          ? output.slice(0, DIAGNOSTIC_HALF) + "\n...bounded...\n" + output.slice(-DIAGNOSTIC_HALF)
          : output,
    }),
  );
}
