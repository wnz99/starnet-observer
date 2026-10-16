# Observer composition 4d-O: preparation report

Status: NEEDS_CONTEXT. Read-only preparation is ready. Implementation is deliberately gated on controller refresh to the complete accepted prerequisite SHA and explicit GO. This report does not claim migration completion or independent review.

## Baseline, authority and controls

Assigned checkout: /Users/davidfava/Projects/Personal/starnet-observer-typescript-4d-observer. Assigned branch: wip/typescript-refactor-4d-observer. Inspected HEAD: 6599db57b79f9e178b4157927418ef0c788812cc. Initial working tree clean. No source/config edits, commits, branching, GSD/FLOW writes, delegation or live integration performed. Only this temporary report is written.

Owned future src/sidecar/observer/** plus removal/migration of sidecar/observer.js, sidecar/observer.test.js and the accepted warm-transcript/identity-process coordinating handoffs once supplied. Controller owns all other callers, shared types, build/config/scanners and records. Other workers are not alone; their paths/checkouts remain untouched.

Read caveman, wnz-task-implementer, wnz-clean-code-js, wnz-dead-code (audit mode), wnz-test-quality and assigned checkout AGENTS.md. Exact host/provider model identity is unavailable, as disclosed by controller; no provider substitution launched. llm-bus is available; whoami/list executed. No messages sent: no demonstrated peer ownership conflict requires them.

Read accepted 4d-L durable report, not its mutable checkout. Accepted identity types must come from src/sidecar/identity/types.ts (FooterProof, RefreshState, IdentityResolution). Current checkout intentionally retains old project/identity/transcript owners. Inspector/transcript accepted signatures and warm/owned-PID suites must be re-read only after deterministic integration. Existing helper contracts in this checkout contain the superseded ChildInspection shape; they are baseline evidence, not a signature to consume or copy.

## Requirements and current interfaces

Public exports to preserve: makeObserver, aggregateRows, lastActivity. Factory rejects missing/non-function injected now clock. Observer returns get, inspect, inspectMessage, controlTarget, close. Preserve synchronous promise identity for coalesced get/close, 2000ms cache measured from refresh start including zero, actual inventory completion timestamp, 6000ms freshness, shared endpoint environment, and 3000ms/2MiB inventory subprocess limits.

Existing injected capabilities are genuine compatibility points: projects.resolveMany or per-cwd resolve; identities.resolveMany or serial resolve; revalidateAll or single-proof revalidate; helper prepareChildren or children; optional transcript beginDiscovery; optional helper/bus close. Factory must not silently demand unrelated methods absent in scenarios that cannot call them. Test fixtures should gain precise typed values/capabilities where missing evidence is currently hidden by JavaScript, without weakening real producer contracts or replacing real integrations.

Actual current source graph: observer imports desktop, projects, transcripts, helpers/evidence/grouping, bus/public, sqlite/client, inspector/fields, child-env, overseer-state, identity and Node crypto/child_process. Runtime roots already include src/sidecar/**/*.ts with allowJs=false and explicit worker entry. Owned module imports should use emitted .js specifiers. Controller will supply accepted project/identity/inspector/transcript implementations before edits; no alternate contracts drafted here.

Inventory JSON remains unknown after JSON.parse. Narrow non-null object, result object, agents array; skip entries that do not prove codex/claude provider; reject selected entries with invalid/duplicate pane_id before identity/project/enrichment calls. A validated pane is the original record plus proven provider/pane_id, preserving unknown fields for endpoint-bound private controlTarget clone. Do not cast inventory into a native pane type. Agent status must narrow against supported statuses; cwd/foreground_cwd remain unknown until project resolver handles them. Native session/PID/footer fields stay producer-owned validation. Bounded title sanitization preserves coercion/redaction behavior. Errors never expose raw stdout/stderr/content.

Private owner state includes identityProofs, endpoint-bound controlTargets, source health and stale rows, core rows, helper lineage bindings, transcript summaries and captured ancestry. Capture/current-owner checks compare source/provider/session/inspection identity/identity source, explicit parentId presence and proof birth identity. Keep full ancestor limit/cycle checks, single-root proof-set restriction, pre-read and post-read footer validation, and final ownership recheck after the last await. Proof contentRevision is read evidence, not owner identity.

