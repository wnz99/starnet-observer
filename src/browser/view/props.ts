import { project as P } from "../scene/index.js";
import type { Observatory, Point, PropExtent } from "../scene/types.js";
import type { SpriteResource } from "../sprites/types.js";
import { GeometryPainter } from "./geometry-painter.js";
import { CREW_HEIGHT } from "./primitives.js";
import type { Look, ViewContext } from "./types.js";
const SCREEN = {
  topInset: 0.4,
  housingDepth: 0.3,
  frozenPhase: 0.3,
  sweepWidthInset: 0.3,
  frameInset: 0.15,
  faceBase: 1.1,
  sweepPeriod: 6000,
  sweepPhaseSpacing: 7,
  sweepBase: 1.15,
  sweepTopInset: 0.05,
  lineAlpha: 0.6,
};
const TELESCOPE = {
  coreWidth: 2,
  mountHeight: 1.6,
  tailLength: 0.3,
  tipTopInset: 0.3,
  legWidth: 1.5,
  sweepPeriod: 40000,
  sweepDegrees: 6,
  halfTurnDegrees: 180,
  barrelLength: 0.7,
  tailHeight: 1.3,
  shellWidth: 4,
  lensRadius: 0.08,
};
const PLANT = {
  potInset: 0.25,
  potWidth: 0.5,
  potHeight: 0.45,
  leafRadius: 0.22,
};
const LAMP = {
  postWidth: 2,
  postTopInset: 0.2,
  lensTopInset: 0.15,
  lensRadius: 0.16,
};
const VIEWER = {
  bodyWidth: 16,
  shadowRadius: 0.28,
  alpha: 0.8,
  cornerRadius: 6,
  bodyHeightRatio: 0.72,
  headRadius: 6,
  headHeightRatio: 0.84,
};
const CENTER_DIVISOR = 2;
const TURN_MULTIPLIER = 2;
const TRIPOD_FEET = [
  { x: -0.4, y: 0.3 },
  { x: 0.4, y: 0.3 },
  { x: 0, y: -0.45 },
];
const PLANT_LEAVES = [
  { x: 0.4, y: 0.5, z: 0.9 },
  { x: 0.65, y: 0.4, z: 1.3 },
  { x: 0.5, y: 0.6, z: 1.7 },
];
export class Props<R extends SpriteResource> {
  readonly geometry;
  constructor(
    readonly look: Look,
    readonly context: ViewContext<R>,
  ) {
    this.geometry = new GeometryPainter(context);
  }
  glow = (point: Point, radius: number, color: string, alpha: number) => {
    this.geometry.glow(point, radius, {
      color: color,
      alpha: alpha,
      transparent: this.look.colors["glow-transparent"],
    });
  };
  // Observatory props share the depth stream so passing crew occlude them correctly.
  paintObservatoryScreen = (screen: PropExtent, now: number, animate: boolean) => {
    const r = screen.rect,
      front = r.y + r.h,
      top = screen.height - SCREEN.topInset;
    this.geometry.box({ x: r.x, y: r.y, w: r.w, h: SCREEN.housingDepth }, screen.height, {
      top: this.look.colors["observatory-screen-top"],
      left: this.look.colors["observatory-screen-left"],
      right: this.look.colors["observatory-screen-right"],
    });
    const face = [
      { x: r.x + SCREEN.frameInset, y: r.y + SCREEN.housingDepth, z: SCREEN.faceBase },
      { x: r.x + r.w - SCREEN.frameInset, y: r.y + SCREEN.housingDepth, z: SCREEN.faceBase },
      { x: r.x + r.w - SCREEN.frameInset, y: r.y + SCREEN.housingDepth, z: top },
      { x: r.x + SCREEN.frameInset, y: r.y + SCREEN.housingDepth, z: top },
    ];
    this.geometry.poly(
      face.map(P),
      this.look.colors["observatory-screen-face"],
      this.look.colors.cyan,
    );
    // Ambient radar sweep; a frozen scene keeps one fixed phase.
    const phase = animate
        ? (now / SCREEN.sweepPeriod + r.x / SCREEN.sweepPhaseSpacing) % 1
        : SCREEN.frozenPhase,
      x = r.x + SCREEN.frameInset + phase * (r.w - SCREEN.sweepWidthInset);
    this.geometry.line(
      { x, y: r.y + SCREEN.housingDepth, z: SCREEN.sweepBase },
      { x, y: r.y + SCREEN.housingDepth, z: top - SCREEN.sweepTopInset },
      { color: this.look.colors.cyan, width: 1, alpha: SCREEN.lineAlpha },
    );
    this.geometry.line(
      { x: r.x, y: front, z: 0 },
      { x: r.x + r.w, y: front, z: 0 },
      { color: this.look.colors["observatory-screen-base"], width: 1, alpha: SCREEN.lineAlpha },
    );
  };
  paintTelescope = (telescope: PropExtent, now: number, animate: boolean) => {
    const r = telescope.rect,
      base = { x: r.x + r.w / CENTER_DIVISOR, y: r.y + r.h / CENTER_DIVISOR },
      mount = { ...base, z: TELESCOPE.mountHeight };
    for (const foot of TRIPOD_FEET)
      this.geometry.line({ x: base.x + foot.x, y: base.y + foot.y, z: 0 }, mount, {
        color: this.look.colors.rail,
        width: TELESCOPE.legWidth,
      });
    // A slow ±6° ambient sweep over the rear rail, frozen when stale or reduced.
    const angle =
      ((animate
        ? Math.sin((now / TELESCOPE.sweepPeriod) * Math.PI * TURN_MULTIPLIER) *
          TELESCOPE.sweepDegrees
        : 0) *
        Math.PI) /
      TELESCOPE.halfTurnDegrees;
    const tip = {
        x: mount.x + Math.sin(angle) * TELESCOPE.barrelLength,
        y: mount.y - Math.cos(angle) * TELESCOPE.barrelLength,
        z: telescope.height - TELESCOPE.tipTopInset,
      },
      tail = {
        x: mount.x - Math.sin(angle) * TELESCOPE.tailLength,
        y: mount.y + Math.cos(angle) * TELESCOPE.tailLength,
        z: TELESCOPE.tailHeight,
      };
    this.geometry.line(tail, tip, {
      color: this.look.colors["telescope-shell"],
      width: TELESCOPE.shellWidth,
    });
    this.geometry.line(tail, tip, {
      color: this.look.colors["telescope-core"],
      width: TELESCOPE.coreWidth,
    });
    this.geometry.isoEllipse(tip, TELESCOPE.lensRadius, {
      stroke: null,
      fill: this.look.colors.cyan,
    });
  };
  paintPlant = (plant: PropExtent) => {
    const r = plant.rect;
    this.geometry.box(
      { x: r.x + PLANT.potInset, y: r.y + PLANT.potInset, w: PLANT.potWidth, h: PLANT.potWidth },
      PLANT.potHeight,
      {
        top: this.look.colors["planter-top"],
        left: this.look.colors["planter-left"],
        right: this.look.colors["planter-right"],
      },
    );
    for (const leaf of PLANT_LEAVES)
      this.geometry.isoEllipse({ x: r.x + leaf.x, y: r.y + leaf.y, z: leaf.z }, PLANT.leafRadius, {
        stroke: null,
        fill: this.look.colors["plant-leaf"],
      });
  };
  paintLamp = (light: PropExtent) => {
    const r = light.rect,
      post = { x: r.x + r.w / CENTER_DIVISOR, y: r.y + r.h / CENTER_DIVISOR };
    this.geometry.line(
      { ...post, z: 0 },
      { ...post, z: light.height - LAMP.postTopInset },
      { color: this.look.colors.rail, width: LAMP.postWidth },
    );
    this.geometry.isoEllipse({ ...post, z: light.height - LAMP.lensTopInset }, LAMP.lensRadius, {
      stroke: null,
      fill: this.look.colors.cyan,
    });
  };
  // The Viewer is ambient: the neutral fallback figure, never a provider skin, status colour or hit target.
  paintViewer = (viewer: NonNullable<Observatory["viewer"]>) => {
    const foot = P(viewer.point),
      h = CREW_HEIGHT,
      w = VIEWER.bodyWidth;
    this.geometry.isoEllipse(viewer.point, VIEWER.shadowRadius, {
      stroke: null,
      fill: this.look.colors["contact-shadow"],
    });
    this.context.save();
    this.context.globalAlpha = VIEWER.alpha;
    this.context.fillStyle = this.look.colors["viewer-body"];
    this.context.strokeStyle = this.look.colors["body-outline"];
    this.context.beginPath();
    if (this.context.roundRect)
      this.context.roundRect(
        foot.x - w / CENTER_DIVISOR,
        foot.y - h * VIEWER.bodyHeightRatio,
        w,
        h * VIEWER.bodyHeightRatio,
        VIEWER.cornerRadius,
      );
    else
      this.context.rect(
        foot.x - w / CENTER_DIVISOR,
        foot.y - h * VIEWER.bodyHeightRatio,
        w,
        h * VIEWER.bodyHeightRatio,
      );
    this.context.fill();
    this.context.stroke();
    this.context.beginPath();
    this.context.arc(
      foot.x,
      foot.y - h * VIEWER.headHeightRatio,
      VIEWER.headRadius,
      0,
      Math.PI * TURN_MULTIPLIER,
    );
    this.context.fill();
    this.context.stroke();
    this.context.restore();
  };
}
