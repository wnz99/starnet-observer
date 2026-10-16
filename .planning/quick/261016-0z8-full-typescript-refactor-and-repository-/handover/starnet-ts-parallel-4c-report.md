# Parallel 4c preparation report

Current status: DONE_WITH_CONCERNS. See the final bounded-package handoff at the end for authoritative implementation, verification and remaining repository-wide concerns. The preparation sections below are historical context.

## Scope and baseline

- Worktree: /Users/davidfava/Projects/Personal/starnet-observer-typescript-4c.
- Branch: wip/typescript-refactor-4c; inspected HEAD 7420c520547a012bc5bde8ca9f2fa93fe58227d2. Initial and final `git status --short` output empty.
- Ownership after GO: src/sidecar/inspector/** except frozen fields.ts; src/sidecar/transcripts/**; old sidecar/observer-{inspector,transcripts}.js and observer-transcripts.test.js; src/sidecar/helpers/{claims,index}.test.js migration to adjacent TS suites.
- Excluded: shared types, helper production contracts/source, root/config/build files, observer source/suite, browser source/suite, other worktrees, FLOW/GSD, branches/commits.
- Required task/dead-code/clean-code-JS/test-quality skills read from installed shared skills. Caveman style read. Actual resolved host model identity unavailable; controller-specified gpt-6.1-sol/medium cannot be independently verified here.
- Agent bus available; whoami and list executed. No messages sent through bus: controller task assignment provides ownership, and roster alone establishes no concrete additional conflict.

## Inspected sources and exact contracts

Current production JS: observer-inspector.js 576 lines; observer-transcripts.js 972 lines. Tests: transcript suite 1464 lines; helper claims 914 lines; helper index 919 lines. Existing frozen fields.ts and redaction.ts stay unchanged.

Inspector exports to preserve as named ESM exports from src/sidecar/inspector/index.ts: createProjection, consumeMetadata, consumeHelperMetadata, metadata, consume, snapshot, recordBelongsToSession. Runtime inputs from JSON become unknown and are narrowed through record/field validation; no unchecked parsed type assertions.

Projection owns generation; turns Map; per-message usage Map; Codex totals; model; helperCalls/helperSpawns/helperEvents Maps; helperClaimsPartial; ownTask; startedAt/lastActivityAt/lastEntryAt; truncated/bounded/usagePartial/modelPartial. Helper map capacity is 512, with call/spawn eviction marking incomplete claims; event eviction must not falsely restore stale evidence. Spawn values may be null (ambiguous), not merely absent. Usage streaming observations merge per message using maxima, never sum duplicates. Complete/partial numeric fields retain existing semantics.

Inspector snapshot is a direct projection, specifically Pick<SessionInspection, "health" | "reason" | "stats" | "turns" | "truncated" | "window" | "generation">. It does not supply id/asOf/provenance: observer inspection adds those after final identity proof. No new wire fields are needed. Frozen fields.ts owns read/output limits and redaction-before-clipping.

Transcript factory requires injected now at runtime and preserves the runtime missing-clock TypeError. Options roots permits provider subsets; an explicitly supplied subset must not fill the absent provider from real home. Its injected fs contract needs only readdir(withFileTypes), realpath, lstat, open; opened handle needs stat/read/close. Use this minimal structural interface so synthetic close/read/race wrappers need not pretend to be full FileHandle instances.

Factory exports: beginDiscovery(), read(id, provider, sessionId, detailed=false, binding?), inspect(id, provider, sessionId), retain(Set<string>), bindChild(provider, sessionId, parentSessionId, candidate?, spawn?), claudeCandidates(parentSessionId, parentBinding, parentId), claudeClaims(id), inspectChild(id,binding), spawnIndexIdle(), helperMetadata(id). `read` false returns {available:false}; light success includes available/last/usage/lastEntryAt; detail success includes available and direct inspector snapshot. Preserve exact caller shape with detail overloads or equivalent typed methods. Bindings require identity in WeakSet; caller-shaped objects cannot authorize child reads.

Security and lifecycle invariants traced:
- Complete canonical identity rows required in bounded header; tails cannot establish identity. Contradictory headers/tails revoke results. Snake-case Claude transport ID is not canonical disk session ID.
- Readdir depth 4/50000 visited cap; duplicate UUID filenames ambiguous. Discovery generations and forced-fresh scans serialize against prior scans and reject superseded work.
- Root/path containment, symlink component checks, O_NOFOLLOW, dev/inode/mode identity, size/mtime/ctime consistency checked before and after reads; restored pathname cannot conceal an already-opened outside descriptor.
- Bounded prefix/tail and full retained-window validation detect same-inode rewrites, even with preserved header/end bytes. Cache reads still validate identity. Detailed capacity 32 with 60000ms expiration; no extra response cache.
- Spawn index whole-stream limit 128MiB, 1MiB chunks, row bound 256KiB, complete previous-prefix hash before append reuse. Cold index asynchronous; warm proof awaited. Index authoritative over stale header, including absence, ambiguity, partial/unavailable evidence. Maximum 64 tracked indices; all-busy capacity never detaches pending tasks; idle shutdown hook sees pending scans. Retain expires only settled indices older than 10 minutes.
- Claude meta sidecar <=16384 bytes; only ENOENT means absent corroboration and permits fallback. Wrong toolUseId/parentAgentId, malformed or replaced sidecar reject.
- Child private proof recursively checks ancestry, immediate-parent conflict, current claim completeness and corroboration before and after detailed read. Depth/cycle bound remains 3.
- Light result excludes conversation bodies; detail redaction handles nested credential objects and quoted multiword values before clipping. Handle-close failure emits sanitized failopen reason without changing valid projection.

## Proposed owned module split

Keep inspector/index.ts as actual exported projection API with small domain modules for provider metadata/helper events/conversation consumption; shared internal contracts belong under inspector, not duplicated in transcripts. Keep transcript/index.ts as factory API and split path/resource verification, discovery indices, spawn indexing/claims, child binding/proof, and bounded read projection where cohesive state ownership permits. Names finalized against strict lint limits after GO. No compatibility wrappers, copied JS modules, scanner pseudo-entrypoints, or new wire shape.

## Exact controller patch requests

1. Consumer imports after old JS removal:
   - sidecar/observer.js:8 `require("./observer-transcripts.js")` to `require("../src/sidecar/transcripts/index.ts")` until controller migrates observer itself.
   - sidecar/observer.test.js:638,794,873,1593,2053 same replacement.
   - frontend/app/observer-inspector.test.js:1183 backend `require("../../sidecar/observer-inspector.js")` to `require("../../src/sidecar/inspector/index.ts")` until browser suite migration. Browser behavior unchanged.
   - Owned helper suites and moved transcript suite update their imports locally to ESM `.js` specifiers resolving TS siblings under Bun.
2. src/sidecar/helpers/contracts.ts: current ChildInspection has `available:boolean`, optional `inspection?: SessionInspection`, usage/lastEntryAt/last; runtime inspector snapshot fields are direct, not nested under `inspection`. It does not currently require a full SessionInspection (earlier commentary shorthand was imprecise). For typed helper tests and later observer closure, model direct detailed-result fields. Suggested shared shape: export an inspector snapshot type as Pick<SessionInspection,...above>; ChildInspection success intersects `{available:true}` with that snapshot, false variant `{available:false}`. If supported helper test doubles need partial success, explicitly model that actual contract rather than fabricate fields. No runtime output change.
3. Helper contracts duplicated Spawn/HelperProjection and ChildBinding currently use a reduced helper projection. Prefer importing exported domain-owned structural types from the new inspector contracts (type-only). Exact exported names and patch will be supplied with implementation. In particular ChildBinding.projection supplied back to transcript internals must retain full inspector projection when reusing helper-facing binding values; no cast can recover omitted state. If controller prefers retaining reduced helper contracts, transcript's internal WeakSet proof must pair bindings to full private state through an internal WeakMap instead. Controller decision requested before implementation to avoid inventing a second source of truth.
4. Transcript suite `observerWarmReuse` lines1173-1302 and call519 depends on legacy observer.js. Controller owns observer and its suite. Move this exact synthetic integration case intact into observer.test.js/its forthcoming TS suite, or provide a typed observer import before owned strict migration. It proves actual warm demand deduplication, two validation reads on cached click, expiry cold read, replacement and deletion revocation. No assertion removal or untyped import escape. Remaining transcript suite becomes closed within typed domain/helper roots.
5. Existing default TS config includes all .ts and runtime includes src/sidecar/**/*.ts with tests excluded. No new config exemption required for owned domains; controller owns any temporary narrow proof tsconfig used to isolate frozen prerequisites. Existing knip/fallow test globs already reach migrated adjacent suites; no fake standalone entries needed.

