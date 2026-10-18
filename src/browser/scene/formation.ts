import { element } from "../model/types.js";
import { crosses } from "./navigation.js";
import { historicalPath, trailTarget, historyAt } from "./history.js";
import type { Actor, Graph, Point, Stale, Assignment, Worker, HistoryTarget } from "./types.js";
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
  clearStreak: 2,
};
type Proposal = { actor: Actor; side: number; target: HistoryTarget | null };
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
    const memberIds = members.map((actor) => actor.worker.id),
      membership = JSON.stringify(memberIds);
    const proposed = members.map((actor, i) => this.proposal(actor, i, members.length));
    const signature = JSON.stringify([
      membership,
      proposed.map((p) => (p.target ? [p.target.arc, p.target.dx, p.target.dy] : null)),
    ]);
    let group = this.parent.formation;
    if (!group || group.membership !== membership)
      group = {
        membership,
        memberIds,
        mode: "single",
        streak: 0,
        signature: null,
        advance: null,
      };
    this.parent.formation = group;
    this.advanceGroup(proposed, signature);
    return proposed.map((p, i) => ({
      actor: p.actor,
      side: group.mode === "pairs" ? p.side : 0,
      target:
        group.mode === "pairs" ? p.target : trailTarget(this.parent, (i + 1) * FORMATION.firstLag),
      assignment: JSON.stringify([this.parent.worker.id, membership, group.mode, i]),
    }));
  }
  private proposal(actor: Actor, i: number, count: number): Proposal {
    const side =
      i === count - 1 && count % FORMATION.diameter
        ? 0
        : i % FORMATION.diameter
          ? FORMATION.pairOffset
          : -FORMATION.pairOffset;
    return {
      actor,
      side,
      target: trailTarget(
        this.parent,
        FORMATION.firstLag + FORMATION.rowLag * Math.floor(i / FORMATION.diameter),
        side,
      ),
    };
  }
  private settledGroup(proposed: Proposal[]) {
    const group = this.parent.formation;
    // A resting leader cannot advance another arc bucket. Finish the ordered lag
    // before treating settled followers as the second clear regroup observation.
    return (
      group?.mode === "single" &&
      group.streak > 0 &&
      this.parent.path.length === 0 &&
      proposed.every((p, i) => {
        const target = trailTarget(this.parent, (i + 1) * FORMATION.firstLag);
        return (
          target &&
          p.actor.path.length === 0 &&
          p.actor.cursor !== null &&
          p.actor.cursor !== undefined &&
          p.actor.cursor >= target.arc
        );
      })
    );
  }
  private advanceGroup(proposed: Proposal[], signature: string) {
    const group = this.parent.formation,
      settled = this.settledGroup(proposed);
    if (group && (group.signature !== signature || settled)) {
      // The centre stripe fills the space between pair feet, proving the full squad envelope.
      const clear = proposed.every(
        (p) =>
          p.target &&
          clearEnvelope(
            this.graph,
            historicalPath(this.parent, p.target.arc - FORMATION.arcBucket, p.target, p.side),
          ) &&
          (p.side !== -FORMATION.pairOffset ||
            clearEnvelope(
              this.graph,
              historicalPath(
                this.parent,
                p.target.arc - FORMATION.arcBucket,
                historyAt(this.parent, p.target.arc),
                0,
              ),
            )),
      );
      const advance = Math.floor(this.parent.arc / FORMATION.arcBucket);
      if (!clear) {
        group.mode = "single";
        group.streak = 0;
      } else if (
        group.mode === "single" &&
        (group.advance !== advance || settled) &&
        ++group.streak >= FORMATION.clearStreak
      )
        group.mode = "pairs";
      group.advance = advance;
      group.signature = signature;
    }
  }
}
