import { HostLabels } from "./host-labels.js";
import type { LabelContext } from "./label-types.js";
import { PlatformLabels } from "./platform-labels.js";
import { StationLabels } from "./station-labels.js";
import { WorkerLabels } from "./worker-labels.js";
import type { SpriteResource } from "../sprites/types.js";
import { paintAttention } from "./attention.js";
import { lodFor, needsAttention, placePlates, stagePlates } from "./helpers.js";
import { hash } from "./primitives.js";
import type { PlateOptions, TextPlate } from "./types.js";
import type { ViewRuntime } from "./runtime.js";
import { present as required } from "./values.js";
const SIGN_SIZE = { min: 12, max: 22 };
const PLATE = {
  heightRatio: 1.35,
  diameter: 2,
  borderPair: 2,
  strokeInset: 0.5,
  headerHeight: 2,
  textInset: 6,
  rowCenter: 0.5,
};
const BADGE = { period: 380, phaseSlots: 7, bob: 2, overviewLift: 14, lift: 34 };

export class Plates<R extends SpriteResource, B extends R = R> {
  readonly platformLabels;
  readonly hostLabels;
  readonly stationLabels;
  readonly workerLabels;
  constructor(readonly view: ViewRuntime<R, B>) {
    this.platformLabels = new PlatformLabels(view);
    this.hostLabels = new HostLabels(view);
    this.stationLabels = new StationLabels(view);
    this.workerLabels = new WorkerLabels(view);
  }

  signSize = (base: number) =>
    Math.max(SIGN_SIZE.min, Math.min(SIGN_SIZE.max, base * this.view.camera.zoom));

  textPlate = (
    text: string,
    x: number,
    y: number,
    {
      accent = this.view.C.dim,
      size = 13,
      color = this.view.C.ink,
      priority = 0,
      force = false,
      dash = null,
    }: PlateOptions = {},
  ) => {
    this.view.ctx.font = String(size) + "px VT323, monospace";
    const width = Math.ceil(this.view.ctx.measureText(text).width) + 12,
      height = Math.round(size * PLATE.heightRatio);
    return {
      text,
      x: Math.round(x - width / PLATE.diameter),
      y: Math.round(y - height),
      w: width,
      h: height,
      accent,
      size,
      color,
      priority,
      force,
      dash,
    };
  };

  drawPlate = (plate: TextPlate) => {
    const { x, y } = plate;
    this.view.ctx.fillStyle = this.view.C.glass;
    this.view.ctx.fillRect(x, y, plate.w, plate.h);
    this.view.ctx.globalAlpha = 0.12;
    this.view.ctx.fillStyle = this.view.C["plate-scanline"];
    for (let sy = y + 2; sy < y + plate.h - 1; sy += 3)
      this.view.ctx.fillRect(x + 1, sy, plate.w - PLATE.borderPair, 1);
    this.view.ctx.globalAlpha = 1;
    this.view.ctx.strokeStyle = plate.accent;
    if (plate.dash) this.view.ctx.setLineDash(plate.dash);
    this.view.ctx.strokeRect(
      x + PLATE.strokeInset,
      y + PLATE.strokeInset,
      plate.w - 1,
      plate.h - 1,
    );
    this.view.ctx.setLineDash([]);
    this.view.ctx.fillStyle = plate.accent;
    this.view.ctx.fillRect(x + 1, y, plate.w - PLATE.borderPair, PLATE.headerHeight);
    this.view.ctx.font = String(plate.size) + "px VT323, monospace";
    this.view.ctx.textAlign = "left";
    this.view.ctx.textBaseline = "middle";
    this.view.ctx.fillStyle = plate.color;
    if (plate.lines)
      plate.lines.forEach((line, index) => {
        this.view.ctx.fillText(
          line,
          x + PLATE.textInset,
          y + ((index + PLATE.rowCenter) * plate.h) / required(plate.lines).length + 1,
        );
      });
    else this.view.ctx.fillText(plate.text, x + PLATE.textInset, y + plate.h / PLATE.diameter + 1);
  };

  clipText = (text: string, max: number, size: number) => {
    this.view.ctx.font = String(size) + "px VT323, monospace";
    if (this.view.ctx.measureText(text).width <= max) return text;
    let cut = text.length;
    while (cut > 1 && this.view.ctx.measureText(text.slice(0, cut) + "…").width > max) cut--;
    return text.slice(0, cut).trimEnd() + "…";
  };