## Test ownership and coverage

Owned transcript suite moves beside transcript factory with all existing assertions. Keep low-level identity/projection assertions currently in nativeHelperProjection close to inspector via an adjacent inspector suite if extraction improves ownership; preserve hand-grounded expected stats/start time and helper native envelope cases. Existing browser backend canonical-disk-identity block stays controller-owned during this leaf.

Owned helper suites remain adjacent and become strict TS. Replace Object.create(fs)/Proxy dynamic wrappers with typed minimal resource wrappers preserving actual delayed index reads, injected read/open races, close-failure behavior and byte accounting. Synthetic fixture records remain explicit; unknown JSON shape checked where test reads it; no any/casts/suppressions. Row fixtures should satisfy HelperRow/Root without adding unrelated required fields. Existing Bun SQLite fixture retains real WAL/private-copy assertions, close behavior and source-path rejection.

Reused tests protect split UTF-8/partial rows, dedupe, truncation/redaction, rewrite/rename, sidechain filtering, source jail, exact child identity, fresh scan/cancellation/retry, warm projection budget, path races, bounded disk reads, native helper metadata, task/lifecycle evidence, spawn conflicts, ambiguous ancestors, delayed cold proof, partial/unavailable claims, index saturation and cleanup. No extra tests merely mirroring helper existence planned. Add focused assertions only when strict boundary migration exposes an otherwise untested material failure.

