# Independent 4c package review

## Findings

### Medium — Preserve exact discriminator membership instead of coercing unknown JSON values

Location: `src/sidecar/inspector/identity.ts:31` (primary). Same regression occurs at `inspector/values.ts:30`, `metadata.ts:30-31,74,85-86`, `claude-helpers.ts:12`, `codex-helpers.ts:101,119`, `tool-kind.ts:9-10`, `conversation.ts:43`, and `transcripts/identity.ts:61,68`.

The deleted JavaScript implementations test enum values directly. The ports use expressions such as `["user", "assistant"].includes(String(record.type))`. JSON arrays such as `["user"]` and `["Agent"]` stringify to valid discriminator literals and pass checks that previously rejected them. This defeats the required unknown-input narrowing and changes behavior at transcript identity, conversation, activity, tool, and native helper claim boundaries.

Independent reproduction through the actual public transcript factory, using a disposable synthetic Claude root containing only this complete row:

```json
{"type":["user"],"sessionId":"00000000-0000-0000-0000-000000000001","timestamp":"2026-10-16T00:00:00Z","message":{"content":"MALFORMED ROW"}}
```

The baseline factory returns `{available:false}`. The staged factory returns `{available:true}`, reports available activity at that timestamp, and emits `MALFORMED ROW` as an **assistant** turn. Thus malformed data can establish a verified ordinary transcript and alter presented roles/activity. Coerced native tool names can also create helper spawn evidence that the original implementation ignored.

Fix: narrow positive enum inputs to strings, or use exact literal comparisons, across all migrated discriminator sites. Do not replace coercion with a blanket string requirement for negative channel filtering: preserve the original behavior of excluding only exact `"analysis"` and `"summary"` values. Missing/other channel values were allowed. Add regression cases for malformed array record type, role, block type, native helper tool name and activity/item discriminator, exercising actual source and emitted producers. Existing characterization suites do not cover these malformed discriminator shapes.

No additional findings identified in the complete reviewed scope.

## Verdict

- Requirements: **Request Changes** — unknown source validation and behavior preservation regress as described.
- Quality: **Request Changes** — the Medium correctness finding blocks approval.
- Outcome: **Issues Found**. Review complete; this is not an Incomplete review.
- Model selector requested: `gpt-6.1-sol`, medium effort. Resolved model identity is unavailable from the host. No external provider was invoked.

## Scope and constraints

Read-only independent reviewer leaf using `wnz-code-reviewer` and its complete `references/deep-analysis.md`, `wnz-dead-code` in audit mode, and `wnz-clean-code-js`. No delegation, source/configuration edits, checkout, commit, live integration, SSH, provider turn, or private input access. Only this requested report and disposable synthetic verification fixtures were written.

Target: `/Users/davidfava/Projects/Personal/starnet-observer-typescript-4c`, branch `wip/typescript-refactor-4c`. Boundary: `357b45bdd8d49501d8bdf3c54e000085dfa3ecc0` HEAD through the complete staged index. Raw scope: 36 paths; rename-aware scope: 34 paths; 4,319 additions / 3,057 deletions. Staged binary-diff SHA-256: `bb8f87f9fc4ce058ca152412df44e7ab6e9a6dff10c4537a2ccf822e2b9f0276`.

Every scoped diff, including deleted implementations and test migration changes, was inspected. No intended file or diff was unavailable. No unstaged or untracked scope discrepancy found. Frozen `inspector/fields.ts` and `redaction.ts` were traced as unchanged dependencies; their Git blob hashes independently match `dbeb8d5449d766058e900bff706935ebeb68ba17` and `a93344b0a71524fa1697a147136122c8ead29e20`.

Exact raw manifest:

