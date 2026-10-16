import type { ThemeCrew } from "../../shared/theme.js";
export interface SpriteResource {
  readonly width: number;
  readonly height: number;
}
export interface SpriteGradient {
  addColorStop(offset: number, color: string): void;
}
export interface SpriteContext<R extends SpriteResource> {
  readonly canvas?: SpriteResource | undefined;
  globalAlpha: number;
  globalCompositeOperation: GlobalCompositeOperation;
  fillStyle: string | CanvasGradient | CanvasPattern | SpriteGradient;
  imageSmoothingEnabled: boolean;
  imageSmoothingQuality: ImageSmoothingQuality;
  drawImage(source: R, x: number, y: number): void;
  drawImage(source: R, x: number, y: number, w: number, h: number): void;
  getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray };
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): SpriteGradient;
  isContextLost?(): boolean;
  getTransform?(): { a: number; b: number; c: number; d: number; e: number; f: number };
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  save(): void;
  restore(): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  translate(x: number, y: number): void;
  transform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  beginPath(): void;
  rect(x: number, y: number, w: number, h: number): void;
  clip(): void;
  ellipse(
    x: number,
    y: number,
    rx: number,
    ry: number,
    rotation: number,
    start: number,
    end: number,
  ): void;
  fill(): void;
}
export interface SpriteCanvas<R extends SpriteResource> extends SpriteResource {
  width: number;
  height: number;
  getContext(context: "2d", options?: { willReadFrequently: boolean }): SpriteContext<R> | null;
  addEventListener(event: string, callback: () => void): void;
}
export interface SpriteMetadata {
  readonly set?: string;
  readonly scale?: number;
  readonly sourceStandingHeight?: number;
  readonly presentation?: "review";
}
export interface SpriteCatalog {
  readonly DEFAULT_SKIN: string;
  readonly SKINS: Readonly<Record<string, SpriteMetadata>>;
}
export interface SpriteDependencies<I extends SpriteResource, C extends SpriteCanvas<I | C>> {
  readonly data: SpriteCatalog;
  readonly createCanvas: () => C;
  readonly loadImage: (path: string) => Promise<I | null>;
  readonly fetch: (
    path: string,
    options: { cache: "no-cache" },
  ) => Promise<{ ok: boolean; json(): Promise<unknown> }>;
  readonly log?: Pick<Console, "log" | "warn">;
}
export interface SpriteDegradation {
  skin: string;
  reason: "image-load" | "image-dimensions";
}
interface SpriteCrew extends Omit<ThemeCrew, "tracks"> {
  readonly tracks: Readonly<Record<string, readonly string[]>>;
}
export interface SpriteInit {
  crew?: Readonly<Record<string, SpriteCrew>>;
  onDegraded?: (warning: SpriteDegradation) => void;
}
export interface SpriteLight {
  readonly color: readonly number[];
  readonly strength: number;
  readonly dx: number;
  readonly dy: number;
}
export interface QuantizedLight extends SpriteLight {
  readonly key: string;
}
interface SpriteBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface SpriteAppearance {
  readonly group?: string | undefined;
  readonly reducedMotion?: boolean;
  readonly skipGroundShadow?: boolean;
  readonly light?: SpriteLight | null;
  readonly sampleLight?: (x: number, y: number) => SpriteLight | null;
  readonly shouldPaint?: (bounds: SpriteBounds) => boolean;
}
export interface SpriteIdentity {
  readonly id?: string;
  readonly skin?: string;
}
interface SpritePose<R extends SpriteResource> {
  key: string;
  f: R;
  x: number;
  y: number;
  px: number;
  py: number;
  w: number;
  h: number;
  at: number;
}
interface SpriteFade<R extends SpriteResource> {
  f: R;
  ox: number;
  oy: number;
  w: number;
  h: number;
  at: number;
}
export interface SpriteBody<R extends SpriteResource> extends SpriteIdentity {
  px: number;
  py: number;
  dir?: string;
  state?: string;
  aph?: number;
  phase?: number;
  odo?: number;
  faceA?: number;
  _resolvedTravelHeading?: number;
  _travelHeading?: number;
  _strideBlocked?: boolean;
  working?: boolean;
  sitting?: boolean;
  seated?: boolean;
  sleeping?: boolean;
  speaking?: boolean;
  hasCan?: boolean;
  seatLift?: number;
  goal?: string;
  noShadow?: boolean;
  glance?: { until: number; dir: string };
  meet?: { until: number };
  _rAt?: number;
  _rA?: number;
  _rW?: number;
  _turnAng?: number;
  _rD8?: string;
  _pose?: string;
  _renderTravelError?: number | null;
  _renderFrame?: number;
  _renderWalkTween?: number | null;
  _renderStandingHeight?: number | null;
  _speechAt?: number;
  _speechEase?: number;
  _renderSpeechAccent?: number;
  _renderGroundGap?: number;
  _renderCycleUnits?: number;
  _spriteGroup?: string;
  _poseLast?: SpritePose<R> | null;
  _poseFade?: SpriteFade<R> | null;
  _renderPoseFade?: number | null;
}
export interface ShadowOptions {
  lift?: number;
  spread?: number;
  alpha?: number;
  color?: string;
  direction?: { x: number; y: number };
}
export type SpriteFrames<I extends SpriteResource> = Record<string, I[]>;
