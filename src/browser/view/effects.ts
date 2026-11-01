import { project as P } from "../scene/index.js";
import type { ObservationLink, Point, Rect } from "../scene/types.js";
import type { SpriteResource } from "../sprites/types.js";
import { hash } from "./primitives.js";
import type { SparkOptions } from "./state-types.js";
import type { ViewRuntime } from "./runtime.js";
const OBSERVATION = {
  height: 0.1,
  liveWidth: 1.2,
  downWidth: 0.8,
  endRadius: 4,
  glowRadius: 14,
  glowBase: 0.3,
  glowRange: 0.25,
  glowPeriod: 600,
  glowStill: 0.4,
  dash: [3, 5],
};
const PARTICLE = { diameter: 2, driftPeriod: 300, driftAmplitude: 1.5 };
const RIM = { period: 1800, halfTurns: 2, beadHalf: 1.5, beadSize: 3 };

const SPARK = { count: 6, rise: 18, spread: 14, life: 1400, size: 2 };
export class Effects<R extends SpriteResource, B extends R = R> {
  constructor(readonly view: ViewRuntime<R, B>) {}

  paintObservation = (link: ObservationLink, now: number, animate: boolean) => {
    const live = link.health === "available",
      color = live ? this.view.C.cyan : this.view.C.idle;
    const a = P({ ...link.from, z: OBSERVATION.height }),
      b = P({ ...link.to, z: OBSERVATION.height });
    this.view.ctx.save();
    this.view.ctx.strokeStyle = color;
    this.view.ctx.lineWidth =
      (live ? OBSERVATION.liveWidth : OBSERVATION.downWidth) / this.view.camera.zoom;
    this.view.ctx.globalAlpha = live ? 0.85 : 0.45;
    this.view.ctx.setLineDash(live ? [] : OBSERVATION.dash);
    this.view.ctx.lineDashOffset = live && animate ? -(now / 60) % 8 : 0;
    this.view.ctx.beginPath();
    this.view.ctx.moveTo(a.x, a.y);
    for (const point of link.path.slice(1)) {
      const at = P({ ...point, z: OBSERVATION.height });
      this.view.ctx.lineTo(at.x, at.y);
    }
    this.view.ctx.stroke();
    this.view.ctx.setLineDash([]);
    for (const end of [a, b]) {
      this.view.ctx.fillStyle = color;
      this.view.ctx.beginPath();
      this.view.ctx.moveTo(end.x, end.y - OBSERVATION.endRadius);
      this.view.ctx.lineTo(end.x + OBSERVATION.endRadius, end.y);
      this.view.ctx.lineTo(end.x, end.y + OBSERVATION.endRadius);
      this.view.ctx.lineTo(end.x - OBSERVATION.endRadius, end.y);
      this.view.ctx.closePath();
      this.view.ctx.fill();
    }
    if (live) this.observationGlow(link, now, animate);
    this.view.ctx.restore();
  };

  private observationGlow(link: ObservationLink, now: number, animate: boolean) {
    this.view.geometry.glow({ ...link.to, z: OBSERVATION.height }, OBSERVATION.glowRadius, {
      color: this.view.C.cyan,
      alpha: animate
        ? OBSERVATION.glowBase + OBSERVATION.glowRange * Math.sin(now / OBSERVATION.glowPeriod)
        : OBSERVATION.glowStill,
      transparent: this.view.C["glow-transparent"],
    });
  }

