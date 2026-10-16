# TypeScript refactor: machine transfer and paused implementation

Recorded 2026-10-16. Reader: the user and the next execution controller on another machine. Purpose: restore the exact reviewed integration and both unfinished packages, then resume the approved work when the user explicitly resumes it.

**Implementation is STOPPED at the user's request.** All workers and their owned jobs stopped. This transfer does not approve unfinished packages, start implementation, or satisfy final quality gates. Historical authorization covered isolated parallel implementation, PR creation, independent review/fix loops and merge after all gates; the later STOP takes precedence until explicit resumption.

Read the [approved revision 4 plan](261016-0z8-PLAN.md), [decision/context record](261016-0z8-CONTEXT.md) and [milestone summary](261016-0z8-SUMMARY.md). The plan owns requirements and acceptance; this handover owns the transfer checkpoint. Its original checkpoint paragraph predates subsequent execution; use this document and the summary for current status. `main` remains untouched; no PR exists.

## Restore the three branches

The delivery branch contains reviewed integrated code and this handover. Two separate branches preserve unreviewed working source as transport commits. These snapshots were made through an isolated temporary index; original worktree HEADs, indexes and status were preserved. They are recovery checkpoints, not merge-ready implementations.

| Branch | Exact source checkpoint | Role |
| --- | --- | --- |
| `wip/typescript-refactor-integration` | Reviewed source `c8e3379ad654b1a2225e417736e9581442ddfa13`; subsequent handover record commit on this branch | Delivery, approved plan and portable evidence |
| `wip/typescript-refactor-observer-handoff` | `e983ce1a6f6428ef37c4b604d9f22a47a884b332`, parent `c8e3379ad654b1a2225e417736e9581442ddfa13` | Unreviewed observer composition: 31 paths, including 23 new files and eight tracked import patches |
| `wip/typescript-refactor-browser-handoff` | `d09f8dc90a816fffde94c11ffcc5ad889d15612f`, parent `6599db57b79f9e178b4157927418ef0c788812cc` | Unreviewed browser preparation: 71 paths, comprising 70 browser files and controller-owned shared catalog |

[Snapshot manifest](handover/starnet-ts-handover-snapshots.json) records exact trees, path bytes and hashes. Delivery handover records are not part of either snapshot. Read them from the delivery checkout; do not cherry-pick the whole delivery branch onto browser preparation or treat its documentation commit as a prerequisite source change.

The controller's final transfer response supplies remote push verification. This document alone does not prove remote availability. On the destination, fetch all three refs and verify the snapshot hashes before editing. For a new clone:

```sh
git clone git@github.com:wnz99/starnet-observer.git starnet-observer
cd starnet-observer
```

For either a new or existing clone, run from the repository root:

```sh
git fetch origin \
  refs/heads/wip/typescript-refactor-integration:refs/remotes/origin/wip/typescript-refactor-integration \
  refs/heads/wip/typescript-refactor-observer-handoff:refs/remotes/origin/wip/typescript-refactor-observer-handoff \
  refs/heads/wip/typescript-refactor-browser-handoff:refs/remotes/origin/wip/typescript-refactor-browser-handoff

git rev-parse origin/wip/typescript-refactor-observer-handoff
# Expected: e983ce1a6f6428ef37c4b604d9f22a47a884b332
git rev-parse origin/wip/typescript-refactor-browser-handoff
# Expected: d09f8dc90a816fffde94c11ffcc5ad889d15612f

git worktree add --detach ../starnet-observer-handover origin/wip/typescript-refactor-integration
git worktree add -b feat/typescript-refactor-resume ../starnet-observer-resume origin/wip/typescript-refactor-observer-handoff
git worktree add -b wip/typescript-refactor-browser-resume ../starnet-observer-browser-resume origin/wip/typescript-refactor-browser-handoff
```

Choose unused destination directories and branch names if these already exist; inspect existing work before reuse. Do not reset or delete it. The detached delivery checkout is a read-only reference. The observer resume branch already descends from reviewed `c8e3379`; resume there, rather than from `main`. Browser preparation stays isolated until review and Task 4 acceptance. Move accepted source changes between worktrees through explicit reviewed commits, never by switching another session's checkout.

The source Mac retains original `main` at `6461764c20e79c32778f35be763e08e5b32c108e` and a parked dirty original feature checkout at `2883d61`. Neither should be reset, cleaned or deleted as part of takeover. Their absolute checkout paths are historical evidence only. No remote coordination dependency is required to restore these Git snapshots.

