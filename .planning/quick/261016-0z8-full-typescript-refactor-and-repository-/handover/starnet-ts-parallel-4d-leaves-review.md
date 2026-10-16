# Independent review: 4d-L staged package

No findings. Requirements: **Approved**. Quality: **Approved**. Outcome: **Clean**.

Approval covers this bounded leaf package and its two explicitly assigned JavaScript integration handoffs. It does not close Task 4 or the repository migration.

## Scope and method

- Reviewer role: `INDEPENDENT_REVIEWER_LEAF`; direct read-only analysis, no delegation, source edits, commits, live sources, SSH, controls, or provider runs.
- Checkout: `/Users/davidfava/Projects/Personal/starnet-observer-typescript-4d-leaves`.
- Boundary: `357b45bdd8d49501d8bdf3c54e000085dfa3ecc0` (HEAD) to entire staged index, branch `wip/typescript-refactor-4d-leaves`.
- Independent status/diff inventory agrees with package: 36 raw paths, 33 rename-aware paths; 3 deleted production modules, 3 renamed tests, 25 added paths, 2 modified callers. Rename-aware diff: 2319 insertions, 1443 deletions. Raw inventory also counts the old test paths as deletions and new test paths as additions.
- Included: all staged production additions/deletions, test moves and edits, both new integration handoffs, observer production and test import switches. No unstaged delta or untracked source was present. No intended diff content unavailable.
- Read all new leaf source/test modules, deleted production modules from HEAD, complete staged test rename diffs, new integration tests, and complete caller changed hunks. Traced relevant unchanged observer composition, refresh, private-proof ownership and inspection paths, browser model consumers, child environment guard, fail-open logging, compiler/runtime projects, test discovery and supported launch configuration.
- Requirements assessed from supplied brief, global constraints and approved handoff scope. Implementer report and structural output were treated as evidence, not authority or proof of correctness.
- Applied `wnz-code-reviewer` and full `references/deep-analysis.md`, `wnz-dead-code` in audit mode, `wnz-clean-code-js`, and `wnz-clean-code-py`. Exact host/provider model identity unavailable; no identity invented.

## Requirements assessment

The actual `makeArranger`, `makeProjectResolver`, `makeIdentityResolver`, `makeIdentityRpc` and configuration reader contracts remain connected to actual callers. Source imports use emitted `.js` siblings inside TypeScript; existing CommonJS observer callers use actual `.ts` roots. No compatibility wrapper, fake entrypoint, application JavaScript import in the leaf production closure, unchecked boundary cast, `any`, suppression or strictness/config weakening was introduced.

Direct characterization suites now live beside the corresponding typed roots. Comparison of the original test rename diffs with current suites and both handoffs found the original behavior assertions preserved, including linked section coordinates, real browser arrangement/toggle/layout behavior, exited-owned-PID isolation and actual observer inspection. The browser test enables `arrange: { home: temp }` and consumes the real model. The observer/PID handoff uses the actual default libproc reader, injected inventory and owned/local PIDs. Both handoffs are registered Bun tests and awaited; neither is an orphaned helper. Their agreed future owners remain 5-P/I5 and 4d-O respectively.

MIT/NOTICE, supported launch scripts, environment-file restrictions, child environment restrictions and unrelated local tooling are unchanged by this diff. No blanket scanner exclusion was added. Whole-repository scanner failures remain explicitly reported external migration work, not a claimed repository-wide pass.

## Cross-file trace coverage

