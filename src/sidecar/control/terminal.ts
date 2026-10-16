import { CREATE_TIMEOUT } from "./constants.js";
import { stationChildEnv } from "../child-env.js";
import { badRequest } from "./constants.js";
import { validPane } from "./proof.js";
import type { Host } from "./types.js";
import type { Transport } from "./transport.js";
async function openTerminal(
  paneId: string,
  host: Host,
  context: { platform: string; endpoint: string; transport: Transport },
) {
  const {
    platform,
    endpoint,
    transport: { remoteOf, execute, run },
  } = context;
  if (platform !== "darwin") throw new Error("Opening a terminal is only implemented on macOS");
  const remote = remoteOf(host);
  if (remote) {
    // ssh target and pane id are validated ([A-Za-z0-9._@-] and [A-Za-z0-9:_-]): no quote or backslash can reach
    // the AppleScript literal or either shell. The single quotes keep $HOME/$PATH available to the remote shell.
    if (!validPane(paneId)) throw badRequest("invalid-pane");
    const script =
      'tell application "Terminal"\nlaunch\ndo script "ssh -t ' +
      remote.ssh +
      " 'PATH=$HOME/.local/bin:$PATH herdr agent attach " +
      paneId +
      " --takeover'\"\nactivate\nend tell";
    await execute("osascript", ["-e", script], {
      timeout: CREATE_TIMEOUT,
      env: stationChildEnv(process.env),
    });
    return;
  }
  // paneId is validated to [A-Za-z0-9:_-], so it is safe inside the AppleScript string literal.
  // `launch` starts Terminal without its default window when it was not running; `do script` then makes exactly one
  // window. `--takeover` replaces whatever client currently owns input (such as the wrapper's VS Code attach),
  // because the point of the button is to put this agent in front of the user now.
  const shellQuote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'";
  const attachCommand =
    "env HERDR_SOCKET_PATH=" +
    shellQuote(endpoint) +
    " herdr agent attach " +
    paneId +
    " --takeover";
  const script =
    'tell application "Terminal"\nlaunch\ndo script ' +
    JSON.stringify(attachCommand) +
    "\nactivate\nend tell";
  await run("osascript", ["-e", script], { timeout: CREATE_TIMEOUT });
}

export function makeTerminal(platform: string, endpoint: string, transport: Transport) {
  return (paneId: string, host: Host = null) =>
    openTerminal(paneId, host, { platform, endpoint, transport });
}
