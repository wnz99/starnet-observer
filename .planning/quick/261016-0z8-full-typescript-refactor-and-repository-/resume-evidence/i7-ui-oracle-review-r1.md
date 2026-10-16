# Typed UI oracle transfer independent review R1

No findings. **Clean / Approved** for the exact frozen six-file UI-test transfer. **Requirements compliance: Approved. Quality: Approved.** High 0, Medium 0, Low 0, Nit 0.

The original-five preservation review gate is satisfied: every original assertion site has a meaningful replacement, with only the two explicitly approved entry expectations changed. This approval covers the test package and its fixture adaptations. It does not approve root production, HTML/build/scanner wiring, final original-file deletion execution, full-repository integration, or Task 7 completion. Fresh combined root verification remains required after integration.

## Scope and integrity

Independent reviewer leaf, read-only in both repositories, with no delegation, staging, checkout, installation, live calls, or source edits. Applied wnz-code-reviewer, its complete deep-analysis procedure, wnz-clean-code-js, wnz-test-quality, and verify-before-complete. Requested gpt-6.1-sol / medium; resolved model identity was not exposed. No resolved identity is invented.

Target: `/home/david/Projects/starnet-observer-i7-ui-tests`, HEAD `781e08c7fa8186cfcc74c277c90d0fcffd349791`. Boundary: precisely the six new/untracked paths in `i7-ui-tests-manifest.json`, reconstructed from `/tmp/starnet-ts-resume/i7-ui-tests.patch`. Entire contents of all six were reviewed; no scoped file was unavailable. Production dependencies are read-only context, not this review's approval scope.

| Owned path | SHA256 |
| --- | --- |
| src/browser/app/observer-ui.test.ts | 4aca304b59ed5924ae022742bfb10e77320a3b79256358a9079778cff4c122ff |
| src/browser/app/observer-prefs-ui.test.ts | 737413da96739c3974e2a2a7979bfc58c01776721d31cb4e0f37c58ea8460a1e |
| src/browser/app/observer-arrange-ui.test.ts | 4d63f0e26bcb3734ce096ab7e0b49c1675eb0d64cee98631b2a91f5976a5b30c |
| src/browser/app/control-ui.test.ts | 1df354f34ad2f3973c09f488f7e84ca9a88cd3ca23cfd5f1aa46e39faf9455e3 |
| src/browser/app/control-ui-hosts.test.ts | 5d7478db283eb87bf692c5031da7ad59da24e324b23c7960ec017a46ed99acbd |
| src/browser/app/ui-test.fixture.ts | e2d8480e9b73f8bb62f207cbb92c07ee3a4aceea2851b0e6c0e2f302cd963321 |

Independently verified six live hashes and reconstructed all six complete new files from patch additions, byte-for-byte. Patch SHA256: `2205f8e17a7d23f146e42d30e4095c19ed4dbf57c6dd114af075eecd8a7ab7f8`. Independently verified report, oracle-map, readonly-proof, and source-proof hashes against manifest. Original five JavaScript suites remain byte-identical to manifest in both worker and `/home/david/Projects/starnet-observer-resume/frontend/app`.

Checked generation-2 archive SHA256 `89dcf3dd6a7b45b5efb8dca324f047d9b4763b45c1d1dd32c3665a69298801b7` and generation manifest hash. All 41 archive members independently match their declared hashes and worker bytes; all seven read-only dependency proof entries match worker bytes. This confirms the supplied historical gen2 evidence used actual published source, without turning that snapshot into a production approval.

## Independent oracle validation

Used a fresh TypeScript AST traversal, separate from the supplied inventory generator. Every map record was resolved against actual original and target AST nodes at the recorded line/column and exact complete source text. The queued native-close target intentionally has no column; its exact call text and recorded line resolve. Original assertion identities are unique, target assertion identities are unique, and independently enumerated original assertion sites have no omissions. Also independently enumerated all original and target await expressions. Verified lexical ordering of all mapped assertions and awaits, excluding the two approved entry relocations, and all directly mapped selected scenario calls.

