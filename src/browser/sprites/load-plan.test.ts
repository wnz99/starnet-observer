import { test, expect } from "bun:test";
import { frameCount, groupTracks, initialTracks } from "./load-plan.js";
test("startup planning copies valid tracks, deduplicates sets and counts only selected frames", () => {
  const sprites = {
    "blank.walk.south": ["blank/a.png", "blank/b.png"],
    "blank.rot.south": ["blank/c.png"],
    "other.walk.south": ["other/a.png"],
    missingSet: ["x.png"],
    "bad.empty": [],
    "bad.value": 3,
  };
  const grouped = groupTracks(sprites);
  const tracks = initialTracks(grouped, ["blank", "blank", "missing"]);
  expect(tracks).toEqual([
    ["blank.walk.south", ["blank/a.png", "blank/b.png"]],
    ["blank.rot.south", ["blank/c.png"]],
  ]);
  expect(frameCount(tracks)).toBe(3);
  sprites["blank.walk.south"].push("later.png");
  expect(frameCount(tracks)).toBe(3);
  expect(groupTracks(null)).toEqual({});
});
