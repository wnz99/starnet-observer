import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ArrangerOptions, Arrangement, ArrangementEntry, Unit, Room } from "./types.js";
import { clean, opaque } from "./common.js";
import { Discovery } from "./discovery.js";
import { RoomFile } from "./room-file.js";
import { Placement } from "./placement.js";
export { parseRemote, validateRooms } from "./rooms.js";
export const UNASSIGNED: Arrangement = Object.freeze({
  roomId: "unassigned",
  room: "Unassigned",
  sectionId: "unassigned",
  section: "",
});
const CONCURRENCY = 4;
const SECTION_LIMIT = 120;
interface Place {
  root: string;
  checkout: string;
  sub: string;
}
async function pooled<T>(items: T[], work: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
      while (next < items.length) {
        const item = items[next++];
        if (item !== undefined) await work(item);
      }
    }),
  );
}
function place(entry: ArrangementEntry, root: string): Place {
  const checkout = entry.kind === "repository" ? entry.checkoutRoot || root : root;
  const rel = path.relative(checkout, entry.here);
  const sub =
    rel && !rel.startsWith("..") && !path.isAbsolute(rel)
      ? rel.split(path.sep).map(clean).filter(Boolean).join("/").slice(0, SECTION_LIMIT)
      : "";
  return { root, checkout, sub };
}
function section(place: Place, room: Room, name: string) {
  const own = room.key === "unit\0" + place.root;
  if (place.checkout !== place.root) {
    const checkoutName = clean(path.basename(place.checkout)) || name;
    return checkoutName + (place.sub ? "/" + place.sub : "");
  }
  if (own) return place.sub || name;
  return name + (place.sub ? "/" + place.sub : "");
}
function render(place: Place | null, assigned: Map<string, Room>): Arrangement {
  if (!place) return { ...UNASSIGNED };
  const room = assigned.get(place.root);
  if (!room) throw new Error("Unassigned arrangement unit");
  const name = clean(path.basename(place.root)) || "Local folder";
  return {
    roomId: opaque("room_", room.key),
    room: clean(room.name) || "Local folder",
    sectionId: opaque("sec_", place.root + "\0" + place.checkout + "\0" + place.sub),
    section: section(place, room, name).slice(0, SECTION_LIMIT),
  };
}
/* Dynamic arrangement: a second, optional room/section grouping published beside the folder grouping. The page
   chooses which one to draw, so the toggle needs no refetch. Rules, in order:
     e. rooms file (explicit, re-read on change) — first matching room wins;
     c. a repository nested inside another repository (or an observed unit's folder) joins that outer unit's room;
     d. units whose origin shares host/org share a room named after the org, once two such units are observed;
     f. otherwise the unit is its own room.
   A unit is a Git repository (its sub-folders are sections) or, with a non-Git folder, the top-most folder directly
   under a workspace root (a folder that directly holds a Git repository, or $HOME). Rule-made rooms are sticky throughout
   the server's lifetime: a unit never moves once placed; only the rooms file re-arranges. Only opaque ids and short
   labels leave this module; paths and remote URLs never do. */

class Arranger {
  private homeReal: string | null = null;
  private readonly discovery: Discovery;
  private readonly roomFile: RoomFile;
  private readonly placement: Placement;
  constructor(
    private readonly options: {
      git: ArrangerOptions["git"];
      now: () => number;
      fs: NonNullable<ArrangerOptions["fs"]>;
      home: string;
      roomsFile: string | null;
      warn: (message: string) => void;
    },
  ) {
    this.discovery = new Discovery(options);
    this.roomFile = new RoomFile(options.fs, options);
    this.placement = new Placement(this.roomFile.fileRoom);
  }
  private async prepare(entries: (ArrangementEntry | null)[]) {
    const { fs, home } = this.options;
    if (this.homeReal === null) {
      try {
        this.homeReal = await fs.realpath(home);
      } catch {
        this.homeReal = home;
      }
    }
    const roots: string[] = [];
    for (const entry of entries) if (entry?.kind === "repository") roots.push(entry.root);
    this.discovery.observe(roots);
    this.roomFile.setHome(this.homeReal);
    this.discovery.setHome(this.homeReal);
  }
  /* Each entry carries kind (repository or folder), root, checkoutRoot and here as canonical absolute paths, or null (unassigned). */
  arrange = async (entries: (ArrangementEntry | null)[]): Promise<Arrangement[]> => {
    await this.prepare(entries);
    const units = new Map<string, Unit>(),
      placed: (Place | null)[] = [];
    for (const entry of entries) {
      if (!entry) {
        placed.push(null);
        continue;
      }
      const root =
        entry.kind === "repository" ? entry.root : await this.discovery.folderUnit(entry.here);
      if (!units.has(root)) units.set(root, { root, kind: entry.kind, remote: null, outer: null });
      placed.push(place(entry, root));
    }
    const repositories = [...units.values()].filter((unit) => unit.kind === "repository");
    await pooled(repositories, async (unit) => {
      const value = await this.discovery.unitInfo(unit.root);
      units.set(unit.root, { ...unit, remote: value.remote, outer: value.outer });
    });
    const assigned = this.placement.arrange(units, await this.roomFile.loadRooms());
    return placed.map((value) => render(value, assigned));
  };
}
export function makeArranger({
  git,
  now,
  fs = fsp,
  home = os.homedir(),
  roomsFile = null,
  warn = () => {},
}: ArrangerOptions) {
  if (typeof git !== "function" || typeof now !== "function")
    throw new TypeError("Arranger requires git and now");
  const arranger = new Arranger({ git, now, fs, home, roomsFile, warn });
  return { arrange: arranger.arrange };
}