```text
M	frontend/app/observer-inspector.test.js
D	sidecar/observer-inspector.js
D	sidecar/observer-transcripts.js
D	sidecar/observer-transcripts.test.js
M	sidecar/observer.js
M	sidecar/observer.test.js
A	sidecar/observer.warm-transcripts.test.js
D	src/sidecar/helpers/claims.test.js
A	src/sidecar/helpers/claims.test.ts
M	src/sidecar/helpers/contracts.ts
D	src/sidecar/helpers/index.test.js
A	src/sidecar/helpers/index.test.ts
A	src/sidecar/inspector/claude-helpers.ts
A	src/sidecar/inspector/codex-helpers.ts
A	src/sidecar/inspector/contracts.ts
A	src/sidecar/inspector/conversation.ts
A	src/sidecar/inspector/helper-state.ts
A	src/sidecar/inspector/identity.ts
A	src/sidecar/inspector/index.ts
A	src/sidecar/inspector/metadata.ts
A	src/sidecar/inspector/tool-kind.ts
A	src/sidecar/inspector/values.ts
A	src/sidecar/transcripts/binding.ts
A	src/sidecar/transcripts/children.ts
A	src/sidecar/transcripts/claims.ts
A	src/sidecar/transcripts/contracts.ts
A	src/sidecar/transcripts/discovery.ts
A	src/sidecar/transcripts/identity.ts
A	src/sidecar/transcripts/index.test.ts
A	src/sidecar/transcripts/index.ts
A	src/sidecar/transcripts/reader.ts
A	src/sidecar/transcripts/resources.ts
A	src/sidecar/transcripts/spawn-index.ts
A	src/sidecar/transcripts/testing.fixture.ts
A	src/sidecar/transcripts/tools.ts
A	src/sidecar/transcripts/windows.ts
```

## Trace coverage

- `observer.js` summary/detail and warm scheduling -> transcript factory -> Reader -> discovery -> Resources -> real filesystem descriptor. Traced exact session identity, complete prefix hashing, full retained-window comparison, before/after descriptor/path verification, O_NOFOLLOW, ancestor component inode/device checks, close-error sanitization, cache expiration, generation preservation/reset, bounded header/tail reads and light/detail response shapes.
- `Reader` -> WindowConsumer -> inspector metadata/conversation/helper consumers -> frozen fields/redaction. Traced JSON as unknown, ordinary/sidechain identity, canonical versus transport aliases, usage deduplication/partial states, redaction before clipping, tool arguments/results, stable turn IDs, output limits and entry/activity semantics. The discriminator finding is on this path.
- `helpers/graph.ts` and `traversal.ts` -> candidate discovery -> binding projection -> private WeakSet -> SpawnProof -> fresh parent read/full spawn index -> corroborating sidecar -> child detail -> repeated ancestry proof. Traced complete-prefix digest rather than sampled sentinels, claim ambiguity/null presence, partial/unavailable index denial, native events, deduplication, initial background scans, cache capacity refusal, pending scan tracking, retain/idle and nested ancestor contradictions.
- Authoritative inspector producer contracts -> helper type-only contracts -> helper inspection -> observer public enrichment. `ChildInspection` success is the direct Snapshot shape; observer adds public id, asOf, inspection identity and provenance. No nested inspection-shape mismatch remains. Runtime type-import cycles are erased; runtime module construction does not introduce a circular initialization dependency.
- Browser backend characterization import and all observer caller import patches traced to new modules. Existing browser inspector remains an independent supported frontend module.
- Migrated assertions reviewed against original transcript/helper tests, including renamed boolean assertion helper semantics, narrow handle wrappers and real SQLite WAL/private-copy assertions. Warm integration function and awaited invocation were relocated with its original behavior checks; its temporary JS ownership belongs to 4d-O. This package does not finish all of Task 4.

Runtime-dependent provider transcript contents and filesystem race schedules cannot be exhaustively proved statically. Synthetic race/budget/identity cases and source tracing cover the intended contracts; no live provider inventories were required or run.

## Independent dead-code audit

Mode/authorization: audit only, bounded to the complete staged package and consumers affected by its replacements. Owner remains the controller/implementer; no cleanup performed by reviewer.

Reachability candidates and disposition:

