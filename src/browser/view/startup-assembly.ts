import type { Host, Platform, Point, Rect, Scene, Walkway, Worker } from "../scene/types.js";

export type AssemblyOwner =
  "mail" | "observatory" | `platform:${string}` | `ship:${string}` | `relay:${string}`;
export type AssemblyStage = "floor" | "content";
export interface AssemblyFrame {
  active: boolean;
  progress(owner: AssemblyOwner, stage: AssemblyStage): number;
  outline(owner: AssemblyOwner): number;
  sweep(owner: AssemblyOwner): number;
}
const TIMING = {
  total: 2800,
  observatory: 180,
  first: 360,
  last: 2200,
  groups: 12,
  outline: 100,
  floor: 180,
  content: 200,
  sweep: 180,
};
const STRIP_WIDTH = 2;
const EASING = { linear: 3, cubic: 2 };
const ease = (value: number) => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (EASING.linear - EASING.cubic * t);
};
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const touches = (a: Rect, b: Rect) =>
  a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y;
const shipOwner = (host: Host): AssemblyOwner => (host === null ? "mail" : `ship:${host}`);
const endpoints = (rect: Rect): Point[] =>
  rect.w > rect.h
    ? [
        { x: rect.x + 1, y: rect.y + rect.h / STRIP_WIDTH },
        { x: rect.x + rect.w - 1, y: rect.y + rect.h / STRIP_WIDTH },
      ]
    : [
        { x: rect.x + rect.w / STRIP_WIDTH, y: rect.y + 1 },
        { x: rect.x + rect.w / STRIP_WIDTH, y: rect.y + rect.h - 1 },
      ];

function connectedWalkways(scene: Scene, anchors: readonly { rect: Rect; host: string }[]) {
  const ordinary = scene.walkways.filter((w) => w.kind !== "relay-highway");
  const connected = new Set(
    ordinary.filter((w) =>
      anchors.some((a) => a.host === (w.host ?? "") && touches(a.rect, w.rect)),
    ),
  );
  let changed = true;
  while (changed) {
    changed = false;
    for (const w of ordinary)
      if (
        !connected.has(w) &&
        [...connected].some((other) => other.host === w.host && touches(other.rect, w.rect))
      ) {
        connected.add(w);
        changed = true;
      }
  }
  return connected;
}
function relayHosts(scene: Scene, walkway: Walkway) {
  const hosts = new Set<Host>();
  for (const relay of scene.relays ?? [])
    for (const link of relay.spokes) {
      if (
        link.path.slice(1).some((point, index) => {
          const from = link.path[index];
          return (
            from &&
            touches(walkway.rect, {
              x: Math.min(from.x, point.x) - 1,
              y: Math.min(from.y, point.y) - 1,
              w: Math.abs(from.x - point.x) + STRIP_WIDTH,
              h: Math.abs(from.y - point.y) + STRIP_WIDTH,
            })
          );
        })
      ) {
        hosts.add(link.host);
      }
    }
  return hosts;
}

/** One scene-derived lookup, shared by static art, live art and labels. */
class AssemblyOwnership {
  private platforms = new Map<string, AssemblyOwner>();
  private ships = new Map<Host, AssemblyOwner>();
  private walkways = new Map<Walkway, AssemblyOwner>();
  private dependencies = new Map<Walkway, AssemblyOwner[]>();
  platform(key: string): AssemblyOwner | undefined {
    return this.platforms.get(key);
  }
  worker(worker: Worker): AssemblyOwner | undefined {
    return worker.role === "overseer" ? "observatory" : this.platform(worker.platformKey);
  }
  ship(host: Host): AssemblyOwner | undefined {
    return this.ships.get(host);
  }
  relay(key: string): AssemblyOwner {
    return `relay:${key}`;
  }
  walkway(walkway: Walkway): AssemblyOwner | undefined {
    return this.walkways.get(walkway);
  }
  walkwayReady(walkway: Walkway, frame: AssemblyFrame): boolean {
    return (
      !frame.active ||
      (this.dependencies.get(walkway) ?? []).every(
        (owner) => frame.progress(owner, "content") === 1,
      )
    );
  }
  clear() {
    this.platforms.clear();
    this.ships.clear();
    this.walkways.clear();
    this.dependencies.clear();
  }
  build(scene: Scene, starts: ReadonlyMap<AssemblyOwner, number>) {
    this.ships.set(null, "mail");
    for (const ship of scene.ships ?? []) this.ships.set(ship.id, shipOwner(ship.id));
    for (const platform of scene.platforms)
      this.platforms.set(platform.key, `platform:${platform.key}`);
    const anchors = [
      { owner: "mail" as AssemblyOwner, point: scene.mail.hub, rect: scene.mail.rect, host: "" },
      {
        owner: "observatory" as AssemblyOwner,
        point: scene.observatory.chair,
        rect: scene.observatory.rect,
        host: "",
      },
      ...scene.platforms.map((p) => ({
        owner: `platform:${p.key}` as AssemblyOwner,
        point: p.entry.point,
        rect: p.rect,
        host: p.host ?? "",
      })),
      ...(scene.ships ?? []).flatMap((s) =>
        s.mail && !s.local
          ? [{ owner: shipOwner(s.id), point: s.mail.hub, rect: s.mail.rect, host: s.id ?? "" }]
          : [],
      ),
    ];
    // Connectivity rejects unowned detached geometry; endpoints choose the latest adjoining owner.
    for (const w of connectedWalkways(scene, anchors)) {
      const candidates = endpoints(w.rect).flatMap((point) => {
        const nearest = anchors
          .filter((a) => a.host === (w.host ?? ""))
          .sort((a, b) => distance(point, a.point) - distance(point, b.point))[0];
        return nearest ? [nearest.owner] : [];
      });
      const latest = candidates.sort(
        (a, b) => (starts.get(b) ?? Infinity) - (starts.get(a) ?? Infinity),
      )[0];
      if (latest) this.walkways.set(w, latest);
    }
    this.buildRelays(scene, starts);
  }
  private buildRelays(scene: Scene, starts: ReadonlyMap<AssemblyOwner, number>) {
    for (const w of scene.walkways.filter((value) => value.kind === "relay-highway")) {
      const hosts = relayHosts(scene, w);
      const dependencies = [...hosts].flatMap((host) => [
        shipOwner(host),
        ...scene.platforms
          .filter((p) => (p.host ?? null) === host)
          .map((p): AssemblyOwner => `platform:${p.key}`),
      ]);
      if (hosts.size > 0) {
        this.dependencies.set(w, dependencies);
        const latest = dependencies.sort(
          (a, b) => (starts.get(b) ?? Infinity) - (starts.get(a) ?? Infinity),
        )[0];
        if (latest) this.walkways.set(w, latest);
      }
    }
  }
}

