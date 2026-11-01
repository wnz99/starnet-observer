import type { SceneArtRoleName } from "../../shared/scene-art-roles.js";
import type * as OfficeArt from "../office-art.js";
import { project as P } from "../scene/index.js";
import type {
  Decoration,
  Mailroom,
  Observatory,
  Platform,
  Point,
  Rect,
  Scene,
  Walkway,
} from "../scene/types.js";
import type { SpriteResource } from "../sprites/types.js";
import { CORNER_KINDS, WALL_KINDS, wallUnits } from "./furnishing.js";
import { GeometryPainter } from "./geometry-painter.js";
import { officeFurnishing } from "./office-furnishing.js";
import { corners, hash, middle, rectPoly, visibleFaces, withAlpha } from "./primitives.js";
import { staticPass } from "./static.js";
import type { Look, StaticPresentation, ViewContext } from "./types.js";
import { present as required } from "./values.js";
const MAIL_PROPS = {
  chamfer: 2,
  skirt: 1.5,
  padInset: 1.1,
  counterWidth: 4,
  receptionDepth: 3,
  dispatchInset: 0.35,
  dispatchDepth: 0.7,
  trayX: 0.6,
  trayY: 0.5,
  trayWidth: 1.2,
};
const OFFICE_TRIM = {
  rugInset: 0.75,
  rugGutter: 1.5,
  rugFill: 0.16,
  rugLine: 0.7,
  wallCornerDepth: 2,
  deckStripe: 0.25,
  alternateSections: 2,
  walkwayDrop: 0.35,
};
export class OfficeFloor<R extends SpriteResource> {
  readonly geometry;
  constructor(
    readonly look: Look,
    readonly art: ReturnType<typeof OfficeArt.create<R>>,
    readonly context: ViewContext<R>,
  ) {
    this.geometry = new GeometryPainter(context);
  }
  faces(points: Point[], top: number, bottom: number) {
    this.context.lineWidth = 1;
    for (const { a, b, side } of visibleFaces(points))
      this.geometry.poly(
        [P({ ...a, z: top }), P({ ...b, z: top }), P({ ...b, z: bottom }), P({ ...a, z: bottom })],
        side === "left" ? this.look.colors.hullLeft : this.look.colors.hullRight,
        this.look.colors["body-outline"],
      );
  }
  floor(points: Point[], role: SceneArtRoleName, rect: Rect) {
    this.context.save();
    this.context.beginPath();
    points
      .map((point) => P(point))
      .forEach((point, index) => {
        if (index) this.context.lineTo(point.x, point.y);
        else this.context.moveTo(point.x, point.y);
      });
    this.context.closePath();
    this.context.clip();
    this.art.tile(this.context, role, rect);
    this.context.restore();
    this.geometry.poly(
      points.map((point) => P(point)),
      null,
      this.look.colors["body-outline"],
    );
  }
  rug(rect: Rect, accent: string) {
    this.geometry.poly(
      rectPoly({
        x: rect.x + OFFICE_TRIM.rugInset,
        y: rect.y + OFFICE_TRIM.rugInset,
        w: rect.w - OFFICE_TRIM.rugGutter,
        h: rect.h - OFFICE_TRIM.rugGutter,
      }),
      withAlpha(accent, OFFICE_TRIM.rugFill),
      withAlpha(accent, OFFICE_TRIM.rugLine),
    );
  }
  stripe(rect: Rect, accent: string, z: number) {
    this.geometry.line(
      { x: rect.x, y: rect.y + rect.h, z },
      { x: rect.x + rect.w, y: rect.y + rect.h, z },
      { color: accent },
    );
    this.geometry.line(
      { x: rect.x + rect.w, y: rect.y + rect.h, z },
      { x: rect.x + rect.w, y: rect.y, z },
      { color: accent },
    );
  }
  walls(r: Rect) {
    this.art.draw(this.context, "wallCorner", r);
    this.art.edge(this.context, "wallRearX", {
      x: r.x,
      y: r.y + OFFICE_TRIM.wallCornerDepth,
      w: 0,
      h: r.h - OFFICE_TRIM.wallCornerDepth,
    });
    this.art.edge(this.context, "wallRearY", { x: r.x + 1, y: r.y, w: r.w - 1, h: 0 });
  }
  deck(platform: Platform) {
    const r = platform.rect;
    this.faces(corners(r), 0, -1);
    this.stripe(r, platform.accent, -OFFICE_TRIM.deckStripe);
    this.floor(corners(r), "floor", r);
    platform.sections.forEach((section, index) => {
      if (index % OFFICE_TRIM.alternateSections)
        this.art.tile(this.context, "floorAlt", section.rect);
      this.rug(section.rect, platform.accent);
    });
  }
  region(platform: Platform, value: Decoration, index: number) {
    const kinds = value.kind === "corner" ? CORNER_KINDS : WALL_KINDS;
    wallUnits(value).forEach((unit, slot) => {
      const { role, rect } = officeFurnishing(
        required(
          kinds[hash(platform.key + ":" + String(index) + ":" + String(slot)) % kinds.length],
        ),
        unit,
        value.edge,
      );
      this.art.draw(this.context, role, rect);
    });
  }
  walkway(value: Walkway) {
    const r = value.rect;
    this.faces(corners(r), 0, -OFFICE_TRIM.walkwayDrop);
    this.floor(corners(r), "corridor", r);
    this.geometry.walkwayTrim(r, value.accent);
  }
  hub(mail: Mailroom) {
    const r = mail.rect,
      c = MAIL_PROPS.chamfer,
      oct = [
        { x: r.x + c, y: r.y },
        { x: r.x, y: r.y + c },
        { x: r.x, y: r.y + r.h - c },
        { x: r.x + c, y: r.y + r.h },
        { x: r.x + r.w - c, y: r.y + r.h },
        { x: r.x + r.w, y: r.y + r.h - c },
        { x: r.x + r.w, y: r.y + c },
        { x: r.x + r.w - c, y: r.y },
      ];
    this.faces(oct, 0, -MAIL_PROPS.skirt);
    this.floor(oct, "floorAlt", r);
    for (const pad of mail.pads)
      this.art.draw(this.context, "mailPad", {
        x: pad.x - MAIL_PROPS.padInset,
        y: pad.y - MAIL_PROPS.padInset,
      });
  }
  hubProps(mail: Mailroom) {
    const r = mail.rect;
    const pod = required(mail.pod[0]),
      chute = required(mail.chute[0]);
    const props: [SceneArtRoleName, Rect][] = [
      [
        "mailReception",
        { x: r.x + 1, y: r.y + 1, w: MAIL_PROPS.counterWidth, h: MAIL_PROPS.receptionDepth },
      ],
      ["mailSorter", mail.tower],
      [
        "dispatchCounter",
        {
          x: r.x - MAIL_PROPS.skirt,
          y: chute.y - MAIL_PROPS.dispatchInset,
          w: MAIL_PROPS.counterWidth,
          h: MAIL_PROPS.dispatchDepth,
        },
      ],
      [
        "mailTray",
        { x: pod.x - MAIL_PROPS.trayX, y: pod.y - MAIL_PROPS.trayY, w: MAIL_PROPS.trayWidth, h: 1 },
      ],
    ];
    props
      .sort((a, b) => middle(a[1]) - middle(b[1]))
      .forEach(([role, rect]) => {
        this.art.draw(this.context, role, rect);
      });
  }
  observatory(o: Observatory) {
    const r = o.rect;
    this.faces(corners(r), 0, -1);
    this.floor(corners(r), "floor", r);
    this.walls(r);
  }
  paintStatic(scene: Scene, presentation?: StaticPresentation) {
    staticPass(
      this.context,
      scene,
      {
        colors: this.look.colors,
        pool: null,
        deck: (_ctx, value) => {
          this.deck(value);
        },
        walkway: (_ctx, value) => {
          this.walkway(value);
        },
        hub: (_ctx, value) => {
          this.hub(value);
        },
        hubProps: (_ctx, value) => {
          this.hubProps(value);
        },
        observatory: (_ctx, value) => {
          this.observatory(value);
        },
        walls: (_ctx, value) => {
          this.walls(value);
        },
        region: (_ctx, platform, value, index) => {
          this.region(platform, value, index);
        },
      },
      presentation,
    );
  }
}
