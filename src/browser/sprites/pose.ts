const IDLE_BOB_PERIOD_MS = 600;
const MILLISECONDS_PER_SECOND = 1000;
import type { SpriteResource, SpriteBody } from "./types.js";
import type { SpriteAssets } from "./loading.js";
import { SpriteFacing, DIR8_A, TURN_STEP_W, ang } from "./facing.js";
export class BodyPose<I extends SpriteResource, R extends SpriteResource> {
  key: string | null = null;
  fps = 8;
  bob = 0;
  turnStep = false;
  fixedIdx: number | null = null;
  readonly glancing: boolean;
  readonly meeting: boolean;
  readonly dir: string;
  readonly aph: number;
  readonly dir8: string;
  readonly body: SpriteBody<R>;
  readonly nowMs: number;
  readonly reduced: boolean;
  readonly set: string;
  // per-agent animation offset. Prefer the FLOAT `aph`: `phase` is an integer (world.js needs it as a
  // PHASES[] index with the mood engine), and a whole-frame offset ticks every body's cycle on the same
  // 100ms boundaries — the crew animated in lockstep. Bodies without `aph` (dossier portrait) fall back.
  constructor(
    readonly assets: SpriteAssets<I>,
    input: { body: SpriteBody<R>; nowMs: number; reduced: boolean; set: string },
  ) {
    this.body = input.body;
    this.nowMs = input.nowMs;
    this.reduced = input.reduced;
    this.set = input.set;
    const glance =
      this.body.state !== "walk" && this.body.glance && this.body.glance.until > this.nowMs
        ? this.body.glance
        : null;
    this.glancing = !!glance;
    this.meeting = !!this.body.meet && this.body.meet.until > this.nowMs;
    this.dir = glance ? glance.dir : this.body.dir || "south";
    this.aph = this.body.aph ?? (this.body.phase || 0);
    this.dir8 = new SpriteFacing(this.body).renderDir8(this.dir, this.glancing, this.nowMs);
  }
  /* pick best available animation key with a body state */
  private pick(names: readonly string[], dir: string) {
    for (const n of names) {
      const exact = this.set + "." + n + "." + dir;
      if (this.assets.frames[exact]) return exact;
    }
    // fall back to any direction of first available name, then south rot
    for (const n of names) {
      for (const d of ["south", "east", "west", "north"]) {
        const k = this.set + "." + n + "." + d;
        if (this.assets.frames[k]) return k;
      }
    }
    return this.assets.frames[this.set + ".rot.south"] ? this.set + ".rot.south" : null;
  }
  /* prefer the 8-bucket direction when the set ships it, else the exact old 4-dir path */
  private pick8(names: readonly string[], dir8: string, dir: string) {
    if (dir8 !== dir) {
      for (const n of names) {
        const k = this.set + "." + n + "." + dir8;
        if (this.assets.frames[k]) return k;
      }
    }
    return this.pick(names, dir);
  }

