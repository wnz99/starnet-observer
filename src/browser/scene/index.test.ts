import { present } from "./values.fixture.js";
import assert from "node:assert/strict";
import type { LayoutRow } from "../model/types.js";
import type {
  Point,
  Rect,
  Worker,
  Platform,
  Scene as SceneValue,
  ActorFrame,
  MotionOptions,
} from "./types.js";
import { createModel } from "../model.js";
import { canonicalTheme } from "../theme.fixture.js";
import { test } from "bun:test";
import * as Scene from "./index.js";
import { ActorState } from "./actor.js";
import { FormationPlanner } from "./formation.js";
import { graphFor, safeSegment, pathTo } from "./navigation.js";
import { revisionFor } from "./revision.js";

test("each room has unobstructed reachable quarters, independent of status and lifecycle phase", () => {
  for (const count of [1, 5, 9, 12, 20]) {
    const layout = createModel(canonicalTheme()).createLayout();
    layout.reconcile(
      Array.from({ length: count }, (_, i) => ({
        id: "quarters-root-" + String(i),
        source: "herdr",
        projectId: "quarters",
        repoId: "repo-" + String(i),
      })),
    );
    for (let page = 0; page < layout.pages(); page++) {
      const scene = Scene.build(layout.onPage(page), page);
      assert.equal(scene.platforms.length, layout.onPage(page).length);
      for (const platform of scene.platforms) {
        const graph = graphFor(platform),
          quarters = platform.quarters;
        assert(
          [...graph.cells.values()].some(
            (point) => point.x === quarters.entry.x && point.y === quarters.entry.y,
          ),
        );
        assert(
          graph.obstacles.every(
            (rect) =>
              !(
                rect.x < quarters.rect.x + quarters.rect.w &&
                rect.x + rect.w > quarters.rect.x &&
                rect.y < quarters.rect.y + quarters.rect.h &&
                rect.y + rect.h > quarters.rect.y
              ),
          ),
        );
        for (const worker of scene.workers.filter((value) => value.platformKey === platform.key)) {
          const path = pathTo(graph, worker.chair, quarters.entry, worker);
          assert(path.length > 0);
          path.forEach((to, index) => {
            assert(safeSegment(graph, index ? present(path[index - 1]) : worker.chair, to, worker));
          });
        }
      }
      const inputs = {
        page,
        rooms: layout.onPage(page),
        platforms: scene.platforms,
        observatory: scene.observatory,
        ships: scene.ships ?? [],
        relays: scene.relays ?? [],
        walkways: scene.walkways,
        workers: scene.workers,
      };
      assert.equal(revisionFor(inputs), scene.revision);
      assert.notEqual(
        revisionFor({
          ...inputs,
          platforms: scene.platforms.map((platform) => ({
            ...platform,
            quarters: { ...platform.quarters, rect: { ...platform.quarters.rect, w: 4 } },
          })),
        }),
        scene.revision,
      );
      assert.equal(
        revisionFor({
          ...inputs,
          workers: scene.workers.map((worker) => ({ ...worker, helperPhase: "returning" })),
        }),
        scene.revision,
      );
    }
  }
});

test("helper lifecycle routes from quarters, freezes stale returns, and settles safe arrivals or impossible routes", () => {
  const layout = createModel(canonicalTheme()).createLayout();
  layout.reconcile([
    { id: "lifecycle-root", source: "herdr", status: "working" },
    {
      id: "lifecycle-helper",
      source: "helper",
      parentId: "lifecycle-root",
      lineageState: "verified",
      status: "working",
    },
  ]);
  const scene = Scene.build(layout.onPage(0), 0),
    worker = present(scene.workers.find((value) => value.kind === "helper")),
    platform = present(scene.platforms.find((value) => value.key === worker.platformKey)),
    graph = graphFor(platform);
  worker.helperPhase = "entering";
  worker.quartersEntry = platform.quarters.entry;
  const motion = Scene.createMovement();
  motion.reconcile(scene, { now: 0 });
  assert.deepEqual(
    present(motion.step(0).find((value) => value.id === worker.id)).point,
    platform.quarters.entry,
  );
  let enteringSettled = false;
  for (let now = 100; now < 20000; now += 100) {
    const frame = present(motion.step(now).find((value) => value.id === worker.id));
    if (frame.settled) {
      assert.equal(frame.settled, "entering");
      enteringSettled = true;
      break;
    }
  }
  assert(enteringSettled);
  const returning = {
    ...worker,
    helperPhase: "returning" as const,
    row: { ...worker.row, lifecycleEvidence: { state: "closed" } },
  };
  scene.workers = scene.workers.map((value) => (value.id === worker.id ? returning : value));
  motion.reconcile(scene, { now: 20000 });
  const frozen = present(
    motion.step(20100, { stale: true }).find((value) => value.id === worker.id),
  );
  assert.equal(frozen.settled, undefined);
  assert.deepEqual(
    present(motion.step(21100, { stale: true }).find((value) => value.id === worker.id)).point,
    frozen.point,
  );
  let from = frozen.point,
    returned = false;
  for (let now = 21200; now <= 50000; now += 100) {
    const frame = present(motion.step(now).find((value) => value.id === worker.id));
    assert(safeSegment(graph, from, frame.point, returning));
    from = frame.point;
    if (frame.settled) {
      assert.equal(frame.settled, "returning");
      assert.deepEqual(frame.point, platform.quarters.entry);
      returned = true;
      break;
    }
  }
  assert(returned);
  // A room extended behind the canonical banks gives a real safe path longer than 30 seconds.
  const extended = { ...platform, rect: { ...platform.rect, h: 110 } },
    long = {
      ...returning,
      chair: { x: platform.rect.x + 15.5, y: platform.rect.y + 95.5, z: 0 },
    };
  const longScene = { ...scene, revision: "extended", platforms: [extended], workers: [long] },
    longMotion = Scene.createMovement();
  longMotion.reconcile(longScene, { now: 0 });
  let previous = long.chair,
    settledAt = 0;
  const longGraph = graphFor(extended);
  for (let now = 100; now <= 90000; now += 100) {
    const frame = present(longMotion.step(now)[0]);
    assert(safeSegment(longGraph, previous, frame.point, long));
    previous = { ...frame.point, z: 0 };
    if (now <= 30000) assert.equal(frame.settled, undefined);
    if (frame.settled) {
      settledAt = now;
      break;
    }
  }
  assert(settledAt > 30000);
  const blocked = {
    ...scene,
    revision: "blocked",
    platforms: [
      {
        ...platform,
        decorationRegions: [
          ...platform.decorationRegions,
          {
            kind: "wall",
            rect: {
              x: platform.quarters.entry.x - 0.4,
              y: platform.quarters.entry.y - 0.4,
              w: 0.8,
              h: 0.8,
            },
          },
        ],
      },
    ],
    workers: [returning],
  };
  const impossible = Scene.createMovement();
  impossible.reconcile(blocked, { now: 0 });
  const frame = present(impossible.step(100)[0]);
  assert.equal(frame.settled, "returning");
  assert.deepEqual(frame.point, returning.chair);
  const changedRoute = Scene.createMovement();
  changedRoute.reconcile(longScene, { now: 0 });
  const lastSafe = present(changedRoute.step(100)[0]).point;
  changedRoute.reconcile(
    {
      ...longScene,
      revision: "new-obstruction",
      platforms: [
        { ...extended, decorationRegions: blocked.platforms[0]?.decorationRegions ?? [] },
      ],
    },
    { now: 100 },
  );
  const stopped = present(changedRoute.step(200)[0]);
  assert.equal(stopped.settled, "returning");
  assert.deepEqual(
    stopped.point,
    lastSafe,
    "a geometry-induced failure settles without jumping across obstacles",
  );
  const reduced = Scene.createMovement();
  reduced.reconcile(scene, { now: 0 });
  assert.equal(
    present(reduced.step(0, { reduced: true, stale: true }).find((value) => value.id === worker.id))
      .settled,
    undefined,
  );
  assert.equal(
    present(reduced.step(1, { reduced: true }).find((value) => value.id === worker.id)).settled,
    "returning",
  );
});

test("helpers joining a resting parent consume their lag and regroup in a clear room", () => {
  const layout = createModel(canonicalTheme()).createLayout(),
    root: LayoutRow = { id: "resting-parent", status: "idle" },
    rows: LayoutRow[] = Array.from({ length: 8 }, (_, i) => ({
      id: "resting-helper-" + String(i),
      source: "helper",
      parentId: root.id,
      status: "idle",
      lineageState: "verified",
    }));
  layout.reconcile([root, ...rows]);
  const scene = Scene.build(layout.onPage(0), 0),
    worker = present(scene.workers.find((value) => value.id === root.id)),
    platform = present(scene.platforms.find((value) => value.key === worker.platformKey)),
    graph = graphFor(platform),
    parent = new ActorState(worker, 0, 0),
    reduced = false,
    stale = false,
    helpers = scene.workers
      .filter((value) => value.kind === "helper")
      .map((value) => {
        const actor = new ActorState(value, 0, 0);
        actor.depth = 1;
        return actor;
      });
  // A completed safe walk in the real room's open aisle; membership arrives during its rest.
  parent.record({ x: platform.rect.x + 2.5, y: platform.rect.y + 4.5 });
  parent.point = { x: platform.rect.x + 17.5, y: platform.rect.y + 4.5 };
  parent.record(parent.point);
  assert.equal(helpers.length, 8);
  for (let now = 0; now <= 30000; now += 100) {
    const assignments = new FormationPlanner(
      parent,
      helpers.map((actor) => ({ actor, depth: 1 })),
      graph,
      stale,
    ).plan();
    for (const actor of helpers) {
      const assignment = present(assignments.find((value) => value.actor === actor)),
        before = actor.frame(reduced);
      actor.animate({ now, elapsed: 100, graph, parent, assignment, following: true });
      assert(safeSegment(graph, before.point, actor.point, actor.worker));
    }
    if (now >= 20000)
      for (let i = 0; i < helpers.length; i += 2) {
        const a = present(helpers[i]).point,
          b = present(helpers[i + 1]).point;
        assert(Math.abs(Math.hypot(a.x - b.x, a.y - b.y) - 1.2) < 0.2);
        assert(Math.hypot(a.x - parent.point.x, a.y - parent.point.y) < 7);
        assert(Math.hypot(b.x - parent.point.x, b.y - parent.point.y) < 7);
        assert.equal(present(helpers[i]).frame(reduced).pose, "idle");
        assert.equal(present(helpers[i + 1]).frame(reduced).pose, "idle");
      }
  }
});