## Status and evidence at STOP

| Plan task | Status | Remaining boundary |
| --- | --- | --- |
| 1: collected colocated tests | Complete, independently reviewed | Preserve assertions and real native/subprocess fixtures |
| 2: quality baseline, hooks, semantic MCP | Complete, independently reviewed | Destination tooling/configuration must be deliberately installed and reverified |
| 3: policy modules/contracts | Complete, independently reviewed | Preserve actual producer contracts |
| 4: typed sidecar/observer | Partial | Reviewed adapters/leaves integrated; observer composition is unfinished and unreviewed |
| 5: browser/public build/themes | Partial | Browser preparation exists; full review, themes/roles/office-art and atomic public switch remain |
| 6: remote/control/HTTP runtime | Pending | Control has read-only readiness report only |
| 7: view/application | Pending | Explicit briefs exist; no acceptance claimed |
| 8: artifact/isolation/browser/docs/CI | Pending | Full application and package proof, hooks/quality, final review, CI and merge remain |

Reviewed delivery commits, in order: `34cd59f`, `fc924cf`, `69946d0`, `2883d61`, `7420c52`, `357b45b`, `6599db5`, `9a9b189`, `06f93cc`, `c8e3379`. Consult Git history and the milestone summary for each scope. Browser prelude `6599db5` must be included in full browser package review against `357b45b`.

Latest reviewed integrated-source evidence: **69 tests passed, zero failed, 51 files, 50.29 seconds**. Runtime build, root/runtime/tools strict compilers and owned ESLint passed. This is historical evidence at the accepted integration checkpoint, not verification of observer or browser snapshots, destination setup, or the full finished migration. [Integrated test log](handover/starnet-ts-p1-integrated-tests.log.txt).

Inspector/transcript review round 1 found a Medium issue: string coercion could admit malformed enum arrays. The bounded fix restored exact discriminator membership; full original-scope round 2 approved. Project/identity leaves also passed independent review. Adapter checkpoint round 2 passed after adding real emitted lifecycle proof.

- [Inspector/transcript implementation report](handover/starnet-ts-parallel-4c-report.md), [round 1 review](handover/starnet-ts-parallel-4c-review.md), [fix report](handover/starnet-ts-parallel-4c-fix1-report.md), [full round 2 approval](handover/starnet-ts-parallel-4c-review-r2.md).
- [Project/identity implementation report](handover/starnet-ts-parallel-4d-leaves-report.md), [independent review](handover/starnet-ts-parallel-4d-leaves-review.md).
- [Adapter checkpoint full round 2 review](handover/starnet-ts-task4ab-review-r2.md).

## Finish observer composition first

Read the **final STOP section** of the [observer report](handover/starnet-ts-parallel-4d-observer-report.md), not its earlier preparation status. Read the [observer brief](handover/starnet-ts-parallel-4d-observer-brief.md). The snapshot includes eight import-only caller/test patches; all are part of composition review, not incidental transfer changes.

Last actual evidence: production runtime and root strict compilation passed; the four focused suites passed, zero failures, in 2.08 seconds. The last saved [lint inventory](handover/starnet-observer-lint.log.txt) contains 348 errors, but is **stale** after subsequent fixture async/global fixes. Lint and formatting were not rerun after those edits. No full repository test, full emitted observer proof, final runtime build/scanners, assertion preservation audit or independent observer review completed.

Resolve semantic differences before structural lint cleanup:

1. `inspectMessage` closed branch currently spreads extra unavailable fields. Original return is exactly `{id, health: 'unavailable', reason: 'unreadable', text: null}`. Restore the original shape.
2. Snapshot `observedAt: observedAt ?? null` may change the original explicit-undefined edge. Inspect sparse callers and original behavior before deciding the exact fix.
3. Production complexity, precise guards, identity/inspection ownership and fixture typing remain unfinished. Main suite Maps still infer `any`; add actual key/value types. Keep `settled` fixture ordering, rather than deferring bodies through `Promise.resolve().then`.
4. Audit every original value/Boolean/assertion and asynchronous ordering oracle before deleting the old observer and three JS suites. Preserve all real transcript/helper/identity/overseer collaborators and native fixtures. Counts alone do not prove preservation.
5. The exact real polling/query test remains `src/sidecar/observer/queryspine.integration.test.js` until I5 can port it against the accepted typed query API. This is an approved temporary JS integration handoff. Arrangement/model has a corresponding temporary JS handoff. Neither permits mocks, ambient API shims or duplicate implementations.

