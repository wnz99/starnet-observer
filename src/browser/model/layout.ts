import {
  helperStations,
  hostOf,
  isHelper,
  projectKey,
  projectName,
  repoKey,
  sectionData,
  sectionKey,
  sectionLabel,
} from "./identity.js";
import { Hues } from "./hues.js";
import { element, required } from "./types.js";
import type { Block, Helper, LayoutRow, Pane, Room, Unit } from "./types.js";
const ROOT_COLUMNS = [2, 6, 12, 16];
const ROOT_COLUMNS_COUNT = 4;
const ROOT_Y = 6;
const ROOT_ROW_HEIGHT = 3;
const BLOCK_SEATS = 8;
const BLOCKS_PER_ROOM = 3;
const ROOMS_PER_PAGE = 8;
interface ValidHelper {
  row: LayoutRow;
  rootId: string;
  depth: number;
}
export class Layout {
  private readonly panes = new Map<string, Pane>();
  private readonly helpers = new Map<string, Helper>();
  private readonly wings = new Map<string, Block[]>();
  private readonly names = new Map<string, string>();
  private readonly owners = new Map<string, string | null>();
  private rooms: Room[] = [];
  private readonly hues: Hues;
  constructor(palette: readonly (readonly [string, string])[]) {
    this.hues = new Hues(palette);
  }
  private allocate(project: string, repo: string, label: string, section: string) {
    const blocks = this.wings.get(project) ?? [];
    this.wings.set(project, blocks);
    const taken = blocks.map(() => new Set<number>());
    for (const pane of this.panes.values())
      if (pane.project === project) element(taken, pane.block).add(pane.seat);
    let block = blocks.findIndex(
      (value, index) =>
        (value.section || value.repo) === section && element(taken, index).size < BLOCK_SEATS,
    );
    if (block < 0) block = blocks.findIndex((_, index) => element(taken, index).size === 0);
    if (block < 0) {
      block = blocks.length;
      taken.push(new Set());
    }
    blocks[block] = { repo, label, section };
    let seat = 0;
    while (element(taken, block).has(seat)) seat++;
    return { block, seat };
  }
  private placeRoots(roots: readonly LayoutRow[]) {
    let changed = false;
    const moved: string[] = [];
    for (const row of roots) {
      const project = projectKey(row),
        repo = repoKey(row),
        section = sectionKey(row);
      const previous = this.panes.get(row.id);
      this.names.set(project, projectName(row));
      this.owners.set(project, hostOf(row));
      if (
        previous &&
        previous.project === project &&
        previous.repo === repo &&
        previous.section === section
      ) {
        const block = element(required(this.wings, project), previous.block),
          data = sectionData(row);
        if (JSON.stringify(block) !== JSON.stringify({ ...block, ...data })) {
          Object.assign(block, data);
          changed = true;
        }
        continue;
      }
      if (previous) {
        this.panes.delete(row.id);
        moved.push(row.id);
      }
      const allocation = this.allocate(project, repo, sectionLabel(row), section);
      Object.assign(element(required(this.wings, project), allocation.block), sectionData(row));
      this.panes.set(row.id, { project, repo, section, ...allocation });
      changed = true;
    }
    return { changed, moved };
  }
  private trimWings() {
    let changed = false;
    for (const [project, blocks] of this.wings) {
      const used = new Set(
        Array.from(this.panes.values())
          .filter((pane) => pane.project === project)
          .map((pane) => pane.block),
      );
      while (blocks.length > 0 && !used.has(blocks.length - 1)) {
        blocks.pop();
        changed = true;
      }
      if (blocks.length === 0) {
        this.wings.delete(project);
        this.names.delete(project);
        this.owners.delete(project);
      }
    }
    return changed;
  }
  private units(byId: ReadonlyMap<string, LayoutRow>) {
    const units = new Map<string, Unit>();
    for (const [project, blocks] of this.wings)
      for (let annex = 0; annex * BLOCKS_PER_ROOM < blocks.length; annex++) {
        const host = this.owners.get(project);
        units.set(`${project}:${String(annex)}`, {
          key: `${project}:${String(annex)}`,
          projectId: project,
          name: required(this.names, project),
          annex,
          ...(host ? { host } : {}),
          blocks: blocks.slice(annex * BLOCKS_PER_ROOM, (annex + 1) * BLOCKS_PER_ROOM),
          rows: [],
        });
      }
    for (const [id, pane] of this.panes) {
      const annex = Math.floor(pane.block / BLOCKS_PER_ROOM);
      required(units, `${pane.project}:${String(annex)}`).rows.push({
        row: required(byId, id),
        kind: "session",
        block: pane.block % BLOCKS_PER_ROOM,
        seat: pane.seat,
      });
    }
    return units;
  }
  private validHelpers(rows: readonly LayoutRow[], byId: ReadonlyMap<string, LayoutRow>) {
    const valid = new Map<string, ValidHelper>();
    for (const row of rows.filter(isHelper)) {
      const seen = new Set([row.id]);
      let parent: LayoutRow | undefined = row,
        depth = 0;
      while (parent && parent.parentId && !seen.has(parent.parentId)) {
        seen.add(parent.parentId);
        parent = byId.get(parent.parentId);
        depth++;
        if (parent && this.panes.has(parent.id)) break;
      }
      if (parent && parent.id !== row.id && this.panes.has(parent.id))
        valid.set(row.id, { row, rootId: parent.id, depth });
    }
    return valid;
  }
  private helperMatches(allocation: Helper, value: ValidHelper | undefined) {
    const root = value && (this.panes.get(value.row.id) ?? this.panes.get(value.rootId));
    return (
      value &&
      root &&
      allocation.rootId === value.rootId &&
      allocation.parentId === (value.row.parentId ?? null) &&
      allocation.project === root.project &&
      allocation.repo === root.repo &&
      allocation.block === root.block
    );
  }
  private trimHelpers(valid: ReadonlyMap<string, ValidHelper>) {
    const moved: string[] = [],
      removed: string[] = [];
    for (const [id, allocation] of this.helpers) {
      const value = valid.get(id);
      if (!this.helperMatches(allocation, value)) {
        this.helpers.delete(id);
        (value ? moved : removed).push(id);
      }
    }
    return { moved, removed };
  }
  private station(root: Pane, row: LayoutRow) {
    const parent = row.parentId ? this.helpers.get(row.parentId) : undefined;
    const at =
      parent?.helperSlot === null || parent?.helperSlot === undefined
        ? {
            x: element(ROOT_COLUMNS, root.seat % ROOT_COLUMNS_COUNT),
            y: ROOT_Y + Math.floor(root.seat / ROOT_COLUMNS_COUNT) * ROOT_ROW_HEIGHT,
          }
        : element(helperStations, parent.helperSlot);
    const used = new Set(
      Array.from(this.helpers.values())
        .filter((helper) => helper.project === root.project && helper.block === root.block)
        .map((helper) => helper.helperSlot),
    );
    return (
      helperStations
        .map((station, index) => ({
          index,
          distance: Math.hypot(station.x - at.x, station.y - at.y),
        }))
        .sort((a, b) => a.distance - b.distance || a.index - b.index)
        .find((candidate) => !used.has(candidate.index))?.index ?? null
    );
  }
  private placeHelpers(valid: ReadonlyMap<string, ValidHelper>) {
    let changed = false;
    for (const { row, rootId } of Array.from(valid.values()).sort(
      (a, b) => a.depth - b.depth || a.row.id.localeCompare(b.row.id),
    )) {
      const root = this.panes.get(row.id) ?? required(this.panes, rootId),
        previous = this.helpers.get(row.id);
      if (previous && previous.helperSlot !== null) continue;
      const helperSlot = this.station(root, row);
      if (!previous || previous.helperSlot !== helperSlot) changed = true;
      this.helpers.set(row.id, { ...root, rootId, parentId: row.parentId ?? null, helperSlot });
    }
    return changed;
  }
  private helperRows(units: Map<string, Unit>, byId: ReadonlyMap<string, LayoutRow>) {
    for (const [id, allocation] of this.helpers) {
      const annex = Math.floor(allocation.block / BLOCKS_PER_ROOM);
      required(units, `${allocation.project}:${String(annex)}`).rows.push({
        row: required(byId, id),
        kind: "helper",
        rootId: allocation.rootId,
        parentId: allocation.parentId,
        block: allocation.block % BLOCKS_PER_ROOM,
        helperSlot: allocation.helperSlot,
      });
    }
  }
  reconcile(rows: readonly LayoutRow[]) {
    const byId = new Map(rows.map((row) => [row.id, row]));
    const roots = rows.filter((row) => !isHelper(row) || (row.source === "herdr" && !!row.paneId)),
      live = new Set(roots.map((row) => row.id));
    const removed: string[] = [];
    for (const id of this.panes.keys())
      if (!live.has(id)) {
        this.panes.delete(id);
        removed.push(id);
      }
    const placement = this.placeRoots(roots),
      trimmed = this.trimWings();
    const units = this.units(byId),
      valid = this.validHelpers(rows, byId);
    const helperTrim = this.trimHelpers(valid),
      helperPlacement = this.placeHelpers(valid);
    this.helperRows(units, byId);
    const huesChanged = this.hues.reconcile(units, this.owners);
    this.rooms = Array.from(units.values(), (room) => ({
      ...room,
      slot: this.hues.slot(room.key),
      ...this.hues.colorFor(room.projectId),
    }));
    return {
      changed:
        placement.changed ||
        trimmed ||
        helperPlacement ||
        huesChanged ||
        removed.length > 0 ||
        helperTrim.removed.length > 0 ||
        helperTrim.moved.length > 0,
      removed: [...removed, ...helperTrim.removed],
      moved: [...placement.moved, ...helperTrim.moved],
    };
  }
  pages() {
    return this.hues.pages();
  }
  onPage(page: number) {
    return this.rooms.filter((room) => Math.floor(room.slot / ROOMS_PER_PAGE) === page);
  }
  allRooms(): readonly Room[] {
    return this.rooms;
  }
  pageFor(id: string) {
    const pane = this.panes.get(id) ?? this.helpers.get(id);
    return pane
      ? Math.floor(
          this.hues.slot(`${pane.project}:${String(Math.floor(pane.block / BLOCKS_PER_ROOM))}`) /
            ROOMS_PER_PAGE,
        )
      : 0;
  }
  colorFor(project: string) {
    return this.hues.colorFor(project);
  }
  seatFor(id: string) {
    const pane = this.panes.get(id);
    return pane ? pane.block * BLOCK_SEATS + pane.seat : undefined;
  }
}
