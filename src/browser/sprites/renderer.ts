const OVERLAY_TOP_RATIO = 0.22;
const OVERLAY_WIDTH_RATIO = 0.6;
import { BodyAnimation } from "./animation.js";
import { BodyPlacement } from "./placement.js";
import { BodyPaint } from "./paint.js";
import { BodyPose } from "./pose.js";
import type {
  SpriteResource,
  SpriteCanvas,
  SpriteContext,
  SpriteBody,
  SpriteAppearance,
} from "./types.js";
import type { SpriteAssets } from "./loading.js";
import { SpriteGeometry } from "./geometry.js";
import { SpriteLighting } from "./lighting.js";
import { DestinationWarmup } from "./destination.js";

export class SpriteRenderer<I extends SpriteResource, C extends SpriteCanvas<I | C>> {
  readonly geometry: SpriteGeometry<I, C>;
  readonly lighting: SpriteLighting<I, C>;
  constructor(
    private readonly assets: SpriteAssets<I>,
    private readonly createCanvas: () => C,
  ) {
    this.geometry = new SpriteGeometry(assets, this.createCanvas);
    this.lighting = new SpriteLighting(this.createCanvas);
  }
  /* one walk in-between: drawing a crossfaded into drawing c by t, composed in PREMULTIPLIED space
       ('lighter' adds a·(1-t) + c·t) so pixels both drawings cover stay fully opaque mid-blend. Two
       plain alpha draws over the floor would allow the floor show through the body at t equals 0.5. One
       shared scratch canvas: drawBody copies the result out synchronously before the next body is drawn. */
  private tweenCanvas: C | null = null;
  tweenFrame(a: I | C, c: I | C, t: number) {
    const w = Math.max(a.width, c.width) | 0,
      h = Math.max(a.height, c.height) | 0;
    if (!this.tweenCanvas) this.tweenCanvas = this.createCanvas();
    if (this.tweenCanvas.width !== w || this.tweenCanvas.height !== h) {
      this.tweenCanvas.width = w;
      this.tweenCanvas.height = h;
    }
    const g = this.tweenCanvas.getContext("2d");
    if (!g || g.isContextLost?.()) return t < 0.5 ? a : c;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = "source-over";
    g.globalAlpha = 1;
    g.clearRect(0, 0, w, h);
    g.globalAlpha = 1 - t;
    g.drawImage(a, 0, 0);
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = t;
    g.drawImage(c, 0, 0);
    g.globalCompositeOperation = "source-over";
    g.globalAlpha = 1;
    return this.tweenCanvas;
  }
  /* main draw: foot-anchored at (x, y)  operation. */
  /* `appearance` may carry two optional callbacks. `shouldPaint((x,y,w,h))` sees the complete conservative paint
       bounds (sprite, pose fade, speech skew, shadow/spill) after every pose/facing/frame/speech/fade state update;
       returning false skips light sampling, tinting and all Canvas work and reports `painted:false`. `sampleLight(x,y)`
       is consulted lazily, only with a painted body; a direct `appearance.light` always wins. */
  /* RE-ENTRY: a destination that skipped a body's clipped draws as it was off screen rasterizes that body's
       first visible frame differently from one that kept drawing it (measured in Chrome: the canvas's own history
       changes the first use of the source). A body rejected by shouldPaint is remembered here, outside its render
       state. On its first painted frame its sources are composed once, BEFORE the ground shadow, and drawn once at
       their real positions shifted right by whole device pixels to wholly past the bitmap (same scale, same sample
       phase, the draw's own smoothing); then the frame paints in its normal order. Measured: warming after the
       shadow, or at a different phase, does not restore parity. Rejected frames still emit nothing. */
  // Per destination: a body skipped on the stage is still pending there when a still or tile render paints it
  // elsewhere. Keyed weakly by the destination canvas (or the context itself when it has none).
  readonly offStage = new WeakMap<object, WeakSet<SpriteBody<I | C>>>();
  destinationOf = (ctx: SpriteContext<I | C>) => ctx.canvas || ctx;
  warmDestination(
    context: SpriteContext<I | C>,
    draws: readonly (readonly [I | C, number, number, number, number])[],
  ) {
    new DestinationWarmup(context).draw(draws);
  }
  drawBody(
    ctx: SpriteContext<I | C>,
    body: SpriteBody<I | C>,
    nowMs: number,
    appearance?: SpriteAppearance,
  ): { top: number; w: number; h: number; painted?: false } | null {
    const reduced = !!appearance?.reducedMotion,
      set = this.assets.setForBody(body, appearance?.group);
    if (!this.assets.loadedSets.has(set)) {
      void this.assets.loadSet(set);
      return null;
    }
    const pose = new BodyPose(this.assets, { body, nowMs, reduced, set });
    pose.select();
    pose.gesture();
    pose.blink();
    if (!pose.key) return null;
    const frames = this.assets.frames[pose.key],
      first = frames?.[0];
    if (!frames || !first) return null;
    const animation = new BodyAnimation(pose, {
      key: pose.key,
      frames,
      first,
      geometry: this.geometry,
    });
    const placer = new BodyPlacement(animation, this.geometry, ctx),
      placement = placer.place(!!appearance),
      transition = placer.fade(placement);
    const geometry = {
      top: placement.y + Math.round(placement.drawHeight * OVERLAY_TOP_RATIO),
      w: Math.round(placement.dw * OVERLAY_WIDTH_RATIO),
      h: placement.drawHeight,
    };
    const painter = new BodyPaint(this, {
      animation,
      placement,
      transition,
      context: ctx,
      appearance,
    });
    if (!painter.visible()) return { ...geometry, painted: false };
    painter.paint();
    return geometry;
  }
}
