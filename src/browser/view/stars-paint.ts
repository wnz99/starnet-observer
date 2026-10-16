import type { SpriteResource } from "../sprites/types.js";
import { skyRandom } from "./sky-random.js";

import { withAlpha } from "./primitives.js";

import type { Nebula, Star } from "./state-types.js";

import type { ViewRuntime } from "./runtime.js";
import { present as required } from "./values.js";
const HALF_TURNS = 2;
const FAR_STARS = {
  count: 520,
  depth: 0.02,
  smallRate: 0.85,
  mediumRate: 0.97,
  alpha: 0.12,
  alphaRange: 0.3,
  twinkleRate: 0.08,
};
const MID_STARS = {
  count: 260,
  depth: 0.06,
  smallRate: 0.6,
  mediumRate: 0.9,
  alpha: 0.3,
  alphaRange: 0.5,
  twinkleRate: 0.35,
};
const STAR = { mediumSize: 1.5, largeSize: 2, period: 1800, periodRange: 4200 };
const BRIGHT_STAR = {
  count: 14,
  depth: 0.12,
  size: 2,
  alpha: 0.75,
  alphaRange: 0.25,
  tintCount: 2,
  period: 2600,
  periodRange: 2600,
  ray: 4,
  rayRange: 5,
};
const STAR_RAY = {
  length: 0.6,
  pulseLength: 0.4,
  alpha: 0.55,
  haloAlpha: 0.18,
  pixelOffset: 0.5,
  span: 2,
  haloScale: 0.5,
};
const NEBULA = {
  count: 4,
  radius: 0.18,
  radiusRange: 0.22,
  hueCycle: 2,
  alpha: 0.05,
  alphaRange: 0.05,
  parallax: 0.015,
  breathe: 0.12,
  period: 9000,
  phaseSpread: 7,
  coreAlpha: 1.6,
  middleStop: 0.55,
  fillInset: 1.2,
  fillSpan: 2.4,
};
const METEOR = {
  slot: 7000,
  life: 1100,
  skipRate: 0.25,
  startX: 0.1,
  startXRange: 0.9,
  startYRange: 0.45,
  angle: 0.62,
  angleRange: 0.2,
  speed: 420,
  speedRange: 380,
  tail: 60,
  tailRange: 70,
  fadeIn: 0.15,
  fadeOut: 0.85,
  steps: 14,
  alpha: 0.85,
  headSteps: 2,
  pixelSize: 2,
};
const PLAIN_STAR = {
  count: 220,
  smallRate: 0.8,
  mediumRate: 0.7,
  alpha: 0.25,
  alphaRange: 0.6,
  twinkleRate: 0.1,
  period: 4000,
  periodRange: 3000,
  parallax: 0.05,
};

export class StarsPaint<R extends SpriteResource, B extends R = R> {
  constructor(readonly view: ViewRuntime<R, B>) {}

  starfield = () => {
    if (this.view.stars) return this.view.stars;
    const next = skyRandom("starfield");
    const bright = this.brightStars(next);
    const nebulae = this.nebulaField(next);
    return (this.view.stars = {
      far: this.starLayer(next, FAR_STARS),
      mid: this.starLayer(next, MID_STARS),
      bright,
      nebulae,
    });
  };

  private starLayer(next: () => number, recipe: typeof FAR_STARS) {
    const list: Star[] = [];
    for (let i = 0; i < recipe.count; i++) {
      const r = next();
      list.push({
        x: next(),
        y: next(),
        depth: recipe.depth,
        size: r < recipe.smallRate ? 1 : r < recipe.mediumRate ? STAR.mediumSize : STAR.largeSize,
        a: recipe.alpha + next() * recipe.alphaRange,
        tint: required(this.view.STAR_TINTS[Math.floor(next() * this.view.STAR_TINTS.length)]),
        twinkle: next() < recipe.twinkleRate,
        period: STAR.period + next() * STAR.periodRange,
        phase: next() * Math.PI * HALF_TURNS,
      });
    }
    return list;
  }

