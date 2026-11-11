import type { CoordinationView, TeamFacts } from "../model/coordination.js";
import { toScreen } from "../scene/index.js";
import type { Camera, Point, PropExtent, Rect, Worker } from "../scene/types.js";
import type { SpriteResource } from "../sprites/types.js";
import type { GeometryPainter } from "./geometry-painter.js";
import type { DepthItem } from "./state-types.js";
import type { CoordinationViewForPaint, PlateOptions, TextPlate, ViewContext } from "./types.js";

const PENDING = "pending";
const FLASH_MS = 1200;
const HANDOVER_MS = 2400;
const SECONDS = 1000;
const CLOCK = { minute: 60, digits: 2 };
const BEACON = {
  glowHeight: 3.4,
  radius: 26,
  base: 0.35,
  range: 0.3,
  steady: 0.5,
  period: 1600,
  plateHeight: 3.9,
  size: 14,
  priority: 52,
};
const MARK = { size: 16, priority: 53 };
const HANDOVER = {
  size: 14,
  priority: 51,
  ringStart: 0.5,
  ringGrowth: 1.4,
  ringAlpha: 0.8,
  ringWidth: 2,
  height: 8,
  pad: 40,
};
const GATE = { size: 12, priority: 20, width: 170, rowsPerScreen: 3, gap: 1, screenRise: 0.55 };
const STACK_GAP = 2;
const TURN = Math.PI * 2;
const HALF = 0.5;

interface Colors {
  "coordination-beacon": string;
  "glow-transparent": string;
  amber: string;
  dim: string;
  ink: string;
  window: string;
}
export interface SignalView {
  coordination: () => CoordinationViewForPaint | null;
  activeScene: {
    workers: readonly Worker[];
    observatory: { screens: readonly PropExtent[] };
  };
  geometry: Pick<GeometryPainter<SpriteResource>, "glow" | "isoEllipse">;
  ctx: Pick<ViewContext<SpriteResource>, "save" | "restore"> & {
    globalAlpha: number;
    globalCompositeOperation: GlobalCompositeOperation;
  };
  C: Colors;
  S: { blocked: string; done: string };
  camera: Camera;
  framePaint: { onStage: (rect: Rect, height: number, pad: number) => boolean };
  plates: {
    textPlate: (text: string, x: number, y: number, options?: PlateOptions) => TextPlate;
    clipText: (text: string, max: number, size: number) => string;
    signSize: (base: number) => number;
  };
}

interface Seat {
  chair: Point;
  facts: TeamFacts;
}
interface GateRow {
  teamKey: string;
  pr: number;
  ticket: string;
  status: string;
}

const two = (value: number) => String(value).padStart(CLOCK.digits, "0");
function countdown(remaining: number) {
  const seconds = Math.ceil(remaining / SECONDS);
  return two(Math.floor(seconds / CLOCK.minute)) + ":" + two(seconds % CLOCK.minute);
}
function beaconText(facts: TeamFacts, wall: number) {
  let count = 0,
    earliest: number | null = null;
  for (const decision of facts.team.decisions) {
    if (decision.status !== PENDING) continue;
    count++;
    if (decision.deadlineAt !== null && (earliest === null || decision.deadlineAt < earliest))
      earliest = decision.deadlineAt;
  }
  if (count === 0) return null;
  const head = "? " + String(count);
  if (earliest === null) return head;
  return head + " · " + (earliest <= wall ? "overdue" : countdown(earliest - wall));
}
const defaulted = (facts: TeamFacts) =>
  facts.team.decisions.some((decision) => decision.status === "defaulted");
const age = (at: number | undefined, wall: number) => (at === undefined ? Infinity : wall - at);

function seatsOf(view: SignalView, coordination: CoordinationView): Seat[] {
  const seats: Seat[] = [];
  for (const worker of view.activeScene.workers) {
    if (worker.role !== "coordinator") continue;
    const teamKey = coordination.byWorker.get(worker.id)?.teamKey;
    const facts = coordination.teams.find((team) => team.teamKey === teamKey);
    if (facts) seats.push({ chair: worker.chair, facts });
  }
  return seats;
}

// Latest gate per PR already arrives merged per team; rows list the selected team first, newest first.
function gateRows(paint: CoordinationViewForPaint): GateRow[] {
  const selected = paint.team?.teamKey;
  const rows = paint.view.teams.flatMap((facts) =>
    facts.team.gates.map((gate) => ({
      row: { teamKey: facts.teamKey, pr: gate.pr, ticket: gate.ticket, status: gate.status },
      submittedAt: gate.submittedAt ?? -Infinity,
      first: facts.teamKey === selected ? 0 : 1,
    })),
  );
  rows.sort((a, b) => a.first - b.first || b.submittedAt - a.submittedAt || b.row.pr - a.row.pr);
  return rows.map((entry) => entry.row);
}

/**
 * Observatory signals read from the coordination view: decision beacons and handover sweeps at seated
 * coordinators, and gate rows on the observatory screens. Time arithmetic uses the wall clock the
 * snapshots were stamped with; the frame clock only drives the pulse phase.
 */
export class CoordinationSignals {
  private rowsFor: { view: CoordinationView; team: TeamFacts | null; rows: GateRow[] } | null =
    null;
  constructor(
    private readonly view: SignalView,
    private readonly wall: () => number = () => Date.now(),
  ) {}

