# Task 7 scoped clock and export cleanup addendum R1

No findings. **Clean / Approved** for the three-path amendment below. Requirements and quality: Approved. High 0, Medium 0, Low 0, Nit 0.

Independent read-only reviewer leaf; applied wnz-code-reviewer, wnz-clean-code-js, wnz-test-quality and verify-before-complete. No repository edits or heavy checks. This addendum extends i7-final-integration-review-r1.md only for these deltas. All other accepted scope remains unchanged. It does not declare Task 7 complete or scanners green.

## Exact scope and integrity

Target: /home/david/Projects/starnet-observer-resume, HEAD 0cc9ad6d87fd5805d251fe75b174b57b9c73c535. observer-ui.test.ts compared against /tmp/starnet-ts-resume/i7-ui-before-clock-fix.ts, independently hash-matched to accepted UI manifest hash 4aca304b59ed5924ae022742bfb10e77320a3b79256358a9079778cff4c122ff. The two type-only export changes compared against closure-before snapshots, independently hash-matched to the updated closure manifest. All scoped content available. Current hashes:

- `src/browser/app/observer-ui.test.ts`: `fae0972429dd33684d5fc3a5576a87d15ebf7fc67c5a48454ea529062c384c68`
- `src/browser/app/roster-ports.ts`: `762b0eb6e2b7452548fed473eb97009a4efad1c5f52e51938fc99c3b90aa5dea`
- `src/browser/view/types.ts`: `a97a56cb096d0347996a8271a98ddfdb8ea91843c4a7c883f21dc00ac72c5cb7`

## Clock/oracle trace

Observed prior root focused log reports 56 pass, 1 fail; original observer-ui failure is the stale-deadline repaint assertion. Before amendment, observedAt was Date.now()-5995, two real notifications rendered before repaint count capture, then a real 12ms sleep elapsed. Rendering can consume the five milliseconds of freshness before the pending notification completes, causing legitimate early repaint and no second repaint at fireTimers. This is a wall-clock scheduling race in the evidence.

The amendment passes the existing UiScenario.now callback through mountScenario's actual MountOptions.clock.now. All other cases use Date.now through the same callback. Only this case sets deadlineNow=agingAt, supplies observedAt=agingAt-5995, performs both notifications while time is frozen, advances that same injected clock by 12ms, then invokes the unchanged fake timer dispatcher. Reset to undefined immediately follows the assertions. No production timing logic, validation or state is replaced.

Fresh source trace: mountScenario clock reaches AppState freshness, render/header and FreshnessDeadline.now. Deadline.arm still registers a real owned callback through the existing fake scheduler. fireTimers copies callbacks, clears timer inventory and calls those actual registered callbacks. FreshnessDeadline generation/active guards still run, then render recalculates actual stale state and invalidates actual View boundary. The pre-advance Live assertion, post-fire exact Stale text, last-known row text, increased invalidation count and zero timers all remain. A missing deadline callback, missing render/repaint or retained stale timer would still violate these outcomes. Earlier due-at-observedAt+6s assertion remains unchanged, covering scheduler delay independently. This case controls elapsed time, not the expected outcome.

Independent TypeScript AST extraction compared every complete assert/assert.* call in lexical order: all 465 main-suite assertion expressions identical. Current five-suite inventory remains 610 assertions, comprising the accepted 607 original oracles and three accepted positive controls. No original assertion was removed or weakened. Await count honestly changes: main 38 to 37, five-suite total 67 to 66. The removed leaf await is exactly `await new Promise((resolve) => setTimeout(resolve, 12))`; outer await-expression text changes only because its nested body changed. No scenario serialization or asynchronous production operation was removed. The original 67-await literal-preservation statement is superseded for this justified timing seam only.

Test-quality assessment: preserves the same user-visible stalled-request freshness contract, independent literal expectations and actual timer/render composition. Reuses existing clock seam; no new harness, retry, assertion deletion, expected-value calculation or production edit. One clock-state concern considered and dismissed: override scoped to one scenario and reset before subsequent notifications; assertion failure terminates this test, so finally is not needed to protect another live clock owner. No separate test is warranted for a test-only stabilization.

## Type export cleanup

Fresh complete deltas remove only three export modifiers: app/roster-ports.ts RosterFormat; view/types.ts StatusColors and ViewWindow. Definitions and consuming property types remain byte-identical. Whole authored src/tools exact-name search finds each declaration and only its same-module property consumer: RosterOptions.format, Look.status, ViewEnvironment.window. No import, reexport, runtime access or external package API relies on these names. The application is private and their actual structural contracts remain exposed through consumed owner types. TypeScript erases these declarations, so runtime graph and behavior cannot change.

Dead-code assessment distinguishes unused exports from used types: remove only the unused export, retain meaningful inline property contract definitions. Three quality/cleanup candidates considered and dismissed after verifying actual consumers; no new aliases, copied shapes, suppressions or source contract distortion.

## Verification and limits

Fresh reviewer evidence: exact before/current hashes, full three scoped diffs, real fixture/clock/deadline/renderer cross-file tracing, independent parser-based 465-assertion equality, five-suite 610-assertion/66-await inventory, and whole authored symbol consumers. No fresh suite/typecheck/lint/build/scanner run; controller owns those jobs and will validate final amended bytes. Prior 56/1 focused output is failure evidence, not a passing final run. No browser or live integration claim.

Only this report was written under /tmp. Review complete for the three deltas; required fresh root checks and any scanner-policy amendment remain outside this addendum.
