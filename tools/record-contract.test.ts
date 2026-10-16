import { test } from "bun:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { policyBytes, validateInventory } from "./record-contract.js";
import { skillDigest } from "./records.js";

test("record inputs refuse final and ancestor aliases before reading bytes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "observer-records-"));
  try {
    const target = path.join(root, "public-policy");
    await fs.mkdir(target);
    await fs.writeFile(path.join(target, "policy.ts"), "synthetic public policy");
    await fs.symlink(target, path.join(root, "tools"));
    await assert.rejects(policyBytes(root, "tools/policy.ts"), /Unsafe policy input/);
    await fs.unlink(path.join(root, "tools"));
    await fs.mkdir(path.join(root, "tools"));
    await fs.symlink(path.join(target, "policy.ts"), path.join(root, "tools/policy.ts"));
    await assert.rejects(policyBytes(root, "tools/policy.ts"), /Unsafe policy input/);
    await assert.rejects(policyBytes(root, "tools/../.env"), /Unrecorded policy input/);
    await fs.unlink(path.join(root, "tools/policy.ts"));
    await fs.writeFile(path.join(root, "tools/policy.ts"), "synthetic public policy");
    assert.equal(
      new TextDecoder().decode(await policyBytes(root, "tools/policy.ts")),
      "synthetic public policy",
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("inventory rejects unknown structure and contradictory runtime or harness pins", async () => {
  const inventory = JSON.parse(
    await fs.readFile(new URL("../.bootstrap.json", import.meta.url), "utf8"),
  ) as Record<string, unknown>;
  const manifest: unknown = JSON.parse(
    await fs.readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  validateInventory(inventory, manifest);
  assert.throws(() => {
    validateInventory({ ...inventory, unexpected: true }, manifest);
  });
  const badRuntime = structuredClone(inventory);
  (badRuntime.runtimes as Record<string, unknown>).bun = "0.0.0";
  assert.throws(() => {
    validateInventory(badRuntime, manifest);
  });
  const badHarness = structuredClone(inventory);
  const components = badHarness.components;
  assert.ok(components[0]);
  components[0].testDependencies["@playwright/test"] = "0.0.0";
  assert.throws(() => {
    validateInventory(badHarness, manifest);
  });
  const badDetails: Record<string, unknown> = structuredClone(inventory);
  const options = badDetails.options as Record<string, { details: Record<string, unknown> }>;
  assert.ok(options.semanticMcp);
  options.semanticMcp.details.typoKey = true;
  assert.throws(() => {
    validateInventory(badDetails, manifest);
  });
  const badSkill = structuredClone(inventory);
  const [skill] = badSkill.skills;
  assert.ok(skill);
  skill.name = "../../private";
  skill.discovery.location = "~/.agents/skills/../../private";
  assert.throws(() => {
    validateInventory(badSkill, manifest);
  });
});

test("skill provenance refuses traversal and root or ancestor aliases before enumeration", async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "observer-skills-")));
  try {
    const shared = path.join(root, "skills");
    await fs.mkdir(shared);
    await fs.mkdir(path.join(shared, "valid-skill"));
    await fs.writeFile(path.join(shared, "valid-skill/SKILL.md"), "synthetic public skill");
    const digest = await skillDigest(shared, "valid-skill");
    assert.match(digest, /^[a-f0-9]{64}$/);
    await assert.rejects(
      skillDigest(path.join(root, "never-enumerate"), "../../private"),
      /Unsafe skill name/,
    );
    await fs.symlink(shared, path.join(root, "alias"));
    await assert.rejects(
      skillDigest(path.join(root, "alias"), "valid-skill"),
      /Unsafe shared skill root/,
    );
    await fs.mkdir(path.join(root, "ancestors"));
    await fs.symlink(root, path.join(root, "ancestors/alias"));
    await assert.rejects(
      skillDigest(path.join(root, "ancestors/alias/skills"), "valid-skill"),
      /Unsafe shared skill root/,
    );
    await fs.symlink(path.join(shared, "valid-skill"), path.join(shared, "aliased-skill"));
    await assert.rejects(skillDigest(shared, "aliased-skill"), /Unsafe skill directory/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
