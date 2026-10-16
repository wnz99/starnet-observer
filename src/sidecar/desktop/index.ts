import os from "node:os";
import path from "node:path";
import { makeNativeReader } from "./cache.js";
import type { Execute } from "./cache.js";
import { makeInventory } from "./inventory.js";
import { makeInspection } from "./inspection.js";

/* This adapter never persists loaded text. Its only native commands are inventory and inspect.
   Compilation starts lazily and never holds the shared roster response behind a cold build. */
export function makeDesktopObserver({
  execute = () => {
    throw new Error("Native execution unavailable");
  },
  now,
  platform = process.platform,
  cacheDir = path.join(os.homedir(), "Library", "Caches", "starnet-observer-native"),
}: {
  execute?: Execute;
  now?: () => number;
  platform?: string;
  cacheDir?: string;
} = {}) {
  if (typeof now !== "function")
    throw new TypeError("Desktop observer requires an injected now clock");
  const reader = makeNativeReader(cacheDir, platform, execute);
  const { inventory, getWindow } = makeInventory(reader, now);
  return { inventory, inspect: makeInspection(reader, getWindow, now) };
}
