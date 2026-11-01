import type { ActorFrame, Point, Rect, Worker } from "../scene/types.js";
import type { SpriteResource } from "../sprites/types.js";
import { middle } from "./primitives.js";
import type { ViewRuntime } from "./runtime.js";
import type { DepthItem } from "./state-types.js";
import type { ArtPainters } from "./types.js";
import type { AssemblyOwner } from "./startup-assembly.js";
interface ItemFrame<R extends SpriteResource> {
  A: ArtPainters<R>;
  now: number;
  animate: boolean;
  ambient: boolean;
}
const ITEM = {
  deskHeight: 1.1,
  deskPadding: 16,
  effectPadding: 24,
  effectDepth: 0.01,
  ghostAlpha: 0.45,
  propPadding: 8,
  partitionHeight: 0.6,
  partitionPadding: 4,
  partitionEpsilon: 1e-6,
  apronHeight: 1.8,
  apronPadding: 44,
};
const CHAIR = { left: 0.3, top: 0.45, size: 0.6, height: 0.9, padding: 4, depth: 0.6 };
const VIEWER = { inset: 0.5, height: 2, padding: 12 };
export class StationItems<R extends SpriteResource, B extends R = R> {
  constructor(readonly view: ViewRuntime<R, B>) {}
  collect(frame: ItemFrame<R>) {
    const items: DepthItem[] = [],
      byId = new Map(this.view.actors.map((actor) => [actor.id, actor])),
      staleKeys = new Set<string>();
    for (const worker of this.view.activeScene.workers) {
      const own = this.view.workerStale(worker),
        live = frame.animate && !own;
      if (own) staleKeys.add(worker.platformKey);
      const owned = [...this.desks(worker, { ...frame, live }), ...this.chair(worker, frame.A)];
      const actor = byId.get(worker.id);
      if (actor) owned.push(this.crew(worker, actor, { ...frame, live }));
      items.push(...this.owned(owned, this.view.assemblyOwners.worker(worker)));
    }
    return { items, staleKeys };
  }
  private owned(items: DepthItem[], owner: AssemblyOwner | undefined): DepthItem[] {
    if (!this.view.assemblyFrame.active) return items;
    return items.map((item) => ({
      ...item,
      draw: () => {
        const regions = this.view.regions.length,
          anchors = this.view.anchors.length;
        this.view.framePaint.paintAssembly(owner, "content", item.draw);
        if (!this.view.assemblyVisible(owner)) {
          this.view.regions.length = regions;
          this.view.anchors.length = anchors;
        }
      },
    }));
  }
  private desks(worker: Worker, frame: ItemFrame<R> & { live: boolean }): DepthItem[] {
    const items: DepthItem[] = [],
      { A, now, live, ambient } = frame,
      helper = worker.kind === "helper";
    if (this.view.framePaint.onStage(worker.desk, ITEM.deskHeight, ITEM.deskPadding))
      items.push({
        depth: middle(worker.desk),
        draw: () => {
          if (helper) A.helperDesk(this.view.ctx, worker, now, live);
          else A.desk(this.view.ctx, worker, now, live);
        },
      });
    if (ambient && this.view.framePaint.onStage(worker.desk, ITEM.deskHeight, ITEM.effectPadding))
      items.push({
        depth: middle(worker.desk) + ITEM.effectDepth,
        draw: () => {
          this.view.platformEffects.paintDeskFx(worker, now, live);
        },
      });
    return items;
  }
  private chair(worker: Parameters<ArtPainters<R>["chair"]>[1], A: ArtPainters<R>): DepthItem[] {
    const c = worker.chair;
    if (
      !this.view.framePaint.onStage(
        { x: c.x - CHAIR.left, y: c.y - CHAIR.top, w: CHAIR.size, h: CHAIR.size },
        CHAIR.height,
        CHAIR.padding,
      )
    )
      return [];
    return [
      {
        depth: c.x + c.y - CHAIR.depth,
        draw: () => {
          A.chair(this.view.ctx, worker);
        },
      },
    ];
  }
  private crew(
    worker: Worker,
    actor: ActorFrame,
    frame: ItemFrame<R> & { live: boolean },
  ): DepthItem {
    const shadow = worker.row.shadow;
    return {
      depth: actor.point.x + actor.point.y,
      tie: worker.id,
      draw: () => {
        if (!shadow) {
          this.view.crew.paintCrew(worker, actor, frame.now, !frame.live);
          return;
        }
        const ctx = this.view.ctx;
        ctx.save();
        ctx.globalAlpha *= ITEM.ghostAlpha;
        const reduced = true;
        try {
          this.view.crew.paintCrew(worker, actor, frame.now, reduced);
        } finally {
          ctx.restore();
        }
      },
    };
  }
  observatory(A: ArtPainters<R>, now: number, animate: boolean): DepthItem[] {
    return this.owned(
      [...this.observatoryFurniture(A), ...this.observatoryProps(A, now, animate)],
      "observatory",
    );
  }
  private observatoryFurniture(A: ArtPainters<R>): DepthItem[] {
    const { desk, chair, viewer, overseer } = this.view.activeScene.observatory,
      items: DepthItem[] = [];
    if (!overseer) {
      if (this.view.framePaint.onStage(desk, ITEM.deskHeight, ITEM.deskPadding))
        items.push({
          depth: middle(desk),
          draw: () => {
            A.planningDesk(this.view.ctx, desk);
          },
        });
      items.push(...this.chair({ chair }, A));
    }
    if (viewer && this.viewerVisible(viewer.point))
      items.push({
        depth: viewer.point.x + viewer.point.y,
        tie: viewer.id,
        draw: () => {
          A.viewer(this.view.ctx, viewer);
        },
      });
    return items;
  }
  private viewerVisible(point: Point) {
    return this.view.framePaint.onStage(
      { x: point.x - VIEWER.inset, y: point.y - VIEWER.inset, w: 1, h: 1 },
      VIEWER.height,
      VIEWER.padding,
    );
  }
  private observatoryProps(A: ArtPainters<R>, now: number, animate: boolean): DepthItem[] {
    const ob = this.view.activeScene.observatory,
      items: DepthItem[] = [];
    for (const screen of ob.screens)
      if (this.view.framePaint.onStage(screen.rect, screen.height, ITEM.propPadding))
        items.push({
          depth: middle(screen.rect),
          draw: () => {
            A.screen(this.view.ctx, screen, now, animate);
          },
        });
    for (const telescope of ob.telescopes)
      if (this.view.framePaint.onStage(telescope.rect, telescope.height, ITEM.propPadding))
        items.push({
          depth: middle(telescope.rect),
          draw: () => {
            A.telescope(this.view.ctx, telescope, now, animate);
          },
        });
    if (this.view.framePaint.onStage(ob.plant.rect, ob.plant.height, ITEM.propPadding))
      items.push({
        depth: middle(ob.plant.rect),
        draw: () => {
          A.plant(this.view.ctx, ob.plant);
        },
      });
    if (this.view.framePaint.onStage(ob.light.rect, ob.light.height, ITEM.propPadding))
      items.push({
        depth: middle(ob.light.rect),
        draw: () => {
          A.lamp(this.view.ctx, ob.light);
        },
      });
    return items;
  }
  partitions(A: ArtPainters<R>): DepthItem[] {
    const items: DepthItem[] = [];
    for (const platform of this.view.activeScene.platforms)
      for (const section of platform.sections)
        for (const wall of section.partitions)
          items.push(
            ...this.owned(
              this.partitionWall(wall, A, platform.accent),
              this.view.assemblyOwners.platform(platform.key),
            ),
          );
    return items;
  }
  private partitionWall(wall: Rect, A: ArtPainters<R>, accent: string): DepthItem[] {
    const items: DepthItem[] = [];
    for (let x = wall.x; x < wall.x + wall.w - ITEM.partitionEpsilon; x++) {
      const unit = { x, y: wall.y, w: Math.min(1, wall.x + wall.w - x), h: wall.h },
        end = x + 1 >= wall.x + wall.w - ITEM.partitionEpsilon;
      if (this.view.framePaint.onStage(unit, ITEM.partitionHeight, ITEM.partitionPadding))
        items.push({
          depth: middle(unit),
          draw: () => {
            A.partition(this.view.ctx, unit, accent, end);
          },
        });
    }
    return items;
  }
  aprons(A: ArtPainters<R>): DepthItem[] {
    const items: DepthItem[] = [];
    for (const platform of this.view.activeScene.platforms)
      for (const region of platform.decorationRegions)
        if (
          region.kind === "apron" &&
          this.view.framePaint.onStage(region.rect, ITEM.apronHeight, ITEM.apronPadding)
        )
          items.push(
            ...this.owned(
              [
                {
                  depth: region.rect.x + region.rect.y + 1,
                  draw: () => {
                    A.apron(this.view.ctx, region);
                  },
                },
              ],
              this.view.assemblyOwners.platform(platform.key),
            ),
          );
    return items;
  }
}
