import path from "node:path";
import type { ArrangementFs, Remote, Room, Rule } from "./types.js";
import { validateRooms, globRegExp } from "./rooms.js";
const ROOMS_MAX = 65536;
const HOME_PREFIX_LENGTH = 2;
const ORGANIZATION_PARTS = 2;
interface RoomFileOptions {
  home: string;
  roomsFile: string | null;
  warn: (message: string) => void;
}
export class RoomFile {
  private homeReal: string | null = null;
  private rooms: { stamp: string | null; rules: Rule[] } = { stamp: null, rules: [] };
  constructor(
    private readonly fs: ArrangementFs,
    private readonly options: RoomFileOptions,
  ) {}
  setHome(value: string) {
    this.homeReal = value;
  }
  private async read(file: string, size: number) {
    if (size > ROOMS_MAX) throw new Error("Rooms file exceeds 64 KiB");
    const handle = await this.fs.open(file, "r");
    try {
      const buffer = Buffer.alloc(ROOMS_MAX + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead > ROOMS_MAX) throw new Error("Rooms file exceeds 64 KiB");
      return validateRooms(JSON.parse(buffer.subarray(0, bytesRead).toString("utf8")));
    } finally {
      await handle.close();
    }
  }
  private async rules(file: string, size: number) {
    try {
      return await this.read(file, size);
    } catch (error) {
      const reason =
        error instanceof SyntaxError
          ? "invalid JSON"
          : error instanceof Error
            ? error.message
            : String(error);
      this.options.warn("Rooms file ignored: " + reason);
      return [];
    }
  }
  async loadRooms() {
    const { roomsFile } = this.options;
    if (!roomsFile) return this.rooms.rules;
    let stat;
    try {
      stat = await this.fs.stat(roomsFile);
    } catch {
      this.rooms = { stamp: null, rules: [] };
      return this.rooms.rules;
    }
    const stamp = `${String(stat.mtimeMs)}:${String(stat.size)}`;
    if (stamp === this.rooms.stamp) return this.rooms.rules;
    this.rooms = { stamp, rules: await this.rules(roomsFile, stat.size) };
    return this.rooms.rules;
  }
  private expand(pattern: string) {
    if (!pattern.startsWith("~/")) return [pattern];
    const { home } = this.options;
    return [
      path.join(home, pattern.slice(HOME_PREFIX_LENGTH)),
      ...(this.homeReal && this.homeReal !== home
        ? [path.join(this.homeReal, pattern.slice(HOME_PREFIX_LENGTH))]
        : []),
    ];
  }
  private matches(entry: Rule["match"][number], root: string, slug: string | null) {
    if (entry.kind === "path")
      return (
        !!root &&
        this.expand(entry.pattern).some((pattern) =>
          globRegExp(pattern.replace(/\/+$/, "")).test(root),
        )
      );
    if (!slug) return false;
    const target =
      entry.pattern.split("/").length === ORGANIZATION_PARTS
        ? slug.split("/").slice(0, ORGANIZATION_PARTS).join("/")
        : slug;
    return globRegExp(entry.pattern).test(target);
  }
  fileRoom = (rules: Rule[], unitRoot: string, remote: Remote | null | undefined): Room | null => {
    const slug = remote ? remote.host + "/" + remote.org + "/" + remote.name : null;
    for (const rule of rules)
      for (const entry of rule.match)
        if (this.matches(entry, unitRoot, slug))
          return { key: "file\0" + rule.name, name: rule.name };
    return null;
  };
}
