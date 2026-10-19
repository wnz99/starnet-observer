import { project as P } from "../scene/index.js";
import { FrameOverlays } from "./frame-overlays.js";
import { StationItems } from "./station-items.js";
import type { ArtPainters } from "./types.js";
import * as Scene from "../scene/index.js";
import type { Rect } from "../scene/types.js";
import type { SpriteResource } from "../sprites/types.js";
import type { ViewRuntime } from "./runtime.js";
import { present as required } from "./values.js";
const RADAR = {
  halfTurns: 2,
  lift: 16,
  beam: 14,
  minBeam: 3,
  thickness: 6,
  turn: Math.PI * 2,
  glowHeight: 3.9,
  glowRadius: 22,
  glowBase: 0.35,
  glowRange: 0.3,
  glowPeriod: 4000,
};
const TETHER = { alpha: 0.6, width: 1.5, dash: [4, 4] };

export class FramePaint<R extends SpriteResource, B extends R = R> {
  readonly items;
  readonly overlays;
  constructor(readonly view: ViewRuntime<R, B>) {
    this.items = new StationItems(view);
    this.overlays = new FrameOverlays(view);
  }

  onStage = (rect: Rect, height: number, pad: number) => {
    const v = required(this.view.visibleArea);
    const left = PROJECTED_UNIT.x * (rect.x - rect.y - rect.h) - pad,
      right = PROJECTED_UNIT.x * (rect.x + rect.w - rect.y) + pad;
    const top = PROJECTED_UNIT.y * (rect.x + rect.y) - HEIGHT_UNIT * height - pad,
      bottom = PROJECTED_UNIT.y * (rect.x + rect.w + rect.y + rect.h) + pad;
    return right >= v.left && left <= v.right && bottom >= v.top && top <= v.bottom;
  };