Preserve aggregation semantics: host-local session deduplication, opaque Claude helper namespace, presence-only desktop/invalid identities, stable rank and tied-conflict exclusion, individual safe/nonnegative counters, partial/unavailable/stale coverage, safe-integer overflow, contributor-only optional evidence timestamps, and lastActivity based on conversation/tool timestamps rather than file mtime. Shared Usage permits number|string|null timestamps; numeric guards must prove arithmetic rather than assert a narrower timestamp.

Preserve progressive behavior: core publishes before optional work, independent desktop/bus failures, old row timestamp retention, four shared summary reads, helper summary coalescing and abandoned-summary resolution, atomic lineage binding/publication, grouping from current core ownership, helper failure truthfulness, unchanged-owner sweep suppression, and no stale summary/lineage commit. Warmup remains two concurrent jobs, 32 candidates per sweep, 60000ms scheduling cache, expected identity plus parent, queued owner revalidation and close cancellation. Close remains one idempotent promise, closed flag first, 10000ms unref'ed bounded in-flight wait, timer cleanup and owned adapter cleanup; late tasks cannot publish.

## Cohesive ownership inventory

The existing 910-line owner and 700+ line factory exceed unchanged production limits: 300 noncomment lines/file, 50/function, complexity10, depth4, cognitive complexity15 and four parameters. Required splits correspond to actual state/responsibility, not wrappers:

- aggregation: identity grouping, ranking/conflict resolution, per-counter accumulation/finalization; lastActivity/freshness helpers near their consumers.
- inventory: unknown-input inventory validation and bounded Herdr fetch; row construction with actual identity/project/overseer producers; independent desktop/bus refresh.
- ownership: capture, sameIdentity/sameProof/currentOwner, full ancestry/footer-read proof and private control proof access.
- publication: lineage acceptance/current grouping, stale row preservation, summary merge, retained transcript IDs and final snapshot projection.
- enrichment/warmup: bounded summary queue with helper sharing, sweep lifetime/coalescing, bounded warm queue and revalidation.
- lifecycle/index: adapter construction, refresh/get entrypoints, inspection orchestration, bounded idempotent close.

Consolidate these where unchanged limits permit; keep private types inside observer, shared producer types imported type-only. No generic state framework, public compatibility wrapper, algorithm replacement or cross-package extraction authorized. Final module/file names will follow actual strict diagnostic pressure after refreshed interfaces are read.

## Test fixtures and retained oracles

The original sidecar/observer.test.js has one 3757-line regression entry with named behavioral scenarios. Preserve all assertions while making typed fixtures explicit. Stable mechanics worth sharing beside owner: full synthetic pane/project/inspection/bus builders, injected empty overseer state, typed deferred gates, bounded inventory polling, native identity RPC fixture, and tracked-adapter completion wrapper used only by legacy completed-observation assertions. Progressive tests must continue using actual core return boundary; do not hide it behind the completion wrapper.

Retain these scenario obligations:

- Missing clock; lastActivity mtime rejection/skew; stable IDs/redaction; refresh coalescing/cache; authoritative removal/stale retention; exact bus joins and ambiguity.
- boundedDiscovery/composedSummaryBound: four-read bound, one shared sweep, helper use of the same summary including failures and close abandonment.
- independentDesktop/coldBuildIndependence: source-specific health/timestamps, stale native rows, cold build cannot hold core.
- helperComposition/nestedHelperGrouping/deepHelperOwnership/cappedHelperOwnership: actual transcripts/helpers, nested grouping, root/ancestor ownership, eight visual slots and 64 binding cap.
- exactTargetInspection/footerInspection/footerFinalValidationRace/footerConfigurationRace/stalledFooterEndpoint/footerAncestryProofSet: stale/invalid expected identity rejection before content reads, same-pane races, endpoint suppression/socket close/retry, proof-set and final-await races.
- usageAggregate/aggregateAgeAndOverflow/aggregateOptionalEvidence/claudeHelperNamespaces/aggregateHostOwnership: conflict, host namespace, helper namespace, overflow, per-counter partial coverage/freshness.
- identityEnrichmentOrdering/refreshStartCache/pollingFreshness: identity proof before enrichment, duplicate-ID rejection before adapters, genuine serial fallbacks, zero-start cache and healthy polling with pending enrichment.
- progressivePublication/progressiveOwnership/progressiveOptionalFreshness/boundedWarmup/queuedWarmOwnership/progressiveClose/helperFailureTruthfulness/progressiveGrouping/optionalToolObservationFallback/overseerRoles: progressive core, immutable snapshots, stale owner rejection, warm bounds/queue revocation, bounded close/timer unref/cleanup, failed helper binding removal, current grouping, fallback read-start timestamp and endpoint-matched overseer role privacy.

