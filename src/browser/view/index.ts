import type { ThemeDefault } from "../../shared/theme.js";
import type { SpriteResource } from "../sprites/types.js";
import { ViewRuntime } from "./runtime.js";
import type { ViewOptions, ViewThemeStatus } from "./types.js";
export function createViewFactory(defaults: ThemeDefault, themeStatus: ViewThemeStatus) {
  return {
    create<R extends SpriteResource, B extends R = R>(options: ViewOptions<R, B>) {
      const view = new ViewRuntime<R, B>({ defaults, themeStatus }, options);
      return instanceFor(view);
    },
  };
}

function instanceFor<R extends SpriteResource, B extends R>(view: ViewRuntime<R, B>) {
  return {
    update: view.update,
    focus: view.cameraControl.focus,
    focusPlatform: view.cameraControl.focusPlatform,
    overview: view.cameraControl.overview,
    zoomBy: view.cameraControl.zoomBy,
    start: view.lifecycle.start,
    stop: view.lifecycle.stop,
    paint: view.framePaint.paint,
    limits: view.cameraControl.limits,
    invalidate: view.lifecycle.invalidate,
    setFx: view.lifecycle.setFx,
    setStartupAnimation: view.lifecycle.setStartupAnimation,
    fx: () => view.fx,
    camera: () => ({ ...view.camera }),
    mode: () => view.mode,
    platform: () => view.platform,
    hitRegions: () => view.regions.map((region) => ({ ...region })),
    hovered: () => view.hovered,
    cacheBuilds: () => view.staticLayer?.builds ?? 0,
    running: () => view.running,
    titleRegions: () => view.titleRegions.map((region) => ({ ...region })),
    signRegions: () => view.signRegions.map((region) => ({ ...region })),
    attentionRegions: () => view.attentionRegions.map((region) => ({ ...region })),
  };
}
