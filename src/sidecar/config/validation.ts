import type { ConfigInput } from "../../shared/observer.js";

const MAX_LABEL = 80;
const MAX_ROOMS = 64;
const MAX_REPOS = 128;
const MAX_REMOTES = 16;
const MAX_REMOTE_PATH = 200;
const MAX_ROOMS_PATH = 1024;
const CONTROL_LIMIT = 32;
const DELETE_CHARACTER = 127;
function hasControl(value: string) {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code < CONTROL_LIMIT || code === DELETE_CHARACTER;
  });
}
function object(value: unknown, field: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(field + " must be an object");
}
function keys(value: Record<string, unknown>, allowed: string[], field: string) {
  for (const key of Object.keys(value))
    if (!allowed.includes(key)) throw new Error("Unknown " + field + " field: " + key);
}
function label(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim() || value.length > MAX_LABEL || hasControl(value))
    throw new Error(
      field + " must be nonempty text, at most 80 characters, without control characters",
    );
  return value.trim();
}
function rooms(value: unknown) {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_ROOMS)
    throw new Error("rooms must contain 1–64 room objects");
  const names = new Set<string>();
  const repos = new Set<string>();
  return value.map((room: unknown, index) => {
    const field = `rooms[${String(index)}]`;
    object(room, field);
    keys(room, ["name", "repos"], field);
    const name = label(room.name, field + ".name");
    if (names.has(name.toLowerCase())) throw new Error("Room names must be unique");
    names.add(name.toLowerCase());
    if (room.repos !== undefined && (!Array.isArray(room.repos) || room.repos.length > MAX_REPOS))
      throw new Error(field + ".repos must be an array of at most 128 names");
    const roomRepos: unknown[] = Array.isArray(room.repos) ? room.repos : [];
    const aliases = roomRepos.map((repo: unknown) => label(repo, field + ".repos"));
    for (const alias of aliases) {
      if (repos.has(alias.toLowerCase())) throw new Error("Repository names must be unique");
      repos.add(alias.toLowerCase());
    }
    return { name, repos: aliases };
  });
}
function remote(value: unknown, index: number) {
  const field = `remotes[${String(index)}]`;
  object(value, field);
  keys(value, ["id", "ssh", "dir"], field);
  if (
    typeof value.id !== "string" ||
    !/^[a-z0-9][a-z0-9-]{0,31}$/.test(value.id) ||
    value.id === "local"
  )
    throw new Error(
      field + '.id must be 1–32 lowercase letters, digits, or hyphens, and not "local"',
    );
  // Each remote is passed as one argv entry after --; refuse option-shaped hosts.
  if (
    typeof value.ssh !== "string" ||
    value.ssh.startsWith("-") ||
    !/^[A-Za-z0-9._-]+(@[A-Za-z0-9.-]+)?$/.test(value.ssh)
  )
    throw new Error(field + ".ssh must be host, alias or user@host");
  return { id: value.id, ssh: value.ssh, dir: remoteDirectory(value.dir, field) };
}
function remoteDirectory(input: unknown, field: string) {
  const dir = input === undefined ? "~/starnet-observer" : input;
  if (
    typeof dir !== "string" ||
    !/^~?[A-Za-z0-9._/-]+$/.test(dir) ||
    dir.length > MAX_REMOTE_PATH ||
    dir.split("/").includes("..")
  )
    throw new Error(field + ".dir must be a plain path");
  return dir;
}
function remotes(value: unknown) {
  if (!Array.isArray(value) || value.length > MAX_REMOTES)
    throw new Error("remotes must be an array of at most 16 remote objects");
  const ids = new Set<string>();
  return value.map((entry: unknown, index) => {
    const checked = remote(entry, index);
    if (ids.has(checked.id)) throw new Error("Remote ids must be unique");
    ids.add(checked.id);
    return checked;
  });
}
function colors(value: unknown) {
  object(value, "theme.colors");
  keys(value, ["accent", "background", "panel", "text"], "theme.colors");
  const result: NonNullable<NonNullable<ConfigInput["theme"]>["colors"]> = {};
  for (const [name, color] of Object.entries(value)) {
    if (typeof color !== "string" || !/^#[a-f0-9]{6}$/i.test(color))
      throw new Error("theme.colors." + name + " must be a six-digit hex color");
    Object.assign(result, { [name]: color });
  }
  return result;
}
function theme(value: unknown) {
  object(value, "theme");
  keys(value, ["pack", "fx", "arrange", "colors"], "theme");
  const result: NonNullable<ConfigInput["theme"]> = {};
  if (Object.hasOwn(value, "pack")) {
    if (typeof value.pack !== "string" || !/^[a-z0-9][a-z0-9-]{0,31}$/.test(value.pack))
      throw new Error("theme.pack must be a lowercase pack ID of 1–32 characters");
    result.pack = value.pack;
  }
  if (Object.hasOwn(value, "fx")) {
    if (typeof value.fx !== "boolean") throw new Error("theme.fx must be a boolean");
    result.fx = value.fx;
  }
  if (Object.hasOwn(value, "arrange")) {
    if (typeof value.arrange !== "boolean") throw new Error("theme.arrange must be a boolean");
    result.arrange = value.arrange;
  }
  if (Object.hasOwn(value, "colors")) result.colors = colors(value.colors);
  return result;
}
function simpleFields(input: Record<string, unknown>): ConfigInput {
  const result: ConfigInput = {};
  if (Object.hasOwn(input, "presentation")) {
    if (typeof input.presentation !== "boolean") throw new Error("presentation must be a boolean");
    result.presentation = input.presentation;
  }
  if (Object.hasOwn(input, "company")) result.company = label(input.company, "company");
  if (Object.hasOwn(input, "repoPrefix")) {
    if (typeof input.repoPrefix !== "string" || !/^[a-z0-9][a-z0-9-]{0,31}$/.test(input.repoPrefix))
      throw new Error(
        "repoPrefix must be 1–32 lowercase letters, digits, or hyphens, starting with a letter or digit",
      );
    result.repoPrefix = input.repoPrefix;
  }
  return result;
}
export function validateConfig(input: unknown): ConfigInput {
  object(input, "Config");
  keys(
    input,
    ["presentation", "company", "repoPrefix", "rooms", "theme", "roomsFile", "remotes"],
    "config",
  );
  const result = simpleFields(input);
  if (Object.hasOwn(input, "rooms")) result.rooms = rooms(input.rooms);
  if (Object.hasOwn(input, "remotes")) result.remotes = remotes(input.remotes);
  if (Object.hasOwn(input, "roomsFile")) {
    if (
      typeof input.roomsFile !== "string" ||
      !input.roomsFile.trim() ||
      input.roomsFile.length > MAX_ROOMS_PATH ||
      hasControl(input.roomsFile)
    )
      throw new Error("roomsFile must be a nonempty path without control characters");
    result.roomsFile = input.roomsFile;
  }
  if (Object.hasOwn(input, "theme")) result.theme = theme(input.theme);
  return result;
}
