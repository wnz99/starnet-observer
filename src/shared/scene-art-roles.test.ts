import { test } from "bun:test";
import assert from "node:assert/strict";
import { SCENE_ART_ROLES, isSceneArtRoleName } from "./scene-art-roles.js";

function vertices(xs: readonly number[], ys: readonly number[], zs: readonly number[]) {
  return xs.flatMap((x) => ys.flatMap((y) => zs.map((z) => ({ x, y, z }))));
}
function projectedBounds(
  role: keyof typeof SCENE_ART_ROLES,
  points: ReturnType<typeof vertices>,
  scale = 1,
) {
  const spec = SCENE_ART_ROLES[role];
  for (const { x, y, z } of points) {
    const px = 24 * (x - y) * scale + spec.foot.x;
    const py = (12 * (x + y) - 24 * z) * scale + spec.foot.y;
    assert.ok(
      px >= 0 && px <= spec.source.width && py >= 0 && py <= spec.source.height,
      role + " clips its native extent",
    );
  }
}
test("native role geometry preserves independent projected bounds", () => {
  assert.equal(Object.keys(SCENE_ART_ROLES).length, 34);
  assert.deepEqual(SCENE_ART_ROLES.floor.source, { width: 48, height: 24 });
  assert.notDeepEqual(SCENE_ART_ROLES.chair.source, SCENE_ART_ROLES.helperChair.source);
  // The metadata must contain the actual projected chair boxes at both native sizes.
  for (const [role, scale] of [
    ["chair", 1],
    ["helperChair", 0.72],
  ] as const) {
    for (const box of [
      { x: -0.3, y: -0.35, w: 0.6, h: 0.5, low: 0, high: 0.35 },
      { x: -0.3, y: -0.45, w: 0.6, h: 0.1, low: 0.35, high: 0.9 },
    ]) {
      projectedBounds(
        role,
        vertices([box.x, box.x + box.w], [box.y, box.y + box.h], [box.low, box.high]),
        scale,
      );
    }
  }
  for (const [name, spec] of Object.entries(SCENE_ART_ROLES)) {
    assert.ok(spec.source.width <= 512 && spec.source.height <= 512);
    if (["chair", "helperChair", "viewer", "carrier"].includes(name)) continue;
    assert.ok(isSceneArtRoleName(name));
    const { w, h, height } = spec.extent;
    projectedBounds(name, vertices([0, w], [0, h], [0, height]));
  }
  assert.ok(Object.isFrozen(SCENE_ART_ROLES));
  for (const role of Object.values(SCENE_ART_ROLES)) {
    assert.ok(Object.isFrozen(role));
    assert.ok(Object.isFrozen(role.source));
    assert.ok(Object.isFrozen(role.foot));
    assert.ok(Object.isFrozen(role.extent));
  }
});