| Path | Evidence and invariant checked |
| --- | --- |
| `server.js -> sidecar/observer.js -> projects/index.ts -> ProjectDiscovery -> Git/fs` | Actual factory wiring; unknown cwd validation; canonical path proof; 3-line Git tuple validation; stripped `GIT_*` environment plus station guard; timeout/output bounds; four-worker discovery; deduplication with original input alignment, including undefined input. |
| `ProjectDiscovery.evidence -> ProjectAssociation.provenMain -> gitIdentity -> projection` | Batch main proof retained despite cache pressure; unique main candidate; fresh canonical main/Git-dir/common-dir recheck; separate Git directory and disappeared/replaced main rejection; 60-second cache boundary and 256-entry bound. Canonical paths stay private and only opaque identifiers/short labels reach the returned row. |
| `ProjectResolver -> Arranger -> Discovery/RoomFile -> Placement/RoomResolution -> render -> browser model` | Real repository/folder inputs; 300-second info cache; bounded maps and scans; home/root exclusions; nested ancestry, organization dependencies and deterministic cycle resolution; sticky room retention; temporary explicit file overrides; reload/invalid JSON behavior; bounded file handle reads and finally-close. Public arrangement remains opaque room/section identifiers and labels. |
| `observer.refreshHerdr -> identities.resolveMany -> footer -> Capture -> CaptureRpc -> rpc` | Four capture workers; shared refresh state; first-request endpoint admission; timeout/capability failure publication before queued work; pane-local ordinary failures; next-refresh retry. Inventory identity does not substitute for footer output proof. |
| `Capture -> footer/terminal/PID/geometry/revision -> content bracket -> proof` | Footer source/format/pane/text bounds and unique UUID grammar; actual provider/incarnation narrowing; safe PID and birth checks; before/after terminal and birth agreement; configuration recheck; final conditional even-content-revision probe after every other awaited input; no later awaited read before proof publication. |
| `makeIdentityRpc -> Unix socket -> response frame -> finish` | Allowed read methods only; sequence correlation; unknown JSON normalized before field use; UTF-8 chunk decoding; byte bound; single-settlement deadline/error/close handling; timer cleared and socket destroyed on every settled outcome. |
| `configuration/birth -> executeFile -> guardChildProcess` | Existing semantic TOML and libproc Python snippets preserved; size, stat-stamp race, timeout and buffer limits retained; pending config read coalescing and unavailable-result cache retained; guarded child environment. No process enumeration or command-line retention added. |
| `private observer proof map -> inspect -> revalidateAll -> Capture -> observer ownership recheck` | Footer proofs remain outside public inventory rows; proof inputs validated before use; duplicate same-root proofs accepted; conflicting/multiple roots rejected before RPC; current footer/birth recaptured; pre/post-content validation and final observer ownership checks retained. `retain` prunes withdrawn pane ownership. |

Runtime mechanisms are explicit factory injection, CommonJS-to-TypeScript loading under Bun, and the actual browser model's CommonJS export. They were traced through their registered test consumers. Native host capabilities and live Herdr behavior were not independently exercised; existing synthetic/owned-process evidence covers the authorized boundaries. Approval does not assert an atomic native runtime epoch, which the implementation expressly does not provide.

## Dead-code audit

Mode: audit. Authorized actions: inspect and report only; leaf implementation/controller own source changes.

| Candidate | Independent reachability evidence | Disposition |
| --- | --- | --- |
| Three deleted `sidecar/observer-{arrangement,projects,identity}.js` owners | Observer now imports typed projects/identity; typed projects imports typed arrangement; repository-wide old filename search returns no matches. Baseline modules compared against replacements. | Confirmed superseded and already removed. No compatibility owner remains. |
| Three old adjacent JavaScript suites | Complete rename diffs traced to each typed `index.test.ts`; removed coordinating assertions traced to the two actual integration handoffs. | Replaced and removed; supported behavior retained. |
| New class/helper/type exports | Imports and calls lead from actual public factory roots through discovery, association, placement, room loading, capture, transport, validation and refresh. Internal utilities have concrete production consumers. Type-only imports erase from runtime. | Reachable; no unused wrapper or invented entrypoint identified. |
| `parseRemote`, `validateRooms`, `UNASSIGNED`, RPC/configuration factories | Production discovery/file validation/fallbacks and supported direct configuration/socket tests consume these contracts. | Retain. |
| Browser model integration and observer/PID integration JavaScript | Bun test registration plus actual collaborator imports and preserved assertions; specific deferred owners established by approved scope. | Retain as supported handoffs, not duplicate pure suites or dead code. |
| Root Knip 13 / Fallow 3 diagnostics | Recorded paths are unchanged frontend query fixture, legacy control, legacy inspector and remotes owners. No scoped replacement path is reported. | External existing migration owners; no scoped cleanup or scanner suppression proposed. |

Proposed removals: none. Consumer updates still required within this scoped package: none. Final-reference audit found no obsolete module filename. Missing registry/config evidence: none for these leaf owners. Audit complete; no confirmed scoped leftover remains. Existing root scanner failure is not hidden or converted into a clean result.

## Language clean-code assessment

JavaScript/TypeScript: `wnz-clean-code-js`; 8 candidates considered, 8 dismissed, 0 findings:

