# Bounded 4c fix1 report

Status: IN_PROGRESS. Checkout `/Users/davidfava/Projects/Personal/starnet-observer-typescript-4c`, baseline `357b45b`; staged original package preserved. Scope: eight inspector/transcript discriminator production files, adjacent behavioral tests and external emitted verification script only. No staging, commits, branch/config/caller/shared changes or delegation authorized/performed.

Applied wnz-task-implementer, wnz-clean-code-js, wnz-test-quality and wnz-dead-code directly. Model identity unavailable from host. Agent bus registered/listed; no relevance-driven peer message needed because controller explicitly owns integration and this isolated fix scope.

Root cause: coercing unknown enum fields through String accepts JSON singleton arrays. Enumerated all String sites under inspector/transcripts: positive enum checks require exact literals; negative channel exclusion must exclude only exact analysis/summary strings. Stable turn-key conversion, timestamp ISO conversion, Buffer UTF-8 decoding and test byte/name conversions remain intentional.

Dead-code mode: audit followed by authorized bounded cleanup. All affected functions remain on public inspector consume/metadata/helper paths or transcript binding/identity path. No replacement module/API or obsolete helper introduced; final references/scanners pending.

## Reproduction and implementation

Added four adjacent inspector producer tests and one public transcript factory test. Before production edits, `bun --no-env-file test src/sidecar/inspector/index.test.ts src/sidecar/transcripts/index.test.ts` produced 2 pass / 5 fail (`/tmp/4c-fix1-before.txt`): fabricated Claude identity/turn/activity, malformed text blocks, fabricated Codex activity and nonexact channel exclusion all rejected by independent expected assertions.

Corrected every enumerated positive discriminator coercion with exact equality or direct literal-array membership. Tool-kind retains exact array membership using private readonly unknown[] constants to avoid coercion while preserving existing complexity bound. Negative channel filtering uses two exact exclusions. No generic validation layer, casts, wrappers or suppressions added. Initial lint found tool-kind complexity and two new literal-boolean test calls; corrected through direct membership and existing DETAIL_READ/assert patterns.

Tests observe public consume/snapshot and real factory read/bindChild/read-with-issued-binding paths. Synthetic temp roots contain only fixture JSON; cleanup is in finally. Malformed singleton arrays and object cases cannot claim identity, ordinary activity, role, block text, tool kind, helper call/spawn/event. Valid Agent/Task, item/activity, block text and ordinary user/assistant rows remain accepted. Missing/null/object/array channel values remain allowed; only exact analysis/summary strings exclude messages. Existing characterization assertions unchanged.

External `/tmp/verify-4c-emitted.mjs` now also redirects the adjacent inspector suite to emitted JS. First source run after fixes: 9 pass / 0 fail, 4 files. First emitted run: 9 pass / 0 fail, 32 recursive JS modules with zero legacy/source TS application imports. Final verification will rerun after lint correction.

## Final bounded-fix handoff

Status: DONE_WITH_CONCERNS. Confirmed Medium discriminator issue corrected. Concerns below are unchanged repository-wide findings outside fix ownership. Stop source edits here for controller's full-original-scope independent R2 review.

Changed production paths:
- `src/sidecar/inspector/identity.ts`: exact ordinary Claude record types.
- `src/sidecar/inspector/values.ts`: exact message text block types.
- `src/sidecar/inspector/metadata.ts`: exact Codex roles/activity/entry types; exact negative channel exclusions.
- `src/sidecar/inspector/claude-helpers.ts`: exact native Agent/Task names.
- `src/sidecar/inspector/codex-helpers.ts`: exact activity kinds/item wrapper types.
- `src/sidecar/inspector/tool-kind.ts`: exact Codex call/output membership.
- `src/sidecar/inspector/conversation.ts`: exact tool output text block types.
- `src/sidecar/transcripts/identity.ts`: exact Claude identity/conflict types.

Tests: added adjacent `src/sidecar/inspector/index.test.ts`; appended public factory regression to `src/sidecar/transcripts/index.test.ts`. External emitted runner update: `/tmp/verify-4c-emitted.mjs`. Existing regression test oracles preserved. No caller/shared/config/FLOW/GSD/other-checkout edits, staging or commits performed.

### Fresh verification after final source edits

Commands ran from assigned checkout. Tooling PATH prefixed `/Users/davidfava/.local/share/starnet-quality-tools/node-v24.19.0-darwin-arm64/bin` for Node tools; Bun 1.3.13.

