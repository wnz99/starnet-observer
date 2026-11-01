import fs from "node:fs/promises";
import type { Stats } from "node:fs";
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
async function writeEvent(
  components: Awaited<ReturnType<typeof sessionDirectory>>,
  file: string,
  data: string,
) {
  const root = components[0]?.file;
  if (!root) throw new Error("Missing observation root");
  // Stage outside the enumerable event directory. link publishes the completed
  // inode atomically without replacing an existing event.
  const pending = path.join(root, `.pending-${randomUUID()}`);
  const handle = await fs.open(pending, "wx", FILE_MODE);
  let created: Stats | undefined;
  try {
    created = await handle.stat();
    await verifyDirectories(components);
    await handle.writeFile(data);
    await verifyDirectories(components);
    await verifyWrite(pending, handle);
    await fs.link(pending, file);
    await verifyDirectories(components);
    await verifyWrite(file, handle);
  } finally {
    try {
      await verifyDirectories(components);
      const current = await fs.lstat(pending);
      if (created && current.ino === created.ino && current.dev === created.dev && current.isFile())
        await fs.unlink(pending);
    } finally {
      await handle.close();
    }
  }
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
    await writeEvent(components, file, data);
    await prune(components, options.sessionId, now);
    return true;
  } catch {
    return false;
  }
}
