# I8 keyboard oracle fix review, round 2

## Findings and verdicts

No findings remain in the bounded keyboard fix. Round 1's Medium false-green keyboard oracle is resolved by observable canvas assertions and explicit help-collapse verification.

- Outcome: **Clean**; bounded fix review **Complete**.
- Requirements compliance: **Approved** for this fix.
- Quality: **Approved** for this fix.
- Recommendation: **Approved**, limited to the keyboard oracle delta in `src/browser/application.consumer.test.ts`.
- This does not approve Task 8 overall, hosted CI, final aggregate replay, macOS execution, or visual equivalence. Final restored mutation GREEN remains a controller runtime gate.

## Scope and stability

Worktree: `/home/david/Projects/starnet-observer-i8-delivery`.
HEAD: `6f4dabe442b1be029b0c32285db9efae8153e480`.
The consumer is a staged new file; the current working file has no unstaged delta. Scope is only `ui()`'s new Escape-collapse assertion and `keyboardCamera(page)` call, plus `canvasSignature` and `keyboardCamera` at lines 304–340. Read the complete current consumer to verify caller, fixture, and cleanup assumptions. Unchanged production files were read only to trace the new oracle; no previous completed core scope was reviewed again.

Accepted R1 consumer SHA256: `83accae7366fa6b0e17b339d230bfa6aded1a70bfc803175f42b4b90e1002d01`.
Current consumer SHA256 before and after analysis: `8a8979c0667a6e558c963ff4675a6e6a0534a410683ab7817835ebadb50ff5e6`.
Manifest SHA256: `8177070443da0749fed3dd61cb2cae632a56ba27b685ba05a9ada1ffa31fc7ae`.
All 13 other entries in `/tmp/starnet-ts-resume/i8-core-frozen-sha256.txt` matched their accepted hashes. Their review is reused from `i8-core-review-r1.md`, which was read completely. CI/native R1 and R2 were read and reused; their unchanged scope was not repeated.

Old R1 source bytes were not separately provided, so this review does not claim a byte-for-byte patch reconstruction. The assigned delta, R1 finding, complete current file, Git status, and exact frozen current hash establish the bounded review target. No intended current review file was unavailable.

Read project AGENTS and approved Task 8 PLAN. Applied `wnz-code-reviewer`, its full deep-analysis reference, `wnz-clean-code-js`, `wnz-test-quality`, and `verify-before-complete`. This is a controller-dispatched independent reviewer leaf; no nested delegation. Requested host selection: `gpt-6.1-sol`, medium; resolved model identity unavailable.

## Trace coverage

1. Installed real-Chromium consumer → fresh 1440x1000 page with `reducedMotion: "reduce"` → emitted loopback page → canvas proof → screenshot preparation awaiting fonts and two animation frames → `ui()` → help open → real Escape → `aria-expanded=false` → keyboard helper. The production help handler updates the hidden popover and expansion state together and restores trigger focus. The new assertion observes that supported disclosure state before the helper explicitly focuses the station.
2. `#world.focus()` → Playwright real keyboard events → canvas `keydown` listener installed by `Lifecycle.start()` from `Interaction.listeners` → `Interaction.keyDown` → camera zoom/pan/overview → `CameraControl.setCamera` → lifecycle invalidation → requestAnimationFrame → frame paint → canvas pixels. No production test hook, private runtime state, or global interface is used.
3. `+` changes the digest from the original overview. Eight further zoom presses create room for a meaningful horizontal pan, avoiding overview's intentional centering constraint. The double animation-frame barrier occurs after those presses, allowing the scheduled synchronous paint to complete before recording the pan baseline. `ArrowRight` must then change the zoomed canvas. `0` must restore the original overview digest. The final focus assertion verifies the station remains focused. A no-op zoom or removed listener cannot satisfy the first assertion; a no-op pan cannot satisfy the second in the current frozen fixture; a no-op overview cannot restore the original digest after a successful zoom/pan.
4. Camera functions constrain position/zoom and deterministically fit the same bounds/viewport. Real matchMedia propagates reduced motion through mount-core → station view callback → FramePaint. Animation stops, movement snaps, mail grounds, and time-dependent effects receive `animate=false`. This makes within-page digest comparison suitable here. Fresh synthetic metadata keeps identity/status/geometry stable; periodic timestamps are not asserted as pixels. Browser capture already moved the pointer away and awaited fonts before this sequence. No concrete timing-dependent false green or flake was identified in the frozen scenario.
5. Canvas serialization/digest occurs inside the real page. It hashes observable rendered output, not expected camera values calculated through production helpers. The expected overview comes from the initial rendered overview. This protects wiring and visible transitions; it does not prove every key, exact direction/zoom magnitude, or visual design correctness. Those broader obligations are outside this fix.
6. Polling handles asynchronous paint completion without sleeps for each action. Digest failures throw through the test. The new helpers allocate no persistent browser resources or listeners. Existing outer finally closes the browser and fixture server on assertion failure; no new cleanup ownership is introduced.

