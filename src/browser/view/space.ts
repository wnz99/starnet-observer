import type { SpriteResource } from "../sprites/types.js";
import { skyRandom } from "./sky-random.js";

import { hash, opaque, withAlpha } from "./primitives.js";

import type { Pixie } from "./state-types.js";

import type { ViewRuntime } from "./runtime.js";
const HALF_TURNS = 2;
const RAIN = { glyphRowDelay: 97, glyphColumnDelay: 31, glyphPeriod: 140 };
const PIXIE = {
  count: 26,
  velocityCenter: 0.5,
  velocityX: 0.012,
  velocityY: 0.008,
  amplitude: 6,
  amplitudeRange: 18,
  period: 2500,
  periodRange: 4500,
  radius: 1.5,
  radiusRange: 2,
  cyanRate: 0.5,
  blink: 1500,
  blinkRange: 2500,
  verticalPeriod: 1.3,
  verticalAmplitude: 0.6,
  haloAlpha: 0.35,
  diameter: 2,
  coreAlpha: 0.6,
  corePulse: 0.4,
  coreInset: 0.5,
};
const PIXIE_TRAIL = { count: 3, delay: 90, alpha: 0.5, fade: 0.13, inset: 0.5 };
const PLANET = {
  radius: 0.42,
  left: 0.35,
  below: 0.55,
  lightOffset: 0.3,
  coreRadius: 0.2,
  shadeStop: 0.85,
  rimInner: 0.97,
  rimOuter: 1.12,
};
const SHUTTLE = {
  cycle: 60000,
  life: 8000,
  startX: 1.1,
  travel: 1.2,
  altitude: 0.12,
  bobPeriod: 900,
  bob: 4,
  bodyWidth: 7,
  height: 2,
  windowWidth: 3,
};

export class Space<R extends SpriteResource, B extends R = R> {
  constructor(readonly view: ViewRuntime<R, B>) {}

  paintMatrixRain = (now: number, animate: boolean) => {
    const w = this.view.viewport.width,
      h = this.view.viewport.height,
      cols = Math.ceil(w / this.view.RAIN_COL) + 1;
    this.view.ctx.font = '12px "VT323", "Courier New", monospace';
    this.view.ctx.textBaseline = "top";
    for (let c = 0; c < cols; c++) {
      this.paintRainColumn(c, h, { now, animate });
    }
    this.view.ctx.globalAlpha = 1;
  };

  private paintRainColumn(c: number, h: number, time: { now: number; animate: boolean }) {
    const cseed = hash("rain" + String(c));
    const speed = 55 + ((cseed % 1000) / 1000) * 110; // px per second
    const len = 10 + ((cseed >>> 10) % 14); // trail glyphs
    const offset = ((cseed >>> 4) % 10000) / 10000; // phase along the column
    const skip = cseed % 7 === 0; // some columns stay dark
    if (skip) return;
    const cycle = ((h + len * this.view.RAIN_ROW) / speed) * 1000;
    const t = time.animate ? time.now : 0;
    const headY =
      ((t / cycle + offset) % 1) * (h + len * this.view.RAIN_ROW) - len * this.view.RAIN_ROW;
    const x = c * this.view.RAIN_COL;
    for (let i = 0; i < len; i++) {
      const y = headY - i * this.view.RAIN_ROW;
      if (y < -this.view.RAIN_ROW || y > h) continue;
      const bucket = Math.floor(
        (t + i * RAIN.glyphRowDelay + c * RAIN.glyphColumnDelay) / RAIN.glyphPeriod,
      );
      const g =
        this.view.RAIN_GLYPHS[
          (hash("g" + String(c) + ":" + String(i) + ":" + String(bucket)) >>> 0) %
            this.view.RAIN_GLYPHS.length
        ];
      const k = 1 - i / len;
      if (i === 0) {
        this.view.ctx.globalAlpha = 0.55;
        this.view.ctx.fillStyle = this.view.C["rain-head"];
      } else {
        this.view.ctx.globalAlpha = 0.06 + 0.26 * k * k;
        this.view.ctx.fillStyle = k > 0.6 ? this.view.C["rain-bright"] : this.view.C["rain-dim"];
      }
      this.view.ctx.fillText(g ?? "", x, y);
    }
  }