- `bun --no-env-file test src/sidecar/inspector/index.test.ts src/sidecar/transcripts/index.test.ts src/sidecar/helpers/claims.test.ts src/sidecar/helpers/index.test.ts`: PASS, **9 pass / 0 fail**, 4 files, 1331ms. `/tmp/4c-fix1-focused-final.txt`.
- `bun run test`: PASS, **66 pass / 0 fail**, 49 files, 39 expect() calls, 50.05s. `/tmp/4c-fix1-full-final.txt`.
- `bun run typecheck`: PASS, all four configured strict projects (root, runtime, browser, tools). `/tmp/4c-fix1-types-final.txt`.
- `bunx eslint src/sidecar/inspector src/sidecar/transcripts --max-warnings 0`: PASS, zero findings. `/tmp/4c-fix1-eslint-final.txt`.
- `bun run check:format`: PASS, whole repository. `/tmp/4c-fix1-format-final.txt`.
- `bun run build:runtime`: PASS, actual unbundled runtime emission. `/tmp/4c-fix1-build-final.txt`.
- `bun --no-env-file /tmp/verify-4c-emitted.mjs`: PASS, **9 pass / 0 fail**, 4 redirected suites, 2.29s; recursive closure **32 emitted JS application modules**, zero legacy/source TS application imports. `/tmp/4c-fix1-emitted-final.txt`.
- `git diff --check` and `git diff --cached --check`: PASS.
- Cached original package binary diff SHA-256 remains `bb8f87f9fc4ce058ca152412df44e7ab6e9a6dff10c4537a2ccf822e2b9f0276`: index unchanged.
- Frozen field/redaction hashes remain `dbeb8d5449d766058e900bff706935ebeb68ba17` / `a93344b0a71524fa1697a147136122c8ead29e20`.

### Fresh scanner/global diagnostics

- `bun run lint`: FAIL, unchanged **244 out-of-scope errors**, zero owned inspector/transcripts errors. `/tmp/4c-fix1-lint-final.txt`.
- `bunx knip --no-progress --no-config-hints`: exit 1, same 6 outside exports (frontend queryspine fixture, sidecar control, observer-remotes). `/tmp/4c-fix1-knip-final.txt`.
- `bunx fallow dead-code`: exit 1, same 3 outside control exports. `/tmp/4c-fix1-dead-final.txt`.
- `bunx fallow dupes`: exit 0, same 6 outside clone groups / 105 duplicated lines / 0.4%, no owned group. `/tmp/4c-fix1-dupes-final.txt`.

### Dead-code evidence and self-review

Mode/authorization: audit plus authorized bounded cleanup under supplied fix brief. Baseline staged package at HEAD357b45b; only listed owned files and external runner changed. Initial audit enumerated coercion sites; final String search leaves only intentional stable turn IDs, ISO dates, UTF-8 byte decoding and existing test conversions. All removed expressions were inline coercions; no orphan module/export/helper/test/config/doc was created or removed.

Reachability by step:
1. Inspector exact-membership changes stay reachable from public consume/consumeMetadata/consumeHelperMetadata and snapshot. TextBlocks supports ordinary messages/native notification text; outputText supports tool output; toolKind serves inspector Conversation and transcript ToolConsumer. New readonly membership constants have direct production uses. Supported, not obsolete.
2. Transcript identity changes stay reachable from ChildIdentity during bindResource and recordIdentityConflicts during retained/tail proof. Public factory test exercises actual filesystem and returned WeakSet-authorized binding read. Supported, not obsolete.
3. Test/runner additions discovered by native Bun and redirected to actual emitted modules. Fixtures own temporary roots and remove them in finally; runner removes disposable files in finally. No production testing wrapper added.
4. Final legacy reference search (`rg -n 'observer-inspector\\.js|observer-transcripts(?:\\.test)?\\.js|helpers/(claims|index)\\.test\\.js' --glob '!bun.lock' .`) leaves only supported frontend inspector references. No replaced backend reference remains. Scanners confirm zero scoped unused/duplicate finding. No confirmed cleanup candidate remains; no out-of-scope cleanup is necessary for this fix.

Retained candidates: public helper/projection/transcript interfaces and intentional conversions remain required by concrete caller paths above. No uncertain deletion candidate. Removal effects: no declarations/API removals, only defective inline coercions replaced, so docs/config consumer updates are not applicable.

Self-review checked every changed production branch against original exact membership semantics, negative-channel permissiveness, neighboring callers and final tests. No remaining scoped concern found. Reproduction-before-fix establishes test sensitivity without additional source mutation. No live/private source, native inventory, control/SSH/provider/paid run occurred. Full-package independent review remains controller-owned; this report does not approve the package.
