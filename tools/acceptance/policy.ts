import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { bun, command, fixture, maintainedDigest } from "./fixture.js";
const GIT_OID_LENGTH = 40;
const ZERO_OID = "0".repeat(GIT_OID_LENGTH),
  HEAD = "HEAD";
const HYGIENE_RESULT =
  "ignored synthetic local state allowed; forced tracked local state rejected without mutation";
export async function readonlyProbe() {
  return fixture(async (root) => {
    const before = await maintainedDigest(root);
    bun(root, ["run", "check"]);
    bun(root, ["run", "lint"]);
    assert.equal(await maintainedDigest(root), before);
    const file = path.join(root, "src/shared/acceptance-defect.ts");
    await fs.writeFile(
      file,
      'export const broken: string = 1;\nexport function acceptanceSelector(flag: boolean) { return flag ? "first" : "second"; }\n',
    );
    command(root, "git", ["add", "src/shared/acceptance-defect.ts"]);
    const defective = await maintainedDigest(root);
    assert.match(bun(root, ["run", "check"], 1), /acceptance-defect/);
    assert.equal(await maintainedDigest(root), defective);
    assert.match(bun(root, ["run", "lint"], 1), /acceptance-defect|error/);
    assert.equal(await maintainedDigest(root), defective);
    command(root, "git", ["rm", "--cached", "src/shared/acceptance-defect.ts"]);
    await fs.unlink(file);
    return "passing and failing check/lint preserve maintained files, index and status";
  });
}
export async function hygieneProbe() {
  return fixture(async (root) => {
    for (const file of [".agent-local.json", ".env"]) {
      await fs.writeFile(path.join(root, file), "SYNTHETIC_SENTINEL_ONLY\n");
      command(root, "sh", ["tools/quality/hooks.sh", "hygiene"]);
      command(root, "git", ["add", "--force", file]);
      const before = await maintainedDigest(root);
      assert.match(
        command(root, "sh", ["tools/quality/hooks.sh", "hygiene"], { expected: 1 }),
        /Local-only|Tracked ignored/,
      );
      assert.equal(await maintainedDigest(root), before);
      command(root, "git", ["rm", "--cached", file]);
      await fs.unlink(path.join(root, file));
    }
    assert.equal(command(root, "git", ["status", "--porcelain"]), "");
    return HYGIENE_RESULT;
  });
}
async function stagedFormatting(root: string) {
  const file = path.join(root, "acceptance-format.ts");
  for (const [staged, unstaged, status] of [
    ["export const x=1", "export const x = 1;\n", 1],
    ["export const x = 1;\n", "export const x=1", 0],
  ] as const) {
    await fs.writeFile(file, staged);
    command(root, "git", ["add", "acceptance-format.ts"]);
    await fs.writeFile(file, unstaged);
    const before = await maintainedDigest(root);
    command(root, "sh", ["tools/quality/hooks.sh", "pre-commit"], { expected: status });
    assert.equal(await maintainedDigest(root), before);
  }
  command(root, "git", ["rm", "--cached", "--force", "acceptance-format.ts"]);
  await fs.unlink(file);
}
function push(root: string, oid: string, expected: number) {
  const input = `refs/heads/fixture ${oid} refs/heads/fixture ${ZERO_OID}\n`;
  command(root, "sh", ["tools/quality/hooks.sh", "pre-push"], { expected, input });
}

export async function hooksProbe() {
  return fixture(async (root) => {
    await stagedFormatting(root);
    const head = command(root, "git", ["rev-parse", HEAD]).trim();
    push(root, head, 0);
    push(root, ZERO_OID, 0);
    await fs.writeFile(path.join(root, "dirty.txt"), "fixture");
    push(root, head, 1);
    await fs.unlink(path.join(root, "dirty.txt"));
    command(root, "git", [
      "-c",
      "core.hooksPath=/dev/null",
      "commit",
      "--allow-empty",
      "-qm",
      "next",
    ]);
    push(root, head, 1);
    command(root, "git", ["config", "core.hooksPath", "existing-owner"]);
    assert.match(
      command(root, "sh", ["tools/quality/install-hooks.sh"], { expected: 1 }),
      /preserved/,
    );
    command(root, "git", ["config", "--unset", "core.hooksPath"]);
    linkedHooks(root);
    return "actual staged formatter, clean static push gate, dirty/ref/deletion guards and linked hook ownership verified";
  });
}
function linkedHooks(root: string) {
  const linked = root + "-linked";
  command(root, "git", ["worktree", "add", "--detach", linked]);
  try {
    const before = command(linked, "git", ["config", "--get", "core.hooksPath"], { expected: 1 });
    command(root, "sh", ["tools/quality/install-hooks.sh"]);
    command(root, "sh", ["tools/quality/install-hooks.sh"]);
    assert.equal(
      command(linked, "git", ["config", "--get", "core.hooksPath"], { expected: 1 }),
      before,
    );
    assert.equal(
      command(root, "git", ["config", "--worktree", "--get", "core.hooksPath"]).trim(),
      ".githooks",
    );
  } finally {
    command(root, "git", ["worktree", "remove", "--force", linked]);
  }
}
