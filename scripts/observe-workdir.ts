import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { recordShellEntry } from "../src/sidecar/tool-workdirs/recorder.js";

const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
const ARGUMENT_OFFSET = 2;
function preview() {
  const entry = fileURLToPath(import.meta.url);
  const emitted = entry.endsWith(".ts")
    ? path.resolve(import.meta.dirname, "../dist/runtime/scripts/observe-workdir.js")
    : entry;
  const bun = quote(process.execPath),
    script = quote(emitted);
  console.log(`# Proposed addition to your effective ZDOTDIR/.zshenv (default ~/.zshenv). Preview only; nothing installed.
# Samples Codex zsh shell entry only. -f, startup snapshots and ZDOTDIR overrides can bypass this.
if [[ -n "\${CODEX_THREAD_ID:-}" && -x ${bun} && -f ${script} ]]; then
  ${bun} --no-env-file ${script} >/dev/null 2>&1 || :
fi`);
}
if (import.meta.main) {
  const args = process.argv.slice(ARGUMENT_OFFSET);
  if (args.length === 0)
    await recordShellEntry({
      root: path.join(os.homedir(), ".local/share/starnet-observer/tool-workdirs"),
      sessionId: process.env.CODEX_THREAD_ID,
      cwd: process.cwd(),
      now: Date.now,
    });
  else if (args.length === 1 && args[0] === "--preview-zsh") preview();
  else {
    console.error("Usage: observe-workdir [--preview-zsh]");
    process.exitCode = 1;
  }
}
