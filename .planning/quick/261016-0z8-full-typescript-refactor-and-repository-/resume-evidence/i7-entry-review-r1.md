# Task 7 entry review, round 1

## Findings and verdicts

No findings in the exact eight-file scope. Requirements: Pass. Quality: Pass. Outcome: **Clean**. Recommendation: **Approved for this scoped patch and producer pair**.

This does not approve the complete runtime switch, main application composition, HTML/build wiring, palette policy, or the whole repository. Those remain separate atomic integration work. No source edits, staging, installs, live calls, or delegation were performed.

## Reviewer and boundary

Independent reviewer leaf, dispatched with INDEPENDENT_REVIEWER_LEAF. Applied wnz-code-reviewer including full deep-analysis procedure, wnz-clean-code-js, wnz-test-quality, and verify-before-complete. Requested selector gpt-6.1-sol / medium; resolved model identity was not exposed, so no identity claim is made.

Base: `0cc9ad6d87fd5805d251fe75b174b57b9c73c535`. Local tracked modifications, deletions, and untracked additions are included only as listed below. Helper worktree: `/home/david/Projects/starnet-observer-i7-entry-tests`. Root producer pair: `/home/david/Projects/starnet-observer-resume`.

| File | Reviewed current SHA-256 |
| --- | --- |
| src/browser/legacy-bridge.test.ts | Deleted; baseline 038431329ce6cc7026291ad5f954c1bd6bc675ff5afd993aa0dba584fb48f794 |
| src/browser/legacy-bridge.fixture.ts | Deleted; baseline aa2d56cf2b4e18b5f49e125daf82613c001af59c200ade655a103a94afcaff94 |
| src/browser/composition.test.ts | 4b99d1f0629d9d713eb07f2b8ed60377f328ea26721043f222c9520e1a239174 |
| src/browser/prepaint.integration.test.ts | 2c2209ac40618ebd1a72498ee3553160b6abf92409842179a44b89ddab9bece1 |
| src/browser/theme/native.fixture.ts | 55b2d632253c2fdbb436ef519799ef7123fc30273697041516a40d58bdb913dc |
| src/browser/theme/native.test.ts | 3cccd2e7ff6da2a9ace046396d2c3a36846a791a230c368e119468d64b360a48 |
| src/browser/prepaint.ts (root) | b9a7b79acd3017f377007ee24405c74da23f47633dd698547ff1d281a1861e44 |
| src/browser/prepaint.test.ts (root) | 576cde5926803ece16b382fa89bebb33f5c05821a629f2e626fbefc8e86ae7a2 |

All eight match the supplied manifests. Verified helper baseline hashes for deleted files and native.test.ts. Owned patch SHA-256 is `e245669a4f624d5da0d883660d840f7e023394d996cca3b703148b60e8416d99`; patch inventory is exactly the six helper paths. Root prepaint.ts copied into the helper has the same reviewed producer hash. No intended file was unavailable. Inspected complete deleted sources, complete new sources, the fixture-only native.test.ts diff, and both root diffs and files.

## Original oracle mapping, independently checked

Read the entire original legacy-bridge test and fixture from the baseline; checked the handoff mapping against actual assertions rather than accepting it as evidence by itself.

- Existing `sprites/drawing.test.ts` is byte-identical to baseline. Its changed canonical bootstrap test passes changed canonical crew through real readBootstrap -> createData -> sprite runtime. Both undefined startup and inherited crew startup run all three skins and both undefined/default appearance groups. It retains ready, per-skin readiness, scale 0.25, standing height 19, exact canonical south image source, and inherited replacement state. The latter is stronger than the old conditional inherited assertion. No duplicate sprite harness was added.
- Composition test preserves 62 CSS properties, loading state, frozen canonical palette, exact Scene loading/Crew fallback status order, supplied panel-node identity/membership, and showModal/open behavior. It reuses ThemeFixtureDocument and the inspector fixture port, extending only dialog behavior. This checks preservation of supplied native-shaped behavior, not actual browser dialog rendering.
- Emitted-head integration preserves both DM Sans and pixel input cases, all old exact font family/source/descriptor/order assertions, 62 CSS entries, selected phosphor, canonical background, typography/chrome attributes, loading state, and selected palette freeze. Synchronous assertions occur immediately after the real Bun-emitted IIFE and before awaiting font completion or mounting. Global inventories and zero lifecycle listeners protect the pure-head contract.
- The original global ThemePack identity alias is intentionally obsolete under approved Plan 7. Root prepaint.test replaces that alias oracle with zero head listeners/no head ThemePack, then a typed, explicit active theme owner: exactly one listener, mount, ordered status updates, and notice clearing. Native adapter tests retain native font resource identity across head/main adapters. These are scoped ownership checks; they do not establish actual future main entry wiring.
- Public-build emitted artifact location and full main/HTML integration are explicitly outside this approval. Direct Bun bundling proves actual head execution, not public build inventory.

No meaningful still-supported assertion was dropped solely because implementation moved. All native.test.ts test bodies are unchanged; its class extraction preserves constructor, fields, descriptors, and Promise.resolve(this) load behavior exactly.

## Cross-file traces and contracts

