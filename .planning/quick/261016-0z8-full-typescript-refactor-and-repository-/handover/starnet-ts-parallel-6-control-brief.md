### Task 6: Migrate HTTP, controls, federation and launch commands

**Goal:** The application and remote stream run from compiled TypeScript, preserving API security and fixed SSH command behavior.

**Delivers:** F2, F3, F4.

**Execution:** After reviewed Tasks 4–5, 6-R and 6-C run parallel-safe in P2 worktrees. 6-H waits for both reviewed integrations in I6. Controller owns shared control contracts, policy/build/entry/docs wiring and complete Task 6 runtime gate. Preserve per-package test ownership above.

**Files:** Replace server.js with mapped `src/server` modules; migrate remotes/control/presentation domains and colocated suites; convert stream and theme-validation scripts to TS; modify package start/presentation/bin/build scripts, root docs launch/config/help/remote sections and config HELP. Create `tools/start.ts` plus adjacent startup test. Consume the typed themes/shared-role modules and emitted public tree delivered in Task 5; overseer state was migrated in Task 4.

**Read first:** `server.js:createServer/controlResult/main`, `sidecar/control.js:makeControl`, `sidecar/overseer-state.js:makeOverseerState/resolveEndpoint`, `sidecar/observer-remotes.js:sanitizeSnapshot/sanitizeTargets/remoteCommand/makeRemoteHosts/makeFederatedObserver`, `scripts/stream.js:startStream`, server/control/remotes/overseer suites; `sidecar/presentation.js:makePresentationObserver` and its control/inspector imports.

**Current-state evidence:** token/origin/loopback/CSP/symlink/cache checks are composed in createServer. Controls are opt-in and identity-proven; overseer state is exclusive/private and never replaces uncertain records. Remote command is fixed except validated/quoted dir. Stream omits transcript preparation and writes bounded NDJSON; config defaults/readme reference root files.

**Intended edits:** Migrate presentation now, after its inspector dependency (Task 4) and alongside its control dependency in this task; preserve masking and unavailable-inspector semantics. Extract route/static/bootstrap handling by existing boundaries with `createServer` unchanged as test seam. Define `ControlAction` discriminated union for attach/spawn/close/overseer/spawn-host and typed `ControlResult`/error without widening public fields. Parse body as unknown, preserve content-type/4096-byte/status/provider/pane/host/folder rules. Keep timing-safe token comparison, presentation masking and realpath containment in owning handler.

Split remote sanitizers from SSH lifecycle/federation, retaining field allowlists, byte/time bounds, proof TTL and cross-host restrictions. Preserve close/reconnect/backoff timing and fixed command quoting. `remoteCommand(dir)` now launches `bun --no-env-file dist/runtime/scripts/stream.js`; remote install instructions require `bun run build` before hub connection. No on-demand remote install/build/SSH command is executed during verification. Source stream CLI remains `bun --no-env-file scripts/stream.ts` for explicit developer use.

`tools/start.ts` builds then spawns `bun --no-env-file dist/runtime/src/server/main.js`, forwarding arguments, exported environment and exit/signal handling. `bun run start` and presentation use this launcher; package bin points at compiled main with Bun shebang. The installed bin starts a prebuilt artifact and never needs dev tools. `main.ts` has import-meta main guard, so tests/imports cannot launch observers. Help explicitly names supported launch paths. Root config/rooms still resolve next to package.json regardless cwd. `validate:themes` source CLI defaults to retained frontend root, with explicit frontend path unchanged.

**Interfaces:** retain `createServer`, `makeControl`, `makeOverseerState`, `makeRemoteHosts`, `makeFederatedObserver`, `startStream`, `remoteCommand`, `sshArgs`; existing API paths/JSON unchanged. Build runtime now includes server main, presentation/control/remotes, stream and validators. Before first compiled server/stream execution, resolve their entire recursive module and runtime-asset closure: all observer/read adapters, overseer state, child-env/failopen/redaction/config/inspector, presentation/control/remotes, themes/shared roles, static/bootstrap handlers and canonical JSON data must already be typed or explicit data assets. Emission must fail on an unresolved/legacy JS application dependency; do not copy or allowJs legacy modules into dist/runtime. Include any imported canonical JSON in emitted assets at its resolved path, or read it through the explicit publicRoot, and test that chosen path from an external cwd. `bun run dev` runs build then source main through Bun; browser build is already provided by Task 5, and rebuild/restart remains explicit.

**Dead-code scope:** old server.js/remotes/control/presentation/stream/validator sources, package/bin/docs/HELP references, source-only entrypoint guards, duplicated validators. Preserve intentional private record ownership and proof checks.