  private brightStars(next: () => number) {
    const bright: Star[] = [];
    for (let i = 0; i < BRIGHT_STAR.count; i++)
      bright.push({
        x: next(),
        y: next(),
        depth: BRIGHT_STAR.depth,
        size: BRIGHT_STAR.size,
        a: BRIGHT_STAR.alpha + next() * BRIGHT_STAR.alphaRange,
        tint: required(this.view.STAR_TINTS[Math.floor(next() * BRIGHT_STAR.tintCount)]),
        twinkle: true,
        period: BRIGHT_STAR.period + next() * BRIGHT_STAR.periodRange,
        phase: next() * Math.PI * HALF_TURNS,
        ray: BRIGHT_STAR.ray + next() * BRIGHT_STAR.rayRange,
      });
    return bright;
  }

  private nebulaField(next: () => number) {
    const nebulae: Nebula[] = [];
    for (let i = 0; i < NEBULA.count; i++)
      nebulae.push({
        x: next(),
        y: next(),
        r: NEBULA.radius + next() * NEBULA.radiusRange,
        hue: i % NEBULA.hueCycle ? "nebula-cyan" : "nebula-violet",
        a: NEBULA.alpha + next() * NEBULA.alphaRange,
      });
    return nebulae;
  }

  paintStarLayer = (list: Star[], now: number, animate: boolean, shiftScale: number) => {
    const w = this.view.viewport.width,
      h = this.view.viewport.height;
    for (const star of list) {
      const sx = animate ? this.view.camera.tx * star.depth * shiftScale : 0,
        sy = animate ? this.view.camera.ty * star.depth * shiftScale : 0;
      const x = (((star.x * w + sx) % w) + w) % w,
        y = (((star.y * h + sy) % h) + h) % h;
      const pulse =
        star.twinkle && animate
          ? 0.45 +
            0.55 * (0.5 + 0.5 * Math.sin((now / star.period) * Math.PI * HALF_TURNS + star.phase))
          : 1;
      this.view.ctx.globalAlpha = star.a * pulse;
      this.view.ctx.fillStyle = this.view.C[star.tint];
      this.view.ctx.fillRect(x, y, star.size, star.size);
      if (star.ray) {
        const len = star.ray * (STAR_RAY.length + STAR_RAY.pulseLength * pulse);
        this.view.ctx.globalAlpha = star.a * pulse * STAR_RAY.alpha;
        this.view.ctx.fillRect(
          x - len,
          y + STAR_RAY.pixelOffset,
          len * STAR_RAY.span + star.size,
          1,
        );
        this.view.ctx.fillRect(
          x + STAR_RAY.pixelOffset,
          y - len,
          1,
          len * STAR_RAY.span + star.size,
        );
        this.view.ctx.globalAlpha = star.a * pulse * STAR_RAY.haloAlpha;
        this.view.ctx.fillRect(
          x - len * STAR_RAY.haloScale,
          y - len * STAR_RAY.haloScale,
          len + star.size,
          len + star.size,
        );
      }
    }
  };

  paintNebulae = (nebulae: Nebula[], now: number, animate: boolean) => {
    const w = this.view.viewport.width,
      h = this.view.viewport.height,
      base = Math.max(w, h);
    for (const n of nebulae) {
      const sx = animate ? this.view.camera.tx * NEBULA.parallax : 0,
        sy = animate ? this.view.camera.ty * NEBULA.parallax : 0;
      const cx = (((n.x * w + sx) % w) + w) % w,
        cy = (((n.y * h + sy) % h) + h) % h,
        r = n.r * base;
      const breathe = animate
        ? 1 +
          NEBULA.breathe *
            Math.sin((now / NEBULA.period) * Math.PI * HALF_TURNS + n.x * NEBULA.phaseSpread)
        : 1;
      const g = this.view.ctx.createRadialGradient(cx, cy, 0, cx, cy, r * breathe);
      g.addColorStop(0, withAlpha(this.view.C[n.hue], n.a * NEBULA.coreAlpha));
      g.addColorStop(NEBULA.middleStop, withAlpha(this.view.C[n.hue], n.a));
      g.addColorStop(1, withAlpha(this.view.C[n.hue], 0));
      this.view.ctx.fillStyle = g;
      this.view.ctx.fillRect(
        cx - r * NEBULA.fillInset,
        cy - r * NEBULA.fillInset,
        r * NEBULA.fillSpan,
        r * NEBULA.fillSpan,
      );
    }
  };

