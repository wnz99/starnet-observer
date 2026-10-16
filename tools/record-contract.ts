import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
const BASELINE = "wnz-repo-v1",
  PROFILE = "typescript-single",
  APPLICATION = "application",
  LANGUAGE = "typescript",
  TARGET = "bun",
  MIT = "MIT",
  CLIENT = "Codex",
  NONE = "none",
  PENDING = "pending",
  INCLUDE = "include";
const HARNESS = "@playwright/test";
export function validateSkillName(name: string): void {
  assert.match(name, /^[a-z][a-z0-9-]*$/, "Unsafe skill name");
}
const DIGEST = /^[a-f0-9]{64}$/,
  REVISION = /^[a-f0-9]{40}$/,
  VERSION = /^\d+\.\d+\.\d+$/;
export function recordedPolicyInput(file: string): boolean {
  if (file.split("/").some((part) => part === ".." || part.startsWith(".env"))) return false;
  return /^(?:tools\/.*\.(?:ts|mjs|sh)|quality\/isolation\/[a-f0-9]{64}\/consumer\.json|\.github\/workflows\/[^/]+\.ya?ml|docs\/[^/]+\.md|AGENTS\.md|README\.md|LICENSE|NOTICE\.md|package\.json|bun\.lock|bunfig\.toml|\.bootstrap\.json|eslint\.config\.mjs|tsconfig(?:\.[a-z-]+)?\.json|knip\.json|\.fallowrc\.json|\.prettierrc\.json|\.prettierignore|\.gitignore|\.githooks\/pre-(?:commit|push))$/.test(
    file,
  );
}
export async function policyBytes(root: string, file: string): Promise<Uint8Array> {
  assert.ok(recordedPolicyInput(file), `Unrecorded policy input: ${file}`);
  const canonicalRoot = await fs.realpath(root);
  const source = path.join(canonicalRoot, file);
  const info = await fs.lstat(source);
  assert.ok(
    info.isFile() && !info.isSymbolicLink() && (await fs.realpath(source)) === source,
    `Unsafe policy input: ${file}`,
  );
  return fs.readFile(source);
}
function record(value: unknown): Record<string, unknown> {
  assert.ok(value !== null && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}
function array(value: unknown): unknown[] {
  assert.ok(Array.isArray(value));
  return value as unknown[];
}
function text(value: unknown): string {
  assert.ok(typeof value === "string" && value.length > 0);
  return value;
}
function keys(value: Record<string, unknown>, names: string[]) {
  assert.deepEqual(Object.keys(value).sort(), [...names].sort());
}
export function validateInventory(
  value: unknown,
  manifestValue: unknown,
): asserts value is InventoryRecord {
  const input = record(value),
    manifest = record(manifestValue);
  keys(input, [
    "baseline",
    "profile",
    "purpose",
    "license",
    "documentationLanguage",
    "runtimes",
    "components",
    "ci",
    "options",
    "skills",
  ]);
  assert.equal(input.baseline, BASELINE);
  assert.equal(input.profile, PROFILE);
  assert.equal(input.license, MIT);
  text(input.purpose);
  text(input.documentationLanguage);
  validateRuntimes(record(input.runtimes), manifest);
  const components = array(input.components);
  assert.equal(components.length, 1);
  validateComponent(record(components[0]), manifest);
  validateCi(record(input.ci));
  validateOptions(record(input.options));
  validateSkills(array(input.skills));
}
function validateRuntimes(runtimes: Record<string, unknown>, manifest: Record<string, unknown>) {
  keys(runtimes, ["python", "uv", "bun", "node", "nodeTypes"]);
  assert.equal(runtimes.python, null);
  for (const name of ["uv", "bun", "node", "nodeTypes"])
    assert.match(text(runtimes[name]), VERSION);
  assert.equal(manifest.packageManager, "bun@" + text(runtimes.bun));
  assert.equal(record(manifest.engines).node, runtimes.node);
  assert.equal(record(manifest.devDependencies)["@types/node"], runtimes.nodeTypes);
  assert.ok(text(record(manifest.scripts)["check:shell"]).includes("uv==" + text(runtimes.uv)));
}
function validateComponent(component: Record<string, unknown>, manifest: Record<string, unknown>) {
  keys(component, [
    "name",
    "path",
    "language",
    "target",
    "artifact",
    "importPackage",
    "testDependencies",
    "validation",
    "entrypoints",
    "runtimeDependencies",
    "llm",
    "mcp",
  ]);
  assert.equal(component.name, manifest.name);
  assert.equal(component.path, ".");
  assert.equal(component.language, LANGUAGE);
  assert.equal(component.target, TARGET);
  assert.equal(component.artifact, APPLICATION);
  assert.equal(component.importPackage, null);
  assert.deepEqual(component.runtimeDependencies, []);
  const harness = record(component.testDependencies);
  keys(harness, [HARNESS]);
  assert.match(text(harness[HARNESS]), VERSION);
  assert.equal(harness[HARNESS], record(manifest.devDependencies)[HARNESS]);
  for (const entry of array(component.entrypoints))
    assert.match(text(entry), /^src\/(?:server|browser|sidecar)\/[a-z0-9/-]+\.ts$/);
  const validation = record(component.validation);
  keys(validation, ["state", "answer"]);
  assert.equal(validation.state, NONE);
  text(validation.answer);
  const llm = record(component.llm);
  keys(llm, ["state", "answer", "providers"]);
  assert.equal(llm.state, NONE);
  assert.deepEqual(llm.providers, []);
  text(llm.answer);
  const mcp = record(component.mcp);
  keys(mcp, ["state", "answer", "protocol", "transport", "clients"]);
  assert.equal(mcp.state, NONE);
  text(mcp.answer);
  for (const field of ["protocol", "transport", "clients"]) assert.equal(mcp[field], null);
}
function validateCi(ci: Record<string, unknown>) {
  keys(ci, ["provider", "operatingSystems", "actionRevisions"]);
  assert.equal(ci.provider, "github");
  assert.deepEqual([...array(ci.operatingSystems)].sort(), ["ubuntu-24.04"]);
  const actions = record(ci.actionRevisions);
  keys(actions, ["bun", "checkout", "node", "uv"]);
  for (const revision of Object.values(actions)) assert.match(text(revision), REVISION);
}
function validateOptions(options: Record<string, unknown>) {
  keys(options, ["promotion", "merge", "cloud", "serena", "semanticMcp", "selfHostedCi"]);
  for (const [name, value] of Object.entries(options)) {
    const option = record(value);
    keys(option, ["state", "answer", "details"]);
    if (name !== "semanticMcp") {
      assert.equal(option.state, PENDING);
      assert.equal(option.answer, null);
      assert.equal(option.details, null);
      continue;
    }
    assert.equal(option.state, INCLUDE);
    text(option.answer);
    const details = record(option.details);
    keys(details, [
      "client",
      "configLocation",
      "revision",
      "runtimeLocation",
      "scope",
      "source",
      "transport",
    ]);
    assert.equal(details.client, CLIENT);
    assert.equal(details.scope, "repository");
    assert.match(text(details.revision), REVISION);
    assert.ok(text(details.configLocation).startsWith(".codex/config.toml"));
    assert.equal(details.transport, "stdio");
    text(details.source);
    text(details.runtimeLocation);
  }
}
function validateSkills(values: unknown[]) {
  const names = new Set<string>();
  for (const value of values) {
    const skill = record(value);
    keys(skill, ["name", "source", "revision", "subdirectory", "license", "digest", "discovery"]);
    const name = text(skill.name);
    validateSkillName(name);
    assert.ok(!names.has(name));
    names.add(name);
    text(skill.source);
    text(skill.license);
    assert.match(text(skill.digest), DIGEST);
    if (skill.revision !== null) assert.match(text(skill.revision), REVISION);
    if (skill.subdirectory !== null) assert.ok(!text(skill.subdirectory).split("/").includes(".."));
    const discovery = record(skill.discovery);
    keys(discovery, ["client", "location", "state"]);
    assert.equal(discovery.client, CLIENT);
    assert.equal(discovery.location, "~/.agents/skills/" + name);
    text(discovery.state);
  }
  for (const name of [
    "clean-code-tools",
    "wnz-clean-code-js",
    "wnz-code-reviewer",
    "wnz-test-quality",
    "wnz-doc-write-expert",
    "verify-before-complete",
  ])
    assert.ok(names.has(name));
}

export interface InventoryRecord {
  baseline: string;
  runtimes: Record<string, string | null>;
  components: { entrypoints: string[]; testDependencies: Record<string, string> }[];
  ci: { actionRevisions: Record<string, string> };
  skills: {
    name: string;
    revision: string | null;
    digest: string;
    discovery: { location: string };
  }[];
}
export interface LockRecord {
  baseline: string;
  specificationSha256: string;
  runtimes: Record<string, string | null>;
  files: Record<string, string>;
  dependencies: Record<string, Record<string, string>>;
  skills: Record<string, { revision: string | null; digest: string }>;
}
