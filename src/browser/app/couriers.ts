import { createMail } from "../mail.js";
import type { PendingSpot } from "../scene/types.js";
import { mailOf, pending, route } from "../scene/mail.js";
import type { MailFrame } from "../view/types.js";
import type { AppBus, AppQuerySnapshot, AppRow, AppSnapshot } from "./data.js";
import type { AppState } from "./state.js";

type Courier = ReturnType<ReturnType<typeof createMail>["createCourier"]>;
interface CourierOptions {
  state: AppState;
  reducedMotion(): boolean;
  frame(): number;
}
/* One courier per host's bus, stepped by the view's frame: this machine's, plus one associated with each remote ship, whose
   flights stay inside that ship (its own mailroom and crew). A transition into stale or reduced grounds flights at
   once; the reset makes the next live snapshot rebase instead of replaying what was missed. */
export class Couriers {
  readonly local: Courier;
  private readonly mail: ReturnType<typeof createMail>;
  private readonly remote = new Map<string, Courier>();
  private readonly remotePending = new Map<string, PendingSpot[]>();
  private readonly remoteGrounded = new Set<string>();
  private pending: PendingSpot[] = [];
  private grounded = true;
  private ingested: AppSnapshot | null = null;
  private ingestedStale = false;
  private ingestedHosts: AppSnapshot | null | undefined = null;
  constructor(private readonly options: CourierOptions) {
    this.mail = createMail(options.state.pack);
    this.local = this.create();
  }
  private create() {
    const { pack } = this.options.state;
    return this.mail.createCourier({ colors: pack.scene.colors });
  }
  forHost(host: string) {
    let courier = this.remote.get(host);
    if (!courier) {
      courier = this.create();
      this.remote.set(host, courier);
    }
    return courier;
  }
  reset() {
    this.local.reset();
    for (const courier of this.remote.values()) courier.reset();
  }
  rebase() {
    this.reset();
    this.ingested = null;
    this.ingestedHosts = null;
  }
  frame(now: number): MailFrame {
    const { state } = this.options;
    if (state.disposed || !state.active) return { drones: [], envelopes: [] };
    const ground = state.mailStale() || this.options.reducedMotion();
    if (ground && !this.grounded) this.local.reset();
    this.grounded = ground;
    this.local.step(now);
    const frame: MailFrame = this.local.frame(now, {
      reduced: ground,
      pending: this.pending,
      pads: state.scene?.mail.pads ?? [],
    });
    const remote = this.remoteFrames(now);
    frame.drones.push(...remote.drones);
    frame.envelopes.push(...remote.envelopes);
    return frame;
  }
  private remoteFrames(now: number): MailFrame {
    const frame: MailFrame = { drones: [], envelopes: [] };
    const { state } = this.options;
    for (const [host, courier] of this.remote) {
      const own = state.scene && mailOf(state.scene, host);
      if (!own) continue;
      const grounded = state.remoteMailStale(host) || this.options.reducedMotion();
      if (grounded && !this.remoteGrounded.has(host)) courier.reset();
      if (grounded) this.remoteGrounded.add(host);
      else this.remoteGrounded.delete(host);
      courier.step(now);
      const extra = courier.frame(now, {
        reduced: grounded,
        pending: this.remotePending.get(host) ?? [],
        pads: own.pads,
      });
      frame.drones.push(...extra.drones);
      frame.envelopes.push(...extra.envelopes);
    }
    return frame;
  }
  private updateCourier(
    courier: Courier,
    bus: AppBus | null,
    rows: AppRow[],
    delivery: { live: boolean; host: string | null },
  ) {
    const { state } = this.options;
    const scene = state.scene;
    if (!scene) return;
    // The retained bus is passed to the courier unchanged; its own optional observations are not inventory proof.
    courier.update(bus, {
      now: this.options.frame(),
      deck: state.page,
      reduced: this.options.reducedMotion(),
      live: delivery.live,
      route: (message) => route(scene, state.layout, message, rows, delivery.host),
    });
  }
  update(snapshot: AppQuerySnapshot, rows: AppRow[]) {
    const { state } = this.options;
    const data = snapshot.data;
    const scene = state.scene;
    if (!scene) return;
    const bus = data?.bus ?? null;
    // Bus metadata is still listed during a stale inventory observation; flights need both to be live.
    const parked = state.mailStale(snapshot);
    if (data && (data !== this.ingested || parked !== this.ingestedStale)) {
      this.ingested = data;
      this.ingestedStale = parked;
      this.updateCourier(this.local, bus, rows, { live: !parked, host: null });
    }
    this.pending = pending(scene, state.layout, bus?.messages ?? []);
    this.updateHosts(snapshot, rows);
    this.ingestedHosts = data;
  }
  private updateHosts(snapshot: AppQuerySnapshot, rows: AppRow[]) {
    const { state } = this.options;
    const data = snapshot.data;
    const scene = state.scene;
    if (!scene) return;
    const hosts = data?.hostBus ?? {};
    // Each remote host's own mail: its courier and pending envelopes stay on its own ship.
    for (const id of this.remote.keys())
      if (!hosts[id]) {
        this.remote.delete(id);
        this.remotePending.delete(id);
        this.remoteGrounded.delete(id);
      }
    for (const [id, value] of Object.entries(hosts)) {
      if (data !== this.ingestedHosts)
        this.updateCourier(this.forHost(id), value, rows, {
          live: !state.remoteMailStale(id, snapshot),
          host: id,
        });
      this.remotePending.set(id, pending(scene, state.layout, value?.messages ?? [], id));
    }
  }
  dispose() {
    this.reset();
    this.remote.clear();
    this.remotePending.clear();
    this.remoteGrounded.clear();
    this.pending = [];
  }
}
