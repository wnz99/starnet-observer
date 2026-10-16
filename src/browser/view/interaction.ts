import { PointerGestures } from "./pointer-gestures.js";
import type { Listener, Tap } from "./state-types.js";
import * as Scene from "../scene/index.js";
import type { Point } from "../scene/types.js";
import type { SpriteResource } from "../sprites/types.js";
import { ZOOM_STEP } from "./helpers.js";
import type { ViewEvent } from "./types.js";
import type { ViewRuntime } from "./runtime.js";
import { present as required } from "./values.js";
const GESTURE = { doubleClickPause: 500, wheelScale: 0.0015, keyStep: 48 };

export class Interaction<R extends SpriteResource, B extends R = R> {
  readonly gestures;
  tap: Tap | null = null;
  readonly TAP_SLOP = 10;
  readonly TAP_MS = 800;
  constructor(readonly view: ViewRuntime<R, B>) {
    this.gestures = new PointerGestures(view, this);
  }

  titleAt = (point: Point) =>
    this.paintedFrameCurrent()
      ? this.view.titleRegions.find(
          (r) =>
            point.x >= r.left &&
            point.x <= r.left + r.width &&
            point.y >= r.top &&
            point.y <= r.top + r.height,
        )?.id || null
      : null;

  shipAt = (point: Point) => {
    if (!this.view.callbacks.onShip || !this.paintedFrameCurrent()) return null;
    const label = this.view.shipRegions.find(
      (r) =>
        point.x >= r.left &&
        point.x <= r.left + r.width &&
        point.y >= r.top &&
        point.y <= r.top + r.height,
    );
    if (label) return label;
    const floor = Scene.fromScreen(point, this.view.camera);
    // Remote ships first: the flagship hull is large and must not swallow a click on a docked ship's floor.
    const ships = ((this.view.scene && this.view.activeScene.ships) || [])
      .filter((ship) => !ship.shadow)
      .slice()
      .sort((a, b) => Number(a.local) - Number(b.local));
    const hit = ships.find(
      (ship) =>
        floor.x >= ship.rect.x &&
        floor.x <= ship.rect.x + ship.rect.w &&
        floor.y >= ship.rect.y &&
        floor.y <= ship.rect.y + ship.rect.h,
    );
    return hit ? { host: hit.local ? null : hit.id } : null;
  };

  observatoryAt = (point: Point) =>
    this.paintedFrameCurrent() &&
    this.view.observatoryRegion &&
    point.x >= this.view.observatoryRegion.left &&
    point.x <= this.view.observatoryRegion.left + this.view.observatoryRegion.width &&
    point.y >= this.view.observatoryRegion.top &&
    point.y <= this.view.observatoryRegion.top + this.view.observatoryRegion.height;

  paintedFrameCurrent = () =>
    !!this.view.plateFrame &&
    this.view.plateFrame.scene === this.view.scene &&
    this.view.plateFrame.zoom === this.view.camera.zoom &&
    this.view.plateFrame.tx === this.view.camera.tx &&
    this.view.plateFrame.ty === this.view.camera.ty;

  signAt = (point: Point) => {
    if (!this.paintedFrameCurrent()) return null;
    return (
      this.view.signRegions.find(
        (r) =>
          point.x >= r.left &&
          point.x <= r.left + r.width &&
          point.y >= r.top &&
          point.y <= r.top + r.height,
      )?.repo || null
    );
  };

  sameTap = (point: Point) => {
    const tap = this.tap;
    return !!tap && Math.hypot(point.x - tap.point.x, point.y - tap.point.y) <= this.TAP_SLOP;
  };

  private targetsAt(point: Point) {
    const title = this.titleAt(point);
    if (title) return { id: null, title, sign: null, obs: false, ship: null };
    const id = Scene.hitTest(point, this.view.regions);
    if (id) return { id, title, sign: null, obs: false, ship: null };
    const sign = this.signAt(point);
    if (sign) return { id, title, sign, obs: false, ship: null };
    const obs = this.observatoryAt(point);
    return { id, title, sign, obs, ship: obs ? null : this.shipAt(point) };
  }
  select(point: Point) {
    const repeat = this.sameTap(point) && this.view.clock() - required(this.tap).at <= this.TAP_MS;
    const target = repeat ? required(this.tap) : this.targetsAt(point);
    const { id, title, sign, obs, ship } = target;
    if (!repeat) this.toggleTargets(target);
    this.tap = { id, title, sign, obs, ship, point, at: this.view.clock() };
    if (id && this.view.workerIndex.has(id)) this.view.callbacks.onSelect(id);
  }

