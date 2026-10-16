/* Home-office scene art: one complete, atomic PNG group per view and fixed role composition helpers.
   Application owns sizes, anchors and repetition. Painters supply their own points and rects. */
import {
  SCENE_ART_ROLES as ROLES,
  SCENE_ART_ROLE_NAMES as ROLE_NAMES,
} from "../shared/scene-art-roles.js";
import type { SceneArtRoleName } from "../shared/scene-art-roles.js";
import type { Composition, OfficeContext, Point, Rect } from "./office-art/types.js";
import { createHuman } from "./office-art/human.js";
export { load } from "./office-art/loading.js";
export { ROLE_NAMES };
/* Fixed composition draws native images with their foot at the projected origin, rounded to whole pixels. */
const EDGE_CLIP_TOP = -1e6;
const EDGE_CLIP_HEIGHT = 2e6;
function origin(project: Composition<unknown>["project"], role: SceneArtRoleName, point: Point) {
  const at = project(point),
    foot = ROLES[role].foot;
  return { x: Math.round(at.x - foot.x), y: Math.round(at.y - foot.y) };
}
export function create<I>({ images, colors, project, crewHeight }: Composition<I>) {
  function draw(ctx: OfficeContext<I>, role: SceneArtRoleName, point: Point) {
    const image = images[role],
      { width, height } = ROLES[role].source,
      at = origin(project, role, point);
    ctx.drawImage(image, at.x, at.y, width, height);
  }
  // Diamond surface roles (repeat 'tile'): one native tile per whole cell, clipped to the floor rect.
  function tile(ctx: OfficeContext<I>, role: SceneArtRoleName, rect: Rect, z = 0) {
    const corners = [
      { x: rect.x, y: rect.y },
      { x: rect.x + rect.w, y: rect.y },
      { x: rect.x + rect.w, y: rect.y + rect.h },
      { x: rect.x, y: rect.y + rect.h },
    ].map((p) => project({ ...p, z }));
    ctx.save();
    ctx.beginPath();
    corners.forEach((p, i) => {
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.closePath();
    ctx.clip();
    for (let x = Math.floor(rect.x); x < rect.x + rect.w; x++)
      for (let y = Math.floor(rect.y); y < rect.y + rect.h; y++) draw(ctx, role, { x, y, z });
    ctx.restore();
  }
  /* Edge roles (repeat 'edge'): one native unit per whole step along the role's orientation ('x' walls stand on a
       constant x and run along y; 'y' walls the reverse), clipped to the rect's projected horizontal span. */
  function edge(ctx: OfficeContext<I>, role: SceneArtRoleName, rect: Rect, z = 0) {
    const alongY = ROLES[role].orientation === "x",
      length = alongY ? rect.h : rect.w;
    const [left, right] = [
      project({ x: rect.x, y: rect.y + rect.h, z }).x,
      project({ x: rect.x + rect.w, y: rect.y, z }).x,
    ];
    ctx.save();
    ctx.beginPath();
    ctx.rect(Math.min(left, right), EDGE_CLIP_TOP, Math.abs(right - left), EDGE_CLIP_HEIGHT);
    ctx.clip();
    for (let step = 0; step < length; step++)
      draw(
        ctx,
        role,
        alongY ? { x: rect.x, y: rect.y + step, z } : { x: rect.x + step, y: rect.y, z },
      );
    ctx.restore();
  }
  return Object.freeze({ draw, tile, edge, human: createHuman<I>(colors, crewHeight) });
}
