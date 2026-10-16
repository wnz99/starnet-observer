import { project } from "../scene/index.js";
import type { Point, PropExtent } from "../scene/types.js";
import type { SpriteResource } from "../sprites/types.js";
import {
  type LightingTime,
  MAIL_LIGHT,
  OBSERVATORY_LIGHT,
  SPARKS,
  type SparkRecipe,
  pulse,
} from "./furniture-lighting.js";
import { center } from "./primitives.js";
import type { ViewRuntime } from "./runtime.js";
import { present } from "./values.js";
export class HubEffects<R extends SpriteResource, B extends R = R> {
  constructor(readonly view: ViewRuntime<R, B>) {}
  paint(time: LightingTime) {
    this.mail(time);
    this.observatory(time);
  }
  private spark(point: Point, key: string, time: LightingTime, recipe: SparkRecipe) {
    if (!time.animate) return;
    const { prefix, height, color, alt, ...options } = recipe;
    const at = project({ ...point, z: height });
    this.view.effects.sparks({ x: at.x, y: at.y }, prefix + key, time.now, {
      ...options,
      color: this.view.C[color],
      alt: this.view.C[alt],
    });
  }
  private mail(time: LightingTime) {
    const mail = this.view.activeScene.mail;
    if (!this.view.framePaint.onStage(mail.rect, MAIL_LIGHT.height, MAIL_LIGHT.padding)) return;
    const top = { ...center(mail.tower), z: MAIL_LIGHT.towerHeight };
    this.view.geometry.glow(top, MAIL_LIGHT.towerRadius, {
      color: this.view.C.amber,
      alpha: MAIL_LIGHT.towerStrength * pulse(time, MAIL_LIGHT.towerPeriod),
      transparent: this.view.C["glow-transparent"],
    });
    this.view.geometry.glow({ ...top, z: MAIL_LIGHT.baseHeight }, MAIL_LIGHT.baseRadius, {
      color: this.view.C.window,
      alpha: MAIL_LIGHT.baseStrength * pulse(time, MAIL_LIGHT.basePeriod, 1),
      transparent: this.view.C["glow-transparent"],
    });
    for (const pad of mail.pads) this.mailPad(pad, time);
    this.spark(top, "", time, SPARKS.tower);
    const pod = present(mail.pod[0]);
    this.view.geometry.glow({ x: pod.x, y: pod.y, z: MAIL_LIGHT.podHeight }, MAIL_LIGHT.podRadius, {
      color: this.view.C.cyan,
      alpha: MAIL_LIGHT.podStrength * pulse(time, MAIL_LIGHT.podPeriod),
      transparent: this.view.C["glow-transparent"],
    });
    this.spark(pod, "", time, SPARKS.pod);
  }
  private mailPad(pad: Point, time: LightingTime) {
    this.view.geometry.glow(pad, MAIL_LIGHT.padRadius, {
      color: this.view.C.amber,
      alpha: MAIL_LIGHT.padStrength * pulse(time, MAIL_LIGHT.padPeriod, pad.x),
      transparent: this.view.C["glow-transparent"],
    });
    if (!time.animate) return;
    const ring = (time.now / MAIL_LIGHT.padPeriod + pad.x) % 1,
      ctx = this.view.ctx;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = (1 - ring) * MAIL_LIGHT.ringAlpha;
    this.view.geometry.isoEllipse(pad, MAIL_LIGHT.ringStart + MAIL_LIGHT.ringGrowth * ring, {
      stroke: this.view.C.window,
      fill: null,
      width: MAIL_LIGHT.ringWidth,
    });
    ctx.restore();
  }
  private observatory(time: LightingTime) {
    const ob = this.view.activeScene.observatory;
    if (!this.view.framePaint.onStage(ob.rect, OBSERVATORY_LIGHT.height, OBSERVATORY_LIGHT.padding))
      return;
    for (const screen of ob.screens) this.observatoryScreen(screen, time);
    for (const telescope of ob.telescopes) this.telescope(telescope, time);
    const plant = ob.plant.rect,
      point = {
        x: plant.x + OBSERVATORY_LIGHT.plantInset,
        y: plant.y + OBSERVATORY_LIGHT.plantInset,
      };
    this.view.geometry.glow(
      { ...point, z: OBSERVATORY_LIGHT.plantHeight },
      OBSERVATORY_LIGHT.plantRadius,
      {
        color: this.view.S.working,
        alpha: OBSERVATORY_LIGHT.plantStrength * pulse(time, OBSERVATORY_LIGHT.plantPeriod),
        transparent: this.view.C["glow-transparent"],
      },
    );
    this.spark(point, "", time, SPARKS.plant);
    const light = ob.light.rect;
    this.view.geometry.glow(
      {
        x: center(light).x,
        y: center(light).y + OBSERVATORY_LIGHT.beaconForward,
        z: OBSERVATORY_LIGHT.beaconHeight,
      },
      OBSERVATORY_LIGHT.beaconRadius,
      {
        color: this.view.C.cyan,
        alpha: OBSERVATORY_LIGHT.beaconStrength * pulse(time, OBSERVATORY_LIGHT.beaconPeriod),
        transparent: this.view.C["glow-transparent"],
      },
    );
  }
  private observatoryScreen(screen: PropExtent, time: LightingTime) {
    const r = screen.rect,
      point = { x: r.x + r.w / 2, y: r.y + OBSERVATORY_LIGHT.screenInset };
    this.view.geometry.glow(
      { ...point, z: screen.height * OBSERVATORY_LIGHT.screenHeightRatio },
      OBSERVATORY_LIGHT.screenRadius,
      {
        color: this.view.C.cyan,
        alpha: OBSERVATORY_LIGHT.screenStrength * pulse(time, OBSERVATORY_LIGHT.screenPeriod, r.x),
        transparent: this.view.C["glow-transparent"],
      },
    );
    this.spark(point, String(r.x), time, { ...SPARKS.screen, height: screen.height });
  }
  private telescope(telescope: PropExtent, time: LightingTime) {
    const r = telescope.rect,
      tip = {
        x: r.x + r.w / 2,
        y: r.y + r.h / 2 - OBSERVATORY_LIGHT.telescopeForward,
        z: telescope.height - OBSERVATORY_LIGHT.telescopeDrop,
      };
    this.view.geometry.glow(tip, OBSERVATORY_LIGHT.telescopeRadius, {
      color: this.view.C.cyan,
      alpha: OBSERVATORY_LIGHT.telescopeStrength * pulse(time, OBSERVATORY_LIGHT.telescopePeriod),
      transparent: this.view.C["glow-transparent"],
    });
    this.spark(tip, String(r.x), time, { ...SPARKS.telescope, height: tip.z });
  }
}
