# Quick Task 261101-ggo: Repository sign and selected desk badges

Status: Implementation, independent full-branch review and required local verification complete. Delivery: [PR #33](https://github.com/wnz99/starnet-observer/pull/33). Prepared before merge; final tracking-head CI and merge remain pending at this commit. PR #33 records their outcome.

One name-only repository sign is collected at every zoom tier. Existing repository selection highlights matching workers and shows flat checkout badges below fixed desk geometry. Badges share the highlight color, use observed checkout identity, preserve unavailable values and expose full accepted text on hover. Post-paint hover refresh restores a stationary pointer after scene updates, including reduced-motion rendering.

Finite viewport and glyph capacity can shorten or omit colliding signs and badges. Hover text exists only for accepted painted badges. Dense representative fixtures cover all eligible selected desks separately from physically impossible coincident capacity. Existing selection, roster accessibility and painted input geometry remain supported.

Approved semantic revision 2 remains unchanged. Final conformance found no gaps. Independent task review R2 resolved the earlier Medium hover lifecycle finding. Independent full-branch aggregate/PR review at 397d45d16e8cf9cfc148e255f94f7fb8b883a06c returned requirements Approved, quality Approved and outcome Clean, with no findings.

Verification at executable source head cd79f9161c0bc94b07a0c3de3cf3c99ec0782f3b:

- Runtime/public build passed; core tests: 299 passed, zero failed, 902 assertions across 101 files.
- Production-first installed consumer: 1 passed; pinned-harness installed consumers: 2 passed, including real Chromium synthetic acceptance.
- Focused view tests: 3 passed; browser consumers: 2 passed. Lint, five strict compiler projects, format, Knip and Fallow passed.
- [Ubuntu CI on reviewed tracking head 397d45d](https://github.com/wnz99/starnet-observer/actions/runs/41297607181) passed.

Canonical reports remain external under /tmp/observer-label-plan.3bkfPx: task-review-r2.md, final-conformance.md, aggregate-verification.md, pr-review-r1.md and hover-fix.md. Final tracking validation, executable equivalence, same-head CI and merge readback belong to finalization.md there.

This final tracking commit changes only this summary and STATE.md. Executable source, configuration and tests remain identical to the independently reviewed 397d45d and verified cd79f91. Their review and test receipts are reused under the tracking-only exception; this new tracking head itself is not independently reviewed.

No paid/live provider run, deployment, running observer change or shared tool/configuration change occurred. Flow completion follows verified merge; this premerge summary does not mark it complete.

## Main-checkout correction: PR #34

PR #33 merged at 1d7129cf97703b2ec4242ebaa77a44df24445644. Its delivery history above remains intact. A later regression report exposed an unrealistic main-checkout fixture: actual observed main identities carry `worktree: null`. Scene arrangement also replaces the displayed repository name. The correction preserves the observed repository basename through arrangement and uses it for proved main-checkout badges, including helpers. Linked checkout names, missing/folder fallbacks, selection, hover and badge geometry retain their existing contracts.

Production correction at 27244fded163435a8e8d5c32eba8d7fee251ab62 passed 19 focused tests, one presentation integration test, two pinned Chromium consumers, build, lint, five compiler projects, format, Knip and Fallow. Realistic main/null fixtures cover root/helper view rows and native browser badge text. The final arrangement integration correction verifies the original repository survives a different display section name while retaining toggle and stable-seat assertions.

Independent full-branch review R2 at 6e76fc4a92978ab2b81103c0337f8d1e8e636647 returned requirements Approved, quality Approved and outcome Clean. Its earlier Medium integration expectation finding is resolved. At that head, both arrangement integration cases and all 299 core tests passed; Ubuntu CI 41301418261 passed. Reports: checkout-fix-implementation.md, checkout-fix-integration-correction.md and checkout-fix-review-r2.md under /tmp/observer-label-plan.3bkfPx.

This finalization changes only GSD tracking records. Executable source, configuration and tests remain identical to reviewed 6e76fc4; production source remains identical to 27244fde. Review and test receipts are reused under the tracking-only exception; this new documentation head itself is not independently reviewed. Final tracking-head CI and guarded merge remain pending at summary preparation. [PR #34](https://github.com/wnz99/starnet-observer/pull/34) and checkout-fix-finalization.md record exact-head CI, merge readback and integration verification. No deployment, running observer restart, installation or paid/live provider run occurred.
