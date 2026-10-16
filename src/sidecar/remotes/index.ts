/* src/sidecar/remotes/index.ts — remote observers federated over SSH.

   Each configured remote runs its own read-only observer; the hub keeps one long-lived `ssh … bun --no-env-file dist/runtime/scripts/stream.js`
   per remote and reads one NDJSON snapshot per line. No port, token or HTTP surface exists on the remote: the trust
   boundary is the operator's SSH key. A remote is still another machine, so every row it sends is treated as
   untrusted input: only known fields survive, text is bounded and stripped of control characters, enums are checked,
   and ids are re-derived under the host so a remote can never collide with (or impersonate) a local row. */
export { makeRemoteHosts } from "./hosts.js";
export { makeFederatedObserver } from "./federation.js";
export { sanitizeRow } from "./rows.js";
export { sanitizeSnapshot } from "./snapshot.js";
export { sanitizeBus } from "./bus.js";
export { sanitizeTargets } from "./targets.js";
export { MAX_LINE, BACKOFF } from "./fields.js";
export { sshArgs, remoteCommand, reasonFrom } from "./command.js";
