import type { Worker, RelaySpoke } from "../scene/types.js";
import { CABLE_HEIGHT, mailCablePath, cableSurfaces } from "../scene/cables.js";
import type { SpriteResource } from "../sprites/types.js";
import { rectPoly } from "./primitives.js";
import { shipLive } from "./static.js";
import type { ViewRuntime } from "./runtime.js";
const REPOSITORY_RING = { glowRadius: 40, glowAlpha: 0.4, workingWidth: 3, width: 1.5, gap: 0.16 };
const FOCUS_RING = { period: 450, radius: 0.55, width: 2 };
const PLATFORM_RING = { height: 0.02 };
const HOST_RING = { minimumZoom: 0.25, period: 700, height: 2.4 };
const CONNECTION = { height: CABLE_HEIGHT, width: 2, junctionRadius: 0.35, alpha: 0.9 };

export class FrameOverlays<R extends SpriteResource, B extends R = R> {
  private readonly agentColors = new Map<string, string>();
  constructor(readonly view: ViewRuntime<R, B>) {}

  repositoryColor(id: string): string {
    const existing = this.agentColors.get(id);
    if (existing) return existing;
    const index = this.agentColors.size,
      color = `hsl(${String((index * 137.507764 + 7.5) % 360)} 70% 65%)`;
    this.agentColors.set(id, color);
    return color;
  }

  repository = (stationArt: boolean) => {
    /* The selected repository's crew, roots and helpers alike, each get a ring; a worker whose own fresh status is
         working gets a thicker double ring and a glow. Read selection from the controller per paint. */
    const selectedRepo = this.view.repositorySelection();

    if (selectedRepo !== null)
      for (const worker of this.view.activeScene.workers)
        this.repositoryWorker(worker, selectedRepo, stationArt);
  };
  private repositoryWorker(worker: Worker, selectedRepo: string, stationArt: boolean) {
    const point = worker.row.repoId === selectedRepo && this.view.cameraControl.pointOf(worker.id);
    if (!point) return;
    const working = worker.row.status === "working" && !this.view.workerStale(worker),
      radius = 0.62 * worker.scale,
      color = this.repositoryColor(worker.id);
    if (working && stationArt)
      this.view.geometry.glow(point, REPOSITORY_RING.glowRadius * worker.scale, {
        color,
        alpha: REPOSITORY_RING.glowAlpha,
        transparent: this.view.C["glow-transparent"],
      });
    this.view.geometry.isoEllipse(point, radius, {
      stroke: color,
      fill: null,
      width: working ? REPOSITORY_RING.workingWidth : REPOSITORY_RING.width,
    });
    if (working)
      this.view.geometry.isoEllipse(point, radius + REPOSITORY_RING.gap, {
        stroke: color,
        fill: null,
        width: 1,
      });
  }

  focus = (now: number, animate: boolean) => {
    // Focus and hover floor rings sit over the floor but under the plates.
    for (const [id, color] of [
      [this.view.focused, this.view.C.focus],
      [this.view.hovered, null],
    ] satisfies [string | null, string | null][]) {
      const point = id && this.view.cameraControl.pointOf(id);
      if (!point) continue;
      const worker = this.view.workerIndex.get(id);
      this.view.ctx.save();
      this.view.ctx.globalAlpha =
        color && animate ? 0.6 + 0.35 * Math.sin(now / FOCUS_RING.period) : 0.85;
      this.view.geometry.isoEllipse(point, FOCUS_RING.radius, {
        stroke: color || (worker ? worker.accent : this.view.C.focus),
        fill: null,
        width: FOCUS_RING.width,
      });
      this.view.ctx.restore();
    }
  };
  platform = (zoom: number) => {
    // A zoomed platform keeps a thin outline in its accent, so platform focus reads as a mode.
    const scene = this.view.activeScene;
    const zoomed =
      this.view.mode === "platform" &&
      scene.platforms.find((value) => value.key === this.view.platform);

    if (zoomed) {
      this.view.ctx.save();
      this.view.ctx.lineWidth = 2 / zoom;
      this.view.geometry.poly(rectPoly(zoomed.rect, PLATFORM_RING.height), null, zoomed.accent);
      this.view.ctx.restore();
    }
  };
  host = (now: number, animate: boolean, zoom: number) => {
    // The host whose crew the panel lists: its hull rim is drawn solid and bright over the dashed static rim.
    const ships = this.view.activeScene.ships;
    const chosenHost = ships ? this.view.callbacks.hostSelection() : undefined;
    this.connections(chosenHost, zoom);

    const chosenShip =
      chosenHost !== undefined &&
      ships?.find((ship) => (ship.local ? null : ship.id) === chosenHost);

    if (chosenShip) {
      this.view.ctx.save();
      this.view.ctx.lineWidth = 2.5 / Math.max(zoom, HOST_RING.minimumZoom);
      this.view.ctx.globalAlpha = animate ? 0.75 + 0.2 * Math.sin(now / HOST_RING.period) : 0.9;
      this.view.geometry.poly(
        rectPoly(chosenShip.rect, -HOST_RING.height),
        null,
        chosenShip.local
          ? this.view.C.cyan
          : shipLive(chosenShip)
            ? this.view.C.amber
            : this.view.C.idle,
      );
      this.view.ctx.restore();
    }
  };
  private connections(host: string | null | undefined, zoom: number) {
    const relays = this.view.activeScene.relays;
    if (!relays || relays.length === 0) return;
    const ctx = this.view.ctx;
    ctx.save();
    ctx.lineWidth = CONNECTION.width / zoom;
    ctx.strokeStyle = this.view.C.focus;
    for (const relay of relays) {
      const selected = host !== undefined && relay.spokes.some((spoke) => spoke.host === host);
      for (const spoke of relay.spokes) {
        this.connection(spoke, selected && (spoke.host === host || spoke.host === null), zoom);
      }
    }
    ctx.restore();
  }
  private connection(spoke: RelaySpoke, selected: boolean, zoom: number) {
    if (spoke.junction)
      this.view.geometry.isoEllipse(
        { ...spoke.junction, z: CONNECTION.height },
        CONNECTION.junctionRadius,
        {
          stroke: this.view.C.amber,
          fill: this.view.C.ink,
          width: CONNECTION.width / zoom,
        },
      );
    if (!selected) return;
    const ctx = this.view.ctx;
    ctx.lineWidth = CONNECTION.width / zoom;
    ctx.strokeStyle = this.view.C.focus;
    this.view.geometry.cable(mailCablePath(spoke.path), cableSurfaces(this.view.activeScene), {
      alpha: CONNECTION.alpha,
      height: CONNECTION.height,
    });
  }
  stale = () => {
    {
      this.view.ctx.setTransform(this.view.dpr, 0, 0, this.view.dpr, 0, 0);
      this.view.ctx.save();
      this.view.ctx.globalCompositeOperation = "saturation";
      this.view.ctx.fillStyle = this.view.C["stale-overlay"];
      this.view.ctx.fillRect(0, 0, this.view.viewport.width, this.view.viewport.height);
      this.view.ctx.restore();
    }
  };
}
