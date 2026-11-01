import { test } from "bun:test";
import assert from "node:assert/strict";
import { drawing } from "./drawing.fixture.js";
import { GeometryPainter } from "./geometry-painter.js";

test("underpasses multiply health opacity only for covered strokes and preserve dash continuity", () => {
  const strokes: { alpha: number; dash: number }[] = [];
  const ctx = drawing({
    stroke() {
      strokes.push({ alpha: ctx.globalAlpha, dash: ctx.lineDashOffset });
    },
  });
  ctx.lineDashOffset = 3;
  new GeometryPainter(ctx).cable(
    [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ],
    [{ x: 4, y: -1, w: 2, h: 2 }],
    { alpha: 0.5, height: 0.1 },
  );
  assert.deepEqual(
    strokes.map((stroke) => stroke.alpha),
    [0.5, 0.11, 0.5],
  );
  const [first, middle, last] = strokes;
  assert.ok(first && middle && last);
  assert.ok(middle.dash < first.dash && last.dash < middle.dash);
  assert.equal(ctx.globalAlpha, 0.5);
  assert.equal(ctx.lineDashOffset, 3);
});
