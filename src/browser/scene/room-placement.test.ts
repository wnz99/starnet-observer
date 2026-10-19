import assert from "node:assert/strict";
import { test } from "bun:test";
import { createModel } from "../model.js";
import { canonicalTheme } from "../theme.fixture.js";
import type { LayoutRow } from "../model/types.js";
import * as Scene from "./index.js";
import { contains, overlaps, rootObstacles } from "./geometry.js";
import type { Point, Rect, Scene as SceneValue, Ship, Platform, Worker } from "./types.js";
import { roomRect } from "./room-placement.js";
import { revisionFor } from "./revision.js";
import { mailOf } from "./mail.js";

const roots = (count: number, projectId = "family", host?: string): LayoutRow[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `${host ?? "local"}:${projectId}:${String(index)}`,
    projectId,
    project: projectId,
    repoId: projectId,
    repo: projectId,
    ...(host ? { host } : {}),
  }));

test("project overflow grows outward from a stable parent anchor", () => {
  const layout = createModel(canonicalTheme()).createLayout();
  const rows = roots(49);
  for (const count of [24, 25, 49]) {
    layout.reconcile(rows.slice(0, count));
    const scene = Scene.build(layout.onPage(0), 0);
    assert.deepEqual(
      scene.platforms.map((room) => room.rect.x),
      [-30, -54, -78].slice(0, Math.ceil(count / 24)),
    );
    assert.equal(new Set(layout.allRooms().map((room) => room.slot)).size, 1);
    assert.equal(layout.pages(), 1);
  }
  const before = Scene.build(layout.onPage(0), 0);
  layout.reconcile(rows.slice().reverse());
  assert.deepEqual(
    Scene.build(layout.onPage(0), 0).workers.map((worker) => worker.chair),
    before.workers.map((worker) => worker.chair),
  );
  layout.reconcile(rows.slice(48));
  assert.deepEqual(
    layout.allRooms().map((room) => room.annex),
    [0, 1, 2],
  );
  assert.equal(layout.allRooms()[0]?.rows.length, 0);
  layout.reconcile(rows);
  assert.equal(layout.pages(), 1);
});

test("right families and remote families use their parent bank", () => {
  const layout = createModel(canonicalTheme()).createLayout();
  layout.reconcile([...roots(1, "left"), ...roots(25, "right"), ...roots(49, "remote", "remote")]);
  const scene = Scene.build(layout.onPage(0), 0, { hosts: [{ id: "remote" }] });
  assert.deepEqual(
    scene.platforms.filter((room) => room.name === "right").map((room) => room.rect.x),
    [24, 48],
  );
  assert.deepEqual(
    scene.platforms.filter((room) => room.host === "remote").map((room) => room.rect.x),
    [-22, -46, -70],
  );
  const remote = layout.allRooms().find((room) => room.host === "remote");
  assert.ok(remote);
  assert.deepEqual(roomRect(remote, 100, 200), { x: 178, y: 100, w: 20, h: 26 });
});

function coveredRoute(scene: SceneValue, points: readonly Point[], host?: string) {
  const obstacles = scene.platforms
    .filter((room) => room.host === host)
    .flatMap((room) => rootObstacles(room.rect));
  const surfaces = [
    host ? scene.ships?.find((ship) => ship.id === host)?.mail?.rect : scene.mail.rect,
    ...scene.platforms.filter((room) => room.host === host).map((room) => room.rect),
    ...scene.walkways.filter((walkway) => walkway.host === host).map((walkway) => walkway.rect),
  ].filter((rect): rect is Rect => !!rect);
  for (let index = 1; index < points.length; index++) {
    const start = points[index - 1],
      end = points[index];
    assert.ok(start && end);
    const steps = Math.max(1, Math.ceil(Math.hypot(end.x - start.x, end.y - start.y) / 0.25));
    for (let step = 0; step <= steps; step++) {
      const point = {
        x: start.x + ((end.x - start.x) * step) / steps,
        y: start.y + ((end.y - start.y) * step) / steps,
      };
      assert.ok(
        surfaces.some((rect) => contains(rect, point)),
        `uncovered route point ${JSON.stringify(point)}`,
      );
      assert.ok(
        obstacles.every((obstacle) => !contains(obstacle, point)),
        `route crosses furniture at ${JSON.stringify(point)}`,
      );
    }
  }
}