| Suite | Original assertions | Target assertions | Awaits | Original selected calls | Direct target selected calls |
| --- | ---: | ---: | ---: | ---: | ---: |
| observer-ui | 463 | 465 | 38 | 97 | 96 |
| observer-prefs-ui | 15 | 15 | 6 | 13 | 13 |
| observer-arrange-ui | 14 | 15 | 5 | 9 | 9 |
| control-ui | 40 | 40 | 11 | 10 | 10 |
| control-ui-hosts | 75 | 75 | 7 | 29 | 29 |
| Total | 607 | 610 | 67 | 158 | 157 |

Counts are corroboration, not the preservation argument. Compared complete assertion expressions, including actual expressions, expected expressions, predicate text, identities, ordering, messages, and source-specific scenario setup. Mechanically unwrapped only the inspected `present`, `child`, and attributes-Map boundary adaptations to expose expression differences. Did not rewrite expected values to make them match. Reviewed all 19 residual expression differences individually: two approved entry replacements; actual canvas identity; equivalent explicit String conversions for coordinates and diagnostic concatenation; `inventoryReady()` preserving defined-and-nonnull subscription truth; positive nonempty flight checks; attributes.role versus attributes.get("role"); and printer-only object/array/chained-call formatting. All non-entry expected literals, arrays, regex predicates, keys, identities and golden text remain preserved. Raw source text and locations were independently validated before this mechanical comparison.

The three extra authored assertion sites are precisely the theme-owner CSS-write positive control, real model-activity positive control, and mailFrame availability guard. No original assertion was collapsed into another site. Bun's 32 expect count belongs to bootstrap; the migrated suites use Node assertions and are not represented by that counter.

All 158 original selected call records resolve. Main's original `this.handlers.close()` at original line 2428 is implemented by approved `AppFixtureDocument.closeDialog`: close the exact node, enqueue a closure capturing that node, then `flushCloseEvents` emits `close` to its current listeners at `dom.fixture.ts:257`. PanelStack's actual close listener checks top identity and current open state. A drawer-to-modal swap reopens before queued close delivery, while final removal releases listeners. Thus the missing direct main-site count is preserved asynchronous dialog mechanism, not lost scenario coverage. Main invokes flush after swaps, Escape and cancel. Original direct outside-close scenario remains separately present.

Four later main scenario functions now return through `runScenarios`' promise chain into the outer awaited IIFE. Failures propagate; original awaits and scenario order remain. No failed entry assertion is skipped, caught, retried, or removed.

## Boundary and cross-file traces

