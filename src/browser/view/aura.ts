import type { Point, Worker } from "../scene/types.js";
import type { SpriteResource } from "../sprites/types.js";
import { CREW_HEIGHT } from "./helpers.js";
import { hash } from "./primitives.js";
import type { ViewRuntime } from "./runtime.js";
import type { BodyExtent } from "./types.js";
interface AuraTime {
  now: number;
  live: boolean;
  extent?: BodyExtent | null;
}
const AURA = {
  halfTurns: 2,
  chest: 0.45,
  fallbackChest: 0.5,
  period: 900,
  idlePeriod: 2600,
  phaseSlots: 10,
  pulse: 0.7,
  pulseRange: 0.3,
  stillPulse: 0.8,
  turn: Math.PI * 2,
  workingRadius: 54,
  blockedRadius: 44,
  idleRadius: 30,
  workingAlpha: 0.95,
  blockedAlpha: 0.65,
  idleAlpha: 0.32,
  idleBase: 0.25,
  idleRange: 0.75,
  gradientMiddle: 0.5,
  aspect: 1.25,
};
const RING = {
  activeAlpha: 0.45,
  idleAlpha: 0.2,
  width: 1.5,
  x: 12,
  y: 6,
  period: 1400,
  alpha: 0.5,
  xGrowth: 16,
  yGrowth: 8,
};
const MOTE = {
  harmonic: 2,
  workingCount: 10,
  blockedCount: 4,
  idleCount: 8,
  x: 17,
  y: 22,
  yScale: 0.45,
  period: 1600,
  idlePeriod: 5200,
  seedSlots: 360,
  stillPhase: 0.3,
  bob: 6,
  frontAlpha: 0.95,
  rearAlpha: 0.35,
  pixel: 2,
  tail: 3,
  tailStep: 0.18,
  tailFrontAlpha: 0.5,
  tailRearAlpha: 0.15,
  tailFade: 4,
  tailInset: 0.5,
};
const SPARK = {
  working: { count: 8, lift: 10, rise: 28, spread: 22, life: 1200, size: 2 },
  blocked: { count: 3, rise: 26, spread: 12, life: 2600, size: 2 },
  idle: { count: 7, lift: 8, rise: 14, spread: 18, life: 1500, size: 2 },
};
export class Aura<R extends SpriteResource, B extends R = R> {
  constructor(readonly view: ViewRuntime<R, B>) {}
  private vigour(worker: Worker) {
    if (worker.row.status === "working") return 1;
    try {
      const value = Math.max(0, Math.min(1, this.view.callbacks.idleVigour(worker.id)));
      return Number.isFinite(value) ? value : 1;
    } catch {
      return 1;
    }
  }
  private frame(worker: Worker, foot: Point, time: AuraTime) {
    const working = worker.row.status === "working",
      blocked = worker.row.status === "blocked",
      size = worker.scale || 1;
    const color = working ? this.view.S.working : blocked ? this.view.S.blocked : worker.accent;
    const chestY = time.extent
      ? time.extent.top + time.extent.h * AURA.chest
      : foot.y - CREW_HEIGHT * size * AURA.fallbackChest;
    const pulse = time.live
      ? AURA.pulse +
        AURA.pulseRange *
          Math.sin(
            (time.now / (working ? AURA.period : AURA.idlePeriod)) * Math.PI * AURA.halfTurns +
              (hash(worker.id) % AURA.phaseSlots),
          )
      : AURA.stillPulse;
    return {
      worker,
      foot,
      time,
      working,
      blocked,
      size,
      color,
      chestY,
      pulse,
      vigour: this.vigour(worker),
    };
  }
  paintBackdrop(worker: Worker, foot: Point, time: AuraTime) {
    const state = this.frame(worker, foot, time),
      { working, blocked, size, color, chestY, pulse, vigour } = state;
    const radius =
        (working ? AURA.workingRadius : blocked ? AURA.blockedRadius : AURA.idleRadius) * size,
      ctx = this.view.ctx;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha =
      (working
        ? AURA.workingAlpha
        : blocked
          ? AURA.blockedAlpha
          : AURA.idleAlpha * (AURA.idleBase + AURA.idleRange * vigour)) * pulse;
    const gradient = ctx.createRadialGradient(foot.x, chestY, 0, foot.x, chestY, radius);
    gradient.addColorStop(0, color);
    gradient.addColorStop(AURA.gradientMiddle, color);
    gradient.addColorStop(1, this.view.C["aura-transparent"]);
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.ellipse(foot.x, chestY, radius, radius * AURA.aspect, 0, 0, AURA.turn);
    ctx.fill();
    ctx.globalAlpha = (working ? RING.activeAlpha : RING.idleAlpha) * pulse;
    ctx.strokeStyle = color;
    ctx.lineWidth = RING.width;
    ctx.beginPath();
    ctx.ellipse(foot.x, foot.y, RING.x * size, RING.y * size, 0, 0, AURA.turn);
    ctx.stroke();
    if (time.live && working) this.expandingRing(state);
    ctx.restore();
  }
  private expandingRing(state: ReturnType<Aura<R, B>["frame"]>) {
    const { time, foot, size } = state,
      ring = (time.now / RING.period) % 1,
      ctx = this.view.ctx;
    ctx.globalAlpha = (1 - ring) * RING.alpha;
    ctx.beginPath();
    ctx.ellipse(
      foot.x,
      foot.y,
      (RING.x + RING.xGrowth * ring) * size,
      (RING.y + RING.yGrowth * ring) * size,
      0,
      0,
      AURA.turn,
    );
    ctx.stroke();
  }
  paintMotes(worker: Worker, foot: Point, time: AuraTime) {
    const state = this.frame(worker, foot, time);
    this.orbit(state);
    if (time.live) this.sparks(state);
  }
  private orbit(state: ReturnType<Aura<R, B>["frame"]>) {
    const { worker, working, blocked, vigour, size, time, foot, chestY, pulse, color } = state;
    const count = working
      ? MOTE.workingCount
      : blocked
        ? MOTE.blockedCount
        : Math.round(MOTE.idleCount * vigour);
    const rx = MOTE.x * size,
      ry = MOTE.y * size * MOTE.yScale,
      speed = working ? MOTE.period : MOTE.idlePeriod,
      seed = hash(worker.id) % MOTE.seedSlots,
      ctx = this.view.ctx;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < count; i++) {
      const angle =
        (time.live ? time.now / speed : MOTE.stillPhase) * Math.PI * AURA.halfTurns +
        i * (AURA.turn / count) +
        seed;
      const bob = Math.sin(angle * MOTE.harmonic) * MOTE.bob * size,
        x = foot.x + Math.cos(angle) * rx,
        y = chestY + Math.sin(angle) * ry + bob,
        front = Math.sin(angle) > 0;
      ctx.globalAlpha = (front ? MOTE.frontAlpha : MOTE.rearAlpha) * pulse;
      ctx.fillStyle = i % 2 ? this.view.C["aura-spark"] : color;
      ctx.fillRect(x - 1, y - 1, MOTE.pixel, MOTE.pixel);
      this.tail({ foot, chestY, rx, ry, size, pulse, front, angle });
    }
    ctx.restore();
  }
  private tail(state: {
    foot: Point;
    chestY: number;
    rx: number;
    ry: number;
    size: number;
    pulse: number;
    front: boolean;
    angle: number;
  }) {
    const { foot, chestY, rx, ry, size, pulse, front, angle } = state,
      ctx = this.view.ctx;
    for (let k = 1; k <= MOTE.tail; k++) {
      const ta = angle - k * MOTE.tailStep;
      ctx.globalAlpha =
        (front ? MOTE.tailFrontAlpha : MOTE.tailRearAlpha) * pulse * (1 - k / MOTE.tailFade);
      ctx.fillRect(
        foot.x + Math.cos(ta) * rx - MOTE.tailInset,
        chestY +
          Math.sin(ta) * ry +
          Math.sin(ta * MOTE.harmonic) * MOTE.bob * size -
          MOTE.tailInset,
        1,
        1,
      );
    }
  }
  private sparks(state: ReturnType<Aura<R, B>["frame"]>) {
    const { worker, foot, time, working, blocked, size, color, chestY, vigour } = state;
    if (working) {
      const { lift, rise, spread, ...options } = SPARK.working;
      this.view.effects.sparks(
        { x: foot.x, y: chestY - lift * size },
        "head" + worker.id,
        time.now,
        {
          ...options,
          color: this.view.C["aura-spark"],
          alt: color,
          rise: rise * size,
          spread: spread * size,
        },
      );
    }
    if (blocked) {
      const { rise, spread, ...options } = SPARK.blocked;
      this.view.effects.sparks({ x: foot.x, y: chestY }, "ember" + worker.id, time.now, {
        ...options,
        color,
        rise: rise * size,
        spread: spread * size,
      });
    }
    const rest = Math.round(SPARK.idle.count * vigour);
    if (!working && !blocked && rest !== 0) {
      const { lift, rise, spread, ...options } = SPARK.idle;
      this.view.effects.sparks(
        { x: foot.x, y: chestY - lift * size },
        "rest" + worker.id,
        time.now,
        {
          ...options,
          count: rest,
          color: worker.accent,
          alt: this.view.C["aura-spark"],
          rise: (rise + rise * vigour) * size,
          spread: spread * size,
        },
      );
    }
  }
}
