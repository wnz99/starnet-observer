import { element } from "../model/types.js";
import { pathTo, safeSegment, direction } from "./navigation.js";
import { identityHash } from "../model/identity.js";
import { contains } from "./geometry.js";
import { atDesk, closed, isStale } from "./formation.js";
import { historicalPath } from "./history.js";
import type { Actor, Worker, Point, Graph, Assignment, ActorFrame, Stale } from "./types.js";
interface ActorMotionFrame {
  now: number;
  elapsed: number;
  graph: Graph | undefined;
  parent: Actor | undefined;
  assignment: Assignment | undefined;
  following: boolean;
}
const MOTION = {
  delay: 2000,
  initialJitter: 5000,
  rest: 4000,
  restJitter: 7000,
  tripStride: 97,
  speed: 1.6,
  followSpeed: 2.4,
  milliseconds: 1000,
  headingEpsilon: 0.0001,
  homeEpsilon: 0.001,
  historyEpsilon: 1e-8,
  historyLimit: 256,
  historyLength: 48,
  collinearPoints: 3,
  segmentEnds: 2,
};
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
export class ActorState implements Actor {
  point: Point;
  path: Point[] = [];
  due: number;
  trip = 0;
  direction = "south";
  trail: { point: Point; arc: number }[] = [];
  arc = 0;
  depth?: number;
  frozen?: boolean;
  thaw?: boolean;
  followParent?: string | null;
  cursor?: number | null;
  arrival?: number | null;
  targetKey?: string | null;
  assignment?: string | null;
  formation?: NonNullable<Actor["formation"]> | null;
  settled: "entering" | "returning" | undefined;
  setLifecycle(path: Point[], settled: ActorFrame["settled"]) {
    this.path = path;
    this.settled = settled;
  }
  constructor(
    public worker: Worker,
    now: number,
    hash: number,
  ) {
    const start = worker.helperPhase === "entering" ? worker.quartersEntry : worker.chair;
    this.point = { ...(start ?? worker.chair) };
    this.due = now + MOTION.delay + (hash % MOTION.initialJitter);
  }
  clearFollow() {
    this.followParent = null;
    this.cursor = null;
    this.arrival = null;
    this.targetKey = null;
    this.assignment = null;
    this.formation = null;
  }
  record(point: Point) {
    const previous = this.trail.at(-1);
    if (previous && distance(previous.point, point) < MOTION.historyEpsilon) return;
    this.arc += previous ? distance(previous.point, point) : 0;
    this.trail.push({ point: { ...point }, arc: this.arc });
    const n = this.trail.length;
    if (n > MOTION.segmentEnds) {
      const recent = this.trail.slice(-MOTION.collinearPoints).map((node) => node.point);
      const a = element(recent, 0),
        b = element(recent, 1),
        c = element(recent, MOTION.segmentEnds);
      if (
        Math.abs((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)) < MOTION.historyEpsilon &&
        (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) >= 0
      )
        this.trail.splice(n - MOTION.segmentEnds, 1);
    }
    while (
      this.trail.length > MOTION.historyLimit ||
      (this.trail.length > MOTION.segmentEnds &&
        element(this.trail, 1).arc < this.arc - MOTION.historyLength)
    )
      this.trail.shift();
  }
  follow(parent: Actor, graph: Graph | undefined, assignment: Assignment) {
    if (this.assignment !== assignment.assignment) {
      this.path = [];
      this.clearFollow();
      this.followParent = parent.worker.id;
      this.assignment = assignment.assignment;
    }
    if (assignment.route === "history" && this.path.length > 0) return;
    if (typeof this.arrival === "number") this.cursor = this.arrival;
    this.arrival = null;
    const target = assignment.target,
      key =
        target &&
        JSON.stringify([assignment.assignment, assignment.route, target, assignment.side]);
    if (!this.isNewTarget(target, key, assignment.route)) return;
    this.targetKey = key;
    this.path = this.followPath(parent, graph, target, assignment);
    this.arrival = assignment.route === "history" && this.path.length > 0 ? target.arc : null;
  }
  returnHome(graph: Graph | undefined) {
    this.formation = null;
    if (this.followParent || (this.cursor !== null && this.cursor !== undefined)) {
      this.path = [];
      this.clearFollow();
    }
    if (distance(this.point, this.worker.chair) <= MOTION.homeEpsilon) {
      this.path = [];
      return;
    }
    const key = "home";
    if (this.targetKey !== key) {
      this.path = pathTo(graph, this.point, this.worker.chair, this.worker);
      this.targetKey = key;
    }
  }

