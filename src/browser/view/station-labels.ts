import { toScreen } from "../scene/index.js";
import type { SpriteResource } from "../sprites/types.js";
import type { LabelContext } from "./label-types.js";
import { center } from "./primitives.js";
import type { ViewRuntime } from "./runtime.js";
import type { TextPlate } from "./types.js";
const MAIL_SIGN = { height: 3.4, size: 18, priority: 45 };
const OBSERVATORY_SIGN = { height: 3.6, size: 18, priority: 44 };
const VIEWER_SIGN = { height: 2, size: 12, priority: 6 };
export class StationLabels<R extends SpriteResource, B extends R = R> {
  constructor(readonly view: ViewRuntime<R, B>) {}
  hub(): TextPlate[] {
    const mail = this.view.activeScene.mail;
    const tower = mail.tower;
    const at = toScreen({ ...center(tower), z: MAIL_SIGN.height }, this.view.camera);
    return [
      this.view.plates.textPlate("MAILROOM · llm-bus", at.x, at.y, {
        accent: this.view.C.amber,
        size: this.view.plates.signSize(MAIL_SIGN.size),
        color: this.view.C.window,
        priority: MAIL_SIGN.priority,
      }),
    ];
  }
  observatory(options: LabelContext): TextPlate[] {
    const observatory = this.view.activeScene.observatory,
      rect = observatory.rect;
    const at = toScreen(
      { x: center(rect).x, y: rect.y, z: OBSERVATORY_SIGN.height },
      this.view.camera,
    );
    const plates: TextPlate[] = [
      {
        ...this.view.plates.textPlate(
          observatory.overseer ? "OBSERVATORY ✦ overseer" : "OBSERVATORY ✦",
          at.x,
          at.y,
          {
            accent: this.view.C.cyan,
            size: this.view.plates.signSize(OBSERVATORY_SIGN.size),
            color: this.view.C.cyan,
            priority: OBSERVATORY_SIGN.priority,
          },
        ),
        observatory: true,
      },
    ];
    if (options.tier !== "overview" && observatory.viewer) {
      const viewer = observatory.viewer,
        head = toScreen({ ...viewer.point, z: VIEWER_SIGN.height }, this.view.camera);
      plates.push(
        this.view.plates.textPlate(viewer.label + " · ambient", head.x, head.y, {
          accent: this.view.C["viewer-label"],
          size: VIEWER_SIGN.size,
          color: this.view.C.dim,
          priority: VIEWER_SIGN.priority,
        }),
      );
    }
    return plates;
  }
}
