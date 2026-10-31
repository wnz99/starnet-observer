import type { SpriteResource } from "../sprites/types.js";
import type { ViewOptions } from "./types.js";
export function callbacksFor<R extends SpriteResource, B extends R>(options: ViewOptions<R, B>) {
  return { ...selectionCallbacks(options), ...appearanceCallbacks(options) };
}
function selectionCallbacks<R extends SpriteResource, B extends R>(options: ViewOptions<R, B>) {
  return {
    onSelect: options.onSelect ?? (() => {}),
    onTitleToggle: options.onTitleToggle ?? (() => {}),
    onPlatform: options.onPlatform ?? (() => {}),
    onObservatory: options.onObservatory ?? (() => {}),
    onMailroom: options.onMailroom ?? null,
    onMode: options.onMode ?? (() => {}),
    onCamera: options.onCamera ?? (() => {}),
    onShip: options.onShip ?? null,
    hostSelection: options.hostSelection ?? (() => undefined),
  };
}
function appearanceCallbacks<R extends SpriteResource, B extends R>(options: ViewOptions<R, B>) {
  return {
    hoverLabel: options.hoverLabel ?? (() => null),
    nameFor: options.nameFor ?? (() => ""),
    reducedMotion: options.reducedMotion ?? (() => false),
    idleLevel: options.idleLevel ?? (() => 0),
    idleVigour: options.idleVigour ?? (() => 1),
  };
}
