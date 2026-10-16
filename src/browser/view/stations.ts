import { project as P } from "../scene/index.js";
import type { Decoration, Point, Rect, Worker } from "../scene/types.js";
import type { SpriteResource } from "../sprites/types.js";
import { GeometryPainter } from "./geometry-painter.js";
import { statusColor } from "./look.js";
import { hash, shade } from "./primitives.js";
import type { Drone, Look, ViewContext } from "./types.js";

const MONITOR = {
  working: 0.95,
  blocked: 0.6,
  idle: 0.3,
  period: 600,
  phases: 7,
  cycles: 3,
  alpha: 0.35,
};
const DESK = { height: 0.55, rear: 0.1, front: 0.6, width: 0.4, depth: 0.5, monitorHeight: 0.5 };
const DESK_SCREEN = {
  top: 1.05,
  rim: 1.5,
  rows: 3,
  left: 0.05,
  right: 0.3,
  base: 0.65,
  span: 0.35,
};
const HELPER = {
  height: 0.45,
  shade: -0.6,
  right: 0.35,
  rear: 0.08,
  width: 0.3,
  depth: 0.36,
  monitorHeight: 0.4,
};
const HELPER_SCREEN = { top: 0.85, rim: 1, rows: 2, left: 0.04, right: 0.24, base: 0.5, span: 0.3 };
const STATUS_LAMP_ALPHA = 0.6;
const DESK_LAMP = { x: 1.85, y: 0.9, z: 0.6, radius: 0.09, glow: 10 };
const HELPER_LAMP = { inset: 0.15, z: 0.5, radius: 0.07, glow: 8 };
const CHAIR = {
  halfWidth: 0.3,
  seatRear: 0.35,
  width: 0.6,
  depth: 0.5,
  height: 0.35,
  backRear: 0.45,
  backDepth: 0.1,
  backHeight: 0.55,
};
const PARTITION = { height: 0.6, alpha: 0.55 };
const APRON = { post: 1.6, width: 2, lens: 1.65, radius: 0.14, glow: 40, alpha: 0.22 };
const PLANNING = { height: 0.55, inset: 0.3, rim: 0.6, width: 1.5, alpha: 0.5 };
const DRONE = {
  period: 500,
  shadow: 0.25,
  body: { left: 9, top: 4, w: 18, h: 6 },
  wing: { left: 12, right: 6, top: 6, w: 6, h: 2 },
  lamp: { left: 1, top: 3, size: 2 },
  parcel: { left: 4, top: 3, gap: 3, w: 8, h: 2 },
};
const CENTER_DIVISOR = 2;
const DESK_MONITOR_OFFSETS = [0.05, 1.55];

type ScreenRecipe = typeof DESK_SCREEN;
interface MonitorPlacement {
  rect: Rect;
  front: number;
  base: number;
  height: number;
}
interface Activity {
  worker: Worker;
  now: number;
  animate: boolean;
}

