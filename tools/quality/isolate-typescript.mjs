// SPDX-License-Identifier: CC0-1.0
import { JSON5 } from "bun";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  access,
  copyFile,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), "../.."));
const [name, mode] = process.argv.slice(2);
if (!name || (mode !== undefined && mode !== "--initialize")) {
  throw new Error("Usage: isolate-typescript.mjs COMPONENT_NAME [--initialize]");
}
const inventory = JSON.parse(await readFile(join(root, ".bootstrap.json"), "utf8"));
if (inventory.baseline !== "wnz-repo-v1") throw new Error("Unsupported baseline");
if (process.versions.bun !== inventory.runtimes.bun)
  throw new Error("Bun runtime does not match the locked input");
const components = new Map();
for (const component of inventory.components.filter((item) => item.language === "typescript")) {
  const path = await realpath(resolve(root, component.path));
  const inside = relative(root, path);
  if (inside.startsWith("..") || isAbsolute(inside))
    throw new Error("Component escapes repository");
  const manifest = JSON.parse(await readFile(join(path, "package.json"), "utf8"));
  if (components.has(manifest.name)) throw new Error("Duplicate TypeScript package name");
  components.set(manifest.name, { component, path, manifest });
}
const selected = [...components.values()].find((item) => item.component.name === name);
if (!selected) throw new Error("Unknown TypeScript component");
if (!selected.component.testDependencies)
  throw new Error("Explicit testDependencies map is required");