function orderedPlatforms(scene: Scene) {
  const hub = (p: Platform) =>
    scene.ships?.find((s) => s.id === (p.host ?? null))?.mail?.hub ?? scene.mail.hub;
  const families = new Map<string, Platform[]>();
  for (const p of scene.platforms) {
    const key = JSON.stringify([p.host ?? "", p.projectId]);
    const family = families.get(key) ?? [];
    family.push(p);
    families.set(key, family);
  }
  const roots = [...families.values()].map((family) =>
    [...family].sort((a, b) => a.annex - b.annex || a.key.localeCompare(b.key)),
  );
  roots.sort((a, b) => {
    const left = a[0],
      right = b[0];
    if (!left || !right) return 0;
    return (
      (left.host ?? "").localeCompare(right.host ?? "") ||
      distance(left.entry.point, hub(left)) - distance(right.entry.point, hub(right)) ||
      left.key.localeCompare(right.key)
    );
  });
  return roots.flat();
}

export class StartupAssembly {
  state: "pending" | "playing" | "complete" = "pending";
  readonly owners = new AssemblyOwnership();
  private starts = new Map<AssemblyOwner, number>();
  private began = 0;
  private elapsed = 0;
  begin(scene: Scene, now: number): void {
    if (this.state !== "pending") return;
    this.began = now;
    this.state = "playing";
    this.starts.set("mail", 0);
    this.starts.set("observatory", TIMING.observatory);
    for (const relay of scene.relays ?? [])
      this.starts.set(this.owners.relay(relay.key), TIMING.observatory);
    const rooms = orderedPlatforms(scene),
      groups = Math.min(TIMING.groups, rooms.length);
    rooms.forEach((p, index) => {
      const group = Math.floor((index * groups) / rooms.length);
      this.starts.set(
        `platform:${p.key}`,
        TIMING.first + (groups > 1 ? (group / (groups - 1)) * (TIMING.last - TIMING.first) : 0),
      );
    });
    for (const ship of scene.ships ?? [])
      if (!ship.local) {
        const own = rooms
          .filter((p) => p.host === ship.id)
          .map((p) => this.starts.get(`platform:${p.key}`) ?? TIMING.first);
        this.starts.set(
          shipOwner(ship.id),
          Math.max(
            TIMING.observatory,
            Math.min(TIMING.last, ...own) - TIMING.outline - TIMING.floor - TIMING.content,
          ),
        );
      }
    this.owners.build(scene, this.starts);
  }
  frame(now: number): AssemblyFrame {
    if (this.state === "playing") {
      this.elapsed = Math.max(this.elapsed, Math.min(TIMING.total, now - this.began));
      if (this.elapsed >= TIMING.total) this.complete();
    }
    const active = this.state === "playing",
      elapsed = this.elapsed;
    const phase = (owner: AssemblyOwner, offset: number, duration: number) => {
      if (!active) return 1;
      const start = this.starts.get(owner);
      return start === undefined ? 0 : ease((elapsed - start - offset) / duration);
    };
    return {
      active,
      progress: (owner, stage) =>
        phase(
          owner,
          TIMING.outline + (stage === "content" ? TIMING.floor : 0),
          stage === "content" ? TIMING.content : TIMING.floor,
        ),
      outline: (owner) => phase(owner, 0, TIMING.outline),
      sweep: (owner) =>
        phase(owner, TIMING.outline + TIMING.floor + TIMING.content - TIMING.sweep, TIMING.sweep),
    };
  }
  complete(): void {
    this.state = "complete";
    this.starts.clear();
    this.owners.clear();
  }
}
