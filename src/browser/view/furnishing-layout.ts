import type { Point, Rect } from "../scene/types.js";
import type { FurnishingPart } from "./furnishings.js";
import type { BoxColors } from "./primitives.js";
import type { Look } from "./types.js";
import { present } from "./values.js";
const FIT = { wallMargin: 0.2, backMargin: 0.1 };
const RACK = {
  inset: 0.1,
  depth: 1,
  along: 0.1,
  length: 1.4,
  height: 1.1,
  shelfStart: 0.25,
  shelfEnd: 1,
  shelfStep: 0.22,
  shelfLeft: 0.3,
  shelfRight: 1.1,
};
const SCREEN = {
  inset: 0.05,
  depth: 0.12,
  along: 0.1,
  length: 1.8,
  height: 1.1,
  left: 0.2,
  right: 1.8,
  bottom: 0.45,
  top: 1.05,
  lineStart: 0.62,
  lineEnd: 0.85,
  lineAlpha: 0.7,
};
const VENT = {
  inset: 0.2,
  depth: 0.6,
  along: 0.3,
  length: 1.2,
  height: 0.5,
  lineLeft: 0.4,
  lineRight: 1.4,
  lineHeight: 0.3,
  lineAlpha: 0.8,
};
const BOARD = { inset: 0.2, depth: 0.3, along: 0.2, length: 1.4, height: 0.9 };
const TANK = {
  along: 0.1,
  inset: 0.2,
  length: 0.8,
  depth: 0.8,
  height: 1,
  lineLeft: 0.1,
  lineRight: 0.9,
  lineDepth: 1,
  lineHeight: 0.6,
  lineAlpha: 0.6,
};
const PLANTER = {
  along: 0.1,
  inset: 0.3,
  length: 0.8,
  depth: 1.2,
  height: 0.35,
  leaves: [
    [0.3, 0.6],
    [0.6, 1.1],
    [0.45, 0.9],
  ] satisfies [number, number][],
  leafHeight: 0.55,
  leafRadius: 0.16,
};
const CRATES = {
  along: 0.1,
  inset: 0.3,
  length: 0.8,
  depth: 0.8,
  height: 0.5,
  stackAlong: 0.2,
  stackInset: 0.4,
  stackLength: 0.5,
  stackDepth: 0.5,
  stackHeight: 0.4,
  stackBase: 0.5,
};
const MAST = { along: 0.5, inset: 1, height: 2.2, width: 2, radius: 0.12 };
function box(rect: Rect, height: number, colors: BoxColors, base = 0): FurnishingPart {
  return { box: rect, height, colors, base };
}
function stroke(
  a: Point,
  b: Point,
  { color, width = 1, alpha = 1 }: { color: string; width?: number; alpha?: number },
): FurnishingPart {
  return { line: [a, b], color, width, alpha };
}
// Reserved wall units use along/depth coordinates; fitting keeps their obstacles and painted footprints together.
export class FurnishingLayout {
  private readonly rearX;
  constructor(
    readonly look: Look,
    readonly unit: Rect,
    edge?: string,
  ) {
    this.rearX = edge === "rear-x";
  }
  parts(kind: string): FurnishingPart[] {
    switch (kind) {
      case "rack":
        return this.rack();
      case "screen":
        return this.screen();
      case "vent":
        return this.vent();
      case "board":
        return this.board();
      case "tank":
        return this.tank();
      case "planter":
        return this.planter();
      case "crates":
        return this.crates();
      default:
        return this.mast();
    }
  }
  private at(along: number, depth: number, z = 0): Point {
    return this.rearX
      ? { x: this.unit.x + depth, y: this.unit.y + along, z }
      : { x: this.unit.x + along, y: this.unit.y + depth, z };
  }
  private foot(along: number, depth: number, length: number, deep: number): Rect {
    return this.rearX
      ? { x: this.unit.x + depth, y: this.unit.y + along, w: deep, h: length }
      : { x: this.unit.x + along, y: this.unit.y + depth, w: length, h: deep };
  }
  private fit(inset: number, want: number): [number, number] {
    const depth = this.rearX ? this.unit.w : this.unit.h,
      deep = Math.min(want, depth - FIT.wallMargin);
    return [Math.min(inset, depth - deep - FIT.backMargin), deep];
  }
  private dark() {
    return {
      top: this.look.colors["furnishing-top"],
      left: this.look.colors["furnishing-left"],
      right: this.look.colors["furnishing-right"],
    };
  }
  private rack() {
    const [depth, deep] = this.fit(RACK.inset, RACK.depth),
      front = depth + deep;
    const parts: FurnishingPart[] = [
      box(this.foot(RACK.along, depth, RACK.length, deep), RACK.height, this.dark()),
    ];
    for (let z = RACK.shelfStart; z < RACK.shelfEnd; z += RACK.shelfStep)
      parts.push(
        stroke(this.at(RACK.shelfLeft, front, z), this.at(RACK.shelfRight, front, z), {
          color: this.look.colors["rack-shelf"],
        }),
      );
    return parts;
  }
  private screen(): FurnishingPart[] {
    const [depth, deep] = this.fit(SCREEN.inset, SCREEN.depth),
      front = depth + deep;
    const face = [
      this.at(SCREEN.left, front, SCREEN.bottom),
      this.at(SCREEN.right, front, SCREEN.bottom),
      this.at(SCREEN.right, front, SCREEN.top),
      this.at(SCREEN.left, front, SCREEN.top),
    ];
    return [
      box(this.foot(SCREEN.along, depth, SCREEN.length, deep), SCREEN.height, this.dark()),
      { quad: face, fill: this.look.colors["wall-screen-face"], stroke: this.look.colors.cyan },
      stroke(
        { ...present(face[0]), z: SCREEN.lineStart },
        { ...present(face[1]), z: SCREEN.lineEnd },
        { color: this.look.colors.cyan, alpha: SCREEN.lineAlpha },
      ),
    ];
  }
  private vent(): FurnishingPart[] {
    const [depth, deep] = this.fit(VENT.inset, VENT.depth),
      front = depth + deep;
    return [
      box(this.foot(VENT.along, depth, VENT.length, deep), VENT.height, {
        top: this.look.colors["vent-top"],
        left: this.look.colors["vent-left"],
        right: this.look.colors["vent-right"],
      }),
      stroke(
        this.at(VENT.lineLeft, front, VENT.lineHeight),
        this.at(VENT.lineRight, front, VENT.lineHeight),
        { color: this.look.colors.amber, alpha: VENT.lineAlpha },
      ),
    ];
  }
  private board(): FurnishingPart[] {
    const [depth, deep] = this.fit(BOARD.inset, BOARD.depth);
    return [
      box(this.foot(BOARD.along, depth, BOARD.length, deep), BOARD.height, {
        top: this.look.colors["board-top"],
        left: this.look.colors["board-left"],
        right: this.look.colors["board-right"],
      }),
    ];
  }
  private tank(): FurnishingPart[] {
    return [
      box(this.foot(TANK.along, TANK.inset, TANK.length, TANK.depth), TANK.height, {
        top: this.look.colors["tank-top"],
        left: this.look.colors["tank-left"],
        right: this.look.colors["tank-right"],
      }),
      stroke(
        this.at(TANK.lineLeft, TANK.lineDepth, TANK.lineHeight),
        this.at(TANK.lineRight, TANK.lineDepth, TANK.lineHeight),
        { color: this.look.colors.cyan, alpha: TANK.lineAlpha },
      ),
    ];
  }
  private planter(): FurnishingPart[] {
    return [
      box(this.foot(PLANTER.along, PLANTER.inset, PLANTER.length, PLANTER.depth), PLANTER.height, {
        top: this.look.colors["planter-top"],
        left: this.look.colors["planter-left"],
        right: this.look.colors["planter-right"],
      }),
      ...PLANTER.leaves.map(([along, depth]) => ({
        ellipse: this.at(along, depth, PLANTER.leafHeight),
        radius: PLANTER.leafRadius,
        fill: this.look.colors["plant-leaf"],
      })),
    ];
  }
  private crates(): FurnishingPart[] {
    return [
      box(this.foot(CRATES.along, CRATES.inset, CRATES.length, CRATES.depth), CRATES.height, {
        top: this.look.colors["crate-top"],
        left: this.look.colors["crate-left"],
        right: this.look.colors["crate-right"],
      }),
      box(
        this.foot(CRATES.stackAlong, CRATES.stackInset, CRATES.stackLength, CRATES.stackDepth),
        CRATES.stackHeight,
        {
          top: this.look.colors["crate-stack-top"],
          left: this.look.colors["crate-stack-left"],
          right: this.look.colors["crate-stack-right"],
        },
        CRATES.stackBase,
      ),
    ];
  }
  private mast(): FurnishingPart[] {
    return [
      stroke(this.at(MAST.along, MAST.inset, 0), this.at(MAST.along, MAST.inset, MAST.height), {
        color: this.look.colors.rail,
        width: MAST.width,
      }),
      {
        ellipse: this.at(MAST.along, MAST.inset, MAST.height),
        radius: MAST.radius,
        fill: this.look.colors["mast-beacon"],
      },
    ];
  }
}
