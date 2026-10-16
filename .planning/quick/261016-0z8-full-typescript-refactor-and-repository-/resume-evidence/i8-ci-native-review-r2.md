# I8 Linux installed-desktop fallback fix review, round 2

## Findings and verdict

No findings remain in the bounded fix scope. Round 1's Medium installed Linux fallback coverage gap is resolved in the reviewed test design.

- Outcome: **Clean**; bounded review **Complete**.
- Requirements compliance: **Approved** for this fix.
- Quality: **Approved** for this fix.
- Recommendation: **Approved**, limited to the Linux installed-desktop fallback delta in `src/server/application.consumer.test.ts`.
- This is a static fix-review verdict, not a claim that the new test passed. It does not approve Task 8 overall, claim hosted CI success, or certify macOS compilation or live desktop integration.

## Scope and hashes

Repository: `/home/david/Projects/starnet-observer-i8-delivery`.
HEAD: `6f4dabe442b1be029b0c32285db9efae8153e480`.
Target file is staged as a new file; no unstaged delta was present. Read the complete 161-line consumer and its staged addition to bound the new helper and call-site change. Semantic scope is only the reported Linux fallback fix, lines 128 and 134–161. Other Task 8 changes remain excluded.

Round 1 recorded consumer SHA256: `9186b7fb2c9121bdeb20244d48ddc0de4ffe741b39107ef2e91a68d74a22036c`.
Current consumer SHA256 before and after this review: `2b810f8ef0bcf6fdbb84e8fe27b7bdee3b5365466cd64f9d6148cebbba39c9ee`.

The unchanged scopes retain their round 1 hashes before and after this review:

- `.github/workflows/check.yml`: `bb8c1ad754085dbc04c3d7cd5d55e57a679eaf41a4cb89530ff247801968499d`.
- `tools/quality/isolate-typescript.mjs`: `0b5ec1ba27e97205e9cc37b8f39481d08b9b119bb0367d519a446ecf77a940ed`.

No scoped source changed during this review. Reuse the unchanged workflow/isolator static review from `/tmp/starnet-ts-resume/i8-ci-native-review-r1.md`; they were hash-checked, not semantically rereviewed. The old consumer bytes were not supplied separately, so this report does not claim a byte-for-byte round 1-to-round 2 patch reconstruction. Complete current consumer inspection found no additional issue affecting the bounded fix. No intended current review file was unavailable.

## Trace coverage and evidence

`installed application` test → `consumerRoot()` → installed package root under isolation → `installedResources(root)` → non-darwin branch → `installedUnsupportedDesktop(root, scratch)` → dynamic import of installed `dist/runtime/src/sidecar/desktop/index.js` → `makeDesktopObserver()` → `makeNativeReader()` → `inventory()` → `reader.ready()`.

The new helper asserts the actual host is Linux before import. It deliberately omits a platform override, exercising the adapter's `platform = process.platform` default. It injects a deterministic clock, unique scratch cache path, and refusal executor whose counter detects swallowed execution attempts. It calls the installed adapter's inventory API and independently asserts the exact required result: unavailable health, unsupported-platform reason, null observedAt, and empty windows. It then asserts zero executor calls and absent cache directory. These assertions protect missing/wrong installed exports, incorrect platform selection, false availability, invented observations/windows, native execution, and persistent cache creation.

Relevant source boundaries were traced directly: `src/sidecar/desktop/index.ts:10–27`, `cache.ts:95–137`, and `inventory.ts:31–62`. On Linux, `ready()` returns unsupported-platform before starting `build()`, which owns cache creation and compilation. Inventory immediately returns the unavailable result before `reader.native()`. The installed module import has no top-level desktop invocation. Consequently this path does not query a live inventory or execute native commands. The injected executor blocks actual execution even if an execution regression occurs. Scratch cleanup remains in the existing unconditional finally block.

Dynamic import resolution and emitted package execution still require runtime evidence from the controller's installed-consumer run. The source call trace and assertion design establish what that run will test, not its success. The darwin branch still only calls `swiftc` on the installed Swift source and does not launch the resulting binary; it is unchanged in the current reviewed code path.

## Dead-code, clean-code, and test-quality assessment

Applied `wnz-code-reviewer` and its deep-analysis reference, `wnz-clean-code-js`, `wnz-test-quality`, project AGENTS, and `verify-before-complete`. This is a parent-dispatched independent reviewer leaf; nested delegation was prohibited. Host-resolved model identity was not exposed; no explicit user model override was supplied or claimed.

Dead-code candidates considered: 2, dismissed: the new helper is reached by the existing Linux matrix consumer path, and its local interface is used by the installed-module assertion cast. The former trivial platform assertion is now part of behavioral coverage, with no orphaned caller or import.

TypeScript clean-code candidates considered: 2, dismissed: the narrow local installed-module interface follows existing SQLite/HTTP consumer patterns; the separate helper keeps platform-specific assertions visible without complicating resource ownership. No maintainability finding or rewrite is requested.

Test-quality assessment: one scenario covers one installed unsupported-platform contract. The exact expected result comes from the Linux truthfulness requirement, rather than production helpers. Executor-call count and absent cache assertions protect required no-side-effect behavior. This adds material installed-artifact coverage beyond the source adapter test. No extra tests or mutation runs were added during this read-only review.

## Verification and limits

Fresh lightweight checks:

- `git diff --check -- src/server/application.consumer.test.ts`: exit 0.
- `git diff --cached --check -- src/server/application.consumer.test.ts`: exit 0.
- Repeated SHA256 checks: stable values listed above.
- `git rev-parse HEAD`: value listed above.

No heavy checks, test suite, dependency installation, package build, native compiler, browser, network/provider call, hosted CI, or live integration was run. Actual installed-consumer/native evidence remains the controller gate. No repository edits were made; this external report is the sole write.
