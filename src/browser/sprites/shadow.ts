const PENUMBRA_RINGS = 12;
const PENUMBRA_STEPS = 11;
const PENUMBRA_SHRINK = 0.82;
const PENUMBRA_ALPHA_BASE = 0.016;
const PENUMBRA_ALPHA_GAIN = 0.043;
const SHADOW_SQUASH = 0.38;
const MIN_LIFT_SCALE = 0.5;
const LIFT_DECAY = 0.14;
const CONTACT_ALPHA = 0.2;
const CAST_WIDTH_RATIO = 1.14;
const CAST_ANGLE = 0.18;
const FULL_TURN_FACTOR = 2;
const CONTACT_WIDTH_RATIO = 0.42;
const CONTACT_HEIGHT_RATIO = 0.115;
import type { SpriteResource, SpriteContext, ShadowOptions } from "./types.js";
const rings = Array.from({ length: PENUMBRA_RINGS }, (_, i) => {
  const t = i / PENUMBRA_STEPS;
  return [1 - t * PENUMBRA_SHRINK, PENUMBRA_ALPHA_BASE + t * PENUMBRA_ALPHA_GAIN] as const;
});
const shadowSquash = SHADOW_SQUASH;
/* A broad faint penumbra reaches from the north-west key, converging on a compact contact core.
   Fixed rings avoid per-frame gradients and canvases. Lift fades contact faster than cast shadow;
   activity spill remains diffuse and has no dark contact core. */
/* ---------- deck contact and directional body shadow ----------
     A broad, faint penumbra reaches south-east under the north-west key. Its
     centre converges on the feet as it darkens, rather than drawing concentric
     bullseye bands. A separate compact contact core gives the body weight.
     Fixed rings avoid gradients/canvases allocated across every walking frame.
     Lift fades the contact faster than the cast shadow; seated bodies use the
     same path with their existing reduced opacity and footprint. Coloured
     activity spill remains diffuse and never acquires a dark contact core. */
export class GroundShadow<R extends SpriteResource> {
  constructor(private readonly context: SpriteContext<R>) {}
  draw(cx: number, cy: number, rx: number, options: ShadowOptions = {}) {
    const lift = Math.max(0, options.lift || 0),
      k = 1 - Math.min(MIN_LIFT_SCALE, lift * LIFT_DECAY);
    const spread = rx * k * (options.spread || 1);
    if (!(spread > 0.5)) return;
    const context = this.context,
      a0 = context.globalAlpha,
      ink = context.fillStyle;
    const fade = k * (options.alpha ?? 1);
    context.fillStyle = options.color || "#080d19";
    try {
      this.rings({ cx, cy, spread, fade, a0, options });
      if (!options.color) this.contact({ cx, cy, spread, alpha: a0 * CONTACT_ALPHA * fade * k });
    } finally {
      context.globalAlpha = a0;
      context.fillStyle = ink;
    }
  }
  private rings({
    cx,
    cy,
    spread,
    fade,
    a0,
    options,
  }: {
    cx: number;
    cy: number;
    spread: number;
    fade: number;
    a0: number;
    options: ShadowOptions;
  }) {
    const context = this.context,
      direction = options.direction ?? { x: 1, y: 0.62 };
    for (const [radius, alpha] of rings) {
      const reach = options.color ? 0.08 : 0.48 * radius * radius;
      context.globalAlpha = a0 * alpha * fade * (options.color ? 1.2 : 1);
      context.beginPath();
      context.ellipse(
        cx + spread * reach * direction.x,
        cy + spread * reach * direction.y,
        spread * radius * (options.color ? 1 : CAST_WIDTH_RATIO),
        spread * radius * shadowSquash,
        options.color ? 0 : CAST_ANGLE,
        0,
        Math.PI * FULL_TURN_FACTOR,
      );
      context.fill();
    }
  }
  private contact({
    cx,
    cy,
    spread,
    alpha,
  }: {
    cx: number;
    cy: number;
    spread: number;
    alpha: number;
  }) {
    this.context.globalAlpha = alpha;
    this.context.beginPath();
    this.context.ellipse(
      cx,
      cy,
      spread * CONTACT_WIDTH_RATIO,
      spread * CONTACT_HEIGHT_RATIO,
      0,
      0,
      Math.PI * FULL_TURN_FACTOR,
    );
    this.context.fill();
  }
}