  paintShootingStars = (now: number) => {
    // One streak roughly every 7s, each lasting ~1.1s; the slot index seeds a deterministic path.
    const slot = Math.floor(now / METEOR.slot),
      t = now - slot * METEOR.slot;
    if (t > METEOR.life) return;
    const next = skyRandom("meteor" + String(slot));
    if (next() < METEOR.skipRate) return; // skip some slots so it feels irregular
    const w = this.view.viewport.width,
      h = this.view.viewport.height,
      p = t / METEOR.life;
    const x0 = w * (METEOR.startX + next() * METEOR.startXRange),
      y0 = h * (next() * METEOR.startYRange),
      angle = Math.PI * (METEOR.angle + next() * METEOR.angleRange),
      speed = METEOR.speed + next() * METEOR.speedRange;
    const dist = speed * p,
      x = x0 + Math.cos(angle) * dist,
      y = y0 + Math.sin(angle) * dist,
      tail = METEOR.tail + next() * METEOR.tailRange;
    const fade = p < METEOR.fadeIn ? p / METEOR.fadeIn : 1 - (p - METEOR.fadeIn) / METEOR.fadeOut;
    // Pixel-art tail: a run of 2px dots fading toward the back (the test canvas has no linear gradients).
    const steps = METEOR.steps,
      dx = (-Math.cos(angle) * tail) / steps,
      dy = (-Math.sin(angle) * tail) / steps;
    this.view.ctx.save();
    for (let i = steps - 1; i >= 0; i--) {
      this.view.ctx.globalAlpha =
        Math.max(0, fade) * METEOR.alpha * (1 - i / steps) * (1 - i / steps);
      this.view.ctx.fillStyle =
        i < METEOR.headSteps
          ? this.view.C["shooting-star-head"]
          : this.view.C["shooting-star-tail"];
      this.view.ctx.fillRect(x + dx * i - 1, y + dy * i - 1, METEOR.pixelSize, METEOR.pixelSize);
    }
    this.view.ctx.restore();
  };

  plainStarfield = () => {
    if (this.view.plainStars) return this.view.plainStars;
    const list = [];
    const next = skyRandom("starfield");
    for (let i = 0; i < PLAIN_STAR.count; i++)
      list.push({
        x: next(),
        y: next(),
        size:
          next() < PLAIN_STAR.smallRate
            ? 1
            : next() < PLAIN_STAR.mediumRate
              ? STAR.mediumSize
              : STAR.largeSize,
        a: PLAIN_STAR.alpha + next() * PLAIN_STAR.alphaRange,
        twinkle: next() < PLAIN_STAR.twinkleRate,
        period: PLAIN_STAR.period + next() * PLAIN_STAR.periodRange,
      });
    this.view.plainStars = list;
    return this.view.plainStars;
  };

  paintPlainStars = (now: number, animate: boolean) => {
    const shiftX = animate ? this.view.camera.tx * PLAIN_STAR.parallax : 0,
      shiftY = animate ? this.view.camera.ty * PLAIN_STAR.parallax : 0;
    for (const star of this.plainStarfield()) {
      const x =
          (((star.x * this.view.viewport.width + shiftX) % this.view.viewport.width) +
            this.view.viewport.width) %
          this.view.viewport.width,
        y =
          (((star.y * this.view.viewport.height + shiftY) % this.view.viewport.height) +
            this.view.viewport.height) %
          this.view.viewport.height;
      this.view.ctx.globalAlpha =
        star.twinkle && animate
          ? star.a * (0.55 + 0.45 * Math.sin((now / star.period) * Math.PI * HALF_TURNS))
          : star.a;
      this.view.ctx.fillStyle = this.view.C["plain-star"];
      this.view.ctx.fillRect(x, y, star.size, star.size);
    }
    this.view.ctx.globalAlpha = 1;
  };
}