function assertFamilyLinks(scene: SceneValue, family: Platform[], worker: Worker) {
  const links = scene.walkways.filter((walkway) => walkway.kind === "annex-link");
  assert.equal(links.length, 2);
  assert.ok(
    links.every(
      (link) =>
        link.relay === true && link.accent === worker.accent && link.host === worker.row.host,
    ),
  );
  assert.ok(
    links.every((link) => scene.platforms.every((room) => !overlaps(link.rect, room.rect))),
  );
  assert.deepEqual(
    family.map((room) => !!room.relay),
    [false, false, true],
  );
  const parent = family[0];
  assert.ok(parent);
  assert.ok(
    scene.walkways.some(
      (walkway) =>
        walkway.kind === "connector" &&
        walkway.relay === true &&
        contains(walkway.rect, { x: parent.rect.x + 10, y: parent.rect.y + 28 }),
    ),
  );
  assert.ok(
    scene.walkways.filter((walkway) => walkway.kind === "spine").some((walkway) => walkway.relay),
  );
}
function assertClearPrefixes(scene: SceneValue) {
  for (const root of scene.workers.filter((value) => value.route)) {
    const room = scene.platforms.find((value) => value.key === root.platformKey);
    assert.ok(room && root.route);
    // Chair-to-entry lanes must stay clear of every reserved desk and partition.
    for (const point of root.route.slice(0, 4))
      assert.ok(rootObstacles(room.rect).every((obstacle) => !contains(obstacle, point)));
  }
}
function verifyFamilyRoute(host: string | undefined, bank: number) {
  const layout = createModel(canonicalTheme()).createLayout();
  const rows = [...(bank ? roots(1, "other", host) : []), ...roots(49, "family", host)];
  const outerId = `${host ?? "local"}:family:48`;
  layout.reconcile(rows);
  const rooms = layout.onPage(0),
    options = { relayMembers: new Map([[outerId, {}]]) };
  const scene = Scene.build(rooms.slice().reverse(), 0, options);
  assert.deepEqual(
    scene.platforms.map((room) => room.key),
    rooms
      .slice()
      .reverse()
      .map((room) => room.key),
  );
  const family = scene.platforms
    .filter((room) => room.name === "family")
    .sort((a, b) => a.annex - b.annex);
  const worker = scene.workers.find((value) => value.id === outerId);
  assert.ok(worker?.route);
  const elbows = family
    .slice()
    .reverse()
    .map((room) => ({ x: room.rect.x + 10, y: room.rect.y + 28, z: 0 }));
  assert.deepEqual(worker.route.slice(4, 7), elbows);
  const own = mailOf(scene, host ?? null),
    recipient = rows[0];
  assert.ok(own && recipient);
  assert.deepEqual(worker.route.at(-1), own.hub);
  assert.deepEqual(Scene.endpoint(scene, layout, outerId, host ?? null).points, worker.route);
  const mail = Scene.route(scene, layout, { from: outerId, to: recipient.id }, rows, host ?? null);
  assert.deepEqual(mail.from, worker.route);
  coveredRoute(scene, worker.route, host);
  assertFamilyLinks(scene, family, worker);
  assertClearPrefixes(scene);
}
test("annex mail follows predecessor elbows on matching clear surfaces and propagates relay traffic inward", () => {
  for (const host of [undefined, "remote"])
    for (const bank of [0, 1]) verifyFamilyRoute(host, bank);
});

