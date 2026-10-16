const CALL_PRECISION = 4;
const RGBA_CHANNELS = 4;
/* Synthetic masters preserve measured alpha padding, image failures/delays and drawing-call/device extent evidence. */
import type { SpriteResource, SpriteGradient, SpriteContext } from "./types.js";
export type DrawLog = (string | number)[][];
type Matrix = readonly [number, number, number, number, number, number];
type Extents = number[][];
export interface RecordingResource extends SpriteResource {
  readonly __id: string;
  readonly alphaAt?: (x: number, y: number) => boolean;
}
class Gradient implements SpriteGradient {
  addColorStop() {
    /* No pixels change in the call recorder. */
  }
}
const round = (value: number) => +value.toFixed(CALL_PRECISION);
export class RecordingContext implements SpriteContext<RecordingResource> {
  private matrix: Matrix = [1, 0, 0, 1, 0, 0];
  private readonly stack: { matrix: Matrix; state: ReturnType<RecordingContext["snapshot"]> }[] =
    [];
  private alpha = 1;
  private lost = false;
  private sampled: RecordingResource | null = null;
  private smoothing = false;
  private quality: ImageSmoothingQuality = "low";
  private composite: GlobalCompositeOperation = "source-over";
  private ink: string | CanvasGradient | CanvasPattern | SpriteGradient = "#000000";
  constructor(
    readonly log: DrawLog,
    private readonly extents?: Extents,
    private readonly padRows = 20,
    readonly canvas?: SpriteResource,
  ) {}
  get globalAlpha() {
    return this.alpha;
  }
  set globalAlpha(value: number) {
    this.alpha = value;
    this.record("set", "globalAlpha", value);
  }
  get imageSmoothingEnabled() {
    return this.smoothing;
  }
  set imageSmoothingEnabled(value: boolean) {
    this.smoothing = value;
    this.record("set", "imageSmoothingEnabled", String(value));
  }
  get imageSmoothingQuality() {
    return this.quality;
  }
  set imageSmoothingQuality(value: ImageSmoothingQuality) {
    this.quality = value;
    this.record("set", "imageSmoothingQuality", value);
  }
  get globalCompositeOperation() {
    return this.composite;
  }
  set globalCompositeOperation(value: GlobalCompositeOperation) {
    this.composite = value;
    this.record("set", "globalCompositeOperation", value);
  }
  get fillStyle() {
    return this.ink;
  }
  set fillStyle(value: string | CanvasGradient | CanvasPattern | SpriteGradient) {
    this.ink = value;
    this.record("set", "fillStyle", typeof value === "string" ? value : "[object Object]");
  }
  private record(name: string, ...args: (string | number)[]) {
    this.log.push([name, ...args.map((v) => (typeof v === "number" ? round(v) : v))]);
  }
  private snapshot() {
    return {
      alpha: this.alpha,
      smoothing: this.smoothing,
      quality: this.quality,
      composite: this.composite,
      ink: this.ink,
    };
  }
  private apply(x: number, y: number): readonly [number, number] {
    const [a, b, c, d, e, f] = this.matrix;
    return [a * x + c * y + e, b * x + d * y + f];
  }
  private box(points: readonly (readonly [number, number])[]) {
    const xs = points.map((p) => p[0]),
      ys = points.map((p) => p[1]);
    this.extents?.push([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]);
  }
  save() {
    this.stack.push({ matrix: this.matrix, state: this.snapshot() });
    this.record("save");
  }
  restore() {
    const saved = this.stack.pop();
    if (saved) {
      this.matrix = saved.matrix;
      const state = saved.state;
      this.alpha = state.alpha;
      this.smoothing = state.smoothing;
      this.quality = state.quality;
      this.composite = state.composite;
      this.ink = state.ink;
    }
    this.record("restore");
  }
  setTransform(...[a, b, c, d, e, f]: [number, number, number, number, number, number]) {
    this.matrix = [a, b, c, d, e, f];
    this.record("setTransform", a, b, c, d, e, f);
  }
  getTransform() {
    const [a, b, c, d, e, f] = this.matrix;
    return { a, b, c, d, e, f };
  }
  translate(x: number, y: number) {
    const [a, b, c, d, e, f] = this.matrix;
    this.matrix = [a, b, c, d, a * x + c * y + e, b * x + d * y + f];
    this.record("translate", x, y);
  }
  transform(...[a, b, c, d, e, f]: [number, number, number, number, number, number]) {
    const [ma, mb, mc, md, me, mf] = this.matrix;
    this.matrix = [
      ma * a + mc * b,
      mb * a + md * b,
      ma * c + mc * d,
      mb * c + md * d,
      ma * e + mc * f + me,
      mb * e + md * f + mf,
    ];
    this.record("transform", a, b, c, d, e, f);
  }
  scale(x: number, y: number) {
    const [a, b, c, d, e, f] = this.matrix;
    this.matrix = [a * x, b * x, c * y, d * y, e, f];
    this.record("scale", x, y);
  }
  drawImage(...[image, x, y, w, h]: [RecordingResource, number, number, number?, number?]) {
    this.sampled = image;
    if (w !== undefined && h !== undefined) {
      this.box([
        this.apply(x, y),
        this.apply(x + w, y),
        this.apply(x, y + h),
        this.apply(x + w, y + h),
      ]);
      this.record("drawImage", image.__id, x, y, w, h);
    } else this.record("drawImage", image.__id, x, y);
  }
  ellipse(
    ...[x, y, rx, ry, rotation, start, end]: [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ]
  ) {
    const radius = Math.max(rx, ry);
    this.box([this.apply(x - radius, y - radius), this.apply(x + radius, y + radius)]);
    this.record("ellipse", x, y, rx, ry, rotation, start, end);
  }
  getImageData(_x: number, _y: number, w: number, h: number) {
    this.record("getImageData");
    const data = new Uint8ClampedArray(w * h * RGBA_CHANNELS);
    const alphaAt = this.sampled?.alphaAt;
    if (alphaAt) {
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) if (alphaAt(x, y)) data[(y * w + x) * 4 + 3] = 255;
    } else for (let i = 0; i < w * (h - this.padRows); i++) data[i * 4 + 3] = 255;
    return { data };
  }
  createLinearGradient(...args: [number, number, number, number]) {
    this.record("createLinearGradient", ...args);
    return new Gradient();
  }
  // Sprite renderers call this optional SpriteContext capability; Fallow 3.27.0 misses that dispatch.
  // fallow-ignore-next-line unused-class-member
  isContextLost() {
    return this.lost;
  }
  loseContext() {
    this.lost = true;
  }
  restoreContext() {
    this.lost = false;
  }
  beginPath() {
    this.record("beginPath");
  }
  fill() {
    this.record("fill");
  }
  clip() {
    this.record("clip");
  }
  rect(...args: [number, number, number, number]) {
    this.record("rect", ...args);
  }
  clearRect(...args: [number, number, number, number]) {
    this.record("clearRect", ...args);
  }
  fillRect(...args: [number, number, number, number]) {
    this.record("fillRect", ...args);
  }
}
