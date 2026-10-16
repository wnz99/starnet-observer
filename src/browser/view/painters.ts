import type {
  Decoration,
  Observatory,
  Platform,
  Point,
  PropExtent,
  Rect,
  Scene,
  Worker,
} from "../scene/types.js";
import type { SpriteResource } from "../sprites/types.js";
import { Furnishings } from "./furnishings.js";
import { Props } from "./props.js";
import { staticPass } from "./static.js";
import { Stations } from "./stations.js";
import { Surfaces } from "./surfaces.js";
import type { Drone, Look, ViewContext } from "./types.js";
const STATUS_POOL = {
  chairForward: 0.4,
  radius: 44,
  working: 0.35,
  blocked: 0.12,
  idle: 0.06,
  deskInset: 0.2,
  blockedRadius: 26,
  blockedAlpha: 0.25,
};

function contextPainters<R extends SpriteResource>(look: Look, context: ViewContext<R>) {
  return {
    surfaces: new Surfaces(look, context),
    props: new Props(look, context),
    stations: new Stations(look, context),
  };
}
class StationArt<R extends SpriteResource> {
  private readonly contexts = new WeakMap<ViewContext<R>, ReturnType<typeof contextPainters<R>>>();
  private readonly furniture;
  constructor(readonly look: Look) {
    this.furniture = new Furnishings<R>(look);
  }
  private forContext(context: ViewContext<R>) {
    let painters = this.contexts.get(context);
    if (!painters) {
      painters = contextPainters(this.look, context);
      this.contexts.set(context, painters);
    }
    return painters;
  }
  furnishing = (kind: string, unit: Rect, edge?: string) =>
    this.furniture.furnishing(kind, unit, edge);
  furnishings = (platform: Platform, region: Decoration, index: number) =>
    this.furniture.furnishings(platform, region, index);
  paintStatic = (ctx: ViewContext<R>, scene: Scene) => {
    const { surfaces, stations } = this.forContext(ctx);
    staticPass(ctx, scene, {
      deck: (_ctx, platform) => {
        surfaces.paintDeck(
          platform.rect,
          platform.accent,
          platform.sections.map((s) => s.rect),
        );
      },
      walkway: (_ctx, walkway) => {
        surfaces.paintWalkway(walkway);
      },
      hub: (_ctx, mail) => {
        surfaces.paintHub(mail);
      },
      observatory: (_ctx, observatory) => {
        surfaces.paintObservatoryDeck(observatory);
      },
      walls: (_ctx, rect) => {
        surfaces.paintRearWalls(rect);
      },
      region: this.furniture.paintWallRegion,
      pools:
        this.look.ambientFx === "station"
          ? (_ctx, scene) => {
              paintPools(scene, stations);
            }
          : null,
      colors: this.look.colors,
    });
  };
  paintObservatoryScreen = (
    ctx: ViewContext<R>,
    screen: PropExtent,
    now: number,
    animate: boolean,
  ) => {
    this.forContext(ctx).props.paintObservatoryScreen(screen, now, animate);
  };
  paintTelescope = (ctx: ViewContext<R>, telescope: PropExtent, now: number, animate: boolean) => {
    this.forContext(ctx).props.paintTelescope(telescope, now, animate);
  };
  paintPlant = (ctx: ViewContext<R>, plant: PropExtent) => {
    this.forContext(ctx).props.paintPlant(plant);
  };
  paintLamp = (ctx: ViewContext<R>, light: PropExtent) => {
    this.forContext(ctx).props.paintLamp(light);
  };
  paintViewer = (ctx: ViewContext<R>, viewer: NonNullable<Observatory["viewer"]>) => {
    this.forContext(ctx).props.paintViewer(viewer);
  };
  paintDesk = (ctx: ViewContext<R>, worker: Worker, now: number, animate: boolean) => {
    this.forContext(ctx).stations.paintDesk(worker, now, animate);
  };
  paintHelperDesk = (ctx: ViewContext<R>, worker: Worker, now: number, animate: boolean) => {
    this.forContext(ctx).stations.paintHelperDesk(worker, now, animate);
  };
  paintChair = (ctx: ViewContext<R>, worker: { chair: Point; scale?: number }) => {
    this.forContext(ctx).stations.paintChair(worker);
  };
  paintPartition = (ctx: ViewContext<R>, unit: Rect, accent: string, end?: boolean) => {
    this.forContext(ctx).stations.paintPartition(unit, accent, end);
  };
  paintApronProp = (ctx: ViewContext<R>, region: Decoration) => {
    this.forContext(ctx).stations.paintApronProp(region);
  };
  paintPlanningDesk = (ctx: ViewContext<R>, desk: Rect) => {
    this.forContext(ctx).stations.paintPlanningDesk(desk);
  };
  paintDrone = (ctx: ViewContext<R>, drone: Drone, now: number, animate: boolean) => {
    this.forContext(ctx).stations.paintDrone(drone, now, animate);
  };
}
export function paintersFor<R extends SpriteResource>(look: Look) {
  return new StationArt<R>(look);
}
// Status-driven light pools: the screen glow on a seated worker, never title or timestamp driven.
function paintPools<R extends SpriteResource>(scene: Scene, station: Stations<R>) {
  const C = station.look.colors,
    S = station.look.status;
  for (const worker of scene.workers) {
    const status = worker.row.status,
      scale = worker.scale || 1;
    station.glow(
      { ...worker.chair, y: worker.chair.y + STATUS_POOL.chairForward },
      STATUS_POOL.radius * scale,
      C.cyan,
      status === "working"
        ? STATUS_POOL.working
        : status === "blocked"
          ? STATUS_POOL.blocked
          : STATUS_POOL.idle,
    );
    if (status === "blocked")
      station.glow(
        {
          x: worker.desk.x + worker.desk.w - STATUS_POOL.deskInset,
          y: worker.desk.y + STATUS_POOL.deskInset,
        },
        STATUS_POOL.blockedRadius * scale,
        S.blocked,
        STATUS_POOL.blockedAlpha,
      );
  }
}
