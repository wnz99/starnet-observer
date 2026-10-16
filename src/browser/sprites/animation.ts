const DIAGNOSTIC_PRECISION = 3;
const MILLISECONDS_PER_SECOND = 1000;
import type { SpriteResource, SpriteCanvas } from "./types.js";
import type { BodyPose } from "./pose.js";
import type { SpriteGeometry } from "./geometry.js";
import { DIR8_A, TURN_STEP_FRAMES, ang } from "./facing.js";
/* Distance, not clock, drives walking. Derived per-set visible stride avoids skating at different speeds;
   transparent master packing is not leg length. Pivots spend swept angle, as other tracks keep their clock.
   Six-pose skins scale their angular cycle; retired four/eight-frame sets retain their cadence. */
// WALK advances on DISTANCE TRAVELLED (b.odo, world units — stepGait in world.js keeps it), not the wall
// clock. A fixed-fps cycle made every body's feet skate, because pace is NOT fixed: crew temperament tilts
// it 0.88-1.17x and the hero (34 u/s) outruns the crew (28 u/s), so one cycle length could never fit them all.
//
// The cycle DISTANCE is DERIVED per set, never hardcoded, so it stays correct with any skin without retuning:
// stride length scales with the character's visible leg swing, divided by the number of walk frames
// that set actually ships. Transparent master-image packing is excluded from the measurement.
// Do NOT replace this with a constant units-per-frame: that silently over-spins short or oversized sets.
// Every other state keeps the clock; those aren't locomotion.
export class BodyAnimation<I extends SpriteResource, C extends SpriteCanvas<I | C>> {
  readonly sc: number;
  readonly stride: number;
  readonly turnFrameScale: number;
  readonly f: I;
  readonly fNext: I | null;
  readonly tween: number;
  readonly key: string;
  constructor(
    readonly pose: BodyPose<I, I | C>,
    input: { key: string; frames: readonly I[]; first: I; geometry: SpriteGeometry<I, C> },
  ) {
    this.key = input.key;
    this.sc = pose.assets.drawScaleFor(pose.set);
    this.stride =
      input.geometry.cycleUnitsFor(pose.set, this.sc, input.first.height) / input.frames.length;
    this.turnFrameScale =
      pose.set === "ultron" || pose.set === "minion" ? 1 : input.frames.length / 6;
    const body = pose.body;
    body._pose = this.key;
    body._renderTravelError = this.travelError();
    const index = this.index();
    body._renderFrame =
      input.frames.length > 1
        ? ((index % input.frames.length) + input.frames.length) % input.frames.length
        : 0;
    this.f = input.frames[body._renderFrame] ?? input.first;
    const phase = this.phase(input.frames.length),
      frac = phase === null ? 0 : phase - Math.floor(phase);
    this.tween = frac * frac * (3 - 2 * frac);
    this.fNext =
      this.tween > 0.02
        ? (input.frames[(body._renderFrame + 1) % input.frames.length] ?? null)
        : null;
    body._renderWalkTween = this.fNext ? +this.tween.toFixed(DIAGNOSTIC_PRECISION) : null;
  }
  // the pose this body is ACTUALLY being drawn in, recorded read-only during live verification
  // (dev/idlesoak.mjs asserts a waving body resolves to a `.gesture.` track). Nothing reads it
  // to make a decision — a rendering claim has to be provable from the render, not re-derived.
  // Compare the selected artwork with post-collision displacement from this simulation tick.
  // Screen culling can skip draws with seconds, so inter-draw positions are not a heading sample.
  private travelError() {
    const body = this.pose.body;
    return this.key.includes(".walk.") &&
      body._resolvedTravelHeading !== undefined &&
      !body._strideBlocked
      ? (Math.abs(
          ang(
            (DIR8_A[this.key.split(".").at(-1) ?? ""] ?? Number.NaN) - body._resolvedTravelHeading,
          ),
        ) *
          180) /
          Math.PI
      : null;
  }
  private index() {
    const { fixedIdx, turnStep, body, aph, nowMs, fps } = this.pose;
    if (fixedIdx !== null) return fixedIdx;
    if (turnStep)
      return Math.floor((body._turnAng || 0) * TURN_STEP_FRAMES * this.turnFrameScale + aph);
    if (this.key.includes(".walk.") && body.odo !== undefined && this.stride > 0)
      return Math.floor(body.odo / this.stride + aph);
    return Math.floor(nowMs / (MILLISECONDS_PER_SECOND / fps) + aph);
  }
  /* Neighbouring drawings blend in premultiplied space; pose and body position stay independent.
    Reduced motion keeps hard cuts. Smoothstep holds authored drawings crisp near their own phase. */
  // WALK IN-BETWEENS (22 September 2026, Andrew: "smooth out the walking frames"). An eight-drawing cycle
  // cut from one drawing to the next 14-26 times a second, and every cut read as a visible step.
  // The phase driving it is continuous (distance or swept angle), so the pose at phase k+frac is
  // drawn as drawing k crossfaded into drawing k+1, eased so each authored drawing still holds
  // crisp around its own phase. Only neighbouring drawings of ONE cycle blend, the body's position
  // is untouched (nothing floats), and reduced motion keeps the hard cuts.
  private phase(count: number) {
    const { fixedIdx, reduced, turnStep, body, aph } = this.pose;
    if (fixedIdx !== null || reduced || count < 2 || !this.key.includes(".walk.")) return null;
    if (turnStep) return (body._turnAng || 0) * TURN_STEP_FRAMES * this.turnFrameScale + aph;
    return body.odo !== undefined && this.stride > 0 ? body.odo / this.stride + aph : null;
  }
}
