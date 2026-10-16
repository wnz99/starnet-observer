#!/usr/bin/env -S bun --no-env-file
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateInstalledPacks } from "../src/sidecar/themes/index.js";
import { errorField } from "../src/server/security.js";
const CLI_OFFSET = 2;
const MAX_ARGUMENTS = 3;
export function validateThemes(args = process.argv) {
  const root = args[CLI_OFFSET]
    ? path.resolve(args[CLI_OFFSET])
    : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../frontend");
  try {
    if (args.length > MAX_ARGUMENTS)
      throw new Error("Usage: bun --no-env-file scripts/validate-theme-packs.ts [frontend-root]");
    console.log("Validated theme packs: " + validateInstalledPacks(root).join(", "));
    return 0;
  } catch (error) {
    const reason: unknown = errorField(error, "themeReason") || "installation-unavailable";
    console.error("Theme validation failed: " + String(reason));
    return 1;
  }
}
if (import.meta.main) process.exitCode = validateThemes();