## Dead-code, clean-code, and test-quality assessment

Dead-code/reachability candidates considered: **3; all dismissed; zero required removals**. `keyboardCamera` is directly awaited by `ui`; `canvasSignature` is consumed by all keyboard outcome checks; the replaced focus-only sequence is absent, with its final focus obligation retained in the new helper. No orphaned import, helper, or duplicate test path was found.

TypeScript clean-code assessment used `wnz-clean-code-js`: **3 candidates considered; all dismissed**. The digest helper owns one browser-output operation; the keyboard helper keeps scenario input and outcome expectations visible; the bounded zoom loop and animation barrier express fixture preparation without adding a generic framework or production coupling. No style-only refactor is requested.

Test-quality assessment: this extends the existing emitted-browser scenario at the boundary that exposed the missing proof. Independent expectations are visible output changes and restoration to the established overview, not production camera calculations. Named messages distinguish zoom, pan, and overview failures. Escape now asserts collapse. No separate suite, redundant fixture, or test-only production seam was added.

## Verification evidence and limitations

Fresh lightweight reviewer checks:

- Python SHA256 assertions: **13 unchanged core hashes: OK; Keyboard source hash: OK**.
- `git diff --check HEAD -- src/browser/application.consumer.test.ts`: exit 0.
- Git status and HEAD checks confirmed the scope above.
- Repeated source SHA256 remained the assigned value.

Controller logs inspected, not rerun or independently certified:

- `i8-keyboard-green.log`, SHA256 `c8a29e033b93d3b6bb4859d0155e6c162f3ab1a7bf809b8c60babc5d6dde36a8`: actual browser consumer and reused installed startup consumer report **2 pass, 0 fail**, `EXIT_STATUS=0`.
- `i8-keyboard-red-restored.log`, snapshot SHA256 `65d4b1f72ebed21035b8a4320223f5792c17eb55b017c1ca53f8573b5eea8663`: disposable emitted station keydown-binding removal reports actual browser test failure at **KEYBOARD_ZOOM_RENDER**, **1 pass, 1 fail**, status 1. The diagnostic is an assertion timeout, not syntax/import failure.
- Read the disposable mutation driver: it verifies exactly one emitted binding, removes it only in the fixture copy, restores original emitted bytes in finally, and then invokes the restored consumers. At the inspected log snapshot, the restored GREEN result was not yet present. The controller must confirm that final runtime result; this fix-design approval does not manufacture it.

Dynamic Chromium event delivery, encoding, fonts and runtime timing cannot be proven statically. Existing GREEN plus targeted RED evidence support the oracle; this reviewer did not launch Chromium, compiler, installer, full suite, network/provider calls, live observation/control, branch change, or commit. No repository source was edited. This external report is the sole write. Acceptance/docs/records convergence remains outside this bounded approval.
