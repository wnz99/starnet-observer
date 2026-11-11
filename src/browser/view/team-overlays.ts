import type { CoordinationView, TeamFacts } from "../model/coordination.js";
import type { Camera, Point } from "../scene/types.js";
import type { SpriteResource } from "../sprites/types.js";
import type { GeometryPainter } from "./geometry-painter.js";
import type { CoordinationViewForPaint, TextPlate } from "./types.js";

const NON_MEMBER_ALPHA = 0.35;
const RING = { radius: 0.72, width: 2 };
// The crest sits above the status dot (worker-labels: 5px lift, 2.5px radius) so the dot never covers it.
const CREST = { dx: 0, dy: -13, size: 4.5 };
const STAR = { outer: 1.3, inner: 0.585, vertices: 10, alternate: 2, turn: Math.PI * 2 };
// Priority sits below the desk badge (60) and the host, station and platform signs yet above the worktree detail plate (10).
const CLAIM_CHIP = { priority: 40, gap: 1, width: 150, size: 12 };

interface Claim {
  ticket: string;
  branch: string;
}
const claimChipText = (claim: Claim) => `${claim.ticket} · ${claim.branch}`;

export interface TeamPaintView {
  coordination: () => CoordinationViewForPaint | null;
  geometry: Pick<GeometryPainter<SpriteResource>, "isoEllipse" | "poly">;
  cameraControl: { pointOf: (id: string | null) => Point | null };
  workerIndex: ReadonlyMap<string, { scale: number }>;
  anchors: readonly { id: string; head: Point; foot: number }[];
  camera: Camera;
}
export interface ChipPlates {
  textPlate: (
    text: string,
    x: number,
    y: number,
    style: { accent: string; size: number; color: string; priority: number },
  ) => TextPlate;
  clipText: (text: string, max: number, size: number) => string;
}

export class TeamOverlays {
  private selected: TeamFacts | null = null;
  private byWorker: CoordinationView["byWorker"] | null = null;
  constructor(private readonly view: TeamPaintView) {}

  // One coordination read per frame; dimming, ring, crests and chips share it.
  begin() {
    const paint = this.view.coordination();
    this.selected = paint?.team ?? null;
    this.byWorker = paint?.view.byWorker ?? null;
  }
  alpha(id: string) {
    return !this.selected || this.selected.memberIds.has(id) ? 1 : NON_MEMBER_ALPHA;
  }
  team = () => {
    if (!this.selected) return;
    for (const id of this.selected.memberIds) {
      const point = this.view.cameraControl.pointOf(id);
      const worker = this.view.workerIndex.get(id);
      if (point && worker)
        this.view.geometry.isoEllipse(point, RING.radius * worker.scale, {
          stroke: this.selected.hue,
          fill: null,
          width: RING.width,
        });
    }
  };
  crests = () => {
    if (!this.byWorker || this.byWorker.size === 0) return;
    const { zoom, tx, ty } = this.view.camera;
    for (const anchor of this.view.anchors) {
      const member = this.byWorker.get(anchor.id);
      if (!member) continue;
      // Anchors are screen space; crests ride the world transform, so convert and size by zoom.
      const x = (anchor.head.x - tx + CREST.dx) / zoom,
        y = (anchor.head.y - ty + CREST.dy) / zoom,
        size = CREST.size / zoom;
      this.view.geometry.poly(
        member.coordinator ? star(x, y, size) : diamond(x, y, size),
        member.hue,
        null,
      );
    }
  };
  // Claim chips hang under the worker's foot labels: `below` is the lift of the lowest existing worker
  // plate, and the chip starts just beneath it. Priority is lower than the desk badge and every sign,
  // so a collision drops the chip.
  claimChips(
    plates: ChipPlates,
    options: { visible: (id: string) => boolean; color: string; below: number },
  ) {
    const chips: TextPlate[] = [];
    if (!this.byWorker) return chips;
    for (const region of this.view.anchors) {
      const member = this.byWorker.get(region.id);
      if (!member?.claim || !options.visible(region.id)) continue;
      const plate = plates.textPlate(
        plates.clipText(claimChipText(member.claim), CLAIM_CHIP.width, CLAIM_CHIP.size),
        region.head.x,
        region.foot + options.below,
        {
          accent: member.hue,
          size: CLAIM_CHIP.size,
          color: options.color,
          priority: CLAIM_CHIP.priority,
        },
      );
      // textPlate bottom-anchors at foot + below; shift down one plate height so the top meets that line.
      chips.push({ ...plate, y: plate.y + plate.h + CLAIM_CHIP.gap });
    }
    return chips;
  }
}

const diamond = (x: number, y: number, size: number): Point[] => [
  { x, y: y - size },
  { x: x + size, y },
  { x, y: y + size },
  { x: x - size, y },
];
function star(x: number, y: number, size: number): Point[] {
  return Array.from({ length: STAR.vertices }, (_, index) => {
    const angle = (index / STAR.vertices) * STAR.turn - Math.PI / STAR.alternate,
      radius = size * (index % STAR.alternate === 0 ? STAR.outer : STAR.inner);
    return { x: x + Math.cos(angle) * radius, y: y + Math.sin(angle) * radius };
  });
}
