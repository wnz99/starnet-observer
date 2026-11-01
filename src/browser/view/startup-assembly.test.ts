import { test } from "bun:test";
import assert from "node:assert/strict";
import { build } from "../scene/build.js";
import type { Platform } from "../scene/types.js";
import { StartupAssembly } from "./startup-assembly.js";

function platform(key: string, annex = 0, projectId = key): Platform {
  return {
    key,
    projectId,
    annex,
    name: "same label",
    accent: "#ffffff",
    rect: { x: 20 + annex * 24, y: 0, w: 20, h: 26 },
    sections: [],
    decorationRegions: [],
    entry: { point: { x: 30 + annex * 24, y: 25 }, edge: "front" },
    sign: { x: 20, y: 0 },
    quarters: { rect: { x: 34, y: 2, w: 3, h: 1 }, entry: { x: 35, y: 3 } },
  };
}

test("hubs precede stable outward families and annexes regardless of input order", () => {
  const scene = build([], 0);
  scene.platforms = [platform("annex", 1, "parent"), platform("parent"), platform("far")];
  const far = scene.platforms[2];
  assert(far);
  far.entry.point = { x: 1000, y: 1000 };
  const assembly = new StartupAssembly();
  assembly.begin(scene, 100);
  assert.equal(assembly.state, "playing");
  const core = assembly.frame(100);
  assert.equal(core.progress("mail", "content"), 1);
  assert.equal(core.progress("observatory", "content"), 1);
  for (const now of [100, 500, 1000]) {
    const pullingBack = assembly.frame(now);
    for (const room of scene.platforms) {
      assert.equal(pullingBack.outline(`platform:${room.key}`), 0);
      assert.equal(pullingBack.progress(`platform:${room.key}`, "floor"), 0);
    }
  }
  const frame = assembly.frame(1200);
  assert.equal(frame.outline("platform:parent"), 1);
  assert.equal(frame.outline("platform:annex"), 0);
  assert.equal(assembly.owners.platform("missing"), undefined);
});

for (const count of [0, 1, 100]) {
  test(`${String(count)} rooms keep monotonic clamped phases and finish at 2800ms`, () => {
    const scene = build([], 0);
    scene.platforms = Array.from({ length: count }, (_, i) => platform(String(i)));
    const assembly = new StartupAssembly();
    assembly.begin(scene, 0);
    let previous = 0;
    for (let now = 0; now < 2800; now += 20) {
      const frame = assembly.frame(now);
      const value = frame.progress("mail", "content");
      assert(value >= previous && value <= 1);
      previous = value;
      assert.equal(frame.progress("platform:unknown", "content"), 0);
      for (const room of scene.platforms) {
        assert(
          frame.progress(`platform:${room.key}`, "content") <=
            frame.progress(`platform:${room.key}`, "floor"),
        );
      }
    }
    assert.equal(assembly.frame(2800).active, false);
    assert.equal(assembly.state, "complete");
    assert.equal(assembly.frame(0).progress("platform:unknown", "content"), 1);
    assert.equal(assembly.owners.platform("0"), undefined);
    assert.equal(scene.platforms.length, count);
  });
}

test("begin is one-shot, clocks never regress, and completion is synchronous", () => {
  const assembly = new StartupAssembly();
  const scene = build([], 0);
  assert.equal(assembly.frame(0).active, false);
  assembly.begin(scene, 50);
  const value = assembly.frame(400).progress("mail", "floor");
  assembly.begin(scene, 400);
  assert.equal(assembly.frame(100).progress("mail", "floor"), value);
  assembly.complete();
  assembly.begin(scene, 0);
  assert.equal(assembly.state, "complete");
  assert.equal(assembly.frame(0).progress("mail", "content"), 1);
});