## Verification executed during preparation

`bun --no-env-file test sidecar/observer-transcripts.test.js src/sidecar/helpers/claims.test.js src/sidecar/helpers/index.test.js`

Result: 3 pass, 0 fail, 3 files, 1461ms. Synthetic temporary fixture roots only. No live home/agent/native inventory/provider turns/SSH/control used.

Other read-only commands: git rev-parse HEAD; git status --short; rg --files; focused rg consumer/reference scans; source/config/test reads. No type/lint/build completion claim: code not migrated.

## Dead-code audit evidence

Mode: audit only, explicitly authorized read-only preparation. Scope: old inspector/transcript source, transcript/helper suites, direct consumers and scanner config references at 7420c52. No removals made.

- observer-inspector.js supported/reachable through observer-transcripts.js and browser backend characterization. Proposed obsolete only after new inspector implementation and both consumers update.
- observer-transcripts.js supported/reachable through observer.js, observer tests, helper suites, transcript suite. Proposed obsolete only after new transcript factory, all imports and controller consumer patches land.
- Old transcript/helper JS suites become obsolete after adjacent TS ports retain their assertions. No test deletion justified by file moves alone.
- Frozen inspector fields/redaction retained: supported code with direct consumers and privacy policy ownership.
- spawnIndexIdle, beginDiscovery, retain and WeakSet binding checks retained: explicit shutdown/discovery/privacy APIs, not removable on sparse static callers.
- No native/worker lifecycle code owned or removed by this leaf.

Per preparation step no-code-impact disposition: source/type contract inventory changed no repository files; test inventory reused existing assertions and changed no discovery; baseline run exercised fixture lifecycle only. Final-reference removal check belongs after implementation/controller integration. Audit complete for identified direct consumers; cleanup and emission closure remain unverified pending GO and coordinated patches.

## Remaining prerequisites

Controller GO plus frozen prerequisite SHA; decision on helper-facing versus inspector-owned binding/projection types; controller ownership of warm integration case relocation. No repository edits, commits, branch switches, FLOW/GSD changes or delegation performed.

## Implementation checkpoint (GO received, 357b45b)

Controller GO received and frozen prerequisite verified: 357b45bdd8d49501d8bdf3c54e000085dfa3ecc0. New inspector/transcript producer modules and adjacent TS test ports exist. Controller applied helper type imports and outside caller wiring in this checkout. No commits or branch changes.