  sparks = (point: Point, key: string, now: number, options: SparkOptions = {}) => {
    const { x, y } = point;
    const { count, color, alt, rise, spread, life, size, gravity } = sparkStyle(
      options,
      this.view.C.spark,
    );
    const base = hash(key);
    for (let i = 0; i < count; i++) {
      const h1 = hash(key + ":" + String(i)),
        h2 = hash(String(i) + "#" + key);
      const t = ((now + (h1 % life)) % life) / life;
      const dx = ((h2 % 1000) / 1000 - 0.5) * spread,
        vy = 0.6 + (((h1 >>> 8) % 1000) / 1000) * 0.8;
      const px = x + dx + Math.sin(now / PARTICLE.driftPeriod + i) * PARTICLE.driftAmplitude,
        py = y - rise * t * vy + gravity * t * t;
      const a = t < 0.2 ? t / 0.2 : 1 - (t - 0.2) / 0.8,
        sz = size * (1 - t * 0.5);
      this.view.ctx.globalAlpha = Math.max(0, a) * 0.9;
      this.view.ctx.fillStyle = alt && (base + i) % 3 === 0 ? alt : color;
      this.view.ctx.fillRect(px - sz / PARTICLE.diameter, py - sz / PARTICLE.diameter, sz, sz);
    }
    this.view.ctx.globalAlpha = 1;
  };

  rimBloom = (
    rect: Rect,
    accent: string,
    { now, animate, strength = 1 }: { now: number; animate: boolean; strength?: number },
  ) => {
    const a = P({ x: rect.x, y: rect.y + rect.h }),
      b = P({ x: rect.x + rect.w, y: rect.y + rect.h }),
      c = P({ x: rect.x + rect.w, y: rect.y });
    const pulse = animate
      ? 0.75 + 0.25 * Math.sin((now / RIM.period) * Math.PI * RIM.halfTurns + rect.x)
      : 0.85;
    this.view.ctx.save();
    this.view.ctx.globalCompositeOperation = "lighter";
    this.view.ctx.strokeStyle = accent;
    this.view.ctx.lineCap = "round";
    for (const [width, alpha] of RIM_BANDS) {
      this.view.ctx.lineWidth = width;
      this.view.ctx.globalAlpha = alpha * pulse * strength;
      this.view.ctx.beginPath();
      this.view.ctx.moveTo(a.x, a.y);
      this.view.ctx.lineTo(b.x, b.y);
      this.view.ctx.lineTo(c.x, c.y);
      this.view.ctx.stroke();
    }
    if (animate) {
      // Running light: one bright bead per edge pair, 4s per lap, with a short fading tail.
      const lap = 4000,
        len1 = Math.hypot(b.x - a.x, b.y - a.y),
        len2 = Math.hypot(c.x - b.x, c.y - b.y),
        total = len1 + len2;
      for (let k = 0; k < 10; k++) {
        const d = (((now - k * 40) / lap + rect.y * 0.01 + (k >= 5 ? 0.5 : 0)) % 1) * total;
        const pt =
          d < len1
            ? { x: a.x + ((b.x - a.x) * d) / len1, y: a.y + ((b.y - a.y) * d) / len1 }
            : {
                x: b.x + ((c.x - b.x) * (d - len1)) / len2,
                y: b.y + ((c.y - b.y) * (d - len1)) / len2,
              };
        this.view.ctx.globalAlpha = (1 - (k % 5) / 5) * 0.95 * strength;
        this.view.ctx.fillStyle = k % 5 === 0 ? this.view.C["rim-spark"] : accent;
        this.view.ctx.fillRect(
          pt.x - RIM.beadHalf,
          pt.y - RIM.beadHalf,
          RIM.beadSize,
          RIM.beadSize,
        );
      }
    }
    this.view.ctx.restore();
  };
}

function sparkStyle(options: SparkOptions, color: string) {
  const {
    count = SPARK.count,
    color: resolvedColor = color,
    alt = null,
    rise = SPARK.rise,
    spread = SPARK.spread,
    life = SPARK.life,
    size = SPARK.size,
    gravity = 0,
  } = options;
  return { count, color: resolvedColor, alt, rise, spread, life, size, gravity };
}

const RIM_BANDS = [
  [26, 0.1],
  [14, 0.2],
  [7, 0.38],
  [3, 0.8],
] satisfies [number, number][];