  pixieField = () => {
    if (this.view.pixies) return this.view.pixies;
    const list: Pixie[] = [];
    const next = skyRandom("pixies");
    for (let i = 0; i < PIXIE.count; i++)
      list.push({
        x: next(),
        y: next(),
        vx: (next() - PIXIE.velocityCenter) * PIXIE.velocityX,
        vy: (next() - PIXIE.velocityCenter) * PIXIE.velocityY,
        amp: PIXIE.amplitude + next() * PIXIE.amplitudeRange,
        period: PIXIE.period + next() * PIXIE.periodRange,
        phase: next() * Math.PI * HALF_TURNS,
        r: PIXIE.radius + next() * PIXIE.radiusRange,
        tint: next() < PIXIE.cyanRate ? "pixie-cyan" : "pixie-green",
        blink: PIXIE.blink + next() * PIXIE.blinkRange,
      });
    this.view.pixies = list;
    return this.view.pixies;
  };

  paintPixies = (now: number, animate: boolean) => {
    const w = this.view.viewport.width,
      h = this.view.viewport.height,
      t = animate ? now / 1000 : 0;
    for (const m of this.pixieField()) {
      const bx = ((((m.x + m.vx * t) % 1) + 1) % 1) * w,
        by = ((((m.y + m.vy * t) % 1) + 1) % 1) * h;
      const px = bx + Math.sin((now / m.period) * Math.PI * HALF_TURNS + m.phase) * m.amp,
        py =
          by +
          Math.cos((now / (m.period * PIXIE.verticalPeriod)) * Math.PI * HALF_TURNS + m.phase) *
            m.amp *
            PIXIE.verticalAmplitude;
      const glow = animate
        ? 0.55 + 0.45 * Math.sin((now / m.blink) * Math.PI * HALF_TURNS + m.phase)
        : 0.8;
      const tint = this.view.C[m.tint],
        rad = m.r * (2.5 + glow * 2.5);
      const halo = this.view.ctx.createRadialGradient(px, py, 0, px, py, rad);
      halo.addColorStop(0, withAlpha(tint, PIXIE.haloAlpha * glow));
      halo.addColorStop(1, withAlpha(tint, 0));
      this.view.ctx.fillStyle = halo;
      this.view.ctx.fillRect(px - rad, py - rad, rad * PIXIE.diameter, rad * PIXIE.diameter);
      // trail: three fading echoes behind the mote along its sine path
      for (let k = 1; k <= PIXIE_TRAIL.count; k++) {
        const back = now - k * PIXIE_TRAIL.delay,
          tx =
            ((((m.x + m.vx * (animate ? back / 1000 : 0)) % 1) + 1) % 1) * w +
            Math.sin((back / m.period) * Math.PI * HALF_TURNS + m.phase) * m.amp;
        const ty =
          ((((m.y + m.vy * (animate ? back / 1000 : 0)) % 1) + 1) % 1) * h +
          Math.cos((back / (m.period * PIXIE.verticalPeriod)) * Math.PI * HALF_TURNS + m.phase) *
            m.amp *
            PIXIE.verticalAmplitude;
        this.view.ctx.globalAlpha = glow * (PIXIE_TRAIL.alpha - k * PIXIE_TRAIL.fade);
        this.view.ctx.fillStyle = opaque(tint);
        this.view.ctx.fillRect(tx - PIXIE_TRAIL.inset, ty - PIXIE_TRAIL.inset, 1, 1);
      }
      this.view.ctx.globalAlpha = Math.min(1, PIXIE.coreAlpha + glow * PIXIE.corePulse);
      this.view.ctx.fillStyle = this.view.C["pixie-core"];
      this.view.ctx.fillRect(px - m.r * PIXIE.coreInset, py - m.r * PIXIE.coreInset, m.r, m.r);
    }
    this.view.ctx.globalAlpha = 1;
  };