Finish cohesive extraction and strict owned lint/format without weakening limits or adding scanner suppressions. Preserve refresh/cache/coalesced-promise semantics, progressive publication, footer/ancestry/current-owner checks, bounded queues/warmup, timestamp and aggregation edges, close promise identity, unref and cleanup. The report lists exact unresolved methods and original test scenarios.

Then perform fresh source and emitted external-cwd synthetic observer proof, recursive emitted dependency closure, required worker/Swift/native checks, full tests, compilers and unsuppressed scoped diagnostics. Trace all old consumers before deleting legacy source. Independently review the **entire composition against `c8e3379`**, including all controller caller patches. Fix and re-review findings before accepting whole Task 4.

## Review browser preparation, then perform I5

Read the [non-sprite preparation checkpoint](handover/starnet-ts-parallel-5-prepare-report.md), [final sprite/combined STOP report](handover/starnet-ts-parallel-5-sprites-report.md) and [sprite brief](handover/starnet-ts-parallel-5-sprites-brief.md). Typed preparation is not the active public app. Classic HTML/JS/server-theme consumers remain live.

Final browser snapshot evidence: **101 full tests passed, zero failed, 60 files, 49.69 seconds**; **42 browser tests passed with 351 expect calls**; all five strict projects, owned browser lint and formatting passed. Original view, exact 1,440-draw recorder parity, real assets and native emitted entry diagnostics passed. These checks do not accept public HTML/CSP/build integration.

Full preparation review is still required against **`357b45b`**, including `6599db5`, the controller shared/bootstrap/compiler/catalog prelude and all 71 snapshot paths. Reviewing only changes since `6599db5` omits part of the package. No previous partial review or self-review accepts this scope. Fix findings and hold browser integration until whole Task 4 is accepted.

Known failing root gates at the browser checkpoint:

| Gate | Historical result |
| --- | --- |
| Root lint | 259 errors; no owned browser findings |
| Knip | One unused native adapter file and 19 exports |
| Fallow dead code | 58 findings; report explains actual generic/injected member consumers |
| Fallow duplicates | 2.0%, above 1.0%; classic and typed code still coexist |
| Dependency isolation | Missing root `build` script |

Retained native adapters have concrete I5 consumers; do not create fake entrypoints or suppress findings. Their actual integration and legacy cleanup must be proved. No assumption that deleting classic files automatically makes scanners pass.

I5 is a sequential controller integration, informed by [I5 brief](handover/starnet-ts-parallel-i5-brief.md), [read-only preparation brief](handover/starnet-ts-parallel-i5-prepare-brief.md) and [readiness report](handover/starnet-ts-parallel-i5-prepare-report.md). These reports did not authorize implementation. Once resumed and accepted Tasks 4/5-P are frozen:

- Controller owns shared/root contracts, 34 scene roles, bootstrap and public build, HTML/CSP, temporary bridge, real caller switches and shared test handoffs. A bounded domain implementer owns theme/office-art code and colocated tests; it requests exact caller/shared patches from the controller.
- Reuse the **same already-started active `window.ThemePack` object** from prepaint, including its status lifetime. Do not recreate or overwrite it.
- Construct sprites through `createSprites(browserSpriteDependencies(DATA, document))`; use actual native canvas/image objects, accepted checked crew and the existing degradation callback. Read the report's exact factory and generic interfaces.
- Use `browserInspectorDocument(document)` for inspector panels/factories, preserving actual native HTMLElement nodes. Combine mail named constants/functions with `createMail(defaults)` for the temporary facade. Supply receiver-safe reload/timer capabilities.
- Preserve server filesystem containment, bounded reads, resource budgets, canonical/private pack behavior, atomic scene/crew loading, role dimensions, office-art and mixed-theme oracles. ReadBootstrap validates injected unknown fields once; do not duplicate a default manifest.
- Atomically port classic JS consumers and the real queryspine/arrangement integration handoffs with their accepted typed producers. Remove obsolete classic owners only after actual reference and oracle audit. Temporary bridge survives only until final application migration.
- Verify real public build/HTML/CSP/callers and mixed themes, then independently review the accepted I5 scope. Do not infer live/private input authorization from theme support requirements.

## Remaining dependency order and delivery gates

After accepted Task 4 and browser preparation, use the approved plan's bounded isolated worktrees. Preserve dependency order; readiness reports are preparation evidence only.

