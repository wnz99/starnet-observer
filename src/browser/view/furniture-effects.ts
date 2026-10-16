import { project } from "../scene/index.js";
import type { Decoration, Platform, Point, Rect, Worker } from "../scene/types.js";
import type { SpriteResource } from "../sprites/types.js";
import { CORNER_KINDS, WALL_KINDS, wallUnits } from "./furnishing.js";
import {
  APRON_LIGHT,
  type LightingTime,
  MAST,
  PULSE,
  RACK,
  SPARKS,
  type SparkRecipe,
  WALKWAY,
  WALL_LIGHTS,
  WORKER_LIGHT,
  pulse,
} from "./furniture-lighting.js";
import { HubEffects } from "./hub-effects.js";
import { center, hash } from "./primitives.js";
import type { ViewRuntime } from "./runtime.js";
import { present } from "./values.js";
export class FurnitureEffects<R extends SpriteResource, B extends R = R> {
  readonly hubs;
  constructor(readonly view: ViewRuntime<R, B>) {
    this.hubs = new HubEffects(view);
  }
  paintFurnitureFx(now: number, animate: boolean) {
    const time = { now, animate };
    for (const platform of this.view.activeScene.platforms) this.platform(platform, time);
    if (animate)
      for (const walkway of this.view.activeScene.walkways) this.walkway(walkway.rect, time);
    for (const worker of this.view.activeScene.workers) this.worker(worker, time);
    this.hubs.paint(time);
  }
  private spark(point: Point, key: string, time: LightingTime, recipe: SparkRecipe) {
    if (!time.animate) return;
    const { prefix, height, color, alt, ...options } = recipe;
    const at = project({ ...point, z: height });
    this.view.effects.sparks({ x: at.x, y: at.y }, prefix + key, time.now, {
      ...options,
      color: this.view.C[color],
      alt: this.view.C[alt],
    });
  }
  private platform(platform: Platform, time: LightingTime) {
    const cull = { height: 2.4, padding: 48 };
    if (!this.view.framePaint.onStage(platform.rect, cull.height, cull.padding)) return;
    platform.decorationRegions.forEach((region, index) => {
      if (region.kind !== "wall" && region.kind !== "corner") return;
      const kinds = region.kind === "corner" ? CORNER_KINDS : WALL_KINDS;
      wallUnits(region).forEach((unit, slot) => {
        const key = `${platform.key}:${String(index)}:${String(slot)}`;
        this.wall(present(kinds[hash(key) % kinds.length]), center(unit), {
          key,
          accent: platform.accent,
          time,
        });
      });
    });
    for (const region of platform.decorationRegions)
      if (region.kind === "apron") this.apron(platform.key, region, time);
  }
  private wall(
    kind: string,
    point: Point,
    options: { key: string; accent: string; time: LightingTime },
  ) {
    const { key, accent, time } = options,
      phase = hash(key) % PULSE.phaseSlots;
    const recipe = WALL_LIGHTS[kind];
    if (!recipe) {
      this.mast(point, key, time);
      return;
    }
    const color = recipe.color === "accent" ? accent : this.view.C[recipe.color];
    this.view.geometry.glow({ ...point, z: recipe.height }, recipe.radius, {
      color: color,
      alpha: recipe.strength * pulse(time, recipe.period, phase),
      transparent: this.view.C["glow-transparent"],
    });
    if (kind === "rack") this.rack(point, phase, time);
    if (recipe.sparks) this.spark(point, key, time, recipe.sparks);
  }
  private rack(point: Point, phase: number, time: LightingTime) {
    const top = project({ ...point, z: RACK.top }),
      bottom = project({ ...point, z: RACK.bottom });
    for (let i = 0; i < RACK.leds; i++) {
      const on =
        !time.animate ||
        (Math.floor(time.now / RACK.interval) + i * RACK.phaseStep + phase) % RACK.leds !== 0;
      this.view.ctx.globalAlpha = on ? RACK.on : RACK.off;
      this.view.ctx.fillStyle = i % 2 ? this.view.S.working : this.view.C.cyan;
      this.view.ctx.fillRect(
        bottom.x - RACK.left + i * RACK.spacing,
        bottom.y - (bottom.y - top.y) * (i / RACK.leds) - 1,
        RACK.pixel,
        RACK.pixel,
      );
    }
    this.view.ctx.globalAlpha = 1;
  }
  private mast(point: Point, key: string, time: LightingTime) {
    const strength = pulse(time, MAST.period, hash(key) % PULSE.phaseSlots),
      beacon = { ...point, z: MAST.height };
    this.view.geometry.glow(beacon, MAST.radius, {
      color: this.view.C["mast-glow"],
      alpha: MAST.strength * strength,
      transparent: this.view.C["glow-transparent"],
    });
    const at = project(beacon),
      ctx = this.view.ctx;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = MAST.flareAlpha * strength;
    ctx.fillStyle = this.view.C["mast-core"];
    ctx.fillRect(at.x - MAST.halfLength, at.y - MAST.halfWidth, MAST.length, 1);
    ctx.fillRect(at.x - MAST.halfWidth, at.y - MAST.halfLength, 1, MAST.length);
    ctx.restore();
    this.spark(point, key, time, SPARKS.mast);
  }
  private apron(platformKey: string, region: Decoration, time: LightingTime) {
    const point = center(region.rect);
    this.view.geometry.glow({ ...point, z: APRON_LIGHT.height }, APRON_LIGHT.radius, {
      color: this.view.C.window,
      alpha: APRON_LIGHT.strength * pulse(time, APRON_LIGHT.period, region.rect.x),
      transparent: this.view.C["glow-transparent"],
    });
    this.spark(point, platformKey + String(region.rect.x), time, SPARKS.apron);
  }
  private walkway(rect: Rect, time: LightingTime) {
    if (!this.view.framePaint.onStage(rect, WALKWAY.height, WALKWAY.padding)) return;
    const along = rect.w >= rect.h,
      len = along ? rect.w : rect.h,
      beads = Math.max(WALKWAY.minBeads, Math.round(len / WALKWAY.spacing));
    for (const side of [0, 1])
      for (let k = 0; k < beads; k++) {
        const distance = ((time.now / WALKWAY.lap + k / beads + side * WALKWAY.phase) % 1) * len;
        const point = this.walkwayPoint(rect, distance, side, along);
        this.walkwayBead(point, along);
      }
  }
  private walkwayPoint(rect: Rect, distance: number, side: number, along: boolean) {
    return along
      ? { x: rect.x + distance, y: side ? rect.y + rect.h : rect.y }
      : { x: side ? rect.x + rect.w : rect.x, y: rect.y + distance };
  }
  private walkwayBead(point: Point, along: boolean) {
    const ctx = this.view.ctx;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let t = 0; t < WALKWAY.tail; t++) {
      const back = project(
        along
          ? { x: point.x - t * WALKWAY.tailStep, y: point.y }
          : { x: point.x, y: point.y - t * WALKWAY.tailStep },
      );
      ctx.globalAlpha = (1 - t / WALKWAY.tail) * WALKWAY.alpha;
      ctx.fillStyle = t === 0 ? this.view.C["walkway-light-head"] : this.view.C.cyan;
      ctx.fillRect(back.x - 1, back.y - 1, WALKWAY.pixel, WALKWAY.pixel);
    }
    ctx.restore();
  }
  private worker(worker: Worker, time: LightingTime) {
    const scale = worker.scale || 1,
      status = worker.row.status,
      idle = status !== "working" && status !== "blocked";
    if (
      this.view.framePaint.onStage(worker.desk, WORKER_LIGHT.deskCullHeight, WORKER_LIGHT.padding)
    ) {
      const color = idle
        ? worker.accent
        : status === "working"
          ? this.view.C.cyan
          : this.view.S.blocked;
      this.view.geometry.glow(
        { ...center(worker.desk), z: WORKER_LIGHT.height },
        WORKER_LIGHT.radius * scale,
        {
          color: color,
          alpha:
            (idle ? WORKER_LIGHT.idle : WORKER_LIGHT.active) *
            pulse(time, WORKER_LIGHT.period, hash(worker.id) % PULSE.phaseSlots),
          transparent: this.view.C["glow-transparent"],
        },
      );
    }
    const c = worker.chair;
    if (
      !this.view.framePaint.onStage(
        {
          x: c.x - WORKER_LIGHT.chairLeft,
          y: c.y - WORKER_LIGHT.chairTop,
          w: WORKER_LIGHT.chairSize,
          h: WORKER_LIGHT.chairSize,
        },
        WORKER_LIGHT.chairCullHeight,
        WORKER_LIGHT.chairPadding,
      )
    )
      return;
    const ctx = this.view.ctx;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = WORKER_LIGHT.ringAlpha * pulse(time, WORKER_LIGHT.ringPeriod, c.x);
    this.view.geometry.isoEllipse(c, WORKER_LIGHT.ringRadius * scale, {
      stroke: worker.accent,
      fill: null,
      width: WORKER_LIGHT.ringWidth,
    });
    ctx.restore();
  }
}