Authoritative producer types: src/sidecar/inspector/contracts.ts exports Provider, Turn, Snapshot, TaskEvent, Assignment, Spawn, ChildBinding, UsageKey, Totals, Projection, SessionContext, ConsumeOptions, ChildInspection. Snapshot has direct inspection projection fields, no observer-added id/asOf/provenance. ChildInspection is false variant or true plus Snapshot. ChildBinding.projection is full Projection. src/sidecar/transcripts/contracts.ts exports narrow TranscriptIO/TranscriptHandle, ReadState/ReadContext, LightSuccess/LightResult/ReadResult, options, candidates/claims. Reader overloads preserve summary versus detail response shapes.

Runtime production typecheck passed after initial producer implementation. Three new TS suites plus relocated coordinating JS suite initially passed when transpiled. Later strict fixture guard insertion exposed an overstrict assertion helper in the existing unavailable/no-entry-time scenario; correction pending. This is a test-port issue: original unavailable return is expected to have no lastEntryAt, not a successful metadata result.

`bunx tsc -p tsconfig.json --noEmit` currently passes. Owned strict ESLint currently reports 212 findings. Main categories: existing Boolean expected values passed positionally to assert.equal (quality rule sees policy flags), existing comments misidentified as commented code, intended mutable parser state currently passed as output arguments, function complexity, explicit named policy constants, and typed fixture collection/gate details. No suppression or config exemptions added. Next: preserve test expectations while correcting result guards, type fixture Maps, then make state ownership explicit and reduce complexity within domain modules; run final strict lint/types/tests/scanners after cleanup. Legacy production and old JS suites remain until new ports are ready; controller wiring has made their removal authorized and reachable consumers are updated.

Warm integration case copied verbatim into exclusive sidecar/observer.warm-transcripts.test.js and remains an awaited registered synthetic test with root cleanup; no observer production/test edits by this leaf. Other controller-owned edits remain intact.

### Implementation checkpoint: strict fixture ports and stateful parsers

All four owned/relocated synthetic suites pass again (4 pass, 0 fail; latest run 1.63s). Full TS typecheck passes after explicit nullable/result checks and typed narrow I/O wrappers. Controller authorized minimal explanatory-comment rewording that preserves technical detail; no comments are deleted or shortened to hide a finding. Parser responsibilities now have explicit mutable owners: metadata/conversation consumers, per-window consumers, tracked spawn scans, directory scans and ancestry proof instances. Binding WeakSet identity remains authoritative; no WeakMap workaround was added. Public positional APIs retain signatures through typed tuple arguments; internal resource/fresh-discovery flags use named options. New test helper expectBoolean preserves exact original boolean comparisons with explicit actual/expected options rather than truthiness assertions. Existing tests remain synthetic and no live paths were read. Remaining work: final quality diagnostics, production/reference cleanup, whole-suite and emitted closure/scanner checks, report/self-review.

## Final bounded-package handoff

Status: DONE_WITH_CONCERNS. Approved 4c implementation, cleanup, self-review and fresh bounded verification are complete. Concerns are repository-wide quality findings outside 4c; no owned requirement or correctness concern remains. Independent review and integration remain controller responsibilities. This is not completion of Task 4 or the repository migration.

### Final scope and files

Baseline remains frozen 357b45bdd8d49501d8bdf3c54e000085dfa3ecc0; no commits, branch switches, worktree changes, delegation, FLOW/GSD writes or root/config/dependency changes were made by this worker.

New inspector production: contracts.ts, values.ts, identity.ts, helper-state.ts, claude-helpers.ts, codex-helpers.ts, metadata.ts, tool-kind.ts, conversation.ts and index.ts under src/sidecar/inspector/. Frozen fields.ts and redaction.ts are byte-identical to HEAD (fields hash dbeb8d5449d766058e900bff706935ebeb68ba17; redaction hash a93344b0a71524fa1697a147136122c8ead29e20).

New transcript production: contracts.ts, resources.ts, discovery.ts, identity.ts, tools.ts, windows.ts, reader.ts, binding.ts, spawn-index.ts, claims.ts, children.ts and index.ts under src/sidecar/transcripts/. Adjacent index.test.ts and testing.fixture.ts provide strict synthetic characterization and narrow I/O fixtures. Helper claims.test.ts and index.test.ts replace their adjacent JS suites.

