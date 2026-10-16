import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const gitEnvironment = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
const hooks = resolve(import.meta.dirname, "hooks.sh");

function fixtureGit(root: string, arguments_: string[]) {
  const result = spawnSync("git", arguments_, { cwd: root, encoding: "utf8", env: gitEnvironment });
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

function runHook(root: string, mode: "hygiene" | "pre-commit" | "pre-push", input = "") {
  return spawnSync("sh", [hooks, mode], {
    cwd: root,
    encoding: "utf8",
    input,
    env: {
      ...gitEnvironment,
      PATH: `${root}/bin:${process.env.PATH ?? ""}`,
      OBSERVER_HOOK_COMMANDS: join(root, ".git/commands"),
    },
  });
}

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), "observer-staged-hygiene-"));
  fixtureGit(root, ["init", "--quiet"]);
  mkdirSync(join(root, "tools/quality"), { recursive: true });
  // Stub the external formatter in this disposable checkout; staged-format tests replace it.
  executable(root, "bin/bun", "#!/bin/sh\nexit 0\n");
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

test("hygiene rejects forced tracked local state without changing files or index", () => {
  const root = createFixture();
  try {
    writeFileSync(join(root, ".agent-local.json"), "SYNTHETIC_SENTINEL_ONLY\n");
    expect(runHook(root, "hygiene").status).toBe(0);
    fixtureGit(root, ["add", "--force", ".agent-local.json"]);
    const before = fixtureState(root);
    expect(runHook(root, "hygiene").stderr).toContain(
      "Local-only .agent-local.json must not be tracked",
    );
    expect(fixtureState(root)).toEqual(before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function commitFixture(root: string) {
  fixtureGit(root, ["add", "."]);
  fixtureGit(root, [
    "-c",
    "core.hooksPath=/dev/null",
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "--quiet",
    "--allow-empty",
    "-m",
    "fixture",
  ]);
  return fixtureGit(root, ["rev-parse", "HEAD"]).trim();
}
function executable(root: string, file: string, content: string) {
  const target = join(root, file);
  mkdirSync(resolve(target, ".."), { recursive: true });
  writeFileSync(target, content);
  chmodSync(target, 0o755);
}

test("staged formatting selects index bytes and preserves index and worktree", () => {
  const root = createFixture();
  try {
    writeFileSync(join(root, ".prettierrc.json"), '{"semi": true}\n');
    writeFileSync(join(root, ".prettierignore"), "ignored-staged.ts\n");
    fixtureGit(root, ["add", ".prettierrc.json", ".prettierignore"]);
    writeFileSync(join(root, ".prettierrc.json"), '{"semi": false}\n');
    writeFileSync(join(root, ".prettierignore"), "ignored-working.ts\n");
    executable(
      root,
      "bin/bun",
      `#!/bin/sh
set -eu
repo_root=\${OBSERVER_HOOK_COMMANDS%/.git/commands}
test "$#" -eq 8
test "$1" = "$repo_root/node_modules/prettier/bin/prettier.cjs"
test "$2" = --config
test "$3" = "$PWD/.prettierrc.json"
test "$4" = --ignore-path
test "$5" = "$PWD/.prettierignore"
test "$6" = --check
test "$7" = --ignore-unknown
test "$8" = .
test "$(cat .prettierrc.json)" = '{"semi": true}'
test "$(cat .prettierignore)" = ignored-staged.ts
test "$(cat format.ts)" = "export const value = 1;"
`,
    );
    for (const [staged, working, status] of [
      ["export const value=1", "export const value = 1;", 1],
      ["export const value = 1;", "export const value=1", 0],
    ] as const) {
      writeFileSync(join(root, "format.ts"), staged);
      fixtureGit(root, ["add", "format.ts"]);
      writeFileSync(join(root, "format.ts"), working);
      const before = fixtureState(root);
      expect(runHook(root, "pre-commit").status).toBe(status);
      expect(fixtureState(root)).toEqual(before);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("pre-push checks only clean HEAD and skips deleted refs", () => {
  const root = createFixture();
  const zero = "0".repeat(40);
  const push = (oid: string) =>
    runHook(root, "pre-push", `refs/heads/fixture ${oid} refs/heads/fixture ${zero}\n`);
  try {
    executable(root, "bin/bun", '#!/bin/sh\nprintf "%s\\n" "$*" >> "$OBSERVER_HOOK_COMMANDS"\n');
    const head = commitFixture(root);
    expect(push(head).status).toBe(0);
    expect(readFileSync(join(root, ".git/commands"), "utf8")).toBe("run lint\nrun typecheck\n");
    rmSync(join(root, ".git/commands"));
    expect(push(zero).status).toBe(0);
    writeFileSync(join(root, ".gitignore"), ".agent-local.json\nextra\n");
    expect(push(head).status).toBe(1);
    fixtureGit(root, ["restore", ".gitignore"]);
    writeFileSync(join(root, "dirty.txt"), "fixture");
    expect(push(head).stderr).toContain("requires a clean checkout");
    fixtureGit(root, ["add", "dirty.txt"]);
    expect(push(head).status).toBe(1);
    const next = commitFixture(root);
    expect(next).not.toBe(head);
    expect(push(head).stderr).toContain("other than checked-out HEAD");
    expect(() => readFileSync(join(root, ".git/commands"))).toThrow();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("hook installation preserves existing owner and isolates linked worktrees", () => {
  const root = createFixture();
  const linked = root + "-linked";
  const install = () =>
    spawnSync("sh", [hooks, "install"], { cwd: root, encoding: "utf8", env: gitEnvironment });
  const linkedConfiguration = () =>
    spawnSync("git", ["config", "--get", "core.hooksPath"], {
      cwd: linked,
      encoding: "utf8",
      env: gitEnvironment,
    });
  try {
    for (const hook of ["pre-commit", "pre-push"])
      executable(root, `.githooks/${hook}`, "#!/bin/sh\nexit 0\n");
    commitFixture(root);
    fixtureGit(root, ["config", "core.hooksPath", "existing-owner"]);
    expect(install().stderr).toContain("Existing hooksPath preserved");
    expect(fixtureGit(root, ["config", "--get", "core.hooksPath"]).trim()).toBe("existing-owner");
    fixtureGit(root, ["config", "--unset", "core.hooksPath"]);
    fixtureGit(root, ["worktree", "add", "--detach", linked]);
    const before = linkedConfiguration();
    expect(before.status).toBe(1);
    expect(install().status).toBe(0);
    expect(install().status).toBe(0);
    expect(linkedConfiguration().status).toBe(before.status);
    expect(linkedConfiguration().stdout).toBe(before.stdout);
    expect(fixtureGit(root, ["config", "--worktree", "--get", "core.hooksPath"]).trim()).toBe(
      ".githooks",
    );
  } finally {
    spawnSync("git", ["worktree", "remove", "--force", linked], { cwd: root, env: gitEnvironment });
    rmSync(root, { recursive: true, force: true });
  }
});
