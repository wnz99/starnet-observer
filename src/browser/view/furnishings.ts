import { project as P } from "../scene/index.js";
import type { Decoration, Platform, Point, Rect } from "../scene/types.js";
import type { SpriteResource } from "../sprites/types.js";
import { FurnishingLayout } from "./furnishing-layout.js";
import { CORNER_KINDS, WALL_KINDS, wallUnits } from "./furnishing.js";
import { GeometryPainter } from "./geometry-painter.js";
import type { BoxColors } from "./primitives.js";
import { hash } from "./primitives.js";
import type { Look, ViewContext } from "./types.js";
import { present as required } from "./values.js";
export class Furnishings<R extends SpriteResource> {
  constructor(readonly look: Look) {}

  furnishing = (kind: string, unit: Rect, edge?: string): FurnishingPart[] =>
    new FurnishingLayout(this.look, unit, edge).parts(kind);
  furnishings = (platform: Platform, region: Decoration, index: number) => {
    const kinds = region.kind === "corner" ? CORNER_KINDS : WALL_KINDS;
    return wallUnits(region).flatMap((unit, slot) =>
      this.furnishing(
        required(
          kinds[hash(platform.key + ":" + String(index) + ":" + String(slot)) % kinds.length],
        ),
        unit,
        region.edge,
      ),
    );
  };
  paintWallRegion = (
    ctx: ViewContext<R>,
    platform: Platform,
    region: Decoration,
    index: number,
  ) => {
    const geometry = new GeometryPainter(ctx);
    for (const part of this.furnishings(platform, region, index)) {
      if (part.box) geometry.box(part.box, required(part.height), required(part.colors), part.base);
      else if (part.line)
        geometry.line(required(part.line[0]), required(part.line[1]), {
          color: required(part.color),
          width: part.width,
          alpha: part.alpha,
        });
      else if (part.quad) geometry.poly(part.quad.map(P), part.fill, part.stroke);
      else
        geometry.isoEllipse(required(part.ellipse), required(part.radius), {
          stroke: null,
          fill: part.fill,
        });
    }
  };
}

export interface FurnishingPart {
  box?: Rect;
  height?: number;
  colors?: BoxColors;
  base?: number;
  line?: Point[];
  color?: string;
  width?: number;
  alpha?: number;
  quad?: Point[];
  fill?: string;
  stroke?: string;
  ellipse?: Point;
  radius?: number;
}