  items(now: number, animate: boolean): DepthItem[] {
    const paint = this.view.coordination();
    if (!paint || paint.view.teams.length === 0) return [];
    const wall = this.wall(),
      items: DepthItem[] = [];
    for (const { chair, facts } of seatsOf(this.view, paint.view)) {
      const rect = { x: chair.x - 1, y: chair.y - 1, w: 2, h: 2 };
      if (!this.view.framePaint.onStage(rect, HANDOVER.height, HANDOVER.pad)) continue;
      const depth = chair.x + chair.y;
      if (beaconText(facts, wall) !== null)
        items.push({
          depth,
          tie: "beacon",
          draw: () => {
            this.beacon(chair, now, animate);
          },
        });
      const elapsed = age(paint.view.handovers.get(facts.teamKey), wall);
      if (animate && elapsed >= 0 && elapsed < HANDOVER_MS)
        items.push({
          depth,
          tie: "handover",
          draw: () => {
            this.sweep(chair, facts.hue, elapsed / HANDOVER_MS);
          },
        });
    }
    return items;
  }

  plates(animate: boolean): TextPlate[] {
    const paint = this.view.coordination();
    if (!paint || paint.view.teams.length === 0) return [];
    const wall = this.wall();
    return [...this.seatPlates(paint.view, wall), ...this.gatePlates(paint, wall, animate)];
  }

  private beacon(chair: Point, now: number, animate: boolean) {
    const phase = HALF + HALF * Math.sin((now / BEACON.period) * TURN);
    this.view.geometry.glow({ x: chair.x, y: chair.y, z: BEACON.glowHeight }, BEACON.radius, {
      color: this.view.C["coordination-beacon"],
      alpha: animate ? BEACON.base + BEACON.range * phase : BEACON.steady,
      transparent: this.view.C["glow-transparent"],
    });
  }

  private sweep(chair: Point, hue: string, progress: number) {
    const ctx = this.view.ctx;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha *= (1 - progress) * HANDOVER.ringAlpha;
    this.view.geometry.isoEllipse(
      { x: chair.x, y: chair.y, z: 0 },
      HANDOVER.ringStart + HANDOVER.ringGrowth * progress,
      { stroke: hue, fill: null, width: HANDOVER.ringWidth },
    );
    ctx.restore();
  }

  // Beacon, defaulted mark and handover plates stack upward from one seat anchor.
  private seatPlates(coordination: CoordinationView, wall: number) {
    const out: TextPlate[] = [],
      { plates, camera, C, S } = this.view;
    for (const { chair, facts } of seatsOf(this.view, coordination)) {
      const at = toScreen({ x: chair.x, y: chair.y, z: BEACON.plateHeight }, camera),
        made: TextPlate[] = [],
        text = beaconText(facts, wall);
      if (text !== null)
        made.push(
          plates.textPlate(text, at.x, at.y, {
            accent: C["coordination-beacon"],
            size: BEACON.size,
            color: C.ink,
            priority: BEACON.priority,
          }),
        );
      if (defaulted(facts))
        made.push(
          plates.textPlate("!", at.x, at.y, {
            accent: S.blocked,
            size: MARK.size,
            color: S.blocked,
            priority: MARK.priority,
          }),
        );
      const elapsed = age(coordination.handovers.get(facts.teamKey), wall);
      if (elapsed >= 0 && elapsed < HANDOVER_MS)
        made.push(
          plates.textPlate("handover · gen " + facts.team.generation, at.x, at.y, {
            accent: facts.hue,
            size: HANDOVER.size,
            color: C.ink,
            priority: HANDOVER.priority,
          }),
        );
      let lift = 0;
      for (const plate of made) {
        out.push({ ...plate, y: plate.y - lift });
        lift += plate.h + STACK_GAP;
      }
    }
    return out;
  }

  private rows(paint: CoordinationViewForPaint) {
    const held = this.rowsFor;
    if (held?.view === paint.view && held.team === paint.team) return held.rows;
    const rows = gateRows(paint);
    this.rowsFor = { view: paint.view, team: paint.team, rows };
    return rows;
  }

  private statusColor(status: string) {
    const { C, S } = this.view;
    if (status === "accepted") return S.done;
    if (status === "rejected") return S.blocked;
    return status === "submitted" ? C.amber : C.dim;
  }

  private gatePlates(paint: CoordinationViewForPaint, wall: number, animate: boolean) {
    const rows = this.rows(paint),
      out: TextPlate[] = [];
    if (rows.length === 0) return out;
    const { plates, camera, C, activeScene } = this.view,
      size = plates.signSize(GATE.size),
      { screens } = activeScene.observatory;
    screens.forEach((screen, index) => {
      const rect = screen.rect,
        at = toScreen(
          { x: rect.x + rect.w * HALF, y: rect.y, z: screen.height * GATE.screenRise },
          camera,
        );
      rows
        .slice(index * GATE.rowsPerScreen, (index + 1) * GATE.rowsPerScreen)
        .forEach((row, slot) => {
          const since = age(paint.view.flashes.get(row.teamKey + "#" + String(row.pr)), wall),
            flashed = animate && since >= 0 && since < FLASH_MS,
            tint = flashed ? C.window : this.statusColor(row.status),
            text = plates.clipText(
              "#" + String(row.pr) + " " + row.ticket + " " + row.status,
              GATE.width,
              size,
            ),
            plate = plates.textPlate(text, at.x, at.y, {
              accent: tint,
              size,
              color: flashed ? C.window : C.ink,
              priority: GATE.priority,
            });
          out.push({ ...plate, y: plate.y + slot * (plate.h + GATE.gap) });
        });
    });
    return out;
  }
}