test("crew projection matches scene placement, parent admission and native pane fallback across decks", () => {
  const layout = createModel(canonicalTheme()).createLayout();
  const root: LayoutRow = { id: "root", projectId: "project", repoId: "repo" };
  const helpers: LayoutRow[] = Array.from({ length: 10 }, (_, index) => ({
    id: "helper" + String(index),
    source: "helper",
    parentId: root.id,
  }));
  const native: LayoutRow = {
    ...root,
    id: "native",
    source: "herdr",
    paneId: "p2",
    parentId: root.id,
  };
  const otherRooms: LayoutRow[] = Array.from({ length: 9 }, (_, index) => ({
    id: "other" + String(index),
    projectId: "project" + String(index),
    ...(index === 8 ? { host: "remote" } : {}),
  }));
  layout.reconcile([root, ...helpers, native, ...otherRooms]);
  const projected = Scene.representedRows(layout.allRooms())
    .map((row) => row.id)
    .sort();
  const workers = Array.from(
    { length: layout.pages() },
    (_, page) => Scene.build(layout.onPage(page), page).workers,
  ).flat();
  assert(layout.pages() > 1);
  assert.deepEqual(projected, workers.map((worker) => worker.id).sort());
  assert.equal(workers.filter((worker) => worker.id === native.id).length, 1);
  assert.equal(present(workers.find((worker) => worker.id === native.id)).kind, "session");
  const seat = layout.seatFor(native.id);
  layout.reconcile([root, native, ...otherRooms]);
  assert.equal(
    layout.seatFor(native.id),
    seat,
    "helper visibility preserves authoritative pane allocation",
  );
  assert.equal(
    Scene.representedRows(layout.allRooms()).filter((row) => row.id === native.id).length,
    1,
  );
  const room = present(
    layout.allRooms().find((room) => room.rows.some((value) => value.row.id === root.id)),
  );
  const unsafe = {
    ...room,
    rows: [
      ...room.rows,
      {
        row: { id: "unsafe", source: "helper", parentId: root.id },
        kind: "helper" as const,
        parentId: root.id,
        rootId: root.id,
        block: 0,
        helperSlot: 999,
      },
      {
        row: { id: "nested", source: "helper", parentId: "unsafe" },
        kind: "helper" as const,
        parentId: "unsafe",
        rootId: root.id,
        block: 0,
        helperSlot: 1,
      },
    ],
  };
  const unsafeScene = Scene.build([unsafe], 0);
  assert(!unsafeScene.workers.some((worker) => ["unsafe", "nested"].includes(worker.id)));
  assert.deepEqual(
    Scene.representedRows([unsafe])
      .map((row) => row.id)
      .sort(),
    unsafeScene.workers.map((worker) => worker.id).sort(),
  );
  assert(
    unsafeScene.helperOverflow.some((entry) => entry.id === "unsafe"),
    "unsafe station diagnostics remain available",
  );
});

