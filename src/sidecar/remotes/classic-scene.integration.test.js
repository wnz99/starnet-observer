// Transitional real Model/classic Scene composition. Task 7-V/I7 owns the full TS port after Scene integration.
const { test } = require("bun:test");
const assert = require("node:assert/strict");
const { row } = require("./remotes.fixture.ts");
test("remote ships preserve actual model and classic scene integration", () => {
  // ── Ships: remote rooms get their own slot space and an offset ship; single-host scenes carry no ships at all.
  const Model = require("../../browser/model.ts").createModel(
      require("../../../frontend/assets/themes/starnet/theme.json"),
    ),
    Scene = require("../../../frontend/app/observer-scene.js");
  const layout = Model.createLayout();
  const localRows = [row({ id: "obs_" + "1".repeat(24), host: null })];
  layout.reconcile(localRows);
  const single = Scene.build(layout.onPage(0), 0, {});
  assert.equal("ships" in single, false, "no remotes → no hulls, identical scene shape");
  const remoteRows = [
    row({ id: "obs_" + "2".repeat(24), host: "vm" }),
    row({
      id: "obs_" + "3".repeat(24),
      host: "vm",
      projectId: "prj_" + "9".repeat(20),
      project: "other",
    }),
  ];
  // Same projectId as a local row, different host: still its own room.
  layout.reconcile([...localRows, ...remoteRows]);
  const rooms = layout.onPage(0);
  assert.equal(rooms.length, 3);
  assert.equal(rooms.find((room) => !room.host).slot, 0, "the local room keeps slot 0");
  assert.deepEqual(
    rooms
      .filter((room) => room.host === "vm")
      .map((room) => room.slot)
      .sort(),
    [0, 1],
    "remote rooms number their own slots",
  );
  const multi = Scene.build(rooms, 0, {
    hosts: [
      { id: "vm", health: "stale", observedAt: 1, agents: 2 },
      { id: "empty", health: "unavailable", reason: "SSH connection refused", agents: 0 },
    ],
  });
  assert.equal(multi.ships.length, 3);
  assert.equal(multi.ships[0].local, true);
  const vmShip = multi.ships[1],
    emptyShip = multi.ships[2];
  const inside = (rect, hull) =>
    rect.x >= hull.x &&
    rect.x + rect.w <= hull.x + hull.w &&
    rect.y >= hull.y &&
    rect.y + rect.h <= hull.y + hull.h;
  const overlaps = (a, b) =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  for (const platform of multi.platforms.filter((p) => p.host === "vm"))
    assert.ok(inside(platform.rect, vmShip.rect), "remote rooms sit inside their hull");
  for (const platform of multi.platforms.filter((p) => !p.host))
    assert.ok(inside(platform.rect, multi.ships[0].rect), "local rooms sit inside the flagship");
  assert.ok(
    !overlaps(vmShip.rect, multi.ships[0].rect) &&
      !overlaps(emptyShip.rect, vmShip.rect) &&
      !overlaps(emptyShip.rect, multi.ships[0].rect),
    "ships do not overlap",
  );
  assert.ok(
    vmShip.rect.y >= multi.ships[0].rect.y + multi.ships[0].rect.h &&
      emptyShip.rect.y >= vmShip.rect.y + vmShip.rect.h,
    "remote ships sit in a line below the flagship",
  );
  const flag = multi.ships[0].rect;
  assert.ok(
    vmShip.rect.y - (flag.y + flag.h) >= 8 &&
      emptyShip.rect.y - (vmShip.rect.y + vmShip.rect.h) >= 8,
    "a clear gap between hulls",
  );
  // Each remote ship has its own mailroom on its top edge; an empty host's hull wraps just that mailroom.
  for (const ship of [vmShip, emptyShip]) {
    assert.ok(ship.mail && ship.mail !== multi.mail, "a remote ship has its own mailroom");
    assert.equal(ship.mail.rect.y, ship.rect.y + 2, "on the hull edge nearest the flagship");
    assert.ok(inside(ship.mail.rect, ship.rect));
    assert.ok(
      inside({ x: ship.mail.hub.x, y: ship.mail.hub.y, w: 0, h: 0 }, ship.mail.rect) &&
        ship.mail.pads.length === 3 &&
        ship.mail.pod.length &&
        ship.mail.chute.length,
      "same mailroom furniture",
    );
  }
  assert.ok(
    emptyShip.rect.w <= 18 && emptyShip.rect.h <= 16,
    "an empty host gets a compact hull around its mailroom",
  );
  const vmRooms = multi.platforms.filter((p) => p.host === "vm");
  assert.ok(
    vmRooms.every((p) => !overlaps(p.rect, vmShip.mail.rect)) &&
      vmRooms.some((p) => p.rect.y === vmShip.mail.rect.y),
    "rooms flank the mailroom",
  );
  const extent = [vmShip.mail.rect, ...vmRooms.map((p) => p.rect)],
    bottom = Math.max(...extent.map((r) => r.y + r.h));
  assert.ok(vmShip.rect.y + vmShip.rect.h - bottom <= 6, "the hull wraps its rooms tightly");
  // No physical connection between ships: no bridges, and every remote walk/courier path stays inside its own ship.
  assert.equal(multi.bridges, undefined, "no bridge implies a mail path that does not exist");
  for (const worker of multi.workers.filter((worker) => worker.row.host)) {
    const ship = multi.ships.find((value) => value.id === worker.row.host);
    assert.deepEqual(worker.route.at(-1), ship.mail.hub, "remote crew end at their own mailroom");
    for (const point of worker.route)
      assert.ok(
        inside({ x: point.x, y: point.y, w: 0, h: 0 }, ship.rect),
        "every route point stays inside its own ship",
      );
  }
  const remoteWorker = multi.workers.find((worker) => worker.row.host === "vm"),
    localWorker = multi.workers.find((worker) => !worker.row.host);
  // Courier routes: a remote host's message routes only within that host's ship, even if it names a row of another host.
  const fakeLayout = {
    seatFor: (id) => (multi.workers.some((w) => w.id === id) ? 0 : undefined),
    pageFor: () => 0,
    colorFor: () => ({ accent: "#fff" }),
  };
  const remoteRoute = Scene.route(
    multi,
    fakeLayout,
    { from: remoteWorker.id, to: "external" },
    [],
    "vm",
  );
  for (const point of [...remoteRoute.from, ...remoteRoute.to])
    assert.ok(
      inside({ x: point.x, y: point.y, w: 0, h: 0 }, vmShip.rect),
      "remote courier stays on its ship",
    );
  const crossed = Scene.route(
    multi,
    fakeLayout,
    { from: localWorker.id, to: remoteWorker.id },
    [],
    "vm",
  );
  for (const point of [...crossed.from, ...crossed.to])
    assert.ok(
      inside({ x: point.x, y: point.y, w: 0, h: 0 }, vmShip.rect),
      "a local row named in remote mail never pulls a courier off the ship",
    );
  const localRoute = Scene.route(multi, fakeLayout, { from: localWorker.id, to: "external" }, []);
  for (const point of [...localRoute.from, ...localRoute.to])
    assert.ok(
      inside({ x: point.x, y: point.y, w: 0, h: 0 }, flag),
      "local couriers stay on the flagship",
    );
  assert.ok(
    Scene.pending(multi, fakeLayout, [{ to: "external", acknowledgedAt: null }], "vm").every(
      (spot) => inside({ x: spot.point.x, y: spot.point.y, w: 0, h: 0 }, vmShip.mail.rect),
    ),
    "remote pending mail rests in its own mailroom",
  );
  // Observation links: one per remote, hull to hull across the gap, state = stream health; absent without remotes.
  assert.equal(single.links, undefined);
  assert.equal(single.relays, undefined);
  assert.deepEqual(
    multi.links.map((link) => [link.host, link.health]),
    [
      ["vm", "stale"],
      ["empty", "unavailable"],
    ],
    "link state is the real stream health",
  );
  assert.equal(multi.links[0].from.y, flag.y + flag.h);
  assert.equal(multi.links[0].to.y, vmShip.rect.y);
  assert.equal(multi.links[1].from.y, vmShip.rect.y + vmShip.rect.h);
  assert.equal(multi.links[1].to.y, emptyShip.rect.y);
  assert.equal(multi.relays, undefined, "no relay without a bus that reports one");
  assert.ok(multi.bounds.maxY > single.bounds.maxY, "the camera fits every ship");
  const localCrew = multi.workers.find((worker) => !worker.row.host),
    alone = single.workers.find((worker) => worker.id === localCrew.id);
  assert.deepEqual(localCrew.route, alone.route, "local crew routes are unchanged by remotes");
  assert.notEqual(
    multi.revision,
    Scene.build(rooms, 0, {
      hosts: [
        { id: "vm", health: "available", agents: 2 },
        { id: "empty", health: "unavailable", agents: 0 },
      ],
    }).revision,
    "host health is part of the scene revision",
  );
});
