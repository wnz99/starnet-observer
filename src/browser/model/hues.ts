import { element, required } from "./types.js";
import { identityHash } from "./identity.js";
import type { Unit } from "./types.js";
const ROOMS_PER_PAGE = 8;
const ownerOf = (key: string) => key.slice(0, key.lastIndexOf(":"));
const deckOf = (slot: number) => Math.floor(slot / ROOMS_PER_PAGE);
export class Hues {
  private readonly slots = new Map<string, number>();
  private hues = new Map<string, number>();
  constructor(private readonly palette: readonly (readonly [string, string])[]) {}
  colorFor(project: string) {
    return this.color(this.hues.get(project) ?? identityHash(project) % this.palette.length);
  }
  color(index: number) {
    const [floor, accent] = element(this.palette, index);
    return { floor, accent };
  }
  slot(key: string) {
    return required(this.slots, key);
  }
  pages() {
    return Math.max(1, Math.ceil((Math.max(-1, ...this.slots.values()) + 1) / ROOMS_PER_PAGE));
  }
  private decksOf(project: string) {
    return new Set(
      Array.from(this.slots)
        .filter(([key]) => ownerOf(key) === project)
        .map(([, slot]) => deckOf(slot)),
    );
  }
  private freeSlot(project: string, owners: ReadonlyMap<string, string | null>) {
    const host = owners.get(project) ?? null;
    const mine = Array.from(this.slots).filter(
      ([key]) => (owners.get(ownerOf(key)) ?? null) === host,
    );
    const used = new Set(mine.map(([, slot]) => slot));
    const hue = this.hues.get(project);
    const clash = (slot: number) =>
      hue !== undefined &&
      mine.some(
        ([key, other]) =>
          deckOf(other) === deckOf(slot) &&
          ownerOf(key) !== project &&
          this.hues.get(ownerOf(key)) === hue,
      );
    let slot = 0;
    while (used.has(slot) || clash(slot)) slot++;
    return slot;
  }
  private choose(
    project: string,
    next: ReadonlyMap<string, number>,
    decks: ReadonlyMap<string, Set<number>>,
  ) {
    const shared = new Set<number>();
    const anywhere = new Set<number>();
    for (const [other, hue] of next) {
      anywhere.add(hue);
      if (Array.from(required(decks, other)).some((deck) => required(decks, project).has(deck)))
        shared.add(hue);
    }
    const previous = this.hues.get(project);
    if (previous !== undefined && !shared.has(previous)) return previous;
    const start = identityHash(project) % this.palette.length;
    const candidates = this.palette.map((_, index) => (start + index) % this.palette.length);
    return (
      candidates.find((index) => !anywhere.has(index)) ??
      candidates.find((index) => !shared.has(index)) ??
      start
    );
  }
  private assign(projects: ReadonlySet<string>) {
    const order = [
      ...Array.from(this.hues.keys()).filter((project) => projects.has(project)),
      ...Array.from(projects).filter((project) => !this.hues.has(project)),
    ];
    const decks = new Map(order.map((project) => [project, this.decksOf(project)]));
    const next = new Map<string, number>();
    for (const project of order) next.set(project, this.choose(project, next, decks));
    const changed =
      next.size !== this.hues.size ||
      Array.from(next).some(([project, hue]) => this.hues.get(project) !== hue);
    this.hues = next;
    return changed;
  }
  reconcile(units: ReadonlyMap<string, Unit>, owners: ReadonlyMap<string, string | null>) {
    let changed = false;
    for (const key of this.slots.keys())
      if (!units.has(key)) {
        this.slots.delete(key);
        changed = true;
      }
    for (const [key, unit] of units)
      if (!this.slots.has(key)) {
        this.slots.set(key, this.freeSlot(unit.projectId, owners));
        changed = true;
      }
    return this.assign(new Set(owners.keys())) || changed;
  }
}