1. **Actual application:** ui-test.fixture directly imports mountObserver. uiFixture and mountScenario supply approved AppFixtureDocument/window/scheduler ports to actual mount. createAppCore constructs actual state, harness, theme, model/layout and courier composition; actual mount builds controls, navigation, hosts, panels, floor, renderer and lifecycle. Native callers omit collaborator seams. No VM/source slicing, fake mount or second broad DOM implementation exists in the six files.
2. **Spies and optional capability:** viewSpy installs throwing defaults for every omitted required View method, then preserves exact scenario overrides. It leaves optional FX methods absent. Actual Navigation retains its typeof setFx guard. querySpy's omitted define/invalidate/dispose throw; original explicit define/invalidate noops remain authored at original scenario sites. Real QuerySpine is passed directly through queryPort for the in-flight-hide/resume race. Missing required calls cannot silently become successes.
3. **Publication truth and identity:** delivery adds only absent false/zero/null metadata, then spreads supplied snapshot fields. It preserves the exact data object. Error name/message become empty only when omitted; supplied strings and error truthiness remain. No transport freshness proof is invented. Explicit proved/settled scenarios supply their own successful transport metadata. Same cached object across pending and failed requests is exercised with loaded and pending bodies. Fresh-object copies occur where original scenario deliberately publishes another parsed version.
4. **Lifecycle/query/Inspector:** captured document/window callbacks emit into actual registered listeners. Mount defines and subscribes observer.sessions; AppLifecycle generation guards feed actual AppRenderer. Real QuerySpine invalidation, request resolution, subscription and Inspector paths exercise pre-hide response rejection, post-resume proof, replacement withholding, exact helper-parent identity, unavailable/stale withdrawal and top-only reads. Panel focus, row focus and exact node identity assertions observe actual approved document connections and activeElement, not a separately computed expected tree.
5. **Theme/model positive controls:** actual ThemePack.start remains active. Scoped try/finally only classifies its CSS writes while still delegating each actual style write. Outside-start writes remain in the original zero-controller-write sink. Positive owner-write assertion proves start ran. The model activity wrapper delegates actual ObserverModel.activity and feeds actual AppState; positive rowWork > 0 precedes original zero-work pending assertions. Neither negative can pass through an unused counter.
6. **Selected theme:** reviewed original partial-crew setup, readBootstrap/isThemeSnapshot completeness, canonical crew IDs, sidecar resolvePack inheritance, and supplied boundary investigation. Fixture adds canonical sibling crew groups while keeping original blank reference, selected object identity and authored scene overrides. Original theme/view/sprite/warning/color oracles remain. Four bootstrap tests run alongside transfer, including malformed canonical rejection. No production validator was widened.
7. **Courier:** arrange suite observes actual View UpdateOptions.mailFrame, filtering only !parked. Both original positive flight and zero-reset assertions use this same airborne domain. Actual Navigation.applyArrange reaches courier rebase through mount, and actual floor update refreshes public frame options. Fresh isolated mutation proves the reset assertion detects removal of rebase (details below).
8. **Behavior breadth:** preferences cover default/restore/precedence/invalid/throwing storage and persisted safe values; control suite keeps enabled/presentation and success/failure matrices, pane targets, stale denial, chooser/provider/focus, keyed rows and overseer deck retention; hosts suite keeps namespaced panes, selection, per-host mail and ID collisions, relay evidence, expired history, spawn-then-select, host restore, independent flights and contributor clocks. Main keeps HTML/a11y slots, keyed checkout hierarchy, recording privacy, title/tool updates, inspector identity and loaded-UI semantics, panel stack ownership, movement integration, optional sprite failures, per-source freshness, totals, repository selection, help ordering and optional-evidence expiry.
9. **Entry:** both approved replacement assertions read actual HTML: synchronous classic app/prepaint.js after boot inside head, exactly one app/main.js ESM script after main DOM and before body close, with exactly two external script tags. Every other original markup/accessibility expectation stays in behavioral test. Historical gen2 entry RED is retained honestly; fresh final-source copy executes both assertions successfully.

## Dead code, clean code, and test quality

All introduced fixture helpers and exported types have concrete suite consumers. Dynamic event callbacks, overridden createElement/addEventListener/style methods, View factories and fetch adapters are reached through actual mount or approved fixture dispatch. No orphaned VM/source loader, fake controller, temporary dialog adapter or unused replacement helper remains in the six files. Original JS suites are intentionally retained pending controller integration; their deletion is not falsely reported as performed. Whole-repository scanners and production cleanup remain outside this scope.

Applied wnz-clean-code-js to all six paths. Six candidate concerns considered and dismissed: repeated sessionItems traversal (small pre-existing suite-local boundary), repeated node-ID lists (preserved scenario scope), large main suite (existing sequential behavioral regression package), captured definite-assignment locals (synchronously set by actual mount then checked through meaningful outcomes), shared spy defaults (throwing required calls, preserving optional absence), and runScenarios indirection (one used promise-serialization helper with error propagation). Zero evidence-backed clean-code findings. Fresh AST scan confirms no any, unsafe value casts, non-null assertion expressions, or suppressions; `as const` and definite-assignment declarations do not erase runtime values or narrow a missing value.

