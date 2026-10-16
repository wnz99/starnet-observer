# I8 package/browser/isolation core review, round 1

## Findings

**Medium — keyboard smoke does not assert keyboard behavior.** `src/browser/application.consumer.test.ts:65–70` focuses the station, sends `ArrowRight`, `+`, and `0`, and then checks only that the station remains focused. None of these assertions observes pan, zoom, or overview. Removing the station's emitted `keydown` listener, or replacing its handler with a no-op, leaves this sequence green. The separate Escape dialog test covers panel dismissal, not station keyboard navigation. Task 8 explicitly requires real-browser keyboard/focus proof; the receipt's `ui: true` currently overstates this part of its evidence. Existing source view tests exercise handlers through recording fixture nodes, so they do not prove the emitted DOM listener remains wired. Fix the consumer with observable assertions after each relevant action: prove a pan changes the rendered station, prove zoom changes it, and prove overview returns to the expected overview outcome. Use stable synthetic fixtures and observable browser output or existing supported UI state; no test-only production globals/hooks are needed. Assert help collapse after its Escape action too if that action remains part of this scenario. A disposable listener-removal probe should fail for the new keyboard oracle rather than only fail elsewhere.

No other concrete defect found in the frozen core scope.

## Verdicts

- Outcome: **Issues Found**; bounded core review **Complete**.
- Requirements compliance: **Request Changes**, limited to the required emitted keyboard-behavior evidence above.
- Quality: **Request Changes**, for the same false-green integration-test oracle; no separate source maintainability finding.
- Recommendation: **Request Changes** for this core slice.
- This is not Task 8 overall approval. Hosted CI, final aggregate replay, record convergence, native platform execution, and PR/merge gates remain controller responsibilities.

## Scope and stability

Worktree: `/home/david/Projects/starnet-observer-i8-delivery`.
Target: complete current staged/working-tree bytes against HEAD/base `6f4dabe442b1be029b0c32285db9efae8153e480`, restricted to the following 14 frozen files. Added files are included through their full staged/current contents. No committed branch scope, acceptance implementation, docs, records implementation, or workflow implementation was added to this core review.

The exact frozen manifest `/tmp/starnet-ts-resume/i8-core-frozen-sha256.txt` has SHA256 `8177070443da0749fed3dd61cb2cae632a56ba27b685ba05a9ada1ffa31fc7ae`. All 14 entries matched before and after analysis; HEAD stayed unchanged. No intended file was unavailable.

| File | Before/after SHA256 |
| --- | --- |
| package.json | bda7325a2ea757c4101907d71ec013c1508a4b85bb2601833d9da0f27bdffa04 |
| bun.lock | 41bd1e98d0e00269cf822994b9e163b99753c1f2ad9a767742a4dd46e9dfe37b |
| tools/package.ts | e4ce8e376aacbf0b491dfbc60aafc18e209315d8b158c067e54ed7dc62129085 |
| tools/package.test.ts | 02b44f3456fd8a074971621336b67950bf0821db2aaf1fabec3478bb5c6e9a5f |
| tools/build.ts | 36d213d702bec9581f39f8486d89ccbdbc1502fcb07967baea5d55ed65723005 |
| tools/runtime-build.ts | ecf0200ace4efb9b7aaef51ee547b0ced1a1c61dfe6ac1cf59295a44fccc1939 |
| tools/browser-smoke.ts | 036ce92504a8b28311ce3eda3d6d4856319aa6c0b994cc987acded338dfe2847 |
| tools/browser-smoke.test.ts | 281bb3bb0fdcf138c293539429b804154db71da7fc1ab85cf2f8e1db50e82f4d |
| tools/quality/isolate-typescript.mjs | 0b5ec1ba27e97205e9cc37b8f39481d08b9b119bb0367d519a446ecf77a940ed |
| src/server/application.consumer.test.ts | 2b810f8ef0bcf6fdbb84e8fe27b7bdee3b5365466cd64f9d6148cebbba39c9ee |
| src/browser/application.consumer.test.ts | 83accae7366fa6b0e17b339d230bfa6aded1a70bfc803175f42b4b90e1002d01 |
| knip.json | 706063a42cd1528639983caf0283f3d0db82d26d3718c3bfd34f108f2f07f876 |
| .fallowrc.json | 4da842653eb8a9f0c7b4ef13760bcb61c36ebefe58d41b8b31b66bacf84f207c |
| quality/isolation/b2aa54886de5099973e41c812a77be3caef293299834a9b3ed4e1f9e68a87d1b/consumer.json | a19c6e183a05c451f7ef0aa4f735fdc1b3bc06d5deed2697c9d2a08157e1786e |

