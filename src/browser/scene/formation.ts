import { element } from "../model/types.js";
import { crosses, safeSegment, pathTo } from "./navigation.js";
import { trailTarget, historyAt } from "./history.js";
import type {
  Actor,
  Graph,
  Point,
  Stale,
  Assignment,
  Worker,
  HistoryTarget,
  Formation,
} from "./types.js";
const FORMATION = {
  bodyRadius: 0.28,
  helperScale: 0.72,
  clearance: 0.1,
  diameter: 2,
  minimumTrail: 1,
  pairOffset: 0.6,
  firstLag: 1.6,
  rowLag: 1.2,
  arcBucket: 0.8,
  headingPrecision: 1e8,
};
function clearEnvelope(graph: Graph, points: readonly Point[]) {
  const radius = FORMATION.bodyRadius * FORMATION.helperScale + FORMATION.clearance,
    r = graph.rect;
  if (
    points.length === 0 ||
    points.some(
      (p) =>
        p.x < r.x + radius ||
        p.x > r.x + r.w - radius ||
        p.y < r.y + radius ||
        p.y > r.y + r.h - radius,
    )
  )
    return false;
  return points.every(
    (point, i) =>
      !graph.obstacles.some((o) =>
        crosses(
          {
            x: o.x - radius,
            y: o.y - radius,
            w: o.w + radius * FORMATION.diameter,
            h: o.h + radius * FORMATION.diameter,
          },
          i ? element(points, i - 1) : point,
          point,
        ),
      ),
  );
}
export const closed = (worker: Worker) =>
  worker.row.lifecycleEvidence?.state === "closed" || worker.row.lineageState === "closed";
export const atDesk = (worker: Worker) => ["working", "blocked"].includes(worker.row.status ?? "");
export const verified = (worker: Worker) =>
  ["open", "verified"].includes(worker.row.lineageState ?? "");
export const isStale = (worker: Worker, stale: Stale) =>
  typeof stale === "function" ? stale(worker) : stale;
