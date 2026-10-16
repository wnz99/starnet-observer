### Task 4: Migrate observation adapters, private SQLite and native asset lifecycle

**Goal:** All read adapters become strict modules, with built worker/Swift paths tested without touching live sources.

**Delivers:** F2, F3, F4.

**Execution:** Task 3 reviewed; wave 4; sequential-only because observer composition/worker/build paths overlap; own sidecar observation/desktop/sqlite/overseer-state domains and runtime build owner; integrate fourth.

**Files:** Migrate observer, helpers, transcripts, bus, identity, projects, arrangement, inspector, desktop, SQLite and overseer-state files to the domain owners in the map, including existing adjacent suites. Move Swift source to `src/sidecar/desktop/observer-desktop-macos.swift`. Create `tools/build.ts`, `tools/build.test.ts`, `src/server/runtime-paths.ts` and adjacent test, `tsconfig.runtime.json`; update current server imports to typed factories. No live input files move.

**Read first:** `sidecar/observer.js:makeObserver/aggregateRows/lastActivity`, `sidecar/observer-sqlite-client.js:makeSqliteClient/start/stop`, worker message handler, `sidecar/observer-desktop.js:makeDesktopObserver/build/privateEntry`, `sidecar/overseer-state.js:makeOverseerState/resolveEndpoint`, respective helper/transcript/bus/identity/project/arrangement/inspector factories and tests, especially native stall suite.

**Current-state evidence:** observer coordinates independent sources; aggregateRows deduplicates proven sessions and tracks usage conflicts/freshness. Worker uses sibling JS, empty env, allowlisted workerData, owned snapshot dirs and bounded queue. Swift cache identity hashes source/compiler. Existing worker tests assert source DB byte identity and timeout/unref/cleanup behavior.

**Intended edits:** Migrate overseer-state and its colocated tests before compiling observer: makeObserver imports makeOverseerState/resolveEndpoint. It depends only on platform modules, so it closes this adapter graph without pulling controls forward. Preserve module factory contracts and split read/parsing/indexing/orchestration responsibilities within their domain. Do not replace core algorithms during typing. `src/sidecar/sqlite/protocol.ts` defines discriminated existing operations, correlation request, allowlisted payload and result types directly from worker operations; both ends validate incoming messages and operation-specific data. No SQL/functions/secrets cross workerData. Retain generation/quarantine and native-stall behavior. Adapter inputs from filesystem/process/JSON remain unknown until existing validation proves shape.

Compile only the recursively closed typed adapter roots and runtime-paths in this task, with `allowJs` disabled and no copied legacy application modules. Direct source audit establishes the closure: observer reaches desktop/inspector/redaction, projects/arrangement/child-env/failopen, transcripts/inspector, helpers/bus, sqlite client/worker/bus/helpers, identity and overseer-state; the remaining leaves are built-in Bun/Node APIs. Themes, presentation, controls, remotes and HTTP are not adapter dependencies and are not emitted before their migration. Check every resolved import, not only direct imports, before first emitted worker/adapter execution. Runtime build emits unbundled ESM via `tsc -p tsconfig.runtime.json`, with runtime `.js` imports resolving compiled siblings; `.ts` source imports follow the selected TS emission-supported convention consistently. Worker default resolves `./worker.ts` when its own module URL ends in `.ts`, and `./worker.js` from emitted `.js`; use a direct URL relative to `import.meta.url`. Both are the same supported worker source/build boundary, not a legacy wrapper. Tests cover source and built execution; scanner/build configs declare the worker explicitly. Copy Swift source beside emitted desktop index. `runtime-paths.ts` exports `resolveRuntimePaths({ installRoot?, publicRoot? }): { installRoot: string; publicRoot: string }`, deriving default package root from compiled location, with tests from another cwd. During partial migration, current source server passes explicit repository/public roots. Build stages only owned generated directories; local data is untouched. No test files or private source are emitted into public root.

**Interfaces:** preserve `makeObserver`, `aggregateRows`, `lastActivity`, `makeSqliteClient`, `makeDesktopObserver` and current domain factory names; shared Observer types from Task 3. `bun run build:runtime` emits `dist/runtime/src/sidecar/**`, with worker/Swift relative locations intact. Task 5 adds typed theme/role modules and public browser output; Task 6 adds executable server/script entries to the same emission project.

**Dead-code scope:** old read-adapter/overseer-state JS and fixture imports, native source path references, worker filename strings and duplicated protocol shape switches. Retain intentional worker lifecycle/process fixture code even if scans see no normal imports; register true entrypoints.

**Review target:** identity/privacy/read-only boundaries, source independence and freshness, worker stall cleanup, same native cache security, correct emitted resource paths.

