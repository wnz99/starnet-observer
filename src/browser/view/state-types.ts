import type { ThemeSceneColor } from "../../shared/theme-keys.js";
import type * as OfficeArt from "../office-art.js";
import type { Bounds, Point } from "../scene/types.js";
import type { SpriteBody, SpriteResource } from "../sprites/types.js";
import type { ArtPainters, InputName, ViewCanvas, ViewEvent } from "./types.js";
export interface Tap {
  id: string | null;
  title: string | null;
  sign: string | null;
  obs: boolean | null;
  ship: { host: string | null } | null;
  point: Point;
  at: number;
}
export interface Drag {
  start: Point;
  last: Point;
  moved: boolean;
  at: number;
  touch: boolean;
}
export interface StaticLayer<R extends SpriteResource> {
  key: string;
  canvas: ViewCanvas<R> & R;
  resolution: number;
  bounds: Bounds;
  builds: number;
}
export interface Readiness {
  job: PromiseLike<unknown>;
  settled: boolean;
}
export interface OfficeState<R extends SpriteResource> {
  state: "pending" | "ready" | "failed";
  composition: ReturnType<typeof OfficeArt.create<R>> | null;
  painters?: ArtPainters<R>;
}
export interface PlainStar {
  x: number;
  y: number;
  size: number;
  a: number;
  twinkle: boolean;
  period: number;
}
export interface Star extends PlainStar {
  depth: number;
  tint: ThemeSceneColor;
  phase: number;
  ray?: number;
}
export interface Nebula {
  x: number;
  y: number;
  r: number;
  hue: ThemeSceneColor;
  a: number;
}
export interface Starfield {
  far: Star[];
  mid: Star[];
  bright: Star[];
  nebulae: Nebula[];
}
export interface Pixie {
  x: number;
  y: number;
  vx: number;
  vy: number;
  amp: number;
  period: number;
  phase: number;
  r: number;
  tint: ThemeSceneColor;
  blink: number;
}
export interface DepthItem {
  depth: number;
  tie?: string;
  draw: () => void;
}
export type Listener = [InputName, (event: ViewEvent) => void, { passive: boolean }?];

export interface SparkOptions {
  count?: number;
  color?: string;
  alt?: string | null;
  rise?: number;
  spread?: number;
  life?: number;
  size?: number;
  gravity?: number;
}

export type ViewBody<R extends SpriteResource> = Omit<SpriteBody<R>, "skin"> & { skin: string };
