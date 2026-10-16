import type { Worker } from "../scene/types.js";
import type { SpriteResource } from "../sprites/types.js";
import type { LabelContext } from "./label-types.js";
import { statusColor } from "./look.js";
import { shade } from "./primitives.js";
import type { ViewRuntime } from "./runtime.js";
import type { Anchor, TextPlate } from "./types.js";
const STATUS_DOT = { lift: 5, radius: 2.5, turn: Math.PI * 2 };
const TITLE = {
  lift: 6,
  margin: 24,
  hoverSize: 15,
  focusSize: 14,
  hoverPriority: 100,
  focusPriority: 90,
  blockedSize: 13,
  blockedPriority: 70,
};
const DETAILS = {
  width: 110,
  size: 12,
  lift: 18,
  shade: -0.35,
  priority: 10,
  overflowLift: 34,
  overflowPriority: 8,
};
const INSPECTION = { lift: 30, size: 13, priority: 95 };
export class WorkerLabels<R extends SpriteResource, B extends R = R> {
  constructor(readonly view: ViewRuntime<R, B>) {}
  collect(options: LabelContext): TextPlate[] {
    const inspectedId = this.view.inspected(),
      plates: TextPlate[] = [];
    for (const region of this.view.anchors) {
      const worker = this.view.workerIndex.get(region.id);
      if (!worker) continue;
      if (options.tier === "overview") this.statusDot(worker, region);
      const title = this.title(worker, region, options);
      if (title) plates.push(title);
      if (region.id === inspectedId) plates.push(this.inspection(region));
      const overflow = this.overflow(worker, region, options);
      if (overflow) plates.push(overflow);
    }
    return plates;
  }
  private statusDot(worker: Worker, region: Anchor) {
    const ctx = this.view.ctx;
    ctx.fillStyle = statusColor(this.view.S, worker.row.status);
    ctx.beginPath();
    ctx.arc(region.head.x, region.head.y - STATUS_DOT.lift, STATUS_DOT.radius, 0, STATUS_DOT.turn);
    ctx.fill();
  }
  private title(worker: Worker, region: Anchor, options: LabelContext): TextPlate | null {
    if (region.id === this.view.hovered)
      return this.activeTitle(region, {
        accent: worker.accent,
        size: TITLE.hoverSize,
        priority: TITLE.hoverPriority,
      });
    if (region.id === this.view.focused)
      return this.activeTitle(region, {
        accent: this.view.C.focus,
        size: TITLE.focusSize,
        priority: TITLE.focusPriority,
      });
    if (worker.row.status === "blocked")
      return {
        ...this.view.plates.textPlate(
          this.view.callbacks.nameFor(region.id) + " · WAITING",
          region.head.x,
          region.head.y - TITLE.lift,
          {
            accent: this.view.S.blocked,
            size: TITLE.blockedSize,
            color: this.view.S.blocked,
            priority: TITLE.blockedPriority,
          },
        ),
        target: region.id,
      };
    if (options.tier !== "detail" || !worker.row.worktree) return null;
    return this.view.plates.textPlate(
      this.view.plates.clipText(worker.row.worktree, DETAILS.width, DETAILS.size),
      region.head.x,
      region.foot + DETAILS.lift,
      {
        accent: shade(worker.accent, DETAILS.shade),
        size: DETAILS.size,
        color: this.view.C.dim,
        priority: DETAILS.priority,
      },
    );
  }
  private activeTitle(
    region: Anchor,
    style: { accent: string; size: number; priority: number },
  ): TextPlate {
    const label =
      this.view.callbacks.hoverLabel(region.id) || this.view.callbacks.nameFor(region.id);
    return {
      ...this.view.plates.textPlate(
        this.view.plates.clipText(label, this.view.viewport.width - TITLE.margin, style.size),
        region.head.x,
        region.head.y - TITLE.lift,
        { ...style, force: true },
      ),
      target: region.id,
    };
  }
  private inspection(region: Anchor) {
    return this.view.plates.textPlate(
      "⌕ inspecting",
      region.head.x,
      region.head.y - INSPECTION.lift,
      {
        accent: this.view.C.focus,
        size: INSPECTION.size,
        color: this.view.C.focus,
        priority: INSPECTION.priority,
      },
    );
  }
  private overflow(worker: Worker, region: Anchor, options: LabelContext) {
    const listed = this.view.overflowByWorker.get(region.id);
    if (!listed || options.tier === "overview") return null;
    const label = `+${String(listed)} helper${listed > 1 ? "s" : ""} in list`;
    return this.view.plates.textPlate(label, region.head.x, region.foot + DETAILS.overflowLift, {
      accent: shade(worker.accent, DETAILS.shade),
      size: DETAILS.size,
      color: this.view.C.dim,
      priority: DETAILS.overflowPriority,
    });
  }
}
