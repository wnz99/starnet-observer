# Task 4a/4b full-scope independent re-review

## Findings and verdicts

No High, Medium, Low or Nit findings established.

- Requirements: **APPROVED** for bounded 4a/4b checkpoint and the included C0 browser-path policy changes.
- Quality: **Approved**.
- Overall: **Clean / Approved**. Full original checkpoint scope was reviewed, not only the latest fix.
- The prior emitted-client lifecycle verification gap is resolved. This is not approval of whole Task 4, the complete refactor, or later C0 shared-contract work.

Independent reviewer leaf; no delegation, source edits, staging, commits, branch operations or PR comments. Applied wnz-code-reviewer, wnz-dead-code audit, wnz-clean-code-js, clean-code-tools, wnz-test-quality and verify-before-complete. Requested gpt-6.1-sol / medium; resolved provider/model identity is unavailable from this host. No alternate identity was invented.

## Scope and evidence

Worktree: /Users/davidfava/Projects/Personal/starnet-observer-typescript-integration. Branch: wip/typescript-refactor-integration. Base 2883d61; HEAD 7420c520547a012bc5bde8ca9f2fa93fe58227d2 plus four unstaged files: eslint.config.mjs, tsconfig.browser.json, server.sqlite.test.js and src/sidecar/sqlite/client.test.ts. Current base-to-tree scope is **78 raw paths / 72 rename-aware paths, 4498 insertions / 2504 deletions**, including deletions, moves and additions. No untracked files. The original checkpoint contributes 77 raw paths; browser compiler policy adds the remaining path.

Requirements: approved semantic revision 4 PLAN and /tmp/starnet-ts-task4ab-review-brief.md. Source and diff were authoritative; supplied reports/logs were evidence leads. All new production owners, original replaced implementations, changed configuration, mechanical consumer diffs, native source and relevant characterization/new tests were inspected. Exact byte comparison found zero mismatches between unchanged checkpoint paths and integration tree; Swift bytes equal baseline. Fresh status confirmed precisely the four stated edits. Original parked checkout was not modified; its snapshot preservation is controller-owned evidence, not independently re-proven here.

Excluded future ownership: 4c full inspector/transcript migration and helper coordinating test conversion; 4d remaining arrangement/projects/identity/observer migration; Task 6 server/HTTP test migration; new shared bootstrap/theme contracts. Their absence is not a gap in this bounded package. Emitted adapter closure is limited to existing typed leaves and worker, not the not-yet-migrated observer graph.

## Deep trace coverage