Real transcript/helper/identity/overseer collaborators remain real against synthetic files/RPCs. Native compile fixtures remain permitted. No actual Herdr inventory, desktop enumeration, private transcript/DB/config read, SSH or controls.

Pending coordinating suites: controller supplies accepted sidecar/observer.warm-transcripts.test.js from 4c and sidecar/observer.identity-process.test.js from 4d-L; port to adjacent strict TS with their actual accepted producer contracts.

Material existing cross-owner test boundary: pollingFreshness (old lines2323–2574) uses actual frontend/app/queryspine.fixture.js/loadQuerySpine. This fixture is JavaScript until browser migration. Need controller disposition for preserving this exact real collaborator while satisfying requested strict TS observer suite; do not fabricate browser API/ambient shims or replace it with a mock. A narrow JS integration handoff, as already used by 4d-L for browser-model, is possible only with controller authorization. No shared contract change requested yet.

New verification should target distinct uncovered migration risks only: source/emitted factory execution from external cwd under complete synthetic adapters; malformed inventory shape/member validation before side effects if existing scenarios do not prove the new unknown-input boundary. Existing emitted SQLite and Swift tests remain producer-owned and must run unchanged as required. Existing behavioral oracles suffice for pure algorithm moves; no parallel replacement test harness or implementation-mirroring assertions justified.

## Exact future controller caller patch requests

After new owner exists and passes its first focused checks, controller should change these CJS source callers (not before):

1. server.js: require('./sidecar/observer.js') -> require('./src/sidecar/observer/index.ts').
2. scripts/stream.js: require('../sidecar/observer.js') -> require('../src/sidecar/observer/index.ts').
3. sidecar/observer-remotes.js: require('./observer.js') for aggregateRows -> require('../src/sidecar/observer/index.ts'); preserve aggregateRows public export even if implementation lives in aggregation.ts.
4. sidecar/control.test.js: require('./observer.js') -> require('../src/sidecar/observer/index.ts').
5. frontend/app/observer-inspector.test.js: require('../../sidecar/observer.js') -> require('../../src/sidecar/observer/index.ts').

Owned relocated suites will update their own imports to ./index.js and accepted sibling producer paths. Old transcript/identity test references found in this baseline belong to pending accepted package handoffs; re-scan refreshed tree before issuing deletion request. Do not patch frontend/app/observer.js or HTML: those are distinct browser owners despite same basename.

Runtime config presently includes new owner automatically. Scanner registry/build changes are controller-owned only if fresh diagnostics identify them; no speculative requested changes. No shared public types patch currently established. If real accepted producer contracts expose a mismatch, report exact source/type/runtime evidence before changing any shared contract.

## Dead-code audit evidence

Mode: audit only. Baseline/diff: unchanged 6599db5. Checked observer source, named scenario/caller references, shared observer/inspection contracts and existing adapter signatures in assigned checkout. Excluded mutable producer checkouts, private/live sources and implementation edits.

Old sidecar/observer.js is supported/reachable from server, remote stream, remotes aggregate, controls test, frontend inspector integration and existing identity/transcript coordination. Exports makeObserver/aggregateRows/lastActivity are used behavior contracts. No deletion allowed now. Future old-owner deletion becomes confirmed only after replacement and all caller patches. Old observer.test.js is supported characterization, to be ported rather than dropped. Warmup/lifecycle functions and dynamic native/worker paths are reachable through real factories; no scan-only deletion candidates accepted.

Proposed cleanup after GO: remove old observer.js and old migrated suites only after exact caller-switch verification; retain producer worker/Swift assets and unrelated frontend observer. Remove obsolete private helpers/imports created by actual split only with final scoped reachability evidence. No removals performed. Scope audit is sufficient for preparation; final cleanup remains required after migration.

## Verification executed

