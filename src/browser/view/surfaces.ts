import { project as P } from "../scene/index.js";
import type { Mailroom, Observatory, Point, Rect, Walkway } from "../scene/types.js";
import type { SpriteResource } from "../sprites/types.js";
import { GeometryPainter, octagon } from "./geometry-painter.js";
import { corners, rectPoly } from "./primitives.js";
import type { Look, ViewContext } from "./types.js";
import { present as required } from "./values.js";

const DECK = {
  bottom: -1,
  alternating: 2,
  grid: { step: 2, alpha: 0.55 },
  edge: { width: 2, alpha: 0.9 },
};
const WINDOWS = { start: 0.75, end: 0.5, gap: 1.5, width: 0.6, top: -0.38, bottom: -0.55 };
const WALL = { height: 1.25, alpha: 0.6, seamStep: 2, capWidth: 2 };
const WALKWAY = {
  bottom: -0.35,
  grid: { step: 0.5, alpha: 0.5 },
  postStep: 2,
  post: 0.3,
  lampEvery: 8,
  lamp: 0.34,
  lampRadius: 0.06,
  supportEvery: 6,
  support: -2.5,
  supportWidth: 2,
  supportAlpha: 0.8,
  relayWidth: 2,
};
const HUB = {
  corner: 2,
  bottom: -1.5,
  inset: 0.5,
  underlay: 6,
  dash: [10, 10],
  stripe: 4,
  pad: 1.1,
  padWidth: 1.5,
  ring: 0.7,
  glow: 30,
  glowAlpha: 0.18,
};
const POD = {
  halfWidth: 0.6,
  halfDepth: 0.5,
  width: 1.2,
  height: 0.9,
  stripe: 0.25,
  stripeStep: 0.3,
  alpha: 0.5,
};
const CHUTE = {
  start: 1.5,
  halfDepth: 0.35,
  extension: 2,
  depth: 0.7,
  height: 0.25,
  dashStart: 1.2,
  dashStep: 0.8,
  dashSize: 0.3,
  dashHeight: 0.26,
  alpha: 0.8,
};
const TOWER = {
  height: 3.2,
  rim: 2.4,
  width: 2,
  alpha: 0.8,
  windowStart: 0.6,
  windowEnd: 2.2,
  windowStep: 0.5,
  windowInset: 0.6,
};
const OBSERVATORY = {
  bottom: -1,
  grid: { step: 2, alpha: 0.5 },
  edge: { width: 2, alpha: 0.7 },
  lightOffset: 1.5,
  glow: 70,
  alpha: 0.35,
};
const CENTER_DIVISOR = 2;

