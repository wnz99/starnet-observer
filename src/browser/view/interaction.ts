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

  badgeAt = (point: Point) =>
    this.paintedFrameCurrent()
      ? (this.view.badgeRegions.find(
          (region) =>
            point.x >= region.left &&
            point.x <= region.left + region.width &&
            point.y >= region.top &&
            point.y <= region.top + region.height,
        ) ?? null)
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
    this.view.plateFrame.selectedRepo === this.view.repositorySelection() &&
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

  nearTap = (point: Point) => {
    const tap = this.tap;
    return !!tap && Math.hypot(point.x - tap.point.x, point.y - tap.point.y) <= this.TAP_SLOP;
  };

  private targetsAt(point: Point): Omit<Tap, "point"> {
    const title = this.titleAt(point);
    if (title) return { id: null, title, sign: null, platform: null, obs: false, ship: null };
    const sign = this.signAt(point);
    const platform = this.paintedFrameCurrent()
      ? (this.view.platformRegions.find(
          (r) =>
            point.x >= r.left &&
            point.x <= r.left + r.width &&
            point.y >= r.top &&
            point.y <= r.top + r.height,
        )?.id ?? null)
      : null;
    if (platform) return { id: null, title, sign, platform, obs: false, ship: null };
    const id = Scene.hitTest(point, this.view.regions);
    if (id) return { id, title, sign: null, platform: null, obs: false, ship: null };
    const mail = this.mailroomAt(point);
    if (mail) return { id, title, sign, platform, obs: false, ship: null, mail };
    const obs = this.observatoryAt(point);
    return { id, title, sign, platform, obs, ship: obs ? null : this.shipAt(point) };
  }
  private mailroomAt(point: Point) {
    if (!this.view.callbacks.onMailroom || !this.paintedFrameCurrent()) return null;
    const floor = Scene.fromScreen(point, this.view.camera);
    const scene = this.view.activeScene;
    const rooms = scene.ships?.length
      ? scene.ships
          .filter((ship) => !ship.shadow && ship.mail)
          .map((ship) => ({ host: ship.local ? null : ship.id, mail: ship.mail }))
      : [{ host: null, mail: scene.mail }];
    return (
      rooms.find(
        ({ mail }) =>
          mail &&
          floor.x >= mail.rect.x &&
          floor.x <= mail.rect.x + mail.rect.w &&
          floor.y >= mail.rect.y &&
          floor.y <= mail.rect.y + mail.rect.h,
      ) ?? null
    );
  }
  click = (event: ViewEvent) => {
    const point = this.gestures.completedClick;
    this.gestures.completedClick = null;
    if (point) this.select(point, (event.detail ?? 1) > 1);
  };

  select(point: Point, continuation = false) {
    const repeat = continuation && this.nearTap(point);
    const target = repeat ? required(this.tap) : this.targetsAt(point);
    const { id } = target;
    if (!repeat) this.toggleTargets(target);
    if (!repeat) this.tap = { ...target, point };
    if (id && this.view.workerIndex.has(id)) this.view.callbacks.onSelect(id);
  }

  private toggleTargets(target: Omit<Tap, "point">) {
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
      known = this.nearTap(point) ? this.tap : null;
    this.tap = null;
    if (this.handledDoubleClick(point, known)) return;
    // The clicks' own target decides; only a double-click with no recorded click hit-tests the current view.
    const id = this.doubleClickWorker(point, known);
    if (id) {
      this.view.callbacks.onSelect(id);
      return;
    }
    if (known && known.id) return; // its worker left: never substitute the floor now under the old point
    this.focusPlatformAt(point);
  };
  private mailDoubleClick(point: Point, known: Tap | null) {
    const mail = known ? known.mail : this.mailroomAt(point);
    if (!mail) return false;
    this.view.callbacks.onMailroom?.(mail.host);
    return true;
  }

  private focusPlatformAt(point: Point) {
    const key = Scene.hitPlatform(point, this.view.activeScene, this.view.camera);
    if (key) this.focusPlatform(key);
  }
  private focusPlatform(key: string) {
    const scene = this.view.activeScene;
    if (!scene.platforms.some((platform) => platform.key === key)) return;
    if (this.view.mode === "platform" && this.view.platform === key) {
      this.view.cameraControl.overview();
      return;
    }
    if (this.view.cameraControl.focusPlatform(key)) this.view.callbacks.onPlatform(key);
  }
  private handledDoubleClick(point: Point, known: Tap | null) {
    if (this.mailDoubleClick(point, known)) return true;
    const target = known ?? this.targetsAt(point);
    if (target.platform) {
      this.focusPlatform(target.platform);
      return true;
    }
    return !!(target.title || target.sign || target.obs);
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
      ["click", this.click],
      ["wheel", this.wheel, { passive: false }],
      ["keydown", this.keyDown],
      ["dblclick", this.doubleClick],
    ];
  }
  refreshHover() {
    this.gestures.updateHover();
  }
  refreshBadgeHover() {
    this.gestures.updateBadgeHover();
  }
  reset() {
    this.gestures.reset();
    this.tap = null;
  }
}