1. **Entrypoints/build/resources:** package build:runtime executes tools/build.ts with --no-env-file. Strict runtime compilation has allowJs=false and explicitly registers the actual dynamic worker. Staging stays under validated generated dist; compilation/asset-copy failure preserves prior output. Tests recursively inspect every emitted application import, reject unexpected dependencies, exclude tests/fixtures, compare copied Swift bytes and execute emitted native/overseer/root fixtures from another cwd. Native compilation targets only a synthetic output and never launches inventory. Runtime root resolver derives source/emitted install root from module location; server injects repository/public roots explicitly; config/default rooms consume the same owner.
2. **SQLite/source independence:** observer supplies shared client to bus/helper consumers. Client uses a direct source .ts / emitted .js URL relative to import.meta.url; empty worker environment and exactly three path fields cross workerData. Worker validates unknown data, closed operations and correlation, selects through private snapshots and validates operation-specific results; parent validates again and requires inspection id correlation. No SQL/functions/secrets enter workerData. Malformed inspection body cannot escape to sanitizer/HTTP. Metadata does not select body. Snapshot stat/copy/query/stat proof, three attempts, 64 MiB bound, WAL/journal handling, private modes, immediate close and finally cleanup retain baseline semantics.
3. **Lifecycle:** active slot reserved before asynchronous startup; one worker, bounded eight-job queue, inspection priority, metadata coalescing and admission deadlines remain. Timeout/crash invalidates generation, rejects pending work, quarantines until native exit, never replays inspection, retries failed owned-root removal before replacement and unrefs worker. Close is idempotent, waits for unpublished startup ownership, revokes only owned roots promptly, sanitizes cleanup errors and does not await stalled native continuation. The fix selects one client path for direct and both generated probes, resolves matching redaction singleton and replays the original suite against emitted client. Explicit test file plus exact suite pattern prevents recursive discovery. Child completion, one collected/passing test and zero failures are asserted; child failure rejects execFile.
4. **Bus/relay/privacy:** immutable source incarnation plus message tuple determines identity; source replacement and immutable-field mutation reject old inspection proof. Failed reads revoke reuse while retaining prior rows/time. Relay time-bound expiry/future-skew re-selection preserves message observation time. Optional malformed relay tables degrade to local view. Public projection selects safe message fields, uses exact/ambiguous pane joins and copies relay/peer arrays. Worker raw text is redacted by parent before clipping and API exposure, using the parent graph's current known secrets.
5. **Helpers:** bounded edge selector feeds graph candidates; transcript evidence proves lineage. Duplicate parents, unknown status and cycles are rejected. Ancestor-first ownership, direct/ancestor Claude conflict withdrawal, descendant removal, depth/total/nearby caps, evidence precedence and freshness retain baseline algorithms. Committed bindings are restricted to published ids and checked again after awaited inspectChild. Actual JS transcript methods/callers match the consumed contracts; no ambient typed-JS shim substitutes for implementation. Partial HelperRow remains deliberate for existing characterization/legacy consumers.
6. **Desktop/native:** observer injects guarded executor and clock. Lazy build hashes exact source, architecture and compiler output. Canonical cache ancestry, ownership/mode/symlink/link-count checks, exclusive compile root, atomic non-overwriting link installation and finally cleanup remain. Inventory validates allowlisted identity and clears failures. Inspection checks native identity and current inventory after await, redacts before clipping, exposes unknown roles/unavailable stats and does not persist loaded text. Swift is byte-identical; only inventory/inspect commands, bounded public AX reads and before/after identity proof remain.
7. **Overseer:** server, observer and control share actual typed state owner. Bounded O_NOFOLLOW record read, endpoint/pane/workspace/terminal/provider/native-session proof, exclusive reservation directory, atomic private record rename, abandoned uncertainty, exact expected-record comparison and absence-based release preserve contracts. Existing cross-process/restart tests still exercise real filesystem boundaries.
8. **Mechanical consumers/policy:** every removed inspector field/redaction/unavailable consumer now targets the single typed owner. Observer, remotes, presentation, control, transcript and tests reference actual migrated files. Worker dynamic entry is registered in runtime/Knip/Fallow. Browser ESLint now covers actual src/browser; browser compiler includes actual browser paths and portable shared types with types=[] and all strict flags retained. No fake input, ignore or production-rule weakening was introduced. Existing shared types are portable type-only dependencies; no privileged browser ambient is added by TypeScript. New C0 contracts were not reviewed or claimed.

Dynamic boundaries explicitly reviewed: Bun source extension resolution, import.meta.url worker selection, worker postMessage events, generated subprocess imports, lazy createRequire('bun:sqlite'), injected native executor and legacy whole-module inspector require. Existing emitted/source execution tests provide runtime evidence where ordinary import scanning is insufficient. No unresolved in-scope trace gap remains.

## Test-quality assessment

Existing helper suites retain real transcript collaborators; independent diff shows only import changes and a semantically identical quote escape. All original SQLite suite assertions remain: **70 old / 70 current assertion calls**. Bus/relay conversion preserves exact oracles; must() rejects missing fixtures, SnapshotFixture delegates to real bun:sqlite, and typed constants retain exact true/false comparisons. Desktop and overseer assertions remain at supported identity/privacy/cache/persistence boundaries. No skip/todo/only directive or type suppression was found in scoped owner tests.

New tests cover distinct malformed transport/correlation, source/emitted filenames, empty env/allowlisted data, source byte/listing preservation, runtime roots/import closure, native source/hash, failed build preservation and alias rejection. Emitted lifecycle wrapper reuses original public-outcome assertions rather than duplicating the long fixture. It genuinely executes emitted client/worker imports and both generated cleanup/unref client imports; native-stall fixture is intentionally synthetic, as in original oracle. Real HTTP sections stay with current server owner. No additional test or duplicated harness was justified.