Test-quality review checked independently authored expected values, realistic publication identity, action/result matrices, stale/identity/privacy negatives, focus and node ownership, and failure propagation. Added positive controls close real vacuity risks. Fresh reset mutation below demonstrates sensitivity at the public frame boundary. Narrow fixture mechanics are reused rather than rebuilding a DOM. These are synthetic behavioral tests, not native-browser focus/layout/rendering acceptance.

## Fresh verification and artifact evidence

Every compiler/lint/suite invocation acquired `/tmp/starnet-ts-resume/p2-heavy-check.lock` individually. Pinned Bun 1.3.13 and Node 24.19.0 used. No repository files were written. Private copies were removed in finally blocks.

Created private copy of current resume src/frontend/tools, tsconfigs, package/bun files, with node_modules symlink; overlaid the exact frozen six test files. Source inventory is `i7-oracle-final-source-hashes.json`, SHA256 `b6ee91991a517e0d16f054a99542c56a9c35c32d699a94c8496e6a70c6494e22`. Actual current resume production and HTML supplied the runtime. Full private-source inventory matches live source at review end; only overlaid owned paths are compared with worker. No unrelated original JS suites were collected.

- `bun test` with explicit five owned suites plus src/browser/bootstrap.test.ts: **10 pass, 0 fail**, including behavioral and entry tests; log `i7-oracle-fresh-0.log`.
- `node node_modules/typescript/bin/tsc --noEmit --pretty false -p tsconfig.browser-tests.json`: **exit 0**; log `i7-oracle-fresh-2.log`.
- `node node_modules/eslint/bin/eslint.js` with exact six paths: **exit 0**; log `i7-oracle-fresh-3.log`.
- `node node_modules/prettier/bin/prettier.cjs --check` with exact six paths: **exit 0**, all files use Prettier style; log `i7-oracle-fresh-4.log`.
- Initial private root strict check failed because this review fixture omitted scripts/stream.js, causing two missing-module diagnostics and their consequent implicit-any diagnostic. Corrected private fixture includes scripts. Identical src/frontend inventory confirmed. `node node_modules/typescript/bin/tsc --noEmit --pretty false -p tsconfig.json`: **exit 0**; log `i7-oracle-fresh-5.log`. Failure retained in `i7-oracle-fresh-1.log`; it is not hidden or attributed to maintained source.

Command arrays, exit codes, log hashes and private cleanup are in `i7-oracle-fresh-results.json` and `i7-oracle-fresh-root-results.json`. Separate private final-source courier mutation ran baseline, removed only Navigation's single rebaseCouriers call, then restored: **0 / 1 / 0** exits. Mutant reached original layout-change flight-reset assertion at arrange test line 174: actual **1**, expected **0**. Logs `i7-oracle-reset-baseline.log`, `i7-oracle-reset-mutant.log`, `i7-oracle-reset-restored.log`; metadata `i7-oracle-reset-results.json`. Mutation source hash equals fresh combined fixture's actual Navigation hash. Private copy removed; maintained source unchanged.

Independent AST/hash validator: `i7-oracle-independent.cjs`; difference artifact: `i7-oracle-independent-differences.json`. Those artifacts support this report; preservation conclusion also depends on the full semantic/helper tracing above.

## Completeness and limits

Complete exact six-path review: per-file semantic analysis, all 607 original oracles, 67 awaits, 158 selected calls, helper/collaborator contracts, entry replacements, cross-file paths, dead code, clean code and test quality. No unresolved scoped blocker.

Fresh private verification closes this review's final-entry execution gap against current actual source without modifying either working tree. It is not a fresh full-root integration/build/scanner run and does not approve other production changes. Controller must integrate frozen artifacts, retire originals/old wiring atomically, and run required fresh combined root checks. No live desktop/provider/control/SSH/paid integration, browser visual audit or macOS acceptance was performed.