1. Head entry -> readBootstrap -> isThemeDefault/isThemeSnapshot/freezeSnapshot -> selected or canonical snapshot -> applyInterface -> CSS colors, typography, geometry -> installFont. Validation and snapshot freezing remain in the same bootstrap boundary. applyInterface cannot mount status or logos: those operations live in ThemeSession mount/applyLogo, which the head no longer constructs or calls.
2. Head -> browserThemeDocument only creates forwarding closures. applyInterface uses documentElement; it does not invoke status lookup, logo lookup, or DOMContentLoaded registration. No window application object is published.
3. Head font adapter -> document.fonts iteration -> admitted identity on the native face -> new FontFace/add/load only when no matching resource exists. Existing matching resource.load() preserves success/rejection for the later active owner. installFont catches synchronous admission failures and async rejection; head report is intentionally inert. Later createThemePack.start -> ownedFont -> same adapter -> existing face.load() -> active status report makes failure observable. Existing native tests cover identical identity reuse, distinct weight/source, normalized family identity, repeated rejection, and missing FontFace.
4. Root ownership test -> imported createThemePack -> ThemeSession.start -> one DOMContentLoaded listener -> status mount -> ordered notices/warnings. The head owns no session; the explicit main-side owner owns status.
5. Composition buildPanel -> panelMaker -> supplied InspectorDocument.createElement/attach -> returned exact dialog node. Fixture subclass supplies only the native-shaped showModal behavior, preserving the prior oracle without a replacement DOM framework.
6. Native fixture imports reach both native.test.ts and prepaint.integration.test.ts. The generic FontResource.load call in native.ts dynamically dispatches into fixture load; source and successful native tests establish reachability.

The newly added VM execution is limited to the actual emitted head. Existing unchanged native.test.ts retains its prior emitted-adapter readiness VM test. No classic-source VM loader or whole-application VM composition was introduced.

## Dead code and clean-code assessment

Confirmed both old bridge files are deleted and no remaining source/tools references to legacy-bridge.fixture, BrowserNode, BrowserImage, or BrowserFont exist. BrowserDocument in native.ts is an unrelated real adapter port. Root prepaint drops its duplicate document/font adapter and active-theme publication; replacement paths use existing native/style adapters. Root prepaint.test removes its obsolete global reporter narrowing helper.

The helper still has production legacy-bridge/build references pending root retirement; this is explicitly outside the six-file owned patch. Do not treat this scoped approval as cleanup acceptance for the full application switch. Whole-project Knip/Fallow convergence remains an integration gate. Supplied Fallow summary reports 135 findings; scoped detail identifies FontFaceFixture.load only. Retain load: browserThemeFont invokes it via its generic FontResource contract, and removing it breaks the real adapter/fixture contract. No suppression, synthetic caller, or scanner-only implementation was added. Global scanners were not rerun here; their summaries are limited pre-pass evidence, not a clean result.

Applied JS/TS clean-code assessment to all eight paths, including deleted harnesses and replacement callers. Five candidates considered and dismissed: combined composition scenario (bounded migrated oracle), exact two-font expectation branch (independent contract oracle), global inventory assertions (required application-global boundary), extracted load method flagged unused (real generic dispatch), and head no-op report (deliberate single-owner behavior). Zero evidence-backed maintainability findings. No broad DOM types, any, unsafe casts, configuration weakening, parallel fake-DOM framework, or duplicated FontFace fixture were introduced.

Test-quality assessment: reused existing sprite regression instead of duplicating cases; exact native descriptor expectations are independent literal oracles; minimal fixtures implement real ports; ownership negatives detect a concrete duplicate-lifecycle regression. Static tracing plus executed baseline probe confirms sensitivity. Head/main tests share assertions only where the distinct emitted entry boundary warrants it.

## Fresh verification

All heavy commands used PATH `/tmp/starnet-ts-tools/bun-linux-x64:/tmp/starnet-ts-tools/node-v24.19.0-linux-x64/bin:$PATH` and acquired `/tmp/starnet-ts-resume/p2-heavy-check.lock` individually. No source changed during review.

- Helper: `bun --no-env-file test src/browser/composition.test.ts src/browser/prepaint.integration.test.ts src/browser/theme/native.test.ts src/browser/sprites/drawing.test.ts`: 17 pass, 0 fail, 212 expectations.
- Root: `bun --no-env-file test src/browser/prepaint.test.ts`: 1 pass, 0 fail, 10 expectations.
- Helper: `bun x tsc -p tsconfig.browser-tests.json --noEmit`: exit 0.
- Helper: `bun x eslint src/browser/composition.test.ts src/browser/prepaint.integration.test.ts src/browser/theme/native.fixture.ts src/browser/theme/native.test.ts --max-warnings 0`: exit 0.
- Root: `bun x eslint src/browser/prepaint.ts src/browser/prepaint.test.ts --max-warnings 0`: exit 0.
- Helper: `bun x prettier --check src/browser/composition.test.ts src/browser/prepaint.integration.test.ts src/browser/theme/native.fixture.ts src/browser/theme/native.test.ts`: exit 0, all matched files use Prettier style.
- Helper `git diff --check`, root scoped `git diff --check -- src/browser/prepaint.ts src/browser/prepaint.test.ts`: exit 0.
- Read-only synthetic probe bundled baseline prepaint through a Bun onLoad override, then current prepaint, with identical existing ThemeFixtureDocument/canonicalTheme and VM execution. Baseline result: mounted=1, themeGlobal=true. Current result: mounted=0, themeGlobal=false. Exit 0 with exact expectations checked. This independently confirms the new zero-listener/no-global oracle distinguishes the old behavior without replacing production files.
- Python SHA-256 checks: every current scoped hash, deleted baseline hashes, fixture-test baseline hash, and owned patch hash match. Existing sprite oracle file equals baseline byte-for-byte.

## Completeness and limits

Deep per-file, cross-file, oracle-preservation, dead-code, clean-code, and test-quality review completed for the exact eight paths. No blockers or unresolved scoped questions. No real browser audit, live desktop integration, aggregate public build/main execution, whole-project dead-code acceptance, or complete runtime migration approval is claimed. Those require final atomic integration review and verification after remaining root work lands.
