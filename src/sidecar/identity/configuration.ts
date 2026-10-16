const MISSING_FILE = "ENOENT";
const CONFIG_BUFFER = 1024;
import fs from "node:fs/promises";
import type { Stats } from "node:fs";
import path from "node:path";
import os from "node:os";
import { note as failNote } from "../failopen.js";
import { executeFile } from "./execute.js";
import { TIMEOUT, code } from "./types.js";
import type { Execute, FooterMode } from "./types.js";
function isMode(value: string): value is FooterMode {
  return ["configured", "unconfigured", "unavailable"].includes(value);
}
function missingConfiguration(error: unknown, cached: unknown, key: string | null) {
  return code(error) === MISSING_FILE && !cached && !key;
}
// Parse actual TOML meaning with an optional stdlib reader, never a regexp over host settings.
// A changed file invalidates the cache; unsupported Python/tomllib fails closed.
export function makeFooterConfigurationReader(
  options: { file?: string; execute?: Execute | undefined } = {},
) {
  const file =
    options.file ||
    path.join(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), "config.toml");
  const execute = options.execute || executeFile;
  let cached: { key: string; mode: FooterMode } | null = null,
    pending: Promise<FooterMode> | null = null;
  const stamp = (stat: Stats) =>
    [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs].join(":");
  async function read(): Promise<FooterMode> {
    let key = null;
    try {
      const before = await fs.stat(file);
      if (!before.isFile() || before.size > 128 * 1024) return "unavailable";
      key = stamp(before);
      if (cached?.key === key) return cached.mode;
      const script =
        'import sys,tomllib\nwith open(sys.argv[1],"rb") as f: b=f.read(131073)\nif len(b)>131072: raise ValueError("Configuration too large")\nc=tomllib.loads(b.decode("utf-8"))\nt=c.get("tui",{})\ns=t.get("status_line",[]) if isinstance(t,dict) else None\nprint("unavailable" if not isinstance(s,list) or not all(isinstance(i,str) for i in s) else "configured" if len(s)>0 and s[0]=="thread-id" else "unconfigured")';
      const result = await execute("python3", ["-c", script, file], {
        timeout: TIMEOUT,
        maxBuffer: CONFIG_BUFFER,
      });
      const mode = result.stdout.trim();
      if (!isMode(mode) || stamp(await fs.stat(file)) !== key) return "unavailable";
      cached = { key, mode };
      return mode;
    } catch (error) {
      if (missingConfiguration(error, cached, key)) return "unconfigured";
      if (key) cached = { key, mode: "unavailable" };
      failNote(
        "observer.identity.config",
        new Error("Footer configuration verification unavailable"),
      );
      return "unavailable";
    }
  }
  return () => {
    if (!pending)
      pending = read().finally(() => {
        pending = null;
      });
    return pending;
  };
}
