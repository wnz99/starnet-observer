import { project } from "../scene/index.js";
import type { Point, Rect } from "../scene/types.js";
import type { SpriteResource } from "../sprites/types.js";
import type { BoxColors } from "./primitives.js";
import { center, corners, visibleFaces } from "./primitives.js";
import type { ViewContext } from "./types.js";
const FLOOR_ELLIPSE = { x: 34, y: 17 };
const FULL_TURN = Math.PI * 2;
const GLOW_ASPECT = 2;
const WALKWAY_TRIM_HEIGHT = 0.01;
export class GeometryPainter<R extends SpriteResource> {
  constructor(readonly context: ViewContext<R>) {}
  poly(points: readonly Point[], fill?: string | null, stroke?: string | null) {
    const c = this.context;
    c.beginPath();
    points.forEach((point, index) => {
      if (index) c.lineTo(point.x, point.y);
      else c.moveTo(point.x, point.y);
    });
    c.closePath();
    if (fill) {
      c.fillStyle = fill;
      c.fill();
    }
    if (stroke) {
      c.strokeStyle = stroke;
      c.stroke();
    }
  }
  prism(points: readonly Point[], top: number, bottom: number, colors: BoxColors) {
    for (const { a, b, side } of visibleFaces(points))
      this.poly(
        [
          project({ ...a, z: top }),
          project({ ...b, z: top }),
          project({ ...b, z: bottom }),
          project({ ...a, z: bottom }),
        ],
        colors[side] || colors.right,
      );
    this.poly(
      points.map((point) => project({ ...point, z: top })),
      colors.top,
      colors.edge,
    );
  }
  box(rect: Rect, height: number, colors: BoxColors, base = 0) {
    this.prism(corners(rect), base + height, base, colors);
  }
  isoEllipse(point: Point, radius: number, { stroke, fill, width = 1 }: EllipseStyle) {
    const c = this.context,
      at = project(point);
    c.beginPath();
    c.ellipse(at.x, at.y, radius * FLOOR_ELLIPSE.x, radius * FLOOR_ELLIPSE.y, 0, 0, FULL_TURN);
    if (fill) {
      c.fillStyle = fill;
      c.fill();
    }
    if (stroke) {
      c.lineWidth = width;
      c.strokeStyle = stroke;
      c.stroke();
      c.lineWidth = 1;
    }
  }
  line(a: Point, b: Point, { color, width = 1, alpha = 1 }: LineStyle) {
    const c = this.context,
      from = project(a),
      to = project(b);
    c.save();
    c.globalAlpha *= alpha;
    c.strokeStyle = color;
    c.lineWidth = width;
    c.beginPath();
    c.moveTo(from.x, from.y);
    c.lineTo(to.x, to.y);
    c.stroke();
    c.restore();
  }
  walkwayTrim(rect: Rect, accent: string | undefined) {
    if (!accent) return;
    const middle = center(rect),
      z = WALKWAY_TRIM_HEIGHT;
    this.line(
      rect.w >= rect.h ? { ...middle, x: rect.x, z } : { ...middle, y: rect.y, z },
      rect.w >= rect.h
        ? { ...middle, x: rect.x + rect.w, z }
        : { ...middle, y: rect.y + rect.h, z },
      { color: accent },
    );
  }
  grid(rect: Rect, { step, alpha, color }: GridStyle) {
    this.context.save();
    this.context.globalAlpha *= alpha;
    for (let x = rect.x + step; x < rect.x + rect.w; x += step)
      this.line({ x, y: rect.y }, { x, y: rect.y + rect.h }, { color });
    for (let y = rect.y + step; y < rect.y + rect.h; y += step)
      this.line({ x: rect.x, y }, { x: rect.x + rect.w, y }, { color });
    this.context.restore();
  }
  frontEdges(rect: Rect, style: LineStyle) {
    this.line({ x: rect.x, y: rect.y + rect.h }, { x: rect.x + rect.w, y: rect.y + rect.h }, style);
    this.line({ x: rect.x + rect.w, y: rect.y }, { x: rect.x + rect.w, y: rect.y + rect.h }, style);
  }
  skirtWindows(rect: Rect, recipe: SkirtWindows) {
    const { start, end, gap, width, top, bottom } = recipe;
    for (let x = rect.x + start; x < rect.x + rect.w - end; x += gap)
      this.poly(
        [
          project({ x, y: rect.y + rect.h, z: top }),
          project({ x: x + width, y: rect.y + rect.h, z: top }),
          project({ x: x + width, y: rect.y + rect.h, z: bottom }),
          project({ x, y: rect.y + rect.h, z: bottom }),
        ],
        recipe.front,
      );
    for (let y = rect.y + start; y < rect.y + rect.h - end; y += gap)
      this.poly(
        [
          project({ x: rect.x + rect.w, y, z: top }),
          project({ x: rect.x + rect.w, y: y + width, z: top }),
          project({ x: rect.x + rect.w, y: y + width, z: bottom }),
          project({ x: rect.x + rect.w, y, z: bottom }),
        ],
        recipe.side,
      );
  }

