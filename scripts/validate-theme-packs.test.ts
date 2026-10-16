import { test } from "bun:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
const validator = path.join(import.meta.dirname, "validate-theme-packs.ts");
test("theme validator keeps authored default, explicit root and sanitized failure semantics from another cwd", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "observer-validator-"));
  const run = (args: string[]) =>
    spawnSync(process.execPath, ["--no-env-file", validator, ...args], {
      cwd: root,
      encoding: "utf8",
      timeout: 3000,
    });
  try {
    const authored = run([]);
    assert.equal(authored.status, 0, authored.stderr);
    assert.match(authored.stdout, /^Validated theme packs: .*starnet/);
    const publicRoot = path.resolve(import.meta.dirname, "../dist/public");
    const explicit = run([publicRoot]);
    assert.equal(explicit.status, 0, explicit.stderr);
    assert.equal(explicit.stdout, authored.stdout);
    for (const args of [[root], [root, "extra"]]) {
      const failed = run(args);
      assert.equal(failed.status, 1);
      assert.equal(failed.stderr, "Theme validation failed: installation-unavailable\n");
      assert.equal(failed.stdout, "");
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
