import type { ThemeDefault } from "../../shared/theme.js";
import type { SpriteResource } from "../sprites/types.js";
import { paintAttention } from "./attention.js";
import { CORNER_KINDS, WALL_KINDS, wallUnits } from "./furnishing.js";
import {
  cacheResolution,
  CREW_HEIGHT,
  idleFilter,
  LOD,
  lodFor,
  needsAttention,
  placePlates,
  SPRITE_SCALE,
  stackEnvelopes,
  stagePlates,
  statusSignature,
} from "./helpers.js";
import { palette, resolveLook } from "./look.js";
import { officeFurnishing } from "./office-furnishing.js";
import { paintersFor } from "./painters.js";
import { visibleFaces } from "./primitives.js";
import { ViewRuntime } from "./runtime.js";
import type { Colors, ViewContext, ViewOptions, ViewThemeStatus } from "./types.js";
export function createViewFactory(defaults: ThemeDefault, themeStatus: ViewThemeStatus) {
  const look = resolveLook(undefined, defaults);
  const art = paintersFor(look);
  return {
    ...VIEW_HELPERS,
    visibleFaces,
    officeFurnishing,
    wallUnits,
    WALL_KINDS,
    CORNER_KINDS,
    PALETTE: palette(defaults.scene.colors),
    STATUS: look.status,
    furnishing: art.furnishing,
    furnishings: art.furnishings,
    paintDesk: art.paintDesk,
    paintHelperDesk: art.paintHelperDesk,
    paintAttention<R extends SpriteResource>(
      ctx: ViewContext<R>,
      x: number,
      bottom: number,
      colors: Colors = defaults.scene.colors,
    ) {
      return paintAttention(ctx, x, bottom, colors);
    },
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

export { browserViewEnvironment } from "./native.js";
export type { BrowserResource } from "./native.js";

const VIEW_HELPERS = {
  needsAttention,
  idleFilter,
  lodFor,
  cacheResolution,
  statusSignature,
  placePlates,
  stagePlates,
  stackEnvelopes,
  LOD,
  SPRITE_SCALE,
  CREW_HEIGHT,
};