New exclusive coordinating test: sidecar/observer.warm-transcripts.test.js retains the original observerWarmReuse case, its exact assertions and awaited cleanup; controller 4d-O owns its later TS migration. The old transcript-suite copy is removed.

Removed replaced files: sidecar/observer-inspector.js, sidecar/observer-transcripts.js, sidecar/observer-transcripts.test.js, src/sidecar/helpers/claims.test.js and src/sidecar/helpers/index.test.js. No compatibility wrapper remains.

Controller-applied files included in this package: src/sidecar/helpers/contracts.ts imports authoritative producer types; sidecar/observer.js changes one transcript import; sidecar/observer.test.js changes five transcript imports; frontend/app/observer-inspector.test.js changes its one backend import. These edits were preserved intact. Frontend's own ./observer-inspector.js consumer remains intentional and unchanged.

### Final interfaces

- Existing inspector export names and positional signatures remain; typed tuple arguments preserve established calling conventions. JSON/native inputs remain unknown until object/scalar checks prove consumed fields. Projection is the sole authoritative state shape; helper consumers import it type-only.
- Helper ChildInspection models the actual false variant or true plus direct Snapshot fields, not a nested inspection field. Observer still adds id/asOf/provenance. No new transport fields were introduced.
- Transcript factory still requires an injected clock at runtime. Explicit provider root subsets stay subsets. Read overloads distinguish light metadata from detailed projection; fabricated bindings remain rejected by the actual WeakSet proof.
- Children now consumes the actual spawnProjection callback rather than the whole index lifecycle owner. SpawnIndices still owns capacity, pending tracking, retention and shutdown settling. This narrowed dependency also makes the real scanner call trace explicit; no fake entrypoint or suppression was added.
- Narrow TranscriptIO/TranscriptHandle models only the operations actually used. Test wrappers forward real stat/read/close operations, preserve injected delay/race/error behavior and no longer rely on untyped Object.create/Proxy forwarding.

### Requirement coverage and self-review

All required privacy, exact identity, redaction, provenance, helper corroboration, ambiguity, ancestry, complete-prefix hash proof, bounded tail/disk/output budgets, cache invalidation, shared discovery, pending deduplication, capacity and settled-scan retention behavior is preserved and exercised by the existing characterization suites. Every original assertion remains, with explicit typed result/presence guards and exact boolean assertions. Large test loops were named and extracted without changing their order or fixture state.

Self-review caught and corrected two port regressions before handoff: an envelope lacking its actual message/payload could incorrectly supply activity metadata, and binding freshness could be captured before asynchronous validation completed. Existing idle-entry evidence now covers the malformed conversation envelope. A focused synthetic test asserts post-validation binding freshness. Both tests were independently exercised against realistic mutations in a disposable copy of emitted runtime; both mutations failed for the intended assertions. No defects or fixture state were placed in the worktree.

No private/local agent inventories, real home data, native window inventories, provider turns, SSH streams or control operations were run. Fixture HTTP/SQLite/native lifecycle cases in the existing full suite use synthetic data. No paid/live runs occurred. Generated runtime and all disposable verification/mutation fixtures are owned build/temp artifacts only; disposable fixture directories were removed.

No documentation changes were needed: searches found no documentation consumer of the replaced backend filenames. Existing MIT/NOTICE and local tooling are unchanged. Minimal migrated-comment rewording was explicitly authorized by the controller and preserves all technical/security details.

### Fresh final verification

After the last source changes:

