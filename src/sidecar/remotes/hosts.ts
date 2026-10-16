import { timerScheduler } from "./timers.js";
import childProcess from "node:child_process";
import type { ObserverRow } from "../../shared/observer.js";
import { guardChildProcess } from "../child-env.js";
import { RemoteHost } from "./host.js";
import type { RemoteOptions, HostSources, HostBuses } from "./types.js";

export function makeRemoteHosts<Timer = ReturnType<typeof setTimeout>>(
  options: RemoteOptions<Timer> = {},
) {
  const { remotes = [], spawn = guardChildProcess(childProcess).spawn, now = Date.now } = options;
  const schedule = timerScheduler(options);
  let closed = false;
  const lifecycle = { schedule, closed: () => closed };
  const hosts = remotes.map((remote) => new RemoteHost(remote, spawn, now, lifecycle));
  for (const host of hosts) host.connect();
  return {
    snapshot: () => snapshot(hosts, now()),
    close: () => {
      closed = true;
      for (const host of hosts) host.close();
    },
    controlTarget: (hostId: string, paneId: string) =>
      hosts.find((host) => host.remote.id === hostId)?.controlTarget(paneId) ?? null,
    ids: () => hosts.map((host) => host.remote.id),
  };
}
function snapshot(hosts: RemoteHost[], at: number) {
  const rows: ObserverRow[] = [],
    sources: HostSources = {},
    buses: HostBuses = {};
  for (const host of hosts) {
    const snap = host.snapshot(at);
    rows.push(...snap.rows);
    sources[host.remote.id] = snap.source;
    if (snap.bus) buses[host.remote.id] = snap.bus;
  }
  return { rows, sources, buses };
}
