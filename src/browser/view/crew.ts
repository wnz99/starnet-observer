import { project } from "../scene/index.js";
import type { ActorFrame, Point, Rect, Worker } from "../scene/types.js";
import type { SpriteAppearance, SpriteResource } from "../sprites/types.js";
import { CREW_HEIGHT, idleFilter, MIN_HIT, SPRITE_SCALE } from "./helpers.js";
import { hash } from "./primitives.js";
import type { ViewRuntime } from "./runtime.js";
import type { ViewBody } from "./state-types.js";
import type { BodyExtent } from "./types.js";
import { present } from "./values.js";
const BODY_PHASE = { slots: 628, divisor: 100 };
const CONTACT = { inset: 0.3, size: 0.6, padding: 2, radius: 0.28 };
const SILHOUETTE = {
  diameter: 2,
  width: 16,
  alpha: 0.85,
  bodyHeight: 0.72,
  headHeight: 0.84,
  radius: 6,
  turn: Math.PI * 2,
};
interface CrewFrame<B extends SpriteResource> {
  worker: Worker;
  actor: ActorFrame;
  body: ViewBody<B>;
  foot: { x: number; y: number };
  size: number;
  scale: number;
  art: "office" | "station";
  now: number;
  reduced: boolean;
}
export class Crew<R extends SpriteResource, B extends R = R> {
  constructor(readonly view: ViewRuntime<R, B>) {}
  bodyFor(worker: Worker) {
    let body = this.view.bodies.get(worker.id);
    if (!body) {
      body = {
        id: worker.id,
        skin: skinFor(worker.row.provider),
        px: 0,
        py: 0,
        dir: "south",
        state: "idle",
        aph: (hash(worker.id) % BODY_PHASE.slots) / BODY_PHASE.divisor,
      };
      this.view.bodies.set(worker.id, body);
    }
    body.skin = skinFor(worker.row.provider);
    return body;
  }
  paintCrew(worker: Worker, actor: ActorFrame, now: number, reduced: boolean) {
    const foot = project(actor.point),
      body = this.bodyFor(worker),
      size = worker.scale || 1,
      scale = SPRITE_SCALE * size;
    this.shadow(actor, size);
    body.px = foot.x;
    body.py = foot.y;
    body.dir = actor.direction;
    body.state = actor.pose === "walk" ? "walk" : "idle";
    body.working = actor.pose === "working";
    body.sitting = actor.pose === "working";
    const art = this.view.resources.artMode(),
      aura =
        this.view.fx && this.view.decor && art === "station" && !this.view.assemblyFrame.active;
    if (aura) this.view.aura.paintBackdrop(worker, foot, { now, live: !reduced });
    const frame = {
      worker,
      actor,
      body,
      foot,
      size,
      scale,
      art,
      now,
      reduced,
    };
    const extent = this.extent(frame);
    if (aura) this.view.aura.paintMotes(worker, foot, { extent, now, live: !reduced });
    this.recordHit(worker, foot, extent);
  }
  private shadow(actor: ActorFrame, size: number) {
    const point = actor.point;
    if (
      this.view.framePaint.onStage(
        {
          x: point.x - CONTACT.inset,
          y: point.y - CONTACT.inset,
          w: CONTACT.size,
          h: CONTACT.size,
        },
        0,
        CONTACT.padding,
      )
    )
      this.view.geometry.isoEllipse(point, CONTACT.radius * size, {
        stroke: null,
        fill: this.view.C["contact-shadow"],
      });
  }
  private tintFor(id: string) {
    try {
      return idleFilter(this.view.callbacks.idleLevel(id));
    } catch {
      return "none";
    }
  }
  private shouldPaint(bounds: Rect, frame: CrewFrame<B>) {
    const { foot, scale } = frame,
      camera = this.view.camera;
    const screen = (value: number, origin: number, offset: number) =>
      offset + (origin + (value - origin) * scale) * camera.zoom;
    const left = screen(bounds.x, foot.x, camera.tx),
      right = screen(bounds.x + bounds.w, foot.x, camera.tx);
    const top = screen(bounds.y, foot.y, camera.ty),
      bottom = screen(bounds.y + bounds.h, foot.y, camera.ty);
    return (
      right >= -1 &&
      left <= this.view.viewport.width + 1 &&
      bottom >= -1 &&
      top <= this.view.viewport.height + 1
    );
  }
  private sprite(frame: CrewFrame<B>) {
    const { foot, scale, reduced, art } = frame,
      ctx = this.view.ctx;
    ctx.save();
    ctx.translate(foot.x, foot.y);
    ctx.scale(scale, scale);
    ctx.translate(-foot.x, -foot.y);
    const tint = this.tintFor(frame.worker.id);
    if (tint !== "none" && "filter" in ctx) ctx.filter = tint;
    const appearance: SpriteAppearance = {
      reducedMotion: reduced,
      skipGroundShadow: true,
      shouldPaint: (bounds) => this.shouldPaint(bounds, frame),
      ...(this.view.office && art === "station" ? { group: "default" } : {}),
    };
    const extent = this.drawSprite(frame, appearance);
    ctx.restore();
    return { extent, tint };
  }
  private drawSprite(frame: CrewFrame<B>, appearance: SpriteAppearance) {
    const { art, body, now } = frame,
      ctx = this.view.ctx;
    let extent: BodyExtent | null = null;
    if (art === "station" || this.view.resources.replacementReady(body.skin)) {
      try {
        extent = this.view.sprites?.drawBody?.(ctx, body, now, appearance) ?? null;
      } catch {
        extent = null;
      }
    }
    return extent;
  }
  private extent(frame: CrewFrame<B>): BodyExtent {
    const { body, art, foot, scale } = frame;
    const { extent, tint } = this.sprite(frame);
    if (this.view.resources.replacementLoading(body.skin))
      this.view.resources.watchSkin(body.skin, { settled: true });
    if (!extent && art === "office") return this.officeFallback({ ...frame, tint });
    if (!extent) return this.stationFallback({ ...frame, tint });
    if (extent.fallback) return extent;
    return {
      top: foot.y + (extent.top - foot.y) * scale,
      w: extent.w * scale,
      h: extent.h * scale,
      painted: extent.painted,
    };
  }
  private officeFallback(frame: CrewFrame<B> & { tint: string }) {
    const { body, tint, foot, size, worker } = frame,
      ctx = this.view.ctx;
    if (this.view.resources.replacementReady(body.skin)) this.view.resources.watchSkin(body.skin);
    ctx.save();
    if (tint !== "none" && "filter" in ctx) ctx.filter = tint;
    const extent = present(this.view.office?.composition).human(ctx, foot, {
      size,
      sitting: body.sitting === true,
      accent: worker.accent,
      skin: body.skin,
    });
    ctx.restore();
    return extent;
  }
  private stationFallback(frame: CrewFrame<B> & { tint: string }) {
    const { body, foot, size, worker, tint } = frame,
      ctx = this.view.ctx;
    this.view.resources.watchSkin(body.skin);
    const h = CREW_HEIGHT * size,
      w = SILHOUETTE.width * size;
    ctx.save();
    ctx.globalAlpha *= SILHOUETTE.alpha;
    ctx.fillStyle = worker.accent;
    ctx.strokeStyle = this.view.C["body-outline"];
    if (tint !== "none" && "filter" in ctx) ctx.filter = tint;
    ctx.beginPath();
    if (ctx.roundRect)
      ctx.roundRect(
        foot.x - w / SILHOUETTE.diameter,
        foot.y - h * SILHOUETTE.bodyHeight,
        w,
        h * SILHOUETTE.bodyHeight,
        SILHOUETTE.radius * size,
      );
    else
      ctx.rect(
        foot.x - w / SILHOUETTE.diameter,
        foot.y - h * SILHOUETTE.bodyHeight,
        w,
        h * SILHOUETTE.bodyHeight,
      );
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(
      foot.x,
      foot.y - h * SILHOUETTE.headHeight,
      SILHOUETTE.radius * size,
      0,
      SILHOUETTE.turn,
    );
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    return { top: foot.y - h, w, h, fallback: true };
  }
  private recordHit(worker: Worker, foot: Point, extent: BodyExtent) {
    const camera = this.view.camera,
      left = camera.tx + (foot.x - extent.w / 2) * camera.zoom,
      top = camera.ty + extent.top * camera.zoom;
    const width = extent.w * camera.zoom,
      height = extent.h * camera.zoom,
      padX = Math.max(0, (MIN_HIT - width) / SILHOUETTE.diameter),
      padY = Math.max(0, (MIN_HIT - height) / SILHOUETTE.diameter);
    const region = {
      id: worker.id,
      left: left - padX,
      top: top - padY,
      width: width + padX * 2,
      height: height + padY * 2,
      depth: foot.y,
      head: { x: camera.tx + foot.x * camera.zoom, y: top },
      foot: camera.ty + foot.y * camera.zoom,
    };
    this.view.anchors.push(region);
    if (extent.painted !== false) this.view.regions.push(region);
  }
}
function skinFor(provider: string | undefined) {
  return provider === "claude" ? "blank_amber" : provider === "codex" ? "blank_blue" : "blank";
}
