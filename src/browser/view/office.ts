import type * as OfficeArt from "../office-art.js";
import { project as P } from "../scene/index.js";
import type {
  Decoration,
  Observatory,
  Point,
  PropExtent,
  Rect,
  Scene,
  Worker,
} from "../scene/types.js";
import type { SpriteResource } from "../sprites/types.js";
import { GeometryPainter } from "./geometry-painter.js";
import { statusColor } from "./look.js";
import { OfficeFloor } from "./office-floor.js";
import type { ArtPainters, Drone, Look, StaticPresentation, ViewContext } from "./types.js";
const OFFICE_TRIM = { partitionHeight: 0.6, partitionAlpha: 0.55, viewerShadow: 0.28 };

const DESK_LAMP = { x: 1.85, y: 0.9, height: 0.6, radius: 0.09 };
const HELPER_LAMP = { inset: 0.15, height: 0.5, radius: 0.07 };
const PARCEL = { shadow: 0.25, left: 4, top: 5, spacing: 3, width: 8, height: 2 };
/* Home-office painters: the station's passes, footprints, hashes and depth keys drawn with the fixed role PNGs at
   native size (ObserverOfficeArt.create). Procedural overlays stay application-owned and flat: two-tone outlined side
   faces, project-hue rugs and trims, steady status lamps and contact shadows. Nothing glows, sparks or animates. */
// Each station wall/corner kind keeps its hashed slot: [role, along inset, depth inset] inside its reserved unit.

// Pure placement: the role and its extent rect (origin = role foot), fitted against the wall, never past the unit.

class OfficePainter<R extends SpriteResource> {
  paintStatic(scene: Scene, presentation?: StaticPresentation) {
    this.floors.paintStatic(scene, presentation);
  }
  readonly geometry;
  readonly floors;
  constructor(
    readonly look: Look,
    readonly art: ReturnType<typeof OfficeArt.create<R>>,
    readonly context: ViewContext<R>,
  ) {
    this.geometry = new GeometryPainter(context);
    this.floors = new OfficeFloor(look, art, context);
  }

  statusLamp(point: Point, radius: number, status: string | undefined) {
    this.geometry.isoEllipse(point, radius, {
      stroke: this.look.colors["body-outline"],
      fill: statusColor(this.look.status, status),
      width: 1,
    });
  }
  desk(worker: Worker) {
    const d = worker.desk;
    this.art.draw(this.context, "desk", d);
    this.statusLamp(
      { x: d.x + DESK_LAMP.x, y: d.y + DESK_LAMP.y, z: DESK_LAMP.height },
      DESK_LAMP.radius,
      worker.row.status,
    );
  }
  helperDesk(worker: Worker) {
    const d = worker.desk;
    this.art.draw(this.context, "helperDesk", d);
    this.statusLamp(
      { x: d.x + HELPER_LAMP.inset, y: d.y + d.h - HELPER_LAMP.inset, z: HELPER_LAMP.height },
      HELPER_LAMP.radius,
      worker.row.status,
    );
  }
  chair(worker: { chair: Point; scale?: number }) {
    this.art.draw(this.context, worker.scale && worker.scale !== 1 ? "helperChair" : "chair", {
      ...worker.chair,
      z: worker.chair.z ?? 0,
    });
  }
  partition(unit: Rect, accent: string, end: boolean | undefined) {
    this.art.draw(this.context, end ? "partitionX" : "partitionY", unit);
    this.geometry.line(
      { x: unit.x, y: unit.y + unit.h, z: OFFICE_TRIM.partitionHeight },
      { x: unit.x + unit.w, y: unit.y + unit.h, z: OFFICE_TRIM.partitionHeight },
      { color: accent, width: 1, alpha: OFFICE_TRIM.partitionAlpha },
    );
  }
  apron(value: Decoration) {
    this.art.draw(this.context, "apron", value.rect);
  }
  planningDesk(desk: Rect) {
    this.art.draw(this.context, "desk", desk);
  }
  viewer(viewer: NonNullable<Observatory["viewer"]>) {
    this.geometry.isoEllipse(viewer.point, OFFICE_TRIM.viewerShadow, {
      stroke: null,
      fill: this.look.colors["contact-shadow"],
    });
    this.art.draw(this.context, "viewer", { ...viewer.point, z: viewer.point.z ?? 0 });
  }
  screen(screen: PropExtent) {
    this.art.draw(this.context, "planningBoard", screen.rect);
  }
  telescope(telescope: PropExtent) {
    this.art.draw(this.context, "planningShelf", telescope.rect);
  }
  plant(plant: PropExtent) {
    this.art.draw(this.context, "plant", plant.rect);
  }
  lamp(light: PropExtent) {
    this.art.draw(this.context, "lamp", light.rect);
  }
  drone(drone: Drone) {
    this.geometry.isoEllipse({ ...drone.point, z: 0 }, PARCEL.shadow, {
      stroke: null,
      fill: this.look.colors["drone-shadow"],
    });
    this.art.draw(this.context, "carrier", { ...drone.point, z: drone.point.z ?? 0 });
    const at = P({ ...drone.point, z: drone.point.z ?? 0 }),
      x = Math.round(at.x),
      y = Math.round(at.y);
    drone.parcels.forEach((color, index) => {
      this.context.fillStyle = color;
      this.context.fillRect(
        x - PARCEL.left,
        y + PARCEL.top + index * PARCEL.spacing,
        PARCEL.width,
        PARCEL.height,
      );
    });
  }
}
export function officePaintersFor<R extends SpriteResource>(
  look: Look,
  art: ReturnType<typeof OfficeArt.create<R>>,
): ArtPainters<R> {
  const contexts = new WeakMap<ViewContext<R>, OfficePainter<R>>();
  const forContext = (ctx: ViewContext<R>) => {
    let owner = contexts.get(ctx);
    if (!owner) {
      owner = new OfficePainter(look, art, ctx);
      contexts.set(ctx, owner);
    }
    return owner;
  };
  return {
    paintStatic: (ctx, scene, presentation) => {
      forContext(ctx).paintStatic(scene, presentation);
    },
    ...officeFurniture(forContext),
  };
}

function officeFurniture<R extends SpriteResource>(
  forContext: (context: ViewContext<R>) => OfficePainter<R>,
): Omit<ArtPainters<R>, "paintStatic"> {
  return {
    desk: (ctx, value) => {
      forContext(ctx).desk(value);
    },
    helperDesk: (ctx, value) => {
      forContext(ctx).helperDesk(value);
    },
    chair: (ctx, value) => {
      forContext(ctx).chair(value);
    },
    partition: (ctx, value, accent, end) => {
      forContext(ctx).partition(value, accent, end);
    },
    apron: (ctx, value) => {
      forContext(ctx).apron(value);
    },
    planningDesk: (ctx, value) => {
      forContext(ctx).planningDesk(value);
    },
    viewer: (ctx, value) => {
      forContext(ctx).viewer(value);
    },
    screen: (ctx, value) => {
      forContext(ctx).screen(value);
    },
    telescope: (ctx, value) => {
      forContext(ctx).telescope(value);
    },
    plant: (ctx, value) => {
      forContext(ctx).plant(value);
    },
    lamp: (ctx, value) => {
      forContext(ctx).lamp(value);
    },
    drone: (ctx, value) => {
      forContext(ctx).drone(value);
    },
  };
}