  paint = (now: number) => {
    this.view.cameraControl.measure();

    this.view.regions = [];

    this.view.anchors = [];

    if (!this.view.scene) {
      const frame = { animate: false };
      this.view.space.paintSpace(now, frame.animate);
      return;
    }

    const isStale = this.view.stale(),
      reduced = this.view.callbacks.reducedMotion(),
      animate = !isStale && !reduced;

    this.view.actors = this.view.movement.step(now, { stale: this.view.workerStale, reduced });
    this.view.dispatchSettlements();
    this.followFocused();
    // immediate, so a reduced-motion snap keeps the worker in view
    const mail = this.view.mailFrame ? this.view.mailFrame(now) : { drones: [], envelopes: [] };

    this.view.space.paintSpace(now, animate);
    const { A, stationArt, ambient } = this.worldLayer();
    if (stationArt) this.radar(now, animate);

    for (const link of this.view.activeScene.links || [])
      this.view.effects.paintObservation(link, now, animate);
    this.measureVisibleArea();

    if (ambient) this.ambient(now, animate);
    const staleKeys = this.paintItems({ A, now, animate, ambient });
    this.overlays.repository(stationArt);
    this.overlays.focus(now, animate);
    this.overlays.platform(this.view.camera.zoom);
    this.overlays.host(now, animate, this.view.camera.zoom);

    this.view.mail.paintMail(mail, now, animate);

    if (!stationArt) this.view.ctx.imageSmoothingEnabled = true;
    if (isStale) this.overlays.stale();
    this.view.interaction.refreshHover();

    this.view.plates.paintPlates(isStale, staleKeys, now, animate);

    return animate;
  };
  private ambient(now: number, animate: boolean) {
    this.view.platformEffects.paintPlatformGlow(now, animate);
    this.view.furnitureEffects.paintFurnitureFx(now, animate);
  }
  followFocused = () => {
    if (this.view.mode === "focus" && this.view.focused) {
      const point = this.view.cameraControl.pointOf(this.view.focused);
      if (point)
        this.view.cameraControl.setCamera(
          Scene.focus(point, this.view.activeScene.bounds, this.view.viewport),
        );
    }
  };
  worldLayer = () => {
    this.view.ctx.setTransform(
      this.view.dpr * this.view.camera.zoom,
      0,
      0,
      this.view.dpr * this.view.camera.zoom,
      this.view.dpr * this.view.camera.tx,
      this.view.dpr * this.view.camera.ty,
    );

    const layer = this.view.cache.staticFor(),
      b = layer.bounds,
      A = this.view.resources.artPainters(),
      stationArt = A !== this.view.office?.painters,
      ambient = this.view.fx && this.view.decor && stationArt;

    // Magnified office art keeps crisp pixel outlines; smaller buckets use smoothing.
    if (!stationArt)
      this.view.ctx.imageSmoothingEnabled =
        this.view.camera.zoom * this.view.dpr <= layer.resolution;

    this.view.ctx.drawImage(layer.canvas, b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY);
    this.paintTethers();

    if (!stationArt)
      this.view.ctx.imageSmoothingEnabled = this.view.camera.zoom * this.view.dpr < 1;
    return { A, stationArt, ambient };
  };
  private paintTethers(): void {
    const actors = new Map(this.view.actors.map((actor) => [actor.id, actor]));
    const ctx = this.view.ctx;
    for (const worker of this.view.activeScene.workers) {
      const connector = worker.connector,
        actor = actors.get(worker.id);
      if (
        !connector ||
        !actor ||
        !(Math.hypot(actor.point.x - worker.chair.x, actor.point.y - worker.chair.y) <= 0.001)
      )
        continue;
      const from = P(connector.from),
        to = P(connector.to);
      ctx.save();
      ctx.globalAlpha = TETHER.alpha;
      ctx.strokeStyle = worker.accent;
      ctx.lineWidth = TETHER.width;
      ctx.setLineDash(TETHER.dash);
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
      ctx.restore();
    }
  }
  radar = (now: number, animate: boolean) => {
    {
      const mail = this.view.activeScene.mail;
      const t = mail.tower,
        top = { x: t.x + t.w / 2, y: t.y + t.h / 2, z: 3.2 },
        at = P(top);
      const sweep = animate ? (now / 20000) * Math.PI * RADAR.halfTurns : 0.6;
      this.view.ctx.strokeStyle = this.view.C.rail;
      this.view.ctx.lineWidth = 2;
      this.view.ctx.beginPath();
      this.view.ctx.moveTo(at.x, at.y);
      this.view.ctx.lineTo(at.x, at.y - RADAR.beam);
      this.view.ctx.stroke();
      this.view.ctx.lineWidth = 1;
      this.view.ctx.fillStyle = this.view.C["radar-sweep"];
      this.view.ctx.beginPath();
      this.view.ctx.ellipse(
        at.x,
        at.y - RADAR.lift,
        RADAR.beam * Math.abs(Math.cos(sweep)) + RADAR.minBeam,
        RADAR.thickness,
        0,
        0,
        RADAR.turn,
      );
      this.view.ctx.fill();
      if (this.view.decor)
        this.view.geometry.glow({ ...top, z: RADAR.glowHeight }, RADAR.glowRadius, {
          color: this.view.C.amber,
          alpha: animate
            ? RADAR.glowBase +
              RADAR.glowRange *
                Math.max(0, Math.sin((now / RADAR.glowPeriod) * Math.PI * RADAR.halfTurns))
            : RADAR.glowBase,
          transparent: this.view.C["glow-transparent"],
        });
    }
  };
  measureVisibleArea = () => {
    const zoom = this.view.camera.zoom;
    this.view.visibleArea = {
      left: -this.view.camera.tx / zoom,
      top: -this.view.camera.ty / zoom,
      right: (this.view.viewport.width - this.view.camera.tx) / zoom,
      bottom: (this.view.viewport.height - this.view.camera.ty) / zoom,
    };
  };
  paintItems = (options: {
    A: ArtPainters<R>;
    now: number;
    animate: boolean;
    ambient: boolean;
  }) => {
    const { A, now, animate } = options;
    const { items, staleKeys } = this.items.collect(options);
    items.push(
      ...this.items.observatory(A, now, animate),
      ...this.items.partitions(A),
      ...this.items.aprons(A),
    );

    items.sort((a, b) => a.depth - b.depth || (a.tie || "").localeCompare(b.tie || ""));

    for (const item of items) item.draw();
    return staleKeys;
  };
}

const PROJECTED_UNIT = Scene.project({ x: 1, y: 0 });
const HEIGHT_UNIT = -Scene.project({ x: 0, y: 0, z: 1 }).y;
