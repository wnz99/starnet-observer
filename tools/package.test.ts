import { test } from "bun:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { distributableInput, stageInputs } from "./package.js";
const execute = promisify(execFile);
test("tracked package staging excludes synthetic ignored private and generated inputs", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "observer-package-test-"));
  try {
    await execute("git", ["init", "-q", root]);
    const files = [
      "src/server/main.ts",
      "frontend/observer.html",
      "frontend/assets/themes/starnet/theme.json",
      "LICENSE",
      "NOTICE.md",
      "package.json",
    ];
    for (const file of files) {
      await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
      await fs.writeFile(path.join(root, file), "canonical");
    }
    await execute("git", ["add", "."], { cwd: root });
    for (const file of [
      "observer.config.json",
      "rooms.json",
      ".env",
      "frontend/assets/themes/private/theme.json",
      "dist/public/private.txt",
      "themes/private.json",
      ".planning/reference.png",
    ]) {
      await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
      await fs.writeFile(path.join(root, file), "SYNTHETIC_PRIVATE_SENTINEL");
      assert.equal(distributableInput(file), false);
    }
    const target = path.join(root, "stage");
    assert.deepEqual(await stageInputs(root, target), files.sort());
    assert.deepEqual((await fs.readdir(target)).sort(), [
      "LICENSE",
      "NOTICE.md",
      "frontend",
      "package.json",
      "src",
    ]);
    await fs.rename(path.join(root, "src"), path.join(root, "aliased-source"));
    await fs.symlink("aliased-source", path.join(root, "src"));
    await assert.rejects(
      stageInputs(root, path.join(root, "unsafe-stage")),
      /Unsafe package input/,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
import { fixture, command } from "./acceptance/fixture.js";
import { packageApplication } from "./package.js";
test("clean archive excludes disposable private sentinels and preserves executable resources", async () => {
  await fixture(async (root) => {
    for (const file of [
      "dist/public/assets/themes/private/sentinel.txt",
      "observer.config.json",
      "rooms.json",
      ".env",
      "frontend/assets/themes/private/theme.json",
      "themes/private.json",
      ".planning/reference.png",
    ]) {
      await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
      await fs.writeFile(path.join(root, file), "SYNTHETIC_PRIVATE_SENTINEL");
    }
    const archive = await packageApplication(root);
    const inventory = command(root, "tar", ["tzf", archive]);
    assert.ok(
      !/private|reference|observer\.config|rooms\.json|\.env|node_modules|\.planning|\.test\.|\.fixture\./.test(
        inventory,
      ),
      inventory,
    );
    for (const file of [
      "package/dist/runtime/src/server/main.js",
      "package/dist/runtime/src/server/http.js",
      "package/dist/runtime/src/sidecar/sqlite/worker.js",
      "package/dist/runtime/src/sidecar/desktop/observer-desktop-macos.swift",
      "package/dist/public/observer.html",
      "package/LICENSE",
      "package/NOTICE.md",
    ])
      assert.ok(inventory.includes(file), file);
    assert.match(command(root, "tar", ["tvzf", archive]), /-rwxr-xr-x.*src\/server\/main\.js/);
    const binary = command(root, "tar", [
      "xOzf",
      archive,
      "package/dist/runtime/src/server/main.js",
    ]);
    assert.match(binary, /^#!\/usr\/bin\/env -S bun --no-env-file/);
    await fs.unlink(archive);
    await fs.symlink(path.join(root, "LICENSE"), archive);
    await assert.rejects(packageApplication(root), /Unsafe package archive/);
  });
}, 60000);