Read project AGENTS and approved PLAN, including Task 8 and revision 6's five fixture exceptions. Applied `wnz-code-reviewer`, full deep-analysis reference, `wnz-clean-code-js`, `wnz-test-quality`, and `verify-before-complete`. This is a controller-dispatched independent reviewer leaf; no nested delegation. Requested host selection: Codex `gpt-6.1-sol`, medium; resolved model identity unavailable, not invented.

Reused CI/native review evidence as requested: `i8-ci-native-review-r1.md` plus `i8-ci-native-review-r2.md`. Current isolator and consumer hashes match their accepted unchanged scopes. Their unchanged workflow/native ordering was not reviewed again. This review addresses remaining package/browser/helper interactions.

## Trace coverage

1. `package` script → guarded package CLI → separate temporary staging → `git ls-files -z` → distributable allowlist → per-file lstat/realpath identity → fresh runtime and public builds → sanitized manifest → Bun pack with scripts ignored → archive → unconditional staging cleanup. Reviewed private config/rooms/.env/planning/local dist/theme exclusion, canonical assets, LICENSE/NOTICE, executable/shebang, archive-symlink refusal, and staged additions. Source aliases are rejected before copying; packaging does not consume the local dist. The staging node_modules symlink provides compiler tooling; devDependencies/scripts are removed before pack and runtime/public are the final files allowlist.
2. Existing build callers/tests → `tools/build.ts` compatibility re-export → moved `runtime-build.ts` → strict runtime compiler → chmod main → Swift sibling copy → stageBuild replacement. Public build dependency inspected through generated-root containment, resource handling, head IIFE/main ESM entry emission, and independent temporary staging. No modified runtime algorithm was hidden by the extraction.
3. `dependency-isolation` → component/testDependency metadata → external temporary sandbox and ancestor refusal → named packed artifact overrides → reviewed TOML policy with env=false propagation → explicit .npmrc ownership → canonical manifest/frozen graph validation with only local archive checksum refreshed → production frozen install → installed server consumer before test tooling → frozen dev install → both installed consumers. Named consumer copies reject symlinks at every relative component. Isolated consumerRoot resolves installed package metadata only and has no source fallback in isolated mode. The root and component both pin Playwright 1.64.1; root lock and consumer graph agree. Production ordering and native execution scope reuse prior reports.
4. Installed bin resolution → executable `--help` → installed sibling HTTP module → injected synthetic observer/token → loopback HTML/main.js/API checks → cleanup. HTTP's explicit observer prevents default real observer construction. Installed SQLite client reaches the emitted sibling worker and reads synthetic databases, then closes. Runtime paths resolve from emitted module location. Native compile/Linux fallback evidence remains bounded by reused native reports.
5. Browser wrapper → explicit colocated Bun consumer discovery → failure status propagation. Browser consumer resolves emitted HTTP/public resources, launches pinned Chromium, blocks main for independent default/private prepaint checks, observes canvas content and runtime/CSP errors, exercises preferences/host filters/panels, verifies hidden polling stop/resume and stale label, denies missing token, avoids localStorage token persistence, and verifies default-hidden controls plus synthetic attach callback only. Temporary synthetic theme is removed in finally. Actual station keyboard behavior is the finding above. Browser version/DOM/canvas/timer behavior is dynamically resolved and cannot be proven by static analysis alone; supplied runtime logs are evidence, not a substitute for the missing oracle.
6. Package tests → disposable tracked repository fixture → synthetic private/generated sentinels → tar inventory and executable/shebang/resource assertions → alias/archive rejection. Browser wrapper test has independent positive and negative subprocess outcomes. Consumer tests remain named `.test.ts` under normal Bun discovery. The browser's consumerRoot import intentionally registers/reuses the server suite; sandbox Bun deduplicates the same module when both owner paths are passed.
7. Scanner entry deltas register real package/browser/records command owners. Existing entry graph still includes main, prepaint, worker, scripts and colocated suites; no suppression or rule severity was added. Production/private-type-leaks setting and generated-output exclusions are unchanged. Search found the five approved fixture directives and classification-test string fixtures; no new production directive appeared.

