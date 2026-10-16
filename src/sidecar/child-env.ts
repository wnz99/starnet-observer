/* sidecar/child-env.js — the ONE place a helper process's environment is built.

   Security audit September 25, 2026 (#13): every process the sidecar spawned without an explicit `env` inherited the
   sidecar's whole process.env — the per-launch API/IPC tokens, the desktop-injected provider keys and key pools,
   channel bot tokens, the credits token, the connector vault key, and the KEYS-tab service keys the sidecar itself
   exports. That reached git (whose hooks and fsmonitor run in USER repos during a project scan), shell hooks,
   PowerShell helpers, Chrome, project-loop checks and PTY terminals.

   THE RULE — strip what the STATION put there, keep what the USER put there:
     1. Every STARNET_* / SKYNET_* variable. That is StarNet's own namespace: the desktop shell injects every
        secret it hands the sidecar under these names (src-tauri main.rs sidecar_command: SKYNET_API_TOKEN,
        SKYNET_IPC_TOKEN, SKYNET_<PROVIDER>_API_KEY, SKYNET_KEY_POOL_*, SKYNET_TELEGRAM/DISCORD_TOKEN,
        SKYNET_TELEGRAM_BOT_TOKENS, STARNET_CREDITS_TOKEN, STARNET_CONNECTOR_ENCRYPTION_KEY, …, each in both
        spellings), and the sidecar reads its own secrets only through them (ENV()).
     2. Every name the sidecar itself exported into process.env (the KEYS-tab service keys — servicekeys.applyEnv
        tracks exactly which names it owns). A helper never needs them; the agent shell gets them back explicitly
        through environment.mergeServiceEnv, which is the one surface intended to receive them.
     3. Any variable whose VALUE is a secret the station currently holds (the same live collector that feeds
        redact()'s known-value layer): a station credential re-exported under an innocent name is still stripped.
   A variable the user exported in their own shell (NPM_TOKEN, GITHUB_TOKEN, a bare OPENAI_API_KEY) is THEIRS and
   is retained by host helpers — unless its value is one the station holds (rule 3). Agent-driven commands
   (shell.exec, background jobs, terminals, code.run) are stricter still: environment.sanitizeChildEnv runs this
   builder and then strips every secret-SHAPED name as well. MCP stdio servers and LSP servers keep their own
   allowlist builders (a handful of runtime vars + the connector's explicit config env), which is stricter again.

   stationChildEnv(base?, extra?) -> env       base defaults to process.env; extra (explicit config) is layered last
   setStationSecretSource accepts optional names and values collectors, read live on every call
   guardChildProcess(cp) -> cp-like            spawn/execFile/exec/execSync/execFileSync/spawnSync/fork default
                                                a missing `env` option to stationChildEnv(process.env); an explicit
                                                `env` is the caller's decision and is passed through untouched. */
import { note as failNote } from "./failopen.js";
import { isIterable } from "./iterable.js";
type SecretSource = { names?: (() => unknown) | null; values?: (() => unknown) | null };
type Environment = Readonly<
  Record<string, string | number | boolean | bigint | symbol | null | undefined>
>;

const STATION_NAME_RE = /^(?:STARNET|SKYNET)_/i;
// Never stripped by the value rule: a process without these cannot even start, and a connector env value that
// happened to equal a path must not take PATH down with it.
const RUNTIME_ENVIRONMENT_NAMES = [
  "PATH",
  "PATHEXT",
  "SYSTEMROOT",
  "WINDIR",
  "COMSPEC",
  "HOME",
  "USERPROFILE",
  "TEMP",
  "TMP",
  "TMPDIR",
  "APPDATA",
  "LOCALAPPDATA",
  "SHELL",
  "LANG",
  "LC_ALL",
  "USER",
  "USERNAME",
  "LOGNAME",
  "PWD",
];
const NEVER_STRIP = new Set(RUNTIME_ENVIRONMENT_NAMES);
const VALUE_MIN = 8; // same floor as context.js KNOWN_MIN: shorter strings collide with ordinary values

