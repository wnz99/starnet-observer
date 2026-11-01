import type { SpriteInit, SpriteResource } from "../sprites/types.js";
import type { createModel } from "../model.js";
import type { QuerySnapshot, QuerySpec } from "../queryspine/types.js";
import type { Scene } from "../scene/types.js";
import type { ThemeDocument, RuntimeThemeWarning } from "../theme/dom.js";
import type { UpdateOptions, ViewOptions, ViewSprites } from "../view/types.js";
import type { AppClock, AppDocument, AppNode, AppScheduler, AppWindow } from "./dom.js";

export interface AppView {
  update(scene: Scene, options: UpdateOptions): void;
  focus(id: string): void;
  focusPlatform(key: string): void;
  overview(): void;
  zoomBy(scale: number): void;
  start(): void;
  stop(): void;
  invalidate(): void;
  setFx?(on: boolean): void;
  setStartupAnimation?(on: boolean): void;
  fx?(): boolean;
}
export interface AppQuery {
  define(key: string, spec: QuerySpec): unknown;
  subscribe(
    key: string,
    listener: (snapshot: QuerySnapshot) => void,
    options?: { immediate?: boolean; refresh?: boolean },
  ): () => void;
  invalidate(key: string, options?: { refresh?: boolean }): unknown;
  dispose(): void;
}
export interface AppTheme {
  start(snapshot: unknown, document: ThemeDocument): unknown;
  reportWarning(warning: RuntimeThemeWarning): void;
  reportNotice(code: string, message?: string | null): void;
  dispose(): void;
}
export interface AppSprites<R extends SpriteResource, B extends R = R> extends ViewSprites<R, B> {
  init(options: SpriteInit): unknown;
}
interface JsonResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}
export interface MountOptions<N extends AppNode, R extends SpriteResource, B extends R = R> {
  document: AppDocument<N, R>;
  window: AppWindow<R, B>;
  fetch(path: string, options: RequestInit): Promise<JsonResponse>;
  clock: AppClock;
  scheduler: AppScheduler;
  sprites: AppSprites<R, B>;
  /* Original UI tests observe the View/Query composition boundary. Native callers use the actual factories. */
  collaborators?: {
    createView?: (options: ViewOptions<R, B>) => AppView;
    query?: AppQuery;
    theme?: AppTheme;
    model?: ReturnType<typeof createModel>;
  };
}
export interface ObserverApp {
  dispose(): void;
}
