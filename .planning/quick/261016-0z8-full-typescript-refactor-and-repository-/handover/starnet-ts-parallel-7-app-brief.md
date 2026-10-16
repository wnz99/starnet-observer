### Task 7: Migrate scene, renderer and app lifecycle; converge full baseline

**Goal:** All remaining browser/application/tests/scripts are strict TypeScript with no classic compatibility layer and all deterministic gates green.

**Delivers:** F1, F2, F3, F4.

**Execution:** 7-V scene/view preparation runs parallel-safe in P2 after reviewed Task 5, independently of server migration. Integrate its reviewed result after Task 6 closure; 7-app and final browser/strict convergence remain I7 sequential-only. Scene/view are one cohesive package because view directly imports scene. Controller owns final build/HTML/bridge/shared policy wiring.

**Files:** Migrate remaining scene/view/controller and UI suites into `src/browser/{scene,view,app}/` map; create `src/browser/main.ts` and colocated emitted-entry test; remove `src/browser/legacy-bridge.ts`; update build/HTML to final two script entries; complete all configs/scanner ownership and confirm native discovery collects the migrated TS suites. Convert any remaining maintained scripts/fixtures to TS except required config/quality `.mjs` owners.

**Read first:** `frontend/app/observer-scene.js:ObserverScene`, `frontend/app/observer-view.js:ObserverView`, `frontend/app/observer.js` app IIFE and visibility/prefs/staleness flow, all associated UI/scene/view/prefs/hosts/arrangement/control suites now colocated; Task 5 bridge consumer list; current full diagnostics.

**Current-state evidence:** view combines many render/camera/interaction responsibilities; controller combines state, controls, hosts, inspectors, visibility and preference persistence. Hidden page must own no subscription/deadline/frame; fresh proof precedes resumed inspection. Scene geometry and relay rendering are existing behavior covered by drawing assertions, not a new layout design.

**Intended edits:** `mountObserver({ document, window, fetch, clock, scheduler, sprites }): ObserverApp` composes existing behavior; `ObserverApp` exposes `dispose(): void` for tests and page lifecycle. Select narrow typed dependency interfaces matching actual APIs; do not require a full DOM implementation in unit fixtures or cast broad fake records as HTMLElement. Move privacy-sensitive state/freshness into app state/lifecycle modules; controls and inspectors consume verified state through named predicates with same input/output semantics. Separate canvas rendering by existing station/crew/mail/effects/camera/interaction responsibilities; share stable geometry, avoid a class hierarchy or generic renderer engine. Use semantic MCP narrowly for concrete lint-driven design choices, with local source/test evidence deciding applicability.

Preserve effects/motion preference, theme warning text, host/mail scope, panel stack/focus/keyboard, sprite fallback grouping, scene slot/color/geometry, arrangement and saved UI preferences. Replacing raw-source VM tests uses importable factories and typed fixtures; retain emitted-prepaint VM test where script execution order is itself the contract. All source locks must either become behavior tests or document a current static policy invariant; do not delete an assertion solely because code moved.

Final HTML contains synchronous `app/prepaint.js` after observer-boot and one module `app/main.js` after DOM, no classic ordered application scripts. Remove bridge and global declarations entirely. Build main bundle with browser target; dependency graph cannot reach node:*, bun:sqlite or sidecar modules. All 78 original JS/MJS files must be dispositioned: converted/moved/deleted, or retained executable config/helper with specific reason and check coverage. No application/test JS remains. No TypeScript @ts-nocheck, generic any escape, broad lint/scanner ignore or copied runtime schema is accepted.

**Interfaces:** `mountObserver` and `ObserverApp.dispose`; main invokes mount once. Existing browser exported APIs remain consumer-focused TS imports. `bun run test` discovers TS colocated suites. Final `typecheck`, `lint`, `check:knip`, `check:fallow`, `check:static` cover all real entrypoints and maintained source/tests/tools.

**Dead-code scope:** old scene/view/controller JS, legacy bridge/global aliases, dual exports, VM source slicing/function parser, old paths in HTML/tests/docs/scanner configs, unused factories created during splits. Preserve rendering fallback branches and source-health differences supported by behavior tests.

**Review target:** end-to-end browser lifecycle/freshness and control authorization, canvas geometry/visual parity, maintainable cohesive splits without wrappers, complete strict convergence and old-invariant accounting.