export class Stations<R extends SpriteResource> {
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
  // ---------- dynamic items (depth sorted with crew) ----------
  paintDesk = (worker: Worker, now: number, animate: boolean) => {
    const d = worker.desk;
    this.geometry.box(d, DESK.height, {
      top: this.look.colors.consoleTop,
      left: this.look.colors["desk-left"],
      right: this.look.colors["desk-right"],
      edge: this.look.colors["desk-edge"],
    });
    // Side monitors leave the seated worker's face clear; the camera sees their lit rims.
    for (const offset of DESK_MONITOR_OFFSETS)
      this.paintMonitor(
        {
          rect: { x: d.x + offset, y: d.y + DESK.rear, w: DESK.width, h: DESK.depth },
          front: d.y + DESK.front,
          base: DESK.height,
          height: DESK.monitorHeight,
        },
        DESK_SCREEN,
        { worker, now, animate },
      );
    // Observed status lamp: steady, never blinking.
    const lamp = DESK_LAMP;
    this.paintStatusLamp({ x: d.x + lamp.x, y: d.y + lamp.y, z: lamp.z }, lamp, worker.row.status);
  };
  // A helper's jump seat: one compact console that stays inside its reviewed desk footprint (w1 × h0.72).
  paintHelperDesk = (worker: Worker, now: number, animate: boolean) => {
    const d = worker.desk;
    this.geometry.box(d, HELPER.height, {
      top: shade(worker.accent, HELPER.shade),
      left: this.look.colors["desk-left"],
      right: this.look.colors["desk-right"],
      edge: this.look.colors["desk-edge"],
    });
    const screen = {
      x: d.x + d.w - HELPER.right,
      y: d.y + HELPER.rear,
      w: HELPER.width,
      h: HELPER.depth,
    };
    this.paintMonitor(
      {
        rect: screen,
        front: screen.y + screen.h,
        base: HELPER.height,
        height: HELPER.monitorHeight,
      },
      HELPER_SCREEN,
      { worker, now, animate },
    );
    const lamp = HELPER_LAMP;
    this.paintStatusLamp(
      { x: d.x + lamp.inset, y: d.y + d.h - lamp.inset, z: lamp.z },
      lamp,
      worker.row.status,
    );
  };
  private paintMonitor(placement: MonitorPlacement, recipe: ScreenRecipe, activity: Activity) {
    const { rect, front, base, height } = placement;
    const { worker, now, animate } = activity;
    const status = worker.row.status;
    this.geometry.box(
      rect,
      height,
      {
        top: this.look.colors["monitor-top"],
        left: this.look.colors["monitor-left"],
        right: this.look.colors["monitor-right"],
      },
      base,
    );
    const rim =
      status === "working"
        ? MONITOR.working
        : status === "blocked"
          ? MONITOR.blocked
          : MONITOR.idle;
    this.geometry.line(
      { x: rect.x, y: front, z: recipe.top },
      { x: rect.x + rect.w, y: front, z: recipe.top },
      { color: this.look.colors.cyan, width: recipe.rim, alpha: rim },
    );
    if (animate && status === "working") {
      const scroll =
        ((now / MONITOR.period + (hash(worker.id) % MONITOR.phases)) % MONITOR.cycles) /
        MONITOR.cycles;
      for (let i = 0; i < recipe.rows; i++)
        this.geometry.line(
          {
            x: rect.x + recipe.left,
            y: front,
            z: recipe.base + ((i / recipe.rows + scroll) % 1) * recipe.span,
          },
          {
            x: rect.x + recipe.right,
            y: front,
            z: recipe.base + ((i / recipe.rows + scroll) % 1) * recipe.span,
          },
          { color: this.look.colors.cyan, width: 1, alpha: MONITOR.alpha },
        );
    }
  }
  private paintStatusLamp(
    point: Point,
    recipe: { radius: number; glow: number },
    status: Worker["row"]["status"],
  ) {
    this.geometry.isoEllipse(point, recipe.radius, {
      stroke: null,
      fill: statusColor(this.look.status, status),
    });
    if (status === "working" || status === "blocked")
      this.glow(point, recipe.glow, statusColor(this.look.status, status), STATUS_LAMP_ALPHA);
  }
  paintChair = (worker: { chair: Point; scale?: number }) => {
    const c = worker.chair,
      s = worker.scale || 1;
    this.geometry.box(
      {
        x: c.x - CHAIR.halfWidth * s,
        y: c.y - CHAIR.seatRear * s,
        w: CHAIR.width * s,
        h: CHAIR.depth * s,
      },
      CHAIR.height * s,
      {
        top: this.look.colors["chair-seat-top"],
        left: this.look.colors["chair-left"],
        right: this.look.colors["chair-right"],
      },
    );
    this.geometry.box(
      {
        x: c.x - CHAIR.halfWidth * s,
        y: c.y - CHAIR.backRear * s,
        w: CHAIR.width * s,
        h: CHAIR.backDepth * s,
      },
      CHAIR.backHeight * s,
      {
        top: this.look.colors["chair-back-top"],
        left: this.look.colors["chair-left"],
        right: this.look.colors["chair-right"],
      },
      CHAIR.height * s,
    );
  };
  // Low repository partition, one unit long: long walls are cut into units so they depth-sort correctly with crew.
  paintPartition: (unit: Rect, accent: string, end?: boolean) => void = (unit, accent) => {
    this.geometry.box(unit, PARTITION.height, {
      top: this.look.colors["partition-top"],
      left: this.look.colors["partition-left"],
      right: this.look.colors["partition-right"],
    });
    this.geometry.line(
      { x: unit.x, y: unit.y + unit.h, z: PARTITION.height },
      { x: unit.x + unit.w, y: unit.y + unit.h, z: PARTITION.height },
      { color: accent, width: 1, alpha: PARTITION.alpha },
    );
  };
  paintApronProp = (region: Decoration) => {
    const r = region.rect,
      post = { x: r.x + r.w / CENTER_DIVISOR, y: r.y + r.h / CENTER_DIVISOR };
    this.geometry.line(
      { ...post, z: 0 },
      { ...post, z: APRON.post },
      { color: this.look.colors.rail, width: APRON.width },
    );
    this.geometry.isoEllipse({ ...post, z: APRON.lens }, APRON.radius, {
      stroke: null,
      fill: this.look.colors.window,
    });
    if (this.look.ambientFx === "station")
      this.glow({ ...post, z: 0 }, APRON.glow, this.look.colors.amber, APRON.alpha);
  };
  paintPlanningDesk = (desk: Rect) => {
    this.geometry.box(desk, PLANNING.height, {
      top: this.look.colors["planning-desk-top"],
      left: this.look.colors["planning-desk-left"],
      right: this.look.colors["planning-desk-right"],
      edge: this.look.colors["planning-desk-edge"],
    });
    this.geometry.line(
      { x: desk.x + PLANNING.inset, y: desk.y + desk.h, z: PLANNING.rim },
      { x: desk.x + desk.w - PLANNING.inset, y: desk.y + desk.h, z: PLANNING.rim },
      { color: this.look.colors.cyan, width: PLANNING.width, alpha: PLANNING.alpha },
    );
  };
  paintDrone = (drone: Drone, now: number, animate: boolean) => {
    const at = P(drone.point),
      bob = drone.parked && animate ? Math.sin(now / DRONE.period) : 0;
    this.geometry.isoEllipse({ ...drone.point, z: 0 }, DRONE.shadow, {
      stroke: null,
      fill: this.look.colors["drone-shadow"],
    });
    const { body, wing, lamp, parcel } = DRONE;
    this.context.fillStyle = this.look.colors["drone-body"];
    this.context.fillRect(at.x - body.left, at.y - body.top + bob, body.w, body.h);
    this.context.fillStyle = this.look.colors["drone-wing"];
    this.context.fillRect(at.x - wing.left, at.y - wing.top + bob, wing.w, wing.h);
    this.context.fillRect(at.x + wing.right, at.y - wing.top + bob, wing.w, wing.h);
    const running = drone.parcels[0] || this.look.colors.cyan;
    this.context.fillStyle = running;
    this.context.fillRect(at.x - lamp.left, at.y - lamp.top + bob, lamp.size, lamp.size);
    drone.parcels.forEach((color, index) => {
      this.context.fillStyle = color;
      this.context.fillRect(
        at.x - parcel.left,
        at.y + parcel.top + index * parcel.gap + bob,
        parcel.w,
        parcel.h,
      );
    });
  };
}
