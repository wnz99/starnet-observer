import { age } from "../model/description.js";
import { toScreen } from "../scene/index.js";
import { longestSegmentMidpoint } from "../scene/geometry.js";
import type { ObservationLink, Point, RelaySpoke, Ship } from "../scene/types.js";
import type { SpriteResource } from "../sprites/types.js";
import type { LabelContext } from "./label-types.js";
import { center } from "./primitives.js";
import type { ViewRuntime } from "./runtime.js";
import { shipLive } from "./static.js";
import type { TextPlate } from "./types.js";
import { present } from "./values.js";
const RELAY_ACTIVE = "active";

const SHIP_SIGN = {
  localHeight: 4,
  widthRatio: 0.5,
  size: 20,
  lift: 10,
  localPriority: 48,
  remotePriority: 58,
  dash: [3, 3],
};
const MAIL_SIGN = { height: 3.4, size: 16, priority: 44 };
const OBSERVATION_SIGN = {
  height: 0.6,
  lift: 14,
  size: 12,
  priority: 46,
  dash: [2, 2],
};
const RELAY_SIGN = {
  roomTail: 3,
  hubPriority: 60,
  height: 0.6,
  widthRatio: 0.7,
  size: 12,
  lift: -12,
  priority: 46,
  dash: [3, 3],
};
function shipText(ship: Ship) {
  if (ship.shadow) return "◌ " + String(ship.machine).toUpperCase();
  if (ship.local) return "● THIS MACHINE";
  return `${shipLive(ship) ? "● " : "○ "}${String(ship.id).toUpperCase()}`;
}
function relayLane(link: RelaySpoke): Point {
  return longestSegmentMidpoint(link.path.slice(1, -RELAY_SIGN.roomTail));
}
function relayNote(link: RelaySpoke) {
  if (link.state === RELAY_ACTIVE) return "live";
  if (link.state === "unknown") return "bus unreadable";
  return Number.isFinite(link.lastActivityAt) ? "quiet " + age(link.lastActivityAt) : "quiet";
}
export class HostLabels<R extends SpriteResource, B extends R = R> {
  constructor(readonly view: ViewRuntime<R, B>) {}
  private screen(point: Point) {
    return toScreen(point, this.view.camera);
  }
  ships(options: LabelContext): TextPlate[] {
    const plates: TextPlate[] = [];
    for (const ship of this.view.activeScene.ships || []) {
      if (!this.view.assemblyVisible(this.view.assemblyOwners.ship(ship.local ? null : ship.id)))
        continue;
      plates.push(this.ship(ship));
      if (
        !ship.local &&
        ship.mail &&
        options.tier !== "overview" &&
        ship.id === this.view.interaction.connectionHost()
      )
        plates.push(this.mailroom(ship));
    }
    return plates;
  }
  private hullVisible(ship: Ship) {
    const r = ship.rect;
    const hull = [
      { x: r.x, y: r.y, z: 0 },
      { x: r.x + r.w, y: r.y, z: 0 },
      { x: r.x, y: r.y + r.h, z: 0 },
      { x: r.x + r.w, y: r.y + r.h, z: 0 },
    ].map((point) => this.screen(point));
    const viewport = this.view.viewport;
    return (
      Math.max(...hull.map((p) => p.x)) > 0 &&
      Math.min(...hull.map((p) => p.x)) < viewport.width &&
      Math.max(...hull.map((p) => p.y)) > 0 &&
      Math.min(...hull.map((p) => p.y)) < viewport.height
    );
  }
  private shipColor(ship: Ship) {
    if (ship.shadow) return this.view.C.amber;
    if (ship.local) return this.view.C.cyan;
    return shipLive(ship) ? this.view.C.amber : this.view.C.idle;
  }
  private ship(ship: Ship): TextPlate {
    const r = ship.rect,
      live = shipLive(ship);
    const at = this.screen(
      ship.local ? { x: center(r).x, y: r.y, z: SHIP_SIGN.localHeight } : { x: r.x, y: r.y, z: 0 },
    );
    const hullOnScreen = this.hullVisible(ship),
      label = shipText(ship),
      color = this.shipColor(ship);
    const plate = this.view.plates.textPlate(
      this.view.plates.clipText(
        label,
        this.view.viewport.width * SHIP_SIGN.widthRatio,
        this.view.plates.signSize(SHIP_SIGN.size),
      ),
      at.x,
      at.y - (ship.local ? 0 : SHIP_SIGN.lift),
      {
        accent: color,
        size: this.view.plates.signSize(SHIP_SIGN.size),
        color,
        priority: ship.local ? SHIP_SIGN.localPriority : SHIP_SIGN.remotePriority,
        dash: live ? null : SHIP_SIGN.dash,
        force: !ship.local && hullOnScreen,
      },
    );
    return {
      ...plate,
      ...(this.view.callbacks.onShip && !ship.shadow
        ? { ship: { host: ship.local ? null : ship.id } }
        : {}),
    };
  }
  private mailroom(ship: Ship) {
    const tower = present(ship.mail).tower;
    const at = this.screen({
      ...center(tower),
      z: MAIL_SIGN.height,
    });
    const label =
      "MAILROOM · " + (ship.shadow ? String(ship.machine) + " (its own llm-bus)" : String(ship.id));
    return this.view.plates.textPlate(label, at.x, at.y, {
      accent: this.view.C.amber,
      size: this.view.plates.signSize(MAIL_SIGN.size),
      color: this.view.C.window,
      priority: MAIL_SIGN.priority,
    });
  }
  observation(): TextPlate[] {
    if (this.view.assemblyFrame.active) return [];
    const host = this.view.interaction.connectionHost();
    return (this.view.activeScene.links || [])
      .filter((link) => link.host === host)
      .map((link) => this.observationLink(link));
  }
  private observationLink(link: ObservationLink) {
    const mid = this.screen({
        ...link.label,
        z: OBSERVATION_SIGN.height,
      }),
      live = link.health === "available";
    const state = live
        ? "ssh · observing"
        : link.health === "stale"
          ? "ssh · stale"
          : "ssh · unreachable",
      color = live ? this.view.C.cyan : this.view.C.idle;
    return this.view.plates.textPlate(
      link.host + " · " + state,
      mid.x,
      mid.y - OBSERVATION_SIGN.lift,
      {
        accent: color,
        size: OBSERVATION_SIGN.size,
        color,
        priority: OBSERVATION_SIGN.priority,
        dash: OBSERVATION_SIGN.dash,
      },
    );
  }
  relays(): TextPlate[] {
    if (this.view.assemblyFrame.active) return [];
    const host = this.view.interaction.connectionHost();
    return (this.view.activeScene.relays || []).flatMap((relay) => {
      const at = this.screen({ ...center(relay.mail.tower), z: MAIL_SIGN.height });
      return [
        this.view.plates.textPlate("RELAY MAILROOM", at.x, at.y, {
          accent: this.view.C.amber,
          color: this.view.C.amber,
          size: this.view.plates.signSize(MAIL_SIGN.size),
          priority: RELAY_SIGN.hubPriority,
        }),
        ...relay.spokes.filter((link) => link.host === host).map((link) => this.relayLink(link)),
      ];
    });
  }
  private relayLink(link: RelaySpoke) {
    const mid = this.screen({ ...relayLane(link), z: RELAY_SIGN.height }),
      live = link.state === RELAY_ACTIVE;
    const proof = link.verified ? "mail has crossed" : "roster only";
    const label = `${link.machine} · ${relayNote(link)} · ${proof} · ${String(link.carried)} agents`;
    return this.view.plates.textPlate(
      this.view.plates.clipText(
        label,
        this.view.viewport.width * RELAY_SIGN.widthRatio,
        RELAY_SIGN.size,
      ),
      mid.x,
      mid.y - RELAY_SIGN.lift,
      {
        accent: link.state === "unknown" || !link.verified ? this.view.C.idle : this.view.C.amber,
        size: RELAY_SIGN.size,
        color: live && link.verified ? this.view.C.amber : this.view.C.dim,
        priority: RELAY_SIGN.priority,
        dash: link.verified ? null : RELAY_SIGN.dash,
      },
    );
  }
}
