# Controller ownership clarification

Controller exclusively applies shared/root/build/HTML/package/server/CLI/scanner/common caller writes. I5 domain implementer owns themes and office-art source/tests and supplies exact shared role/common patch requests; the file lists below describe complete delivered scope, not direct edit authority over controller-owned files. No source implementation before accepted Task4 and5-P frozen prerequisite GO.

### Task 5: Migrate browser primitives, theme loading and public build

**Goal:** Typed browser primitives and emitted prepaint/theme/assets work while remaining legacy view/controller scripts still run.

**Delivers:** F2, F3, F4.

**Execution:** Task 4 reviewed; wave 5; sequential-only because shared theme/build/public HTML wiring changes; own theme loader, shared runtime roles, browser primitives/sprites, authored HTML wiring and public build; integrate fifth.

**Files:** Update existing `server.js:ROOT/loadThemePack`, `scripts/validate-theme-packs.mjs` theme-loader import, remaining classic view test-consumer require paths and package start/dev/build commands as consumer wiring; migrate theme/harness/queryspine/data-shim/model/mail/inspectors/office-art/sprites/roles and their suites into mapped src owners; migrate server theme-pack loader to `src/sidecar/themes/`; create `src/browser/{bootstrap,prepaint,legacy-bridge}.ts`, `src/shared/bootstrap.ts`; extend `tools/build.ts`, add colocated asset/theme/build/browser fixtures. Preserve authored `frontend/{observer.html,css,assets}` and root theme/config data.

**Read first:** `frontend/observer.html:head script order`, `frontend/app/theme-pack.js:getDefault/freezeSnapshot`, `frontend/app/harness.js`, `frontend/app/queryspine.js:QuerySpine`, `frontend/js/assets.js`, `frontend/js/sprite-load-plan.js`, `sidecar/theme-packs.js:loadThemePack/validateInstalledPacks`, browser theme/sprite/inspector/model suites and VM fixtures.

**Current-state evidence:** head theme script applies appearance before body; boot script is nonce-injected. Theme loader checks bounded manifests and resources/containment and returns requested/effective warnings. Browser assets use typed-by-convention image/canvas state; test fixture records actual drawing calls. Existing HTML refers directly to classic app/js scripts.

**Intended edits:** Move SCENE_ART_ROLES from its still-live classic source to `src/shared/scene-art-roles.ts` only in this task. Switch the server theme loader and migrated browser office-art imports to that one table; update the still-existing theme-validation CLI to import the new typed loader directly through Bun until its own Task 6 conversion; remove the HTML classic role script reference when emitted bridge loads. Update remaining legacy browser view CommonJS test-consumer require paths to the typed shared source; its browser branch reads SCENE_ART_ROLES from the existing temporary bridge. Test actual emitted page loading and old-to-new browser/server role identity before removing the old role file. Convert pure/factory modules to ESM, preserving meaningful exported APIs used by tests. `src/shared/bootstrap.ts` defines typed server-injected window bootstrap fields and `readBootstrap(window): ObserverBootstrap` with runtime narrowing for fields consumed by browser. `prepaint.ts` calls common theme application synchronously as an IIFE; tests inspect emitted code in a VM with typed DOM fixture and real browser in Task 8. Retain legitimate immutable bootstrap window fields only.

Until Task 7, `legacy-bridge.ts` exposes already-migrated factories to the still-classic scene/view/controller consumers. It has a documented consumer list and mandatory deletion in Task 7; no public API promise. Build emits `dist/public/app/prepaint.js` (IIFE), transitional bridge and legacy scripts with exact HTML dependency ordering. No TypeScript source is served. Bun transpiles remaining JS as build input; this is transitional build support, not a quality ignore. Build copies authored HTML/CSS/fonts/sprites/theme files, excluding old executable JS directories from asset copy, then writes emitted entries.

Local build enumerates source pack directories using filesystem APIs rather than git-tracked lists, so ignored installed packs are included. Validate containment and copy only regular, contained resource files; reject escaping symlinks and output collisions. Preserve existing pack validation/fallback semantics at startup; building must not invent a stricter content-selection policy that changes valid pack behavior. Synthetic tests cover canonical pack, ignored private pack, missing selected pack, invalid pack fallback warning and escaped resource. Use isolated staging then replace only owned generated output; no clearing frontend/ or private paths. Package staging is separate in Task 8.