test("expanded local, observed and tall shadow hulls remain separated and fit both viewports", () => {
  const layout = createModel(canonicalTheme()).createLayout();
  const rows = [
    ...roots(1, "left"),
    ...roots(97, "wide"),
    ...roots(49, "family", "a"),
    ...roots(25, "family", "b"),
  ];
  for (const host of ["shadow-a", "shadow-b"]) {
    rows.push(...roots(49, "family", host));
    for (let index = 0; index < 7; index++) rows.push(...roots(1, `tall-${String(index)}`, host));
  }
  layout.reconcile(rows);
  const scene = Scene.build(layout.onPage(0), 0, {
    hosts: [
      { id: "a" },
      { id: "empty", health: "unavailable" },
      { id: "b" },
      { id: "shadow-a", shadow: true, member: "a" },
      { id: "shadow-b", shadow: true, member: "b" },
    ],
  });
  const ships = scene.ships;
  assert.ok(ships);
  assertHullContainment(scene, ships);
  assertShipSeparation(ships);
  assertObservedGaps(ships);
  const empty = ships.find((ship) => ship.id === "empty");
  assert.ok(empty?.mail);
  assert.deepEqual(empty.rect, { x: -2, y: empty.mail.rect.y - 2, w: 18, h: 16 });
  assert.equal(empty.health, "unavailable");
  assertFits(scene);
});

function assertHullContainment(scene: SceneValue, ships: Ship[]) {
  for (const ship of ships) {
    for (const room of scene.platforms.filter((room) => (room.host ?? null) === ship.id)) {
      assert.ok(
        room.rect.x >= ship.rect.x && room.rect.x + room.rect.w <= ship.rect.x + ship.rect.w,
      );
      assert.ok(
        room.rect.y >= ship.rect.y && room.rect.y + room.rect.h + 3 <= ship.rect.y + ship.rect.h,
      );
    }
  }
}
function assertShipSeparation(ships: Ship[]) {
  for (const [index, ship] of ships.entries())
    for (const other of ships.slice(0, index)) {
      assert.equal(
        overlaps(ship.rect, other.rect),
        false,
        `${String(ship.id)} overlaps ${String(other.id)}`,
      );
      if (
        ship.shadow &&
        ship.rect.y < other.rect.y + other.rect.h &&
        ship.rect.y + ship.rect.h > other.rect.y
      )
        assert.ok(ship.rect.x - (other.rect.x + other.rect.w) >= 14);
    }
}
function assertObservedGaps(ships: Ship[]) {
  const observed = ships.filter((ship) => !ship.shadow);
  for (let index = 1; index < observed.length; index++) {
    const above = observed[index - 1],
      below = observed[index];
    assert.ok(above && below);
    assert.equal(below.rect.y - (above.rect.y + above.rect.h), 8);
    assert.equal(below.mail?.rect.x, 0);
  }
}
function assertFits(scene: SceneValue) {
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 800, height: 600 },
  ]) {
    const camera = Scene.fit(scene.bounds, viewport);
    for (const rect of [
      ...scene.platforms.map((room) => room.rect),
      ...scene.walkways.map((walkway) => walkway.rect),
    ])
      for (const x of [rect.x, rect.x + rect.w])
        for (const y of [rect.y, rect.y + rect.h]) {
          const point = Scene.toScreen({ x, y }, camera);
          assert.ok(
            point.x >= 0 && point.x <= viewport.width && point.y >= 0 && point.y <= viewport.height,
          );
        }
  }
}

test("incomplete family geometry fails rather than inventing another project's route", () => {
  const layout = createModel(canonicalTheme()).createLayout();
  layout.reconcile(roots(49));
  assert.throws(() => Scene.build(layout.allRooms().slice(1), 0), /Missing parent/);
  assert.throws(
    () =>
      Scene.build(
        layout.allRooms().filter((room) => room.annex !== 1),
        0,
      ),
    /Missing predecessor/,
  );
});

test("empty annex links invalidate scene art on geometry and trim changes", () => {
  const layout = createModel(canonicalTheme()).createLayout();
  const rows = roots(49);
  layout.reconcile(rows);
  layout.reconcile(rows.slice(48));
  const scene = Scene.build(layout.onPage(0), 0);
  const input = {
    ...scene,
    rooms: layout.onPage(0),
    ships: scene.ships ?? [],
    relays: scene.relays ?? [],
  };
  for (const change of [
    { accent: "#abcdef" },
    { relay: true },
    { rect: { x: -69, y: -21, w: 25, h: 2 } },
  ]) {
    const walkways = scene.walkways.map((walkway) =>
      walkway.kind === "annex-link" ? { ...walkway, ...change } : walkway,
    );
    assert.notEqual(revisionFor({ ...input, walkways }), scene.revision);
  }
});
