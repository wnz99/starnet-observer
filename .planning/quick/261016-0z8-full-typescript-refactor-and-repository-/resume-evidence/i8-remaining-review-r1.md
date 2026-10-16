# I8 remaining acceptance/docs/records review, round 1

## Findings

1. **Medium — skill inventory can redirect the record writer outside the shared skill root.** `tools/record-contract.ts:170–181` accepts any nonempty skill name, including `../../.ssh`, and validates its discovery path only by concatenating that name. Extra skills are allowed. An extra skill with that name and `discovery.location = "~/.agents/skills/../../.ssh"` passes the complete validator. `tools/records.ts:44` substitutes the home prefix and passes that path directly to `skillDigest`; lines 20–26 recursively enumerate and read its files. Running the documented explicit writer against such an inventory therefore reads private home files outside the authorized skill inventory. This is a concrete path traversal across the provenance boundary, even though only a digest is written. The read-only native reproduction printed `TRAVERSAL_SKILL_LOCATION_ACCEPTED`; it did not enumerate or read any private directory. Restrict skill names to single valid directory names, validate path containment before enumeration, and reject root/ancestor aliases that resolve outside the authorized shared skill root. Add a synthetic traversal/alias rejection test that proves rejection precedes byte reads.

2. **Medium — semantic MCP details bypass the required closed schema.** `tools/record-contract.ts:155–162` validates individual values but omits the `keys()` check used for every surrounding record. Adding `options.semanticMcp.details.typoKey = true` still passes `validateInventory`; the native reproduction printed `UNKNOWN_SEMANTIC_DETAIL_ACCEPTED`. Both docs acceptance and the writer use this validator, so an inventory violating the explicit unknown-key rejection contract can be accepted and locked. `docs/bootstrap-records.md` requires rejection rather than silently accepting spelling errors; Task 8 specifically requires the exact record schema. Add an exact key check for `client`, `configLocation`, `revision`, `runtimeLocation`, `scope`, `source`, and `transport`, plus a nested unknown-key regression. No generic schema framework is needed.

3. **Medium — the new schema test fails strict compilation.** `tools/record-contract.test.ts:49` casts `badHarness.components` to an unrelated array type containing `testDependencies`. The successful `validateInventory(inventory, manifest)` at line 39 has already narrowed the original object and its clones to `InventoryRecord`, whose component type contains only `entrypoints`. The compiler therefore reports TS2352, preventing the mandatory strict gate from passing. `/tmp/starnet-ts-resume/i8-remaining-types-r3.log` records this exact line and diagnostic with `EXIT_STATUS=2`; current frozen source still contains the same cast. The two tests pass at runtime because Bun does not perform the required TypeScript check. Model the validated component's actual testDependencies field in the shared interface, or retain a correctly typed mutation fixture before narrowing; do not bypass the error through a double cast. Re-run the required tools/root compiler projects after fixing it.

No other concrete defect found in the assigned frozen slice. The readonly probe's deliberately malformed defect stopping at formatting is valid for its stated check/lint nonmutation obligation; it does not establish a second compiler oracle, nor need it do so.

## Verdicts

- Outcome: **Issues Found**; bounded 18-file review **Complete**.
- Requirements compliance: **Request Changes**, for safe skill input handling, nested schema closure, and the strict compilation failure.
- Quality: **Request Changes**, for the same boundary/test-contract defects; no separate style finding.
- Recommendation: **Request Changes** for this slice.
- This does not review or approve Task 8 aggregate integration, hosted CI, final branch review, PR or merge.

## Exact scope and stability

Worktree: `/home/david/Projects/starnet-observer-i8-delivery`.
Base and observed HEAD: `6f4dabe442b1be029b0c32285db9efae8153e480`.
Boundary: full HEAD-to-current staged/working-tree contents, restricted to the 18 paths below. New staged files were read completely. No omitted or unavailable intended file was found; no scoped unstaged delta was observed. The manifest `/tmp/starnet-ts-resume/i8-remaining-frozen-sha256.txt` has SHA256 `745b799a5f652034e5918ab1bca50cdf20d72b8e5bb0106a5cb665a3860f8504`. All 18 byte hashes matched before and after analysis, including the final verification.

- `.bootstrap-lock.json`
- `.bootstrap.json`
- `AGENTS.md`
- `README.md`
- `docs/bootstrap-records.md`
- `docs/development.md`
- `docs/quality.md`
- `docs/sources.md`
- `docs/verification.md`
- `tools/acceptance.ts`
- `tools/acceptance/coverage.ts`
- `tools/acceptance/docs.ts`
- `tools/acceptance/fixture.ts`
- `tools/acceptance/policy.ts`
- `tools/acceptance/tests.ts`
- `tools/record-contract.test.ts`
- `tools/record-contract.ts`
- `tools/records.ts`

Applied project/user AGENTS, approved PLAN Task 8 and disposable-probe inventory, `wnz-code-reviewer` with its complete deep-analysis reference, `wnz-clean-code-js`, `wnz-test-quality`, `wnz-doc-write-expert` with the full bundled OKF v0.1 specification and stricter local documentation profile, and `verify-before-complete`. This is the controller-dispatched independent leaf; no nested delegation. Requested selection was gpt-6.1-sol/medium; host-resolved identity is unavailable.

