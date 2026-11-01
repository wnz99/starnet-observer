import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { observation, validSession } from "./contracts.js";
import { encodeEvent, prune, sessionDirectory, verifyDirectories } from "./store.js";
const FILE_MODE = 0o600;
async function verifyWrite(file: string, handle: fs.FileHandle) {
  const descriptor = await handle.stat(),
    current = await fs.lstat(file);
  if (
    descriptor.ino !== current.ino ||
    descriptor.dev !== current.dev ||
    current.isSymbolicLink() ||
    descriptor.size !== current.size
  )
    throw new Error("Observation write path changed");
}

export async function recordShellEntry(options: {
  root: string;
  sessionId: string | undefined;
  cwd: string;
  now: () => number;
}): Promise<boolean> {
  if (!validSession(options.sessionId)) return false;
  try {
    const now = options.now();
    const candidate = {
      version: 1,
      provider: "codex",
      sessionId: options.sessionId,
      source: "shell-entry",
      cwd: options.cwd,
      observedAt: now,
    };
    if (!observation(candidate, options.sessionId, now)) return false;
    const event = observation(
      { ...candidate, cwd: await fs.realpath(options.cwd) },
      options.sessionId,
      now,
    );
    if (!event) return false;
    const data = encodeEvent(event);
    const components = await sessionDirectory(options.root, options.sessionId, { create: true });
    await prune(components, options.sessionId, now);
    const directory = components.at(-1)?.file;
    if (!directory) return false;
    await verifyDirectories(components);
    const file = path.join(directory, `${String(now)}-${randomUUID()}.json`);
    const handle = await fs.open(file, "wx", FILE_MODE);
    try {
      await verifyDirectories(components);
      await handle.writeFile(data);
      await verifyDirectories(components);
      await verifyWrite(file, handle);
    } finally {
      await handle.close();
    }
    await prune(components, options.sessionId, now);
    return true;
  } catch {
    return false;
  }
}
