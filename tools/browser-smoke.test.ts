import { test } from "bun:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
test("browser command forwards actual runner failure and success", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "observer-browser-command-"));
  try {
    await fs.mkdir(path.join(root, "tools"));
    await fs.mkdir(path.join(root, "src/browser"), { recursive: true });
    await fs.copyFile(
      path.join(import.meta.dir, "browser-smoke.ts"),
      path.join(root, "tools/browser-smoke.ts"),
    );
    for (const expected of [1, 0]) {
      await fs.writeFile(
        path.join(root, "src/browser/application.consumer.test.ts"),
        `import {test,expect} from 'bun:test'; test('browser command result',()=>{expect(1).toBe(${String(expected === 0 ? 1 : 2)});});`,
      );
      const result = spawnSync(
        process.execPath,
        ["--no-env-file", path.join(root, "tools/browser-smoke.ts")],
        { cwd: root, encoding: "utf8", timeout: 10000 },
      );
      assert.ifError(result.error);
      assert.equal(result.status, expected, result.stdout + result.stderr);
      assert.match(result.stdout + result.stderr, /browser command result/);
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
