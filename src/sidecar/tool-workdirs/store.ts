import { constants, type Stats } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { observation, validSession, type ShellEntryObservation } from "./contracts.js";

const MAX_ENTRIES = 128;
const MAX_BYTES = 4096;
const KEEP_EVENTS = 64;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const EVENT_NAME = /^\d+-[0-9a-f-]{36}\.json$/;
const PRIVATE_BITS = 0o077;
const DIRECTORY_MODE = 0o700;
const MISSING = "ENOENT";
export function encodeEvent(event: ShellEntryObservation) {
  const data = JSON.stringify(event);
  if (Buffer.byteLength(data) > MAX_BYTES) throw new Error("Observation overflow");
  return data;
}
interface Component {
  file: string;
  stat: Stats;
}
interface Event {
  file: string;
  stat: Stats;
  event: ShellEntryObservation;
}
const same = (a: Stats, b: Stats) =>
  a.dev === b.dev && a.ino === b.ino && a.mode === b.mode && a.uid === b.uid;
const sameFile = (a: Stats, b: Stats) =>
  same(a, b) && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
function privateResource(stat: Stats) {
  if (stat.uid !== process.getuid?.() || (stat.mode & PRIVATE_BITS) !== 0 || stat.isSymbolicLink())
    throw new Error("Unsafe observation resource");
}
export async function sessionDirectory(
  root: string,
  sessionId: string,
  options = { create: false },
) {
  if (!path.isAbsolute(root) || !validSession(sessionId))
    throw new Error("Invalid observation identity");
  const components: Component[] = [];
  let current = path.resolve(root);
  for (const part of [null, "v1", "codex", sessionId]) {
    if (part !== null) current = path.join(current, part);
    if (options.create) await fs.mkdir(current, { mode: DIRECTORY_MODE, recursive: true });
    const stat = await fs.lstat(current);
    privateResource(stat);
    if (!stat.isDirectory()) throw new Error("Observation directory unavailable");
    components.push({ file: current, stat });
  }
  return components;
}
export async function verifyDirectories(components: Component[]) {
  for (const component of components) {
    const stat = await fs.lstat(component.file);
    privateResource(stat);
    if (!same(component.stat, stat)) throw new Error("Observation path changed");
  }
}
async function eventNames(directory: string) {
  const entries: string[] = [];
  const handle = await fs.opendir(directory);
  try {
    for (;;) {
      const entry = await handle.read();
      if (!entry) return entries;
      entries.push(entry.name);
      if (entries.length > MAX_ENTRIES) throw new Error("Observation directory overflow");
    }
  } finally {
    await handle.close();
  }
}
async function readEvent(
  components: Component[],
  file: string,
  sessionId: string,
  now: number,
): Promise<Event> {
  const stat = await fs.lstat(file);
  privateResource(stat);
  if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error("Invalid observation file");
  const handle = await fs.open(
    file,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    if (!sameFile(stat, await handle.stat())) throw new Error("Observation changed");
    await verifyDirectories(components);
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > MAX_BYTES) throw new Error("Observation overflow");
    const event = observation(
      JSON.parse(buffer.subarray(0, bytesRead).toString()) as unknown,
      sessionId,
      now,
    );
    if (!event || !sameFile(stat, await handle.stat()) || !sameFile(stat, await fs.lstat(file)))
      throw new Error("Invalid observation");
    await verifyDirectories(components);
    return { file, stat, event };
  } finally {
    await handle.close();
  }
}
function missing(error: unknown) {
  return error instanceof Error && "code" in error && error.code === MISSING;
}
async function events(components: Component[], sessionId: string, now: number) {
  const directory = components.at(-1)?.file;
  if (!directory) throw new Error("Missing observation directory");
  const result: Event[] = [];
  for (const name of await eventNames(directory)) {
    if (!EVENT_NAME.test(name)) throw new Error("Unexpected observation entry");
    try {
      result.push(await readEvent(components, path.join(directory, name), sessionId, now));
    } catch (error) {
      if (!missing(error)) throw error;
    }
  }
  await verifyDirectories(components);
  return result.sort(
    (a, b) => b.event.observedAt - a.event.observedAt || b.file.localeCompare(a.file),
  );
}
export async function prune(components: Component[], sessionId: string, now: number) {
  const captured = await events(components, sessionId, now);
  const expired = captured.filter((entry) => now - entry.event.observedAt > MAX_AGE_MS);
  const overflow = captured
    .filter((entry) => now - entry.event.observedAt <= MAX_AGE_MS)
    .slice(KEEP_EVENTS)
    .reverse();
  for (const entry of [...expired, ...overflow]) {
    try {
      await verifyDirectories(components);
      if (sameFile(entry.stat, await fs.lstat(entry.file))) await fs.unlink(entry.file);
    } catch (error) {
      if (!missing(error)) throw error;
    }
  }
}
export async function readShellEntry(options: {
  root: string;
  sessionId: string;
  now: () => number;
}): Promise<ShellEntryObservation | null> {
  try {
    const components = await sessionDirectory(options.root, options.sessionId);
    const now = options.now();
    const latest = (await events(components, options.sessionId, now))[0]?.event;
    return latest && now - latest.observedAt <= MAX_AGE_MS ? latest : null;
  } catch {
    return null;
  }
}