  select() {
    if (this.meeting) {
      this.key = this.pick8(["rot"], this.dir8, this.dir);
      this.fps = 4;
    } else if (this.body.state === "walk") this.walk();
    else if (this.body.working && !this.glancing) {
      // Typing art is north-only on some skins: prefer a correctly facing sit/stand over a reversed worker.
      this.working();
      this.fps = 6;
    } else if (this.body.state === "social" && this.body.sitting) {
      // can in hand reads best from the front; otherwise face what you came with
      this.key = this.body.hasCan
        ? this.pick(["drink", "sit"], "south")
        : this.pick(["sit"], this.dir);
      this.fps = 6;
    } else if (this.body.sitting) {
      this.key = this.pick(["sit", "rot"], this.dir);
      this.fps = 4;
    } else if (this.body.speaking) {
      // Keep the feet planted. No whole-body hop as a substitute when mouth art is absent.
      this.key = this.pick8(["talk", "rot"], this.dir8, this.dir);
      this.fps = 6;
      this.bob = 0;
    } else this.idle();
  }
  private working() {
    this.key = this.pick(this.body.sitting ? ["type", "sit", "rot"] : ["rot"], this.dir);
  }
  private gestureAllowed() {
    const body = this.body;
    return (
      !this.reduced &&
      body.state !== "walk" &&
      !body.working &&
      !body.sitting &&
      !body.speaking &&
      !this.meeting &&
      !this.glancing
    );
  }
  private walk() {
    this.key = this.pick8(this.body._strideBlocked ? ["rot"] : ["walk"], this.dir8, this.dir);
    this.fps = 10;
    // Four-direction artwork must choose its closest AVAILABLE facing from actual travel.
    // Falling back to b.dir on a diagonal can select the wrong side of the quadrant.
    if (
      !this.body._strideBlocked &&
      this.body._resolvedTravelHeading !== undefined &&
      (!this.assets.frames[this.set + ".walk." + this.dir8] ||
        !this.assets.frames[this.set + ".walk.north-east"])
    ) {
      let nearest = Infinity;
      for (const [facing, angle] of Object.entries(DIR8_A)) {
        const candidate = this.set + ".walk." + facing;
        const error = Math.abs(ang(angle - this.body._resolvedTravelHeading));
        if (this.assets.frames[candidate] && error < nearest) {
          nearest = error;
          this.key = candidate;
        }
      }
    }
  }
  private idle() {
    this.key = this.pick8(["rot"], this.dir8, this.dir);
    this.bob = Math.sin(this.nowMs / IDLE_BOB_PERIOD_MS + this.aph) * 0.7;
    // PIVOT STEP. A standing body that changes facing used to hold a frozen idle pose as the
    // sprite rotated under it — the "it just slides round" read. Nobody turns like that; you
    // shuffle your feet. While the facing is actively sweeping, borrow the set's WALK frames and
    // spend the swept ANGLE on them, so the legs step the body around. Angle-phased, not
    // clock-phased, so the shuffle stops dead the instant the turn does.
    // NOT during a glance: a glance is a ~380ms look toward something, i.e. a HEAD turn. Letting
    // it drive the legs made a body take a full stride to look sideways and step back again.
    // The facing still eases round; only the footwork is suppressed.
    if (
      !this.assets.isReviewSet(this.set) &&
      !this.glancing &&
      (this.body._rW || 0) > TURN_STEP_W
    ) {
      const wk = this.pick8(["walk"], this.dir8, this.dir);
      if (wk) {
        this.key = wk;
        this.turnStep = true;
        this.bob *= 0.35;
      }
    }
  }
  gesture() {
    // life-like idle gesture: a standing body occasionally plays its set's one-shot `gesture`
    // track (stretch / arm movement) ONCE through, then returns to the rot pose. Staggered per
    // agent like the blink so the crew never moves in unison. The index is derived from the
    // window's own progress (fixedIdx), NOT the free-running clock — a clock index would enter
    // the animation mid-cycle. Sets without a gesture track skip this entirely.
    /* This track is a STRETCH. It is fired here, on its own slow ambient clock, and nowhere else:
           an attempt to reuse it on demand (reaching toward a prop, working an arcade cabinet, waving)
           was removed 8 August 2026 because a stretch played at those moments reads as a glitch. New
           meanings need new frames, not this one re-labelled. */

    if (this.key && this.key.indexOf(".rot.") !== -1 && this.gestureAllowed()) {
      // EXACT direction only — never fall back to another facing. Most sets ship the stretch
      // on the 4 cardinals alone (the diagonals would cost 4 more generations each and are
      // unreachable in practice: a body that stops walking leaves its diagonal within ~50ms
      // and holds a cardinal when idle, and only an idle body stretches). Falling back would
      // snap the body 45° throughout the stretch — the same visible pop this pass
      // was built to remove.
      const kd = this.key.slice(this.key.lastIndexOf(".") + 1);
      const gk = this.assets.frames[this.set + ".gesture." + kd]
        ? this.set + ".gesture." + kd
        : null;
      if (gk) {
        const frames = this.assets.frames;
        const GFPS = 8,
          glen = frames[gk]?.length ?? 0,
          gdur = glen * (1000 / GFPS);
        // a stretch is a RARE beat (Observation on 31 July 2026): once every ~90 minutes per body,
        // not an every-cycle tic. Each body's fire-point is spread uniformly across the
        // period via its float phase, so the crew never stretches in unison — and a fresh
        // boot still sees SOMEONE stretch early rather than everyone at minute 90.
        const GESTURE_PERIOD = 5400000;
        const gph = (Math.abs(this.aph) % (2 * Math.PI)) / (2 * Math.PI);
        const gt = (this.nowMs + gph * GESTURE_PERIOD) % GESTURE_PERIOD;
        if (gt < gdur) {
          this.key = gk;
          this.fixedIdx = Math.min(glen - 1, Math.floor(gt / (MILLISECONDS_PER_SECOND / GFPS)));
          this.bob = 0; // the frames carry the motion; bobbing on top reads as jitter
        }
      }
    }
  }
  blink() {
    // life-like idle blink: when standing on a 'rot' pose, briefly shut the eyes.
    // staggered per-agent via b.phase so the crew doesn't blink in unison.
    // keyed off the RESOLVED key's own direction (may be a diagonal): swapping to a cardinal
    // blink frame under a diagonal pose would snap the head 45° with the blink's 130ms.
    if (
      !this.reduced &&
      this.key &&
      this.key.indexOf(".rot.") !== -1 &&
      this.body.state !== "walk"
    ) {
      const bk = this.set + ".blink." + this.key.slice(this.key.lastIndexOf(".") + 1);
      if (this.assets.frames[bk]) {
        const bt = (this.nowMs + this.aph * 900) % 3300;
        if (bt < 130) this.key = bk;
      }
    }
  }
}