export class Surfaces<R extends SpriteResource> {
  readonly geometry;
  constructor(
    readonly look: Look,
    readonly context: ViewContext<R>,
  ) {
    this.geometry = new GeometryPainter(context);
  }
  glow = (point: Point, radius: number, color: string, alpha: number) => {
    this.geometry.glow(point, radius, {
      color,
      alpha,
      transparent: this.look.colors["glow-transparent"],
    });
  };
  // ---------- static world art: decks, skirts, walls, walkways, hub, wall props, status light pools ----------
  paintDeck = (rect: Rect, accent: string, sectionRects: Rect[]) => {
    const deck = {
      top: this.look.colors.hullTop,
      left: this.look.colors.hullLeft,
      right: this.look.colors.hullRight,
    };
    this.geometry.prism(corners(rect), 0, DECK.bottom, deck);
    sectionRects.forEach((section, index) => {
      if (index % DECK.alternating)
        this.geometry.poly(rectPoly(section), this.look.colors["deck-section-overlay"]);
    });
    this.geometry.grid(rect, { ...DECK.grid, color: this.look.colors.hullSeam });
    // Warm window strips along both visible skirt faces, rivets at the corners.
    this.geometry.skirtWindows(rect, {
      ...WINDOWS,
      front: this.look.colors["deck-window-front"],
      side: this.look.colors["deck-window-side"],
    });
    // Project hue: front-top edge lamp strip.
    this.geometry.frontEdges(rect, { color: accent, ...DECK.edge });
  };
  paintRearWalls = (rect: Rect) => {
    const height = WALL.height,
      wall = {
        x: [
          P({ x: rect.x, y: rect.y }),
          P({ x: rect.x, y: rect.y + rect.h }),
          P({ x: rect.x, y: rect.y + rect.h, z: height }),
          P({ x: rect.x, y: rect.y, z: height }),
        ],
        y: [
          P({ x: rect.x, y: rect.y }),
          P({ x: rect.x + rect.w, y: rect.y }),
          P({ x: rect.x + rect.w, y: rect.y, z: height }),
          P({ x: rect.x, y: rect.y, z: height }),
        ],
      };
    this.geometry.poly(wall.x, this.look.colors.hullRight);
    this.geometry.poly(wall.y, this.look.colors.wall);
    this.context.save();
    this.context.globalAlpha = WALL.alpha;
    for (let y = rect.y + WALL.seamStep; y < rect.y + rect.h; y += WALL.seamStep)
      this.geometry.line(
        { x: rect.x, y, z: 0 },
        { x: rect.x, y, z: height },
        { color: this.look.colors.hullSeam },
      );
    for (let x = rect.x + WALL.seamStep; x < rect.x + rect.w; x += WALL.seamStep)
      this.geometry.line(
        { x, y: rect.y, z: 0 },
        { x, y: rect.y, z: height },
        { color: this.look.colors.hullSeam },
      );
    this.context.restore();
    this.geometry.line(
      { x: rect.x, y: rect.y + rect.h, z: height },
      { x: rect.x, y: rect.y, z: height },
      { color: this.look.colors.wallCap, width: WALL.capWidth },
    );
    this.geometry.line(
      { x: rect.x, y: rect.y, z: height },
      { x: rect.x + rect.w, y: rect.y, z: height },
      { color: this.look.colors.wallCap, width: WALL.capWidth },
    );
  };
  paintWalkway = (walkway: Walkway) => {
    // A relay lane (a room whose agents the relay carries, and its way to the mailroom) wears the relay's amber rails.
    const r = walkway.rect,
      rail =
        walkway.relay === "unverified"
          ? this.look.colors.dim
          : walkway.relay
            ? this.look.colors.amber
            : this.look.colors.rail;
    this.geometry.prism(corners(r), 0, WALKWAY.bottom, {
      top: this.look.colors.grate,
      left: this.look.colors.hullLeft,
      right: this.look.colors.hullRight,
    });
    this.geometry.grid(r, { ...WALKWAY.grid, color: this.look.colors.grateDark });
    this.geometry.walkwayRails(r, {
      ...WALKWAY,
      rail,
      railWidth: walkway.relay ? WALKWAY.relayWidth : 1,
      lampColor: this.look.colors.window,
      supportColor: this.look.colors["walkway-support"],
    });
    this.geometry.walkwayTrim(r, walkway.accent);
  };

