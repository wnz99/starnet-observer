import { test } from "bun:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveRuntimePaths } from "./runtime-paths.js";

const execute = promisify(execFile);
const repository = fileURLToPath(new URL("../../", import.meta.url));

test("runtime roots honor explicit package and public roots", () => {
  const installRoot = path.join(os.tmpdir(), "synthetic-install");
  assert.deepEqual(resolveRuntimePaths({ installRoot }), {
    installRoot,
    publicRoot: path.join(installRoot, "frontend"),
  });
  const publicRoot = path.join(os.tmpdir(), "synthetic-public");
  assert.deepEqual(resolveRuntimePaths({ installRoot, publicRoot }), { installRoot, publicRoot });
});

test("source defaults ignore caller cwd", async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "observer-paths-"));
  try {
    const module = fileURLToPath(new URL("./runtime-paths.ts", import.meta.url));
    const result = await execute(
      process.execPath,
      [
        "--no-env-file",
        "-e",
        `console.log(JSON.stringify(require(${JSON.stringify(module)}).resolveRuntimePaths()))`,
      ],
      { cwd: folder, timeout: 3000 },
    );
    assert.deepEqual(JSON.parse(result.stdout), {
      installRoot: path.resolve(repository),
      publicRoot: path.join(repository, "frontend"),
    });
  } finally {
    await fs.rm(folder, { recursive: true, force: true });
  }
});

test("compiled defaults derive installed package roots from their emitted location", async () => {
  const folder = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "observer-built-paths-")),
  );
  try {
    const output = path.join(folder, "dist", "runtime");
    await execute(
      process.execPath,
      [
        path.join(repository, "node_modules", "typescript", "bin", "tsc"),
        "--ignoreConfig",
        "--target",
        "ES2022",
        "--module",
        "ESNext",
        "--moduleResolution",
        "Bundler",
        "--types",
        "bun",
        "--skipLibCheck",
        "--rootDir",
        repository,
        "--outDir",
        output,
        path.join(repository, "src", "server", "runtime-paths.ts"),
      ],
      { cwd: repository, timeout: 10000 },
    );
    const module = path.join(output, "src", "server", "runtime-paths.js");
    const result = await execute(
      process.execPath,
      [
        "--no-env-file",
        "-e",
        `console.log(JSON.stringify(require(${JSON.stringify(module)}).resolveRuntimePaths()))`,
      ],
      { cwd: os.tmpdir(), timeout: 3000 },
    );
    assert.deepEqual(JSON.parse(result.stdout), {
      installRoot: folder,
      publicRoot: path.join(folder, "frontend"),
    });
  } finally {
    await fs.rm(folder, { recursive: true, force: true });
  }
});
