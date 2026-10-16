import { test } from "bun:test";
import assert from "node:assert/strict";
import { create, load } from "./office-art.js";
import { art, context, images, ready, required } from "./office-art/loading.fixture.js";
import type { FakeImage } from "./office-art/loading.fixture.js";
import type { Point } from "./office-art/types.js";
import { canonicalTheme } from "./theme.fixture.js";
test("native composition keeps foot anchors, clipped repetition and fallback human bounds", async () => {
  const result = ready(await load(art(), { Image: images().Image }));
  const project = ({ x, y, z = 0 }: Point) => ({ x: 24 * (x - y), y: 12 * (x + y) - 24 * z });
  const { ctx, draws, ops } = context<FakeImage>();
  const colors = canonicalTheme().scene.colors;
  const composition = create({ images: result.images, colors, project, crewHeight: 40 });
  composition.draw(ctx, "desk", { x: 3.3, y: 1.1 });
  const at = project({ x: 3.3, y: 1.1 });
  assert.deepEqual(
    draws[0],
    {
      image: result.images.desk,
      src: result.images.desk.src,
      x: Math.round(at.x - 24),
      y: Math.round(at.y - 38),
      w: 72,
      h: 74,
    },
    "native image identity, size and foot anchor",
  );
  assert(Number.isInteger(required(draws[0]).x) && Number.isInteger(required(draws[0]).y));
  composition.draw(ctx, "helperChair", { x: 0, y: 0 });
  assert.deepEqual([required(draws[1]).w, required(draws[1]).h], [22, 27]);
  draws.length = 0;
  composition.tile(ctx, "floor", { x: 0, y: 0, w: 2.5, h: 2 });
  assert.equal(draws.length, 6, "three columns of two whole tiles, clipped");
  assert(ops.includes("clip"));
  draws.length = 0;
  composition.edge(ctx, "wallRearX", { x: 0, y: 0, w: 0.4, h: 3 });
  assert.deepEqual(
    draws.map((d) => [d.x, d.y]),
    [0, 1, 2].map((y) => {
      const p = project({ x: 0, y });
      return [Math.round(p.x - 24), Math.round(p.y - 30)];
    }),
    "x walls repeat along y",
  );
  draws.length = 0;
  composition.edge(ctx, "partitionY", { x: 2, y: 5, w: 2, h: 0.2 });
  assert.equal(draws.length, 2, "y partitions repeat along x");
  const extent = composition.human(
    ctx,
    { x: 100, y: 200 },
    { size: 0.72, sitting: true, accent: "#123456" },
  );
  assert.deepEqual(extent, { top: 200 - 40 * 0.72, w: 16 * 0.72, h: 40 * 0.72, fallback: true });
  const fills = (skin: string) => {
    const recording = context<FakeImage>();
    return {
      extent: composition.human(
        recording.ctx,
        { x: 100, y: 200 },
        { size: 1, accent: "#123456", skin },
      ),
      seen: recording.fills,
    };
  };
  const claude = fills("blank_amber"),
    codex = fills("blank_blue"),
    plain = fills("blank");
  assert.notDeepEqual(claude.seen, codex.seen);
  assert(
    claude.seen.includes(colors.amber) &&
      codex.seen.includes(colors.cyan) &&
      !plain.seen.includes(colors.amber) &&
      !plain.seen.includes(colors.cyan),
  );
  assert.deepEqual(claude.extent, codex.extent);
  assert.deepEqual(claude.extent, plain.extent);
  assert.deepEqual(claude.extent, { top: 160, w: 16, h: 40, fallback: true });
});
