#!/usr/bin/env -S bun --no-env-file
import { makeObserver } from "../sidecar/observer/index.js";
import { makePresentationObserver } from "../sidecar/presentation/index.js";
import { redact, setKnownSecretSource } from "../sidecar/redaction.js";
import { setClock } from "../sidecar/failopen.js";
import { loadConfig, HELP } from "../sidecar/config/index.js";
import { makeOverseerState, resolveEndpoint } from "../sidecar/overseer-state/index.js";
import { makeControl } from "../sidecar/control/index.js";
import { makeRemoteHosts, makeFederatedObserver } from "../sidecar/remotes/index.js";
import { resolveRuntimePaths } from "./runtime-paths.js";
import { createServer } from "./http.js";
import { errorField, errorMessage } from "./security.js";
import type { ObserverConfig } from "../shared/observer.js";
const CLI_OFFSET = 2;
const MAX_PORT = 65535;
const { installRoot } = resolveRuntimePaths();
export function main() {
  const config = launchConfig();
  const port = launchPort();
  const { observer, remoteHosts, control } = compose(config);
  let server: ReturnType<typeof createServer>;
  try {
    server = createServer({
      observer: config.presentation
        ? makePresentationObserver(observer, Date.now, config.labels)
        : observer,
      theme: config.theme,
      control,
    });
  } catch (error) {
    console.error(
      "[observer theme]",
      errorField(error, "themeReason") || redact(errorMessage(error)),
    );
    remoteHosts?.close();
    process.exit(1);
  }
  server.on("error", (error) => {
    console.error("[observer]", redact(errorMessage(error)));
    process.exitCode = 1;
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(launchMessage(config, port, Boolean(control)));
  });
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, () => {
      remoteHosts?.close();
      server.close();
      server.closeAllConnections();
    });
}
if (import.meta.main) main();

function launchMessage(config: ObserverConfig, port: number, control: boolean) {
  return (
    "Local Observer: http://127.0.0.1:" +
    String(port) +
    "\nPrivate labels: " +
    (config.presentation ? "on (" + config.labels.company + ")" : "off") +
    (control
      ? "\nControl actions: on (OBSERVER_CONTROL=1): attach, spawn and close Herdr agents from the page."
      : "\nRead only.") +
    (config.remotes.length > 0
      ? "\nRemote hosts (over ssh): " +
        config.remotes.map((remote) => remote.id + " = " + remote.ssh).join(", ") +
        (control ? ". Control actions reach them too." : ". Read only.")
      : "") +
    " Stop with Ctrl+C."
  );
}

function compose(config: ObserverConfig) {
  const heldSecrets = () =>
    Object.entries(process.env)
      .filter(([name]) => /TOKEN|SECRET|PASSWORD|API_KEY/i.test(name))
      .map(([, value]) => value);
  setKnownSecretSource(heldSecrets);
  setClock(Date.now);
  const endpoint = resolveEndpoint({});
  const overseerState = makeOverseerState({ endpoint });
  const local = makeObserver({
    now: Date.now,
    warmDetails: !config.presentation,
    endpoint,
    overseerState,
    arrange: {
      roomsFile: config.roomsFile,
      warn: (message) => {
        console.warn("[observer arrange]", redact(message));
      },
    },
  });
  const remoteHosts =
    config.remotes.length > 0 ? makeRemoteHosts({ remotes: config.remotes, now: Date.now }) : null;
  const observer = remoteHosts ? makeFederatedObserver(local, remoteHosts, Date.now) : local;
  const control =
    process.env.OBSERVER_CONTROL === "1"
      ? makeControl({
          endpoint,
          overseerState,
          target: (paneId) => observer.controlTarget(paneId),
          remotes: config.remotes,
          claudeArgs: (process.env.OBSERVER_CLAUDE_ARGS || "").split(/\s+/).filter(Boolean),
        })
      : null;
  return { observer, remoteHosts, control };
}

function launchConfig() {
  let config;
  try {
    config = loadConfig(process.argv.slice(CLI_OFFSET), undefined, { installRoot });
  } catch (error) {
    console.error("[observer config]", redact(errorMessage(error)));
    process.exit(1);
  }
  if ("help" in config) {
    console.log(HELP);
    process.exit(0);
  }
  return config;
}
function launchPort() {
  const port = Number(process.env.PORT || 4319);
  if (!Number.isInteger(port) || port < 1 || port > MAX_PORT) {
    console.error("PORT must be an integer between 1 and 65535");
    process.exit(1);
  }
  return port;
}
