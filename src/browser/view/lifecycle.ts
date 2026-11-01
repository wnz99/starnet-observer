import type { SpriteResource } from "../sprites/types.js";
import type { WatchTarget } from "./types.js";
import type { ViewRuntime } from "./runtime.js";
export class Lifecycle<R extends SpriteResource, B extends R = R> {
  constructor(readonly view: ViewRuntime<R, B>) {}
  startupEligible = false;
  private resourceWaitAt: number | null = null;
  private assemblyArt: string | null = null;
  private readonly resourceWaitMs = 500;

  advanceAssembly(now: number) {
    const view = this.view;
    if (!this.startupEligible) return view.assemblyFrame.active;
    if (this.canBeginAssembly() && this.beginAssembly(now)) return true;
    if (view.assembly.state === "playing") {
      if (view.callbacks.reducedMotion() || this.assemblyArt !== view.resources.artMode())
        this.completeAssembly();
      else view.cameraControl.advanceAssemblyCamera(now);
    }
    view.assemblyFrame = view.assembly.frame(now);
    if (!view.assemblyFrame.active && view.assembly.state === "complete") {
      this.resourceWaitAt = null;
      this.assemblyArt = null;
    }
    return view.assemblyFrame.active;
  }
  private canBeginAssembly() {
    return (
      this.view.assembly.state === "pending" &&
      this.view.running &&
      this.view.canvas.clientWidth > 0 &&
      this.view.canvas.clientHeight > 0
    );
  }
  private beginAssembly(now: number) {
    const view = this.view;
    if (!view.startupAnimation || view.callbacks.reducedMotion()) {
      view.assembly.complete();
      return false;
    }
    this.resourceWaitAt ??= now;
    if (view.office?.state === "pending" && now - this.resourceWaitAt < this.resourceWaitMs)
      return true;
    view.assembly.begin(view.activeScene, now);
    this.assemblyArt = view.resources.artMode();
    view.cameraControl.beginAssemblyCamera(now);
    return false;
  }

  completeAssembly = () => {
    if (this.view.assembly.state !== "playing" && this.resourceWaitAt === null) return false;
    this.view.assembly.complete();
    this.view.assemblyFrame = this.view.assembly.frame(this.view.clock());
    this.view.cameraControl.finishAssemblyCamera();
    this.resourceWaitAt = null;
    this.assemblyArt = null;
    this.view.plateFrame = null;
    this.invalidate();
    return true;
  };

  completeAssemblyForInput = () => {
    if (this.startupEligible && this.view.assembly.state === "pending") {
      this.view.assembly.complete();
      this.view.assemblyFrame = this.view.assembly.frame(this.view.clock());
      this.view.plateFrame = null;
    }
    this.completeAssembly();
    if (
      this.view.scene &&
      this.view.assembly.state === "complete" &&
      !this.view.interaction.paintedFrameCurrent()
    )
      this.view.framePaint.paint(this.view.clock());
  };

  private scheduled() {
    return this.view.frame !== null;
  }

  private shouldSchedule(animating: boolean | undefined) {
    return (animating || this.view.dirty) && this.view.running && !this.scheduled();
  }
  invalidate = () => {
    this.view.dirty = true;
    if (this.view.running && !this.scheduled()) this.view.frame = this.view.raf(this.loop);
  };

  loop = (now: number) => {
    this.view.frame = null;
    if (!this.view.running) return;
    this.view.dirty = false;
    const animating = this.view.framePaint.paint(now);
    if (this.shouldSchedule(animating)) this.view.frame = this.view.raf(this.loop);
  };

  start = () => {
    if (this.view.running) return;
    this.view.running = true;
    for (const [name, fn, options] of this.view.interaction.listeners)
      this.view.canvas.addEventListener(name, fn, options);
    const Observer = this.view.env.ResizeObserver || this.view.win.ResizeObserver;
    if (Observer && !this.view.observer) {
      this.view.observer = new Observer(() => {
        if (this.view.cameraControl.measure()) this.invalidate();
      });
      this.view.observer.observe(this.view.canvas);
    }
    this.watch();
    this.invalidate();
  };

  listen = (target: WatchTarget | null | undefined, name: string, fn: () => void) => {
    if (target) {
      target.addEventListener(name, fn);
      this.view.watchers.push(() => {
        target.removeEventListener(name, fn);
      });
    }
  };

  watch = () => {
    const media = (query: string) =>
      typeof this.view.win.matchMedia === "function" ? this.view.win.matchMedia(query) : null;
    this.listen(media("(prefers-reduced-motion: reduce)"), "change", this.invalidate);
    const ratio = () => {
      const query = media("(resolution: " + String(this.view.dprOf()) + "dppx)"),
        changed = () => {
          if (!this.view.running) return;
          query?.removeEventListener("change", changed);
          this.view.cameraControl.measure();
          this.invalidate();
          ratio();
        };
      this.listen(query, "change", changed);
    };
    ratio();
    const document = this.view.win.document;
    const fonts = document?.fonts;
    this.listen(fonts, "loadingdone", this.invalidate);
    if (fonts?.ready)
      fonts.ready.then(
        () => {
          if (this.view.running) this.invalidate();
        },
        () => {},
      );
  };

  stop = () => {
    this.completeAssembly();
    this.view.clearSettlements();
    if (!this.view.running) return;
    this.view.running = false;
    if (this.view.frame !== null) this.view.caf(this.view.frame);
    this.view.frame = null;
    this.view.dirty = false;
    for (const [name, fn, options] of this.view.interaction.listeners)
      this.view.canvas.removeEventListener(name, fn, options);
    if (this.view.observer) {
      this.view.observer.disconnect();
      this.view.observer = null;
    }
    while (this.view.watchers.length > 0) this.view.watchers.pop()?.();
    this.view.readiness.clear();
    this.view.interaction.reset();
    this.view.hovered = null;
    this.view.titleRegions = [];
    this.view.signRegions = [];
    this.view.platformRegions = [];
    this.view.shipRegions = [];
    this.view.attentionRegions = [];
    this.view.plateFrame = null;
  };

  setFx = (on: unknown) => {
    const enabled = !!on;
    if (enabled === this.view.fx) return this.view.fx;
    this.view.fx = enabled;
    this.invalidate();
    return this.view.fx;
  };
  setStartupAnimation = (on: boolean): void => {
    this.view.startupAnimation = on;
    if (!on) this.completeAssembly();
  };
}
