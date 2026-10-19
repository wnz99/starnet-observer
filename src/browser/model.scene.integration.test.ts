import { present } from "./scene/values.fixture.js";
import { element } from "./model/types.js";
import type { LayoutRow } from "./model/types.js";
import type { Layout } from "./model/layout.js";
import assert from "node:assert/strict";
import { test } from "bun:test";
import { createModel } from "./model.js";
import { canonicalTheme } from "./theme.fixture.js";
import * as Scene from "./scene/index.js";
const Model = createModel(canonicalTheme());
test("original model allocation, lineage, checkout and theme geometry with real Scene", () => {
  const worker = (repo: string, index: number, project = "Mama") => ({
    id: repo + "_" + String(index),
    project,
    projectId: "prj_" + project,
    projectKind: "group",
    repo,
    repoId: "repo_" + repo,
  });
  const desksOf = (layout: Layout) =>
    new Map(
      Array.from(
        { length: layout.pages() },
        (_, page) => Scene.build(layout.onPage(page), page).workers,
      )
        .flat()
        .map((worker) => [worker.id, JSON.stringify(worker.chair)]),
    );
  const sameDesks = (
    before: ReadonlyMap<string, string>,
    after: ReadonlyMap<string, string>,
    label: string,
  ) => {
    for (const [id, tile] of before)
      if (after.has(id)) assert.equal(after.get(id), tile, label + ": " + id + " kept its desk");
  };

  function verifyStableAllocations() {
    // Allocation stays stable across growth, repository changes, removal, refill and trailing-block trimming.
    const layout = Model.createLayout();
    let rows = Array.from({ length: 8 }, (_, index) => worker("ma-ai", index));
    assert(layout.reconcile(rows).changed);
    const eight = desksOf(layout);
    assert.deepEqual(
      rows.map((row) => layout.seatFor(row.id)),
      [0, 1, 2, 3, 4, 5, 6, 7],
    );
    rows.push(worker("ma-ai", 8));
    layout.reconcile(rows);
    sameDesks(eight, desksOf(layout), "8 -> 9 growth");
    assert.equal(layout.seatFor("ma-ai_8"), 8);
    rows.push(...[0, 1, 2].map((index) => worker("ma-web-app", index)));
    layout.reconcile(rows);
    sameDesks(eight, desksOf(layout), "adding repository");
    assert.deepEqual(
      [0, 1, 2].map((index) => layout.seatFor("ma-web-app_" + String(index))),
      [16, 17, 18],
    );
    const twelve = desksOf(layout);
    assert(
      !layout.reconcile(rows.slice().reverse()).changed,
      "snapshot order never reshuffles seats",
    );
    sameDesks(twelve, desksOf(layout), "reorder");
    rows = rows.filter((row) => !/^ma-ai_[0-7]$/.test(row.id));
    layout.reconcile(rows);
    sameDesks(twelve, desksOf(layout), "removal");
    rows.push(...Array.from({ length: 10 }, (_, index) => worker("ma-web-app", index + 3)));
    layout.reconcile(rows);
    sameDesks(twelve, desksOf(layout), "refill");
    assert.equal(layout.seatFor("ma-web-app_7"), 23);
    assert.equal(layout.seatFor("ma-web-app_8"), 0);
    assert.equal(desksOf(layout).get("ma-web-app_8"), eight.get("ma-ai_0"), "vacated desk reused");
    const refilled = desksOf(layout);
    rows = rows.map((row) =>
      row.id === "ma-ai_8" ? { ...row, repo: "ma-web-app", repoId: "repo_ma-web-app" } : row,
    );
    assert.deepEqual(layout.reconcile(rows).moved, ["ma-ai_8"]);
    assert.equal(layout.seatFor("ma-ai_8"), 5);
    assert.notEqual(desksOf(layout).get("ma-ai_8"), refilled.get("ma-ai_8"));
    refilled.delete("ma-ai_8");
    sameDesks(refilled, desksOf(layout), "repository move");
    const afterMove = desksOf(layout);
    rows = rows.filter((row) => !/^ma-web-app_[0-7]$/.test(row.id));
    layout.reconcile(rows);
    sameDesks(afterMove, desksOf(layout), "trim");
    assert.equal(element(layout.onPage(0), 0).blocks.length, 1, "trailing empty blocks removed");
  }
  verifyStableAllocations();
  function verifySameHueAnnex() {
    // The 25th worker opens a same-hue annex without moving existing seats.
    const layout = Model.createLayout();
    const rows = Array.from({ length: 25 }, (_, index) => ({
      id: "solo_" + String(index),
      project: "Solo",
      projectId: "prj_solo",
    }));
    layout.reconcile(rows.slice(0, 24));
    const before = desksOf(layout);
    layout.reconcile(rows);
    sameDesks(before, desksOf(layout), "annex");
    const main = element(layout.onPage(0), 0),
      annex = element(layout.onPage(0), 1);
    assert.deepEqual([main.annex, annex.annex, annex.floor], [0, 1, main.floor]);
    assert.equal(layout.seatFor("solo_24"), 24);
  }
  verifySameHueAnnex();
  function verifyHueAllocation() {
    // Hues: unique per deck despite hash collisions, kept as long as live, freed hues reused, swatches use the layout hue.
    const project = (name: string) => ({ id: "w_" + name, project: name, projectId: name });
    const target = Model.hash("alpha") % Model.palette.length,
      twins = ["alpha"];
    for (let index = 0; twins.length < 3; index++)
      if (Model.hash("twin" + String(index)) % Model.palette.length === target)
        twins.push("twin" + String(index));
    const layout = Model.createLayout();
    layout.reconcile(twins.map(project));
    assert.equal(
      new Set(layout.onPage(0).map((room) => room.floor)).size,
      3,
      "colliding hashes still get distinct hues",
    );
    const ten = Array.from({ length: 10 }, (_, index) => project("p" + String(index)));
    layout.reconcile(ten);
    const hues = new Map(ten.map((row) => [row.projectId, layout.colorFor(row.projectId).floor]));
    assert.equal(new Set(hues.values()).size, 10);
    for (const room of layout.onPage(0))
      assert.equal(room.floor, layout.colorFor(room.projectId).floor);
    const next = [...ten.filter((row) => row.projectId !== "p3"), project("fresh")];
    layout.reconcile(next);
    for (const row of next)
      if (row.projectId !== "fresh")
        assert.equal(
          layout.colorFor(row.projectId).floor,
          hues.get(row.projectId),
          "hue kept as long as live",
        );
    assert.equal(layout.colorFor("fresh").floor, hues.get("p3"), "the freed hue is reused");
    const many = Array.from({ length: 40 }, (_, index) => project("many" + String(index)));
    layout.reconcile(many);
    assert.equal(layout.pages(), 5);
    for (let page = 0; page < layout.pages(); page++) {
      const rooms = layout.onPage(page);
      assert.equal(
        new Set(rooms.map((room) => room.floor)).size,
        rooms.length,
        "distinct hues on deck " + String(page + 1),
      );
    }
    assert.equal(layout.pageFor("w_many39"), 4);
  }
  verifyHueAllocation();

  function verifyHueConflictAnnex() {
    // Eleven projects fill deck 1 and three rooms of deck 2; a deck-1 project whose hue is already on deck 2 then
    // grows past 24 seats. Its annex shares its parent anchor, so no surviving project is recoloured.
    const layout = Model.createLayout(),
      names = Array.from({ length: 11 }, (_, index) => "hue" + String(index));
    let rows = names.map((name) => ({ id: name + "_0", project: name, projectId: name }));
    layout.reconcile(rows);
    const before = new Map(names.map((name) => [name, layout.colorFor(name).floor]));
    const deckTwo = new Set(layout.onPage(1).map((room) => room.floor));
    const growerRoom = layout.onPage(0).find((room) => deckTwo.has(room.floor));
    assert(growerRoom);
    const grower = growerRoom.projectId;
    rows = [
      ...rows,
      ...Array.from({ length: 24 }, (_, index) => ({
        id: grower + "_" + String(index + 1),
        project: grower,
        projectId: grower,
      })),
    ];
    layout.reconcile(rows);
    for (const name of names)
      assert.equal(layout.colorFor(name).floor, before.get(name), name + " keeps its hue");
    for (let page = 0; page < layout.pages(); page++) {
      const rooms = layout.onPage(page);
      assert.equal(
        new Set(rooms.map((room) => room.floor)).size,
        new Set(rooms.map((room) => room.projectId)).size,
        "distinct hues on deck " + String(page + 1),
      );
    }
    assert.equal(layout.pageFor(grower + "_24"), 0, "the annex stays on its parent's deck");
    assert.equal(
      element(
        layout.onPage(0).filter((room) => room.projectId === grower),
        0,
      ).floor,
      before.get(grower),
    );
    assert.equal(layout.pageFor(grower + "_23"), 0, "existing seats stay in the main room");
  }
  verifyHueConflictAnnex();
  function verifyLineageAndProjectMoves() {
    const layout = Model.createLayout(),
      root = worker("child-repo", 0, "Parent folder");
    const sibling = worker("sibling-repo", 0, "Parent folder");
    const desktop = {
      id: "window",
      source: "desktop",
      projectId: "desktop",
      project: "Desktop",
      repoId: "app",
    };
    layout.reconcile([root]);
    const before = desksOf(layout);
    layout.reconcile([desktop, sibling, root]);
    sameDesks(before, desksOf(layout), "runtime sibling/Desktop arrival");
    assert.equal(layout.onPage(0).length, 2);
    const parent = { ...worker("parent-folder", 0, "Parent folder"), repoId: root.projectId };
    layout.reconcile([root, sibling, desktop, parent]);
    assert.equal(layout.onPage(0).length, 2, "direct parent shares canonical project room");
    const helpers = Array.from({ length: 10 }, (_, i) => ({
      id: "helper" + String(i),
      source: "helper",
      parentId: root.id,
      projectId: "wrong",
      repoId: "wrong",
      status: "unknown" as const,
    }));
    const rootsBefore = desksOf(layout);
    layout.reconcile([...helpers, root, sibling, desktop, parent]);
    const rooms = layout.onPage(0),
      helperRows = rooms.flatMap((r) => r.rows).filter((v) => v.kind === "helper");
    assert.equal(helperRows.length, 10, "overflow remains available to the list");
    assert.equal(rooms.length, 2, "helpers never create rooms");
    assert.equal(
      element(
        rooms.filter((r) => r.projectId === root.projectId),
        0,
      ).blocks.length,
      3,
      "helpers never create blocks",
    );
    sameDesks(rootsBefore, desksOf(layout), "helper arrival root parity");
    assert.equal(
      layout.seatFor("helper0"),
      undefined,
      "helper never pretends to be a root mail seat",
    );
    const slots = new Map(helperRows.map((v) => [v.row.id, v.helperSlot]));
    assert(
      !layout.reconcile([parent, desktop, sibling, root, ...helpers.slice().reverse()]).changed,
    );
    assert.deepEqual(
      new Map(
        layout
          .onPage(0)
          .flatMap((r) => r.rows)
          .filter((v) => v.kind === "helper")
          .map((v) => [v.row.id, v.helperSlot]),
      ),
      slots,
    );
    layout.reconcile([
      root,
      { ...element(helpers, 0), parentId: "missing" },
      { id: "missing-parent", source: "helper" },
      { id: "cycle-a", source: "helper", parentId: "cycle-b" },
      { id: "cycle-b", parentId: "cycle-a" },
    ]);
    assert.deepEqual(
      layout
        .onPage(0)
        .flatMap((r) => r.rows)
        .map((v) => v.row.id),
      [root.id],
      "orphan/cyclic/malformed helpers rejected",
    );
    const child = { ...element(helpers, 0), parentId: root.id },
      grandchild = { ...element(helpers, 1), parentId: child.id };
    layout.reconcile([grandchild, child, root]);
    const chain = element(layout.onPage(0), 0).rows.filter((v) => v.kind === "helper");
    assert(chain.every((v) => v.rootId === root.id && v.block === 0));
    assert.equal(layout.pageFor(grandchild.id), layout.pageFor(root.id));
    const unrelated = worker("elsewhere", 0, "Other");
    layout.reconcile([root, unrelated, child, grandchild]);
    const unrelatedDesk = desksOf(layout).get(unrelated.id);
    assert(
      layout
        .reconcile([
          { ...root, projectId: "moved-project", project: "Moved" },
          unrelated,
          child,
          grandchild,
        ])
        .moved.includes(root.id),
    );
    assert.equal(
      desksOf(layout).get(unrelated.id),
      unrelatedDesk,
      "project identity move preserves unrelated seats",
    );
    assert.equal(
      present(
        layout
          .onPage(0)
          .filter((r) => r.projectId === "moved-project")
          .at(0),
      ).rows.filter((v) => v.kind === "helper").length,
      2,
    );
    layout.reconcile([child, grandchild]);
    assert.equal(layout.onPage(0).length, 0, "helper-only snapshot cannot keep a room");
  }
  verifyLineageAndProjectMoves();
  function verifyCheckoutSections() {
    const layout = Model.createLayout();
    const rows: LayoutRow[] = ["main", "left", "right"].map((checkoutId, index) => ({
      ...worker("shared", index),
      checkoutId,
      checkoutKind: index ? "worktree" : "main",
      worktree: index ? "same name" : null,
      folder: "src",
    }));
    rows.push({ ...worker("shared", 3), folder: "src" });
    layout.reconcile(rows);
    const sections = Array.from(
      { length: layout.pages() },
      (_, page) => Scene.build(layout.onPage(page), page).platforms,
    )
      .flat()
      .flatMap((p) => p.sections);
    assert.equal(
      sections.length,
      4,
      "main, equal-basename worktrees and unavailable proof stay distinct",
    );
    assert.equal(new Set(sections.map((s) => s.repo)).size, 1);
    assert.deepEqual(
      sections.map((s) => s.checkoutId),
      ["main", "left", "right", null],
    );
    assert(element(sections, 0).label.includes("Main checkout"));
    assert(element(sections, 1).label.includes("Worktree same name"));
    assert(element(sections, 3).label.includes("Checkout unavailable"));
    assert(sections.every((s) => s.folder === "src"));
    const before = desksOf(layout);
    layout.reconcile(rows.slice().reverse());
    sameDesks(before, desksOf(layout), "checkout reorder");
    const beforeScene = Scene.build(layout.onPage(0), 0);
    const renamed = rows.map((row) =>
      row.checkoutId === "main" ? { ...row, repo: "renamed" } : row,
    );
    layout.reconcile(renamed);
    const afterScene = Scene.build(layout.onPage(0), 0);
    assert.notEqual(
      beforeScene.revision,
      afterScene.revision,
      "label topology invalidates sign cache",
    );
    assert.equal(element(element(afterScene.platforms, 0).sections, 0).checkoutKind, "main");
    assert.equal(element(element(afterScene.platforms, 0).sections, 0).repoLabel, "renamed");
    sameDesks(before, desksOf(layout), "label-only update");
    const movedRows = renamed.map((row) =>
      row.id === element(rows, 0).id
        ? { ...row, checkoutId: "left", checkoutKind: "worktree" as const, worktree: "same name" }
        : row,
    );
    assert(
      layout.reconcile(movedRows).moved.includes(element(rows, 0).id),
      "checkout change moves only affected row section",
    );
    assert.notEqual(
      Model.sectionKey({ repoId: "a#b", checkoutId: "c", folder: "d" }),
      Model.sectionKey({ repoId: "a", checkoutId: "b#c", folder: "d" }),
    );
  }
  verifyCheckoutSections();
  // Theme project accents recolour the ten slots only: same rooms, slots, floor names and desks as the default palette.
  function verifyThemeGeometryParity() {
    const defaults = canonicalTheme().scene.projectAccents;
    assert.deepEqual(
      Model.palette.map(([, accent]) => accent),
      defaults,
      "omitted accents are the canonical default slots",
    );
    assert.deepEqual(
      Model.palette.map(([floor]) => floor),
      [
        "cobalt",
        "teal",
        "verdant",
        "moss",
        "amber",
        "ember",
        "crimson",
        "orchid",
        "violet",
        "indigo",
      ],
    );
    const custom = Array.from(
      { length: 10 },
      (_, index) => "#a0" + String(index).padStart(2, "0") + "0" + String(index),
    );
    const rows = Array.from({ length: 30 }, (_, index) =>
      worker("repo" + String(index % 5), index, "P" + String(index % 12)),
    );
    const plain = Model.createLayout(),
      themed = Model.createLayout({ projectAccents: custom });
    plain.reconcile(rows);
    themed.reconcile(rows);
    assert.equal(themed.pages(), plain.pages());
    for (let page = 0; page < plain.pages(); page++) {
      const before = plain.onPage(page),
        after = themed.onPage(page);
      assert.deepEqual(
        after.map((room) => [
          room.key,
          room.slot,
          room.floor,
          room.blocks.map((block) => block.repo),
        ]),
        before.map((room) => [
          room.key,
          room.slot,
          room.floor,
          room.blocks.map((block) => block.repo),
        ]),
        "same rooms, slots and floor names",
      );
      for (const room of after) {
        const slot = Model.palette.findIndex(([floor]) => floor === room.floor);
        assert.equal(
          room.accent,
          element(custom, slot),
          room.floor + " shows its themed slot colour",
        );
        assert.notEqual(room.accent, element(defaults, slot));
      }
      assert.deepEqual(
        JSON.stringify(Scene.build(after, page).workers.map((w) => [w.id, w.chair, w.desk])),
        JSON.stringify(Scene.build(before, page).workers.map((w) => [w.id, w.chair, w.desk])),
        "identical desk geometry",
      );
    }
    for (const project of ["prj_P0", "prj_P7", "prj_unknown"]) {
      assert.equal(themed.colorFor(project).floor, plain.colorFor(project).floor);
      assert.equal(
        themed.colorFor(project).accent,
        custom[Model.palette.findIndex(([floor]) => floor === plain.colorFor(project).floor)],
      );
    }
  }
  verifyThemeGeometryParity();
});