let source: SecretSource = { names: null, values: null };
export function setStationSecretSource(s?: SecretSource | null) {
  const provided = s || {};
  source = {
    names: typeof provided.names === "function" ? provided.names : null,
    values: typeof provided.values === "function" ? provided.values : null,
  };
}
function readSet(
  fn: (() => unknown) | null | undefined,
  normalize: (value: string) => string | null,
) {
  const out = new Set<string>();
  if (!fn) return out;
  let raw;
  try {
    raw = fn();
  } catch (e) {
    failNote("child-env.source", e);
    return out;
  }
  if (!isIterable(raw)) return out;
  for (const v of raw) {
    if (typeof v !== "string") continue;
    const t = v.trim();
    if (!t) continue;
    const normalized = normalize(t);
    if (normalized !== null) out.add(normalized);
  }
  return out;
}

function explicitEnvironment(extra: Environment | null | undefined) {
  const out: NodeJS.ProcessEnv = {};
  if (!extra || typeof extra !== "object") return out;
  for (const [key, value] of Object.entries(extra)) {
    if (["__proto__", "constructor", "prototype"].includes(key)) continue;
    if (value !== null && value !== undefined) out[key] = String(value);
  }
  return out;
}
export function stationChildEnv(
  base?: Environment | null,
  extra?: Environment | null,
): NodeJS.ProcessEnv {
  const src = base || process.env;
  const ownedNames = readSet(source.names, (value) => value.toUpperCase());
  const heldValues = readSet(source.values, (value) => (value.length >= VALUE_MIN ? value : null));
  const out: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(src)) {
    if (value === null || value === undefined) continue;
    const upper = key.toUpperCase();
    if (STATION_NAME_RE.test(key) || ownedNames.has(upper)) continue;
    const text = String(value);
    if (!NEVER_STRIP.has(upper) && heldValues.has(text.trim())) continue;
    out[key] = text;
  }
  return Object.assign(out, explicitEnvironment(extra));
}

function isOptionsObject(x: unknown): x is Record<string, unknown> {
  return !!x && typeof x === "object" && !Array.isArray(x);
}
/* Fill a missing `env` in a child_process argument list (any of the spawn/exec/execFile call shapes). */
export function withStationEnv(args: ArrayLike<unknown>): unknown[] {
  const a = Array.from(args);
  for (let i = 1; i < a.length; i++) {
    if (isOptionsObject(a[i])) {
      if (Object.prototype.hasOwnProperty.call(a[i], "env") && Reflect.get(Object(a[i]), "env"))
        return a;
      a[i] = Object.assign({}, a[i], { env: stationChildEnv(process.env) });
      return a;
    }
  }
  const opts = { env: stationChildEnv(process.env) };
  let at = a.length;
  for (let i = 1; i < a.length; i++)
    if (typeof a[i] === "function") {
      at = i;
      break;
    }
  // execFile(file, undefined|null, opts?) — collapse an explicit empty slot rather than shifting the callback
  if (at > 1 && (a[at - 1] === null || a[at - 1] === undefined)) {
    a[at - 1] = opts;
    return a;
  }
  a.splice(at, 0, opts);
  return a;
}
const GUARDED = ["spawn", "spawnSync", "execFile", "execFileSync", "exec", "execSync", "fork"];
export function guardChildProcess<T extends object>(cp: T): T {
  // Native construction retains the provided prototype and its overloaded method signatures.
  const out = Object.create(cp) as T;
  for (const name of GUARDED) {
    const original: unknown = Reflect.get(cp, name);
    if (typeof original !== "function") continue;
    Reflect.set(out, name, (...args: unknown[]): unknown => {
      const result: unknown = Reflect.apply(original, cp, withStationEnv(args));
      return result;
    });
  }
  return out;
}