- git rev-parse HEAD: 6599db57b79f9e178b4157927418ef0c788812cc. Initial git status --short: empty.
- bun --no-env-file test sidecar/observer.test.js: exit0, 1 pass, 0 fail, 1.86s. Synthetic stalled socket expected failopen logs; one timed-out request, socket closed, retry recovered. This proves unchanged baseline characterization only.
- rg reference scan identified exact caller list above. One exploratory combined scan exited2 because .github does not exist; subsequent file inventory identified .fallowrc.json/knip.json and actual tools registry. No source mutation.
- Strict root/runtime/tools checks, owned strict lint/scanners, emitted observer/external-cwd proof and cross-package full suite not run: implementation and accepted prerequisites not yet supplied. Earlier package reports are context only, not fresh completion evidence.

## Next controller action

Provide clean frozen integration SHA containing accepted 4c then 4d-L, both coordinating suites and explicit GO. Resolve real queryspine coordinating-test disposition. Then this worker re-reads final producer-owned contracts and verifies clean baseline before editing. Stop after preparation until followup.

## Implementation checkpoint 1 (GO c8e3379)

Controller refreshed assigned checkout to c8e3379ad654b1a2225e417736e9581442ddfa13 and authorized implementation. Accepted producer contracts re-read from this checkout. Controller resolved queryspine: exact real pollingFreshness case may live in adjacent queryspine.integration.test.js until I5 typed browser API. Root applied the five requested external caller replacements; those caller files join final review scope.

New observer production split now compiles under unchanged strict runtime compiler. Original three coordinating suites executed against typed owner: 3 pass, 0 fail (2.13s), including actual warm transcript projection and owned exited-PID/libproc boundary. No live Herdr inventory/native enumeration/private transcript/database/config used. Old production retained pending final reachability and suite port.

Current implementation uses honest HelperRow-derived optional rows, producer Snapshot/ChildInspection and identity proof types. Root approved source:string injected identity compatibility and complete non-oracle bus fixture defaults; producer contracts unchanged. Strong unknown inventory parsing precedes identity/enrichment. Stateless domain controllers share private observer state with coherent inventory/publication/enrichment/warmup/refresh/snapshot/lifecycle responsibilities. No casts to trust boundary input; const assertions only preserve literal tuples.

Typed primary suite port is ongoing: original assertions retained; explicit runtime fixture prerequisites narrow optional rows and gates. Real queryspine case extracted without mocking. Production lint convergence and strict test diagnostics remain open; no completion claim. Inspection revalidation/capture, sparse adapters and close/pending identity traced against old owner during initial implementation. Initial helper construction briefly rejected sparse injected transcripts too early; original regression caught it, corrected to lazy method admission, then original three suites passed. No weakening or suppression introduced.

## STOP / MACHINE HANDOVER — authoritative current checkpoint

User stopped implementation to move machines. No further implementation, fixes, test runs, commits or branch changes authorized by this handover. Status remains NEEDS_CONTEXT / PARTIAL, not DONE. Preserve the working tree and index exactly; root will snapshot/push WIP. Explicit stop received after primary typed suite and both coordinating suite ports, before lint convergence, cleanup, emitted proof, full-suite validation or independent review.

Checkout remains /Users/davidfava/Projects/Personal/starnet-observer-typescript-4d-observer at c8e3379ad654b1a2225e417736e9581442ddfa13 on assigned branch. `git diff --cached --stat` empty. No source files removed. Legacy sidecar/observer.js remains unchanged/reachable only through remaining legacy test references; do not delete until fresh reference audit. Three old JS suites remain as deliberate temporary duplicates while new typed counterparts are being validated. They now import typed observer; final cleanup must remove old duplicate suites after all oracles are proven retained.

### Exact current changed tracked files

Controller-owned mechanical caller changes (one import replacement each, controller applied):
- server.js: ./sidecar/observer.js -> ./src/sidecar/observer/index.ts.
- scripts/stream.js: ../sidecar/observer.js -> ../src/sidecar/observer/index.ts.
- sidecar/observer-remotes.js: ./observer.js -> ../src/sidecar/observer/index.ts for aggregateRows.
- sidecar/control.test.js: ./observer.js -> ../src/sidecar/observer/index.ts.
- frontend/app/observer-inspector.test.js: ../../sidecar/observer.js -> ../../src/sidecar/observer/index.ts.

Worker-owned temporary old-suite imports:
- sidecar/observer.test.js: makeObserver/aggregateRows and lastActivity now require ../src/sidecar/observer/index.ts (two replacements).
- sidecar/observer.warm-transcripts.test.js: observer require now ../src/sidecar/observer/index.ts.
- sidecar/observer.identity-process.test.js: observer require now ../src/sidecar/observer/index.ts.

