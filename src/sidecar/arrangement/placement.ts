import path from "node:path";
import type { Remote, Room, Rule, Unit } from "./types.js";
import { BoundedMap, inside } from "./common.js";
const ORG_QUORUM = 2;
type FileRoom = (rules: Rule[], root: string, remote: Remote | null | undefined) => Room | null;
export class Placement {
  private readonly sticky = new BoundedMap<string, Room>();
  private readonly unitOrg = new BoundedMap<string, string>();
  constructor(private readonly fileRoom: FileRoom) {}
  private organizations(repositories: Unit[]) {
    const byOrg = new Map<string, Unit[]>();
    for (const unit of repositories) {
      if (!unit.remote) continue;
      const org = unit.remote.host + "/" + unit.remote.org;
      this.unitOrg.delete(unit.root);
      this.unitOrg.set(unit.root, org);
      const members = byOrg.get(org) ?? [];
      members.push(unit);
      byOrg.set(org, members);
    }
    this.unitOrg.prune();
    return byOrg;
  }
  private nearest(root: string, units: Map<string, Unit>) {
    let outer: string | undefined;
    for (const other of new Set([...units.keys(), ...this.sticky.keys()]))
      if (other !== root && inside(root, other) && (!outer || inside(other, outer))) outer = other;
    return outer;
  }
  arrange(units: Map<string, Unit>, rules: Rule[]) {
    const repositories = [...units.values()].filter((unit) => unit.kind === "repository");
    const byOrg = this.organizations(repositories),
      assigned = new Map<string, Room>();
    for (const unit of units.values()) {
      const file = this.fileRoom(rules, unit.root, unit.remote);
      if (file) assigned.set(unit.root, file);
    }
    const ruleUnits = [...units.values()].filter((unit) => !assigned.has(unit.root));
    // c. nested: the nearest outer Git checkout, else the nearest observed unit folder that contains this one.
    const nested = new Map<string, string>();
    for (const unit of ruleUnits) {
      const outer = unit.outer ?? this.nearest(unit.root, units);
      if (outer) nested.set(unit.root, outer);
    }
    const resolution = new RoomResolution({
      units,
      rules,
      assigned,
      nested,
      byOrg,
      sticky: this.sticky,
      unitOrg: this.unitOrg,
      fileRoom: this.fileRoom,
      nearest: (root) => this.nearest(root, units),
    });
    // Canonical ordering makes cyclic organization dependencies resolve consistently across roster permutations.
    for (const root of [...units.keys()].sort()) resolution.roomFor(root);
    for (const unit of ruleUnits) {
      const room = assigned.get(unit.root);
      if (room && !room.key.startsWith("file\0")) {
        this.sticky.delete(unit.root);
        this.sticky.set(unit.root, room);
      }
    }
    this.sticky.prune();
    return assigned;
  }
}
interface ResolutionOptions {
  units: Map<string, Unit>;
  rules: Rule[];
  assigned: Map<string, Room>;
  nested: Map<string, string>;
  byOrg: Map<string, Unit[]>;
  sticky: Map<string, Room>;
  unitOrg: Map<string, string>;
  fileRoom: FileRoom;
  nearest: (root: string) => string | undefined;
}
// Resolve room dependencies before caching any fallback. Organization mates can themselves be nested.
class RoomResolution {
  private readonly visiting = new Set<string>();
  constructor(private readonly options: ResolutionOptions) {}
  private outer(root: string) {
    const { nested, units, nearest } = this.options;
    // A Git ancestor may have no pane: continue through its known containing unit.
    return nested.get(root) ?? (units.has(root) ? undefined : nearest(root));
  }
  private inherited(root: string, outer: string | undefined): Room | null | undefined {
    if (!outer) return null;
    const inherited = this.roomFor(outer);
    return inherited?.key.startsWith("file\0")
      ? inherited
      : this.options.sticky.get(root) || inherited;
  }
  private memberRoom(member: Unit, root: string) {
    const { assigned, nested, sticky } = this.options;
    if (assigned.has(member.root)) return assigned.get(member.root);
    if (nested.has(member.root) && !inside(member.root, root)) return this.roomFor(member.root);
    if (!nested.has(member.root)) return sticky.get(member.root);
    return null;
  }
  private heldRooms(org: string, members: Unit[], root: string) {
    const { unitOrg, sticky } = this.options,
      held = new Map<string, Room>();
    const hold = (value: Room | null | undefined) => {
      if (value && !value.key.startsWith("file\0")) held.set(value.key, value);
    };
    for (const [known, key] of unitOrg)
      if (key === org && !members.some((unit) => unit.root === known)) hold(sticky.get(known));
    for (const member of members) if (member.root !== root) hold(this.memberRoom(member, root));
    return held;
  }
  private organization(root: string, remote: Remote) {
    const org = remote.host + "/" + remote.org,
      { byOrg, nested, assigned } = this.options;
    const members = byOrg.get(org) ?? [],
      held = this.heldRooms(org, members, root);
    if (held.size === 1) return [...held.values()][0];
    if (
      held.size === 0 &&
      members.filter((unit) => !nested.has(unit.root) && !assigned.has(unit.root)).length >=
        ORG_QUORUM
    )
      return { key: "org\0" + org, name: remote.org };
    return null;
  }
  private candidate(root: string) {
    const { units, rules, sticky, fileRoom } = this.options,
      remote = units.get(root)?.remote;
    const outer = this.outer(root);
    const room = fileRoom(rules, root, remote) || this.inherited(root, outer) || sticky.get(root);
    if (room) return room;
    return !outer && remote ? this.organization(root, remote) : null;
  }
  roomFor(root: string): Room | null {
    const { assigned } = this.options;
    if (assigned.has(root)) return assigned.get(root) ?? null;
    if (this.visiting.has(root)) return null;
    this.visiting.add(root);
    const room = this.candidate(root) || { key: "unit\0" + root, name: path.basename(root) };
    assigned.set(root, room);
    this.visiting.delete(root);
    return room;
  }
}
