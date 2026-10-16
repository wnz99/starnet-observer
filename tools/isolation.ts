// SPDX-License-Identifier: CC0-1.0
import assert from "node:assert/strict";
import { JSON5, TOML } from "bun";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  access,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const JSON_INDENT = 2,
  ARCHIVE_INTEGRITY_INDEX = 2;
const root = await realpath(resolve(import.meta.dir, ".."));
const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as {
  packageManager: string;
  devDependencies: { "@playwright/test": string };
};
if (`bun@${process.versions.bun}` !== manifest.packageManager)
  throw new Error("Bun runtime does not match packageManager");
const environment = { ...process.env };
delete environment.NODE_PATH;
function run(args: string[], cwd: string) {
  const result = spawnSync(process.execPath, args, { cwd, env: environment, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Isolation command failed: bun ${args[0] ?? ""}`);
}
async function checkSandbox(sandbox: string) {
  const inside = relative(root, sandbox);
  if (!isAbsolute(inside) && inside !== ".." && !inside.startsWith(`..${sep}`))
    throw new Error("Isolation temporary directory must be outside the workspace");
  // Bun searches ancestor node_modules; refuse inherited dependencies.
  for (let parent = dirname(sandbox); ; parent = dirname(parent)) {
    const exists = await access(join(parent, "node_modules")).then(
      () => true,
      () => false,
    );
    if (exists) throw new Error("Isolation ancestor contains node_modules");
    if (dirname(parent) === parent) break;
  }
}
async function configureSandbox(sandbox: string) {
  // Refuse hidden registry policy instead of resolving against a different registry.
  assert.deepEqual(TOML.parse(await readFile(join(root, "bunfig.toml"), "utf8")), {
    env: false,
    test: { pathIgnorePatterns: ["dist/**", "package-staging/**"] },
  });
  await writeFile(join(sandbox, "bunfig.toml"), "env = false\n");
  const registry = join(root, ".npmrc");
  if (
    await access(registry).then(
      () => true,
      () => false,
    )
  )
    await copyFile(registry, join(sandbox, ".npmrc"));
  const fixture = {
    name: "bootstrap-isolated-consumer",
    private: true,
    type: "module",
    dependencies: { "starnet-observer": "file:./artifacts/package-0.tgz" },
    devDependencies: { "@playwright/test": manifest.devDependencies["@playwright/test"] },
    overrides: { "starnet-observer": "file:./artifacts/package-0.tgz" },
  };
  await writeFile(join(sandbox, "package.json"), `${JSON.stringify(fixture, null, JSON_INDENT)}\n`);
  const lock = JSON5.parse(
    await readFile(join(root, "tools/fixtures/consumer/bun.lock"), "utf8"),
  ) as {
    packages: { "starnet-observer": [string, object, string] };
  };
  // Only current archive bytes change; the committed dependency graph stays frozen.
  lock.packages["starnet-observer"][ARCHIVE_INTEGRITY_INDEX] = `sha512-${createHash("sha512")
    .update(await readFile(join(sandbox, "artifacts/package-0.tgz")))
    .digest("base64")}`;
  await writeFile(join(sandbox, "bun.lock"), `${JSON.stringify(lock, null, JSON_INDENT)}\n`);
}
const consumers = [
  "src/server/application.consumer.test.ts",
  "src/browser/application.consumer.test.ts",
];
async function copyConsumers(sandbox: string) {
  // Only these actual owners enter the sandbox. Reject links at every path component.
  for (const source of consumers) {
    let current = root;
    for (const part of source.split("/")) {
      current = join(current, part);
      if ((await lstat(current)).isSymbolicLink())
        throw new Error("Consumer sources cannot be symlinks");
    }
    await mkdir(dirname(join(sandbox, source)), { recursive: true });
    await copyFile(join(root, source), join(sandbox, source));
  }
}
const sandbox = await realpath(await mkdtemp(join(tmpdir(), "observer-isolation-")));
environment.BUN_INSTALL_CACHE_DIR = join(sandbox, "cache");
try {
  await checkSandbox(sandbox);
  run(["--no-env-file", "run", "package"], root);
  await mkdir(join(sandbox, "artifacts"));
  await copyFile(join(root, "dist/starnet-observer.tgz"), join(sandbox, "artifacts/package-0.tgz"));
  await configureSandbox(sandbox);
  await copyConsumers(sandbox);
  // Runtime imports must succeed before test tools can mask missing dependencies.
  run(["--no-env-file", "install", "--production", "--frozen-lockfile"], sandbox);
  environment.OBSERVER_ISOLATED_CONSUMER = "1";
  environment.OBSERVER_PRODUCTION_ONLY = "1";
  run(["--no-env-file", "test", "./src/server/application.consumer.test.ts"], sandbox);
  delete environment.OBSERVER_PRODUCTION_ONLY;
  console.log("PASS production-only installed application before test dependencies");
  run(["--no-env-file", "install", "--frozen-lockfile"], sandbox);
  run(["--no-env-file", "test", ...consumers.map((source) => "./" + source)], sandbox);
} finally {
  await rm(sandbox, { recursive: true, force: true });
}
