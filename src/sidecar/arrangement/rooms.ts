const LABEL_LIMIT = 80;
const MAX_PATTERNS = 32;
const ORG_PART = 2;
const NAME_PART = 3;
import type { Remote, Rule } from "./types.js";
import { object, hasControl } from "./common.js";
// host/org/name from an origin URL (https, scp-like or ssh://); anything else (local paths) is not a remote.
export function parseRemote(url: unknown): Remote | null {
  const value = (typeof url === "string" ? url : "").trim();
  if (!value || value.length > 2048 || /^(?:file:|\/|\.)/i.test(value)) return null;
  const match =
    /^(?:[a-z][a-z0-9+.-]*:\/\/)?(?:[^@/\s]+@)?([A-Za-z0-9.-]+)(?::\d+)?[:/]+([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(
      value,
    );
  if (!match) return null;
  return {
    host: (match[1] ?? "").toLowerCase(),
    org: (match[ORG_PART] ?? "").toLowerCase(),
    name: (match[NAME_PART] ?? "").toLowerCase(),
  };
}

function label(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim() || value.length > LABEL_LIMIT || hasControl(value))
    throw new Error(
      field + " must be nonempty text, at most 80 characters, without control characters",
    );
  return value.trim();
}
const PATH_PATTERN = /^(?:~\/|\/)[\s\S]{0,199}$/,
  REMOTE_PATTERN = /^[A-Za-z0-9.*_-]+(?:\/[A-Za-z0-9.*_-]+){1,2}$/;
export function validateRooms(input: unknown): Rule[] {
  if (!object(input)) throw new Error("Rooms file must be an object");
  for (const key of Object.keys(input))
    if (key !== "rooms") throw new Error("Unknown rooms file field: " + key);
  if (!Array.isArray(input.rooms) || input.rooms.length > 64)
    throw new Error("rooms must be an array of at most 64 rooms");
  const names = new Set<string>();
  const candidates: unknown[] = input.rooms;
  return candidates.map((room, index) => {
    const field = `rooms[${String(index)}]`;
    if (!object(room)) throw new Error(field + " must be an object");
    for (const key of Object.keys(room))
      if (!["name", "match"].includes(key)) throw new Error("Unknown " + field + " field: " + key);
    const name = label(room.name, field + ".name");
    if (names.has(name.toLowerCase())) throw new Error("Room names must be unique");
    names.add(name.toLowerCase());
    if (!Array.isArray(room.match) || room.match.length === 0 || room.match.length > MAX_PATTERNS)
      throw new Error(field + ".match must hold 1–32 patterns");
    const patterns: unknown[] = room.match;
    const match = patterns.map((pattern): Rule["match"][number] => {
      if (typeof pattern !== "string" || pattern.includes(".."))
        throw new Error(
          field +
            ".match entries must be path globs (~/… or /…) or remote patterns (host/org[/name])",
        );
      if (PATH_PATTERN.test(pattern) && !hasControl(pattern)) return { kind: "path", pattern };
      if (REMOTE_PATTERN.test(pattern)) return { kind: "remote", pattern: pattern.toLowerCase() };
      throw new Error(
        field +
          ".match entries must be path globs (~/… or /…) or remote patterns (host/org[/name])",
      );
    });
    return { name, match };
  });
}
// '*' stays inside one path segment; '**' crosses segments.
export function globRegExp(pattern: string) {
  const body = pattern
    .split("**")
    .map((part) =>
      part
        .split("*")
        .map((text) => text.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
        .join("[^/]*"),
    )
    .join(".*");
  return new RegExp("^" + body + "$");
}
