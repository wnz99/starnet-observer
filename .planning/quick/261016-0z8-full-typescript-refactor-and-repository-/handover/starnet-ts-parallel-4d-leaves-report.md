# Parallel4d-leaves initial readiness report

Status: NEEDS_CONTEXT — ready for implementation; waiting for controller GO and frozen prerequisite SHA. This is the explicit read-only controller gate, not a user permission request.

## Scope and controls

Checkout: /Users/davidfava/Projects/Personal/starnet-observer-typescript-4d-leaves. Branch: wip/typescript-refactor-4d-leaves. Inspected baseline: 7420c520547a012bc5bde8ca9f2fa93fe58227d2. Working tree remained clean throughout preparation.

Ownership: future src/sidecar/{arrangement,projects,identity}/** and old sidecar/observer-{arrangement,projects,identity}.{js,test.js}. No shared/root/config/build/observer/browser changes, commits, branches, or delegation. Other agents' changes must be preserved. Controller owns consumer updates before old-owner deletion.

Read required wnz-task-implementer, wnz-dead-code, wnz-clean-code-js, wnz-test-quality, caveman, and checkout AGENTS.md. Requested gpt-6.1-sol medium identity is unavailable through host introspection; no model substitution or external provider launched. Registered agent bus and inspected roster; no unrelated peer messaging.

## Read-only audit and interfaces

Production dependency closure: arrangement uses Node filesystem/os/path/crypto; projects uses arrangement plus existing typed child-env; identity uses Node filesystem/net/StringDecoder plus existing typed child-env/failopen. No dependency on inspector, transcripts, observer, or frontend production modules.

Preserve exports: arrangement makeArranger, parseRemote, validateRooms, UNASSIGNED; projects makeProjectResolver; identity makeIdentityResolver, makeIdentityRpc, makeFooterConfigurationReader. Use emitted .js sibling imports. Legacy CJS consumers require actual .ts paths.

Proposed arrangement contracts: Arrangement = NonNullable<ObserverRow['arrangement']>; ArrangementEntry = {kind:'repository'|'folder';root:string;checkoutRoot:string|null;here:string}; GitRead = (folder:string,args:string[])=>Promise<{stdout:string}>; ArrangerOptions includes git, now, optional filesystem, home, roomsFile and warn. Input rooms JSON stays unknown through strict existing schema validation. Preserve TTL 300000, bounds 512, room file 65536 bytes, four-worker queue, nested/org/sticky/file-rule ordering and opaque output.

Proposed project contracts: Execute = (command:string,args:string[],settings:{timeout:number;maxBuffer:number;env:NodeJS.ProcessEnv})=>Promise<{stdout:string}>; ProjectResolution is Pick<ObserverRow, project/repo/checkout/worktree/folder fields> with projectHome and arrangement optional. resolve(cwd:unknown) and resolveMany(cwds:readonly unknown[]) preserve invalid-cwd fallback, aligned duplicates, bounded concurrency, 60s proof/cache boundary, canonical main evidence recheck and path privacy. Internal discovery result becomes a discriminated validated shape; three-line Git identity becomes validated tuple, not array assertions.

Proposed identity contracts: RPC accepts string method (unsupported names still reject), bounded validated parameter records and returns Promise<unknown>; native JSON is narrowed before use. Public resolution is discriminated footer/native/unavailable union. FooterProof holds paneId/provider/terminalId/sessionId/birth/contentRevision/observedAt. RefreshState has endpointTimedOut? and processBirthUnavailable?; resolver resolve/resolveMany/revalidate/revalidateAll/retain preserved. readProcessBirth returns unknown; validBirth narrows it. Keep sampled final conditional probe after all other awaited inputs, one refresh admission, timeout/capability suppression, pane-local invalid PID evidence, configured-footer ownership and revalidation root checks.

Cohesive internal splits needed by existing strict function/complexity/file limits: arrangement rooms validation/loading, folder/repository discovery and room-assignment algorithm; projects Git evidence/discovery and association; identity transport/configuration/process-birth/evidence/capture plus resolver. Preserve algorithms and existing comments; avoid generic abstractions and compatibility wrappers.

## Exact consumer patch requests (controller-owned)

1. sidecar/observer.js: require('./observer-projects.js') -> require('../src/sidecar/projects/index.ts'); require('./observer-identity.js') -> require('../src/sidecar/identity/index.ts').
2. sidecar/observer.test.js identity requires at current lines 1165, 1372, 1592, 2325 -> ../src/sidecar/identity/index.ts.
3. New relocated arrangement test's frontend model import becomes ../../../frontend/app/observer-model.js. New identity test's legacy observer integration import becomes ../../../sidecar/observer.js. Those test-only legacy imports do not enter runtime emission.
4. No shared contract edits currently required. Runtime includes already cover new domain TS. Any scanner entry adjustments remain controller-owned after implementation evidence.

Test conversion decision (controller resolved): all pure/direct owned tests become TS now. Keep real browser-model coordinating assertions in adjacent JS integration until Task 5-P/model provides typed model; keep identity/observer owned-PID coordinating assertions in adjacent JS until Task 4d-O provides typed observer. Never mock these real collaborators to force TS. Final all-TS-by-Task-7 requirement remains unchanged.

Exact test handoff: arrangement original line 218 `Model.sectionKey(Model.arranged(row))` coordinates four distinct main/linked/subfolder sections with actual model; original lines 425–471 cover arranged grouping-field projection, bare-row identity, createLayout/reconcile room merging, onPage room count/name, seatFor stability across polls. Preserve in src/sidecar/arrangement/model.integration.test.js with actual ../../../frontend/app/observer-model.js until browser owner ports them. Identity original processBirthBoundary lines 354–504 imports actual makeObserver at line 360; preserve owned-child PID/observer selection/inspection assertions through line 452 in src/sidecar/identity/observer.integration.test.js, while direct default-reader evidence/capability tests become typed adjacent unit/integration tests. Task 4d-O owns later port of actual observer integration. Extract only stable synthetic fixture mechanics needed for these boundaries.

## Dead-code evidence (audit only)

Candidate old production modules: all reachable and supported now. observer.js consumes projects/identity; projects consumes arrangement. Old owner deletion becomes confirmed cleanup only after typed replacements and controller caller switches. Current old tests exercise supported behavior, so retain/migrate assertions rather than deleting tests. Internal pure exports parseRemote/validateRooms and UNASSIGNED remain consumed by projects/tests. Python snippets are intentional native/configuration boundaries, not obsolete code. No removals performed. Out-of-scope caller cleanup explicitly assigned to controller; audit complete for initial baseline, cleanup pending.

Repository-wide rg found only owned sources/tests and observer.js/observer.test.js references to old names. No docs/config/dynamic registration reference found in tracked source search. Root configuration not modified.

## Micro-steps after GO

1. Verify controller frozen SHA and clean owned diff; re-read changed prerequisite interfaces. Move characterization suites beside domains, update owned imports, retain test oracles; run original behavior before migration.
2. Migrate arrangement using typed filesystem/Git inputs, validated rooms schema and cohesive rule/discovery modules. Keep nested/org/sticky ordering and bounded operations.
3. Migrate projects with validated Git tuple, typed cache/evidence/discovery and preserved resolve contracts; wire typed arrangement.
4. Migrate identity transport/config/process/evidence/capture/resolver, retaining all failure and race boundaries.
5. Send exact final consumer imports and public signatures to controller; wait for caller patch before removing old modules. Remove only owned obsolete modules after all consumers switched.
6. Run focused adjacent tests, observer integration regression, strict new-module proof, runtime closure build and owned lint; full relevant suite after caller integration. Self-review diff, final-reference audit and per-step cleanup evidence. No live integration.

## Verification executed

`bun --no-env-file test sidecar/observer-arrangement.test.js sidecar/observer-projects.test.js sidecar/observer-identity.test.js`: 3 pass, 0 fail, 4.25s. Tests use synthetic temp Git repositories/config/socket fixtures and owned process PID evidence; no real home/config/RPC/agents/SSH/provider activity.

`rg -n 'observer-(arrangement|projects|identity)' ... .`: external source callers exactly observer.js and observer.test.js above.

`git rev-parse HEAD`: 7420c520547a012bc5bde8ca9f2fa93fe58227d2. `git status --short`: empty.

Implementation, new-module strict checks, new owned lint and emitted verification not run because source edits are prohibited before GO. Baseline tests are initial characterization evidence only, not migration completion evidence.

## Implementation checkpoint after GO

Controller supplied frozen prerequisite 357b45b, clean checkout confirmed. Controller applied observer.js and observer.test.js mechanical caller patches in this checkout. Production arrangement/projects/identity owners now implemented as strict typed modules, with cohesive discovery/validation/assignment/capture/transport/evidence boundaries. Original algorithms and all characterization assertions pass against these modules: 3 pass, 0 fail. `bunx tsc -p tsconfig.runtime.json --noEmit` passes. Owned ESLint source pass reaches zero findings after explicit fixes/refactors. No compiler/lint weakening, suppressions or casts introduced. Controller authorized minimal explanatory-comment rewording to avoid false-positive clean-code keyword scanning; all technical/security meaning retained.

Remaining: convert pure/direct characterization suites to TypeScript; preserve actual frontend coordination in narrow adjacent JS; extract owned-process observer integration verbatim into sidecar/observer.identity-process.test.js; remove superseded old modules/tests after final source/caller trace; run fresh owned source+test strict/lint, relevant/full tests and emitted closure evidence. Current index.test.js copies are temporary behavior checkpoints and will not remain duplicate pure/direct suites. Final implementation cleanup/self-review not yet complete.

## Final implementer handoff

Status: DONE_WITH_CONCERNS. Owned implementation, cleanup, focused verification and self-review complete. Concerns are the explicitly deferred real-collaborator JS handoffs and pre-existing out-of-scope root scanner findings; independent review remains controller-owned. No commits, branch changes, config/shared edits, GSD/FLOW writes, delegation or live integrations performed.

### Final scope and files

Baseline: 357b45b. New owned files are all files under src/sidecar/arrangement/, src/sidecar/projects/, src/sidecar/identity/ (27 files), plus sidecar/observer.identity-process.test.js. Removed six superseded sidecar/observer-{arrangement,projects,identity}.{js,test.js} files. Controller-owned sidecar/observer.js and sidecar/observer.test.js contain only the previously requested mechanical import changes; this worker did not edit them.

Arrangement owner: common bounded-map/path-label utilities; strict unknown rooms schema and remote parser; bounded rooms-file loader; canonical folder/repository discovery; dependency-ordered sticky/nested/organization/file placement; unchanged opaque public projection. Projects owner: Git/settings/cache discovery, main-proof validation/coordinate association, public projection and bounded batch orchestration. Identity owner: guarded execute, bounded newline RPC, semantic TOML cache, PID birth reader, footer/terminal evidence, shared refresh admission/suppression, sampled bracket capture, single-root proof revalidation and resolver orchestration.

Factory exports remain makeArranger/parseRemote/validateRooms/UNASSIGNED, makeProjectResolver, makeIdentityResolver/makeIdentityRpc/makeFooterConfigurationReader. Identity consumers that need types import FooterProof/RefreshState/IdentityResolution from src/sidecar/identity/types.ts; unused index reexports were removed after scanner evidence. ProjectResolution uses existing ObserverRow fields through Pick, not a duplicated observer contract. No shared contract changes required.

### Requirement coverage

- Preserved real factories/algorithms: characterized sticky room transitions and explicit reloads, canonical main/worktree proof recheck, 60s/300s caches, bounded queues and map pressure, path/remote privacy, config semantic parsing, socket size/deadline/closure, terminal/provider/footer/PID/content races, final conditional content probe, endpoint admission and per-refresh suppression. Existing baseline assertions execute against new owners.
- Strict module closure: all production sources are TS with emitted .js relative import convention and allowJs disabled. No any, cast-based boundary bypass, ambient shim, scanner suppression, exclusion or compiler weakening introduced.
- Tests beside tested owners: direct/pure characterization suites are now index.test.ts in each owner. Real collaborators remain real. Browser-model coordinating assertions are in src/sidecar/arrangement/model.integration.test.js for Task 5-P/model; actual observer owned-PID integration is registered/awaited in exclusive sidecar/observer.identity-process.test.js for Task 4d-O. Setup, exited-owned-child/default libproc behavior and observer selection/inspection assertions remain. Final all-TS-by-Task-7 obligation stays unchanged.
- Assertion preservation audit via TypeScript AST: original suites contain 216 assertion calls; migrated/direct+handoff suites contain 237 calls including explicit fixture-element proof assertions. Every original literal assertion argument/message is retained. This supports, but does not replace, behavioral execution and independent review.
- Cleanup: all six old owners/suites removed only after controller import switches and consumer trace. No compatibility wrappers. No old owner filename references remain. Generated dist output remains ignored and temporary synthetic fixtures were removed.

### Fresh verification after final edits

1. `bun --no-env-file test src/sidecar/arrangement src/sidecar/projects src/sidecar/identity sidecar/observer.identity-process.test.js sidecar/observer.test.js`: 7 pass, 0 fail, six files, 5.61s. Log /tmp/starnet-leaves-final-focused.log.
2. `bunx tsc -p tsconfig.json --noEmit`: pass. `bunx tsc -p tsconfig.runtime.json --noEmit`: pass before final export cleanup; final runtime build recompiled same production graph successfully.
3. `bunx tsc -p /tmp/starnet-leaves-strict.json --noEmit` and earlier `--listFiles`: pass. Temporary exact-leaf compiler project extends unchanged runtime strict config and roots only three typed owners plus three typed suites. 31 application TS modules; zero legacy application JavaScript inputs. Declaration and runtime options remain inherited from repository, including strict/exact optional/indexed access/no implicit/no unused flags.
4. `bun run build:runtime`: pass after final edits. `bun --no-env-file /tmp/starnet-leaves-emitted-smoke.mjs /Users/davidfava/Projects/Personal/starnet-observer-typescript-4d-leaves`: pass against emitted modules. Uses isolated Git repositories/config environment and injected identity RPC/PID/config evidence; covers actual discovery/organization grouping/privacy, aligned null/undefined input, rooms validation, footer capture/final probe/revalidation.
5. Recursive emitted import audit: 25 existing .js modules reachable from the three emitted roots, all relative imports resolve inside dist/runtime, no legacy application import or .ts runtime specifier. Runtime graph includes shared child-env/failopen/redaction, no legacy observer/browser test inputs.
6. `PATH=/Users/davidfava/.local/share/starnet-quality-tools/node-v24.19.0-darwin-arm64/bin:$PATH bunx eslint src/sidecar/arrangement src/sidecar/projects src/sidecar/identity sidecar/observer.identity-process.test.js --max-warnings 0`: pass after final edits. `bunx prettier --check` over same owners: pass; `git diff --check`: pass.
7. `bun run test`: 62 pass, 0 fail, 49 files, 50.91s. Log /tmp/starnet-leaves-full-test.log. Subsequent changes only remove unused owned exports and restore Unicode line-separator room-path acceptance to the original regex's character domain; final focused seven suites, strict/build/emitted smoke and lint were rerun afterward. No unrelated suite rerun was needed for those bounded edits.
8. `bunx fallow dead-code src/sidecar/identity --summary`, same for projects and arrangement: each zero findings. Final root Knip reports 13 pre-existing exported symbols only in frontend/app/queryspine.fixture.js, sidecar/control.js, sidecar/observer-inspector.js and sidecar/observer-remotes.js. Final root Fallow reports only three unused exports in sidecar/control.js (FOLDER, quote, remoteEndpoint). Both root scanner commands exit 1 and remain controller-owned migration work. Logs /tmp/starnet-leaves-final-knip.log and /tmp/starnet-leaves-final-fallow.log. Duplication diagnostic: five clone families, 77 lines, 0.3%; no new blanket config changes or suppressions.
9. `node /tmp/starnet-leaves-assertions.cjs`: oldAssertions=216, currentAssertions=237, missingOriginalLiteralAssertionArguments=[]. Final old-owner filename `rg` returns no matches. No source/config mutation occurred during checks.

### Per-step dead-code evidence

- Initial characterization audit: old source/suites supported and reachable through observer/projects; no cleanup allowed before GO. Preserved all supported behavior assertions. No source edits during initial gate.
- Arrangement migration cleanup: projects source and owned suites now import src/sidecar/arrangement/index; parseRemote, validateRooms and UNASSIGNED remain supported consumers. Discovery/placement/classes/helpers have actual production import paths. No speculative compatibility exports or runtime entrypoints added. Final scoped Fallow zero.
- Projects migration cleanup: observer.js controller import reaches new projects/index.ts; real Git characterization suite reaches actual factory. Cache/evidence/association projection internal responsibilities remain imported. Old projects source/suite removed after caller switch. Final scoped Fallow zero.
- Identity migration cleanup: observer.js and four observer.test.js controller imports reach new identity/index.ts; typed suites, emitted smoke and narrow observer integration exercise live factory exports with synthetic inputs. FooterProof/RefreshState/IdentityResolution remain internally consumed typed contracts in types.ts; BIRTH_CODE and ExecuteSettings now module-private where no external consumer exists. Old identity source/suite removed after caller switch. Final scoped Fallow zero.
- Integration handoff: actual browser model has dynamic CJS consumers and cannot yet join production TS graph; narrow JS handoff is intentionally retained and explicitly assigned to 5-P. Actual observer integration is intentionally retained beside current observer and explicitly assigned to 4d-O. These are supported test contracts, not dead code. No mock replacement or obsolete duplicated direct suites remain.
- Final reachability audit: repository-wide old filename scan zero; exact source closure contains only TS; emitted closure all internal .js; obsolete files absent. Out-of-scope root scanner exports retained for their owners, not silently deleted. Owned cleanup assessment complete.

### Self-review and corrections

Traced source-to-emitted imports; arrangement placement dependency order and sticky overrides; project duplicate input alignment/main evidence/cache eviction; identity final-probe ordering/PID evidence/socket disposal/shared timeout admission; real collaborator handoffs and fixture disposal. Corrected generic project pool to process an actual undefined input instead of skipping it. Corrected Unicode line-separator path pattern acceptance after replacing a control-character regex for lint. Removed scanner-confirmed unnecessary owned exports rather than suppressing scanner output. Minimal comment wording changes preserve original technical/security content under the controller's explicit authorization.

No unresolved owned correctness finding remains from self-review. Independent reviewer must assess the full worker diff and repeat reachability/security analysis; no independent approval claimed here.