1. Two pool helpers: different actual input contracts (known repository units versus arbitrary unknown cwd values); existing bounded responsibilities do not justify a shared abstraction.
2. Class and closure splits: state belongs to real caches, refresh admissions or recursive room resolution; exported factory call sites remain simple.
3. Shared `clean`/opaque utilities replacing local copies: actual producers supply strings, hash inputs and label limits preserve behavior.
4. Removal of provider comparison from `sameTerminal`: both operands are narrowed Codex terminals through actual incarnation/proof validation; provider mismatch remains rejected at the boundary.
5. Object normalization helpers: malformed socket/PID/pane evidence remains unavailable rather than trusted; typed callers consume validated fields.
6. `EXPECTED_TRUE`/`EXPECTED_FALSE` and fixture element helpers: verbose but preserve original oracles and provide strict fixture narrowing; no actionable defect.
7. Moved model integration: actual arrangement option and actual model remain connected, with stable-seat and linked-section assertions retained.
8. Configuration/cache and proof helper extraction: one owner per state/invariant, no duplicated authoritative contract or behavior-changing error path found.

Embedded Python: `wnz-clean-code-py`; 2 candidates considered, 2 dismissed, 0 findings. The compact TOML parser remains the same bounded semantic parser and safely handles unexpected tui/status_line shapes. The compact ctypes libproc structure remains the same single-PID, size-checked native boundary with JSON-only output. Neither was newly abstracted or broadened; reformatting unchanged scripts would not address a concrete scoped issue.

## Verification evidence and limits

Reviewer fresh read-only commands:

- `git status --short`, staged stat/name-status/name-only inventories and HEAD resolution: scope matches supplied 36 raw / 33 rename-aware paths and baseline.
- `git diff --cached --check`: exit 0.
- `git diff --exit-code`: exit 0; no unstaged delta.
- `git ls-files --others --exclude-standard`: no output.
- Repository `rg` for old production/test filenames: no matches. Import/export/caller scans independently confirm replacement reachability and no scoped suppressions/casts.

Reused unchanged verification evidence, as instructed rather than duplicating the controller's checks:

- Controller's final focused rerun: 7 pass, 0 fail, 6 files, 5.30s. Independently inspected implementer's corresponding final focused log: 7 pass, 0 fail, 6 files, 5.61s.
- Full test log inspected: 62 pass, 0 fail, 49 files, 50.91s. Subsequent bounded export cleanup and Unicode path acceptance edits have final focused, strict/build, emitted smoke and owned lint/format evidence in the supplied report.
- Supplied root/runtime/exact-leaf strict compilation, runtime build and emitted smoke evidence reviewed. Exact-leaf temporary project preserves runtime compiler options and uses actual factory/test roots, not fake entrypoints. Emitted smoke exercises real synthetic Git grouping/privacy plus injected footer capture/revalidation.
- Supplied scoped Fallow evidence: zero findings in each leaf owner. Root Knip/Fallow logs inspected and retain their failing status with the external diagnostics above.

No source changed during review; no test/build rerun was necessary to resolve a suspected defect. These are reviewed verification signals, not a claim that this reviewer independently reran the test/build suite. No live integration coverage claimed.

## Reviewed file manifest

Deleted owners: `sidecar/observer-arrangement.js`, `sidecar/observer-identity.js`, `sidecar/observer-projects.js`.

Caller/handoff paths: `sidecar/observer.js`, `sidecar/observer.test.js`, `sidecar/observer.identity-process.test.js`.

Arrangement: `src/sidecar/arrangement/common.ts`, `discovery.ts`, `index.test.ts` (renamed old arrangement suite), `index.ts`, `model.integration.test.js`, `placement.ts`, `room-file.ts`, `rooms.ts`, `types.ts`.

Identity: `src/sidecar/identity/birth.ts`, `capture-rpc.ts`, `capture.ts`, `configuration.ts`, `evidence.ts`, `execute.ts`, `index.test.ts` (renamed old identity suite), `index.ts`, `refresh.ts`, `revalidation.ts`, `rpc.ts`, `types.ts`.

Projects: `src/sidecar/projects/association.ts`, `discovery.ts`, `identity.ts`, `index.test.ts` (renamed old projects suite), `index.ts`, `types.ts`.

Unavailable intended files: none. Blocking findings: none. Non-blocking findings: none.
