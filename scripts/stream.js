#!/usr/bin/env -S bun --no-env-file
/* Remote side of a multi-host observer: no HTTP server and no control surface. Writes one NDJSON line, the same
   snapshot /api/observer/sessions returns, every interval to stdout, and exits when stdin closes (the hub's ssh went
   away) or on SIGTERM/SIGHUP/SIGPIPE. Run by the hub as `ssh <host> 'cd <dir> && bun --no-env-file scripts/stream.js'`. */
'use strict';
const { makeObserver } = require('../sidecar/observer.js');
const { setKnownSecretSource } = require('../sidecar/redaction.js');
const { setClock } = require('../sidecar/failopen.js');

const INTERVAL = 2000, MAX_LINE = 4 * 1024 * 1024;
const nativeProof = pane => ({ pane_id: pane.pane_id, workspace_id: pane.workspace_id, terminal_id: pane.terminal_id, agent: pane.agent,
  agent_session: pane.agent_session ? { agent: pane.agent_session.agent ?? null, kind: pane.agent_session.kind ?? null, value: pane.agent_session.value ?? null } : null,
  cwd: pane.cwd ?? null, foreground_cwd: pane.foreground_cwd ?? null });

function startStream({ observer, write, interval = INTERVAL, setTimer = setTimeout, clearTimer = clearTimeout, onError = () => {} }) {
  let timer = null, stopped = false;
  async function tick() {
    timer = null;
    if (stopped) return;
    try {
      const snapshot = await observer.get();
      // Control proof for the hub: each live pane's native Herdr identity, the same fields the local control checks
      // (no titles or other display text). The hub re-verifies them over ssh before any action.
      const targets = [];
      for (const row of snapshot.sessions || []) {
        if (row.source !== 'herdr' || typeof row.paneId !== 'string') continue;
        const proof = observer.controlTarget?.(row.paneId);
        if (proof) targets.push(nativeProof(proof));
      }
      const line = JSON.stringify(targets.length ? { ...snapshot, targets } : snapshot);
      // An oversized line would be dropped by the hub anyway; send a bounded, truthful unavailable snapshot instead.
      if (stopped) return;
      // write() resolves once the line has been handed to the pipe, so a line is never held back behind the next one.
      await write(line.length <= MAX_LINE ? line + '\n' : JSON.stringify({ sessions: [], health: 'unavailable', error: 'Snapshot too large' }) + '\n');
    } catch (error) { onError(error); }
    if (!stopped) timer = setTimer(tick, interval);
  }
  tick();
  return { stop() { stopped = true; if (timer) clearTimer(timer); timer = null; } };
}

if (require.main === module) {
  const heldSecrets = () => Object.entries(process.env).filter(([name]) => /TOKEN|SECRET|PASSWORD|API_KEY/i.test(name)).map(([, value]) => value);
  setKnownSecretSource(heldSecrets);
  setClock(Date.now);
  // Remote inspect is not offered, so no transcript detail is prepared here.
  const observer = makeObserver({ now: Date.now, warmDetails: false });
  let stream = null, exiting = false;
  const exit = () => {
    if (exiting) return; exiting = true; stream?.stop();
    const timer = setTimeout(() => process.exit(0), 3000); timer.unref?.();
    Promise.resolve(observer.close?.()).catch(() => {}).finally(() => process.exit(0));
  };
  stream = startStream({ observer, write: line => new Promise(resolve => process.stdout.write(line, () => resolve())) });
  process.stdout.on('error', exit);   // EPIPE: the hub is gone
  process.stdin.on('end', exit); process.stdin.on('close', exit); process.stdin.resume();
  for (const signal of ['SIGTERM', 'SIGHUP', 'SIGPIPE', 'SIGINT']) process.once(signal, exit);
}
module.exports = { startStream, nativeProof, INTERVAL, MAX_LINE };