Reused `/tmp/starnet-ts-resume/i8-core-review-r1.md`, `i8-keyboard-fix-review-r2.md`, `i8-ci-native-review-r1.md`, and `i8-ci-native-review-r2.md` for excluded core/CI scopes. All 14 current core hashes matched `i8-core-frozen-r2-sha256.txt`; workflow hash matched `bb8c1ad754085dbc04c3d7cd5d55e57a679eaf41a4cb89530ff247801968499d`. Those scopes were not reviewed again.

## Cross-file trace coverage

1. `verify:acceptance` package command calls guarded `tools/acceptance.ts`; its mode registry dispatches eight named async probes and awaits each before printing PASS. Unknown names fail before dispatch. Imported test helpers have no top-level execution. Existing `runTestProbes` remains the real Bun runner boundary and is consumed by the colocated acceptance test; the added tests mode first mutates an actual role-geometry expectation in a disposable copy, observes the named assertion failure, restores it, and requires its passing result.
2. Acceptance fixture uses tracked-file inventory to copy current maintained bytes into a new temporary Git repository, preserves executable modes, initializes an isolated commit, installs the frozen dependency graph, then cleans up in finally. Git global/system config is disabled in fixture commands. Optional flock serialization applies only when explicitly configured and clears its inherited lock for children. Command errors, signals, buffers and timeouts are checked. Negative results are recorded with bounded diagnostics. No probe invokes real agent/control/provider APIs. These fixtures assume the normal tracked-input hygiene invariant; real ignored local state is not copied.
3. Coverage mode writes separate type and lint defects into six real owning categories; native tsc diagnostics must contain TS2322 at every expected path and ESLint JSON must contain the exact Clean Code rule per file. Restored type and full lint commands must pass. Quality mode uses the actual typed lint, Knip and Fallow executables, checks intended unused file/dependency/duplicate diagnostics, restores manifest/files, and requires restored scanners to pass. These protect wiring rather than mocked checker assumptions.
4. Readonly mode hashes tracked names/content, raw index bytes, and porcelain status around passing and failing full check/lint calls. The malformed defect is intentionally staged and restored in the disposable repository. Hook mode exercises both index/worktree formatting directions with the real formatter and the same digest invariant; push calls cover clean HEAD/static execution, zero deletion OID, untracked dirty state and an older pushed commit. Existing hooksPath refusal and repeat worktree-local installation are checked with a linked checkout whose effective configuration must remain absent. Underlying setup, hooks, installer, formatter/check wrappers and version commands were traced as callees, without changing them or rerunning their full gates.
5. Hygiene mode uses only synthetic `.agent-local.json` and `.env`; ignored files are allowed, forced tracking must fail the native hygiene owner, and digest/status checks protect restoration. Replay runs real setup twice, compares maintained bytes/index/status and worktree hook registrations, verifies the lock remains unchanged, then makes a deliberate generated-file edit. Setup must preserve that edit; docs validation must report its digest drift. Setup itself does not call the records writer, skills installer or MCP client.
6. Docs acceptance parses actual YAML through Bun.YAML, validates required string fields, checks canonical index entries and local linked file existence, and checks MIT/NOTICE. Inventory validation reaches manifest runtimes/harness/component/CI/feature/option/skill contracts. Record validation checks exact top-level lock fields, contract SHA256, inventory/runtime/skill equality, exact tracked policy inventory and per-file bytes, and direct manifest dependency equality. `policyBytes` rejects final or ancestor symlink aliases and unsupported/private policy paths before reading bytes; its tests cover both alias cases. The separate skill-directory read boundary is the exception identified in finding 1.
7. Explicit `bun --no-env-file tools/records.ts` calls validateInventory, derives installed skill digests from sorted relative paths and byte hashes with cache exclusions, serializes inventory, derives allowlisted tracked public-policy hashes, and writes the lock last. It is a named scanner root and documented explicit mutation command, absent from setup/check/hook scripts. Current lock digests match the reviewed bytes. The writer is not transactional and requires the documented accepted-input/final-validation discipline; no unrequested redesign is proposed.
8. Reviewed root README/AGENTS and all five scoped concepts against package commands, scripts, scanner roots, current record data, existing corpus conventions/index, and supplied MCP/manual visual receipts. No private machine paths or secrets were introduced. Commands retain emitted entrypoints and environment/privacy boundaries. Documentation distinguishes configured CI from actual platform evidence, historical Task 7 results from Task 8 requirements, actual local MCP metadata/search from provider turns, and screenshot judgment from automated browser/security results. No new live desktop/SSH integration claim was found.

Dynamic boundaries remain runtime-dependent: external command execution and operating-system hook behavior, installed skill provenance, actual Chromium rendering, and hosted matrix execution. Static tracing plus inspected receipts does not certify those executions on the final integration head.

## Dead-code and clean-code assessment

