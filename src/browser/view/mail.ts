import { project as P } from "../scene/index.js";
import type { SpriteResource } from "../sprites/types.js";
import { stackEnvelopes } from "./helpers.js";
import type { MailFrame } from "./types.js";
import type { ViewRuntime } from "./runtime.js";
const ENVELOPE = { halfWidth: 7, halfHeight: 5, width: 14, height: 10, labelInset: 10 };

export class Mail<R extends SpriteResource, B extends R = R> {
  constructor(readonly view: ViewRuntime<R, B>) {}

  paintMail = (mail: MailFrame, now: number, animate: boolean) => {
    for (const { envelope, lift } of stackEnvelopes(mail.envelopes)) {
      const anchor = P(envelope.point),
        at = { x: anchor.x, y: anchor.y - lift };
      this.view.ctx.save();
      this.view.ctx.globalAlpha = envelope.alpha;
      this.view.ctx.fillStyle = envelope.color;
      this.view.ctx.fillRect(
        at.x - ENVELOPE.halfWidth,
        at.y - ENVELOPE.halfHeight,
        ENVELOPE.width,
        ENVELOPE.height,
      );
      this.view.ctx.strokeStyle = this.view.C["envelope-outline"];
      this.view.ctx.strokeRect(
        at.x - ENVELOPE.halfWidth,
        at.y - ENVELOPE.halfHeight,
        ENVELOPE.width,
        ENVELOPE.height,
      );
      this.view.ctx.beginPath();
      this.view.ctx.moveTo(at.x - ENVELOPE.halfWidth, at.y - ENVELOPE.halfHeight);
      this.view.ctx.lineTo(at.x, at.y + 1);
      this.view.ctx.lineTo(at.x + ENVELOPE.halfWidth, at.y - ENVELOPE.halfHeight);
      this.view.ctx.stroke();
      if (envelope.count > 1 || envelope.label || envelope.mark) {
        this.view.ctx.font = "13px VT323, monospace";
        this.view.ctx.textAlign = "left";
        this.view.ctx.textBaseline = "middle";
        this.view.ctx.fillStyle = envelope.mark ? this.view.C["envelope-mark"] : this.view.C.ink;
        this.view.ctx.fillText(
          [
            envelope.label,
            envelope.count > 1 ? "×" + String(envelope.count) : "",
            envelope.mark ? "!" : "",
          ]
            .filter(Boolean)
            .join(" "),
          at.x + ENVELOPE.labelInset,
          at.y,
        );
      }
      this.view.ctx.restore();
    }
    const art = this.view.resources.artPainters();
    for (const drone of mail.drones) art.drone(this.view.ctx, drone, now, animate);
  };
}