1. Finish and review I5 themes/public integration.
2. Prepare independent remotes **6-R**, control/presentation **6-C**, and scene/view **7-V** worktrees from the accepted frozen producers. Integrate 6-R, then 6-C. Read [remotes brief](handover/starnet-ts-parallel-6-remotes-brief.md), [control brief](handover/starnet-ts-parallel-6-control-brief.md), [control readiness](handover/starnet-ts-parallel-6-control-report.md), and [view brief](handover/starnet-ts-parallel-7-view-brief.md).
3. Control's mixed HTTP/remotes scenarios may remain exclusively in root-owned `server.control.integration.test.js` and `server.control-remote.integration.test.js` until the HTTP typed port. Preserve actual integrations; no mocks. Presentation needs its own precise masked projection, never a cast to `RawObserverSnapshot` or a full raw inspection type.
4. I6 HTTP/start/runtime integration follows accepted producers. Read [HTTP brief](handover/starnet-ts-parallel-6-http-brief.md). I7 completes strict application migration and removes the temporary bridge; read [app brief](handover/starnet-ts-parallel-7-app-brief.md).
5. I8 completes packaging, private-input exclusion, external-cwd/artifact dependency isolation, actual browser behavior, hooks/CI/docs/locks and original-oracle closure. Read [Task 8 brief](handover/starnet-ts-task8-brief.md).

No `any`, boundary casts that invent proof, fake scanner entrypoints, strict-rule weakening or scanner suppressions. Keep tests colocated and retain original behavior/security oracles. Cleanup needs actual reachability evidence. Optional Serena, cloud/self-hosted integration, live/paid runs, real app restarts and branch/worktree deletion remain unapproved.

Before merge: prepare PR summary and fresh verification evidence; perform one fresh full-branch aggregate review that also serves as initial PR review, then resolve review comments/findings through the required loops. Require no requirement gaps or unresolved High/Medium issues. All required local checks and configured CI must pass on the final reviewed head, including later GSD records. No PR exists at STOP.

Write final GSD summary and completed row referencing the PR number as the **last feature commit after final review loops and before merge**. Verify this final head. Merge with a merge commit. Keep private FLOW merge SHA/state local; never add FLOW.json to tracked records. Preserve user instructions: no timeline estimates or Co-Authored-By trailers.

## Destination tools and local state

Use Bun **1.3.13**, Node **24.19.0**, uv wrapper **0.13.1** and ShellCheck **0.11**. The manifest pins 13 direct development dependencies; install frozen dependencies with `bun install --frozen-lockfile`. Do not copy `node_modules`, dist output or the Mac's temporary tool prefixes. Consult tracked [documentation index](../../../docs/index.md) and quality/provenance instructions for setup. Run checks only after explicit implementation resumption; archived output is not destination verification.

GSD client tooling is project-local `@opengsd/gsd-core` **1.16.0**, not a global install or `@gsd-build/sdk`. If the client installation is missing, follow project instructions using `npx @opengsd/gsd-core --local --codex`; do not execute a full quick workflow that replans or restarts already approved work. Shared WNZ skills belong under `~/.agents/skills`; install required dependencies on the destination deliberately. Skill defaults requested gpt-6.1-sol/medium; exact resolved host model identity was unavailable, not independently verified.

Clean Code MCP used an external checkout pinned to `c51c7aa0a9ad555f81e8096e4a7e1c83f9156c1a`, 316 indexed chunks and actual Codex discovery of 11 tools/search CC-043. Those are source-Mac observations, not portable configuration. Reinstall/reverify through the tracked instructions and authoritative skill sources. Never copy personal client config, MCP registrations, credential files or tokens.

Hooks were installed worktree-scoped; `main` hooks remained unset. Install hooks deliberately for the destination worktree. Normal pre-push quality currently fails because migration is unfinished. Any narrowly scoped hook bypass used for the WIP transfer grants no merge or quality approval and must not weaken tracked hooks.

This archive intentionally omits FLOW.json, private artwork/configuration, local databases, credentials, personal tooling and runtime outputs. The approved plan/context/summary and archived reports preserve execution decisions. Reconstruct required local controller state under the applicable workflow without inventing approvals. Removing remote llm-bus configuration on the source Mac is a separate local operation by the original controller; it is not a destination prerequisite and no bus configuration is transferred.

## Evidence archive and limits

[Evidence manifest](handover/evidence-manifest.json) lists every archived file, SHA-256, size and any missing requested file. All 47 requested artifacts were available when authored. Reports/logs are immutable historical evidence. Their `/tmp` and `/Users/...` paths describe the original machine and must be mapped to the new worktrees. Do not treat early preparation statuses inside appended reports as later than final STOP sections.