  walkwayRails(rect: Rect, recipe: WalkwayRails) {
    const long = rect.w >= rect.h,
      length = long ? rect.w : rect.h;
    for (let t = 0; t <= length; t += recipe.postStep)
      this.walkwaySupports({ rect, long, t }, recipe);
    for (const side of [0, 1]) {
      const a = long
          ? { x: rect.x, y: rect.y + side * rect.h }
          : { x: rect.x + side * rect.w, y: rect.y },
        b = long
          ? { x: rect.x + rect.w, y: rect.y + side * rect.h }
          : { x: rect.x + side * rect.w, y: rect.y + rect.h };
      this.line(
        { ...a, z: recipe.post },
        { ...b, z: recipe.post },
        { color: recipe.rail, width: recipe.railWidth },
      );
    }
  }
  private walkwaySupports(
    { rect: r, long, t }: { rect: Rect; long: boolean; t: number },
    recipe: WalkwayRails,
  ) {
    for (const side of [0, 1]) {
      const base = long ? { x: r.x + t, y: r.y + side * r.h } : { x: r.x + side * r.w, y: r.y + t };
      this.line({ ...base, z: 0 }, { ...base, z: recipe.post }, { color: recipe.rail, width: 1 });
      if (t % recipe.lampEvery === 0 && side)
        this.isoEllipse({ ...base, z: recipe.lamp }, recipe.lampRadius, {
          stroke: null,
          fill: recipe.lampColor,
        });
    }
    if (t % recipe.supportEvery === 0) {
      const base = long ? { x: r.x + t, y: r.y + r.h } : { x: r.x + r.w, y: r.y + t };
      this.line(
        { ...base, z: recipe.bottom },
        { ...base, z: recipe.support },
        { color: recipe.supportColor, width: recipe.supportWidth, alpha: recipe.supportAlpha },
      );
    }
  }

  glow(point: Point, radius: number, { color, alpha, transparent }: GlowStyle) {
    const c = this.context,
      at = project(point),
      gradient = c.createRadialGradient(at.x, at.y, 0, at.x, at.y, radius);
    gradient.addColorStop(0, color);
    gradient.addColorStop(1, transparent);
    c.save();
    c.globalAlpha *= alpha;
    c.globalCompositeOperation = "lighter";
    c.fillStyle = gradient;
    c.beginPath();
    c.ellipse(at.x, at.y, radius, radius / GLOW_ASPECT, 0, 0, FULL_TURN);
    c.fill();
    c.restore();
  }
}

interface EllipseStyle {
  stroke?: string | null | undefined;
  fill?: string | null | undefined;
  width?: number | undefined;
}
interface LineStyle {
  color: string;
  width?: number | undefined;
  alpha?: number | undefined;
}
interface GlowStyle {
  color: string;
  alpha: number;
  transparent: string;
}

interface GridStyle {
  step: number;
  alpha: number;
  color: string;
}
interface SkirtWindows {
  start: number;
  end: number;
  gap: number;
  width: number;
  top: number;
  bottom: number;
  front: string;
  side: string;
}
export function octagon(rect: Rect, corner: number, inset?: number): Point[] {
  if (inset === undefined)
    return [
      { x: rect.x + corner, y: rect.y },
      { x: rect.x, y: rect.y + corner },
      { x: rect.x, y: rect.y + rect.h - corner },
      { x: rect.x + corner, y: rect.y + rect.h },
      { x: rect.x + rect.w - corner, y: rect.y + rect.h },
      { x: rect.x + rect.w, y: rect.y + rect.h - corner },
      { x: rect.x + rect.w, y: rect.y + corner },
      { x: rect.x + rect.w - corner, y: rect.y },
    ];
  return [
    { x: rect.x + corner, y: rect.y + inset },
    { x: rect.x + inset, y: rect.y + corner },
    { x: rect.x + inset, y: rect.y + rect.h - corner },
    { x: rect.x + corner, y: rect.y + rect.h - inset },
    { x: rect.x + rect.w - corner, y: rect.y + rect.h - inset },
    { x: rect.x + rect.w - inset, y: rect.y + rect.h - corner },
    { x: rect.x + rect.w - inset, y: rect.y + corner },
    { x: rect.x + rect.w - corner, y: rect.y + inset },
  ];
}

interface WalkwayRails {
  rail: string;
  railWidth: number;
  postStep: number;
  post: number;
  lampEvery: number;
  lamp: number;
  lampRadius: number;
  lampColor: string;
  supportEvery: number;
  bottom: number;
  support: number;
  supportWidth: number;
  supportAlpha: number;
  supportColor: string;
}