## Dead-code and clean-code assessment

Dead-code/reachability candidates considered: **7; all dismissed; zero confirmed required removals**.

- Removed runtime-build body: moved once, retained compatibility export used by existing build and SQLite tests; no stale duplicate implementation.
- New runtime-build module: used directly by package/build owners.
- Package mode branch in build API: completes the existing exported mode seam; normal package CLI also directly calls the same package owner. No claim of an observed production caller for that optional API branch.
- Packaging helpers: all have direct package/test consumers; distributableInput also defines the enforced boundary.
- Browser wrapper main guard: package script reaches it; import silence is intentional.
- consumerRoot export: shared by browser owner and copied with both installed consumers; no orphaned sample isolation tree is retained by the changed helper.
- Browser helpers and scanner entrypoints: test/script reachability is explicit; native/worker/bin/prepaint dynamic entrypoints are retained by contract. Pre-existing generic library handling in isolation is unchanged and outside application cleanup scope.

TypeScript/JavaScript clean-code assessment applied `wnz-clean-code-js`: **6 candidates considered, 6 dismissed as maintainability findings**. Reviewed package/build circularity (runtime extraction prevents an eager package↔build cycle), explicit allowlist boundary ownership, artifact imports/casts, fixture/server teardown, shared consumerRoot placement, and isolation environment flag lifetime. Each has an identifiable contract or resource owner; no style-only rewrite is proposed. The keyboard issue is a test-oracle defect, not a clean-code style finding. JSON configuration assessment checked dependency pins, graph entry truthfulness, frozen manifests and unchanged rule strengths.

Test-quality assessment: packaging sentinels detect privacy leaks at the artifact inventory boundary; executable/resources tests assert public distribution contracts; installed startup/worker tests use real emitted modules; browser checks cover real DOM/rendering boundaries; wrapper test distinguishes true success/failure. No new tests or mutations were authored during this review. The keyboard assertion gap is independently grounded in the approved acceptance requirement and an explicit no-op failure mode.

## Verification and limitations

Fresh commands run by this reviewer:

- `/tmp/starnet-ts-tools/bun-linux-x64/bun --no-env-file test ./tools/browser-smoke.test.ts`: **1 pass, 0 fail**, exit 0. This lightweight test launches only disposable runner fixtures, not Chromium.
- `git diff --check HEAD -- <all 14 scoped files>`: exit 0.
- `sha256sum -c /tmp/starnet-ts-resume/i8-core-frozen-sha256.txt`: all 14 OK before and after review.
- `git rev-parse HEAD`: stable base above.
- Bounded status/diff/source/import/scanner searches and metadata reads.

Controller-supplied logs inspected, not rerun or independently certified: `i8-final-core-tests.log` reports 4 pass/0 fail (package plus emitted consumers); `i8-core-consumers-final.log` reports 2 pass/0 fail; `i8-isolation-second.log` records production-only success before Playwright install and then 2 pass/0 fail. That earlier initialization predates final frozen replay, which remains pending. These green logs do not detect the keyboard no-op defect above.

Inspected manual visual receipt limits: static canonical/private screenshots were reviewed by the controller; different fixture metadata/camera fit/FX prevent exact baseline pixel-parity claims. This reviewer did not inspect those images, perform a visual audit, or claim visual equivalence.

No repository edits, full suite, compiler/build, install, Chromium launch, isolation run, network/provider call, live inventory, real control, bus operation, CI operation, branch change, or commit was performed by this reviewer. The external report is the sole write. Acceptance/docs/records changes by their separate owner remain excluded and do not invalidate these frozen-core conclusions. Subsequent scoped source changes require bounded rereview.