## Dead-code evidence contract

- **Mode/authorization:** read-only audit of complete scope; only this requested /tmp report written. No cleanup authorization exercised.
- **Scope:** replaced desktop/overseer/bus/helper/client/worker JS, test moves, Swift move, inspector field exports, callers, build/runtime roots and compiler/scanner registrations; future domains excluded as above.
- **Reachability:** production entry server/observer consumes typed factories; helper traversal owns graph/evidence/edge selector; client dynamically loads explicit worker; worker reaches typed bus/snapshot/helper selectors; desktop reads sibling Swift copied by build. Build is reached from package script and tests. Shared inspection/observer contracts have real typed consumers. All new owners are consumed; no speculative compatibility wrapper remains.
- **Removals:** replaced implementations/test locations are absent. Consumers and generated worker/native paths were updated. No stale executable old adapter/worker/native reference found by final searches. No proposed in-scope removal.
- **Retained candidates:** helper JS tests retain real transcript integration until 4c; server SQLite suite retains HTTP/native integration until Task 6. Generated lifecycle subprocesses, SQLite fixture adapter and dynamic worker/native resource are supported entrypoints despite lacking ordinary imports. Legacy inspector exports have concrete whole-module consumers; zero scanner references do not prove dead code. Remaining control/remotes/queryspine diagnostics retain later owners.
- **Verification:** fresh source/reference searches, checkpoint byte/deletion parity, Swift equality, assertion preservation and diff check. Reused unchanged scanner evidence: Knip 13 legacy exports; Fallow 3 old control exports, no unused files/unresolved imports/cycles/owned findings; dupes below unchanged threshold. Latest edits change test selection and real browser policy paths, not production reachability; another full scanner run was unnecessary. Fallow architecture/policy detectors are unconfigured, so their zero counts are not a measured pass.
- **Gaps/disposition:** audit complete; no confirmed obsolete scoped artifact. No claim that later domains or whole repository are clean.

## Clean-code assessment

Applied wnz-clean-code-js to TypeScript/JavaScript and clean-code-tools evidence workflow. No MCP lookup needed: inspected local contracts resolved candidate hypotheses. No style concern promoted to Medium.

- TypeScript: **7 considered / 7 dismissed**: stop boolean has named stopAfterExit call; SnapshotRead owns exception cleanup; graph/traversal classes have single shared state ownership; HelperRow partial shape preserves actual consumers; operation validators enforce distinct transport boundaries; native/build factory wrappers have concrete consumers; emitted lifecycle wrapper earns its subprocess boundary and reuses one established oracle.
- JavaScript: **4 considered / 4 dismissed**: retained long characterization suite preserves independent outcomes; server-owned test has real HTTP dependency; mechanical import splits eliminate duplicate owner; environment-selected fixture path centralizes all three client probes and matching redaction owner without production configuration leakage.
- Swift: language checklist for correctness/resource ownership/clarity, **1 considered / 1 dismissed**: resource-path relocation is handled by consuming TypeScript/build; bytes unchanged, no Swift refactor needed.
- JSON/compiler/scanner configuration: policy/data review, not source-language refactor; strictness, ambient separation, actual entry registration and exclusions checked. No finding.

## Verification and limits

Fresh commands in this reviewer turn, after final edits:

- bunx tsc -p tsconfig.runtime.json --noEmit: exit 0.
- bunx tsc -p tsconfig.tools.json --noEmit: exit 0.
- bunx tsc -p tsconfig.browser.json --noEmit: exit 0.
- bunx eslint src/sidecar/sqlite server.sqlite.test.js --max-warnings 0: exit 0.
- bunx eslint eslint.config.mjs --max-warnings 0: exit 0.
- git diff --check 2883d61: exit 0.
- Scope/byte assertions: 78 raw / 72 rename-aware paths; no untracked; zero unchanged-checkpoint mismatches; 70/70 SQLite assertions; Swift exact baseline equality; no stale executable references or skipped tests.