1. Deleted `sidecar/observer-inspector.js`: obsolete after inspector producer migration. New inspector factory is reachable through transcript windows/binding/index and browser backend characterization. No old backend consumer remains.
2. Deleted `sidecar/observer-transcripts.js`: obsolete after new transcript factory and observer/helper consumer patches. Observer import and test imports use the new producer; no compatibility wrapper remains.
3. Deleted original transcript/helper JS test copies: replaced by the adjacent TS suites; coordinating warm case moved to its awaited dedicated JS suite. Original assertions were assessed in the migration diffs; no obsolete duplicate suite remains.
4. Removed helper-local projection/binding/inspection type copies: replaced by type-only imports from actual inspector producer contracts. Helper graph/traversal/evidence/inspection consume the shared full Projection shape.
5. New internal helpers/classes: imports and call paths connect Resources, Discovery, Reader/ReadPass, Children/SpawnProof, SpawnIndices/SpawnScan, WindowConsumer, ToolConsumer, metadata/conversation/helper consumers and fixture helpers. No confirmed orphaned helper, export or new module found.
6. Retained lifecycle/proof APIs: beginDiscovery, retain, helperMetadata, claudeClaims, inspectChild, spawnIndexIdle and WeakSet binding checks have real runtime/test consumers. Fields/redaction remain supported dependencies. Sparse direct callers do not establish obsolescence.

Independent final-reference command: `rg -n 'observer-inspector\.js|observer-transcripts(?:\.test)?\.js|helpers/(claims|index)\.test\.js' --glob '!bun.lock' .`. Remaining matches refer only to the supported frontend inspector module and its HTML/browser consumers. No backend legacy path remains.

Read supplied Knip/Fallow logs as candidate evidence and checked their paths against ownership: 6 unused exports and 3 dead-code exports are outside 4c. Six duplicate groups likewise lie outside owned 4c changes; an observer.js clone concerns unchanged code. No scoped confirmed leftover needs removal. Audit complete; no missing registry/config evidence or uncertain scoped deletion remains.

## JS/TS clean-code assessment

Applied `wnz-clean-code-js` to production and test changes. Five maintainability candidates considered, five dismissed, zero separate style findings:

- positional tuple signatures preserve required public APIs;
- state-owning classes make mutation/resource ownership explicit;
- bounded-map extraction has actual claims consumers;
- shared fixture assertions and narrow I/O wrappers preserve behavior without casts;
- producer-owned contracts remove duplicated type truth and keep dependencies type-only where appropriate.

The malformed enum coercion is reported once as the Medium correctness finding above, not duplicated as a style finding. No weakened compiler/lint/scanner rules or bypass casts/suppressions were introduced by this diff.

## Verification evidence

Independent fresh checks/reproductions in this review:

- `git status --short --untracked-files=all`, `git rev-parse HEAD`, cached diff manifests/stat and binary-diff SHA-256 established the scope above.
- `git diff --cached --check`: exit 0. `git diff --exit-code`: exit 0; working tree matches index.
- `git hash-object src/sidecar/inspector/fields.ts src/sidecar/redaction.ts`: frozen hashes match the recorded baseline.
- Direct synthetic inspector reproduction: malformed array type was accepted, creating assistant conversation and available activity.
- Public-factory baseline/staged differential reproduction via `bun --no-env-file -e`: baseline `available:false`; staged `available:true` with the malformed row emitted as assistant. Old factories were loaded from `git show HEAD:<deleted path>` in memory; all filesystem input was synthetic temporary data, removed in finally.
- Final reference and bypass searches inspected; no removed backend references or source casts/suppressions found.

Reused unchanged-scope verification supplied by controller/implementer, not represented as independently rerun:

- Root focused run: 5 pass, 0 fail, 4 files, 1417ms after final source edits.
- `bun run test`: log `/tmp/4c-full-tests-final.txt` records 61 pass / 0 fail across 48 files, 51.15s.
- `bun --no-env-file /tmp/verify-4c-emitted.mjs`: reviewed script and log `/tmp/4c-emitted-final.txt`; records 4 pass / 0 fail and recursive 32-module emitted JS closure with zero legacy/source TS application imports. Source fixture reuse contains assertions/helpers and type-only production imports.
- All four configured TS projects, owned strict ESLint, runtime build and repository formatting are reported passing. No configuration changed in this review scope.
- Disposable missing-message and pre-I/O-freshness mutations are reported rejected by their assertions; no mutation source was placed in this checkout.
- Whole-repository lint remains failing with 244 diagnostics outside owned implementation; Knip reports 6 unused exports, Fallow dead-code 3 exports, and Fallow dupes 6 external groups. These are not passing global gates and remain with their existing owners.

No unnecessary unchanged full-suite reruns, optional external checks, paid runs or live integrations performed. This review requests changes for the independently reproduced discriminator regression despite the existing passing suites.