  paintPlanet = () => {
    // Distant planet arc anchored bottom-left of the stage, as in the reference.
    const radius = Math.max(this.view.viewport.width, this.view.viewport.height) * PLANET.radius,
      cx = -radius * PLANET.left,
      cy = this.view.viewport.height + radius * PLANET.below;
    const planet = this.view.ctx.createRadialGradient(
      cx + radius * PLANET.lightOffset,
      cy - radius * PLANET.lightOffset,
      radius * PLANET.coreRadius,
      cx,
      cy,
      radius,
    );
    planet.addColorStop(0, this.view.C["planet-core"]);
    planet.addColorStop(PLANET.shadeStop, this.view.C["planet-shade"]);
    planet.addColorStop(1, this.view.C["planet-edge"]);
    this.view.ctx.fillStyle = planet;
    this.view.ctx.beginPath();
    this.view.ctx.arc(cx, cy, radius, 0, Math.PI * HALF_TURNS);
    this.view.ctx.fill();
    if (this.view.fx) {
      const rim = this.view.ctx.createRadialGradient(
        cx,
        cy,
        radius * PLANET.rimInner,
        cx,
        cy,
        radius * PLANET.rimOuter,
      );
      rim.addColorStop(0, this.view.C["planet-rim"]);
      rim.addColorStop(1, this.view.C["planet-rim-transparent"]);
      this.view.ctx.fillStyle = rim;
      this.view.ctx.beginPath();
      this.view.ctx.arc(cx, cy, radius * PLANET.rimOuter, 0, Math.PI * HALF_TURNS);
      this.view.ctx.fill();
    }
  };

  paintShuttle = (now: number) => {
    // An occasional distant shuttle (ambient): eight seconds in every sixty.
    const t = now % SHUTTLE.cycle;
    if (t < SHUTTLE.life) {
      const x = this.view.viewport.width * (SHUTTLE.startX - (t / SHUTTLE.life) * SHUTTLE.travel),
        y =
          this.view.viewport.height * SHUTTLE.altitude +
          Math.sin(t / SHUTTLE.bobPeriod) * SHUTTLE.bob;
      this.view.ctx.fillStyle = this.view.C["shuttle-body"];
      this.view.ctx.fillRect(x, y, SHUTTLE.bodyWidth, SHUTTLE.height);
      this.view.ctx.fillStyle = this.view.C.window;
      this.view.ctx.fillRect(x + SHUTTLE.bodyWidth, y, SHUTTLE.windowWidth, SHUTTLE.height);
    }
  };

  paintSpace = (now: number, animate: boolean) => {
    this.view.ctx.setTransform(this.view.dpr, 0, 0, this.view.dpr, 0, 0);
    // Office art: one flat warm backdrop, with or without FX; no sky, rain or motes.
    if (this.view.resources.artMode() === "office") {
      this.view.ctx.fillStyle = this.view.C["office-backdrop"];
      this.view.ctx.fillRect(0, 0, this.view.viewport.width, this.view.viewport.height);
      return;
    }
    this.view.ctx.fillStyle = this.view.C.space;
    this.view.ctx.fillRect(0, 0, this.view.viewport.width, this.view.viewport.height);
    // ambientFx none keeps only the backdrop fill (and rain when FX are on); backgroundFx none drops only the rain.
    if (!this.view.decor) {
      if (this.view.fx && this.view.rain) this.paintMatrixRain(now, animate);
      return;
    }
    if (!this.view.fx) {
      this.view.starsPaint.paintPlainStars(now, animate);
      this.paintPlanet();
      if (animate) this.paintShuttle(now);
      return;
    }
    const field = this.view.starsPaint.starfield();
    this.view.starsPaint.paintNebulae(field.nebulae, now, animate);
    this.view.starsPaint.paintStarLayer(field.far, now, animate, 1);
    if (this.view.rain) this.paintMatrixRain(now, animate);
    this.view.starsPaint.paintStarLayer(field.mid, now, animate, 1);
    this.view.starsPaint.paintStarLayer(field.bright, now, animate, 1);
    this.paintPlanet();
    this.paintPixies(now, animate);
    if (animate) {
      this.view.starsPaint.paintShootingStars(now);
      this.paintShuttle(now);
    }
  };
}