Tracked diff currently 8 files, 9 insertions/9 deletions. All substantive new code remains untracked under src/sidecar/observer/ and must be included in root's WIP snapshot.

### Exact current new files (23)

src/sidecar/observer/aggregation.ts
src/sidecar/observer/contracts.ts
src/sidecar/observer/counters.ts
src/sidecar/observer/enrichment.ts
src/sidecar/observer/evidence.ts
src/sidecar/observer/identity-process.test.ts
src/sidecar/observer/index.test.ts
src/sidecar/observer/index.ts
src/sidecar/observer/inspection-proof.ts
src/sidecar/observer/inspection.ts
src/sidecar/observer/inventory.ts
src/sidecar/observer/lifecycle.ts
src/sidecar/observer/lineage.ts
src/sidecar/observer/ownership.ts
src/sidecar/observer/publication.ts
src/sidecar/observer/queryspine.integration.test.js
src/sidecar/observer/refresh.ts
src/sidecar/observer/required.ts
src/sidecar/observer/snapshot.ts
src/sidecar/observer/state.ts
src/sidecar/observer/testing.fixture.ts
src/sidecar/observer/warm-transcripts.test.ts
src/sidecar/observer/warmup.ts

Production structure: State stores observer-private state and constructs stateless cohesive InventoryReader, Publisher, Enrichment, Warmup, Refresh, Snapshots and Lifecycle objects. Evidence/counters/aggregation, owner proof and inspection selection are separate. Controller objects share one observer state; no generic framework or alternate producer implementation. Several methods still violate strict complexity/line/encapsulation policy and need real refinement. Temporary `required` helper throws for absent internal queued/roster work; it is not a cast or unknown-input validator. Public/injected rows remain honestly HelperRow-derived; public inferred snapshots do not claim complete shared ObserverRow. Genuine injected identity source:string and partial project method returns supported.

### Latest actual checks and results

1. `bunx tsc -p tsconfig.runtime.json --noEmit`: passed during production split, then root strict `bunx tsc -p tsconfig.json --noEmit` also passed after all typed suite fixes. Latest /tmp/starnet-observer-test-types.log is empty. Last combined compiler/test command (session15646) was `bunx tsc -p tsconfig.json --noEmit; bun --no-env-file test src/sidecar/observer`; compiler emitted no diagnostics, tests completed exit0.
2. Latest owned suite run: `bun --no-env-file test src/sidecar/observer`: 4 pass, 0 fail, 4 files, 2.08s. Primary characterization, actual warm transcript projection, exact real queryspine integration and actual owned exited-PID/libproc coordination all passed. Expected failopen socket-race logs and one timed-out native fixture request appeared; recovered/closed assertions passed. This is focused behavior evidence, not full Task4 acceptance.
3. Earlier typed owner versus original three JS suites: 3 pass, 0 fail, 2.13s. Initial default helper construction eager rejection was caught and corrected to lazy method admission. Later typed fixture presence-only failure (0 rows instead of 10) came from fixture nativeSession assertion wrongly requiring string; corrected fixture to permit null and all four suites passed.
4. Explicit formatting command run: `bunx prettier --write src/sidecar/observer`. Explicit ESLint autofix command run: `PATH=/Users/davidfava/.local/share/starnet-quality-tools/node-v24.19.0-darwin-arm64/bin:$PATH bunx eslint src/sidecar/observer --fix`. Lint did not pass: last saved /tmp/starnet-observer-lint.log reports 348 errors. The shell tool invocation exited0 because it printed the log afterward; ESLint itself failed. No config/strict-rule changes/suppressions introduced.
5. After that lint output, an explicit fixture transform replaced async functions with no await by a synchronous `settled` fixture helper preserving immediate body execution and Promise rejection semantics; queryspine's optional Harness global is now bound from globalThis. Compiler and focused four-suite run passed after those changes. Lint/format were NOT rerun afterward. Therefore last 348-error inventory is stale for the addressed async/no-undef cases and remains a useful lead, never a current count. Current new settled call formatting is visibly unfinished.
6. No full repo test, build:runtime, strict tools project, emitted observer external-cwd smoke, recursive emitted closure audit, final SQLite/Swift checks, final scanners, assertion-AST preservation audit or self-review completed for this package. Reuse earlier accepted package evidence only where unchanged; composition-specific emitted proof must be fresh.
7. Last handover-only commands: git status/diff/name inventory; cached diff empty; HEAD confirmed; read existing logs; process inventory showed no observer build/test/transform processes, only the handover command and its rg. Session15646 was already finished, returned complete test result/exit0 when polled with interrupt. No remaining owned jobs/writers. Do not start new checks until user resumes implementation.

