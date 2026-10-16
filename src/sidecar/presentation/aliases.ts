import type { Row } from "./types.js";
import type { ObserverConfig } from "../../shared/observer.js";
export type Labels = ObserverConfig["labels"];

export class NumberedAliases {
  private readonly values = new Map<string, string>();
  constructor(private readonly prefix: string) {}
  get(key: string) {
    const old = this.values.get(key);
    if (old !== undefined) return old;
    const value = this.prefix + " " + String(this.values.size + 1);
    this.values.set(key, value);
    return value;
  }
}
interface Room {
  name: string;
  repos: readonly string[];
  count: number;
}
class ProjectAliases {
  private readonly projects = new Map<Row["projectId"], Room>();
  private readonly repos = new Map<Row["repoId"], string>();
  private readonly roomNames: Set<string>;
  private readonly repoNames: Set<string>;
  constructor(private readonly labels: Labels) {
    this.roomNames = new Set(labels.rooms.map((room) => room.name.toLowerCase()));
    this.repoNames = new Set(
      labels.rooms.flatMap((room) => room.repos).map((name) => name.toLowerCase()),
    );
  }
  project(id: Row["projectId"]): Room {
    const old = this.projects.get(id);
    if (old) return old;
    const index = this.projects.size,
      room = this.labels.rooms[index];
    let name = room?.name || "",
      suffix = index + 1;
    if (!room) {
      do {
        name = "Studio " + String(suffix++);
      } while (this.roomNames.has(name.toLowerCase()));
      this.roomNames.add(name.toLowerCase());
    }
    const value = { name, repos: room?.repos || [], count: 0 };
    this.projects.set(id, value);
    return value;
  }
  repo(row: Row, room: Room) {
    const old = this.repos.get(row.repoId);
    if (old) return old;
    const index = room.count;
    this.projects.set(row.projectId, { ...room, count: index + 1 });
    const name = room.repos[index] || this.fallbackRepo(room.name, index);
    this.repos.set(row.repoId, name);
    return name;
  }
  private fallbackRepo(room: string, index: number) {
    const stem =
      this.labels.repoPrefix +
      "-" +
      (room
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "studio");
    let suffix = index + 1,
      name: string;
    do {
      name = stem + "-" + String(suffix++);
    } while (this.repoNames.has(name.toLowerCase()));
    this.repoNames.add(name.toLowerCase());
    return name;
  }
}
function makeArrangementAliases() {
  // Dynamic-arrangement labels are private too: fictional bay/section names in the same sorted allocation pass.
  const bays = new NumberedAliases("Bay"),
    sections = new NumberedAliases("Section");
  return (value: Row["arrangement"]) =>
    value && typeof value.roomId === "string" && typeof value.sectionId === "string"
      ? {
          roomId: value.roomId,
          room: value.roomId === "unassigned" ? "Unassigned" : bays.get(value.roomId),
          sectionId: value.sectionId,
          section: value.sectionId === "unassigned" ? "" : sections.get(value.sectionId),
        }
      : null;
}
export function makeAliases(labels: Labels) {
  const projects = new ProjectAliases(labels),
    arrangement = makeArrangementAliases();
  // Remote host ids are operator-chosen names (often real machine names): they become fictional ship names.
  const hosts = new NumberedAliases("Ship");
  // llm-bus relay names (relay host, machine ids, shared repo ids) are real names too: each gets a stable fictional alias.
  const namespaces = new Map<string, string>();
  function host(id: string): string;
  function host(id: null | undefined): null;
  function host(id: string | null | undefined): string | null;
  function host(id: string | null | undefined) {
    return id === null || id === undefined ? null : hosts.get(id);
  }
  const alias = (kind: string, prefix: string, id: string) => {
    const key = kind + "\0" + id,
      old = namespaces.get(key);
    if (old !== undefined) return old;
    const value =
      prefix +
      " " +
      String([...namespaces.keys()].filter((k) => k.startsWith(kind + "\0")).length + 1);
    namespaces.set(key, value);
    return value;
  };
  return {
    host,
    alias,
    project: (id: Row["projectId"]) => projects.project(id),
    repo: (row: Row, room: Room) => projects.repo(row, room),
    arrangement,
  };
}
export type Aliases = ReturnType<typeof makeAliases>;
