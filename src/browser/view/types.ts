import type { ThemeContents, ThemeDefault } from "../../shared/theme.js";
import type { OfficeImage } from "../office-art/types.js";
import type {
  Camera,
  Decoration,
  HitRegion,
  Point,
  PropExtent,
  Rect,
  Scene,
  Worker,
} from "../scene/types.js";
import type {
  SpriteAppearance,
  SpriteBody,
  SpriteContext,
  SpriteResource,
} from "../sprites/types.js";
import type { RuntimeThemeWarning } from "../theme/dom.js";
export type Colors = ThemeContents["scene"]["colors"];
type StatusColors = Pick<Colors, "working" | "blocked" | "idle" | "done" | "unknown">;
export interface Look {
  colors: Colors;
  status: StatusColors;
  backgroundFx: "rain" | "none";
  ambientFx: "station" | "none";
  art: "home-office" | "station";
}
export interface AppearanceTheme {
  effectiveId?: string;
  scene?: { colors?: Partial<Colors>; backgroundFx?: string; ambientFx?: string; art?: unknown };
}
export interface ViewThemeStatus {
  reportWarning(warning: RuntimeThemeWarning): void;
  reportNotice(code: string, message?: string | null): void;
}
export interface ViewContext<R extends SpriteResource> extends SpriteContext<R> {
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  lineCap: CanvasLineCap;
  lineDashOffset: number;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  filter?: string;
  createRadialGradient(
    x0: number,
    y0: number,
    r0: number,
    x1: number,
    y1: number,
    r1: number,
  ): CanvasGradient;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  stroke(): void;
  strokeRect(x: number, y: number, w: number, h: number): void;
  arc(x: number, y: number, r: number, start: number, end: number): void;
  roundRect?(x: number, y: number, w: number, h: number, r: number): void;
  scale(x: number, y: number): void;
  setLineDash(dash: number[]): void;
  measureText(text: string): { width: number };
  fillText(text: string, x: number, y: number): void;
}
export interface ViewEvent {
  detail?: number;
  clientX?: number;
  clientY?: number;
  pointerId?: number;
  pointerType?: string;
  deltaY?: number;
  key?: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  preventDefault?(): void;
}
export type InputName =
  | "pointerdown"
  | "pointermove"
  | "pointerup"
  | "pointercancel"
  | "pointerleave"
  | "click"
  | "wheel"
  | "keydown"
  | "dblclick";