### Remaining diagnostic inventory / known issues

Last lint inventory by rule (before later async/global fixture fixes): complexity8; eqeqeq2; policy literals12; commented-code heuristic10; restrict-plus-operands37; unused-expressions2; require-await167; unnecessary-condition12; cognitive-complexity2; unsafe-call5; unsafe-member-access11; boolean-flag17; max-depth7; prefer-const1; unsafe-assignment3; unsafe-argument2; train-wrecks33; confusing-void1; floating-promises2; reject-errors1; unused-vars2; no-base-to-string1; control-regex1; output-argument-mutation3; no-undef2; max-lines-per-function1; type-import-style3. Exact diagnostics/log line numbers are in /tmp/starnet-observer-lint.log; new line numbers may differ after settled transform.

Production unresolved specifics:
- counters.add complexity14: separate existing validated-counter check and accumulation; preserve invalid/negative/safe integer/partial/overflow semantics. Replace !=null with explicit null/undefined condition.
- evidence.identity complexity13 and nullable string concatenation. Split proven helper/session identity tests; preserve host identity and helper opaque namespace. lastActivity comment triggers heuristic; minimal punctuation reword allowed, meaning must remain.
- index.dependencies complexity14: separate genuine adapter construction responsibilities. executeDefault callback ternary now sits as unused expression after ESLint autofix; rewrite explicit if/error rejection branch. Preserve guarded execute and no leaked error payload. IMPORTANT: inspectMessage closed branch currently spreads full `unavailable(...)` fields; original closed return was exactly `{id,health:'unavailable',reason:'unreadable',text:null}`. Restore original closed shape before completion; this was identified during WIP review, not fixed before STOP. Do not add absent-method success fallback to change behavior without justification.
- inspection.inspect complexity18: split selection/expected identity/roster acquisition from read/proof/project while retaining pre/post-await footer checks and final currentOwner after last asynchronous validation. `const {available,...projection}` is currently unused-variable lint. Nullable concatenation should use proven inspection identity / precise template conversion without enum coercion. Original private comments must retain security meaning. Expected identity bounds128 and ancestry64 deserve named existing-policy constants.
- inventory.title unknown String triggers no-base-to-string and its control regex triggers no-control-regex. Preserve legacy JSON title coercion exactly (including arrays/objects), title redaction and160 bound; do not String-coerce unknown enums. Named existing constants needed for24 digest length,3000 timeout and2MiB buffer. One deep state-source access remains.
- ownership.sameProof complexity16 and optional birth accesses now unnecessary under exact producer proof; split owner birth equality and retain contentRevision intentionally excluded. capture complexity11 and parameter reassignment: local traversal state rather than mutating row parameter; preserve 64/cycle/footer proof constraints.
- warmup.schedule complexity17: split eligibility, captured key and scheduling admission preserving count-before-capture semantics,32 bound,2 workers,60000 cache. expected identity nullable concatenation; optional birth proof fields; sweep.warmed mutation lint; literal true argument to inspect should use named preparation intent. Avoid changing queue scheduling or coalescing.
- lineage.valid complexity14 and mutating seen parameter; use clear traversal ownership while retaining owner-group and parent cycle checks. Multiple train-wreck diagnostics through this.lineage.result and this.state.sources; prefer real owning queries/cohesive captured resources, no aliases added solely to evade scanner. Publication class can retain constructor-proven result. Atomic commit comment preserved.
- lifecycle close deadline10000/unref, injected cleanup deep access and control health query lint. close promise identity and clear timer remain tested; preserve bounded in-flight wait and only original adapter cleanup.
- snapshot.snapshot 56 lines: extract row ageing/projection or bus projection at real responsibility, preserve optional timestamp behavior. Current `observedAt: observedAt??null` differs from original explicit undefined edge; inspect real/sparse caller behavior before final claim. Deep source access remains.
- enrichment remaining explicit null equality/policy4; producer method shapes preserved.

