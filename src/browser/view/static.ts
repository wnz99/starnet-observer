import { project } from "../scene/index.js";
import type {
  Decoration,
  Mailroom,
  Observatory,
  Platform,
  Rect,
  Scene,
  Ship,
  Walkway,
  Worker,
} from "../scene/types.js";
import type { SpriteResource } from "../sprites/types.js";
import { GeometryPainter } from "./geometry-painter.js";
import { center, middle, rectPoly, withAlpha } from "./primitives.js";
import type { Colors, ViewContext } from "./types.js";
import { present } from "./values.js";
const HULL = {
  height: -2.4,
  shadowAlpha: 0.7,
  shadowDash: [2, 5],
  shadowWidth: 2,
  shadowFill: 0.03,
  localFill: 0.035,
  remoteFill: 0.09,
  downFill: 0.07,
  localAlpha: 0.7,
  localDownAlpha: 0.4,
  remoteAlpha: 0.9,
  dash: [6, 5],
  localWidth: 1.5,
  remoteWidth: 2.5,
  deckAlpha: 0.55,
  deckWidth: 1.5,
  shadowDim: 0.4,
  downDim: 0.55,
};
const DEPTH = { connector: 40, hub: 0.01 };
const TETHER = { alpha: 0.6, width: 1.5, dash: [4, 4] };
interface StaticPiece {
  key: number;
  paint: () => void;
}
export const shipLive = (ship: Ship) => ship.health === "available";
class StationFloor<R extends SpriteResource> {
  readonly geometry;
  constructor(
    readonly context: ViewContext<R>,
    readonly scene: Scene,
    readonly art: StaticArt<R>,
  ) {
    this.geometry = new GeometryPainter(context);
  }
  paint() {
    for (const ship of this.scene.ships || []) this.hull(ship);
    const pieces = this.pieces();
    pieces.sort((a, b) => a.key - b.key);
    for (const piece of pieces) piece.paint();
    this.walls();
    this.dimShips();
    this.art.pools?.(this.context, this.scene);
    for (const worker of this.scene.workers) if (worker.connector) this.tether(worker);
  }
  private hull(ship: Ship) {
    const ctx = this.context,
      C = this.art.colors;
    if (ship.shadow) {
      ctx.save();
      ctx.globalAlpha = HULL.shadowAlpha;
      ctx.setLineDash(HULL.shadowDash);
      ctx.lineWidth = HULL.shadowWidth;
      this.geometry.poly(
        rectPoly(ship.rect, HULL.height),
        withAlpha(C.amber, HULL.shadowFill),
        C.amber,
      );
      ctx.restore();
      return;
    }
    const live = shipLive(ship),
      rim = ship.local ? C.cyan : live ? C.amber : C.idle;
    this.geometry.poly(
      rectPoly(ship.rect, HULL.height),
      withAlpha(rim, ship.local ? HULL.localFill : live ? HULL.remoteFill : HULL.downFill),
    );
    ctx.save();
    ctx.globalAlpha = ship.local
      ? live
        ? HULL.localAlpha
        : HULL.localDownAlpha
      : HULL.remoteAlpha;
    ctx.setLineDash(HULL.dash);
    ctx.lineWidth = ship.local ? HULL.localWidth : HULL.remoteWidth;
    this.geometry.poly(rectPoly(ship.rect, HULL.height), null, rim);
    ctx.restore();
    if (!ship.local) {
      ctx.save();
      ctx.globalAlpha = HULL.deckAlpha;
      ctx.lineWidth = HULL.deckWidth;
      this.geometry.poly(rectPoly(ship.rect, 0), null, rim);
      ctx.restore();
    }
  }
  private pieces(): StaticPiece[] {
    const hub = this.scene.mail.rect;
    const pieces: StaticPiece[] = [
      ...this.scene.platforms.map((platform) => ({
        key: center(platform.rect).x + center(platform.rect).y,
        paint: () => {
          this.art.deck(this.context, platform);
        },
      })),
      ...this.scene.walkways.map((walkway) => this.walkway(walkway)),
      {
        key: center(hub).x + center(hub).y + DEPTH.hub,
        paint: () => {
          this.art.hub(this.context, this.scene.mail);
        },
      },
      ...(this.scene.ships || [])
        .filter((ship) => !ship.local && ship.mail)
        .map((ship) => {
          const mail = present(ship.mail);
          return {
            key: center(mail.rect).x + center(mail.rect).y + DEPTH.hub,
            paint: () => {
              this.art.hub(this.context, mail);
            },
          };
        }),
      {
        key: middle(this.scene.observatory.rect),
        paint: () => {
          this.art.observatory(this.context, this.scene.observatory);
        },
      },
    ];
    return pieces;
  }
  private walkway(walkway: Walkway): StaticPiece {
    const r = walkway.rect,
      hub = this.scene.mail.rect;
    const rect =
      walkway.kind === "hub-link"
        ? r.x < hub.x
          ? { ...r, w: Math.max(0, hub.x - r.x) }
          : { ...r, x: hub.x + hub.w, w: Math.max(0, r.x + r.w - hub.x - hub.w) }
        : r;
    return {
      key: center(rect).x + center(rect).y + (walkway.kind === "connector" ? DEPTH.connector : 0),
      paint: () => {
        if (rect.w > 0) this.art.walkway(this.context, { ...walkway, rect });
      },
    };
  }
  private walls() {
    for (const platform of this.scene.platforms) {
      this.art.walls(this.context, platform.rect);
      platform.decorationRegions.forEach((region, index) => {
        if (region.kind === "wall" || region.kind === "corner")
          this.art.region(this.context, platform, region, index);
      });
    }
  }
  private dimShips() {
    for (const ship of this.scene.ships || [])
      if (!ship.local && !shipLive(ship))
        this.geometry.poly(
          rectPoly(ship.rect, 0),
          withAlpha(this.art.colors["body-outline"], ship.shadow ? HULL.shadowDim : HULL.downDim),
        );
  }
  private tether(worker: Worker) {
    const connector = present(worker.connector),
      from = project(connector.from),
      to = project(connector.to),
      ctx = this.context;
    ctx.save();
    ctx.globalAlpha = TETHER.alpha;
    ctx.strokeStyle = worker.accent;
    ctx.lineWidth = TETHER.width;
    ctx.setLineDash(TETHER.dash);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.restore();
  }
}
export function staticPass<R extends SpriteResource>(
  context: ViewContext<R>,
  scene: Scene,
  art: StaticArt<R>,
) {
  new StationFloor(context, scene, art).paint();
}
interface StaticArt<R extends SpriteResource> {
  colors: Colors;
  deck(ctx: ViewContext<R>, platform: Platform): void;
  walkway(ctx: ViewContext<R>, walkway: Walkway): void;
  hub(ctx: ViewContext<R>, mail: Mailroom): void;
  observatory(ctx: ViewContext<R>, observatory: Observatory): void;
  walls(ctx: ViewContext<R>, rect: Rect): void;
  region(ctx: ViewContext<R>, platform: Platform, region: Decoration, index: number): void;
  pools: ((ctx: ViewContext<R>, scene: Scene) => void) | null;
}
