const MAX_SPEECH_DELTA_MS = 100;
const SPEECH_EASE_MS = 180;
const PHRASE_ACCENT_FAST_MS = 410;
const PHRASE_ACCENT_SLOW_MS = 970;
const PHRASE_PHASE_RATIO = 0.7;
const BREATH_PERIOD_MS = 1050;
const MIN_BREATH_HEIGHT = 12;
const FOOTPRINT_HALF = 2;
const MIN_SHADOW_RADIUS = 4.5;
const SHADOW_WIDTH_RATIO = 0.21;
const DIAGNOSTIC_PRECISION = 3;
import type { SpriteResource, SpriteCanvas, SpriteContext } from "./types.js";
import type { BodyAnimation } from "./animation.js";
import type { SpriteGeometry } from "./geometry.js";
import { POSE_FADE_MS } from "./facing.js";
export class BodyPlacement<I extends SpriteResource, C extends SpriteCanvas<I | C>> {
  constructor(
    readonly animation: BodyAnimation<I, C>,
    readonly geometry: SpriteGeometry<I, C>,
    readonly context: SpriteContext<I | C>,
  ) {}
  // SEAT LIFT: a body seated on a raised single-tile seat (stool/chair) draws its pixels this many px
  // higher so the hips land on the seat pad — world.js's planSeat measured it off the prop art. The
  // sort key and the ground shadow deliberately stay at b.py (the seat tile's floor line): only the
  // SPRITE rises, the shadow pool remains on the deck under the stool where light actually lands.
  // Gated on the RESOLVED track actually being a sit pose: a set with no sit frames (minionchar,
  // 10 August 2026) falls back to rot/stand, and lifting a STANDING body onto the pad reads as levitation.
  private seatLift() {
    const { pose, key } = this.animation,
      body = pose.body;
    const workstation =
      pose.assets.isReviewSet(pose.set) &&
      body.sitting &&
      !body.seated &&
      (body.working || body.goal === "work")
        ? 7
        : 0;
    return body.sitting && /\.(sit|type)\./.test(key) ? body.seatLift || workstation : 0;
  }
  // Keep the approved boots against the floor contact. The legacy three-world-pixel
  // lift separated an 18px body from its shadow by one sixth of its visible height.
  // perched: anchor by THIS sit frame's own bottom padding (getTrackPad), not the standing footPad —
  // sets whose sit master carries extra empty rows below the tucked legs (skeleton) otherwise float.
  // Walking masters have slightly different packing below their boots. A set-wide idle
  // pad made those differences into floor penetration and floating during the cycle.
  private contact() {
    const { f, fNext, tween, sc, pose, key } = this.animation;
    const sourceHeight = pose.assets.metadataFor(pose.set).sourceStandingHeight;
    const groundBite = sourceHeight ? -0.25 : -3,
      seatLift = this.seatLift();
    pose.body._renderStandingHeight = sourceHeight ? sourceHeight * sc : null;
    const walking = key.includes(".walk.") && !pose.turnStep;
    const framePad = fNext
      ? this.geometry.getFramePad(f) +
        (this.geometry.getFramePad(fNext) - this.geometry.getFramePad(f)) * tween
      : this.geometry.getFramePad(f);
    const pad =
      (walking
        ? framePad
        : seatLift
          ? this.geometry.getTrackPad(key)
          : this.geometry.getFootPad(pose.set)) * sc;
    return { groundBite, seatLift, framePad, pad };
  }
  private offFloor() {
    const body = this.animation.pose.body;
    return body.noShadow || body.seated || body.sitting || body.sleeping;
  }
  private easeSpeech() {
    const { body, nowMs } = this.animation.pose;
    const motionDt = Math.max(0, Math.min(MAX_SPEECH_DELTA_MS, nowMs - (body._speechAt || nowMs)));
    body._speechAt = nowMs;
    const want = body.speaking ? 1 : 0;
    body._speechEase =
      (body._speechEase || 0) +
      (want - (body._speechEase || 0)) * (1 - Math.exp(-motionDt / SPEECH_EASE_MS));
    return body._speechEase;
  }
  private planted() {
    const { pose, key } = this.animation,
      body = pose.body;
    const offFloor = this.offFloor();
    const moving = body.state === "sleep" || body.state === "walk" || body.working;
    const interacting = pose.meeting || pose.glancing || pose.turnStep;
    const speaking = body.speaking && !pose.assets.isReviewSet(pose.set);
    return !offFloor && !moving && !interacting && !speaking && /\.(rot|blink|talk)\./.test(key);
  }
  /* Standing breath deforms about fixed feet, leaving authored walk/pivot/furniture/sleep/gesture motion alone.
    Phrase accents are uneven visual beats, never purported audio lip-sync. */
  // Quiet standing breath changes the torso's height by less than a quarter world unit as
  // its measured foot line stays fixed. Existing walk/pivot, furniture, sleep, talk and gesture
  // tracks own their motion. Portraits keep their established framing. Omitting appearance
  // preserves the original three-argument renderer until the caller opts into local lighting.
  private breathing(active: boolean, contact: ReturnType<BodyPlacement<I, C>["contact"]>) {
    const { pose, f, sc } = this.animation,
      body = pose.body,
      { nowMs, aph } = pose;
    const planted = active && this.planted(),
      bob = pose.reduced || planted ? 0 : pose.bob;
    const speechEase = this.easeSpeech();
    const accent = Math.max(
      0,
      Math.sin(nowMs / PHRASE_ACCENT_FAST_MS + aph) *
        Math.sin(nowMs / PHRASE_ACCENT_SLOW_MS + aph * PHRASE_PHASE_RATIO),
    );
    const speech = planted && !pose.reduced ? speechEase * accent : 0;
    body._renderSpeechAccent = speech;
    const breath =
      planted && !pose.reduced
        ? Math.sin(nowMs / BREATH_PERIOD_MS + aph) * 0.12 - speech * 0.18
        : 0;
    const breathScale = 1 + breath / Math.max(MIN_BREATH_HEIGHT, f.height * sc - contact.pad);
    return { planted, bob, speech, breathScale };
  }
  /* Snap to DEVICE pixels: rounding world units causes multi-device-pixel jumps at camera zoom.
    Keep native masters until draw time with smoothing; drawing detail survives zoom without changing floor size.
    A sit frame uses its own packing; walking interpolates each master's padding to avoid foot penetration. */
  // footprint = native master × per-set scale → identical on-floor size as before, but f is now the
  // full-resolution master. Draw it DOWN to that size with smoothing ON so the detail survives (and
  // stays sharp when the camera zooms in, because it resamples straight from the 92px master each frame).
  // SUB-UNIT positioning. This used to be Math.round() on the raw world coordinate — i.e. a snap to integer
  // WORLD units. But the camera scales 0.5-6x (default 2), so one unit of rounding landed as a 2-6 DEVICE-pixel
  // jump, and at 34 u/s (~0.57 units per frame) the body held still across ~2 frames and then hopped a whole unit.
  // That was the loudest "sprites aren't smooth" artefact, in every direction, independent of turning. Note the
  // camera's own panX/panY were never rounded, so the world was already sub-pixel as the body alone snapped.
  // We round to the nearest DEVICE pixel instead: still crisply pixel-aligned (no resample blur at rest), but
  // sub-unit in world space, so motion is continuous. Do NOT put Math.round back on the world coordinate.
  place(active: boolean) {
    const { pose, f, sc } = this.animation,
      body = pose.body;
    const contact = this.contact(),
      motion = this.breathing(active, contact),
      { pad, seatLift, groundBite } = contact;
    const matrix = this.context.getTransform?.(),
      zoom = matrix && matrix.a > 0 ? matrix.a : 1;
    const snap = (value: number) => Math.round(value * zoom) / zoom;
    const dw = f.width * sc,
      dh = f.height * sc,
      drawHeight = dh * motion.breathScale,
      x = snap(body.px - dw / FOOTPRINT_HALF);
    const y = motion.planted
      ? snap(body.py + groundBite - seatLift) - (dh - pad) * motion.breathScale
      : snap(body.py - dh + groundBite + motion.bob + pad - seatLift);
    body._renderGroundGap = body.py - (y + (dh - contact.framePad * sc) * motion.breathScale);
    body._renderCycleUnits = this.geometry.cycleUnitsFor(pose.set, sc, f.height);
    return {
      ...contact,
      ...motion,
      snap,
      dw,
      dh,
      drawHeight,
      x,
      y,
      shR: Math.max(MIN_SHADOW_RADIUS, dw * SHADOW_WIDTH_RATIO),
    };
  }
  private previousPose() {
    const { pose, key } = this.animation,
      body = pose.body,
      prev = body._poseLast;
    if (pose.reduced || body.noShadow || !prev || prev.key === key) return null;
    return pose.nowMs - prev.at < 200 && Math.hypot(body.px - prev.px, body.py - prev.py) < 6
      ? prev
      : null;
  }
  /* Resolve fades before any pixel work: culled and painted bodies must carry identical render state. */
  fade(placement: ReturnType<BodyPlacement<I, C>["place"]>) {
    const { pose, key, f } = this.animation,
      body = pose.body,
      { nowMs, reduced, set } = pose;
    if (body._spriteGroup !== set) {
      body._poseLast = null;
      body._poseFade = null;
      body._spriteGroup = set;
    }
    const prev = this.previousPose();
    if (prev)
      body._poseFade = {
        f: prev.f,
        ox: prev.x - prev.px,
        oy: prev.y - prev.py,
        w: prev.w,
        h: prev.h,
        at: nowMs,
      };
    const fade = body._poseFade,
      ft = fade && !reduced ? (nowMs - fade.at) / POSE_FADE_MS : 1,
      fading = !!fade && ft < 1;
    if (fade && !fading) body._poseFade = null;
    body._renderPoseFade = fading ? +ft.toFixed(DIAGNOSTIC_PRECISION) : null;
    body._poseLast = {
      key,
      f,
      x: placement.x,
      y: placement.y,
      px: body.px,
      py: body.py,
      w: placement.dw,
      h: placement.drawHeight,
      at: nowMs,
    };
    return { fade: fading ? fade : null, ft };
  }
}
export type Placement<I extends SpriteResource, C extends SpriteCanvas<I | C>> = ReturnType<
  BodyPlacement<I, C>["place"]
>;
export type PoseTransition<I extends SpriteResource, C extends SpriteCanvas<I | C>> = ReturnType<
  BodyPlacement<I, C>["fade"]
>;