function eligibleHelper(actor: Actor, stale: Stale) {
  return (
    actor.worker.kind === "helper" &&
    Number.isFinite(actor.depth) &&
    !isStale(actor.worker, stale) &&
    !closed(actor.worker) &&
    !atDesk(actor.worker)
  );
}
function eligibleParent(parent: Actor) {
  return (
    !parent.frozen &&
    !closed(parent.worker) &&
    !atDesk(parent.worker) &&
    (parent.worker.row.status === "idle" ||
      (parent.worker.kind === "helper" && !!parent.followParent)) &&
    parent.trail.length > FORMATION.minimumTrail
  );
}
export function canFollow(actor: Actor, parent: Actor | undefined, stale: Stale): parent is Actor {
  return eligibleHelper(actor, stale) && parent !== undefined && eligibleParent(parent);
}
export class FormationPlanner {
  constructor(
    private parent: Actor,
    private ordered: { actor: Actor; depth: number }[],
    private graph: Graph,
    private stale: Stale,
  ) {}
  plan(): Assignment[] {
    const members = this.ordered
      .map((entry) => entry.actor)
      .filter(
        (actor) =>
          actor.worker.parentId === this.parent.worker.id &&
          canFollow(actor, this.parent, this.stale),
      );
    const moving = this.parent.path.length > 0,
      tangent = this.tangent(),
      anchor = moving
        ? historyAt(
            this.parent,
            Math.floor(this.parent.arc / FORMATION.arcBucket) * FORMATION.arcBucket,
          )
        : tangent && { ...tangent, point: this.parent.point };
    const signature = JSON.stringify([
        moving,
        moving ? anchor?.arc : anchor?.point,
        tangent && [tangent.dx, tangent.dy],
      ]),
      group = this.updateTargets(members, { anchor, tangent, moving, signature });
    return members.map((actor, i) => ({
      actor,
      route: group.targets ? "compact" : "history",
      side: group.targets ? this.side(i, members.length) : 0,
      target: group.targets
        ? element(group.targets, i)
        : trailTarget(this.parent, (i + 1) * FORMATION.firstLag),
      assignment: JSON.stringify([this.parent.worker.id, group.membership, group.mode, i]),
    }));
  }
  private groupFor(members: Actor[]): Formation {
    const memberIds = members.map((actor) => actor.worker.id),
      membership = JSON.stringify(memberIds);
    let group = this.parent.formation;
    if (!group || group.membership !== membership || group.graph !== this.graph)
      group = {
        membership,
        memberIds,
        mode: "single",
        signature: null,
        targets: null,
        graph: this.graph,
      };
    this.parent.formation = group;
    return group;
  }
  private tangent() {
    const target = historyAt(this.parent, this.parent.arc);
    if (!target) return null;
    const scale = FORMATION.headingPrecision / Math.hypot(target.dx, target.dy),
      dx = Math.round(target.dx * scale) / FORMATION.headingPrecision,
      dy = Math.round(target.dy * scale) / FORMATION.headingPrecision,
      length = Math.hypot(dx, dy);
    return { ...target, dx: dx / length, dy: dy / length };
  }
  private updateTargets(
    members: Actor[],
    input: {
      anchor: HistoryTarget | null;
      tangent: HistoryTarget | null;
      moving: boolean;
      signature: string;
    },
  ) {
    const { anchor, tangent, moving, signature } = input;
    const group = this.groupFor(members);
    if (group.signature !== signature) {
      const retained = group.targets?.[0];
      const heading = !moving && retained ? retained : tangent;
      group.targets =
        anchor && heading ? this.compactTargets(members, anchor, heading, moving) : null;
      group.mode = group.targets ? "pairs" : "single";
      group.signature = signature;
    }
    return group;
  }
  private side(i: number, count: number) {
    return i === count - 1 && count % FORMATION.diameter
      ? 0
      : i % FORMATION.diameter
        ? FORMATION.pairOffset
        : -FORMATION.pairOffset;
  }
  private compactTargets(
    members: Actor[],
    anchor: HistoryTarget,
    heading: HistoryTarget,
    moving: boolean,
  ) {
    const directions = [{ x: heading.dx, y: heading.dy }];
    if (!moving)
      directions.push(
        { x: -heading.dx, y: -heading.dy },
        { x: -heading.dy, y: heading.dx },
        { x: heading.dy, y: -heading.dx },
      );
    for (const d of directions) {
      const at = (lag: number, side: number): Point => ({
        x: anchor.point.x - d.x * lag - d.y * side,
        y: anchor.point.y - d.y * lag + d.x * side,
        z: 0,
      });
      const targets = members.map((_, i): HistoryTarget => ({
        arc: anchor.arc,
        dx: d.x,
        dy: d.y,
        point: at(
          FORMATION.firstLag + FORMATION.rowLag * Math.floor(i / FORMATION.diameter),
          this.side(i, members.length),
        ),
      }));
      if (!this.clearFootprint(at, members.length)) continue;
      const reachable = members.every((actor, i) => {
        const target = element(targets, i).point;
        return (
          safeSegment(this.graph, actor.point, target, actor.worker) ||
          pathTo(this.graph, actor.point, target, actor.worker).length > 0
        );
      });
      if (reachable) return targets;
    }
    return null;
  }
  private clearFootprint(at: (lag: number, side: number) => Point, count: number) {
    // Every lateral row and all three longitudinal stripes belong to this current footprint.
    const rows = Math.ceil(count / FORMATION.diameter);
    const clearRows = Array.from({ length: rows }, (_, row) => {
      const lag = FORMATION.firstLag + FORMATION.rowLag * row,
        tail = row * FORMATION.diameter === count - 1;
      return clearEnvelope(
        this.graph,
        tail ? [at(lag, 0)] : [at(lag, -FORMATION.pairOffset), at(lag, FORMATION.pairOffset)],
      );
    }).every(Boolean);
    const clearStripes = [-FORMATION.pairOffset, 0, FORMATION.pairOffset].every((side) =>
      clearEnvelope(this.graph, [
        at(0, 0),
        ...Array.from({ length: rows }, (_, row) =>
          at(FORMATION.firstLag + FORMATION.rowLag * row, side),
        ),
      ]),
    );
    return clearRows && clearStripes;
  }
}
