# Native directive classifier review — round 1

No findings. **Clean / Approved** for the complete bounded scope below.

## Scope

Fresh independent reviewer leaf, single pass, read-only source review. Reviewed working-tree changes against HEAD `0cc9ad6d87fd5805d251fe75b174b57b9c73c535` in `/home/david/Projects/starnet-observer-resume`:

- `eslint.config.mjs`: new `no-commented-out-code` wrapper only; existing assertion recognition checked for preservation.
- Rename `tools/quality/boolean-assertions.test.ts` to `tools/quality/lint-classification.test.ts`: both retained tests, shared helper change, and new directive regression test.

Inspected staged/unstaged status, exact scoped diff, full new test file and config, installed vendor implementation, `package.json` discovery/check scripts, and compiler include boundaries. No scoped file was unavailable. Other migration edits, approved fixture exceptions, and prior integration reviews were outside this review. No source edits, rule disables, or bypasses made. Report is outside the repository.

## Trace coverage and assessment

`ESLint.lintText` uses repository config, whose typed plugin registration installs the wrapper. Wrapper calls installed vendor rule with a context inheriting the original context; only report interception changes. Installed vendor `Program` visitor iterates source comments and reports `commentedOutCode` with `loc: comment.loc`. Matching both starting line and column therefore identifies the actual reporting comment. Its complete trimmed value must equal `fallow-ignore-next-line unused-class-member`; prefix matches, appended code, unknown directives, and other comments retain vendor reports. Classification changes only this rule's report for that exact metadata comment. It does not suppress the next line or other rules.

Rule spread preserves metadata, schema, and other rule properties. Plugin spread preserves other rules. Existing boolean-argument wrapper and imported-binding recognition are unchanged. Vendor schema is empty, so no existing option handles the false positive. Installed keyword matching explains the false positive: `class` within the hyphenated rule name matches its word-boundary code regex.

Both retained assertion scenarios keep their sources and exact expected reports; helper's optional string rule ID only filters returned diagnostics. New case uses real ESLint integration and independently specified line/message expectations. It catches both the original failure and overbroad suppression. Rename preserves Bun `*.test.ts` discovery, tools compiler inclusion, and helper lint coverage. Repository search found no stale old-file reference.

Applied `wnz-clean-code-js`: considered three candidates (context-adapter duplication, comment-location lookup, helper parameter), dismissed all three. Existing adapter convention is consistent; installed vendor report contract supplies location; filter parameter directly supports two rule families. No evidence-backed maintainability finding. Dead-code/cleanup assessment found no obsolete helper, orphaned old filename consumer, unreachable wrapper, or duplicated test suite. Applied `wnz-test-quality`: retained meaningful assertion tests and added one integration scenario with genuine-code and near-miss negatives. No extra test requested.

## Verification evidence

Independent lightweight verification ran `node --input-type=module` with actual `eslint.Linter`, original installed rule, and wrapper obtained from imported repository config; exit 0:

- Same regression source, original reports lines **1, 3, 4, 5**; wrapper reports **3, 4, 5**. This establishes red/green against the real unfixed implementation.
- Additional locality and near-miss probe reports **1, 3, 4, 6, 7, 8**, preserving commented code before/after the directive, multiline appended code, extra rule-name suffix, extra punctuation, and `return` code.
- `assert.equal(wrapped.meta, original.meta)` passed.

Read controller-produced `/tmp/starnet-ts-resume/i7-directive-classifier-tests.log`: **3 pass, 0 fail, 6 expectations**, all three actual ESLint integration tests. Reviewer did not rerun the expensive TypeScript project startup or full static suite, as requested. Full repository static/test validation remains the controller's separate gate; this approval makes no claim about the broader migration.

Review completeness: complete for the named directive-classification scope. No unresolved blocking issue or verdict-affecting question.