  paintHub = (mail: Mailroom) => {
    const r = mail.rect;
    this.geometry.prism(octagon(r, HUB.corner), 0, HUB.bottom, {
      top: this.look.colors["hub-top"],
      left: this.look.colors.hullLeft,
      right: this.look.colors.hullRight,
      mid: this.look.colors["hub-mid"],
    });
    // Hazard chevron border: an amber dash over a black band, inset half a unit.
    const inset = octagon(r, HUB.corner, HUB.inset).map((point) => P(point));
    this.context.save();
    this.context.lineWidth = HUB.underlay;
    this.geometry.poly(inset, null, this.look.colors["hub-stripe-underlay"]);
    this.context.setLineDash(HUB.dash);
    this.context.lineWidth = HUB.stripe;
    this.geometry.poly(inset, null, this.look.colors.amber);
    this.context.restore();
    for (const pad of mail.pads) {
      this.geometry.isoEllipse(pad, HUB.pad, {
        stroke: this.look.colors.amber,
        fill: this.look.colors["hub-pad"],
        width: HUB.padWidth,
      });
      this.geometry.isoEllipse(pad, HUB.ring, { stroke: this.look.colors["hub-pad-ring"] });
      if (this.look.ambientFx === "station")
        this.glow(pad, HUB.glow, this.look.colors.amber, HUB.glowAlpha);
    }
    // The pod rack and outbound launch rail serve routes outside the deck.
    this.paintPod(required(mail.pod[0]));
    this.paintChute(r, required(mail.chute[0]));
    this.paintTower(mail.tower);
  };
  private paintPod(pod: Point) {
    this.geometry.box(
      { x: pod.x - POD.halfWidth, y: pod.y - POD.halfDepth, w: POD.width, h: 1 },
      POD.height,
      {
        top: this.look.colors["pod-top"],
        left: this.look.colors["pod-left"],
        right: this.look.colors["pod-right"],
      },
    );
    for (let z = POD.stripe; z < POD.height; z += POD.stripeStep)
      this.geometry.line(
        { x: pod.x - POD.halfDepth, y: pod.y + POD.halfDepth, z },
        { x: pod.x + POD.halfDepth, y: pod.y + POD.halfDepth, z },
        { color: this.look.colors.cyan, width: 1, alpha: POD.alpha },
      );
  }
  private paintChute(r: Rect, chute: Point) {
    this.geometry.box(
      {
        x: r.x - CHUTE.start,
        y: chute.y - CHUTE.halfDepth,
        w: chute.x - r.x + CHUTE.extension,
        h: CHUTE.depth,
      },
      CHUTE.height,
      {
        top: this.look.colors["chute-top"],
        left: this.look.colors["chute-left"],
        right: this.look.colors["chute-right"],
      },
    );
    for (let x = r.x - CHUTE.dashStart; x < chute.x; x += CHUTE.dashStep)
      this.geometry.line(
        { x, y: chute.y - CHUTE.dashSize, z: CHUTE.dashHeight },
        { x: x - CHUTE.dashSize, y: chute.y, z: CHUTE.dashHeight },
        { color: this.look.colors.amber, width: 1, alpha: CHUTE.alpha },
      );
  }
  private paintTower(t: Rect) {
    this.geometry.box(t, TOWER.height, {
      top: this.look.colors["tower-top"],
      left: this.look.colors["tower-left"],
      right: this.look.colors["tower-right"],
    });
    this.geometry.line(
      { x: t.x, y: t.y + t.h, z: TOWER.rim },
      { x: t.x + t.w, y: t.y + t.h, z: TOWER.rim },
      { color: this.look.colors.cyan, width: TOWER.width, alpha: TOWER.alpha },
    );
    this.geometry.line(
      { x: t.x + t.w, y: t.y, z: TOWER.rim },
      { x: t.x + t.w, y: t.y + t.h, z: TOWER.rim },
      { color: this.look.colors.cyan, width: TOWER.width, alpha: TOWER.alpha },
    );
    for (let z = TOWER.windowStart; z < TOWER.windowEnd; z += TOWER.windowStep)
      this.geometry.line(
        { x: t.x + TOWER.windowInset, y: t.y + t.h, z },
        { x: t.x + t.w - TOWER.windowInset, y: t.y + t.h, z },
        { color: this.look.colors["tower-window"], width: TOWER.width },
      );
  }
  // Observatory deck: a cool counterweight to the amber mailroom. Tall props are depth items, never cached here.
  paintObservatoryDeck = (observatory: Observatory) => {
    const r = observatory.rect;
    this.geometry.prism(corners(r), 0, OBSERVATORY.bottom, {
      top: this.look.colors["observatory-top"],
      left: this.look.colors.hullLeft,
      right: this.look.colors.hullRight,
    });
    this.geometry.grid(r, { ...OBSERVATORY.grid, color: this.look.colors["observatory-grid"] });
    this.geometry.frontEdges(r, { color: this.look.colors.cyan, ...OBSERVATORY.edge });
    this.paintRearWalls(r);
    const light = observatory.light.rect;
    if (this.look.ambientFx === "station")
      this.glow(
        {
          x: light.x + light.w / CENTER_DIVISOR,
          y: light.y + light.h / CENTER_DIVISOR + OBSERVATORY.lightOffset,
        },
        OBSERVATORY.glow,
        this.look.colors.cyan,
        OBSERVATORY.alpha,
      );
  };
}
