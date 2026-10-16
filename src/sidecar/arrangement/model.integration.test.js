const { test } = require("bun:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { promisify } = require("node:util");
const execFile = promisify(require("node:child_process").execFile);
const { makeProjectResolver } = require("../projects/index.ts");
const Model = require("../../../frontend/app/observer-model.js");
// Task 5-P/model ports these real-model coordinating assertions after the model becomes typed.
test("arrangement preserves linked checkout sections through the actual browser model", async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "arrangement-model-"));
  try {
    const root = path.join(temp, "mono"),
      linked = path.join(temp, "mono-linked");
    const git = (folder, args) =>
      execFile("git", [
        "-c",
        "core.hooksPath=/dev/null",
        "-c",
        "commit.gpgsign=false",
        "-C",
        folder,
        ...args,
      ]);
    await fs.mkdir(root);
    await git(root, ["init", "-q"]);
    await git(root, [
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "--allow-empty",
      "-qm",
      "fixture",
    ]);
    await git(root, ["worktree", "add", "-qb", "fixture-linked", linked]);
    await fs.mkdir(path.join(linked, "src"));
    await fs.mkdir(path.join(linked, "test"));
    const resolver = makeProjectResolver({
      now: () => 1000,
      execute: execFile,
      arrange: { home: temp },
    });
    const linkedRows = await resolver.resolveMany([
      root,
      linked,
      path.join(linked, "src"),
      path.join(linked, "test"),
    ]);
    assert.equal(
      new Set(linkedRows.map((row) => Model.sectionKey(Model.arranged(row)))).size,
      4,
      "ARRANGE preserves every checkout subfolder section",
    );
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});
test("arrangement browser toggle groups actual rows and preserves seats", () => {
  // Page side: ARRANGE swaps the grouping fields; rows without an arrangement are returned unchanged (identity).
  const row = {
    id: "obs_" + "a".repeat(24),
    projectId: "prj_1",
    project: "repos",
    repoId: "repo_1",
    repo: "bq-web",
    folder: "src",
    arrangement: { roomId: "room_1", room: "banqora", sectionId: "sec_1", section: "bq-web" },
  };
  assert.deepEqual(Model.arranged(row), {
    ...row,
    projectId: "room_1",
    project: "banqora",
    projectKind: "group",
    repoId: "sec_1",
    repo: "bq-web",
    folder: "",
  });
  const bare = { id: "x", projectId: "prj_2" };
  assert.equal(Model.arranged(bare), bare);
  const layout = Model.createLayout(),
    arrangedLayout = Model.createLayout();
  const second = {
    ...row,
    id: "obs_" + "b".repeat(24),
    projectId: "prj_2",
    project: "infra-parent",
    repoId: "repo_2",
    repo: "bq-infra",
    arrangement: { roomId: "room_1", room: "banqora", sectionId: "sec_2", section: "bq-infra" },
  };
  layout.reconcile([row, second]);
  arrangedLayout.reconcile([row, second].map(Model.arranged));
  assert.equal(layout.onPage(0).length, 2, "folder grouping: two rooms");
  assert.equal(arrangedLayout.onPage(0).length, 1, "arranged: one room");
  assert.equal(arrangedLayout.onPage(0)[0].name, "banqora");
  const seats = [row, second].map((value) => arrangedLayout.seatFor(value.id));
  arrangedLayout.reconcile([row, second].map(Model.arranged));
  assert.deepEqual(
    [row, second].map((value) => arrangedLayout.seatFor(value.id)),
    seats,
    "desks hold between polls while arranged",
  );
  console.log(
    "observer arrangement: page toggle swaps grouping, identity without arrangement, one room per arranged project, stable seats OK",
  );
});