- [ ] **Step 1:** Port adapter characterization suites. Add emitted-worker fixture using only synthetic SQLite and hash source bytes before/after; add emitted native-source path/cache-hash test. Cleanup: record old worker/native consumers and generated subprocess fixtures.
- [ ] **Step 2:** Run `bun --no-env-file test src/sidecar/sqlite/client.test.ts src/server/runtime-paths.test.ts tools/build.test.ts`; require missing compiled paths/protocol failures before edits. Cleanup: disposable DB/build fixtures only; no user DB read or mutation.
- [ ] **Step 3:** Type and split adapters/build as described; preserve bounded outputs/error states and explicit close. Cleanup: remove migrated JS/source copies and update every consumer/test/worker asset registration; no unsupported wrappers.
- [ ] **Step 4:** Run adapter/overseer suites and `bun run build:runtime`; inspect emitted transitive imports and require zero legacy JS application inputs; launch emitted worker in subprocess under env sentinel and assert empty worker env, bounded data, no DB byte changes, timeout/quarantine/unref and no leftover scratch. Cleanup: ensure spawned workers closed and only owned temp roots removed.
- [ ] **Step 5:** Run `bun run test`, type/lint/scanner diagnostics; owned domain has zero strict findings. On macOS compile the emitted Swift source against a synthetic/private cache without enumerating real desktop windows; Linux tests assert unsupported-platform result. Cleanup: verify no stale sibling `.js`/Swift paths and no generated native binary tracked.
- [ ] **Step 6:** Independent review follows snapshot, identity, queue and close paths across source/tests/emitted output. Record all commands/results and live-run exclusions. Cleanup: confirm no old adapters, orphaned snapshots or duplicate worker protocol remains.


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


### Proposed file ownership and migration map

