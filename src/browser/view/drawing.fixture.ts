import type { RecordingResource } from "../sprites/recorder.fixture.js";
import type { ViewContext, ViewEvent } from "./types.js";
export type Resource = RecordingResource;
const RGBA_CHANNELS = 4;
const ignoreColorStop: (offset: number, color: string) => void = () => {
  /* No pixels in drawing oracle. */
};
export class DrawingContext implements ViewContext<Resource> {
  globalAlpha = 1;
  globalCompositeOperation: GlobalCompositeOperation = "source-over";
  fillStyle: string | CanvasGradient | CanvasPattern = "";
  strokeStyle: string | CanvasGradient | CanvasPattern = "";
  imageSmoothingEnabled = true;
  imageSmoothingQuality: ImageSmoothingQuality = "low";
  lineWidth = 1;
  lineCap: CanvasLineCap = "butt";
  lineDashOffset = 0;
  font = "";
  textAlign: CanvasTextAlign = "start";
  textBaseline: CanvasTextBaseline = "alphabetic";
  filter = "none";
  getImageData(...[, , w, h]: Parameters<ViewContext<Resource>["getImageData"]>) {
    return { data: new Uint8ClampedArray(w * h * RGBA_CHANNELS) };
  }
  createLinearGradient() {
    return {
      addColorStop: ignoreColorStop,
    };
  }
  createRadialGradient() {
    return this.createLinearGradient();
  }
  drawImage: ViewContext<Resource>["drawImage"] = () => {
    /* Calls are recorded by scenario overrides. */
  };
  setTransform: ViewContext<Resource>["setTransform"] = () => {
    /* Transform is outside colour oracle. */
  };
  save() {
    /* Individual state oracles override save and restore. */
  }
  restore() {
    /* Individual state oracles override save and restore. */
  }
  clearRect: ViewContext<Resource>["clearRect"] = () => {
    /* No pixels in drawing oracle. */
  };
  fillRect: ViewContext<Resource>["fillRect"] = () => {
    /* Calls are recorded by scenario overrides. */
  };
  translate: ViewContext<Resource>["translate"] = () => {
    /* Geometry is observed through returned hit extents. */
  };
  transform: ViewContext<Resource>["transform"] = () => {
    /* No pixels in drawing oracle. */
  };
  scale: ViewContext<Resource>["scale"] = () => {
    /* Geometry is observed through returned hit extents. */
  };
  beginPath() {
    /* No raster in drawing oracle. */
  }
  closePath() {
    /* No raster in drawing oracle. */
  }
  rect: ViewContext<Resource>["rect"] = () => {
    /* Calls are recorded by scenario overrides. */
  };
  clip() {
    /* No raster in drawing oracle. */
  }
  ellipse: ViewContext<Resource>["ellipse"] = () => {
    /* Calls are recorded by scenario overrides. */
  };
  fill() {
    /* Calls are recorded by scenario overrides. */
  }
  stroke() {
    /* Calls are recorded by scenario overrides. */
  }
  moveTo: ViewContext<Resource>["moveTo"] = () => {
    /* Calls are recorded by scenario overrides. */
  };
  lineTo: ViewContext<Resource>["lineTo"] = () => {
    /* Calls are recorded by scenario overrides. */
  };
  strokeRect: ViewContext<Resource>["strokeRect"] = () => {
    /* Calls are recorded by scenario overrides. */
  };
  arc: ViewContext<Resource>["arc"] = () => {
    /* No raster in drawing oracle. */
  };
  roundRect: NonNullable<ViewContext<Resource>["roundRect"]> = () => {
    /* No raster in drawing oracle. */
  };
  setLineDash: ViewContext<Resource>["setLineDash"] = () => {
    /* Calls are recorded by scenario overrides. */
  };
  measureText(text: string) {
    return { width: text.length * 7 };
  }
  fillText: ViewContext<Resource>["fillText"] = () => {
    /* Calls are recorded by scenario overrides. */
  };
}
export function drawing<T extends object>(methods: T) {
  return Object.assign(new DrawingContext(), methods);
}
export class Handlers extends Map<string, (event: ViewEvent) => void> {
  override get(name: string) {
    const handler = super.get(name);
    if (!handler) throw new Error("Missing fixture handler: " + name);
    return handler;
  }
}
export function present<T>(value: T | undefined | null): T {
  if (value === null || value === undefined) throw new Error("Missing expected View fixture value");
  return value;
}
export class OfficeImageFixture {
  protected _src = "";
  naturalWidth = 0;
  naturalHeight = 0;
  decoding = "";
  onload: ((event: Event) => unknown) | null = null;
  onerror: ((event: Event) => unknown) | null = null;
  get width() {
    return this.naturalWidth;
  }
  get height() {
    return this.naturalHeight;
  }
  get __id() {
    return this._src;
  }
  get src() {
    return this._src;
  }
  set src(value: string) {
    this._src = value;
  }
}
