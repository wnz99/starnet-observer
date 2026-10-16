import { required } from "../model/types.js";
import { hash } from "../model/identity.js";
import { graphFor } from "./navigation.js";
import { ActorState } from "./actor.js";
import { verified, canFollow, FormationPlanner } from "./formation.js";
import type {
  Scene,
  MotionOptions,
  Point,
  Graph,
  Assignment,
  ActorFrame,
  Worker,
} from "./types.js";
const MAX_FRAME_MS = 250;
const MOVED_EPSILON = 0.001;
const MAX_HELPER_DEPTH = 3;
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
class Movement {
  private readonly actors = new Map<string, ActorState>();
  private page: number | null = null;
  private last: number | null = null;
  private revision: string | null = null;
  private graphs = new Map<string, Graph>();
  private ordered: { actor: ActorState; depth: number }[] = [];
  reset() {
    this.actors.clear();
    this.graphs.clear();
    this.ordered = [];
    this.page = null;
    this.last = null;
    this.revision = null;
  }
  reconcile(scene: Scene, { now, reduced = false }: MotionOptions & { now: number }) {
    if (this.page !== scene.page) this.reset();
    this.page = scene.page;
    const geometryChanged = this.revision !== scene.revision;
    if (geometryChanged) {
      this.graphs = new Map(scene.platforms.map((p) => [p.key, graphFor(p)]));
      this.revision = scene.revision;
    }
    const ids = new Set(scene.workers.map((w) => w.id));
    for (const id of this.actors.keys()) if (!ids.has(id)) this.actors.delete(id);
    for (const worker of scene.workers) {
      const actor = this.actorFor(worker, now);
      actor.reconcileWorker(worker, { geometryChanged, reduced });
    }
    this.orderActors();
    if (this.last === null) this.last = now;
  }
  private actorFor(worker: Worker, now: number) {
    let actor = this.actors.get(worker.id);
    const moved =
      !actor ||
      actor.worker.platformKey !== worker.platformKey ||
      distance(actor.worker.chair, worker.chair) > MOVED_EPSILON;
    if (!actor || moved) {
      actor = new ActorState(worker, now, hash(worker.id));
      this.actors.set(worker.id, actor);
    }
    return actor;
  }
  private orderActors() {
    this.ordered = [...this.actors.values()]
      .map((actor) => ({ actor, depth: this.depth(actor) }))
      .sort((a, b) => {
        const left = a.actor.worker,
          right = b.actor.worker;
        return (
          a.depth - b.depth ||
          (left.helperSlot ?? -1) - (right.helperSlot ?? -1) ||
          left.id.localeCompare(right.id)
        );
      });
    for (const entry of this.ordered) entry.actor.depth = entry.depth;
    for (const actor of this.actors.values())
      if (
        actor.formation &&
        actor.formation.memberIds.some(
          (id) => !this.actors.has(id) || this.actors.get(id)?.worker.parentId !== actor.worker.id,
        )
      )
        actor.formation = null;
  }
  private depth(actor: ActorState) {
    const seen = new Set([actor.worker.id]);
    let current: ActorState | undefined = actor;
    let value = 0;
    while (current.worker.kind === "helper") {
      if (
        !verified(current.worker) ||
        ++value > MAX_HELPER_DEPTH ||
        seen.has(current.worker.parentId ?? "")
      )
        return Infinity;
      seen.add(current.worker.parentId ?? "");
      current = this.actors.get(current.worker.parentId ?? "");
      if (!current || current.worker.platformKey !== actor.worker.platformKey) return Infinity;
    }
    return value;
  }
  private animateActor(
    actor: ActorState,
    input: {
      now: number;
      elapsed: number;
      stale: NonNullable<MotionOptions["stale"]>;
      formations: Map<string, Assignment[]>;
    },
  ) {
    const { now, elapsed, stale, formations } = input;
    const graph = this.graphs.get(actor.worker.platformKey),
      parent = this.actors.get(actor.worker.parentId ?? "");
    const following = canFollow(actor, parent, stale);
    actor.recover({ following, graph, now });
    let assignment: Assignment | undefined;
    if (following && graph) {
      if (!formations.has(parent.worker.id))
        formations.set(
          parent.worker.id,
          new FormationPlanner(parent, this.ordered, graph, stale).plan(),
        );
      assignment = required(formations, parent.worker.id).find((entry) => entry.actor === actor);
    }
    actor.animate({ now, elapsed, graph, parent, assignment, following });
  }
  step(now: number, { stale = false, reduced = false }: MotionOptions = {}): ActorFrame[] {
    const elapsed = this.last === null ? 0 : Math.max(0, Math.min(MAX_FRAME_MS, now - this.last));
    this.last = now;
    const formations = new Map<string, Assignment[]>();
    const output = this.ordered.map(({ actor }) => {
      const parent = this.actors.get(actor.worker.parentId ?? "");
      actor.observeFreeze(stale, parent);
      if (reduced) actor.snapToChair(now);
      else if (actor.frozen) actor.freeze();
      else this.animateActor(actor, { now, elapsed, stale, formations });
      return actor.frame(reduced);
    });
    for (const actor of this.actors.values())
      if (actor.formation && !formations.has(actor.worker.id)) actor.formation = null;
    return output;
  }
}
export function createMovement() {
  const movement = new Movement();
  return {
    reconcile: movement.reconcile.bind(movement),
    step: movement.step.bind(movement),
    reset: movement.reset.bind(movement),
  };
}
