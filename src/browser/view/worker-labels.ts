import type { Worker } from "../scene/types.js";
import { toScreen } from "../scene/index.js";
import { checkoutSuffix } from "../model/identity.js";
import type { SpriteResource } from "../sprites/types.js";
import type { LabelContext } from "./label-types.js";
import { statusColor } from "./look.js";
import { shade } from "./primitives.js";
import type { ViewRuntime } from "./runtime.js";
import type { Anchor, TextPlate } from "./types.js";
const STATUS_DOT = { lift: 5, radius: 2.5, turn: Math.PI * 2 };
const TITLE = {
  lift: 12,
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
};
const INSPECTION = { lift: 38, size: 13, priority: 95 };
const DESK_BADGE = {
  gap: 4,
  height: 18,
  width: 114,
  inset: 4,
  size: 13,
  priority: 60,
  separation: 2,
  corners: 4,
  paddingTrim: 8,
};
interface DeskAnchor {
  worker: Worker;
  x: number;
  y: number;
}
export class WorkerLabels<R extends SpriteResource, B extends R = R> {
  constructor(readonly view: ViewRuntime<R, B>) {}
  collect(options: LabelContext): TextPlate[] {
    const inspectedId = this.view.inspected(),
      plates: TextPlate[] = [];
    for (const region of this.view.anchors) {
      const worker = this.view.workerIndex.get(region.id);
      if (!worker) continue;
      const title = this.title(worker, region, options);
      if (title) plates.push(title);
      if (region.id === inspectedId) plates.push(this.inspection(region));
    }
    return [...plates, ...this.deskBadges(options)];
  }
  private deskBadges(options: LabelContext): TextPlate[] {
    const scene = this.view.activeScene;
    const desks = scene.workers
      .filter(
        (worker) => options.selectedRepo !== null && worker.row.repoId === options.selectedRepo,
      )
      .map((worker) => {
        const { x, y, w, h } = worker.desk;
        const corners = [
          { x, y },
          { x: x + w, y },
          { x, y: y + h },
          { x: x + w, y: y + h },
        ].map((point) => toScreen(point, this.view.camera));
        return {
          worker,
          x: corners.reduce((sum, point) => sum + point.x, 0) / DESK_BADGE.corners,
          y: Math.max(...corners.map((point) => point.y)) + DESK_BADGE.gap,
        };
      });
    return desks.flatMap((desk) => this.deskBadge(desk, desks));
  }
  private deskBadge(desk: DeskAnchor, desks: DeskAnchor[]): TextPlate[] {
    const { gap, height, width, separation, inset, size, priority } = DESK_BADGE;
    const viewport = this.view.viewport;
    if (
      desk.x < gap ||
      desk.x > viewport.width - gap ||
      desk.y < gap ||
      desk.y + height > viewport.height - gap
    )
      return [];
    const space = Math.min(
      width,
      separation * (desk.x - gap),
      separation * (viewport.width - gap - desk.x),
      ...desks
        .filter((other) => other !== desk && Math.abs(other.y - desk.y) < height)
        .map((other) => Math.abs(other.x - desk.x) - separation),
    );
    this.view.ctx.font = String(size) + "px VT323, monospace";
    if (space < inset + this.view.ctx.measureText("…").width) return [];
    const fullText = this.checkoutText(desk.worker, desks);
    const overlays = this.view.framePaint.overlays;
    const color = overlays.repositoryColor(desk.worker.id);
    const plate = this.view.plates.textPlate(
      this.view.plates.clipText(fullText, space - inset, size),
      desk.x,
      desk.y + height,
      { size, accent: color, color, priority },
    );
    // Flat desk badges use two-pixel side padding; passive plates retain six.
    return [
      {
        ...plate,
        x: plate.x + DESK_BADGE.paddingTrim / separation,
        w: plate.w - DESK_BADGE.paddingTrim,
        badge: { id: desk.worker.id, fullText },
      },
    ];
  }
  private checkoutText(worker: Worker, desks: DeskAnchor[]): string {
    const row = worker.row;
    if (!row.checkoutId) return "Checkout unavailable";
    if (row.checkoutKind === "folder") return "Local folder";
    if (row.checkoutKind === "main") {
      const name = row.observedRepo === undefined ? row.repo : row.observedRepo;
      return name ? name + " · main" : "Checkout unavailable";
    }
    if (!row.worktree) return "Checkout unavailable";
    if (row.checkoutKind !== "worktree") return "Checkout unavailable";
    const ids = desks.map(({ worker: entry }) => entry.row.checkoutId);
    return row.worktree + " · " + checkoutSuffix(row.checkoutId, ids);
  }
  paintStatusDots() {
    for (const region of this.view.anchors) {
      const worker = this.view.workerIndex.get(region.id);
      if (worker) this.statusDot(worker, region);
    }
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
    if (
      options.tier !== "detail" ||
      !worker.row.worktree ||
      worker.row.repoId === options.selectedRepo
    )
      return null;
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
}