Selected validation logs:

- [Full browser checkpoint suite](handover/starnet-ts-5p-combined-all-tests-final.log.txt), [focused browser suite](handover/starnet-ts-5p-combined-focused-final.log.txt), [strict projects](handover/starnet-ts-5p-combined-typecheck-final.log.txt), [owned lint](handover/starnet-ts-5p-combined-lint-final.log.txt), [owned format](handover/starnet-ts-5p-combined-format-final.log.txt).
- [Root lint failures](handover/starnet-ts-5p-combined-rootlint.log.txt), [Knip](handover/starnet-ts-5p-combined-knip-final.log.txt), [Fallow findings](handover/starnet-ts-5p-combined-fallow-final.json), [duplicates](handover/starnet-ts-5p-combined-dupes-final.log.txt), [isolation failure](handover/starnet-ts-5p-combined-isolation.log.txt).
- [Sprite parity/original view/emitted diagnostics](handover/starnet-ts-sprites-parity-view-emitted-final.log.txt), [original browser domain diagnostics](handover/starnet-ts-5p-combined-original-domains-final.log.txt).

Diagnostic source is archived with `.txt` suffix so it does not become maintained code or collected tests. Read and adapt paths/imports after inspecting actual source. Never blindly replay old transform generators; none are included.

- [Inspector emitted diagnostic](handover/verify-4c-emitted.mjs.txt), [project/identity emitted smoke](handover/starnet-leaves-emitted-smoke.mjs.txt).
- [Original browser domain parity](handover/starnet-ts-5p-parity.test.mjs.txt), [1,440-draw sprite parity](handover/sprite-parity.test.mjs.txt), [original view](handover/starnet-sprite-original-view.test.mjs.txt), [native emitted sprite](handover/starnet-sprite-emitted.test.mjs.txt), [isolated source-copy mutations](handover/starnet-sprite-mutations.py.txt).

Original browser baseline used a synthetic three-agent fixture, Playwright **1.64.1**, Chromium **156.0.8078.4**, viewport **1440×1000**, no page/console errors. [Browser proof](handover/starnet-ts-baseline-browser-proof.json), [full page](handover/starnet-ts-baseline-page.png), [canvas](handover/starnet-ts-baseline-canvas.png). These contain no real app/user observations. The temporary Playwright environment was outside the branch; reinstalling it is a later verification need, not evidence the final app is already verified.

## Copy-paste takeover prompt

Use only when the user is ready to resume implementation:

```text
Resume the approved full TypeScript refactor from the transferred STOP checkpoint.
Read the delivery branch's .planning/quick/261016-0z8-full-typescript-refactor-and-repository-/261016-0z8-HANDOVER.md, approved revision 4 PLAN, CONTEXT and SUMMARY. Read the final STOP sections of handover/starnet-ts-parallel-4d-observer-report.md and handover/starnet-ts-parallel-5-sprites-report.md, plus the preceding browser preparation report and relevant briefs.

I now explicitly resume implementation. Continue through PR creation, independent review/fix loops, required local checks and configured CI, then merge with a merge commit when all approved gates pass. Preserve approved requirements and decisions; do not restart discovery or replan completed work. Do not run paid/live integrations or infer optional configuration/cleanup approval.

Verify all three remote branches and exact snapshot hashes from the handover. Work in my own feature worktree from observer snapshot e983ce1a6f6428ef37c4b604d9f22a47a884b332, which already descends from reviewed c8e3379. Keep browser snapshot d09f8dc90a816fffde94c11ffcc5ad889d15612f isolated. Install/reverify destination tools without copying personal configuration or credentials. Preserve all original checkouts and edits.

Finish observer semantic/type/lint/oracle/emitted closure work, then fresh independent whole-composition review against c8e3379 including caller patches. Review the whole browser package against 357b45b including 6599db5 and all 71 snapshot paths; fix findings and hold integration until Task 4 is accepted. Perform I5 atomic themes/roles/office-art/public build/HTML/CSP/real caller handoffs, then the plan's remotes/control/view, HTTP/runtime, final application and artifact/CI tasks in dependency order.

Use the required WNZ/GSD workflow and independent sub-agent reviews with the code-reviewer skill. No any, proof-inventing casts, strict-rule weakening, fake scanner entrypoints, suppressed scanners or lost original assertions. Do not claim historical checkpoint tests verify the final head. Keep final GSD completion as the last feature commit before merge, referencing the PR number; verify the final head. No timeline estimates or Co-Authored-By trailers.
```
