import { policyBytes, recordedPolicyInput, validateInventory } from "../record-contract.js";
import type { InventoryRecord, LockRecord } from "../record-contract.js";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { command, fixture, repository, maintainedDigest } from "./fixture.js";
const digest = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const LICENSE = "LICENSE",
  NOTICE = "NOTICE.md";
async function documentCorpus(root: string) {
  const index = await fs.readFile(path.join(root, "docs/index.md"), "utf8");
  assert.ok(!index.startsWith("---"));
  for (const file of await fs.readdir(path.join(root, "docs"))) {
    if (!file.endsWith(".md") || file === "index.md") continue;
    const source = await fs.readFile(path.join(root, "docs", file), "utf8");
    const front = /^---\n([\s\S]*?)\n---/.exec(source);
    assert.ok(front?.[1], file);
    const parsed = Bun.YAML.parse(front[1]) as Record<string, unknown>;
    for (const key of ["type", "title", "description"])
      assert.ok(typeof parsed[key] === "string" && parsed[key].length > 0, file);
    assert.ok(index.includes(`(${file})`), `Missing index entry: ${file}`);
    for (const match of source.matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/g)) {
      const target = match[1];
      assert.ok(target);
      if (/^(?:https?:|app:)/.test(target)) continue;
      await fs.access(path.resolve(root, "docs", target));
    }
  }
}
export async function docsProbe(root = repository) {
  await documentCorpus(root);
  assert.match(await fs.readFile(path.join(root, LICENSE), "utf8"), /MIT License/);
  assert.ok((await fs.stat(path.join(root, NOTICE))).size > 0);
  const inventory: unknown = JSON.parse(
    await fs.readFile(path.join(root, ".bootstrap.json"), "utf8"),
  );
  const manifest: unknown = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
  validateInventory(inventory, manifest);
  const lock = JSON.parse(
    await fs.readFile(path.join(root, ".bootstrap-lock.json"), "utf8"),
  ) as LockRecord;
  await verifyRecord(root, inventory, lock);
  await verifySources(root, inventory);
  return "parsed YAML, index, links, license, schema, pending options and exact bootstrap digests verified";
}
async function verifyRecord(root: string, inventory: InventoryRecord, lock: LockRecord) {
  assert.deepEqual(
    Object.keys(lock).sort(),
    ["baseline", "specificationSha256", "runtimes", "dependencies", "skills", "files"].sort(),
  );
  assert.equal(lock.baseline, inventory.baseline);
  assert.deepEqual(lock.runtimes, inventory.runtimes);
  assert.equal(
    lock.specificationSha256,
    digest(await policyBytes(root, "docs/bootstrap-records.md")),
  );
  assert.deepEqual(
    lock.skills,
    Object.fromEntries(
      inventory.skills.map((skill) => [
        skill.name,
        { revision: skill.revision, digest: skill.digest },
      ]),
    ),
  );
  const recorded = command(root, "git", ["ls-files", "-z"])
    .split("\0")
    .filter(recordedPolicyInput)
    .sort();
  assert.deepEqual(Object.keys(lock.files).sort(), recorded);
  for (const [file, expected] of Object.entries(lock.files))
    assert.equal(digest(await policyBytes(root, file)), expected, file);
  assert.deepEqual(Object.keys(lock.dependencies), ["package.json"]);
  for (const [file, expected] of Object.entries(lock.dependencies)) {
    const manifest = JSON.parse(await fs.readFile(path.join(root, file), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    assert.deepEqual({ ...manifest.dependencies, ...manifest.devDependencies }, expected);
  }
}
async function verifySources(root: string, inventory: InventoryRecord) {
  for (const component of inventory.components)
    for (const entry of component.entrypoints) await fs.access(path.join(root, entry));
  const workflow = await fs.readFile(path.join(root, ".github/workflows/check.yml"), "utf8");
  for (const revision of Object.values(inventory.ci.actionRevisions))
    assert.ok(workflow.includes(revision));
}
export async function replayProbe() {
  return fixture(async (root) => {
    const before = await fs.readFile(path.join(root, ".bootstrap-lock.json"));
    command(root, "sh", ["tools/quality/setup.sh"]);
    const sourceState = await maintainedDigest(root);
    const hookState = command(root, "git", ["config", "--worktree", "--get-all", "core.hooksPath"]);
    command(root, "sh", ["tools/quality/setup.sh"]);
    assert.equal(await maintainedDigest(root), sourceState);
    assert.equal(
      command(root, "git", ["config", "--worktree", "--get-all", "core.hooksPath"]),
      hookState,
    );
    assert.deepEqual(await fs.readFile(path.join(root, ".bootstrap-lock.json")), before);
    const file = path.join(root, ".prettierrc.json"),
      edited = (await fs.readFile(file, "utf8")) + "\n";
    await fs.writeFile(file, edited);
    command(root, "sh", ["tools/quality/setup.sh"]);
    assert.equal(await fs.readFile(file, "utf8"), edited);
    await assert.rejects(docsProbe(root), /prettierrc/);
    console.log("Preserved and reported generated-file drift: .prettierrc.json");
    return "repeat setup preserves lock and generated edits; digest validation reports local drift";
  });
}
