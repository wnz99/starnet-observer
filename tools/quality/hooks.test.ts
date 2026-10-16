import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const hooks = resolve(import.meta.dirname, "hooks.sh");

function fixtureGit(root: string, arguments_: string[]) {
  const result = spawnSync("git", arguments_, { cwd: root, encoding: "utf8" });
  expect(result.status).toBe(0);
  return result.stdout;
}

function fixtureState(root: string) {
  return {
    diff: fixtureGit(root, ["diff", "--no-ext-diff", "--no-textconv", "--binary"]),
    status: fixtureGit(root, ["status", "--porcelain", "--untracked-files=all"]),
    index: readFileSync(join(root, ".git/index")),
  };
}

function runHook(root: string, mode: "hygiene" | "pre-commit") {
  return spawnSync("sh", [hooks, mode], { cwd: root, encoding: "utf8" });
}

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), "observer-staged-hygiene-"));
  fixtureGit(root, ["init", "--quiet"]);
  mkdirSync(join(root, "tools/quality"), { recursive: true });
  // Formatting is a separate staged-snapshot contract; keep this fixture dependency-free.
  writeFileSync(join(root, "tools/quality/format-index.sh"), "#!/bin/sh\nexit 0\n");
  writeFileSync(join(root, "tools/quality/hooks.sh"), readFileSync(hooks));
  writeFileSync(join(root, ".gitignore"), ".agent-local.json\n");
  fixtureGit(root, ["add", "."]);
  return root;
}

for (const folder of ["", "nested"]) {
  test(`pre-commit uses staged ignore rules in ${folder || "root"} directory`, () => {
    const root = createFixture();
    try {
      const directory = join(root, folder);
      mkdirSync(directory, { recursive: true });
      const ignore = join(directory, ".gitignore");
      const stagedRules = `${folder ? "" : ".agent-local.json\n"}.env\n`;
      writeFileSync(ignore, stagedRules);
      writeFileSync(join(directory, ".env"), "DUMMY_ONLY=1\n");
      fixtureGit(root, ["add", "--force", ignore, join(directory, ".env")]);
      writeFileSync(ignore, folder ? "" : ".agent-local.json\n");
      const rejectedState = fixtureState(root);

      expect(runHook(root, "hygiene").status).toBe(0);
      const rejected = runHook(root, "pre-commit");
      expect(rejected.status).toBe(1);
      expect(rejected.stderr).toContain("Tracked ignored files violate repository hygiene.");
      expect(fixtureState(root)).toEqual(rejectedState);

      fixtureGit(root, ["add", ignore]);
      writeFileSync(ignore, stagedRules);
      const allowedState = fixtureState(root);
      expect(runHook(root, "hygiene").status).toBe(1);
      expect(runHook(root, "pre-commit").status).toBe(0);
      expect(fixtureState(root)).toEqual(allowedState);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
