import {
  policyBytes,
  recordedPolicyInput,
  validateInventory,
  validateSkillName,
} from "./record-contract.js";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { command, repository } from "./acceptance/fixture.js";
const JSON_INDENT = 2;
const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}
async function skillFiles(folder: string, prefix = ""): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
    const relative = path.join(prefix, entry.name);
    if (/(?:^|\/)(?:\.cache|cache|__pycache__)(?:\/|$)|\.pyc$/.test(relative)) continue;
    assert.ok(!entry.isSymbolicLink(), `Unsafe skill input: ${relative}`);
    if (entry.isDirectory())
      files.push(...(await skillFiles(path.join(folder, entry.name), relative)));
    else if (entry.isFile()) files.push(relative);
  }
  return files;
}
export async function skillDigest(sharedRoot: string, name: string): Promise<string> {
  validateSkillName(name);
  const root = path.resolve(sharedRoot),
    folder = path.join(root, name);
  assert.equal(await fs.realpath(root), root, "Unsafe shared skill root");
  const info = await fs.lstat(folder);
  assert.ok(
    info.isDirectory() && !info.isSymbolicLink() && (await fs.realpath(folder)) === folder,
    "Unsafe skill directory",
  );
  const files = (await skillFiles(folder)).sort();
  const entries = await Promise.all(
    files.map(async (file) => `${file}\0${sha(await fs.readFile(path.join(folder, file)))}\n`),
  );
  return sha(entries.join(""));
}
export async function writeRecords() {
  const inventory = JSON.parse(
    await fs.readFile(path.join(repository, ".bootstrap.json"), "utf8"),
  ) as {
    baseline: string;
    runtimes: unknown;
    skills: { name: string; revision: unknown; digest: string; discovery: { location: string } }[];
  };
  validateInventory(
    inventory,
    JSON.parse(await fs.readFile(path.join(repository, "package.json"), "utf8")) as unknown,
  );
  const skills: Record<string, unknown> = {};
  for (const skill of inventory.skills) {
    skill.digest = await skillDigest(path.join(os.homedir(), ".agents/skills"), skill.name);
    skills[skill.name] = { revision: skill.revision, digest: skill.digest };
  }
  await fs.writeFile(
    path.join(repository, ".bootstrap.json"),
    JSON.stringify(canonical(inventory), null, JSON_INDENT) + "\n",
  );
  const manifest = JSON.parse(await fs.readFile(path.join(repository, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies: Record<string, string>;
  };
  const tracked = command(repository, "git", ["ls-files", "-z"])
    .split("\0")
    .filter(recordedPolicyInput);
  const files: Record<string, string> = {};
  for (const file of tracked.sort()) files[file] = sha(await policyBytes(repository, file));
  const record = {
    baseline: inventory.baseline,
    specificationSha256: sha(await policyBytes(repository, "docs/bootstrap-records.md")),
    runtimes: inventory.runtimes,
    dependencies: { "package.json": { ...manifest.dependencies, ...manifest.devDependencies } },
    skills,
    files,
  };
  await fs.writeFile(
    path.join(repository, ".bootstrap-lock.json"),
    JSON.stringify(canonical(record), null, JSON_INDENT) + "\n",
  );
}
if (import.meta.main) await writeRecords();