test("phase boundaries and at most twelve contiguous room groups", () => {
  const scene = build([], 0);
  scene.platforms = Array.from({ length: 100 }, (_, i) => platform(String(i).padStart(3, "0")));
  const assembly = new StartupAssembly();
  assembly.begin(scene, 0);
  assert.equal(assembly.frame(0).progress("mail", "content"), 1);
  assert.equal(assembly.frame(900).outline("platform:000"), 0);
  assert.equal(assembly.frame(1050).outline("platform:000"), 0.5);
  assert.equal(assembly.frame(1100).progress("platform:000", "floor"), 0);
  assert.equal(assembly.frame(1190).progress("platform:000", "floor"), 0.5);
  assert.equal(assembly.frame(1280).progress("platform:000", "content"), 0);
  assert.equal(assembly.frame(1380).progress("platform:000", "content"), 0.5);
  assert.equal(assembly.frame(1390).sweep("platform:000"), 0.5);
  const firstSeen = new Map<string, number>();
  const groups = new StartupAssembly();
  groups.begin(scene, 0);
  for (let now = 1000; now <= 2210; now += 10) {
    const frame = groups.frame(now);
    for (const room of scene.platforms) {
      if (!firstSeen.has(room.key) && frame.outline(`platform:${room.key}`) > 0)
        firstSeen.set(room.key, now);
    }
  }
  assert.equal(firstSeen.size, 100);
  assert.equal(new Set(firstSeen.values()).size, 12);
  assert.equal(assembly.frame(2250).outline("platform:099"), 0.5);
  assert.equal(assembly.frame(2680).progress("platform:099", "content"), 1);
  assert.equal(assembly.frame(2799).active, true);
});

test("walkways derive latest endpoint ownership; detached geometry remains unknown", () => {
  const scene = build([], 0);
  const room = platform("room");
  scene.platforms = [room];
  const bridge = { kind: "bridge", rect: { x: 7, y: 5, w: 25, h: 22 } };
  const detached = { kind: "unknown", rect: { x: 1000, y: 1000, w: 2, h: 2 } };
  scene.walkways = [bridge, detached];
  const assembly = new StartupAssembly();
  assembly.begin(scene, 0);
  assert.equal(assembly.owners.walkway(bridge), "platform:room");
  assert.equal(assembly.owners.walkway(detached), undefined);
  assert.equal(
    assembly.owners.worker({ role: "overseer" } as Parameters<typeof assembly.owners.worker>[0]),
    "observatory",
  );
  assert.equal(
    assembly.owners.worker({ platformKey: "room" } as Parameters<typeof assembly.owners.worker>[0]),
    "platform:room",
  );
});

test("remote and shadow hubs precede rooms; relay spokes wait for their host's content", () => {
  const scene = build([], 0, { hosts: [{ id: "remote" }, { id: "shadow", shadow: true }] });
  scene.platforms = [
    { ...platform("remote-room"), host: "remote" },
    { ...platform("shadow-room"), host: "shadow" },
  ];
  const highway = { kind: "relay-highway", rect: { x: 0, y: 0, w: 2, h: 100 } };
  scene.walkways.push(highway);
  scene.relays = [
    {
      key: "relay",
      relay: "relay",
      members: [],
      mail: scene.mail,
      links: [],
      spokes: [
        {
          host: "shadow",
          carried: 1,
          machine: "shadow",
          state: "live",
          lastActivityAt: null,
          verified: true,
          path: [
            { x: 1, y: 0 },
            { x: 1, y: 100 },
          ],
        },
      ],
    },
  ];
  const assembly = new StartupAssembly();
  assembly.begin(scene, 0);
  assert.equal(assembly.owners.ship("remote"), "ship:remote");
  assert.equal(assembly.owners.ship("shadow"), "ship:shadow");
  assert.equal(assembly.frame(0).progress(assembly.owners.relay("relay"), "floor"), 0);
  assert.equal(assembly.frame(899).outline("ship:remote"), 0);
  assert.equal(assembly.frame(899).outline(assembly.owners.relay("relay")), 0);
  assert(assembly.frame(959).outline("ship:remote") > 0);
  assert.equal(assembly.frame(959).outline("platform:remote-room"), 0);
  assert.equal(assembly.frame(1400).progress(assembly.owners.relay("relay"), "content"), 1);
  assert.equal(assembly.owners.walkwayReady(highway, assembly.frame(1400)), false);
  assert.equal(assembly.owners.walkwayReady(highway, assembly.frame(2680)), true);
});
