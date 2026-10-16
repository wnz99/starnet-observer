/* Courier display uses observed message metadata only; it never sends or acknowledges. */
import type { ThemeContents } from "../shared/theme.js";
import { courierFrame } from "./mail/frame.js";
import { FADE, FLIGHT, GAP, MAX_AIRBORNE, MAX_QUEUE, position } from "./mail/geometry.js";
import type {
  CourierBus,
  CourierMessage,
  CourierRoute,
  Fade,
  Flight,
  FrameOptions,
  UpdateOptions,
} from "./mail/types.js";
export { along, LEG, SORT, FLIGHT, FADE, GAP, MAX_AIRBORNE, MAX_QUEUE } from "./mail/geometry.js";
type MailColors = Pick<
  ThemeContents["scene"]["colors"],
  "mail-pending" | "mail-acknowledged" | "mail-unassigned"
>;
const PENDING_COLOR = "mail-pending";
class Courier {
  private known = new Map<number, { acked: boolean }>();
  private top = 0;
  private lastAt: number | null = null;
  private deck: number | string | null = null;
  private resume = true;
  private primed = false;
  private airborne: Flight[] = [];
  private queue: Omit<Flight, "start">[] = [];
  private fades: Fade[] = [];
  private skipped = 0;
  constructor(private readonly colors: MailColors) {}
  private tint(route: CourierRoute) {
    return route.color || this.colors["mail-unassigned"];
  }
  private clear() {
    this.airborne = [];
    this.queue = [];
    this.fades = [];
  }
  reset() {
    this.resume = true;
    this.clear();
  }
  private enqueue(message: CourierMessage, route: CourierRoute, now: number) {
    const joining =
      this.airborne.find((flight) => flight.key === route.key && flight.start === now) ||
      this.queue.find((flight) => flight.key === route.key);
    if (joining) {
      joining.ids.push(message.id);
      return;
    }
    if (this.queue.length >= MAX_QUEUE) {
      this.skipped++;
      return;
    }
    this.queue.push({
      key: route.key,
      ids: [message.id],
      from: route.from,
      to: route.to,
      color: this.tint(route),
    });
    this.step(now);
  }
  private shouldRebase(
    now: number,
    nextDeck: number | string,
    newest: number,
    options: { animate: boolean; reduced: boolean },
  ) {
    return (
      !options.animate ||
      this.resume ||
      !this.primed ||
      this.lastAt === null ||
      nextDeck !== this.deck ||
      now - this.lastAt > GAP ||
      options.reduced ||
      newest < this.top
    );
  }
  private animateMessages<T extends CourierMessage>(
    messages: readonly T[],
    options: UpdateOptions<T>,
  ) {
    for (const message of messages
      .filter((value) => value.id > this.top && !this.known.has(value.id))
      .sort((a, b) => a.id - b.id))
      this.enqueue(message, options.route(message), options.now);
    for (const message of messages) {
      const previous = this.known.get(message.id);
      if (previous && !previous.acked && message.acknowledgedAt) {
        const route = options.route(message);
        const point = route.to[0];
        if (point) this.fades.push({ at: options.now, point, color: this.tint(route) });
      }
    }
  }
  update<T extends CourierMessage>(bus: CourierBus<T> | null, options: UpdateOptions<T>) {
    const { now, deck: nextDeck, reduced = false, live = true } = options;
    const messages = bus?.messages ?? [];
    const animate = live && bus?.health === "available";
    const newest = messages.reduce((max, message) => Math.max(max, message.id), 0);
    const rebase = this.shouldRebase(now, nextDeck, newest, { animate, reduced });
    if (rebase) this.clear();
    else this.animateMessages(messages, options);
    this.known = new Map(
      messages.map((message) => [message.id, { acked: Boolean(message.acknowledgedAt) }]),
    );
    this.top = rebase ? newest : Math.max(this.top, newest);
    this.primed = animate;
    this.lastAt = now;
    this.deck = nextDeck;
    this.resume = false;
    this.step(now);
  }
  step(now: number) {
    this.airborne = this.airborne.filter((flight) => now - flight.start < FLIGHT);
    this.fades = this.fades.filter((fade) => now - fade.at < FADE);
    for (let index = 0; index < this.queue.length && this.airborne.length < MAX_AIRBORNE;) {
      const queued = this.queue[index];
      if (!queued) break;
      if (this.airborne.some((flight) => flight.key === queued.key)) {
        index++;
        continue;
      }
      this.queue.splice(index, 1);
      this.airborne.push({ ...queued, start: now });
    }
  }
  state() {
    return {
      airborne: this.airborne.map((flight) => ({
        key: flight.key,
        ids: flight.ids.slice(),
        start: flight.start,
      })),
      queued: this.queue.length,
      skipped: this.skipped,
      fades: this.fades.length,
    };
  }
  frame(now: number, options: FrameOptions = {}) {
    return courierFrame(
      now,
      options,
      { airborne: this.airborne, fades: this.fades },
      { pending: this.colors[PENDING_COLOR], acknowledged: this.colors["mail-acknowledged"] },
    );
  }
}
export function createMail(defaults: ThemeContents) {
  function createCourier({ colors = {} }: { colors?: Partial<MailColors> } = {}) {
    const base = defaults.scene.colors;
    const courier = new Courier({
      "mail-pending": colors[PENDING_COLOR] ?? base[PENDING_COLOR],
      "mail-acknowledged": colors["mail-acknowledged"] ?? base["mail-acknowledged"],
      "mail-unassigned": colors["mail-unassigned"] ?? base["mail-unassigned"],
    });
    return {
      update: courier.update.bind(courier),
      step: courier.step.bind(courier),
      reset: courier.reset.bind(courier),
      position,
      state: courier.state.bind(courier),
      frame: courier.frame.bind(courier),
    };
  }
  return { createCourier };
}