Theme server code imports shared scene roles, never browser code. Generated public output and runtime code agree on exact public root. `bun run build` performs runtime emission plus local public build; during this wave `bun run start` builds both before running the existing source `server.js` through Bun with `--no-env-file`. Change that existing entry's static ROOT to `dist/public`, its theme-loader require to the new typed source, and pass the explicit installation/public roots. These are consumer updates to the existing entry, not a new compatibility wrapper. Task 6 replaces that entry and switches start/dev/bin to compiled main. `bun run dev` also builds then runs the existing source server until Task 6; document explicit rebuild/restart rather than adding an unproven watcher framework.

**Interfaces:** `SCENE_ART_ROLES` is now the shared typed runtime table, consumed by themes/office-art and exposed by the temporary bridge solely for the still-classic view. `ObserverBootstrap` and `readBootstrap`; existing meaningful browser factory APIs retained under typed imports. `build({ mode: 'local' | 'package', outputRoot: string }): Promise<void>` owned by tools/build; mode selects asset inventory, never changes app behavior. Package mode is completed in Task 8. Server `loadThemePack` takes resolved publicRoot explicitly. No privileged imports in browser graph.

**Dead-code scope:** old browser primitive JS copies/CommonJS branches, sidecar theme loader, duplicated roles/default manifests, copied generated sources and bridge consumers. Retain sprite-runtime fixture and fallback rendering/validation behavior; bridge has a Task 7 removal condition.

**Review target:** prepaint ordering/CSP, runtime narrowing, asset and pack containment, private-pack inclusion locally without distribution leakage, typed pure factories and preserved behavioral tests.

- [ ] **Step 1:** Add emitted head/prepaint-order assertions and synthetic ignored pack inclusion/missing-pack/escape cases in tools/build.test.ts; port primitive/browser VM assertions into import-based factory tests with injected fetch/clock/DOM. Cleanup: map every CommonJS/global/VM consumer before migration.
- [ ] **Step 2:** Run `bun --no-env-file test tools/build.test.ts src/browser/theme.test.ts src/browser/sprites/assets.test.ts`; missing emit/local-pack behavior must fail. Cleanup: fake private resources live under disposable fixture roots; no private actual artwork read.
- [ ] **Step 3:** Implement typed primitives/theme loader/build and temporary explicit bridge. Cleanup: remove replaced JS copies/dual export branches, update tests and HTML, preserve only bridge names with live remaining consumers.
- [ ] **Step 4:** Run focused suites, `bun run build`, `bun run test`; require executable JS assets, head theme before body/mount and same pack warning/fallback cases. Cleanup: inspect dist/public for TS, sidecar, config or accidental source files; reject any.
- [ ] **Step 5:** Run owned browser type/lint checks, scanners and complete diagnostic gates. Use actual HTTP fixture to load emitted paths and CSP. Cleanup: verify source asset hashes unchanged and bridge only serves named remaining classic consumers through Tasks 5–6, all removed in Task 7; no unrelated global aliases.
- [ ] **Step 6:** Independent review of build/theme/browser trust boundaries and test migration. Record remaining bridge/legacy owners and exact future removal task. Cleanup: no copied source directory or unused asset loader/fixture remains.


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


## I5 bounded integration package

This is the remaining Task5 after accepted 5-P browser primitives. Exact baseline and checkout supplied at dispatch, after Task4 and 5-P package acceptance. Reuse prior package reviews; inspect composition and complete remaining Task5 invariants. No duplicate primitive implementations or rollback of strict shared contracts.