for (const [dependency, version] of Object.entries(selected.component.testDependencies)) {
  if (selected.manifest.devDependencies?.[dependency] !== version) {
    throw new Error("Consumer test dependency must match the component's declaration");
  }
}
const environment = { ...process.env };
delete environment.NODE_PATH;
const execute = (program, arguments_, cwd) => {
  const result = spawnSync(program, arguments_, {
    cwd,
    env: environment,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Isolation command failed: ${program} ${arguments_[0]}`);
};
const run = (arguments_, cwd) => execute("bun", arguments_, cwd);
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  }
  return value;
}
const order = [];
const visited = new Set();
const active = new Set();
function visit(packageName, includeTests = false) {
  if (active.has(packageName)) throw new Error("Internal package dependency cycle");
  if (visited.has(packageName)) return;
  const item = components.get(packageName);
  active.add(packageName);
  const dependencies = {
    ...item.manifest.dependencies,
    ...item.manifest.optionalDependencies,
    ...item.manifest.peerDependencies,
    ...(includeTests ? item.component.testDependencies : {}),
  };
  for (const dependency of Object.keys(dependencies).sort()) {
    if (components.has(dependency)) visit(dependency);
  }
  active.delete(packageName);
  visited.add(packageName);
  order.push(item);
}
visit(selected.manifest.name, true);
const sandbox = await realpath(await mkdtemp(join(tmpdir(), "repo-typescript-isolation-")));
environment.BUN_INSTALL_CACHE_DIR = join(sandbox, "cache");
try {
  const inside = relative(root, sandbox);
  if (!isAbsolute(inside) && inside !== ".." && !inside.startsWith(`..${sep}`)) {
    throw new Error("Isolation temporary directory must be outside the workspace");
  }
  // Bun searches ancestor node_modules; refuse a fixture that could inherit one.
  for (let parent = dirname(sandbox); ; parent = dirname(parent)) {
    const exists = await access(join(parent, "node_modules")).then(
      () => true,
      () => false,
    );
    if (exists) throw new Error("Isolation ancestor contains node_modules");
    if (dirname(parent) === parent) break;
  }
  const artifacts = join(sandbox, "artifacts");
  await mkdir(artifacts);
  const overrides = Object.create(null);
  for (const [index, item] of order.entries()) {
    run(["run", "build"], item.path);
    const filename = `package-${index}.tgz`;
    run(["pm", "pack", "--ignore-scripts", "--filename", join(artifacts, filename)], item.path);
    overrides[item.manifest.name] = `file:./artifacts/${filename}`;
  }
  const rootManifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  if (
    selected.component.target === "browser" &&
    typeof selected.manifest.scripts?.["test:isolation"] !== "string"
  ) {
    throw new Error("Browser target requires a declared test:isolation runtime harness");
  }
  const fixture = {
    name: "bootstrap-isolated-consumer",
    private: true,
    type: "module",
    dependencies: {
      [selected.manifest.name]: overrides[selected.manifest.name],
    },
    devDependencies: { ...selected.component.testDependencies },
    scripts:
      selected.component.target === "browser"
        ? { "test:isolation": selected.manifest.scripts?.["test:isolation"] }
        : {},
    overrides: { ...(rootManifest.overrides ?? {}), ...overrides },
    trustedDependencies: rootManifest.trustedDependencies ?? [],
  };
  for (const [dependency, source] of Object.entries(overrides)) {
    if (dependency in fixture.devDependencies) fixture.devDependencies[dependency] = source;
  }
  await writeFile(join(sandbox, "package.json"), `${JSON.stringify(fixture, null, 2)}\n`);
  // Refuse hidden registry policy instead of resolving against a different registry.
  const bunConfiguration = join(root, "bunfig.toml");
  if (
    await access(bunConfiguration).then(
      () => true,
      () => false,
    )
  ) {
    throw new Error(
      "Consumer registry policy must be in .npmrc; bunfig.toml requires a reviewed adapter",
    );
  }
  const registry = join(root, ".npmrc");
  if (
    await access(registry).then(
      () => true,
      () => false,
    )
  )
    await copyFile(registry, join(sandbox, ".npmrc"));
  const identifier = createHash("sha256").update(name).digest("hex");
  const lock = join(root, "quality/isolation", identifier, "consumer.json");
  const manifests = canonical(
    Object.fromEntries(
      order.map((item) => [
        item.manifest.name,
        {
          version: item.manifest.version,
          isolationScript: item.manifest.scripts?.["test:isolation"] ?? null,
          dependencies: item.manifest.dependencies ?? {},
          optionalDependencies: item.manifest.optionalDependencies ?? {},
          peerDependencies: item.manifest.peerDependencies ?? {},
          peerDependenciesMeta: item.manifest.peerDependenciesMeta ?? {},
          bin: item.manifest.bin ?? null,
          os: item.manifest.os ?? null,
          cpu: item.manifest.cpu ?? null,
        },
      ]),
    ),
  );
  if (mode === "--initialize") {
    run(["install"], sandbox);
  } else {
    if (
      !(await access(lock).then(
        () => true,
        () => false,
      ))
    ) {
      throw new Error("Missing consumer lock; run dependency-isolation with --initialize first");
    }
    const saved = JSON.parse(await readFile(lock, "utf8"));
    if (
      saved.format !== 1 ||
      JSON.stringify(canonical(saved.manifests)) !== JSON.stringify(manifests)
    ) {
      throw new Error("Consumer package metadata changed; explicitly reinitialize its lock");
    }
    const localLock = JSON5.parse(saved.lock);
    if (localLock.lockfileVersion !== 1) throw new Error("Unsupported Bun lock format");
    for (const [packageName, path] of Object.entries(overrides)) {
      const entry = localLock.packages[packageName];
      if (!Array.isArray(entry) || entry.length !== 3 || !entry[2].startsWith("sha512-")) {
        throw new Error("Unsupported locked local archive entry; reinitialize with this baseline");
      }
      // Only current build bytes change; the committed dependency graph stays frozen.
      entry[2] = `sha512-${createHash("sha512")
        .update(await readFile(resolve(sandbox, path.slice(5))))
        .digest("base64")}`;
    }
    await writeFile(join(sandbox, "bun.lock"), `${JSON.stringify(localLock, null, 2)}\n`);
    run(["install", "--frozen-lockfile"], sandbox);
  }
  // Runtime imports must succeed without test tools masking missing dependencies.
  await rm(join(sandbox, "node_modules"), { recursive: true, force: true });
  run(["install", "--production", "--frozen-lockfile"], sandbox);
  if (selected.component.artifact === "library") {
    if (selected.component.target === "browser") {
      await writeFile(
        join(sandbox, "consumer.js"),
        `import ${JSON.stringify(selected.manifest.name)};\n`,
      );
      run(["build", "consumer.js", "--target", "browser", "--outdir", "browser-smoke"], sandbox);
    } else {
      const program = selected.component.target === "node" ? "node" : "bun";
      const flags = program === "node" ? ["--input-type=module"] : [];
      execute(
        program,
        [...flags, "--eval", "await import(process.argv[1])", selected.manifest.name],
        sandbox,
      );
    }
  }
  run(["install", "--frozen-lockfile"], sandbox);
  // Consumer tests must use installed package APIs/artifacts, not workspace source.
  await cp(join(selected.path, "tests/isolation"), join(sandbox, "tests/isolation"), {
    recursive: true,
    dereference: false,
    filter: async (path) => {
      if ((await lstat(path)).isSymbolicLink())
        throw new Error("Consumer tests cannot link outside the fixture");
      return true;
    },
  });
  if (selected.component.target === "node") {
    const tests = (await readdir(join(sandbox, "tests/isolation"), { recursive: true }))
      .filter((path) => path.endsWith(".test.mjs"))
      .sort()
      .map((path) => join("tests/isolation", path));
    if (tests.length === 0) throw new Error("Node consumer requires at least one .test.mjs test");
    execute("node", ["--test", ...tests], sandbox);
  } else if (selected.component.target === "browser") {
    run(["run", "test:isolation"], sandbox);
  } else {
    run(["test", "./tests/isolation"], sandbox);
  }
  if (mode === "--initialize") {
    await mkdir(dirname(lock), { recursive: true });
    const transaction = await mkdtemp(join(dirname(lock), ".lock-"));
    try {
      const record = {
        format: 1,
        manifests,
        lock: await readFile(join(sandbox, "bun.lock"), "utf8"),
      };
      await writeFile(
        join(transaction, "consumer.json"),
        `${JSON.stringify(canonical(record), null, 2)}\n`,
      );
      await rename(join(transaction, "consumer.json"), lock);
    } finally {
      await rm(transaction, { recursive: true, force: true });
    }
  }
} finally {
  await rm(sandbox, { recursive: true, force: true });
}