Reused final post-fix full-suite log /tmp/starnet-ts-task4ab-fix1-tests-final.log: **59 pass / 0 fail / 47 files, 49.62s**. Source native trace: 11000 ms stall / 201 ms timeout / 0 ms close / 117 ms unref subprocess exit. Emitted trace: 11000 ms stall / 203 ms timeout / 0 ms close / 47 ms unref exit. Both scratch-empty after continuation; source bytes and ENOENT assertions execute before completion. Focused post-fix log separately records 4 pass / 0 fail. Final runtime-build log records successful emission. These logs were inspected and source remained unchanged; full suite/build were not redundantly rerun during this read-only review. Whole-repository lint/scanners remain diagnostic, not globally green.

No private input contents, real desktop/agent inventory, SSH, live control, provider or paid run was used. Actual macOS Swift compile evidence is synthetic emitted-source compilation in retained full-suite test, not live desktop execution.

## Full rename-aware path inventory

```text
M	.fallowrc.json
M	eslint.config.mjs
M	knip.json
M	package.json
M	server.js
R095	sidecar/observer-sqlite-worker.test.js	server.sqlite.test.js
M	sidecar/control.js
M	sidecar/control.test.js
D	sidecar/observer-bus.js
D	sidecar/observer-desktop.js
D	sidecar/observer-desktop.test.js
D	sidecar/observer-helpers.js
M	sidecar/observer-inspector.js
M	sidecar/observer-remotes.js
D	sidecar/observer-sqlite-client.js
D	sidecar/observer-sqlite-worker.js
M	sidecar/observer-transcripts.js
M	sidecar/observer-transcripts.test.js
M	sidecar/observer.js
M	sidecar/observer.test.js
D	sidecar/overseer-state.js
D	sidecar/overseer-state.test.js
M	sidecar/presentation.js
A	src/server/runtime-paths.test.ts
A	src/server/runtime-paths.ts
A	src/shared/inspection.ts
M	src/shared/observer.ts
R080	sidecar/observer-bus.test.js	src/sidecar/bus/index.test.ts
A	src/sidecar/bus/index.ts
A	src/sidecar/bus/inspection.ts
A	src/sidecar/bus/public.ts
R079	sidecar/observer-bus-relay.test.js	src/sidecar/bus/relay.test.ts
A	src/sidecar/bus/relay.ts
A	src/sidecar/bus/selection.ts
A	src/sidecar/bus/sqlite.fixture.ts
A	src/sidecar/bus/types.ts
M	src/sidecar/config/defaults.ts
M	src/sidecar/config/index.ts
A	src/sidecar/desktop/cache.test.ts
A	src/sidecar/desktop/cache.ts
A	src/sidecar/desktop/identity.ts
A	src/sidecar/desktop/index.test.ts
A	src/sidecar/desktop/index.ts
A	src/sidecar/desktop/inspection.ts
A	src/sidecar/desktop/inventory.ts
R100	sidecar/observer-desktop-macos.swift	src/sidecar/desktop/observer-desktop-macos.swift
R099	sidecar/observer-helpers-index.test.js	src/sidecar/helpers/claims.test.js
A	src/sidecar/helpers/contracts.ts
A	src/sidecar/helpers/edges.ts
A	src/sidecar/helpers/evidence.ts
A	src/sidecar/helpers/graph.ts
R099	sidecar/observer-helpers.test.js	src/sidecar/helpers/index.test.js
A	src/sidecar/helpers/index.ts
A	src/sidecar/helpers/traversal.ts
A	src/sidecar/inspector/fields.ts
A	src/sidecar/overseer-state/identity.ts
A	src/sidecar/overseer-state/index.test.ts
A	src/sidecar/overseer-state/index.ts
A	src/sidecar/overseer-state/lifecycle.ts
A	src/sidecar/overseer-state/records.ts
A	src/sidecar/sqlite/client-types.ts
A	src/sidecar/sqlite/client.test.ts
A	src/sidecar/sqlite/client.ts
A	src/sidecar/sqlite/protocol.test.ts
A	src/sidecar/sqlite/protocol.ts
A	src/sidecar/sqlite/snapshots.ts
A	src/sidecar/sqlite/validate-bus.ts
A	src/sidecar/sqlite/worker.ts
A	tools/build.test.ts
A	tools/build.ts
M	tsconfig.browser.json
M	tsconfig.runtime.json
```
