const MIN_LEGACY_STRIDE_RATIO = 0.5;
const STEPS_PER_CYCLE = 2;
const RGBA_CHANNELS = 4;
const ALPHA_CHANNEL = 3;
const OPAQUE_THRESHOLD = 16;
const FOOT_BAND_RATIO = 0.16;
import type { SpriteResource, SpriteCanvas } from "./types.js";
import type { SpriteAssets } from "./loading.js";
export class SpriteGeometry<I extends SpriteResource, C extends SpriteCanvas<I | C>> {
  constructor(
    private readonly assets: SpriteAssets<I>,
    private readonly createCanvas: () => C,
  ) {}
  /* foot-line measurement — every PixelLab master leaves transparent padding BELOW the feet
       (the crew sets all sit ~23px up from the 92px canvas bottom). The contact shadow is drawn
       at the floor anchor (b.py), so when we anchored the IMAGE bottom there, that padding pushed
       the visible feet up off the shadow — and because the gap is `pad × scale`, the bigger skins
       (and ULTRON) floated worst. We measure the padding once per set from a STABLE idle frame
       (rot/blink/sit — never a walk frame, whose lifted foot would shift the body each stride) and
       anchor the FEET to the floor instead. Auto-derived so new skins self-correct. */
  private readonly footPad: Record<string, number> = {};
  // set maps to transparent rows below the feet, in master px
  private readonly DEFAULT_FOOT = 23;
  // crew authoring constant; only used when a frame can't be read
  private measureFootPad(img: I) {
    try {
      const w = img.width | 0,
        h = img.height | 0;
      if (!w || !h) return this.DEFAULT_FOOT;
      const c = this.createCanvas();
      c.width = w;
      c.height = h;
      const x = c.getContext("2d", { willReadFrequently: true });
      if (!x) return this.DEFAULT_FOOT;
      x.drawImage(img, 0, 0);
      const data = x.getImageData(0, 0, w, h).data;
      for (let y = h - 1; y >= 0; y--) {
        const row = y * w * 4;
        for (let px = 0; px < w; px++) {
          if ((data[row + px * 4 + 3] ?? 0) > 16) return h - 1 - y; // first opaque row from the bottom
        }
      }
      return this.DEFAULT_FOOT;
    } catch {
      return this.DEFAULT_FOOT;
    }
    // Tainted or unreadable images use the safe padding fallback.
  }
  /* ---------- how far one walk CYCLE carries the body ----------
       The walk is distance-phased, so this number decides whether the feet plant or skate: when the
       body covers more ground per cycle than the animation's legs actually swing, every foot slides.
       A shared short cycle makes long-legged skins take hurried steps. Estimate their extra foot
       separation relative to the standing side view, retaining the established fallback with robes,
       tails and small silhouettes where the foot-band measurement is unreliable.
       Derive it per set instead, from the set's OWN side view: at full extension the span across the
       foot band is one step (leading foot to trailing foot), and a cycle is two steps. Side views
       only — front and back foreshorten the swing to nothing.
       Sets whose feet never separate (pikachu, capybara — wide-stance animals whose walk is a bob,
       not a stride) have no step length to read, so they keep the old constant rather than being
       handed a fabricated one. */
  private readonly CYCLE_PER_HEIGHT = 0.56;
  // fallback when a set's swing can't be measured
  private readonly cycleCache: Record<string, number> = {};
  private readPixels(img: I) {
    const w = img.width | 0,
      h = img.height | 0;
    if (!w || !h) return null;
    const canvas = this.createCanvas();
    canvas.width = w;
    canvas.height = h;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(img, 0, 0);
    return { w, h, data: context.getImageData(0, 0, w, h).data };
  }
  private bandGap(img: I, lo = 0.16) {
    try {
      const pixels = this.readPixels(img);
      return pixels ? new FootBand(pixels).span(lo) : null;
    } catch {
      return null;
    }
    // Unreadable or tainted images keep the authored stride fallback.
  }
  cycleUnitsFor(set: string, sc: number, frameH: number) {
    const cacheKey = set + ":" + String(sc);
    if (this.cycleCache[cacheKey] !== undefined) return this.cycleCache[cacheKey];
    // Approved masters contain 68 rows of transparent packing. They are not leg length.
    const visibleHeight = this.assets.metadataFor(set).sourceStandingHeight || frameH;
    const fallback = visibleHeight * sc * this.CYCLE_PER_HEIGHT;
    const measured = this.measureStride(set);
    let out = fallback;
    if (measured) {
      const stride = 2 * (measured.widest - measured.idle) * sc;
      out = this.assets.isReviewSet(set)
        ? Math.max(fallback, Math.min(visibleHeight * sc, stride))
        : Math.max(
            fallback * MIN_LEGACY_STRIDE_RATIO,
            Math.min(fallback, STEPS_PER_CYCLE * measured.widest * sc),
          );
    }
    return (this.cycleCache[cacheKey] = out);
  }
  private measureStride(set: string) {
    const side = this.assets.frames[set + ".walk.east"] || this.assets.frames[set + ".walk.west"];
    const idleFr = this.assets.frames[set + ".rot.east"] || this.assets.frames[set + ".rot.west"];
    const idleFrame = idleFr?.[0];
    if (side && side.length > 0 && idleFrame) {
      const idle = this.bandGap(idleFrame);
      const widest = this.widest(side);
      // a real stride has to open the feet WIDER than standing; below that there is no swing to read
      if (idle && widest && widest - idle >= 3) {
        // Remove the stationary boot width: only the extra separation represents leg travel.
        // The old ceiling forced every approved skin back to the same short, hurried cycle.
        return { idle, widest };
      }
    }
    return null;
  }
  private widest(frames: readonly I[]) {
    let widest = 0;
    for (const frame of frames) {
      const gap = this.bandGap(frame);
      if (gap && gap > widest) widest = gap;
    }
    return widest;
  }
  /* per-TRACK content-bottom padding, to anchor the seat perch: the set-level footPad is measured off a
       STANDING frame, but a sit frame carries its own (often larger) transparent margin below the tucked
       legs — anchoring skeleton's sit by its standing pad hung the body in the air above the stool pad
       (Observation on 10 August 2026). Measured once per key from the frame that will actually be drawn. */
  private readonly trackPad: Record<string, number> = {};
  private readonly framePads = new WeakMap<I, number>();
  getFramePad(frame: I) {
    if (!this.framePads.has(frame)) this.framePads.set(frame, this.measureFootPad(frame));
    return this.framePads.get(frame) ?? this.DEFAULT_FOOT;
  }
  getTrackPad(key: string) {
    if (this.trackPad[key] !== undefined) return this.trackPad[key];
    const frames = this.assets.frames;
    const frame = frames[key]?.[0];
    return (this.trackPad[key] = frame ? this.measureFootPad(frame) : this.DEFAULT_FOOT);
  }
  getFootPad(set: string) {
    if (this.footPad[set] !== undefined) return this.footPad[set];
    const ref = this.idleFrame(set) ?? this.anyFrame(set);
    return (this.footPad[set] = ref ? this.measureFootPad(ref) : this.DEFAULT_FOOT);
  }
  private idleFrame(set: string) {
    for (const direction of ["south", "east", "west", "north"]) {
      const frames = this.assets.frames;
      const track =
        frames[`${set}.rot.${direction}`] ||
        frames[`${set}.blink.${direction}`] ||
        frames[`${set}.sit.${direction}`];
      if (track?.[0]) return track[0];
    }
    return null;
  }
  private anyFrame(set: string) {
    const frames = this.assets.frames,
      key = Object.keys(frames).find((key) => key.startsWith(set + "."));
    return key ? frames[key]?.[0] : null;
  }
}

class FootBand {
  constructor(private readonly pixels: { w: number; h: number; data: Uint8ClampedArray }) {}
  private opaque(x: number, y: number) {
    return (
      (this.pixels.data[(y * this.pixels.w + x) * RGBA_CHANNELS + ALPHA_CHANNEL] ?? 0) >
      OPAQUE_THRESHOLD
    );
  }
  private row(y: number) {
    for (let x = 0; x < this.pixels.w; x++) if (this.opaque(x, y)) return true;
    return false;
  }
  private rows() {
    let top = -1,
      bot = -1;
    for (let y = 0; y < this.pixels.h; y++) {
      if (!this.row(y)) continue;
      if (top < 0) top = y;
      bot = y;
    }
    return { top, bot };
  }
  span(lo: number) {
    const { top, bot } = this.rows();
    if (top < 0) return null;
    const band = Math.floor(bot - (bot - top) * (lo || FOOT_BAND_RATIO));
    let minX = this.pixels.w,
      maxX = -1;
    for (let y = band; y <= bot; y++)
      for (let x = 0; x < this.pixels.w; x++) {
        if (!this.opaque(x, y)) continue;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
      }
    return maxX < minX ? null : maxX - minX + 1;
  }
}