- `bun run typecheck`: PASS, all four configured projects (root/runtime/browser/tools); exit 0 before the separately failing repository lint stage.
- `bunx tsc -p tsconfig.json --noEmit` and `bunx tsc -p tsconfig.runtime.json --noEmit`: PASS.
- `bunx eslint src/sidecar/inspector src/sidecar/transcripts src/sidecar/helpers/claims.test.ts src/sidecar/helpers/index.test.ts src/sidecar/helpers/contracts.ts sidecar/observer.warm-transcripts.test.js --max-warnings 0`: PASS, zero findings.
- `bunx prettier --check` over those domains/tests plus all controller-modified caller files: PASS, all matched files use Prettier style.
- `git diff --check`: PASS.
- `bun run build:runtime`: PASS, real unbundled compiler output.
- `bun run test`: PASS, 61 tests across 48 files, 0 failures, 39 expect() calls, 51.15s. Log: /tmp/4c-full-tests-final.txt.
- `bun --no-env-file /tmp/verify-4c-emitted.mjs`: PASS. The three owned typed transcript/helper suites run against actual emitted production modules: 4 tests, 0 failures, 1413ms. Recursive import audit: 32 emitted JS application modules; zero legacy/source TS application imports. Log: /tmp/4c-emitted-final.txt. The only reused source fixture contains test assertions/helpers and type-only imports, not application logic.
- `bun --no-env-file /tmp/4c-mutation-proof.mjs`: PASS. Missing-message activity fabrication and pre-I/O binding freshness mutations each fail their specific expected assertion in disposable emitted copies; temp state removed.
- Final old-reference search finds only frontend's own supported inspector module; no backend consumer references the removed JS modules. Frozen-field/redaction hashes match HEAD.

### Dead-code cleanup evidence, by step

Mode: authorized cleanup after the controller GO, bounded to owned files and controller-applied consumer edits. Baseline and exclusions above apply.

1. Characterization/preparation: original modules and five direct outside consumer imports plus one backend browser consumer were traced. Existing baseline synthetic tests passed. No source change in the initial audit.
2. Producer migration: inspector/transcript responsibilities moved to strict ESM modules. Actual type contracts replace duplicated helper shapes. All original public factory/export names remain reachable; intentional discovery/idle/private binding APIs retained.
3. Test migration/relocation: adjacent TS suites replace old JS suites with all original assertions; the observer integration case moves intact into its authorized exclusive coordinating file. Removed only the obsolete duplicate copies. Added two meaningful boundary regression oracles; no implementation-existence tests.
4. Consumer integration/removal: controller updated every outside backend consumer before old production deletion. New helpers/transcript suite imports point to typed modules. Subsequent reference search and full/emitted suites prove replacement reachability.
5. Scanner cleanup: internal-only USAGE_KEYS, fixtureRecord and ToolState no longer export. The unnecessary addBinding forwarding method is removed in favor of the actual WeakSet operation. Spawn indexing dependency is narrowed to the production projection callback. No scanner registrations, suppressions, fake entrypoints or allowances were added.
6. Final verification: owned source has zero Knip/Fallow findings and no owned duplicate group. Intentional WeakSet, pending/background scan ownership, spawnIndexIdle and frozen field/redaction contracts remain supported by concrete runtime/test consumers. No owned unresolved candidate or missing reachability evidence remains.

### Repository-wide concerns (outside 4c)

- `bun run lint`: FAIL, 244 existing/out-of-scope diagnostics in remaining browser/legacy sidecar files and tools/acceptance.ts. The controller-owned observer caller files alone retain 9 diagnostics unrelated to their import-only patches. Owned production/tests and the new coordinating JS suite are clean. No out-of-scope code was edited to mask these findings.
- `bunx knip --no-progress --no-config-hints`: exit 1; 6 remaining unused exports outside 4c: loadQuerySpine (frontend/app/queryspine.fixture.js), FOLDER/quote/remoteEndpoint (sidecar/control.js), CONTROL_FRESH_MS/FRESH_MS (sidecar/observer-remotes.js). Log: /tmp/4c-knip-final.txt.
- `bunx fallow dead-code`: exit 1; only the three sidecar/control.js exports above remain. No owned unused class/export/duplicate-export finding. Log: /tmp/4c-fallow-dead-final.txt.
- `bunx fallow dupes`: exit 0; 6 existing clone groups, 105 duplicated lines (0.4%), across 10 out-of-scope files. No 4c file appears. Log: /tmp/4c-fallow-dupes-final.txt.

These are explicit handoff concerns for remaining migration/integration work, not hidden passing global gates. No further 4c patch request remains. Controller independent review is required before task/package acceptance.

Additional final check: `bun run check:format` over the entire repository PASS (exit 0), all matched files use Prettier code style. No source edits occurred after the final 61-test/4-emitted-test runs.
