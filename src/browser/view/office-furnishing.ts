import type { SceneArtRoleName } from "../../shared/scene-art-roles.js";
import { SCENE_ART_ROLES as ROLES } from "../../shared/scene-art-roles.js";
import type { Rect } from "../scene/types.js";
import { present as required } from "./values.js";
const OFFICE_WALL: Record<string, ["cabinet" | "bookcase" | "radiator" | "board", number, number]> =
  {
    rack: ["cabinet", 0.1, 0.1],
    screen: ["bookcase", 0.1, 0.05],
    vent: ["radiator", 0.3, 0.2],
    board: ["board", 0.2, 0.2],
  };
const OFFICE_CORNER: Record<string, [SceneArtRoleName, number, number]> = {
  tank: ["waterCooler", 0.1, 0.2],
  planter: ["plant", 0, 0.5],
  crates: ["basket", 0.1, 0.3],
  mast: ["lamp", 0, 0.5],
};
export function officeFurnishing(kind: string, unit: Rect, edge?: string) {
  if (OFFICE_CORNER[kind]) {
    const [role, a, d] = required(OFFICE_CORNER[kind]),
      e = ROLES[role].extent;
    return { role, rect: { x: unit.x + a, y: unit.y + d, w: e.w, h: e.h } };
  }
  const [stem, along, inset] = required(OFFICE_WALL[kind]),
    rearX = edge === "rear-x",
    role: SceneArtRoleName = `${stem}${rearX ? "X" : "Y"}`,
    e = ROLES[role].extent;
  const depth = Math.max(0, Math.min(inset, rearX ? unit.w - e.w : unit.h - e.h));
  return {
    role,
    rect: rearX
      ? { x: unit.x + depth, y: unit.y + along, w: e.w, h: e.h }
      : { x: unit.x + along, y: unit.y + depth, w: e.w, h: e.h },
  };
}
