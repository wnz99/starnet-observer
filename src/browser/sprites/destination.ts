import type { SpriteResource, SpriteContext } from "./types.js";
const REENTRY_DEVICE_MARGIN = 2;
/* Re-entry preserves source sample phase and paint order. Warm beyond the destination bitmap before shadows,
   using whole device pixels at the same scale. Only positive axis-aligned transforms can be moved safely. */
export class DestinationWarmup<R extends SpriteResource> {
  constructor(private readonly context: SpriteContext<R>) {}
  private aligned() {
    const matrix = this.context.getTransform?.();
    return matrix && matrix.a > 0 && matrix.d > 0 && !matrix.b && !matrix.c ? matrix : null;
  }
  draw(draws: readonly (readonly [R, number, number, number, number])[]) {
    const context = this.context,
      canvas = context.canvas,
      m = this.aligned();
    if (!canvas || !(canvas.width > 0) || !m) return;
    const left = Math.min(...draws.map((draw) => draw[1]));
    const shift = Math.max(0, Math.ceil(canvas.width + REENTRY_DEVICE_MARGIN - (m.a * left + m.e)));
    context.save();
    try {
      context.imageSmoothingEnabled = true;
      if ("imageSmoothingQuality" in context) context.imageSmoothingQuality = "high";
      context.setTransform(m.a, 0, 0, m.d, m.e + shift, m.f);
      for (const [source, x, y, w, h] of draws) context.drawImage(source, x, y, w, h);
    } finally {
      context.restore();
    }
  }
}