test("observer-scene regression contracts", () => {
  function advanceUntil(
    movement: ReturnType<typeof Scene.createMovement>,
    range: { from: number; to: number },
    options: MotionOptions = {},
  ) {
    let frames: ActorFrame[] = [];
    for (let now = range.from; now <= range.to; now += 100) frames = movement.step(now, options);
    return frames;
  }
  const Model = createModel(canonicalTheme());
  const row = (i: string | number, project = "p", repo = "r"): LayoutRow => ({
    id: "obs_" + String(i),
    projectId: project,
    project,
    repoId: repo,
    repo,
    provider: "codex",
    status: "idle" as const,
  });
  const layout = Model.createLayout();
  let rows = Array.from({ length: 8 }, (_, i) => row(i));
  layout.reconcile(rows);
  const initial = Scene.build(layout.onPage(0), 0),
    chair = present(initial.workers[0]).chair;
  function verifyGrowthDeskParity() {
    for (const count of [9, 24, 25]) {
      rows = Array.from({ length: count }, (_, i) => row(i));
      layout.reconcile(rows.slice().reverse());
      assert.deepEqual(
        present(Scene.build(layout.onPage(0), 0).workers.find((w) => w.id === "obs_0")).chair,
        chair,
      );
    }
  }
  verifyGrowthDeskParity();
  const scene = Scene.build(layout.onPage(0), 0);
  assert.equal(scene.platforms.length, 2);
  assert.equal(scene.workers.length, 25);
  const contains = (r: Rect, p: Point) =>
    p.x >= r.x - 1e-8 && p.y >= r.y - 1e-8 && p.x <= r.x + r.w + 1e-8 && p.y <= r.y + r.h + 1e-8;
  const floors = [
    ...scene.platforms.map((p) => p.rect),
    ...scene.walkways.map((w) => w.rect),
    scene.mail.rect,
  ];
  function verifyRouteFloorContainment() {
    for (const worker of scene.workers)
      for (let i = 1; i < present(worker.route).length; i++) {
        const a = present(worker.route)[i - 1],
          b = present(worker.route)[i];
        for (let t = 0; t <= 1; t += 0.025)
          assert(
            floors.some((r) =>
              contains(r, {
                x: present(a).x + (present(b).x - present(a).x) * t,
                y: present(a).y + (present(b).y - present(a).y) * t,
              }),
            ),
            "courier stays over continuous floor",
          );
      }
  }
  verifyRouteFloorContainment();
  const revision = scene.revision;
  rows[0] = { ...present(rows[0]), status: "working" as const, title: "new dynamic title" };
  layout.reconcile(rows);
  assert.equal(
    Scene.build(layout.onPage(0), 0).revision,
    revision,
    "status/title changes do not change geometry revision",
  );
  function verifyFolderSections() {
    const folderLayout = Model.createLayout(),
      folderRows = Array.from({ length: 9 }, (_, i) => ({
        ...row("worker" + String(i)),
        source: "herdr",
        provider: "claude",
        folder: "front",
      }));
    folderLayout.reconcile(folderRows);
    const shared = Scene.build(folderLayout.onPage(0), 0);
    assert.equal(present(shared.platforms[0]).sections.length, 1);
    folderRows[8] = { ...present(folderRows[8]), folder: "back" };
    folderLayout.reconcile(folderRows);
    const divided = Scene.build(folderLayout.onPage(0), 0);
    assert.equal(present(divided.platforms[0]).sections.length, 2);
    assert.equal(
      present(present(divided.platforms[0]).sections[1]).partitions.length,
      2,
      "folder separation adds partition walls",
    );
    assert.deepEqual(
      divided.workers.map((w) => [w.id, w.chair]),
      shared.workers.map((w) => [w.id, w.chair]),
      "folder separation can preserve every chair",
    );
    assert.notEqual(
      divided.revision,
      shared.revision,
      "changed section topology invalidates floor and movement caches even with stable chairs",
    );
  }
  verifyFolderSections();
  const small = Model.createLayout();
  small.reconcile([row(0)]);
  const one = Scene.build(small.onPage(0), 0);
  assert(
    one.bounds.maxY - one.bounds.minY < scene.bounds.maxY - scene.bounds.minY,
    "unused slots do not enter occupied fit",
  );
  const many = Model.createLayout();
  many.reconcile(Array.from({ length: 40 }, (_, i) => row(i, "project" + String(i))));
  assert(many.pages() >= 5);
  const first = Scene.build(many.onPage(0), 0),
    offId = Array.from({ length: 40 }, (_, i) => "obs_" + String(i)).find(
      (id) => many.pageFor(id) > 0,
    );
  assert(present(Scene.endpoint(first, many, present(offId)).deck) > 1);
  assert.equal(Scene.endpoint(first, many, "ambiguous").key, "chute");
  assert.deepEqual(Scene.endpoint(one, small, "obs_0").points.at(-1), one.mail.hub);
  const pending = Scene.pending(one, small, [
    { to: "obs_0", wake: "failed" },
    { to: "obs_0", wake: "none" },
    { to: "obs_0", acknowledgedAt: "now" },
  ]);
  assert.equal(present(pending[0]).count, 2);
  assert.deepEqual({ mark: present(pending[0]).mark }, { mark: true });
  function verifyProjectionRoundTrip() {
    for (const point of [
      { x: 3, y: 7 },
      { x: -24, y: 19 },
    ]) {
      const result = Scene.unproject(Scene.project(point));
      assert(Math.abs(result.x - point.x) < 1e-8);
      assert(Math.abs(result.y - point.y) < 1e-8);
    }
  }
  verifyProjectionRoundTrip();
  const viewport = { width: 1000, height: 600 },
    camera = Scene.fit(scene.bounds, viewport);
  assert(camera.zoom > 0 && camera.zoom <= 3);
  const screen = Scene.toScreen(chair, camera),
    round = Scene.fromScreen(screen, camera);
  assert(Math.abs(round.x - chair.x) < 1e-8 && Math.abs(round.y - chair.y) < 1e-8);
  const expansive = { minX: -2000, minY: -2000, maxX: 2000, maxY: 2000 };
  const anchor = { x: 600, y: 330 },
    before = Scene.fromScreen(anchor, { zoom: 1, tx: 500, ty: 300 });
  const zoomed = Scene.zoomAt({ zoom: 1, tx: 500, ty: 300 }, anchor, 1.25, expansive, viewport);
  assert.deepEqual(Scene.toScreen(before, zoomed), anchor, "unconstrained zoom preserves cursor");
  const constrained = Scene.zoomAt(
    { zoom: 1, tx: 200, ty: 200 },
    { x: 275, y: 250 },
    2,
    { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    { width: 500, height: 500 },
  );
  assert.equal(constrained.tx, 150, "small axes center before cursor anchoring");
  assert(Object.values(Scene.fit(scene.bounds, { width: 0, height: NaN })).every(Number.isFinite));
  assert.equal(
    Scene.hitTest({ x: 5, y: 5 }, [
      { id: "back", left: 0, top: 0, width: 10, height: 10, depth: 1 },
      { id: "front", left: 0, top: 0, width: 10, height: 10, depth: 2 },
    ]),
    "front",
  );
  const movement = Scene.createMovement();
  movement.reconcile(one, { now: 0, stale: false, reduced: false });
  let previous = movement.step(0, { stale: false, reduced: false })[0];
  const spriteDirections = [
    "east",
    "south-east",
    "south",
    "south-west",
    "west",
    "north-west",
    "north",
    "north-east",
  ];
  function verifyInitialMovement() {
    for (let now = 100; now <= 30000; now += 100) {
      const current = movement.step(now, { stale: false, reduced: false })[0];
      assert(contains(present(one.platforms[0]).rect, present(current).point));
      assert(
        !contains({ ...present(one.workers[0]).desk, w: 1.999, h: 0.999 }, present(current).point),
        "idle route avoids desk",
      );
      assert(
        Math.hypot(
          present(current).point.x - present(previous).point.x,
          present(current).point.y - present(previous).point.y,
        ) <= 0.161,
        "speed is capped",
      );
      assert(
        spriteDirections.includes(present(current).direction),
        "direction matches existing SPRITES vocabulary",
      );
      if (now === 6000) {
        movement.reconcile(one, { now, stale: false, reduced: false });
        assert.deepEqual(
          movement.step(now, {})[0],
          current,
          "ordinary polls preserve a walk and pose",
        );
      }
      previous = current;
    }
  }
  verifyInitialMovement();
  const frozen = movement.step(30100, { stale: true, reduced: false })[0];
  assert.deepEqual(
    present(movement.step(40000, { stale: true, reduced: false })[0]).point,
    present(frozen).point,
  );
  small.reconcile([{ ...row(0), status: "working" }]);
  movement.reconcile(Scene.build(small.onPage(0), 0), { now: 40000, stale: false, reduced: false });
  previous = advanceUntil(
    movement,
    { from: 40100, to: 90000 },
    { stale: false, reduced: false },
  )[0];
  assert.equal(present(previous).pose, "working");
  assert.deepEqual(present(previous).point, present(one.workers[0]).chair);
  assert.equal(present(previous).direction, "south");
  assert.deepEqual(
    present(movement.step(100000, { stale: false, reduced: true })[0]).point,
    present(one.workers[0]).chair,
  );
  movement.reconcile(Scene.build([], 1), { now: 100000, stale: false, reduced: true });
  assert.deepEqual(movement.step(100100, {}), []);
  const seated = Scene.createMovement();
  seated.reconcile(Scene.build(small.onPage(0), 0), { now: 0 });
  assert.equal(
    present(seated.step(100, {})[0]).pose,
    "working",
    "fresh working bodies stay seated without a gratuitous shuffle",
  );
  const mixed = Model.createLayout();
  mixed.reconcile(Array.from({ length: 17 }, (_, i) => row(i, "p", i < 16 ? "repo-a" : "repo-b")));
  const sections = present(Scene.build(mixed.onPage(0), 0).platforms[0]).sections;
  assert.deepEqual(
    sections.map((s) => s.repo),
    ["repo-a", "repo-b"],
  );
  assert.equal(present(sections[0]).rect.h, 14);
  const recovering = Scene.createMovement();
  recovering.reconcile(one, { now: 0 });
  let stroll;
  stroll = advanceUntil(recovering, { from: 0, to: 6500 }, {});
  const away = present(present(stroll)[0]).point;
  assert(
    Math.hypot(away.x - present(one.workers[0]).chair.x, away.y - present(one.workers[0]).chair.y) >
      0.1,
  );
  const workingScene = Scene.build(small.onPage(0), 0);
  recovering.reconcile(workingScene, { now: 6500, stale: true });
  recovering.step(8000, { stale: true });
  recovering.reconcile(workingScene, { now: 8000, stale: false });
  const homeward = present(recovering.step(8100, {})[0]).point;
  assert(
    Math.hypot(
      homeward.x - present(one.workers[0]).chair.x,
      homeward.y - present(one.workers[0]).chair.y,
    ) <
      Math.hypot(
        away.x - present(one.workers[0]).chair.x,
        away.y - present(one.workers[0]).chair.y,
      ),
    "recovery replaces old roaming intent immediately",
  );
  stroll = advanceUntil(recovering, { from: 8100, to: 30000 }, {});
  assert.deepEqual(
    present(present(stroll)[0]).point,
    present(one.workers[0]).chair,
    "status changed while stale returns to chair on recovery",
  );
  assert.equal(present(present(stroll)[0]).pose, "working");
  const blockedLayout = Model.createLayout();
  blockedLayout.reconcile([{ ...row(0), status: "blocked" }]);
  const waiting = Scene.createMovement();
  waiting.reconcile(one, { now: 0 });
  advanceUntil(waiting, { from: 0, to: 5900 }, {});
  waiting.reconcile(Scene.build(blockedLayout.onPage(0), 0), { now: 5900, stale: true });
  waiting.step(7000, { stale: true });
  waiting.reconcile(Scene.build(blockedLayout.onPage(0), 0), { now: 7000, stale: false });
  stroll = advanceUntil(waiting, { from: 7100, to: 25000 }, {});
  assert.deepEqual(present(present(stroll)[0]).point, present(one.workers[0]).chair);
  assert.equal(present(present(stroll)[0]).pose, "waiting");
  console.log(
    "observer scene: stable seats/decks, connected routes, truthful endpoints, projection/camera/hit tests, contained capped movement and stale/reduced/work return OK",
  );

  assert.equal(present(sections[0]).partitions.length, 0);
  assert.equal(present(sections[1]).partitions.length, 2);
  const partitionScene = Scene.build(mixed.onPage(0), 0),
    deck = partitionScene.platforms[0];
  assert.deepEqual(present(sections[1]).partitions, [
    { x: present(deck).rect.x + 1, y: present(deck).rect.y + 17, w: 8, h: 1 },
    { x: present(deck).rect.x + 11, y: present(deck).rect.y + 17, w: 8, h: 1 },
  ]);
  const partitionWalkers = Scene.createMovement();
  partitionWalkers.reconcile(partitionScene, { now: 0 });
  function verifyPartitionAvoidance() {
    for (let now = 0; now <= 120000; now += 100)
      for (const actor of partitionWalkers.step(now)) {
        assert(
          !sections
            .flatMap((section) => section.partitions)
            .some(
              (rect) =>
                actor.point.x > rect.x + 1e-8 &&
                actor.point.x < rect.x + rect.w - 1e-8 &&
                actor.point.y > rect.y + 1e-8 &&
                actor.point.y < rect.y + rect.h - 1e-8,
            ),
          "movement never crosses a repository partition",
        );
      }
  }
  verifyPartitionAvoidance();
  // Future repository boundaries remain reserved as crew count grows.
  const reserved = {
    x: present(one.platforms[0]).rect.x + 1,
    y: present(one.platforms[0]).rect.y + 10,
    w: 8,
    h: 1,
  };
  const growing = Scene.createMovement();
  growing.reconcile(one, { now: 0 });
  function verifyGrowthReservation() {
    for (let now = 0; now <= 120000; now += 100) {
      const point = present(growing.step(now)[0]).point;
      assert(
        !(
          point.x > reserved.x &&
          point.x < reserved.x + reserved.w &&
          point.y > reserved.y &&
          point.y < reserved.y + reserved.h
        ),
        "future partition does not appear under a worker",
      );
    }
  }
  verifyGrowthReservation();
  console.log("repository partition geometry and safe movement OK");

  function verifyOwnSourceFreshness() {
    const sourceLayout = Model.createLayout();
    const herdr = { ...row("herdr"), source: "herdr", inventoryHealth: "unavailable" as const };
    const desktop = {
      ...row("desktop", "desktop"),
      source: "desktop",
      inventoryHealth: "available" as const,
    };
    sourceLayout.reconcile([herdr, desktop]);
    const sourceScene = Scene.build(sourceLayout.onPage(0), 0);
    const staleWorker = (worker: Worker) => worker.row.inventoryHealth !== "available";
    const motion = Scene.createMovement();
    motion.reconcile(sourceScene, { now: 0, stale: staleWorker });
    let desktopWalked = false;
    for (let now = 0; now <= 12000; now += 100) {
      const actors = motion.step(now, { stale: staleWorker });
      const retained = actors.find((actor) => actor.id === herdr.id),
        fresh = actors.find((actor) => actor.id === desktop.id);
      assert.deepEqual(
        present(retained).point,
        present(sourceScene.workers.find((worker: Worker) => worker.id === herdr.id)).chair,
        "fresh Desktop cannot move stale Herdr",
      );
      assert.equal(present(retained).pose, "idle");
      desktopWalked ||= present(fresh).pose === "walk";
    }
    assert(desktopWalked, "row predicate must allow fresh Desktop movement beside stale Herdr");

    const transitioning = Scene.createMovement();
    transitioning.reconcile(one, { now: 0 });
    let walking;
    walking = advanceUntil(transitioning, { from: 0, to: 6500 })[0];
    assert.equal(present(walking).pose, "walk");
    const retainedWorker = (worker: Worker) => worker.id === "obs_0";
    transitioning.reconcile(workingScene, { now: 6500, stale: retainedWorker });
    const paused = transitioning.step(8000, { stale: retainedWorker })[0];
    assert.deepEqual(
      present(paused).point,
      present(walking).point,
      "status changes while stale cannot move frozen feet",
    );
    assert.equal(present(paused).pose, "idle", "stale walking/working status has idle pose");
    assert.deepEqual(
      transitioning.step(10000, { stale: retainedWorker })[0],
      paused,
      "stale steps preserve feet and direction",
    );
    // Recovery without another poll must replace the frozen roam with the latest working intent.
    walking = advanceUntil(transitioning, { from: 10100, to: 40000 }, { stale: () => false })[0];
    assert.deepEqual(present(walking).point, present(one.workers[0]).chair);
    assert.equal(present(walking).pose, "working");

    const defaults = Scene.createMovement(),
      boolean = Scene.createMovement(),
      predicate = Scene.createMovement();
    defaults.reconcile(one, { now: 0 });
    boolean.reconcile(one, { now: 0, stale: false });
    predicate.reconcile(one, { now: 0, stale: () => false });
    for (let now = 0; now <= 6500; now += 100) {
      const expected = defaults.step(now);
      assert.deepEqual(
        boolean.step(now, { stale: false }),
        expected,
        "false keeps default movement semantics",
      );
      assert.deepEqual(
        predicate.step(now, { stale: () => false }),
        expected,
        "false predicate matches boolean movement",
      );
    }
    boolean.reconcile(workingScene, { now: 6500, stale: true });
    predicate.reconcile(workingScene, { now: 6500, stale: () => true });
    for (const now of [6600, 8000, 10000])
      assert.deepEqual(
        predicate.step(now, { stale: () => true }),
        boolean.step(now, { stale: true }),
        "true predicate matches global freeze",
      );
    boolean.reconcile(workingScene, { now: 10000, stale: false });
    predicate.reconcile(workingScene, { now: 10000, stale: () => false });
    for (let now = 10100; now <= 40000; now += 100)
      assert.deepEqual(
        predicate.step(now, { stale: () => false }),
        boolean.step(now, { stale: false }),
        "predicate recovery matches boolean return to chair",
      );
  }
  verifyOwnSourceFreshness();
  console.log(
    "per-worker freshness, frozen transitions, recovery and boolean/default movement parity OK",
  );

  function verifyObservatoryAndPlatformHits() {
    const overlap = (a: Rect, b: Rect) =>
      a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
    const eightLayout = Model.createLayout();
    eightLayout.reconcile(Array.from({ length: 8 }, (_, i) => row(i, "wing" + String(i))));
    const eight = Scene.build(eightLayout.onPage(0), 0),
      observatory = eight.observatory;
    assert.deepEqual(observatory.rect, { x: 0, y: -14, w: 14, h: 10 });
    assert.equal(present(observatory.viewer).id, "observer_viewer");
    assert.equal(present(observatory.viewer).label, "Viewer");
    assert.equal(observatory.screens.length, 2);
    assert.equal(observatory.telescopes.length, 2);
    assert(!eight.workers.some((w) => w.id === present(observatory.viewer).id));
    assert.equal(Scene.endpoint(eight, eightLayout, present(observatory.viewer).id).key, "chute");
    for (const floor of [
      eight.mail.rect,
      ...eight.platforms.map((p) => p.rect),
      ...eight.walkways.filter((w) => w.kind !== "observatory-link").map((w) => w.rect),
    ])
      assert(!overlap(observatory.rect, floor));
    function verifyProjectedObservatorySupport() {
      for (const part of observatory.extents)
        for (const x of [part.rect.x, part.rect.x + part.rect.w])
          for (const y of [part.rect.y, part.rect.y + part.rect.h]) {
            const projected = Scene.project({ x, y, z: part.height });
            assert(
              projected.x >= eight.bounds.minX &&
                projected.x <= eight.bounds.maxX &&
                projected.y >= eight.bounds.minY &&
                projected.y <= eight.bounds.maxY,
              "tall observatory support enters fit bounds",
            );
          }
    }
    verifyProjectedObservatorySupport();
    function verifyPlatformCameraSupport() {
      for (const platform of eight.platforms) {
        const support = Scene.platformBounds(eight, platform.key);
        for (const viewport of [
          { width: 1000, height: 600 },
          { width: 180, height: 100 },
        ]) {
          const camera = Scene.focusPlatform(eight, platform.key, viewport);
          assert.deepEqual(
            Scene.pan(present(camera), { x: 0, y: 0 }, eight.bounds, viewport),
            camera,
          );
          for (const x of [present(support).minX, present(support).maxX])
            for (const y of [present(support).minY, present(support).maxY]) {
              assert(
                x * present(camera).zoom + present(camera).tx >= 23.99 &&
                  x * present(camera).zoom + present(camera).tx <= viewport.width - 23.99,
              );
              assert(
                y * present(camera).zoom + present(camera).ty >= 23.99 &&
                  y * present(camera).zoom + present(camera).ty <= viewport.height - 23.99,
              );
            }
          const at = { x: platform.rect.x + 10, y: platform.rect.y + 13 };
          assert.equal(
            Scene.hitPlatform(Scene.toScreen(at, present(camera)), eight, present(camera)),
            platform.key,
          );
        }
      }
    }
    verifyPlatformCameraSupport();
    assert.equal(Scene.platformBounds(eight, "gone"), null);
    assert.equal(Scene.focusPlatform(eight, "gone", { width: 800, height: 600 }), null);
    const tied = {
      ...eight,
      platforms: [
        { ...present(eight.platforms[0]), key: "z" },
        { ...present(eight.platforms[0]), key: "a" },
      ],
    };
    const tieCamera = Scene.fit(eight.bounds, viewport);
    assert.equal(
      Scene.hitPlatform(
        Scene.toScreen(
          {
            x: present(present(tied.platforms[0]).rect).x + 2,
            y: present(present(tied.platforms[0]).rect).y + 2,
          },
          tieCamera,
        ),
        tied,
        tieCamera,
      ),
      "a",
      "platform tie is stable by key",
    );
    assert.equal(
      Scene.hitPlatform(
        Scene.toScreen(eight.mail.hub, Scene.fit(eight.bounds, viewport)),
        eight,
        Scene.fit(eight.bounds, viewport),
      ),
      null,
    );
    verifyHelperCollisionAndLifecycle();
    function verifyHelperCollisionAndLifecycle() {
      const helperLayout = Model.createLayout(),
        roots = Array.from({ length: 8 }, (_, i) => row(i));
      helperLayout.reconcile(roots);
      const baseline = Scene.build(helperLayout.onPage(0), 0);
      const helpers: LayoutRow[] = Array.from({ length: 10 }, (_, i) => ({
        id: "h" + String(i),
        source: "helper",
        parentId: present(roots[0]).id,
        status: "unknown" as const,
      }));
      present(helpers[1]).parentId = present(helpers[0]).id;
      helperLayout.reconcile([...helpers.slice(0, 2), ...roots]);
      helperLayout.reconcile([...helpers, ...roots]);
      const dense = Scene.build(helperLayout.onPage(0), 0);
      assert.equal(dense.workers.filter((w) => w.kind === "helper").length, 8);
      assert.equal(dense.helperOverflow.length, 2);
      for (const root of baseline.workers) {
        assert.deepEqual(present(dense.workers.find((w) => w.id === root.id)).chair, root.chair);
        assert.deepEqual(
          present(dense.workers.find((w) => w.id === root.id)).route,
          root.route,
          "helper arrival preserves root courier path",
        );
      }
      const futureLayout = Model.createLayout();
      futureLayout.reconcile(Array.from({ length: 24 }, (_, i) => row(i)));
      const futureDesks = Scene.build(futureLayout.onPage(0), 0).workers.map((w) => w.desk);
      const children = dense.workers.filter((w) => w.kind === "helper");
      for (const child of children) {
        assert.equal(child.scale, 0.72);
        assert.equal(child.parentId, child.row.parentId);
        assert(contains(present(present(dense.platforms[0]).sections[0]).rect, child.chair));
        assert(
          ![
            ...dense.workers.filter((w) => w !== child).map((w) => w.desk),
            ...present(dense.platforms[0]).sections.flatMap((s) => s.partitions),
          ].some((r) => overlap(child.desk, r)),
          "helper desk collisions rejected",
        );
        assert(
          !futureDesks.some((desk) => overlap(present(child.station), desk)),
          "helper chair and desk avoid future root furniture",
        );
        for (const y of [4.75, 7.75])
          assert(
            !overlap(present(child.station), {
              x: present(dense.platforms[0]).rect.x + 1,
              y: present(dense.platforms[0]).rect.y + y - 0.25,
              w: 18,
              h: 0.5,
            }),
            "helper station reserves courier walk lanes",
          );
        assert.equal(
          Scene.endpoint(dense, helperLayout, child.id).key,
          "chute",
          "unknown helper cannot invent a courier endpoint",
        );
      }
      assert.deepEqual(
        present(children.find((w) => w.id === "h1")).anchor,
        present(children.find((w) => w.id === "h0")).chair,
        "chain tether uses immediate represented parent",
      );
      const motion = Scene.createMovement();
      motion.reconcile(baseline, { now: 0 });
      advanceUntil(motion, { from: 0, to: 5900 });
      motion.reconcile(dense, { now: 5900 });
      for (let now = 6000; now <= 60000; now += 100)
        for (const actor of motion.step(now)) {
          const worker = dense.workers.find((w) => w.id === actor.id);
          if (present(worker).kind === "helper")
            assert.deepEqual(
              actor.point,
              present(worker).chair,
              "unknown helpers remain stationary",
            );
          else
            assert(
              !children.some((w) => contains(w.desk, actor.point)),
              "roots cannot walk through helper stations",
            );
        }
      const positions = new Map(children.map((w) => [w.id, w.chair]));
      helperLayout.reconcile([
        ...roots,
        ...helpers.map((h) =>
          h.id === "h0" ? { ...h, source: "herdr", status: "working" as const } : h,
        ),
      ]);
      const liveScene = Scene.build(helperLayout.onPage(0), 0);
      motion.reconcile(liveScene, { now: 60100 });
      const live = motion.step(60200).find((w) => w.id === "h0");
      assert.equal(present(live).pose, "working");
      assert.deepEqual(
        present(live).point,
        positions.get("h0"),
        "authoritative helper own status remains seated",
      );
      assert.equal(
        Scene.endpoint(liveScene, helperLayout, "h0").key,
        "chute",
        "seated helper has no guessed courier path",
      );
      helperLayout.reconcile([
        ...roots,
        ...helpers
          .slice()
          .reverse()
          .filter((w) => w.id !== "h7"),
      ]);
      const reordered = Scene.build(helperLayout.onPage(0), 0);
      for (const child of reordered.workers.filter((w) => w.kind === "helper"))
        if (positions.has(child.id))
          assert.deepEqual(child.chair, positions.get(child.id), "surviving helper slots stable");
    }
  }
  verifyObservatoryAndPlatformHits();
  console.log(
    "Observatory, platform target geometry, helper collision/overflow/tethers and safe stationary lifecycle OK",
  );

  // Verified ambient formation must move unknown helpers without borrowing parent status.
  function verifyHelperStationsAndOverflow() {
    const formationLayout = Model.createLayout();
    const parent = row("formation");
    const helper = {
      id: "formation-helper",
      source: "helper",
      parentId: parent.id,
      lineageState: "open",
      status: "unknown" as const,
      lifecycleEvidence: { state: "open", reason: null },
    };
    formationLayout.reconcile([parent, helper]);
    const formation = Scene.build(formationLayout.onPage(0), 0);
    const motion = Scene.createMovement();
    motion.reconcile(formation, { now: 0 });
    const desk = present(formation.workers.find((w) => w.id === helper.id)).chair;
    let followed = false;
    for (let now = 0; now <= 60000; now += 100) {
      const actor = motion.step(now).find((a) => a.id === helper.id);
      followed ||= Math.hypot(present(actor).point.x - desk.x, present(actor).point.y - desk.y) > 1;
      assert.notEqual(present(actor).pose, "working", "ambient formation never invents own work");
    }
    assert(followed, "fresh verified unknown helper follows idle parent");
  }
  verifyHelperStationsAndOverflow();

  // Independent clipping oracle checks whole segments, including reserved future furniture.
  const intersectsFurniture = (r: Rect, a: Point, b: Point) => {
    const intervals = (
      [
        ["x", "w"],
        ["y", "h"],
      ] as const
    ).map(([axis, size]) => {
      const min = r[axis] + 1e-7,
        max = r[axis] + r[size] - 1e-7,
        delta = b[axis] - a[axis];
      if (Math.abs(delta) < 1e-12)
        return a[axis] > min && a[axis] < max ? [-Infinity, Infinity] : [Infinity, -Infinity];
      const crossings = [(min - a[axis]) / delta, (max - a[axis]) / delta];
      return [Math.min(...crossings), Math.max(...crossings)];
    });
    return (
      Math.max(0, ...intervals.map((i) => present(i[0]))) <=
      Math.min(1, ...intervals.map((i) => present(i[1])))
    );
  };
  const reservedFurniture = (platform: Platform) => {
    const r = platform.rect;
    return Array.from({ length: 24 }, (_, i) => ({
      x: r.x + present([2, 6, 12, 16][i % 4]),
      y: r.y + 6 + Math.floor(i / 8) * 7 + Math.floor((i % 8) / 4) * 3,
      w: 2,
      h: 1,
    })).concat(
      [1, 2].flatMap((block) =>
        [1, 11].map((x) => ({ x: r.x + x, y: r.y + 3 + block * 7, w: 8, h: 1 })),
      ),
      [0, 1, 2].flatMap((block) =>
        Model.helperStations.map((offset) => ({
          x: r.x + offset.x,
          y: r.y + block * 7 + offset.y - 0.51,
          w: offset.w,
          h: offset.h + 0.51,
        })),
      ),
      platform.decorationRegions.filter((d) => d.kind !== "apron").map((d) => d.rect),
    );
  };
  const assertSafeTravel = (scene: SceneValue, previous: ActorFrame, current: ActorFrame) => {
    const worker = scene.workers.find((w) => w.id === current.id),
      platform = scene.platforms.find((p) => p.key === present(worker).platformKey);
    const furniture = reservedFurniture(present(platform)).map((r) =>
      present(worker).station &&
      r.x === present(present(worker).station).x &&
      r.y === present(present(worker).station).y &&
      r.w === present(present(worker).station).w &&
      r.h === present(present(worker).station).h
        ? present(worker).desk
        : r,
    );
    assert(
      Math.hypot(current.point.x - previous.point.x, current.point.y - previous.point.y) <=
        0.160001,
      "every transition has capped speed, including joins and returns",
    );
    assert(
      contains(present(platform).rect, current.point) &&
        contains(present(platform).rect, previous.point),
      "formation stays on its own platform",
    );
    assert(
      !furniture.some((r) => intersectsFurniture(r, previous.point, current.point)),
      "whole departure, arrival and turn joins avoid actual and reserved furniture",
    );
  };
  const formationFixture = (
    count = 8,
    { nested = false, leaderId = null }: { nested?: boolean; leaderId?: string | null } = {},
  ) => {
    const layout = Model.createLayout(),
      parent = leaderId ? { ...row("leader"), id: leaderId } : row("leader"),
      other = { ...row("other"), status: "working" as const };
    const helpers: LayoutRow[] = Array.from({ length: count }, (_, i) => ({
      id: "follower-" + String(i),
      source: "helper",
      status: "unknown" as const,
      parentId: nested && i === 1 ? "follower-0" : parent.id,
      lineageState: i % 2 ? "verified" : "open",
      lifecycleEvidence: { state: "open", reason: null },
    }));
    // Fill all three blocks, exercising reserved future desks and narrow partition doors.
    const roots = [
      parent,
      other,
      ...Array.from({ length: 15 }, (_, i) => ({
        ...row("furniture-" + String(i), "p", i < 14 ? "r" : "second"),
        status: "working" as const,
      })),
    ];
    const build = () => {
      layout.reconcile([...roots, ...helpers]);
      return Scene.build(layout.onPage(0), 0);
    };
    return { layout, parent, roots, helpers, build };
  };
  function verifySafeHistoricalFormation() {
    const fixture = formationFixture(),
      scene = fixture.build(),
      motion = Scene.createMovement(),
      control = Scene.createMovement();
    motion.reconcile(scene, { now: 0 });
    control.reconcile(scene, { now: 0 });
    let previous = new Map(motion.step(0).map((a) => [a.id, a]));
    control.step(0);
    const walked = new Set<string>(),
      turns = new Set<string>(),
      crossedDoors = new Set<string>(),
      histories = new Map<string, string>();
    function verifyUnknownFollower(actor: ActorFrame) {
      if (actor.id.startsWith("follower-")) {
        const worker = scene.workers.find((w) => w.id === actor.id);
        if (
          Math.hypot(
            actor.point.x - present(worker).chair.x,
            actor.point.y - present(worker).chair.y,
          ) > 1
        )
          walked.add(actor.id);
        if (actor.point.y > present(scene.platforms[0]).rect.y + 18) crossedDoors.add(actor.id);
        const lastDirection = histories.get(actor.id);
        if (actor.pose === "walk" && lastDirection && actor.direction !== lastDirection)
          turns.add(actor.id);
        if (actor.pose === "walk") histories.set(actor.id, actor.direction);
        assert.notEqual(actor.pose, "working");
        assert.equal(
          present(worker).row.status,
          "unknown",
          "positioning never mutates observed status",
        );
      }
    }
    for (let now = 100; now <= 180000; now += 100) {
      if (now % 5000 === 0) {
        fixture.helpers.reverse();
        motion.reconcile(fixture.build(), { now });
      }
      const current = motion.step(now);
      assert.deepEqual(
        current,
        control.step(now),
        "polls and helper input order preserve formation trajectories",
      );
      for (const actor of current) {
        assertSafeTravel(scene, present(previous.get(actor.id)), actor);
        verifyUnknownFollower(actor);
      }
      previous = new Map(current.map((a) => [a.id, a]));
    }
    assert.equal(walked.size, 8, "all eight stations can depart and join historical formation");
    assert.equal(turns.size, 8, "all eight followers safely negotiate turns");
    assert.equal(
      crossedDoors.size,
      8,
      "all eight followers traverse narrow reserved partition doors",
    );
    // Parent work replaces formation intent, without a teleport or retained roam target.
    let clock = 180000;
    function verifyParentStatusReturn(status: "working" | "blocked") {
      if (status === "blocked") {
        fixture.roots[0] = { ...present(fixture.roots[0]), status: "idle" as const };
        const strolling = fixture.build();
        motion.reconcile(strolling, { now: clock });
        for (let now = clock + 100; now <= clock + 40000; now += 100) {
          const current = motion.step(now);
          for (const actor of current)
            assertSafeTravel(strolling, present(previous.get(actor.id)), actor);
          previous = new Map(current.map((a) => [a.id, a]));
        }
        clock += 40000;
        assert(
          fixture.helpers.some(
            (h) =>
              Math.hypot(
                present(previous.get(h.id)).point.x -
                  present(strolling.workers.find((w) => w.id === h.id)).chair.x,
                present(previous.get(h.id)).point.y -
                  present(strolling.workers.find((w) => w.id === h.id)).chair.y,
              ) > 1,
          ),
          "blocked return starts with helpers away from desks",
        );
      }
      fixture.roots[0] = { ...present(fixture.roots[0]), status };
      const returning = fixture.build();
      motion.reconcile(returning, { now: clock });
      const unchanged = motion.step(clock);
      for (const actor of unchanged)
        assert.deepEqual(
          actor.point,
          present(previous.get(actor.id)).point,
          "parent status change cannot teleport helpers",
        );
      for (let now = clock + 100; now <= clock + 50000; now += 100) {
        const current = motion.step(now);
        for (const actor of current)
          assertSafeTravel(returning, present(previous.get(actor.id)), actor);
        previous = new Map(current.map((a) => [a.id, a]));
      }
      clock += 50000;
      for (const helper of fixture.helpers)
        assert.deepEqual(
          present(previous.get(helper.id)).point,
          present(returning.workers.find((w) => w.id === helper.id)).chair,
          "parent work/blocked returns own helper desks",
        );
    }
    for (const status of ["working", "blocked"] as const) verifyParentStatusReturn(status);
  }
  verifySafeHistoricalFormation();
  function verifyNestedFormationLifecycle() {
    const fixture = formationFixture(3, { nested: true }),
      scene = fixture.build(),
      motion = Scene.createMovement();
    motion.reconcile(scene, { now: 0 });
    let actors;
    actors = advanceUntil(motion, { from: 0, to: 90000 });
    const nested = present(actors).find((a) => a.id === "follower-1");
    assert(
      Math.hypot(
        present(nested).point.x -
          present(scene.workers.find((w) => w.id === present(nested).id)).chair.x,
        present(nested).point.y -
          present(scene.workers.find((w) => w.id === present(nested).id)).chair.y,
      ) > 1,
      "nested helper follows represented immediate helper",
    );
    const stale = (worker: Worker) => worker.id === fixture.parent.id;
    const frozen = motion.step(90100, { stale });
    for (let now = 90200; now <= 94000; now += 100)
      assert.deepEqual(
        motion.step(now, { stale }),
        frozen,
        "ancestor source withdrawal freezes nested feet and poses",
      );
    fixture.helpers[0] = { ...present(fixture.helpers[0]), status: "blocked" };
    const blocked = fixture.build();
    motion.reconcile(blocked, { now: 94000 });
    actors = advanceUntil(motion, { from: 94100, to: 140000 });
    for (const id of ["follower-0", "follower-1"])
      assert.deepEqual(
        present(present(actors).find((a) => a.id === id)).point,
        present(blocked.workers.find((w) => w.id === id)).chair,
        "own blocked beats formation and nested child returns",
      );
    assert.equal(present(present(actors).find((a) => a.id === "follower-0")).pose, "waiting");
    fixture.helpers[0] = { ...present(fixture.helpers[0]), status: "working" };
    const working = fixture.build();
    motion.reconcile(working, { now: 140000 });
    actors = advanceUntil(motion, { from: 140100, to: 145000 });
    assert.equal(present(present(actors).find((a) => a.id === "follower-0")).pose, "working");
    fixture.helpers[0] = {
      ...present(fixture.helpers[0]),
      lifecycleEvidence: { state: "closed", reason: null },
    };
    const closed = fixture.build();
    motion.reconcile(closed, { now: 145000 });
    const stopped = motion.step(145100);
    for (let now = 145200; now <= 150000; now += 100)
      assert.deepEqual(
        motion.step(now).filter((a) => ["follower-0", "follower-1"].includes(a.id)),
        stopped.filter((a) => ["follower-0", "follower-1"].includes(a.id)),
        "explicit lifecycle closure overrides historical working and freezes descendants",
      );
    assert.equal(present(stopped.find((a) => a.id === "follower-0")).pose, "idle");
    const reduced = motion.step(150100, { reduced: true });
    for (const actor of reduced)
      assert.deepEqual(
        actor.point,
        present(closed.workers.find((w) => w.id === actor.id)).chair,
        "reduced motion parks all own desks",
      );
    fixture.helpers[0] = {
      ...present(fixture.helpers[0]),
      status: "unknown" as const,
      lifecycleEvidence: { state: "open", reason: null },
      parentId: present(fixture.roots[1]).id,
    };
    const reparented = fixture.build();
    motion.reconcile(reparented, { now: 150100 });
    actors = advanceUntil(motion, { from: 150200, to: 160000 });
    for (const id of ["follower-0", "follower-1"])
      assert.deepEqual(
        present(present(actors).find((a) => a.id === id)).point,
        present(reparented.workers.find((w) => w.id === id)).chair,
        "reparenting clears old parent trail",
      );
    fixture.helpers.splice(0, 2);
    const removed = fixture.build();
    motion.reconcile(removed, { now: 160000 });
    assert(
      !motion.step(160100).some((a) => ["follower-0", "follower-1"].includes(a.id)),
      "removed helper states cannot survive reconciliation",
    );
    motion.reconcile(Scene.build([], 1), { now: 160100 });
    assert.deepEqual(motion.step(160200), [], "page change clears followers and trails");
    motion.reset();
    motion.reconcile(scene, { now: 200000 });
    for (const actor of motion.step(200000))
      assert.deepEqual(
        actor.point,
        present(scene.workers.find((w) => w.id === actor.id)).chair,
        "reset cannot resurrect an old trail",
      );
  }
  verifyNestedFormationLifecycle();
  console.log(
    "Verified formations: eight safe departures/turns/returns, deterministic polls, nested freshness/work/closure and bounded lifecycle cleanup OK",
  );

  // This oracle derives axes and lag from public leader travel, not movement internals.
  function assertRestingPairs(
    actors: ActorFrame[],
    leader: ActorFrame,
    count: number,
    now: number,
  ) {
    const helpers = actors.filter((actor) => actor.id.startsWith("follower-"));
    assert.equal(helpers.length, count, "resting crew retains every admitted helper");
    helpers.forEach((helper, i) => {
      assert(
        Math.hypot(helper.point.x - leader.point.x, helper.point.y - leader.point.y) <
          3.2 + 1.2 * Math.floor(i / 2),
        `resting group includes singleton/odd tail: count ${String(count)}, time ${String(now)}`,
      );
    });
    for (let i = 0; i + 1 < helpers.length; i += 2) {
      const a = present(helpers[i]).point,
        b = present(helpers[i + 1]).point;
      assert(
        Math.abs(Math.hypot(a.x - b.x, a.y - b.y) - 1.2) < 0.2,
        `resting parent holds compact pairs: count ${String(count)}, time ${String(now)}, ${JSON.stringify(helpers)}`,
      );
    }
  }
  function assertWalkingPairs(
    actors: ActorFrame[],
    leader: ActorFrame,
    axis: Point,
    count: number,
  ) {
    const offsets = actors
      .filter((actor) => actor.id.startsWith("follower-"))
      .map((actor) => {
        const dx = actor.point.x - leader.point.x,
          dy = actor.point.y - leader.point.y;
        return { lag: -(dx * axis.x + dy * axis.y), side: -dx * axis.y + dy * axis.x };
      });
    assert.equal(offsets.length, count, "walking crew retains every admitted helper");
    offsets.forEach((offset, i) => {
      const row = Math.floor(i / 2),
        depth = 1.6 + row * 1.2,
        side = i === count - 1 && count % 2 ? 0 : i % 2 ? 0.6 : -0.6;
      assert(
        // Keep the established public-coordinate lag allowance, including quantized targets.
        offset.lag >= depth - 0.1 && offset.lag <= depth + 3.2,
        `walking row lag includes every helper: ${JSON.stringify({ count, i, offsets })}`,
      );
      assert(Math.abs(offset.side - side) < 0.2, "walking pair axis and centered odd tail");
      if (i % 2)
        assert(
          Math.abs(offset.lag - present(offsets[i - 1]).lag) < 0.4,
          "walking pair stays side by side",
        );
    });
  }
  function recordStraightTravel(
    run: { axis: Point; distance: number },
    before: Point,
    point: Point,
  ) {
    const dx = point.x - before.x,
      dy = point.y - before.y,
      distance = Math.hypot(dx, dy);
    if (distance < 1e-8) return run;
    const axis = { x: dx / distance, y: dy / distance, z: 0 };
    return {
      axis,
      distance:
        run.axis.x * axis.x + run.axis.y * axis.y > 0.999 ? run.distance + distance : distance,
    };
  }
  function verifySustainedRoomRest(count: number) {
    const fixture = formationFixture(count),
      scene = fixture.build(),
      parent = present(scene.workers.find((worker) => worker.id === fixture.parent.id)),
      platform = present(scene.platforms.find((value) => value.key === parent.platformKey)),
      motion = Scene.createMovement();
    // The first room's open cross-aisle, with all real furniture and collision checks intact.
    parent.home = { x: platform.rect.x + 2, y: platform.rect.y + 4, w: 16, h: 1 };
    motion.reconcile(scene, { now: 0 });
    let restingSince = 0,
      settledRests = 0,
      run: { axis: Point; distance: number } = { axis: { x: 0, y: 0, z: 0 }, distance: 0 },
      walkingSamples = 0,
      walkingCycles = 0,
      walkingCycleSamples = 0,
      previous = new Map(motion.step(0).map((actor) => [actor.id, actor]));
    function checkWalking(actors: ActorFrame[], leader: ActorFrame, now: number) {
      if (leader.pose !== "walk") {
        walkingCycleSamples = 0;
        return;
      }
      restingSince = now;
      // Allow the 5.2-unit deepest row, quantization, and turn acquisition.
      // Eligibility depends only on leader travel, never on successful helper formation.
      if (now > 30000 && run.distance >= 8 && Math.abs(run.axis.y) < 0.01) {
        assertWalkingPairs(actors, leader, run.axis, count);
        walkingSamples++;
        if (++walkingCycleSamples === 5) walkingCycles++;
      }
    }
    for (let now = 100; now <= 180000; now += 100) {
      if (now % 5000 === 0) motion.reconcile(scene, { now });
      const actors = motion.step(now),
        leader = present(actors.find((actor) => actor.id === parent.id));
      for (const actor of actors) assertSafeTravel(scene, present(previous.get(actor.id)), actor);
      run = recordStraightTravel(run, present(previous.get(parent.id)).point, leader.point);
      checkWalking(actors, leader, now);
      if (now > 30000 && now - restingSince >= 4000) {
        assertRestingPairs(actors, leader, count, now);
        settledRests++;
      }
      previous = new Map(actors.map((actor) => [actor.id, actor]));
    }
    assert(settledRests > 20, "repeated settled rests are exercised");
    assert(walkingSamples > 20, "sustained open walking samples are exercised");
    assert(walkingCycles >= 3, "sustained walking is checked across repeated stroll/rest cycles");
    console.log("Sustained room coverage", { count, walkingSamples, walkingCycles, settledRests });
  }
  for (const count of [1, 2, 3, 8]) verifySustainedRoomRest(count);
  const observeCompactSquad = (
    count: number,
    leaderId: string | null = null,
    exclusion: { status?: LayoutRow["status"]; stale?: boolean } | null = null,
  ) => {
    const fixture = formationFixture(count + (exclusion ? 1 : 0), { leaderId });
    let scene = fixture.build();
    const motion = Scene.createMovement();
    motion.reconcile(scene, { now: 0 });
    const allHelpers = scene.workers
      .filter((w) => w.kind === "helper")
      .sort((a, b) => (a.helperSlot ?? -1) - (b.helperSlot ?? -1) || a.id.localeCompare(b.id));
    const excludedId = exclusion ? present(allHelpers[0]).id : null,
      helpers = allHelpers.filter((w) => w.id !== excludedId);
    let previous: Point | undefined,
      history: { point: Point; arc: number }[] = [],
      arc = 0,
      streak = 0,
      windows = 0,
      compactFrames = 0;
    const passageFrames = Array.from({ length: count }, () => 0),
      passageStreaks = Array.from({ length: count }, () => 0),
      traversed = new Set<number>();
    let lineFrames = 0,
      regroupFrames = 0,
      maxWidthRatio = 0,
      maxHeightRatio = 0;
    const turnFrames = Array.from({ length: Math.ceil(count / 2) }, () => 0);
    const headings = new Set<string>(),
      rowFrames = Array.from({ length: Math.ceil(count / 2) }, () => 0);

    function recordLeader(leader: ActorFrame) {
      if (previous) arc += Math.hypot(leader.point.x - previous.x, leader.point.y - previous.y);
      if (
        !previous ||
        Math.hypot(leader.point.x - previous.x, leader.point.y - previous.y) > 1e-8
      ) {
        history.push({ point: leader.point, arc });
        if (history.length > 2) {
          const [a, b, c] = history.slice(-3),
            ab = {
              x: present(b).point.x - present(a).point.x,
              y: present(b).point.y - present(a).point.y,
            },
            bc = {
              x: present(c).point.x - present(b).point.x,
              y: present(c).point.y - present(b).point.y,
            };
          if (Math.abs(ab.x * bc.y - ab.y * bc.x) < 1e-8 && ab.x * bc.x + ab.y * bc.y >= 0)
            history.splice(history.length - 2, 1);
        }
        history = history.filter((node) => node.arc >= arc - 60);
      }
      previous = leader.point;
    }
    function checkPassages(actors: ActorFrame[], now: number) {
      if (count === 8 && now > 90000) {
        const matches = helpers.map((w) => {
          const point = present(actors.find((a) => a.id === w.id)).point;
          return history.slice(1).flatMap((b, j) => {
            const a = history[j],
              length = b.arc - present(a).arc;
            if (!length) return [];
            const dx = (b.point.x - present(a).point.x) / length,
              dy = (b.point.y - present(a).point.y) / length;
            const t =
              ((point.x - present(a).point.x) * dx + (point.y - present(a).point.y) * dy) / length;
            if (
              t < 0 ||
              t > 1 ||
              Math.abs(-(point.x - present(a).point.x) * dy + (point.y - present(a).point.y) * dx) >
                0.08
            )
              return [];
            return [{ lag: arc - present(a).arc - length * t, dx, dy, point }];
          });
        });
        const ranked = matches.map((list, i) =>
          list.find((m) => m.lag >= (i + 1) * 1.6 - 0.08 && m.lag <= (i + 1) * 1.6 + 3.2),
        );
        const line = ranked.every((m, i) => m && (!i || m.lag - present(ranked[i - 1]).lag >= 0.8));
        if (line) lineFrames++;
        ranked.forEach((m, i) => {
          const platform = scene.platforms.find((p) => p.key === present(helpers[i]).platformKey),
            r = present(platform).rect;
          // Actual two-unit partition openings prove constriction independently of formation mode.
          const inDoor =
            m &&
            Math.abs(m.point.x - (r.x + 10)) < 1 &&
            [10, 17].some((y) => Math.abs(m.point.y - (r.y + y + 0.5)) < 0.7);
          const radius = 0.2016 + 0.1;
          const unsafe =
            inDoor &&
            [-0.6, 0.6].some((side) => {
              const shifted = { x: m.point.x - m.dy * side, y: m.point.y + m.dx * side };
              return reservedFurniture(present(platform)).some((o) =>
                intersectsFurniture(
                  { x: o.x - radius, y: o.y - radius, w: o.w + 2 * radius, h: o.h + 2 * radius },
                  shifted,
                  shifted,
                ),
              );
            });
          if (line && unsafe) {
            passageStreaks[i] = present(passageStreaks[i]) + 1;
            passageFrames[i] = present(passageFrames[i]) + 1;
            if (present(passageStreaks[i]) >= 3) traversed.add(i);
          } else passageStreaks[i] = 0;
        });
      }
    }
    function checkTurns(actors: ActorFrame[], now: number) {
      const last = history.at(-1),
        start = history.at(-2);
      if (count === 8 && start && now > 90000) {
        const currentLength = present(last).arc - start.arc,
          currentAxis = {
            x: (present(last).point.x - start.point.x) / currentLength,
            y: (present(last).point.y - start.point.y) / currentLength,
          };
        for (let row = 0; row < 4; row++) {
          const pair = helpers
            .slice(row * 2, row * 2 + 2)
            .map((w) => present(actors.find((a) => a.id === w.id)).point);
          const matchesOldAxis = history.slice(1).some((b, j) => {
            const a = history[j],
              length = b.arc - present(a).arc;
            if (length < 1.2) return false;
            const dx = (b.point.x - present(a).point.x) / length,
              dy = (b.point.y - present(a).point.y) / length;
            if (dx * currentAxis.x + dy * currentAxis.y > 0.95) return false;
            const offsets = pair.map((p) => ({
              along: (p.x - present(a).point.x) * dx + (p.y - present(a).point.y) * dy,
              side: -(p.x - present(a).point.x) * dy + (p.y - present(a).point.y) * dx,
            }));
            const lag = arc - present(a).arc - present(offsets[0]).along,
              depth = 1.6 + row * 1.2;
            return (
              offsets.every((o) => o.along >= 0 && o.along <= length) &&
              present(offsets[0]).side < -0.4 &&
              present(offsets[1]).side > 0.4 &&
              Math.abs(present(offsets[1]).side - present(offsets[0]).side - 1.2) <= 0.2 &&
              Math.abs(present(offsets[0]).along - present(offsets[1]).along) <= 0.4 &&
              lag >= depth - 0.08 &&
              lag <= depth + 3.2
            );
          });
          if (matchesOldAxis) turnFrames[row] = present(turnFrames[row]) + 1;
        }
      }
    }
    function pairOffsets(
      a: { lag: number; side: number },
      b: { lag: number; side: number } | undefined,
    ) {
      return b
        ? a.side < -0.4 &&
            b.side > 0.4 &&
            Math.abs(b.side - a.side - 1.2) <= 0.2 &&
            Math.abs(a.lag - b.lag) <= 0.4
        : Math.abs(a.side) <= 0.12;
    }
    function matchesPairs(measured: { lag: number; side: number }[]) {
      let paired = true;
      for (let i = 0; i < count; i += 2) {
        const a = measured[i],
          b = measured[i + 1],
          depth = 1.6 + 1.2 * Math.floor(i / 2);
        paired &&= present(a).lag >= depth - 0.08 && present(a).lag <= depth + 3.2;
        paired &&= pairOffsets(present(a), b);
        if (i > 0)
          paired &&= Math.abs(present(a).lag - present(measured[i - 2]).lag - 1.2) <= 0.40001;
      }
      return paired;
    }
    function compactAxis(actors: ActorFrame[], leader: ActorFrame, now: number): Point | null {
      const last = history.at(-1),
        start = history.at(-2);
      if (!start || present(last).arc - start.arc < 7 || now < 90000) {
        return null;
      }
      const length = present(last).arc - start.arc,
        axis = {
          x: (present(last).point.x - start.point.x) / length,
          y: (present(last).point.y - start.point.y) / length,
        };
      if (Math.min(Math.abs(axis.x), Math.abs(axis.y)) > 0.01) {
        return null;
      }
      const measured = helpers.map((w) => {
        const point = present(actors.find((a) => a.id === w.id)).point,
          dx = point.x - leader.point.x,
          dy = point.y - leader.point.y;
        return { lag: -(dx * axis.x + dy * axis.y), side: -dx * axis.y + dy * axis.x };
      });
      if (!matchesPairs(measured)) return null;
      return axis;
    }
    function checkProjection(actors: ActorFrame[], leader: ActorFrame, axis: Point) {
      if (count === 8) {
        const extent = (points: Point[]) => {
          const projected = points.map(Scene.project);
          return {
            w: Math.max(...projected.map((p) => p.x)) - Math.min(...projected.map((p) => p.x)) + 16,
            h: Math.max(...projected.map((p) => p.y)) - Math.min(...projected.map((p) => p.y)) + 32,
          };
        };
        const actual = extent([
          leader.point,
          ...helpers.map((w) => present(actors.find((a) => a.id === w.id)).point),
        ]);
        const old = extent([
          leader.point,
          ...helpers.map((_, i) => ({
            x: leader.point.x - axis.x * (i + 1) * 1.6,
            y: leader.point.y - axis.y * (i + 1) * 1.6,
            z: 0,
          })),
        ]);
        maxWidthRatio = Math.max(maxWidthRatio, actual.w / old.w);
        maxHeightRatio = Math.max(maxHeightRatio, actual.h / old.h);
        assert(
          actual.w <= old.w * 0.8 && actual.h <= old.h * 0.8,
          "settled squad reduces both padded projected dimensions by twenty percent",
        );
      }
    }
    function applyExclusion(now: number) {
      if (exclusion && now === 90000 && exclusion.status) {
        const i = fixture.helpers.findIndex((h) => h.id === excludedId);
        fixture.helpers[i] = { ...present(fixture.helpers[i]), status: exclusion.status };
        scene = fixture.build();
        motion.reconcile(scene, { now });
      }
    }
    function recordSettledWindow(axis: Point) {
      compactFrames++;
      if (streak === 10) windows++;
      if (count === 8 && traversed.size === 8) regroupFrames++;
      headings.add(String(Math.round(axis.x)) + "," + String(Math.round(axis.y)));
      rowFrames.forEach((_, i) => (rowFrames[i] = present(rowFrames[i]) + 1));
    }
    for (let now = 0; now <= 600000; now += 100) {
      applyExclusion(now);
      const actors = motion.step(now, {
          stale: (w) => Boolean(exclusion?.stale && now >= 90000 && w.id === excludedId),
        }),
        leader = actors.find((a) => a.id === fixture.parent.id);
      recordLeader(present(leader));
      checkPassages(actors, now);
      checkTurns(actors, now);
      const axis = compactAxis(actors, present(leader), now);
      if (!axis) {
        streak = 0;
        continue;
      }
      streak++;
      if (streak < 10) continue;
      recordSettledWindow(axis);
      checkProjection(actors, present(leader), axis);
    }
    return {
      windows,
      compactFrames,
      headings: [...headings],
      rowFrames,
      lineFrames,
      passageFrames,
      traversed: traversed.size,
      regroupFrames,
      turnFrames,
      maxWidthRatio,
      maxHeightRatio,
    };
  };
  function verifyCompactHistoricalCoverage() {
    for (const count of [1, 2, 3, 7, 8]) {
      const coverage = ["leader38", "leader7", "leader2"].map((id) =>
        observeCompactSquad(count, id),
      );
      const windows = coverage.reduce((n, c) => n + c.windows, 0),
        compactFrames = coverage.reduce((n, c) => n + c.compactFrames, 0);
      const headings = new Set(coverage.flatMap((c) => c.headings));
      assert(
        windows > 1 && compactFrames >= 20 && headings.size > 1,
        `sustained historical compact squad, count ${String(count)}: ${JSON.stringify(coverage)}`,
      );
      if (count === 8) {
        assert(
          coverage.every((c) => c.traversed === 8 && c.regroupFrames >= 10 && c.lineFrames >= 10),
          "all eight traverse independently unsafe pair doors in ordered distinct single file, then sustain pairs again",
        );
        assert(
          coverage.every((c) => c.turnFrames.every((n) => n > 0)),
          "all four pair rows follow their own historical tangent after leader turns",
        );
      }
      console.log(
        "Compact public coverage",
        count,
        JSON.stringify({ windows, compactFrames, headings: [...headings], runs: coverage }),
      );
    }
  }
  verifyCompactHistoricalCoverage();

  function verifyLiveExclusionCoverage() {
    for (const exclusion of [
      { status: "working" as const },
      { status: "blocked" as const },
      { stale: true },
    ]) {
      const coverage = ["leader38", "leader7"].map((id) => observeCompactSquad(2, id, exclusion));
      assert(
        coverage.some((c) => c.windows > 0),
        "live exclusion closes the first eligible row gap into an opposite-side pair",
      );
      console.log(
        "Eligible exclusion coverage",
        JSON.stringify(exclusion),
        JSON.stringify(coverage),
      );
    }
  }
  verifyLiveExclusionCoverage();
  function verifyOwnSourcePrecedence() {
    const fixture = formationFixture(2),
      scene = fixture.build(),
      motion = Scene.createMovement();
    motion.reconcile(scene, { now: 0 });
    advanceUntil(motion, { from: 0, to: 60000 });
    const stale = (worker: Worker) => worker.id === "follower-0",
      frozen = motion.step(60100, { stale }).find((a) => a.id === "follower-0");
    let parentMoved = false;
    for (let now = 60200; now <= 65000; now += 100) {
      const actors = motion.step(now, { stale });
      assert.deepEqual(
        actors.find((a) => a.id === present(frozen).id),
        frozen,
        "own source withdrawal freezes follower safely",
      );
      parentMoved ||= present(actors.find((a) => a.id === fixture.parent.id)).pose === "walk";
    }
    assert(parentMoved, "stale helper cannot freeze fresh parent");
    fixture.helpers[0] = { ...present(fixture.helpers[0]), status: "working" };
    const working = fixture.build();
    motion.reconcile(working, { now: 65000 });
    let previous = motion.step(65000);
    for (let now = 65100; now <= 110000; now += 100) {
      const current = motion.step(now);
      assertSafeTravel(
        working,
        present(previous.find((a) => a.id === "follower-0")),
        present(current.find((a) => a.id === "follower-0")),
      );
      previous = current;
    }
    assert.deepEqual(
      present(previous.find((a) => a.id === "follower-0")).point,
      present(working.workers.find((w) => w.id === "follower-0")).chair,
      "own work returns safely despite strolling parent",
    );
    assert.equal(present(previous.find((a) => a.id === "follower-0")).pose, "working");
    fixture.helpers[0] = {
      ...present(fixture.helpers[0]),
      status: "unknown" as const,
      lineageState: "closed",
    };
    const closed = fixture.build();
    motion.reconcile(closed, { now: 110000 });
    assert.equal(
      present(motion.step(110100).find((a) => a.id === "follower-0")).pose,
      "idle",
      "closed relationship also stops ambient work",
    );
  }
  verifyOwnSourcePrecedence();
  function verifyInaccessibleDeparture() {
    const fixture = formationFixture(1),
      scene = fixture.build(),
      child = scene.workers.find((w) => w.kind === "helper"),
      p = present(child).chair;
    const platform = scene.platforms.find((p) => p.key === present(child).platformKey);
    present(platform).decorationRegions.push(
      ...[
        { x: p.x - 0.6, y: p.y - 0.6, w: 1.2, h: 0.15 },
        { x: p.x - 0.6, y: p.y - 0.6, w: 0.15, h: 1.2 },
        { x: p.x + 0.45, y: p.y - 0.6, w: 0.15, h: 1.2 },
      ].map((rect) => ({ kind: "wall", rect })),
    );
    const motion = Scene.createMovement();
    motion.reconcile(scene, { now: 0 });
    let parentWalked = false;
    for (let now = 0; now <= 60000; now += 100) {
      const actors = motion.step(now);
      assert.deepEqual(
        present(actors.find((a) => a.id === present(child).id)).point,
        present(child).chair,
        "unprovable departure remains safely at desk",
      );
      parentWalked ||=
        present(actors.find((a) => a.id === present(child).parentId)).pose === "walk";
    }
    assert(parentWalked, "safe route rejection is local to boxed station");
  }
  verifyInaccessibleDeparture();
  console.log(
    "Compact historical pair/turn/passage/regroup oracle, eligible gaps, own stale/work/closed precedence and inaccessible-departure fallback OK",
  );

  // Overseer seating: a row flagged as overseer takes the observatory chair and the ambient viewer stands down.
  function verifyOverseerSeating() {
    const plain = Scene.build([], 0),
      boss = {
        id: "obs_" + "c".repeat(24),
        status: "working" as const,
        provider: "claude",
        role: "overseer" as const,
        source: "herdr",
      };
    const seated = Scene.build([], 0, { overseer: boss });
    assert.equal(present(plain.observatory.viewer).kind, "ambient");
    assert.equal(seated.observatory.viewer, null);
    assert.equal(seated.observatory.overseer, boss.id);
    const worker = seated.workers.find((w) => w.id === boss.id);
    assert.deepEqual(
      [present(worker).role, present(worker).platformKey, present(worker).chair],
      ["overseer", "observatory", plain.observatory.chair],
    );
    assert.notEqual(plain.revision, seated.revision, "seating the overseer rebuilds the floor");
    assert.equal(
      present(worker).accent,
      "#3fd8e8",
      "the default overseer accent is the canonical cyan",
    );
    assert.equal(
      present(
        Scene.build([], 0, { overseer: boss, overseerAccent: "#34518f" }).workers.find(
          (entry) => entry.role === "overseer",
        ),
      ).accent,
      "#34518f",
      "a theme supplies the overseer accent",
    );
    console.log("observer scene: overseer seating OK");
  }
  verifyOverseerSeating();
}, 120000);
