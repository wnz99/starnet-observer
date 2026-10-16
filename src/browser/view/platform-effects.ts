import { project } from "../scene/index.js";
import type { Platform, Point, Rect, Worker } from "../scene/types.js";
import type { SpriteResource } from "../sprites/types.js";
import { statusColor } from "./look.js";
import { center, hash } from "./primitives.js";
import type { ViewRuntime } from "./runtime.js";
const PLATFORM = {
  padding: 48,
  height: -2.4,
  radiusScale: 17,
  alpha: 0.22,
  range: 0.08,
  period: 3200,
  phase: 0.7,
  still: 0.25,
  strength: 1.3,
  halfTurns: 2,
};
const CORNER = { lift: 2, count: 10, rise: 40, spread: 14, life: 1500, size: 2 };
const HUB = {
  height: -1,
  radiusScale: 24,
  alpha: 0.25,
  range: 0.1,
  still: 0.3,
  mailPeriod: 2600,
  observatoryPeriod: 2900,
  strength: 0.8,
};
const DESK = {
  pulse: 0.6,
  range: 0.4,
  workingPeriod: 700,
  blockedPeriod: 1600,
  phaseSlots: 7,
  still: 0.7,
  radius: 34,
  alpha: 0.85,
  helperRight: 0.2,
  helperY: 0.26,
  helperHeight: 0.9,
  leftScreen: 0.25,
  rightScreen: 1.75,
  screenY: 0.35,
  screenHeight: 1.1,
  helperLampInset: 0.15,
  helperLampHeight: 0.5,
  lampX: 1.85,
  lampY: 0.9,
  lampHeight: 0.6,
};
const DESK_SPARK = { working: 9, blocked: 3, rise: 22, spread: 14, life: 1000, size: 2 };
const LAMP_SPARK = { count: 5, rise: 16, spread: 8, life: 850, size: 2 };
interface EffectTime {
  now: number;
  animate: boolean;
}
export class PlatformEffects<R extends SpriteResource, B extends R = R> {
  constructor(readonly view: ViewRuntime<R, B>) {}
  paintPlatformGlow(now: number, animate: boolean) {
    const time = { now, animate },
      scene = this.view.activeScene;
    for (const platform of scene.platforms) this.platform(platform, time);
    this.hub(scene.mail.rect, this.view.C.amber, { ...time, period: HUB.mailPeriod, phase: 0 });
    this.hub(scene.observatory.rect, this.view.C.cyan, {
      ...time,
      period: HUB.observatoryPeriod,
      phase: 1,
    });
  }
  private platform(platform: Platform, time: EffectTime) {
    const r = platform.rect,
      { now, animate } = time;
    if (!this.view.framePaint.onStage(r, 1, PLATFORM.padding)) return;
    const breathe = animate
      ? PLATFORM.alpha +
        PLATFORM.range *
          Math.sin((now / PLATFORM.period) * Math.PI * PLATFORM.halfTurns + r.x * PLATFORM.phase)
      : PLATFORM.still;
    this.view.geometry.glow(
      { ...center(r), z: PLATFORM.height },
      Math.max(r.w, r.h) * PLATFORM.radiusScale,
      {
        color: platform.accent,
        alpha: breathe * PLATFORM.strength,
        transparent: this.view.C["glow-transparent"],
      },
    );
    this.view.effects.rimBloom(r, platform.accent, time);
    if (animate) this.corners(platform, time);
  }
  private corners(platform: Platform, time: EffectTime) {
    const r = platform.rect;
    for (const corner of [
      { x: r.x, y: r.y + r.h },
      { x: r.x + r.w, y: r.y + r.h },
      { x: r.x + r.w, y: r.y },
    ]) {
      const at = project(corner),
        { lift, ...options } = CORNER;
      this.view.effects.sparks(
        { x: at.x, y: at.y - lift },
        "corner" + platform.key + String(corner.x) + "," + String(corner.y),
        time.now,
        { ...options, color: platform.accent, alt: this.view.C["platform-spark"] },
      );
    }
  }
  private hub(r: Rect, color: string, time: EffectTime & { period: number; phase: number }) {
    if (!this.view.framePaint.onStage(r, 1, PLATFORM.padding)) return;
    const alpha = time.animate
      ? HUB.alpha +
        HUB.range * Math.sin((time.now / time.period) * Math.PI * PLATFORM.halfTurns + time.phase)
      : HUB.still;
    this.view.geometry.glow({ ...center(r), z: HUB.height }, Math.max(r.w, r.h) * HUB.radiusScale, {
      color,
      alpha,
      transparent: this.view.C["glow-transparent"],
    });
    this.view.effects.rimBloom(r, color, {
      now: time.now,
      animate: time.animate,
      strength: HUB.strength,
    });
  }
  paintDeskFx(worker: Worker, now: number, live: boolean) {
    const status = worker.row.status,
      scale = worker.scale || 1;
    if (status !== "working" && status !== "blocked") return;
    const color = statusColor(this.view.S, status);
    const pulse = live
      ? DESK.pulse +
        DESK.range *
          Math.sin(
            (now / (status === "working" ? DESK.workingPeriod : DESK.blockedPeriod)) *
              Math.PI *
              PLATFORM.halfTurns +
              (hash(worker.id) % DESK.phaseSlots),
          )
      : DESK.still;
    const screens = this.screenPoints(worker);
    for (const point of screens)
      this.view.geometry.glow(point, DESK.radius * scale, {
        color: status === "working" ? this.view.C.cyan : color,
        alpha: DESK.alpha * pulse,
        transparent: this.view.C["glow-transparent"],
      });
    if (live) this.deskSparks(worker, screens, { now, color, scale });
  }
  private screenPoints(worker: Worker) {
    const d = worker.desk;
    return worker.kind === "helper"
      ? [{ x: d.x + d.w - DESK.helperRight, y: d.y + DESK.helperY, z: DESK.helperHeight }]
      : [
          { x: d.x + DESK.leftScreen, y: d.y + DESK.screenY, z: DESK.screenHeight },
          { x: d.x + DESK.rightScreen, y: d.y + DESK.screenY, z: DESK.screenHeight },
        ];
  }
  private deskSparks(
    worker: Worker,
    screens: Point[],
    time: { now: number; color: string; scale: number },
  ) {
    const { now, color, scale } = time,
      working = worker.row.status === "working";
    for (const point of screens) {
      const at = project(point);
      this.view.effects.sparks(at, "screen" + worker.id + String(point.x), now, {
        count: working ? DESK_SPARK.working : DESK_SPARK.blocked,
        color: working ? this.view.C["desk-spark"] : color,
        alt: this.view.C["desk-spark-alt"],
        rise: DESK_SPARK.rise * scale,
        spread: DESK_SPARK.spread * scale,
        life: DESK_SPARK.life,
        size: DESK_SPARK.size,
      });
    }
    const d = worker.desk;
    const lamp = project(
      worker.kind === "helper"
        ? {
            x: d.x + DESK.helperLampInset,
            y: d.y + d.h - DESK.helperLampInset,
            z: DESK.helperLampHeight,
          }
        : { x: d.x + DESK.lampX, y: d.y + DESK.lampY, z: DESK.lampHeight },
    );
    this.view.effects.sparks(lamp, "lamp" + worker.id, now, {
      ...LAMP_SPARK,
      color,
      alt: this.view.C["desk-spark-alt"],
      rise: LAMP_SPARK.rise * scale,
      spread: LAMP_SPARK.spread * scale,
    });
  }
}
