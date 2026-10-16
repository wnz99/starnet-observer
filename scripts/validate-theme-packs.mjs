#!/usr/bin/env -S bun --no-env-file
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateInstalledPacks } from "../src/sidecar/themes/index.ts";
const root = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../frontend");
try {
  if (process.argv.length > 3)
    throw new Error("Usage: bun --no-env-file scripts/validate-theme-packs.mjs [frontend-root]");
  console.log("Validated theme packs: " + validateInstalledPacks(root).join(", "));
} catch (error) {
  console.error("Theme validation failed: " + (error.themeReason || "installation-unavailable"));
  process.exitCode = 1;
}