  private toggleTargets(target: ReturnType<Interaction<R, B>["targetsAt"]>) {
    const { title, sign, obs, ship } = target;
    if (ship) this.view.callbacks.onShip?.(ship.host);
    if (title && this.view.workerIndex.has(title)) this.view.callbacks.onTitleToggle(title);
    if (sign) this.view.onRepositoryToggle(sign);
    if (obs) this.view.callbacks.onObservatory();
  }

  doubleClick = (event: ViewEvent) => {
    if (
      !this.view.scene ||
      this.view.clock() - this.gestures.lastMovedAt < GESTURE.doubleClickPause
    )
      return;
    event.preventDefault?.();
    const point = this.gestures.local(event),
      known = this.sameTap(point) ? this.tap : null;
    this.tap = null;
    if (this.handledDoubleClick(known)) return; // a title, sign or observatory double-click already acted once; it never zooms
    // The clicks' own target decides; only a double-click with no recorded click hit-tests the current view.
    const id = this.doubleClickWorker(point, known);
    if (id) {
      this.view.callbacks.onSelect(id);
      return;
    }
    if (known && known.id) return; // its worker left: never substitute the floor now under the old point
    this.focusPlatformAt(point);
  };

  private focusPlatformAt(point: Point) {
    const key = Scene.hitPlatform(point, this.view.activeScene, this.view.camera);
    if (key && this.view.cameraControl.focusPlatform(key)) this.view.callbacks.onPlatform(key);
  }
  private handledDoubleClick(known: Tap | null) {
    return known && (known.title || known.sign || known.obs);
  }
  private doubleClickWorker(point: Point, known: Tap | null) {
    return known
      ? known.id && this.view.workerIndex.has(known.id)
        ? known.id
        : null
      : Scene.hitTest(point, this.view.regions);
  }
  wheel = (event: ViewEvent) => {
    event.preventDefault?.();
    this.view.cameraControl.zoomBy(
      Math.exp(-(event.deltaY ?? 0) * GESTURE.wheelScale),
      this.gestures.local(event),
    );
  };

  keyDown = (event: ViewEvent) => {
    const step = GESTURE.keyStep,
      keys: Partial<Record<string, () => void>> = {
        ArrowLeft: () => {
          this.view.cameraControl.panBy({ x: step, y: 0 });
        },
        ArrowRight: () => {
          this.view.cameraControl.panBy({ x: -step, y: 0 });
        },
        ArrowUp: () => {
          this.view.cameraControl.panBy({ x: 0, y: step });
        },
        ArrowDown: () => {
          this.view.cameraControl.panBy({ x: 0, y: -step });
        },
        "+": () => {
          this.view.cameraControl.zoomBy(ZOOM_STEP);
        },
        "=": () => {
          this.view.cameraControl.zoomBy(ZOOM_STEP);
        },
        "-": () => {
          this.view.cameraControl.zoomBy(1 / ZOOM_STEP);
        },
        0: this.view.cameraControl.overview,
        o: this.view.callbacks.onObservatory,
        O: this.view.callbacks.onObservatory,
      };
    if (!keys[event.key ?? ""] || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault?.();
    keys[event.key ?? ""]?.();
  };
  get listeners(): Listener[] {
    return [
      ["pointerdown", this.gestures.pointerDown],
      ["pointermove", this.gestures.pointerMove],
      ["pointerup", this.gestures.pointerUp],
      ["pointercancel", this.gestures.pointerCancel],
      ["pointerleave", this.gestures.pointerLeave],
      ["wheel", this.wheel, { passive: false }],
      ["keydown", this.keyDown],
      ["dblclick", this.doubleClick],
    ];
  }
  refreshHover() {
    this.gestures.updateHover();
  }
  reset() {
    this.gestures.reset();
    this.tap = null;
  }
}
