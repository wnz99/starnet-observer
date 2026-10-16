import { required } from "./required.js";
import { execFile } from "node:child_process";
import { guardChildProcess } from "../child-env.js";
import { makeDesktopObserver } from "../desktop/index.js";
import { makeProjectResolver } from "../projects/index.js";
import { makeTranscriptObserver } from "../transcripts/index.js";
import { makeHelperObserver } from "../helpers/index.js";
import { makeSqliteClient } from "../sqlite/client.js";
import { makeOverseerState, resolveEndpoint } from "../overseer-state/index.js";
import { makeIdentityResolver } from "../identity/index.js";
import { unavailable } from "../inspector/fields.js";
import { State } from "./state.js";
import { inspect } from "./inspection.js";
import type { ObserverOptions, Execute, Transcripts } from "./contracts.js";
export { aggregateRows, lastActivity } from "./aggregation.js";
const childProcess = guardChildProcess({ execFile });
const executeDefault: Execute = (command, args, settings) =>
  new Promise((resolve, reject) => {
    childProcess.execFile(command, args, settings, (error, stdout) => { error ? reject(error) : resolve({ stdout }); },
    );
  });
function defaultHelpers(
  transcripts: Transcripts,
  now: () => number,
  sqlite: ReturnType<typeof makeSqliteClient> | null,
) {
  return makeHelperObserver({
    transcripts: {
      ...transcripts,
      read: (...args) => required(transcripts.read)(...args),
      inspectChild: (...args) => required(transcripts.inspectChild)(...args),
    },
    now,
    readEdges: () => required(sqlite).readHelperEdges(),
  });
}
function dependencies(options: ObserverOptions, now: () => number) {
  const execute = options.execute || executeDefault;
  const projects =
    options.projects || makeProjectResolver({ execute, now, arrange: options.arrange || null });
  const transcripts = options.transcripts || makeTranscriptObserver({ now });
  const sqlite = !options.helpers || !options.bus ? makeSqliteClient({ now }) : null;
  const helpers = options.helpers || defaultHelpers(transcripts, now, sqlite);
  const bus = options.bus || {
    read: () => {
      if (!sqlite) throw new Error("Bus unavailable");
      return sqlite.readBus();
    },
    inspect: (id: number, identity?: string) => {
      if (!sqlite) throw new Error("Bus unavailable");
      return sqlite.inspectMessage(id, identity);
    },
  };
  const desktop = options.desktop || makeDesktopObserver({ execute, now });
  const endpoint = resolveEndpoint(options);
  const overseerState = options.overseerState || makeOverseerState({ endpoint });
  if (overseerState.endpoint !== undefined && overseerState.endpoint !== endpoint)
    throw new Error("overseer-unavailable");
  const identities =
    options.identities ||
    makeIdentityResolver({
      execute,
      now,
      endpoint,
      readConfiguration: options.readIdentityConfiguration,
      readProcessBirth: options.readProcessBirth,
    });
  return {
    options,
    now,
    execute,
    projects,
    transcripts,
    sqlite,
    helpers,
    bus,
    desktop,
    endpoint,
    overseerState,
    identities,
  };
}
export function makeObserver(options: ObserverOptions = {}) {
  const now = options.now;
  if (typeof now !== "function") throw new TypeError("Observer requires an injected now clock");
  const s = new State(dependencies(options, now));
  return {
    get: () => s.snapshot.get(),
    controlTarget: (paneId: string) => s.lifecycle.controlTarget(paneId),
    inspect: (id: string, expectedIdentity?: unknown) => inspect(s, id, expectedIdentity),
    inspectMessage: (id: number, expectedIdentity?: string) =>
      s.closed || !s.bus.inspect
        ? Promise.resolve({ ...unavailable(String(id), "unreadable", now()), id, text: null })
        : Promise.resolve(s.bus.inspect(id, expectedIdentity)),
    close: () => s.lifecycle.close(),
  };
}
