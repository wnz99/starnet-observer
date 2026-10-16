import type { Decoration } from "../scene/types.js";
const WALL_UNIT = { spacing: 3, inset: 0.5, length: 2 };

// Wall and corner furnishings never reshuffle between polls: the kind is a hash of platform key and region.
export const WALL_KINDS = ["rack", "screen", "vent", "rack", "board"],
  CORNER_KINDS = ["tank", "planter", "crates", "mast"];
export const wallUnits = (region: Decoration) => {
  const r = region.rect;
  if (region.kind === "corner") return [r];
  return region.edge === "rear-x"
    ? Array.from({ length: Math.floor(r.h / WALL_UNIT.spacing) }, (_, i) => ({
        x: r.x,
        y: r.y + i * WALL_UNIT.spacing + WALL_UNIT.inset,
        w: r.w,
        h: WALL_UNIT.length,
      }))
    : Array.from({ length: Math.floor(r.w / WALL_UNIT.spacing) }, (_, i) => ({
        x: r.x + i * WALL_UNIT.spacing + WALL_UNIT.inset,
        y: r.y,
        w: WALL_UNIT.length,
        h: r.h,
      }));
};