Test unresolved specifics:
- Preserve every original literal/value/Boolean oracle. No assertion audit yet; run TS AST assertion comparison against frozen old suites before deletion. Old suites still available, plus /tmp originals.
- Main suite uses typed `must` runtime assertions for optional fixture rows, explicit gate release/string/native-session checks, complete inspection/bus/usage/last fixture builders. Sparse usage filler counters are null, non-oracle bus fields explicit; root approved complete non-oracle bus fields and honest identity injection compatibility. Verify no intentionally sparse-output oracle was altered. Native transcript raw `usage:{input_tokens:tokens}` was restored (must not go through public usage fixture).
- Existing main suite fake maps still infer `any` through untyped new Map(); add precise key/value types from actual deferred/work entries. No any/cast suppression authorized. Some nested composedSummaryBound blocks exceed depth/cognitive limits; split existing distinct scenario work/helpers without losing gating/order oracles.
- Test async-no-await transform uses settled helper to keep asynchronous return while preserving immediate function body execution. This was compiler/test verified, but strict lint not refreshed. Do not replace with Promise.resolve().then that changes fixture ordering.
- Existing string+number fixture names and identifiers need precise string/template construction preserving values. Literal Boolean fixture helper arguments need descriptive existing scenario intent rather than generic YES/NO constants. Pending fixture helper functions need strict scanner/format cleanup; inline import() types in testing.fixture.ts must become type-only imports. Existing 1000 fixture timestamp should be named or place truly test-only mechanics in test-suffixed owner per established policy, not blanket exclusion.
- Timer close fixture now uses Object.defineProperty on globalThis.setTimeout with a precisely typed fixture callback, restores originals in finally, creates/clears owned real timer then overrides unref counter. Preserve every original10s deadline/unref/clear assertion. Current callback ternary in owned child exit handler is an unused-expression lint issue after autofix; explicit branch needed.
- Adjacent queryspine.integration.test.js is the controller-approved only JS handoff. Exact pollingFreshness function uses actual queryspine.fixture.js and typed observer; globalThis.Harness optional binding preserves legacy cleanup behavior. I5 ports it after accepted browser API. No mocks/ambient shims allowed.

### Precise resume sequence (after user resumes)

1. Read this STOP checkpoint, controller brief and actual saved WIP source; verify root's snapshot branch/HEAD and ownership. No replay of /tmp scripts blindly: source has evolved and generators would overwrite fixes. Reinstall frozen dependencies/tool versions only if needed, with no live inputs.
2. Resolve named production semantic differences first (inspectMessage closed shape; optional observedAt edge), then converge production strict lint through cohesive extraction and exact typed guards. Keep actual producer contracts immutable unless controller explicitly takes a concrete type conflict.
3. Refresh strict test lint to get current post-settled diagnostics; finish precise map/fixture typing, split only overdeep original scenarios, preserve comments and all original assertions. Format explicitly, then root/runtime/tools strict and focused four suites after final edits.
4. Perform original-to-migrated assertion/Boolean/oracle audit and real collaborator trace, not counts alone. Confirm extraction called exactly once, old duplicate no longer needed. Re-scan all old observer.js consumers including handoffs; coordinate additional caller changes with root. Only then remove owned old observer.js and three old JS suites. No compatibility wrapper.
5. Fresh full native suite, source/emitted external-cwd synthetic observer proof, build:runtime/recursive typed closure and owned lint/scanner/format. Reuse unchanged accepted worker/Swift evidence transparently; run required fresh cross-package composition and any affected emitted worker/native tests. Document root findings outside scope honestly.
6. Final per-step cleanup/reference audit and self-review; report all source and five controller callers. Stop edits for controller independent composition review. No worker commits/branch changes/GSD/FLOW edits.

### Temporary evidence/assets root should transfer

Authoritative handover: /tmp/starnet-ts-parallel-4d-observer-report.md. Brief: /tmp/starnet-ts-parallel-4d-observer-brief.md. Existing accepted producer reports remain referenced above. Latest logs: /tmp/starnet-observer-lint.log (stale348 diagnostics), /tmp/starnet-observer-test-types.log (empty), /tmp/starnet-observer-format.log. Backups: /tmp/starnet-observer-original.js and /tmp/starnet-observer-original.test.js from accepted frozen baseline (before port). Temporary transform scripts under /tmp/starnet-observer-*.{cjs,py} are disposable historical tools, not supported project files; do not rerun blindly or commit. WIP source is the authoritative implementation.