**Review target:** deep cross-file control authorization and presentation redaction, HTTP containment, exclusive overseer state, remote proof freshness, entrypoint env/privacy/signal behavior.

- [ ] **Step 1:** Extend HTTP fixtures for emitted startup from another cwd, root config/rooms defaults, malformed methods/origin/token/identity/body, cache/nonce and symlink escape. Add exact remote-command and stream-stop tests. Cleanup: trace all old launch/worker/SSH/docs consumers.
- [ ] **Step 2:** Run focused startup/remote-command tests before changes; expect old-path assertion failure. Run existing security suites as characterization. Cleanup: fixture ports and temp configs close/delete only within owned roots.
- [ ] **Step 3:** Apply typed module split and launch command switch. Keep the Task 5 emitted HTTP public root and browser output usable during the entrypoint switch. Cleanup: delete old launch files once package/tests/SSH/docs point at replacements; no permanent forwarding wrappers.
- [ ] **Step 4:** Run server/control/presentation/remotes/overseer/stream suites and `bun run build:runtime`. Spawn compiled server with injected synthetic observer only; assert root HTML/API/security responses and clean shutdown. Cleanup: final search for server.js/scripts/stream.js launch strings; dist paths are valid current references.
- [ ] **Step 5:** Run `bun run test`, owned strict gates and scanner diagnostics. Check stream fixture never emits secrets/transcript details; no actual SSH, Herdr action or overseer launch. Cleanup: prove every dynamic entrypoint is in build/scanner ownership, not ignored broadly.
- [ ] **Step 6:** Independent review traces request, proof and process lifecycle to concrete sinks. Record all supported command changes and test evidence. Cleanup: no stale entrypoint, unused control helper or duplicated sanitation remains.


### Global constraints

- User: “full refactor which include the new repo setup and TS, plus folders and file reorganization if necessary.”
- User: “for tests I want the test file beside the tested file not in a tests directory”.
- Preserve existing MIT and NOTICE; preserve local machine tooling and unrelated edits. No Co-Authored-By trailers or timeline estimates.
- Preserve `bun run start`, `bun run test`, `bun run presentation`, and `bun run validate:themes`; direct `.js` launch paths may change with coordinated docs/SSH updates.
- Supported commands retain `--no-env-file` and `bunfig.toml` `env = false`. Exported variables still apply. Child/worker environment restrictions remain.
- Do not weaken strict compiler flags or production rules, add blanket exclusions, introduce `any`/casts to bypass boundary validation, or hide findings through scanner suppressions. Retain starter test-specific policy only.
- Checks are read-only. Explicit format/fix owns changes. Stage probes run in disposable copies; no defects or fixture state land in the real checkout.
- Never read private config/artwork merely to inventory it. Use path/stat/digest evidence without outputting contents. No local input moves, overwrites, deletion or publication.
- User has now authorized sequential implementation after justified simplification and the independent plan gate; no further approval pause is required for the agreed scope. Execution controller owns worktree/branch registration, per-task independent review, final PR review and merge gates. Tasks below do not bypass them.
- No paid/live runs without explicit user approval. Fixture HTTP/browser/native compilation tests are local verification; real agent inventories, SSH remote streams or mutating controls are live integrations.



## Bounded parallel package 6-control

Own src/sidecar/control/**, presentation cohesive owner and adjacent tests, replaced legacy files only. Preserve makeControl attach/spawn/spawnHost/close/overseer/hosts and PANE used by makePresentationObserver. Consume actual Observer/ControlTarget and reviewed overseer/child-env/config/inspection interfaces. Preserve opt-in/provider/host/pane/folder/fresh proof/argv/redaction/masking/unavailable inspection rules, endpoint and process ownership identity, exclusive state, async close. No actual actions or launches; fixture subprocess/RPC only. No remotes/HTTP/browser/shared/build/docs edits; request exact shared ControlAction/ControlResult or caller patches from controller, only genuine HTTP consumer needs. Preserve test oracles; no boundary casts.

This bounded package is part of approved rev4 P2. Exact baseline/isolated checkout/report path supplied at dispatch after reviewed Tasks4/5. Full task context above is requirements evidence; owned package scope in this section controls edits. Controller alone integrates, handles root/shared/caller changes, commits and FLOW/GSD. You are not alone; preserve others edits and use assigned checkout only. No delegation, commits, branches, records, paid/live runs. Apply wnz-task-implementer, wnz-clean-code-js, wnz-test-quality and wnz-dead-code. Report incrementally then final status per implementer contract: changed/removed paths, retained/relocated test oracles, fresh commands/exit results, source/emitted closure, remaining full-repo findings by owner, exact caller patches. Stop editing on handoff for fresh independent review.