  paintPlates = (isStale: boolean, staleKeys: Set<string>, now = 0, animate = false) => {
    this.view.ctx.setTransform(this.view.dpr, 0, 0, this.view.dpr, 0, 0);
    const tier = lodFor(this.view.camera.zoom),
      selectedRepo = this.view.repositorySelection();
    const options: LabelContext = { tier, selectedRepo, isStale, staleKeys };
    const plates = [
      ...this.platformLabels.collect(options),
      ...this.hostLabels.ships(options),
      ...this.hostLabels.observation(),
      ...this.hostLabels.relays(),
      ...this.stationLabels.hub(),
      ...this.stationLabels.observatory(options),
      ...this.workerLabels.collect(options),
    ];

    const accepted = placePlates(stagePlates(plates, this.view.viewport));

    for (const plate of accepted) this.drawPlate(plate);
    this.recordTargets(accepted);
    this.paintBadges(tier, now, animate);
    this.workerLabels.paintStatusDots();

    const obsPlate = accepted.find((plate) => plate.observatory);

    this.view.observatoryRegion = obsPlate
      ? { left: obsPlate.x, top: obsPlate.y, width: obsPlate.w, height: obsPlate.h }
      : null;

    this.view.plateFrame = {
      scene: this.view.activeScene,
      zoom: this.view.camera.zoom,
      tx: this.view.camera.tx,
      ty: this.view.camera.ty,
    };
    this.hoverBrackets();
  };
  recordTargets = (accepted: TextPlate[]) => {
    // Title hits are exactly the accepted, drawn plate boxes: never the body, never a dropped plate.
    this.view.titleRegions = accepted
      .filter((plate) => plate.target)
      .map((plate) => ({
        id: required(plate.target),
        left: plate.x,
        top: plate.y,
        width: plate.w,
        height: plate.h,
      }));

    // Repository hits are likewise only accepted, drawn section signs; platform headings and dropped signs have none.
    this.view.signRegions = accepted
      .filter((plate) => plate.repo)
      .map((plate) => ({
        repo: required(plate.repo),
        left: plate.x,
        top: plate.y,
        width: plate.w,
        height: plate.h,
      }));

    this.view.shipRegions = accepted
      .filter((plate) => plate.ship)
      .map((plate) => ({
        host: required(plate.ship).host,
        left: plate.x,
        top: plate.y,
        width: plate.w,
        height: plate.h,
      }));
  };
  paintBadges = (tier: ReturnType<typeof lodFor>, now: number, animate: boolean) => {
    /* Needs attention: a fresh blocked agent (startup dialog, permission prompt) carries a "!" badge above its head,
         drawn in screen pixels so it reads at every zoom, overview included. Per-frame like the body; never cached. */
    this.view.attentionRegions = [];

    for (const region of this.view.anchors) {
      const worker = this.view.workerIndex.get(region.id);
      if (!worker || !needsAttention(worker, this.view.workerStale(worker))) continue;
      const bob =
        animate && !this.view.callbacks.reducedMotion()
          ? Math.round(
              Math.sin(now / BADGE.period + (hash(worker.id) % BADGE.phaseSlots)) * BADGE.bob,
            )
          : 0;
      const box = paintAttention(
        this.view.ctx,
        region.head.x,
        region.head.y - (tier === "overview" ? BADGE.overviewLift : BADGE.lift) + bob,
        this.view.C,
      );
      this.view.attentionRegions.push({ id: region.id, ...box });
    }
  };
  hoverBrackets = () => {
    // Hover brackets around the real painted extent.
    const hover = this.view.regions.find((region) => region.id === this.view.hovered);

    if (hover) {
      const worker = this.view.workerIndex.get(required(this.view.hovered)),
        r = hover,
        arm = 6;
      this.view.ctx.strokeStyle = worker ? worker.accent : this.view.C.focus;
      this.view.ctx.lineWidth = 2;
      for (const [x, y, dx, dy] of [
        [r.left, r.top, 1, 1],
        [r.left + r.width, r.top, -1, 1],
        [r.left, r.top + r.height, 1, -1],
        [r.left + r.width, r.top + r.height, -1, -1],
      ] satisfies [number, number, number, number][]) {
        this.view.ctx.beginPath();
        this.view.ctx.moveTo(x, y + dy * arm);
        this.view.ctx.lineTo(x, y);
        this.view.ctx.lineTo(x + dx * arm, y);
        this.view.ctx.stroke();
      }
      this.view.ctx.lineWidth = 1;
    }
  };
}
