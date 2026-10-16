import type { SpriteResource } from "../sprites/types.js";
import type { Colors, TargetBox, ViewContext } from "./types.js";
const BADGE = {
  width: 14,
  height: 18,
  centerDivisor: 2,
  anchorGap: 4,
  rim: 2,
  rimExpansion: 4,
  focusInset: 1,
  focusExpansion: 2,
  markX: 5,
  stemY: 3,
  stemWidth: 4,
  stemHeight: 8,
  dotY: 13,
  dotHeight: 3,
  pointerY: 1,
  pointerHeight: 2,
  tipX: 6,
  tipY: 3,
  tipWidth: 2,
  boxExtraHeight: 7,
};
/* Theme-coloured pixel badge with a focus ring, dark exclamation and head pointer. Its screen-space box supplies hit bookkeeping. */
class AttentionPainter<R extends SpriteResource> {
  constructor(
    private readonly context: ViewContext<R>,
    private readonly colors: Colors,
    private readonly origin: { left: number; top: number },
  ) {}
  paint(): TargetBox {
    const c = this.context;
    c.save();
    this.plate();
    this.mark();
    c.restore();
    return {
      left: this.origin.left - BADGE.rim,
      top: this.origin.top - BADGE.rim,
      width: BADGE.width + BADGE.rimExpansion,
      height: BADGE.height + BADGE.boxExtraHeight,
    };
  }
  private plate() {
    const c = this.context,
      { left, top } = this.origin;
    c.fillStyle = this.colors["body-outline"];
    c.fillRect(
      left - BADGE.rim,
      top - BADGE.rim,
      BADGE.width + BADGE.rimExpansion,
      BADGE.height + BADGE.rimExpansion,
    );
    c.fillStyle = this.colors.focus;
    c.fillRect(
      left - BADGE.focusInset,
      top - BADGE.focusInset,
      BADGE.width + BADGE.focusExpansion,
      BADGE.height + BADGE.focusExpansion,
    );
    c.fillStyle = this.colors.blocked;
    c.fillRect(left, top, BADGE.width, BADGE.height);
  }
  private mark() {
    const c = this.context,
      { left, top } = this.origin;
    c.fillStyle = this.colors["body-outline"];
    c.fillRect(left + BADGE.markX, top + BADGE.stemY, BADGE.stemWidth, BADGE.stemHeight);
    c.fillRect(left + BADGE.markX, top + BADGE.dotY, BADGE.stemWidth, BADGE.dotHeight);
    c.fillStyle = this.colors.focus;
    c.fillRect(
      left + BADGE.markX,
      top + BADGE.height + BADGE.pointerY,
      BADGE.stemWidth,
      BADGE.pointerHeight,
    );
    c.fillRect(
      left + BADGE.tipX,
      top + BADGE.height + BADGE.tipY,
      BADGE.tipWidth,
      BADGE.pointerHeight,
    );
  }
}
export function paintAttention<R extends SpriteResource>(
  ctx: ViewContext<R>,
  x: number,
  bottom: number,
  colors: Colors,
) {
  return new AttentionPainter(ctx, colors, {
    left: Math.round(x - BADGE.width / BADGE.centerDivisor),
    top: Math.round(bottom - BADGE.height - BADGE.anchorGap),
  }).paint();
}