  private isNewTarget(
    target: Assignment["target"],
    key: string | null,
    route: Assignment["route"],
  ): target is NonNullable<Assignment["target"]> {
    return (
      target !== null &&
      (route === "compact" || target.arc > (this.cursor ?? -Infinity)) &&
      this.targetKey !== key
    );
  }
  observeFreeze(stale: Stale, parent: Actor | undefined) {
    const transient =
      this.worker.helperPhase === "entering" || this.worker.helperPhase === "returning";
    this.frozen =
      isStale(this.worker, stale) ||
      (!transient && Number.isFinite(this.depth) && !!parent?.frozen) ||
      (this.worker.helperPhase !== "returning" && closed(this.worker));
  }
  private followPath(
    parent: Actor,
    graph: Graph | undefined,
    target: NonNullable<Assignment["target"]>,
    assignment: Assignment,
  ) {
    const historical =
      assignment.route === "compact" || this.cursor === null || this.cursor === undefined
        ? []
        : historicalPath(parent, this.cursor, target, assignment.side);
    let from = this.point;
    const safe = historical.every((point) => {
      const valid = safeSegment(graph, from, point, this.worker);
      from = point;
      return valid;
    });
    if (historical.length > 0 && safe) return historical;
    return safeSegment(graph, this.point, target.point, this.worker)
      ? [target.point]
      : pathTo(graph, this.point, target.point, this.worker);
  }
  snapToChair(now: number) {
    this.point = { ...this.worker.chair };
    this.path = [];
    this.trail = [];
    this.clearFollow();
    this.due = now + MOTION.delay;
  }
  freeze() {
    this.path = [];
    this.trail = [];
    this.clearFollow();
    this.thaw = true;
  }
  reconcileWorker(worker: Worker, options: { geometryChanged: boolean; reduced: boolean }) {
    const reparented = this.worker.parentId !== worker.parentId;
    const changedPhase = this.worker.helperPhase !== worker.helperPhase;
    this.worker = worker;
    if (options.geometryChanged || reparented || changedPhase) {
      this.settled = undefined;
      this.path = [];
      this.trail = [];
      this.arc = 0;
      this.clearFollow();
    }
    if (options.reduced && !worker.helperPhase) {
      this.point = { ...worker.chair };
      this.path = [];
      this.trail = [];
      this.clearFollow();
    }
  }
  recover(input: { following: boolean; graph: Graph | undefined; now: number }) {
    if (!this.thaw) return;
    this.thaw = false;
    const { following, graph, now } = input;
    if (atDesk(this.worker) || following || this.worker.kind === "helper" || !graph) return;
    this.targetKey = null;
    this.returnHome(graph);
    this.rest(now);
  }
  private rest(now: number) {
    this.due = now + MOTION.rest + (identityHash(this.worker.id) % MOTION.restJitter);
  }
  private roam(graph: Graph, now: number) {
    if (this.path.length > 0 || now < this.due || graph.cells.size === 0) return;
    const all = [...graph.cells.values()],
      home = this.worker.home;
    const own = home ? all.filter((cell) => contains(home, cell)) : [];
    const cells = own.length > 0 ? own : all;
    const target = element(
      cells,
      (identityHash(this.worker.id) + ++this.trip * MOTION.tripStride) % cells.length,
    );
    this.path = pathTo(graph, this.point, target, this.worker);
    this.targetKey = null;
  }
  animate(input: ActorMotionFrame) {
    const { now, elapsed, following } = input;
    this.chooseIntent(input);
    const ambient = !atDesk(this.worker) && (this.worker.kind !== "helper" || following);
    if (ambient) this.record(this.point);
    else {
      this.trail = [];
      this.arc = 0;
    }
    const transient = ["entering", "returning"].some((phase) => phase === this.worker.helperPhase);
    let remaining =
      (elapsed * (following && !transient ? MOTION.followSpeed : MOTION.speed)) /
      MOTION.milliseconds;
    while (this.path.length > 0 && remaining > 0) {
      remaining = this.travel(remaining);
      if (ambient) this.record(this.point);
      if (this.path.length === 0) {
        this.rest(now);
        this.chooseIntent(input);
      }
    }
  }
  private chooseIntent(input: ActorMotionFrame) {
    const { now, graph, parent, assignment, following } = input;
    if (this.worker.helperPhase === "entering" || this.worker.helperPhase === "returning") return;
    if (atDesk(this.worker) || (this.worker.kind === "helper" && !following))
      this.returnHome(graph);
    else if (following && parent && assignment) this.follow(parent, graph, assignment);
    else if (graph) this.roam(graph, now);
  }
  private travel(remaining: number) {
    const target = element(this.path, 0),
      dx = target.x - this.point.x,
      dy = target.y - this.point.y,
      length = Math.hypot(dx, dy);
    if (length > MOTION.headingEpsilon) this.direction = direction(dx, dy);
    if (length <= remaining) {
      this.point = { ...target };
      this.path.shift();
      return remaining - length;
    }
    this.point = {
      x: this.point.x + (dx * remaining) / length,
      y: this.point.y + (dy * remaining) / length,
      z: 0,
    };
    return 0;
  }
  private pose(reduced: boolean) {
    if (this.frozen) return "idle";
    if (!reduced && this.path.length > 0) return "walk";
    if (this.worker.helperPhase === "returning") return "idle";
    if (this.worker.row.status === "working") return "working";
    return this.worker.row.status === "blocked" ? "waiting" : "idle";
  }
  frame(reduced: boolean): ActorFrame {
    const pose = this.pose(reduced);
    return {
      id: this.worker.id,
      point: { ...this.point },
      pose,
      direction: pose === "working" || pose === "waiting" ? "south" : this.direction,
      ...(!this.frozen && this.settled ? { settled: this.settled } : {}),
    };
  }
}
