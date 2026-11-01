import * as Scene from "../scene/index.js";
import type { Camera, Point } from "../scene/types.js";
import type { SpriteResource } from "../sprites/types.js";
import type { ViewRuntime } from "./runtime.js";
import { present as required } from "./values.js";
const ZOOM_LIMIT = { maxFactor: 1e6, minFactor: 1e-6 };
const HALVES = 2;

export class CameraControl<R extends SpriteResource, B extends R = R> {
  constructor(readonly view: ViewRuntime<R, B>) {}
  private assemblyCamera: { start: Camera; end: Camera; at: number; elapsed: number } | null = null;
  private readonly assemblyDuration = 2800;
  beginAssemblyCamera(now: number) {
    const scene = this.view.activeScene,
      rect = scene.mail.rect;
    this.assemblyCamera = {
      start: Scene.focus(
        { x: rect.x + rect.w / HALVES, y: rect.y + rect.h / HALVES },
        scene.bounds,
        this.view.viewport,
      ),
      end: Scene.fit(scene.bounds, this.view.viewport),
      at: now,
      elapsed: 0,
    };
    this.advanceAssemblyCamera(now);
  }
  advanceAssemblyCamera(now: number) {
    const camera = this.assemblyCamera;
    if (!camera) return;
    camera.elapsed = Math.max(camera.elapsed, Math.min(this.assemblyDuration, now - camera.at));
    const t = camera.elapsed / this.assemblyDuration,
      eased = t * t * (3 - 2 * t);
    const zoom = camera.start.zoom + (camera.end.zoom - camera.start.zoom) * eased;
    const middle = this.viewportCenter();
    const center = (axis: "x" | "y", offset: "tx" | "ty") => {
      const start = (middle[axis] - camera.start[offset]) / camera.start.zoom;
      const end = (middle[axis] - camera.end[offset]) / camera.end.zoom;
      return middle[axis] - (start + (end - start) * eased) * zoom;
    };
    this.setCamera({ zoom, tx: center("x", "tx"), ty: center("y", "ty") });
    if (camera.elapsed === this.assemblyDuration) this.assemblyCamera = null;
  }
  finishAssemblyCamera() {
    if (!this.assemblyCamera) return;
    const end = this.assemblyCamera.end;
    this.assemblyCamera = null;
    this.setCamera(end);
  }

  private viewportCenter() {
    return { x: this.view.viewport.width / 2, y: this.view.viewport.height / 2 };
  }
  pointOf = (id: string | null) => {
    const actor = this.view.actors.find((value) => value.id === id);
    return actor ? actor.point : null;
  };

  setMode = (next: string, key: string | null = null) => {
    if (next === this.view.mode && key === this.view.platform) return;
    this.view.mode = next;
    this.view.platform = key;
    this.view.callbacks.onMode({ mode: this.view.mode, platform: this.view.platform });
  };

  measure = () => {
    const width = this.view.canvas.clientWidth || this.view.canvas.width || 1,
      height = this.view.canvas.clientHeight || this.view.canvas.height || 1,
      ratio = this.view.dprOf();
    if (
      width === this.view.viewport.width &&
      height === this.view.viewport.height &&
      ratio === this.view.dpr
    )
      return false;
    this.view.lifecycle.completeAssembly();
    this.view.viewport = { width, height };
    this.view.dpr = ratio;
    this.view.canvas.width = Math.max(1, Math.round(width * this.view.dpr));
    this.view.canvas.height = Math.max(1, Math.round(height * this.view.dpr));
    this.view.stars = null;
    this.reframe();
    return true;
  };

  limits = () => {
    if (!this.view.scene) return { canZoomIn: false, canZoomOut: false };
    const middle = this.viewportCenter();
    return {
      canZoomIn:
        this.view.camera.zoom <
        Scene.zoomAt(
          this.view.camera,
          middle,
          ZOOM_LIMIT.maxFactor,
          this.view.activeScene.bounds,
          this.view.viewport,
        ).zoom -
          ZOOM_LIMIT.minFactor,
      canZoomOut:
        this.view.camera.zoom >
        Scene.zoomAt(
          this.view.camera,
          middle,
          ZOOM_LIMIT.minFactor,
          this.view.activeScene.bounds,
          this.view.viewport,
        ).zoom +
          ZOOM_LIMIT.minFactor,
    };
  };

  setCamera = (next: Camera) => {
    const moved =
      next.zoom !== this.view.camera.zoom ||
      next.tx !== this.view.camera.tx ||
      next.ty !== this.view.camera.ty;
    this.view.camera = next;
    const now = this.limits();
    if (
      !this.view.reported ||
      now.canZoomIn !== this.view.reported.canZoomIn ||
      now.canZoomOut !== this.view.reported.canZoomOut
    ) {
      this.view.reported = now;
      this.view.callbacks.onCamera(now);
    }
    if (moved) this.view.lifecycle.invalidate();
  };

  reframe = () => {
    if (!this.view.scene) return;
    const worker = this.view.focused && this.view.workerIndex.get(this.view.focused),
      fitted =
        this.view.mode === "platform" &&
        Scene.focusPlatform(
          this.view.activeScene,
          required(this.view.platform),
          this.view.viewport,
        );
    if (this.view.mode === "focus" && worker)
      this.setCamera(
        Scene.focus(
          this.pointOf(this.view.focused) || worker.chair,
          this.view.activeScene.bounds,
          this.view.viewport,
        ),
      );
    else if (fitted) this.setCamera(fitted);
    else if (this.view.mode === "manual")
      this.setCamera(
        Scene.pan(
          this.view.camera,
          { x: 0, y: 0 },
          this.view.activeScene.bounds,
          this.view.viewport,
        ),
      );
    else {
      this.setMode("overview");
      this.setCamera(Scene.fit(this.view.activeScene.bounds, this.view.viewport));
    }
  };

  focus = (id: string) => {
    this.view.lifecycle.completeAssemblyForInput();
    if (!this.view.scene) return;
    const worker = this.view.workerIndex.get(id);
    if (!worker) return;
    this.measure();
    this.view.focused = id;
    this.setMode("focus");
    this.setCamera(
      Scene.focus(
        this.pointOf(id) || worker.chair,
        this.view.activeScene.bounds,
        this.view.viewport,
      ),
    );
  };

  focusPlatform = (key: string) => {
    this.view.lifecycle.completeAssemblyForInput();
    if (!this.view.scene) return false;
    this.measure();
    const next = Scene.focusPlatform(this.view.activeScene, key, this.view.viewport);
    if (!next) return false;
    this.view.focused = null;
    this.setMode("platform", key);
    this.setCamera(next);
    return true;
  };

  overview = () => {
    this.view.lifecycle.completeAssemblyForInput();
    this.view.focused = null;
    this.setMode("overview");
    this.reframe();
  };

  zoomBy = (factor: number, at?: Point) => {
    this.view.lifecycle.completeAssemblyForInput();
    if (!this.view.scene) return;
    this.measure();
    this.setMode("manual");
    this.setCamera(
      Scene.zoomAt(
        this.view.camera,
        at || this.viewportCenter(),
        factor,
        this.view.activeScene.bounds,
        this.view.viewport,
      ),
    );
  };

  panBy = (delta: Point) => {
    this.view.lifecycle.completeAssemblyForInput();
    if (!this.view.scene) return;
    this.measure();
    this.setMode("manual");
    this.setCamera(
      Scene.pan(this.view.camera, delta, this.view.activeScene.bounds, this.view.viewport),
    );
  };
}
