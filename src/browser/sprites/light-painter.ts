const DARK_RAMP_ALPHA = 0.17;
const NEUTRAL_RAMP_STOP = 0.48;
const LIGHT_RAMP_ALPHA = 0.24;
const EDGE_OFFSET = 1.6;
import type { SpriteResource, SpriteCanvas, QuantizedLight } from "./types.js";
export class LightPainter<I extends SpriteResource, C extends SpriteCanvas<I | C>> {
  private bodyLightScratch: C | null = null;
  constructor(private readonly createCanvas: () => C) {}
  paint(frame: I | C, canvas: C, light: QuantizedLight) {
    const g = canvas.getContext("2d");
    if (!g || g.isContextLost?.()) return false;
    const w = frame.width | 0,
      h = frame.height | 0;
    g.drawImage(frame, 0, 0);
    const cx = w / 2,
      cy = h * 0.43,
      reach = Math.max(w, h) * 0.43;
    const ramp = g.createLinearGradient(
      cx - light.dx * reach,
      cy - light.dy * reach,
      cx + light.dx * reach,
      cy + light.dy * reach,
    );
    ramp.addColorStop(0, "rgba(12,20,34," + String(DARK_RAMP_ALPHA * light.strength) + ")");
    ramp.addColorStop(NEUTRAL_RAMP_STOP, "rgba(12,20,34,0)");
    ramp.addColorStop(
      1,
      "rgba(" + light.color.join(",") + "," + String(LIGHT_RAMP_ALPHA * light.strength) + ")",
    );
    // source-atop retains the master's alpha exactly, including its antialiased silhouette.
    g.globalCompositeOperation = "source-atop";
    g.fillStyle = ramp;
    g.fillRect(0, 0, w, h);
    const edge = this.edge({ frame, w, h, light });
    if (edge) {
      g.globalAlpha = 0.42 * light.strength;
      g.drawImage(edge, 0, 0);
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
    return true;
  }
  private edge({
    frame,
    w,
    h,
    light,
  }: {
    frame: I | C;
    w: number;
    h: number;
    light: QuantizedLight;
  }) {
    if (!this.bodyLightScratch) this.bodyLightScratch = this.createCanvas();
    this.bodyLightScratch.width = w;
    this.bodyLightScratch.height = h;
    const edge = this.bodyLightScratch.getContext("2d");
    if (edge && !edge.isContextLost?.()) {
      edge.drawImage(frame, 0, 0);
      edge.globalCompositeOperation = "destination-out";
      edge.drawImage(frame, -light.dx * EDGE_OFFSET, -light.dy * EDGE_OFFSET);
      edge.globalCompositeOperation = "source-in";
      edge.fillStyle = "rgb(" + light.color.join(",") + ")";
      edge.fillRect(0, 0, w, h);
      return this.bodyLightScratch;
    }
    return null;
  }
}
