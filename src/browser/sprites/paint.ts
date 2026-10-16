const LEADER_SPILL_RADIUS = 1.55;
const LEADER_SPILL_BASE_ALPHA = 0.55;
const LEADER_SPILL_PULSE_ALPHA = 0.25;
const LEADER_SPILL_PERIOD_MS = 400;
const SPEECH_SKEW = 0.009;
const CLIP_HORIZONTAL_MARGIN = 2;
const DESK_FOOT_CROP = 5;
import type {
  SpriteResource,
  SpriteCanvas,
  SpriteContext,
  SpriteAppearance,
  QuantizedLight,
  ShadowOptions,
} from "./types.js";
import type { BodyAnimation } from "./animation.js";
import type { Placement, PoseTransition } from "./placement.js";
import type { SpriteRenderer } from "./renderer.js";
import { GroundShadow } from "./shadow.js";
interface PaintInput<I extends SpriteResource, C extends SpriteCanvas<I | C>> {
  animation: BodyAnimation<I, C>;
  placement: Placement<I, C>;
  transition: PoseTransition<I, C>;
  context: SpriteContext<I | C>;
  appearance: SpriteAppearance | undefined;
}
export class BodyPaint<I extends SpriteResource, C extends SpriteCanvas<I | C>> {
  private light: QuantizedLight | null = null;
  private source: I | C;
  private fadeSource: I | C;
  private composed = false;
  constructor(
    private readonly renderer: SpriteRenderer<I, C>,
    private readonly input: PaintInput<I, C>,
  ) {
    this.source = input.animation.f;
    this.fadeSource = input.animation.f;
  }
  // Sprite rect (+1px resample margin, + speech skew), the fading previous pose, and every ground ring:
  // a ring's centre shifts by <=0.48 and its radius is <=1.14 of the pool, the leader's spill pool is 1.55x.
  private bounds() {
    const {
      placement: p,
      transition: { fade },
      animation: {
        pose: { body },
      },
    } = this.input;
    const skew = Math.abs(p.speech) * 0.009 * p.drawHeight + 1,
      reach = p.shR * 1.55 * 1.62;
    let left = Math.min(p.x - skew, body.px - reach),
      right = Math.max(p.x + p.dw + skew, body.px + reach);
    let top = Math.min(p.y - 1, body.py - reach),
      bottom = Math.max(p.y + p.drawHeight + 1, body.py + reach);
    if (fade) {
      const fx = body.px + fade.ox,
        fy = body.py + fade.oy;
      left = Math.min(left, fx - 1);
      right = Math.max(right, fx + fade.w + 1);
      top = Math.min(top, fy - 1);
      bottom = Math.max(bottom, fy + fade.h + 1);
    }
    return { x: left, y: top, w: right - left, h: bottom - top };
  }
  visible() {
    const {
      appearance,
      context,
      animation: {
        pose: { body },
      },
    } = this.input;
    if (appearance?.shouldPaint && !appearance.shouldPaint(this.bounds())) {
      const target = this.renderer.destinationOf(context);
      let skipped = this.renderer.offStage.get(target);
      if (!skipped) {
        skipped = new WeakSet();
        this.renderer.offStage.set(target, skipped);
      }
      skipped.add(body);
      return false;
    }
    return true;
  }
  private compose() {
    const {
      animation: {
        f,
        fNext,
        tween,
        pose: { nowMs },
      },
      transition: { fade },
    } = this.input;
    this.fadeSource = fade ? this.renderer.lighting.lightFrame(fade.f, this.light, nowMs) : f;
    this.source = fNext
      ? this.renderer.tweenFrame(
          this.renderer.lighting.lightFrame(f, this.light, nowMs),
          this.renderer.lighting.lightFrame(fNext, this.light, nowMs),
          tween,
        )
      : this.renderer.lighting.lightFrame(f, this.light, nowMs);
    this.composed = true;
  }
  /* Compose once per painted draw: re-entry warms before the ground shadow, otherwise composition stays at draw time. */
  private reentry() {
    const {
      context,
      animation: {
        pose: { body },
      },
      placement: p,
      transition: { fade },
    } = this.input;
    if (!this.renderer.offStage.get(this.renderer.destinationOf(context))?.delete(body)) return;
    this.compose();
    this.renderer.warmDestination(
      context,
      fade
        ? [
            [this.fadeSource, p.snap(body.px + fade.ox), p.snap(body.py + fade.oy), fade.w, fade.h],
            [this.source, p.x, p.y, p.dw, p.drawHeight],
          ]
        : [[this.source, p.x, p.y, p.dw, p.drawHeight]],
    );
  }
  /* Raw floor coordinates keep the pool continuous as sprite pixels snap to device phase.
    Portraits have no floor. Perched pools tighten and fade; authored leader spill remains under scene-owned shadows. */
  // the contact shadow (and ULTRON's red spill) is a GROUND cue — skip it on off-floor renders
  // like the dossier portrait (b.noShadow), where there's no floor and it scales into a blocky bar.
  // NOTE: fed the RAW b.px/b.py, not the device-snapped ones. Snapping the pool as the body
  // itself is sub-unit would allow the shadow to tick a pixel as the feet slid smoothly over it.
  // a perched body adds its seatLift to the shadow's lift: the pool tightens + fades the higher the
  // seat, instead of claiming full floor contact the raised feet don't have
  private shadow() {
    const {
      context,
      animation: {
        pose: { body, set, reduced, nowMs },
      },
      appearance,
      placement: p,
    } = this.input;
    if (body.noShadow) return;
    const lift = Math.max(0, -p.bob),
      shadow = new GroundShadow(context);
    if (set === "ultron")
      shadow.draw(body.px, body.py, p.shR * LEADER_SPILL_RADIUS, {
        lift,
        color: "#ff4a3d",
        alpha: reduced
          ? LEADER_SPILL_BASE_ALPHA
          : LEADER_SPILL_BASE_ALPHA +
            LEADER_SPILL_PULSE_ALPHA * Math.sin(nowMs / LEADER_SPILL_PERIOD_MS),
      });
    if (appearance?.skipGroundShadow) return;
    const options: ShadowOptions = body.sitting
      ? { lift: lift + p.seatLift, alpha: 0.6, spread: 0.8 }
      : { lift };
    if (this.light) options.direction = { x: -this.light.dx, y: -this.light.dy * 0.62 };
    shadow.draw(body.px, body.py, p.shR, options);
  }
  private speech() {
    const {
      context,
      placement: p,
      animation: {
        pose: { body },
      },
    } = this.input;
    if (!p.speech) return;
    context.save();
    const foot = body.py + p.groundBite - p.seatLift;
    context.translate(0, foot);
    context.transform(1, 0, p.speech * SPEECH_SKEW, 1, 0, 0);
    context.translate(0, -foot);
  }
  /* Rear-facing desk poses tuck shins under the console; the open caster base must not reveal sprite boots. */
  private tuck() {
    const {
      animation: {
        pose: { body },
        key,
        f,
        sc,
      },
      context,
      placement: p,
    } = this.input;
    const tuck =
      body.sitting &&
      !body.seated &&
      (body.working || body.goal === "work") &&
      /\.(sit|type)\.north$/.test(key);
    if (!tuck) return false;
    context.save();
    const floor = p.y + (p.dh - this.renderer.geometry.getFramePad(f) * sc) * p.breathScale;
    context.beginPath();
    context.rect(
      p.x - 1,
      p.y - 1,
      p.dw + CLIP_HORIZONTAL_MARGIN,
      Math.max(0, floor - p.y - DESK_FOOT_CROP),
    );
    context.clip();
    return true;
  }
  /* Pose changes dissolve the outgoing drawing beneath the incoming one; frames within a cycle never dissolve.
    The resolved fade already advanced before visibility, and reduced motion has no transition. */
  // POSE DISSOLVE (22 September 2026, Andrew: "you can see the frames when they turn"). A change of
  // POSE — facing sector, walk↔stand, stand↔sit — used to hard-cut between two unrelated
  // drawings. The outgoing pose now fades out beneath the incoming one throughout POSE_FADE_MS,
  // riding the body's position, so a turn reads as a rotation instead of a swap. Frames
  // WITHIN one walk cycle never dissolve (that smears the legs); reduced motion never fades.
  // The fade state itself was settled above, before the paint decision.
  private draw() {
    const {
      context,
      placement: p,
      transition: { fade, ft },
      animation: {
        pose: { body },
      },
    } = this.input;
    if (fade) {
      const keep = context.globalAlpha;
      context.globalAlpha = keep * (1 - ft) * (1 - ft * 0.35);
      context.drawImage(
        this.fadeSource,
        p.snap(body.px + fade.ox),
        p.snap(body.py + fade.oy),
        fade.w,
        fade.h,
      );
      context.globalAlpha = keep;
    }
    context.drawImage(this.source, p.x, p.y, p.dw, p.drawHeight);
  }
  paint() {
    const {
      context,
      appearance,
      animation: {
        pose: { body },
      },
      placement: p,
    } = this.input;
    this.light = this.renderer.lighting.bodyLight(
      appearance?.light ?? appearance?.sampleLight?.(body.px, body.py),
    );
    this.reentry();
    this.shadow();
    const smoothing = context.imageSmoothingEnabled,
      quality = context.imageSmoothingQuality;
    context.imageSmoothingEnabled = true;
    if ("imageSmoothingQuality" in context) context.imageSmoothingQuality = "high";
    try {
      if (!this.composed) this.compose();
      this.speech();
      const tucked = this.tuck();
      this.draw();
      if (tucked) context.restore();
      if (p.speech) context.restore();
    } finally {
      context.imageSmoothingEnabled = smoothing;
      if ("imageSmoothingQuality" in context) context.imageSmoothingQuality = quality;
    }
  }
}