export interface ViewCanvas<R extends SpriteResource> extends SpriteResource {
  width: number;
  height: number;
  readonly clientWidth: number;
  readonly clientHeight: number;
  style: { cursor?: string };
  getContext(context: "2d"): ViewContext<R> | null;
  getBoundingClientRect(): { left: number; top: number };
  setPointerCapture?(id: number): void;
  addEventListener(
    name: InputName,
    fn: (event: ViewEvent) => void,
    options?: { passive?: boolean; capture?: boolean },
  ): void;
  removeEventListener(
    name: InputName,
    fn: (event: ViewEvent) => void,
    options?: { passive?: boolean; capture?: boolean },
  ): void;
}
export interface WatchTarget {
  addEventListener(name: string, callback: () => void): void;
  removeEventListener(name: string, callback: () => void): void;
}
interface ViewWindow<R extends SpriteResource> {
  requestAnimationFrame?(callback: (now: number) => void): number;
  cancelAnimationFrame?(id: number): void;
  readonly devicePixelRatio?: number;
  matchMedia?(query: string): WatchTarget;
  document?: {
    createElement?(name: "canvas"): ViewCanvas<R> & R;
    fonts?: WatchTarget & { ready?: PromiseLike<unknown> };
  };
  Image?: new () => OfficeImage & R;
  ResizeObserver?: new (callback: () => void) => ViewObserver<R>;
}
export interface ViewObserver<R extends SpriteResource> {
  observe(canvas: ViewCanvas<R>): void;
  disconnect(): void;
}
export interface BodyExtent {
  top: number;
  w: number;
  h: number;
  painted?: boolean | undefined;
  fallback?: boolean;
}
export interface ViewSprites<R extends SpriteResource, B extends R = R> {
  drawBody?(
    ctx: ViewContext<R>,
    body: SpriteBody<B>,
    now: number,
    appearance: SpriteAppearance,
  ): BodyExtent | null;
  ensureSkin?(skin: string): PromiseLike<unknown> | null;
  replacementState?(skin: string): string;
}
export interface ViewEnvironment<R extends SpriteResource, B extends R = R> {
  window?: ViewWindow<R>;
  raf?: (callback: (now: number) => void) => number;
  caf?: (id: number) => void;
  dpr?: () => number;
  createCanvas?: (w: number, h: number) => ViewCanvas<R> & R;
  sprites?: ViewSprites<R, B> | null;
  themeStatus?: ViewThemeStatus;
  Image?: new () => OfficeImage & R;
  ResizeObserver?: new (callback: () => void) => ViewObserver<R>;
  now?: () => number;
}
export interface ViewOptions<R extends SpriteResource, B extends R = R> {
  theme?: AppearanceTheme | null;
  canvas: ViewCanvas<R>;
  onSelect?: (id: string) => void;
  onTitleToggle?: (id: string) => void;
  onPlatform?: (key: string) => void;
  onObservatory?: () => void;
  onMailroom?: (host: string | null) => void;
  onShip?: ((host: string | null) => void) | null;
  hostSelection?: () => string | null | undefined;
  onMode?: (state: { mode: string; platform: string | null }) => void;
  hoverLabel?: (id: string) => string | null;
  nameFor?: (id: string) => string;
  reducedMotion?: () => boolean;
  idleLevel?: (id: string) => number;
  idleVigour?: (id: string) => number;
  onCamera?: (limits: ZoomLimits) => void;
  env?: ViewEnvironment<R, B>;
}
export interface Envelope {
  point: Point;
  count: number;
  mark: boolean;
  label: string;
  alpha: number;
  color: string;
}
export interface Drone {
  point: Point;
  parked: boolean;
  parcels: string[];
}
export interface MailFrame {
  drones: Drone[];
  envelopes: Envelope[];
}
export interface UpdateOptions {
  onHelperSettled?: (id: string, phase: "entering" | "returning") => void;
  stale?: () => boolean;
  rowStale?: (worker: Worker) => boolean;
  mailFrame?: (now: number) => MailFrame;
  inspected?: () => string | null;
  repositorySelection?: () => string | null;
  onRepositoryToggle?: (repo: string) => void;
}
export interface ZoomLimits {
  canZoomIn: boolean;
  canZoomOut: boolean;
}
export interface Anchor extends HitRegion {
  head: Point;
  foot: number;
}
export interface TargetBox {
  left: number;
  top: number;
  width: number;
  height: number;
}
export interface TitleBox extends TargetBox {
  id: string;
}
export interface SignBox extends TargetBox {
  repo: string;
}
export interface ShipBox extends TargetBox {
  host: string | null;
}
export interface Plate {
  x: number;
  y: number;
  w: number;
  h: number;
  priority: number;
  force?: boolean;
}
export interface TextPlate extends Plate {
  text: string;
  accent: string;
  size: number;
  color: string;
  dash: number[] | null;
  lines?: string[];
  target?: string;
  repo?: string | null;
  ship?: { host: string | null };
  observatory?: boolean;
}
export interface PlateOptions {
  accent?: string;
  size?: number;
  color?: string;
  priority?: number;
  force?: boolean;
  dash?: number[] | null;
}
export interface PlateFrame extends Camera {
  scene: Scene;
}
export interface ViewDefaults {
  defaults: ThemeDefault;
  themeStatus: ViewThemeStatus;
}
export interface ArtPainters<R extends SpriteResource> {
  paintStatic(ctx: ViewContext<R>, scene: Scene): void;
  desk(ctx: ViewContext<R>, worker: Worker, now: number, animate: boolean): void;
  helperDesk(ctx: ViewContext<R>, worker: Worker, now: number, animate: boolean): void;
  chair(ctx: ViewContext<R>, worker: { chair: Point; scale?: number }): void;
  partition(ctx: ViewContext<R>, unit: Rect, accent: string, end?: boolean): void;
  apron(ctx: ViewContext<R>, region: Decoration): void;
  planningDesk(ctx: ViewContext<R>, rect: Rect): void;
  viewer(ctx: ViewContext<R>, viewer: NonNullable<Scene["observatory"]["viewer"]>): void;
  screen(ctx: ViewContext<R>, prop: PropExtent, now: number, animate: boolean): void;
  telescope(ctx: ViewContext<R>, prop: PropExtent, now: number, animate: boolean): void;
  plant(ctx: ViewContext<R>, prop: PropExtent): void;
  lamp(ctx: ViewContext<R>, prop: PropExtent): void;
  drone(ctx: ViewContext<R>, drone: Drone, now: number, animate: boolean): void;
}