| Existing owner | Proposed owner and responsibility |
| --- | --- |
| server.js | src/server/{main,http,api,static,bootstrap,runtime-paths}.ts: launch, HTTP wiring, routes, static containment/cache, nonce boot, installation roots |
| sidecar/observer.js | src/sidecar/observer/{index,aggregation,inventory,rows,lifecycle}.ts: existing factory/orchestration, aggregateRows/lastActivity, inventory polling, row construction, cleanup |
| sidecar/observer-remotes.js | src/sidecar/remotes/{index,sanitize-snapshot,sanitize-bus,sanitize-targets,ssh,stream,federation}.ts: current sanitizers, command/argv, lifecycle/backoff, federation |
| sidecar/control.js | src/sidecar/control/{index,local,remote,overseer,validation}.ts: existing action orchestration and distinct proof/process boundaries |
| sidecar/theme-packs.js | src/sidecar/themes/{index,manifest,resources,validation}.ts: pack resolution, manifest, bounded resources and containment |
| sidecar/observer-sqlite-{client,worker}.js | src/sidecar/sqlite/{client,worker,protocol,snapshots}.ts: queue/lifecycle, worker entry, discriminated protocol, snapshot ownership |
| sidecar/observer-desktop.js and Swift | src/sidecar/desktop/{index,cache,identity}.ts plus observer-desktop-macos.swift: adapter, private build/cache, identity |
| sidecar/observer-{helpers,transcripts,bus,identity,projects,arrangement,inspector}.js | src/sidecar/{helpers,transcripts,bus,identity,projects,arrangement,inspector}/index.ts with domain-named subordinate modules when needed by preserved strict limits |
| sidecar/{config,presentation,overseer-state,redaction,child-env,failopen}.js | src/sidecar/{config,presentation,overseer-state,redaction,child-env,failopen}.ts, split within matching domain directory when required by real responsibility/strict limits |
| frontend/app/scene-art-roles.js | src/shared/scene-art-roles.ts, consumed directly by browser office art and server theme validation |
| frontend/app/{harness,queryspine,data-shim,observer-model,observer-mail,observer-inspector,observer-mail-inspector,observer-office-art,theme-pack}.js | src/browser/{harness,queryspine,data-shim,model,mail,inspector,mail-inspector,office-art,theme}.ts; subordinate modules inside matching domain directories for distinct responsibilities |
| frontend/app/observer-scene.js | src/browser/scene/{index,layout,geometry,crew,relays}.ts: scene composition, layout, coordinate work, crew and relay placement |
| frontend/app/observer-view.js | src/browser/view/{index,camera,station,crew,mail,effects,interaction}.ts: drawing composition and existing render/interaction responsibilities |
| frontend/app/observer.js | src/browser/app/{mount,state,preferences,hosts,controls,inspectors,lifecycle}.ts: composition, view state, local preferences, hosts, controls, panel stack, visibility/subscriptions; src/browser/main.ts mounts |
| frontend/js/{assets,sprite-load-plan}.js | src/browser/sprites/{assets,load-plan}.ts plus existing asset decode/render/cache responsibilities split as required |
| scripts/stream.js | scripts/stream.ts: current read-only remote NDJSON entry; emitted dist/runtime/scripts/stream.js |
| scripts/validate-theme-packs.mjs | scripts/validate-theme-packs.ts: current CLI, preserved optional explicit frontend root |
| scripts/test.js and test/_assert.js | removed after Task 1 replaces all consumers; no legacy compatibility runner |
| test/_sprite-runtime.js | src/browser/sprites/runtime.fixture.ts after browser migration; reusable typed canvas/image fixture |
| test/*.test.js | current-owner adjacent *.test.js in Task 1, then matching new-owner adjacent *.test.ts during Tasks 3–7; cross-module cases live beside coordinating owner |
| frontend/observer.html, css, assets; themes/; root config example | retained authored resource paths; HTML changes only script wiring; local ignored config/rooms/packs remain there |
| new build/pack/acceptance owners | tools/{build,package,acceptance}.ts with colocated *.test.ts; tools/quality pinned helpers retained/adapted |

Names under a domain are ownership boundaries, not a quota of tiny wrappers. Implementer may consolidate a proposed split when a cohesive module meets the unchanged limits. Further splits must remain inside that domain and expose only consumer-needed interfaces; record the source reason, consumer updates and cleanup in task evidence. A changed cross-task interface requires controller review before consumption.

Exact old test grouping: server.test beside HTTP; control.test/control-remote.test beside control; config/presentation/overseer-state/child-env beside namesakes; observer.test beside observer factory; observer-helpers and observer-helpers-index beside helpers; observer-inspector/transcripts/identity/projects/arrangement/bus/bus-relay/remotes/desktop/sqlite-worker beside corresponding sidecar owner; observer-model/scene/view/mail/mail-inspector/office-art/theme-pack/queryspine/harness and sprite-theme beside browser owner; observer-ui/prefs-ui/hosts-view/arrange-ui/control-ui/control-ui-hosts/relay-scene beside app mount, preferences, hosts, arrangement, controls and scene relay coordinating owners. Test helpers belong beside their narrow owner; no test or tests directory remains.


## Observer composition package 4d-O: bounded continuation

This package is the remaining composition of approved Task4 after independently reviewed 4a/4b, 4c inspector/transcripts, and 4d-L arrangement/projects/identity. These preceding package reviews are reused; do not reimplement their owners. Exact integration baseline and checkout will be supplied at dispatch after deterministic package integration.

Ownership: src/sidecar/observer/**, migrated sidecar/observer.js and observer.test.js, and adjacent coordinating observer.warm-transcripts.test.js and observer.identity-process.test.js. Port those coordinating suites to owner-adjacent strict TS. Own cohesive observer orchestration/aggregation/inventory/row/lifecycle splits only as justified by existing strict limits. Controller alone changes other callers (server.js, scripts/stream.js, control/presentation/remotes tests), shared contracts, tools/build/config/scanners and records; send exact patch requests with runtime evidence. Do not change another package implementation to evade its actual contracts.

Preserve makeObserver, aggregateRows and lastActivity interfaces and injected adapter compatibility used by real characterization tests. Unknown JSON inventory must remain unknown until validated. Preserve injected clock requirement, bounded subprocess timeout/buffer/environment, endpoint-bound identity and control proofs, deduplication/conflict/freshness/partial-usage semantics, independent source failure, stale retention, transcript warm cache/coalescing, no stale enrichment commitment, pre/post-await ownership revalidation, footer ancestry proof, task lifecycle, desktop privacy, bus projection, one idempotent close with bounded in-flight waits and adapter cleanup. Do not use live Herdr inventory, actual process ownership/desktop enumeration, private DB/transcript/config, SSH or controls. Native fixture compiles are permitted. Read-only synthetic fixtures only.

Source inspector/transcript contracts live in their producer owner (inspector/contracts.ts), type-only imports in helper consumers. SessionInspection is the public observer-enriched result; transcript snapshot is a precise Pick and has no public id/asOf/provenance until observer adds them. ChildInspection uses the actual available discriminant plus direct snapshot, never a fabricated optional nested inspection. Projects consume ObserverRow Picks. Identity factory methods and genuine injected single-proof fallbacks remain compatible. Read accepted package reports and code rather than introducing alternate structural contracts.

Task4 completion requires full native test suite, strict root/runtime/tools type checks, zero owned lint/scanner findings, source and emitted observer execution from an external cwd under synthetic adapters, recursive emitted adapter import closure with allowJs=false and no legacy application input, actual emitted SQLite worker stall/queue/deadline/quarantine/unref/cleanup suite retained, and emitted Swift source identity/compile proof. Existing earlier package proofs may be reused where unchanged; run cross-package behavior and emitted observer composition freshly. Identify full-repo findings outside package honestly; do not weaken gates. No broader browser/server migration in this package.

Apply required wnz-task-implementer, wnz-clean-code-js, wnz-test-quality and wnz-dead-code skills. Report status per implementer contract, all changed/removed files and caller patch requests, every retained/relocated test oracle, commands with exit results, strict diagnostics and unresolved items. Update report incrementally to survive compaction. No delegation, commits, branching or edits to FLOW/GSD. You are not alone; preserve all other edits and use only assigned checkout. Independent review follows handoff; stop all edits when reporting DONE.

## Real queryspine coordinating test disposition

Observer pollingFreshness real queryspine boundary: 4d-O may extract exact awaited pollingFreshness/setup/cleanup into narrow src/sidecar/observer/queryspine.integration.test.js against actual legacy queryspine.fixture.js and typed observer, removing old duplicate. No fabricated browser contract/mock/shim. I5 ports this case TS after accepted browser queryspine API. Final all-TS-byTask7 requirement unchanged.
