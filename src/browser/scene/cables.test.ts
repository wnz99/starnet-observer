import { test } from "bun:test";
import assert from "node:assert/strict";
import { CABLE_HEIGHT, mailCablePath, cableRuns } from "./cables.js";

test("only the portion beneath a crossing floor is covered, in either direction", () => {
  const floor = { x: 4, y: -1, w: 2, h: 2 };
  const path = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
  ];
  const runs = cableRuns(path, [floor]);
  assert.deepEqual(
    runs.map((run) => [run.from.x, run.to.x, run.covered]),
    [
      [0, 4, false],
      [4, 6, true],
      [6, 10, false],
    ],
  );
  assert.deepEqual(
    cableRuns(path.slice().reverse(), [floor]).map((run) => [run.from.x, run.to.x, run.covered]),
    [
      [10, 6, false],
      [6, 4, true],
      [4, 0, false],
    ],
  );
});

test("overlapping room and corridor floors dim their union without duplicate strokes", () => {
  const runs = cableRuns(
    [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ],
    [
      { x: 2, y: -2, w: 4, h: 4 },
      { x: 4, y: -1, w: 4, h: 2 },
    ],
  );
  const coveredLength = runs
    .filter((run) => run.covered)
    .reduce((sum, run) => sum + Math.abs(run.to.x - run.from.x), 0);
  const totalLength = runs.reduce((sum, run) => sum + Math.abs(run.to.x - run.from.x), 0);
  assert.equal(coveredLength, 6);
  assert.equal(totalLength, 10);
});

test("edge cables stay outside the corridor while connecting their room terminals", () => {
  const path = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
  ];
  const edge = mailCablePath(path);
  assert.deepEqual(edge[0], { ...path[0], z: CABLE_HEIGHT });
  assert.deepEqual(edge.at(-1), { ...path.at(-1), z: CABLE_HEIGHT });
  const runs = cableRuns(edge, [{ x: -1, y: -1, w: 12, h: 2 }]);
  assert.ok(runs.some((run) => !run.covered && run.from.y === -1.6 && run.to.y === -1.6));
  assert.ok(runs.some((run) => run.covered));
  assert.ok(
    cableRuns(
      [
        { x: 0, y: -1 },
        { x: 10, y: -1 },
      ],
      [{ x: 2, y: -1, w: 4, h: 2 }],
    ).every((run) => !run.covered),
  );
});
