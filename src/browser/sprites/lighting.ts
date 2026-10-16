const STRENGTH_STEPS = 6;
const COLOR_CHANNELS = 3;
const CHANNEL_MAX = 255;
const CHANNEL_QUANTUM = 24;
const SECTOR_HALF_TURN = 4;
import { LightPainter } from "./light-painter.js";
import type { SpriteResource, SpriteCanvas, SpriteLight, QuantizedLight } from "./types.js";
export class SpriteLighting<I extends SpriteResource, C extends SpriteCanvas<I | C>> {
  private readonly painter: LightPainter<I, C>;
  constructor(private readonly createCanvas: () => C) {
    this.painter = new LightPainter(createCanvas);
  }
  /* Local light is optional presentation data; it never selects a pose or changes game state.
       drawBody's fourth argument is ( reducedMotion, skipGroundShadow,
         light: ( color: [r,g,b], strength, dx, dy ) ).
       skipGroundShadow lets the scene own its wall-clipped cast/contact pass without doubling it;
       authored emissive spill, such as ULTRON's red pool, stays part of the skin's presentation.
       Direction points FROM the body TOWARD the source in world axes. Quantize small changes before
       caching at native sprite resolution, shared across agents. No scene readback or canvas filter.
       TWO TIERS introduced on 7 October 2026 (, "laggy" on a 26-agent station): a fixed 128-frame LRU was smaller than one second
       of a big crew — a WALKING body crosses a colour/strength/sector step ~5x a second and every walk frame is
       a different master, so each (frame, light) pair was drawn exactly once: ~230 fresh canvases a second,
       each a new GPU texture, and every one of them evicted a sitting body's frame so that rebuilt too.
         probation — a pair's first build lands here (a small ring); its canvases are RECYCLED, never
                     re-allocated, so a walker's one-off frames cost no allocation and no texture churn.
         kept      — a pair still being drawn BODY_LIGHT_PROMOTE_MS after it was built is promoted; bounded
                     by PIXELS (16 MB of bitmap). A walk frame is on screen ~100ms (re-asked 2-3 times, then
                     never again), so it is served from probation and never floods the kept tier.
       An idle or seated body is promoted within a second and is never rebuilt again; walkers cycle the ring
       and can no longer push it out. Time is the caller's nowMs (deterministic, like the rest of drawBody). */
  private readonly BODY_LIGHT_LIMIT = 4096;
  private readonly BODY_LIGHT_PIXELS = 4194304;
  private readonly BODY_LIGHT_PROBATION = 96;
  private readonly BODY_LIGHT_POOL = 8;
  private readonly BODY_LIGHT_PROMOTE_MS = 600;
  private readonly bodyLights = new Map<string, C>();
  private readonly probation = new Map<
    string,
    {
      c: C;
      at: number;
    }
  >();
  private readonly lightPool: C[] = [];
  private readonly frameIds = new WeakMap<I | C, number>();
  private nextFrameId = 1;
  private bodyLightBuilds = 0;
  private bodyLightPixels = 0;
  private bodyLightRecycled = 0;
  private readonly clamp01 = (n: number) => Math.max(0, Math.min(1, n || 0));
  bodyLight(raw: SpriteLight | null | undefined) {
    if (!raw || raw.color.length < 3) return null;
    const strength = Math.round(this.clamp01(raw.strength) * STRENGTH_STEPS) / 6;
    if (!strength) return null;
    const color = raw.color
      .slice(0, COLOR_CHANNELS)
      .map((n) =>
        Math.min(
          CHANNEL_MAX,
          Math.round(Math.max(0, Math.min(CHANNEL_MAX, n || 0)) / CHANNEL_QUANTUM) *
            CHANNEL_QUANTUM,
        ),
      );
    const dx = raw.dx,
      dy = raw.dy;
    const angle =
      Number.isFinite(dx) && Number.isFinite(dy) && Math.hypot(dx, dy) > 0.001
        ? Math.atan2(dy, dx)
        : -2.2;
    const sector = ((Math.round(angle / (Math.PI / SECTOR_HALF_TURN)) % 8) + 8) % 8;
    return {
      color,
      strength,
      dx: Math.cos((sector * Math.PI) / SECTOR_HALF_TURN),
      dy: Math.sin((sector * Math.PI) / SECTOR_HALF_TURN),
      key: color.join(",") + "|" + String(strength) + "|" + String(sector),
    };
  }
  private releaseBodyLight(canvas: C) {
    Object.assign(canvas, { width: 1, height: 1 });
  }
  private dropBodyLight(key: string, canvas: C) {
    this.bodyLights.delete(key);
    this.bodyLightPixels -= canvas.width * canvas.height;
    this.releaseBodyLight(canvas);
  }
  private lightLive(c: C) {
    const g = c.getContext("2d");
    return !!(g && !g.isContextLost?.());
  }
  /* A GPU reset (sleep, driver update) loses every canvas at once, and a RESTORED context comes back blank as
       isContextLost() reads false again: a kept frame would then draw an idle body as nothing, throughout its time in the tier, until it stops being
       kept. Any light canvas reporting loss or restoration drops both tiers — every pair rebuilds on its next draw. */
  private flushBodyLights() {
    for (const c of this.bodyLights.values()) this.releaseBodyLight(c);
    for (const t of this.probation.values()) this.releaseBodyLight(t.c);
    this.bodyLights.clear();
    this.probation.clear();
    this.lightPool.length = 0;
    this.bodyLightPixels = 0;
  }
  private watchLight(c: C) {
    try {
      c.addEventListener("contextlost", () => {
        this.flushBodyLights();
      });
      c.addEventListener("contextrestored", () => {
        this.flushBodyLights();
      });
    } catch {
      /* Unsupported event targets still use the context-loss readback path. */
    }
    return c;
  }
  lightFrame(frame: I | C, light: QuantizedLight | null, nowMs: number) {
    if (!light) return frame;
    let id = this.frameIds.get(frame);
    if (!id) {
      id = this.nextFrameId++;
      this.frameIds.set(frame, id);
    }
    const key = String(id) + "|" + light.key;
    const cached = this.kept(key) ?? this.trial(key, nowMs);
    if (cached) return cached;
    return this.build(frame, light, { key, nowMs });
  }
  private kept(key: string) {
    const hit = this.bodyLights.get(key);
    if (hit) {
      if (this.lightLive(hit)) {
        this.bodyLights.delete(key);
        this.bodyLights.set(key, hit);
        return hit;
      }
      this.dropBodyLight(key, hit);
    }
    return null;
  }
  private trial(key: string, nowMs: number) {
    const trial = this.probation.get(key);
    if (trial) {
      this.probation.delete(key);
      const kept = trial.c;
      if (!this.lightLive(kept)) this.releaseBodyLight(kept);
      else if (nowMs - trial.at < this.BODY_LIGHT_PROMOTE_MS) {
        this.probation.set(key, trial);
        return kept;
      } else {
        // still in use long after its build: this pair is worth keeping
        this.bodyLights.set(key, kept);
        this.bodyLightPixels += kept.width * kept.height;
        this.trimKept();
        return kept;
      }
    }
    return null;
  }
  private trimKept() {
    while (
      this.bodyLights.size > 1 &&
      (this.bodyLights.size > this.BODY_LIGHT_LIMIT ||
        this.bodyLightPixels > this.BODY_LIGHT_PIXELS)
    ) {
      const oldest = this.bodyLights.keys().next().value;
      if (oldest === undefined) break;
      const value = this.bodyLights.get(oldest);
      if (value) this.dropBodyLight(oldest, value);
    }
  }
  private trimProbation() {
    // the ring's oldest pair was drawn BODY_LIGHT_PROBATION builds ago — long after any body used it this frame
    while (this.probation.size > this.BODY_LIGHT_PROBATION) {
      const oldest = this.probation.keys().next().value;
      if (oldest === undefined) break;
      const trial = this.probation.get(oldest);
      if (!trial) break;
      const c = trial.c;
      this.probation.delete(oldest);
      if (this.lightPool.length < this.BODY_LIGHT_POOL) this.lightPool.push(c);
      else this.releaseBodyLight(c);
    }
  }
  private build(
    frame: I | C,
    light: QuantizedLight,
    { key, nowMs }: { key: string; nowMs: number },
  ) {
    let canvas;
    try {
      const w = frame.width | 0,
        h = frame.height | 0;
      if (!w || !h || w * h > 262144) return frame;
      canvas = this.lightPool.pop();
      if (canvas) this.bodyLightRecycled++;
      else canvas = this.watchLight(this.createCanvas());
      canvas.width = w;
      canvas.height = h; // also clears a recycled bitmap and resets its state
      if (!this.painter.paint(frame, canvas, light)) {
        this.releaseBodyLight(canvas);
        return frame;
      }
      this.probation.set(key, { c: canvas, at: nowMs || 0 });
      this.bodyLightBuilds++;
      this.trimProbation();
      return canvas;
    } catch {
      if (canvas) this.releaseBodyLight(canvas);
      return frame; // unsupported/lost offscreen context must never hide a real crew body
    }
  }
  bodyAppearanceStats() {
    return {
      cachedFrames: this.bodyLights.size + this.probation.size,
      kept: this.bodyLights.size,
      probation: this.probation.size,
      limit: this.BODY_LIGHT_LIMIT,
      builds: this.bodyLightBuilds,
      recycled: this.bodyLightRecycled,
      pixels: this.bodyLightPixels,
      pixelLimit: this.BODY_LIGHT_PIXELS,
    };
  }
}
