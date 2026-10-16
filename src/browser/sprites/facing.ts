const MAX_RENDER_DELTA_MS = 100;
const BRAKING_DISTANCE_FACTOR = 2;
import type { SpriteBody, SpriteResource } from "./types.js";

/* ---------- 8-direction render facing ----------
     world.js keeps game-logic facing 4-valued (`b.dir`) — glance/sit/OPP/social all speak that
     vocabulary and must keep doing so. Smooth turning is a RENDER concern, so it lives here:
     each body carries a render-side facing angle that slews toward what the game wants (the
     continuous walk heading `b.faceA` during walking, the bucketed `dir` otherwise) at the SAME
     rate stepGait turns a walking body, then buckets into EIGHT sectors with hysteresis. A body
     turning 180° therefore walks its pose through the diagonal in ~2 steps instead of teleporting
     it, and a body that stops on a diagonal eases to its cardinal instead of popping.
     Sets that don't ship diagonal frames are untouched: pick8 falls straight back to the old
     4-dir pick on `b.dir`, so this is a no-op with every skin until its diagonals exist. */
export const DIR8_A: Record<string, number> = {
  east: 0,
  "south-east": Math.PI / 4,
  south: Math.PI / 2,
  "south-west": (3 * Math.PI) / 4,
  west: Math.PI,
  "north-west": (-3 * Math.PI) / 4,
  north: -Math.PI / 2,
  "north-east": -Math.PI / 4,
};

/* A turn has WEIGHT. The first pass slewed the facing at a flat rate, which is exactly a
     turntable: the pose rotated at constant angular speed and the body appeared to slide around
     its own axis ("it just perfectly spins" — Observation on 1 August 2026). Two changes fixed the turn, and
     neither needs new art:
       1. the facing ACCELERATES and BRAKES. `_rW` is angular velocity, ramped by TURN_ACCEL and
          capped by the sqrt term so it arrives at the target with zero speed instead of stopping
          dead. Same shape as the linear speed easing stepGait already does.
       2. the feet keep the score. `_turnAng` accumulates radians actually swept, and drawBody
          spends it on WALK frames, so a pivoting body steps its legs around instead of holding a
          frozen idle pose as the sprite rotates underneath it. */
const TURN_MAX = 9;
// rad/s ceiling — below the old flat 12 so the turn is legible
const TURN_ACCEL = 55;
// rad/s²: spins up in ~160ms and brakes into the target
export const TURN_STEP_W = 1.2;
// rad/s a standing body must exceed before its feet shuffle
export const TURN_STEP_FRAMES = 4 / Math.PI;
// walk frames per radian swept ≈ 2 frames per 90° pivot
const DIR8_HYST = 0.1;
// rad a sector holds past its boundary sectors have π/8 half-width.
export const POSE_FADE_MS = 110;
// outgoing pose dissolves under the incoming one in drawBody.
const WALK_FACE_TRUST = 0.9;
// rad: walking art follows the eased facing unless displacement disagrees by more
export const ang = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export class SpriteFacing<R extends SpriteResource> {
  constructor(private readonly body: SpriteBody<R>) {}
  renderDir8(dir: string, glancing: boolean, nowMs: number) {
    // During walking (except glances), follow the true continuous heading; otherwise the game dir
    // Arcing bodies travel ALONG their eased facing, so faceA is the smooth truth; raw displacement carries
    // every separation nudge and flipped the 8-way pose back and forth within a frame or two. Displacement
    // still wins when the two genuinely disagree (a shove, a chord step) so art never walks backwards.
    // A displacement that matches the step the gait itself chose (b._travelHeading) is not evidence against
    // the facing: that is a slow chord step as the body is still turning (the first steps of a U-turn).
    const travel = this.travel();
    const want =
      !glancing && this.body.state === "walk" && travel !== undefined ? ang(travel) : DIR8_A[dir];
    if (want === undefined) return dir;
    this.move(want, glancing, nowMs);
    return this.sector(dir);
  }
  private sector(dir: string) {
    const cur = this.body._rD8;
    // Walking holds its sector past the boundary too: an arcing body sweeps through every sector once,
    // and separation nudges near a 22.5° edge used to flip the pose back and forth frame to frame.
    if (
      cur &&
      DIR8_A[cur] !== undefined &&
      Math.abs(ang((this.body._rA ?? 0) - DIR8_A[cur])) < Math.PI / 8 + DIR8_HYST
    )
      return cur;
    let best = dir,
      bd = Infinity;
    for (const d in DIR8_A) {
      const t = Math.abs(ang((this.body._rA ?? 0) - (DIR8_A[d] ?? 0)));
      if (t < bd) {
        bd = t;
        best = d;
      }
    }
    return (this.body._rD8 = best);
  }

  private travel() {
    const moved = this.body._resolvedTravelHeading,
      faced = this.body.faceA,
      own = this.body._travelHeading;
    const shoved = moved !== undefined && (own === undefined || Math.abs(ang(moved - own)) > 0.5);
    return moved === undefined
      ? faced
      : faced === undefined || (shoved && Math.abs(ang(moved - faced)) > WALK_FACE_TRUST)
        ? moved
        : faced;
  }
  private move(want: number, glancing: boolean, nowMs: number) {
    const dt = Math.max(0, Math.min(MAX_RENDER_DELTA_MS, nowMs - (this.body._rAt || 0))); // clamp: first frame / tab-restore must not spin
    this.body._rAt = nowMs;
    if (this.body._rA === undefined) {
      this.body._rA = want;
      this.body._rW = 0;
      this.body._turnAng = 0;
    }
    // New bodies snap immediately without interpolation.
    else if (this.body.state === "walk" && !glancing) {
      // Locomotion already eases facing; a second lag draws a backwards-moving body.
      this.body._rA = want;
      this.body._rW = 0;
    } else {
      const turn = ang(want - this.body._rA),
        remain = Math.abs(turn);
      const s = dt / 1000;
      // brake so the facing ARRIVES at rest: v = sqrt(2·a·s) is the fastest it can still stop in time
      const target = Math.min(TURN_MAX, Math.sqrt(BRAKING_DISTANCE_FACTOR * TURN_ACCEL * remain));
      const cur = this.body._rW || 0;
      this.body._rW =
        cur < target
          ? Math.min(target, cur + TURN_ACCEL * s)
          : Math.max(target, cur - TURN_ACCEL * s);
      const swept = Math.min(remain, this.body._rW * s);
      this.body._rA = ang(this.body._rA + Math.sign(turn) * swept);
      this.body._turnAng = (this.body._turnAng || 0) + swept;
    }
  }
}
