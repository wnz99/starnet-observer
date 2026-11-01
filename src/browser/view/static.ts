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
} from "../scene/types.js";
import type { SpriteResource } from "../sprites/types.js";
import type { AssemblyOwner, AssemblyStage } from "./startup-assembly.js";
import { GeometryPainter } from "./geometry-painter.js";
import { center, middle, rectPoly, withAlpha } from "./primitives.js";
import type { Colors, StaticPresentation, ViewContext } from "./types.js";
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
const QUARTERS = { alpha: 0.18, middle: 2, font: "9px monospace", label: "QUARTERS" };
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
    readonly presentation?: StaticPresentation,
  ) {
    this.geometry = new GeometryPainter(context);
  }
  paint() {
    for (const ship of this.scene.ships || [])
      this.paintOwned(this.presentation?.owners.ship(ship.id), "floor", () => {
        this.hull(ship);
      });
    const pieces = this.pieces();
    pieces.sort((a, b) => a.key - b.key);
    for (const piece of pieces) piece.paint();
    this.walls();
    this.dimShips();
    for (const worker of this.scene.workers)
      this.paintOwned(this.presentation?.owners.worker(worker), "content", () =>
        this.art.pool?.(this.context, worker),
      );
  }
  private paintOwned(owner: AssemblyOwner | undefined, stage: AssemblyStage, draw: () => void) {
    if (!this.presentation) draw();
    else if (owner) this.presentation.paint(owner, stage, draw);
  }
  private hub(mail: Mailroom, owner: AssemblyOwner | undefined) {
    this.paintOwned(owner, "floor", () => {
      this.art.hub(this.context, mail);
    });
    this.paintOwned(owner, "content", () => {
      this.art.hubProps(this.context, mail);
    });
  }
  private hull(ship: Ship) {
    const ctx = this.context,
      C = this.art.colors;
    if (ship.shadow) {
      ctx.save();
      ctx.globalAlpha *= HULL.shadowAlpha;
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
    ctx.globalAlpha *= ship.local
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
      ctx.globalAlpha *= HULL.deckAlpha;
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
          this.paintOwned(this.presentation?.owners.platform(platform.key), "floor", () => {
            this.art.deck(this.context, platform);
            this.quarters(platform);
          });
        },
      })),
      ...this.scene.walkways.map((walkway) => this.walkway(walkway)),
      {
        key: center(hub).x + center(hub).y + DEPTH.hub,
        paint: () => {
          this.hub(this.scene.mail, "mail");
        },
      },
      ...(this.scene.ships || [])
        .filter((ship) => !ship.local && ship.mail)
        .map((ship) => {
          const mail = present(ship.mail);
          return {
            key: center(mail.rect).x + center(mail.rect).y + DEPTH.hub,
            paint: () => {
              this.hub(mail, this.presentation?.owners.ship(ship.id));
            },
          };
        }),
      ...(this.scene.relays || []).map((relay) => ({
        key: middle(relay.mail.rect) + DEPTH.hub,
        paint: () => {
          this.hub(relay.mail, this.presentation?.owners.relay(relay.key));
        },
      })),
      {
        key: middle(this.scene.observatory.rect),
        paint: () => {
          this.paintOwned("observatory", "floor", () => {
            this.art.observatory(this.context, this.scene.observatory);
          });
        },
      },
    ];
    return pieces;
  }
  private quarters(platform: Platform) {
    const quarters = platform.quarters.rect;
    this.geometry.poly(
      rectPoly(quarters, 0),
      withAlpha(platform.accent, QUARTERS.alpha),
      platform.accent,
    );
    const label = project({
      x: quarters.x + quarters.w / QUARTERS.middle,
      y: quarters.y + quarters.h / QUARTERS.middle,
    });
    this.context.save();
    this.context.fillStyle = platform.accent;
    this.context.font = QUARTERS.font;
    this.context.textAlign = "center";
    this.context.fillText(QUARTERS.label, label.x, label.y);
    this.context.restore();
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
        if (
          rect.w > 0 &&
          (!this.presentation ||
            this.presentation.owners.walkwayReady(walkway, this.presentation.frame))
        )
          this.paintOwned(this.presentation?.owners.walkway(walkway), "floor", () => {
            this.art.walkway(this.context, { ...walkway, rect });
          });
      },
    };
  }
  private walls() {
    for (const platform of this.scene.platforms) {
      const owner = this.presentation?.owners.platform(platform.key);
      this.paintOwned(owner, "floor", () => {
        this.art.walls(this.context, platform.rect);
      });
      platform.decorationRegions.forEach((region, index) => {
        if (region.kind === "wall" || region.kind === "corner")
          this.paintOwned(owner, "content", () => {
            this.art.region(this.context, platform, region, index);
          });
      });
    }
  }
  private dimShips() {
    for (const ship of this.scene.ships || [])
      if (!ship.local && !shipLive(ship))
        this.paintOwned(this.presentation?.owners.ship(ship.id), "floor", () => {
          this.geometry.poly(
            rectPoly(ship.rect, 0),
            withAlpha(this.art.colors["body-outline"], ship.shadow ? HULL.shadowDim : HULL.downDim),
          );
        });
  }
}
export function staticPass<R extends SpriteResource>(
  context: ViewContext<R>,
  scene: Scene,
  art: StaticArt<R>,
  presentation?: StaticPresentation,
) {
  new StationFloor(context, scene, art, presentation).paint();
}
interface StaticArt<R extends SpriteResource> {
  colors: Colors;
  deck(ctx: ViewContext<R>, platform: Platform): void;
  walkway(ctx: ViewContext<R>, walkway: Walkway): void;
  hub(ctx: ViewContext<R>, mail: Mailroom): void;
  hubProps(ctx: ViewContext<R>, mail: Mailroom): void;
  observatory(ctx: ViewContext<R>, observatory: Observatory): void;
  walls(ctx: ViewContext<R>, rect: Rect): void;
  region(ctx: ViewContext<R>, platform: Platform, region: Decoration, index: number): void;
  pool: ((ctx: ViewContext<R>, worker: Scene["workers"][number]) => void) | null;
}