Ownership: src/sidecar/themes/** and theme-loader suite migration; src/shared/scene-art-roles.ts; src/browser/office-art/** and adjacent tests; temporary src/browser/legacy-bridge.ts and required prepaint wiring; tools/build.ts and build.test.ts; frontend/observer.html; source server.js ROOT/theme imports; validate-theme CLI migration and relevant package scripts/scanner real entries; exact remaining classic/test consumers. Controller remains sole FLOW/GSD/commit owner. Assigned checkout exclusive to this implementer; no other worktree edits. Shared key catalogs and ThemeDefault/ThemeSnapshot distinguish canonical raw manifest from selected resolved pack. Browser reader stays browser-owned. Scene roles must migrate once, consumed by both server validation and browser office-art and exposed to remaining classic consumers via bridge. Do not duplicate runtime role tables or canonical manifests.

Preserve server pack read/containment/realpath/size/decoded-budget/strict manifest and PNG/resource validation, canonical fallback/warnings, browser atomic image decode/exact dimensions/failure semantics, CSP and earliest theme application before body. Canonical path inventories must come from tracked resources, never inspect actual private artwork. Tests synthesize ignored packs in owned temp trees. Local build may include ignored packs by safe inventory and must remain read-only to authored/private source. Package mode remains Task8 independently tracked inventory; do not complete it by copying local output.

Build app-visible assets into owned dist/public, retain authored frontend/CSS/assets/themes source, stage only generated roots, reject symlink output aliases and preserve previous good output on compiler failure. Browser bundling uses actual dependency closure with no privileged modules/ambient legacy imports. Legacy bridge exposes only names consumed by remaining scene/view/app scripts and has explicit Task7 removal condition; do not invent permanent globals. Source server serves emitted publicRoot after coordinated start/dev/build scripts. Actual fixture HTTP must demonstrate emitted paths/CSP and same theme fallback/warning behavior; real browser proof retained Task8. Preserve no-env automatic loading and exact supported commands.

Required report per wnz-task-implementer at supplied path: full changed/removed scope, native tests and assertion/oracle mapping, actual type/lint/scanner/build/HTTP evidence after last edits, asset byte hashes, graph imports, dead-code audit, precise remaining bridge consumers. Apply wnz-clean-code-js, wnz-test-quality, wnz-dead-code, wnz-doc-write-expert for changed docs. No delegation, branches, commits, FLOW/GSD writes, paid/live sources. Stop edits on final handoff for independent review.

## Frozen theme handoff

Prepaint/bridge integration: prepaint publishes its started theme instance to exactly the existing temporary global ThemePack using typed Object.assign (no ambient declarations). I5 bridge retains/reuses it and never recreates/overwrites active theme state. Typed consumers receive only needed API through explicit narrow guards on unknown global reads. No extra global/state slot. Emitted prepaint test must prove later warning/notice uses same active status. Temporary ThemePack global removed with all bridge consumers inTask7.

## Coordinating TS test ports

Port src/sidecar/arrangement/model.integration.test.js and src/sidecar/observer/queryspine.integration.test.js against accepted typed browser model/queryspine, preserving every actual integration assertion; no mocks. These narrow handoffs are supported until this atomic browser owner switch.

## Legacy executable emission evidence

Bun1.3.13 native `new Bun.Transpiler({loader:"js",target:"browser"}).transformSync(source)` preserves classic global lexical bindings and guarded CommonJS branches: controller transpiled actual scene-art-roles.js and evaluated output plus SCENE_ART_ROLES.floor.source.width in freshVM, result48, output7570bytes. Use separate bundled IIFEs for typed prepaint/bridge, native transpilation for remaining classic scripts so cross-script ObserverScene/ObserverView bindings remain visible. Do not bundle each classic script as an isolating IIFE. Actual head/body emitted HTTP/VM ordering tests must prove complete globals/typed singleton flow at I5, this one-file experiment is not app acceptance.

## Remaining mixed-theme characterization ownership

Use exact migration map in /tmp/starnet-ts-parallel-i5-prepare-report.md. I5 domain implementer additionally owns tests-only migration of still-unported pure browser theme/asset/status/CSS-palette oracles from mixed theme-pack.test.js into adjacent typed browser owners after5-P acceptance; preserve all original cases, no duplication of already covered5-P assertions. Controller retains sharedrole geometry test/commonHTML/source-inventory and rootcaller wiring ownership. Mixed originalsuite cannot be deleted until every server/browser/shared/build oracle has a named actualtyped replacement or stronger behavior proof. Domainprodchanges outside themes/office-art remain exactcontrollerpatchrequests.