- [ ] **Step 1:** Port scene/view/UI suites; add mount/dispose resource assertions, hidden/resume fresh-proof case, rejected malformed snapshot case, emitted no-privileged-import case and browser script-order assertion. Cleanup: inventory all remaining globals/bridge/raw-source consumers and preserve their contracts.
- [ ] **Step 2:** Run focused `bun --no-env-file test src/browser/app/mount.test.ts src/browser/scene/index.test.ts src/browser/view/index.test.ts`; missing mount/dispose/import graph initially fails. Cleanup: fixture-only state; old runtime consumers remain until switch.
- [ ] **Step 3:** Migrate/split remaining modules/tests and final entrypoint; fix every production strictness/duplication/dead-code finding through real code changes. Cleanup: delete bridge/old JS/obsolete VM parser and update HTML/build/scanner/docs; no unsupported compatibility API.
- [ ] **Step 4:** Run `bun run test`, `bun run build`, `bun run typecheck`, `bun run lint`; require all collected behavior and full strict source/test coverage pass. Cleanup: search old frontend/app/js paths, module.exports and application global names; generated valid URLs are distinguished from stale source paths.
- [ ] **Step 5:** Run `sh tools/quality/check-static.sh`, `bun run check:knip`, `bun run check:fallow`. Require zero findings across whole maintained graph, not only touched files. Inventory original 78 files against final disposition and compare resolved type/lint coverage with maintained files. Cleanup: remove unconsumed split helpers/types/fixtures and ensure dynamic entrypoints are declared, never suppressed.
- [ ] **Step 6:** Independent review traces browser mount through data freshness/controls/render/dispose and repeats final dead-code audit. Record complete gate output, preserved invariant map and unresolved runtime limits. Cleanup: no known obsolete compatibility/global/source copies remain; final baseline must be green before Task 8.


### Global constraints

- User: “full refactor which include the new repo setup and TS, plus folders and file reorganization if necessary.”
- User: “for tests I want the test file beside the tested file not in a tests directory”.
- Preserve existing MIT and NOTICE; preserve local machine tooling and unrelated edits. No Co-Authored-By trailers or timeline estimates.
- Preserve `bun run start`, `bun run test`, `bun run presentation`, and `bun run validate:themes`; direct `.js` launch paths may change with coordinated docs/SSH updates.
- Supported commands retain `--no-env-file` and `bunfig.toml` `env = false`. Exported variables still apply. Child/worker environment restrictions remain.
- Do not weaken strict compiler flags or production rules, add blanket exclusions, introduce `any`/casts to bypass boundary validation, or hide findings through scanner suppressions. Retain starter test-specific policy only.
- Checks are read-only. Explicit format/fix owns changes. Stage probes run in disposable copies; no defects or fixture state land in the real checkout.
- Never read private config/artwork merely to inventory it. Use path/stat/digest evidence without outputting contents. No local input moves, overwrites, deletion or publication.
- User has now authorized sequential implementation after justified simplification and the independent plan gate; no further approval pause is required for the agreed scope. Execution controller owns worktree/branch registration, per-task independent review, final PR review and merge gates. Tasks below do not bypass them.
- No paid/live runs without explicit user approval. Fixture HTTP/browser/native compilation tests are local verification; real agent inventories, SSH remote streams or mutating controls are live integrations.



## Bounded integration package 7-app

Own src/browser/app/**, src/browser/main.ts, adjacent coordinating UI/preferences/hosts/controls/arrangement suites, replaced legacy controller. Consume reviewed scene/view/primitives and actual HTTP protocol. Produce mountObserver and ObserverApp.dispose, preserve hidden/resume generations/resource-subscription disposal, input focus/keyboard/panel inspector identity lock, controls opt-in and server-proven payloads, preferences/hosts/filter/sort/arrangement behavior and legacy drawing. Controller owns final build/HTML/main/bridge deletion wiring and common scanner/config changes; request exact patches. Remove all maintained app/test JS only when every actual consumer has replacement and preserved oracle. No privileged browser imports, server validators copied into browser, ambient global shims or boundary casts. Full strict/type/lint/scanner/build/native convergence required. Test dispose prevents all subsequent listeners/timers/fetch commits; preserve UI semantics instead of implementation-only assertions.

Exact frozen baseline/isolated checkout/report path supplied at dispatch after prerequisite reviewed integrations. Full numbered-task text supplies requirements; bounded package section controls edits. Controller owns integration and root/shared/caller/records/commits. You are not alone; preserve edits and use assigned checkout only. No delegation/commits/branches/FLOW/GSD, paid/live runs or optional settings. Apply wnz-task-implementer, wnz-clean-code-js, wnz-test-quality, wnz-dead-code and wnz-doc-write-expert when docs change. Report incrementally then per implementer status contract: scope, cleanup/consumer trace, preserved tests, fresh commands/results, emitted closure, remaining diagnostics by owner and exact controller patch requests. Stop all edits on handoff for fresh independent review.