Dead-code/reachability candidates considered: **8; all dismissed; zero required removals**. The five acceptance helper modules are all registry/import reachable; the shared record contract serves docs/writer/tests; the explicit writer is a documented CLI and scanner root; the old runner probes remain consumed by both the CLI and existing test. No deleted/replaced consumer was stranded in this slice. Core artifact/demo cleanup remains covered by the reused core reports rather than a duplicate audit.

TypeScript clean-code assessment used `wnz-clean-code-js`: **6 candidates considered; all dismissed as separate maintainability findings**. Mode dispatch, fixture command wrapper, policy helper extraction, document/record validation split, narrow shared contract and writer digest ownership each have actual callers and a clear responsibility. The record boundary defects above are behavioral findings, not style issues. JSON/Markdown review used local record and documentation governance; no generic formatting rewrite was requested. Structural-tool diagnostics were treated as evidence rather than repeated as findings. No new scanner suppression was introduced in this slice.

Test-quality assessment identified two material missing negative partitions: traversal/escaping skill roots and unknown semantic detail keys. Existing policy alias tests protect a different boundary and do not catch either. Existing runtime/harness tests detect their intended runtime failures but currently fail the strict compilation requirement. The native behavior mutation and runner-negative fixtures observe actual independent failures; six-owner type/lint tests and native scanner negatives are meaningful wiring proofs. Separate unit tests mirroring every acceptance helper would add little evidence and are not requested.

## Documentation audit

Reader: developer installing, verifying, replaying or recovering this repository setup. Primary action: run the pinned supported commands and interpret evidence honestly. Reviewed all seven changed prose files end-to-end, using canonical docs/index.md and docs/README.md for placement/metadata/navigation. The complete bundled OKF specification was read; the local profile correctly requires type/title/description and index without frontmatter. Unknown concept metadata remains tolerated, distinct from the closed bootstrap schema.

The audited claim groups were runtime/tool pins; supported launch/test/package commands; build/data roots; public/private asset policy; emitted SSH entrypoint; colocated consumers; production-first ordering; hook ownership/snapshot semantics; read-only checks; environment privacy; replay/drift; lock algorithm and covered inputs; component/option states; dependency pins; installed skill provenance; MCP isolation/recovery; actual metadata/search receipt; YAML/index/license; browser assertion/manual split; and platform/live-integration limits. Current claims match inspected owners or explicitly defer execution evidence. The schema/skill boundary limitations are captured above; no independent stale/outdated/misplaced prose finding was identified. Corpus validation passed on the frozen bytes, but it does not prove correctness of those uncovered schema partitions.

## Verification evidence and limits

Fresh reviewer checks on current frozen source:

- `sha256sum -c /tmp/starnet-ts-resume/i8-remaining-frozen-sha256.txt`: all 18 OK before and after; HEAD unchanged.
- Current 14-entry core manifest and workflow hash: matched accepted scope as stated above.
- `git diff --check HEAD -- <18 scoped paths>`: exit 0.
- `/tmp/starnet-ts-tools/bun-linux-x64/bun --no-env-file test ./tools/record-contract.test.ts`: **2 pass, 0 fail**, exit 0.
- Same Bun executable, `--no-env-file tools/acceptance.ts docs`: **PASS docs**, exit 0; actual YAML/index/local links/license/current schema/digests checked.
- Read-only in-memory inventory mutations through actual `validateInventory`: unknown semantic detail and traversal skill location both accepted, exit 0. No writer invocation or private-path read occurred.

Controller evidence inspected, not rerun or independently certified:

- `i8-acceptance-aggregate.log` contains actual PASS tests, coverage and quality, with intended runner/TS2322/clean-code/Knip/Fallow diagnostics. The logged readonly failing check reaches its intended format rejection. At inspection no PASS readonly/hooks/replay or final aggregate exit was present, so none is claimed.
- `i8-acceptance-hygiene.log` contains PASS hygiene. No final-head aggregate success is inferred from a standalone mode.
- `i8-docs-schema-r3.log`: docs PASS and EXIT_STATUS=0, corroborated by this reviewer's fresh docs execution.
- `i8-remaining-types-r3.log`: exact current test line 49 TS2352 and EXIT_STATUS=2, supporting finding 3. Old lint-r2 shorthand-arrow diagnostics are stale after braces changed and are not reported as current failures. Queued final lint/tools-types logs were empty at inspection; no success claim.
- `i8-mcp-final/receipt.json`: actual Codex CLI 0.162.1 app-server, 11 tools, 316 chunks, unchanged index digest, CC-043/high, zero provider turns. `i8-manual-visual-receipt.json` separately records limited screenshot judgment and its explicit parity/accessibility/live-integration exclusions. Neither receipt was recreated by this reviewer.

No heavy suite, full lint/types/scanner gate, dependency install, browser/native build, hosted CI, provider/network call, real inventory/control/bus operation, repository edit, branch switch or commit was run. The only write is this external report. Controller retains responsibility for final strict gate, complete acceptance/replay/hook evidence, record regeneration after fixes, hosted native platform proof, full-branch review and delivery. This report finishes only the assigned 18-file review.
