import { test } from "bun:test";
import assert from "node:assert/strict";
import { build, toScreen } from "../scene/index.js";
import { connectionDetails, connectionHostAt } from "./connection-details.js";
import { present } from "./values.js";

test("connection hover follows the visible route and separates SSH health from relay evidence", () => {
  const scene = build([], 0, {
    hosts: [{ id: "remote", health: "available" }],
    relays: [
      {
        relay: "relay.example",
        members: [null, "remote"].map((host) => ({
          host,
          machine: host ?? "local",
          state: "quiet",
          lastActivityAt: null,
        })),
      },
    ],
  });
  const wire = present(present(scene.links)[0]);
  const end = present(wire.path.at(-2));
  for (const camera of [
    { zoom: 0.25, tx: 300, ty: 200 },
    { zoom: 1, tx: 0, ty: 0 },
  ]) {
    const point = toScreen(end, camera);
    assert.equal(connectionHostAt(scene, camera, point), "remote");
    assert.equal(connectionHostAt(scene, camera, { x: -100000, y: -100000 }), undefined);
  }
  assert.match(connectionDetails(scene, "remote"), /SSH observing/);
  assert.match(connectionDetails(scene, "remote"), /roster only/);
  wire.health = "stale";
  assert.match(connectionDetails(scene, "remote"), /SSH stale/);
  assert.match(connectionDetails(scene, "remote"), /roster only/);
});
