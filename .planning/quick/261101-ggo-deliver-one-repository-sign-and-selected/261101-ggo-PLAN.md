# Repository signs and selected desk badges Implementation Plan

Semantic revision: 2. Planning only. Implementation permission: not requested or granted.

## Features and effects

### F1: One repository-name sign at every zoom

- Problem and current behavior: overview omits repository signs; checkout sections repeat repository names with checkout and root rows.
- Proposed behavior: each repository has one name-only sign within the existing host and active-page scope, at overview, sections and detail zooms. Multiple worktrees do not create extra repository signs. Separate exact repository IDs remain separate even when names match.
- Effect on the code: group section-sign candidates in the existing label owner; remove permanent checkout details and overview suppression.
- Scope and compatibility: preserve section geometry, grouping, camera and selection semantics. No sign for an invented repository identity. Offscreen anchors and finite viewport capacity still constrain painting, as described below.
- Acceptance outcomes: one accepted, clickable sign per visible repository in representative scenes at zoom 0.3, 0.8 and 1.5; no permanent worktree/root rows.
- Execution mapping: Task 1.

### F2: Selection reveals flat badges below desks

- Problem and current behavior: selection already rings every matching worker; checkout text is permanently repeated in section signs or follows worker bodies at detail zoom.
- Proposed behavior: clicking the name sign retains existing repository highlighting and reveals one flat horizontal worktree badge below each selected worker's desk. Badges use each worker's ring color, stay at desks while workers walk, and disappear with selection. Text stays at least 13 CSS pixels at every zoom, truncates to available width, and exposes its full value on hover.
- Scope and compatibility: include root workers and helpers with the exact selected repository ID. Use observed worktree names; main checkout uses its observed main-checkout name. Missing proof remains `Checkout unavailable`. Preserve existing roster buttons and inspectors for keyboard and non-hover access.
- Acceptance outcomes: selected workers across checkouts receive badges, unrelated workers do not; changing or clearing selection retires badges and hover content immediately. Normal representative dense scenes retain all visible selected desks' badges without overlap.
- Execution mapping: Task 1.

## High-level design and rationale

Reuse `PlatformLabels`, `WorkerLabels`, the accepted-plate pipeline and repository selection callback. Use scene workers, not animated worker anchors, to create desk badges. Expose the existing ring-color lookup for the badges instead of duplicating color assignment. No new settings, dependencies, persistent state, scene layout solver or general relocation engine.

Repository candidates are deduplicated by exact repository ID after selecting an on-screen section anchor within the active scene. Prefer the first on-screen anchor in deterministic scene order; one candidate per repository, with stable order. Use `repoLabel`, never the multiline `section.label` or opaque ID as display text. Preserve exact IDs in hit targets. Host-scoped identities remain scoped; do not merge by basename.

Each badge is centered under the projected bottom of its own desk footprint: project all four desk corners at floor height and take the greatest screen y, then add a 4 CSS pixel gap. The badge's top starts there; do not use `region.head`, `region.foot` or actor position. Use 13px text and a maximum text width of 110 CSS pixels, reduced to available viewport/adjacent-desk space before clipping. Badge border/text color uses `FrameOverlays.repositoryColor(worker.id)`. Avoid duplicating the detail-tier worktree line when a selected desk badge replaces it.

Collision and capacity are real limits: fixed readable horizontal badges cannot all fit arbitrary coincident desks or a viewport narrower than one glyph. Keep the existing deterministic non-overlap resolver; prioritize selected badges above passive worker details and repository signs above passive detail labels, while retaining hover/focus and attention behavior. Do not silently accept dropping badges in supported representative layouts. If 13px clipped badges cannot fit below every visible selected desk in the synthetic dense fixture, implementation must return the exact failing geometry for a product decision before claiming F2 complete. Offscreen desks are culled, and physically impossible synthetic cases may deterministically omit plates with no invisible targets. Record these exclusions explicitly; do not substitute walking labels, displaced flags or a new solver. Likewise, every-zoom means no LOD suppression, not unlimited viewport capacity. Test both representative success and explicit exhaustion separately.

Risks and safeguards: minimum text size increases crowding at overview; use short labels, local width bounds and dense synthetic proof. Reuse current selection lifecycle instead of introducing dismissal rules. Keep full values as plain text, with no identity inference or HTML interpolation. No runtime/provider changes or migration. Rollback is a normal revert of this bounded UI task.

## Data-flow analysis

| Stage | Input and source | Processing and owner | Output or side effect | Material failure handling |
| --- | --- | --- | --- | --- |
| Repository sign | Active-scene sections and worker-proven repo IDs | `PlatformLabels.collect`: deduplicate IDs, choose visible section anchor, clip name | One name-only candidate per repo at all tiers | No proven ID: no repository target; offscreen/exhausted plates have no target |
| Selected desks | `repositorySelection()` and scene workers with observed checkout fields | `WorkerLabels.collect`: exact-ID match, truthful identity text, desk projection, shared ring color | Flat screen-space badge candidates | Unknown checkout proof: `Checkout unavailable`; never inherit parent's checkout or guess main |
| Paint and interaction | Candidate rectangles and current camera | `stagePlates`, `placePlates`, `Plates.recordTargets` | Accepted drawn rectangles, exact sign targets and badge hover regions | Reject collisions deterministically; stale camera/scene regions cannot hit |
| Hover and dismissal | Pointer over an accepted badge; selection and scene changes | `PointerGestures.updateHover` and `Interaction.paintedFrameCurrent` | Full badge text in native canvas title | Clear on leave, selection change, camera invalidation, update, reset and disposal |

## Execution instructions

**Tech stack:** browser TypeScript and Canvas; Bun >=1.4.4 for tests; pinned Node 24.19.0 development tools and Playwright 1.64.1. Package scripts and lockfiles own versions.

### Global constraints

- “Keep production free of package dependencies.” Preserve browser/runtime/test ambient boundaries and strict compiler, lint, Knip and Fallow settings.
- “Checks are read-only; use explicit format/fix commands to change files.”
- “Never switch branches in or edit another session's checkout; use own worktree.”
- Preserve source identities, stale observations, security checks, environment restrictions and installed-package contracts. No live controls, provider calls, deployment or paid runs.
- Do not install tools or upgrade Bun during this task. Before shared generated outputs or browser resources, inspect bus locks and acquire the matching existing lock; release afterward.
- User chose option 2, flat horizontal desk badges. Earlier multiline-sign displacement, furniture-front badges and raised flags are superseded.

### Acceptance criteria traceability

| Feature and requirement | Task(s) | Verification |
| --- | --- | --- |
| F1: one name-only sign per exact repo across checkouts and all zoom tiers | Task 1 | `bun --no-env-file test ./src/browser/view/index.test.ts` recorded paint/text and sign-target assertions |
| F2: exact selection, all desks including helpers, ring color, stationary anchors | Task 1 | Same command; selected multi-checkout fixture and walking-frame comparison |
| F2: main, unavailable, long names, full hover, lifecycle and minimum text size | Task 1 | Same command; truth/clip/title assertions at 0.3, 0.8, 1.5 and DPR 1/2 |
| F1/F2: non-overlap, finite-capacity exclusions, stale target retirement | Task 1 | Same command; representative dense success and impossible exhaustion cases |
| F1/F2: real pointer and keyboard alternatives | Task 1 | `bun run build` then `bun run test:browser`; synthetic screenshots and receipt, existing roster/inspector checks |
| F1/F2: compiler and quality boundaries | Task 1 | `bun run lint`, `bun run typecheck`, `bun run check:knip`, `bun run check:fallow`, `bun run check:format` |

### Execution topology

| Wave | Tasks | Mode | Prerequisites | Isolation and integration | Wave verification |
| --- | --- | --- | --- | --- | --- |
| 1 | Task 1 | sequential-only | Approved revision and implementation authorization | Own feature worktree from main; sole owner of intertwined paint and hit-target contracts | Focused regression, static checks and synthetic browser run pass |

- Parallel implementation permission: `not-requested`.
- Host/model policy: Codex; planner uses controller-selected native controls. Resolved model/effort unavailable in worker context. Implementer/fixer and reviewer controls remain controller-owned. No user model override supplied.

### Task 1: Deliver one repository sign and selected flat desk badges

**Goal:** Deliver F1 and F2 together without changing scene layout or selection semantics.

**Delivers:** F1, F2.

**Execution:**

- Prerequisites: approved revision 2 and explicit implementation authorization.
- Wave: 1.
- Mode: sequential-only; collection, painting and hover share the same accepted rectangles.
- Isolation: own feature worktree, bounded files below; preserve other sessions' edits.
- Integration order: sole task, followed by independent task review before integration.

**Files:**

- Modify: `src/browser/view/platform-labels.ts:PlatformLabels.collect`, `section`; `worker-labels.ts:WorkerLabels.collect`, `title`; `frame-overlays.ts:FrameOverlays.ringColor`; `plates.ts:Plates.recordTargets`, `drawPlate`; `types.ts:TextPlate`, `ViewCanvas`; `runtime.ts:ViewRuntime`; `interaction.ts:Interaction`; `pointer-gestures.ts:PointerGestures.updateHover`, `pointerLeave`, `reset` (all under `src/browser/view/`).
- Test: `src/browser/view/index.test.ts:verifyRepositorySigns`, `verifyCheckoutSigns` and adjacent collision/checkout regressions; `src/browser/application.consumer.test.ts:paintedTargets` synthetic scene and repository interaction checks.
- Create: none required. Docs: no public documentation/configuration change; preserve draft evidence in controller-owned records.

**Read first:**

- `src/browser/model/identity.ts:checkoutLabel`, `checkoutSuffix`, `sectionData`; `src/shared/observer.ts:ObserverRow` — proof and display fields.
- `src/browser/scene/types.ts:Worker`, `Section`, `Platform`; `src/browser/scene/index.ts` projection exports — desk geometry and active scene scope.
- `src/browser/view/helpers.ts:stagePlates`, `placePlates`; `plates.ts:paintPlates`, `recordTargets` — non-overlap and painted geometry.
- `src/browser/view/frame-overlays.ts:repositoryWorker`; `runtime.ts:indexRepositories`; `pointer-gestures.ts:updateHover`; `interaction.ts:paintedFrameCurrent` — exact identity, color and stale-hit invariants.
- `src/browser/app/navigation.ts:toggleRepository`; `app/hosts.ts`, `app/render.ts`, `app/roster/project.ts:repositories` — existing dismissal, keyboard and accessible toggle behavior.
- `docs/development.md:Build, package and CI`; `package.json:scripts` — synthetic check ownership and commands.

**Current-state evidence:**

- `PlatformLabels.collect` omits all sections at overview; `sectionLines` creates repo/checkout/folder lines per checkout section.
- `WorkerLabels.collect` iterates animated worker anchors. `title` paints unselected worktree detail only at detail zoom; it cannot anchor a desk badge.
- `FrameOverlays.repositoryWorker` matches exact `worker.row.repoId`, including helpers, and uses private `ringColor` for stable per-worker colors.
- `Plates.paintPlates` stages, resolves, draws, then records accepted targets. `placePlates` drops collisions by priority; `force` does not bypass this rule.
- `PointerGestures.updateHover` knows body/title/sign hits; it has no badge text region. `ViewCanvas` has no typed native `title` property.
- `checkoutLabel` treats absent checkout ID as unavailable. Its main label is generic; observed `row.worktree` supplies the main name when present. Do not derive names from `folder`, which is a relative root row.
- Existing `verifyCheckoutSigns` requires permanent multiline signs, and equal-basename checkout cases expect separate signs. These must move to selected desk-badge assertions. Browser consumer has an obsolete overview-omission comment.
- `Navigation.toggleRepository` toggles exact IDs without moving camera. Roster buttons expose `aria-pressed`; existing host/navigation/render owners clear selection. Reuse them unchanged.

**Intended edits:**

- In `PlatformLabels.collect`, collect name-only repository signs at every tier and deduplicate exact repo IDs within the active scene. Choose an on-screen section anchor before falling back to scene order, so an offscreen first checkout cannot suppress a visible sibling. Keep names and target ID separate. Remove `sectionLines`, its checkout-ID collection/import and checkout-only width/lift calculations. Render section names from `repoLabel`, with observed worker repo name fallback, never multiline labels.
- Rename private `ringColor(id: string): string` to `repositoryColor(id: string): string`; use it in both repository rings and badge styles. Do not introduce a second color map.
- In `WorkerLabels.collect`, independently loop active-scene workers matching the selected repo. Produce `deskBadge(worker: Worker): TextPlate` using the desk projection and dimensions specified above. Use proven checkout ID/kind; worktree text is observed `row.worktree`, main text is observed `row.worktree` plus ` · main`, unknown proof/name is `Checkout unavailable`. For folder kind retain honest `Local folder`. Equal worktree names may retain the existing `checkoutSuffix` discriminator; full hover must retain the complete name and discriminator. Do not expose guessed names or opaque IDs alone as repository names.
- Extend `TextPlate` with `badge?: { id: string; fullText: string }`. Keep badge metadata separate from title `target`, so hovering badges does not trigger worker-title behavior or add repository click targets. Retire the detail worktree line for selected workers only; retain unrelated detail behavior.
- Add `badgeRegions` to `ViewRuntime` containing `{ id, text, left, top, width, height }` from accepted plates only. Add `Interaction.badgeAt(point: Point)` guarded by `paintedFrameCurrent()`. Add optional `title?: string` to `ViewCanvas`; update the native canvas title from the accepted badge hit in hover refresh. Clear title and badge regions with the same lifecycle paths that retire plate targets; ensure selection mismatch cannot expose old badge text before repaint. Badge hover must not cause a body beneath it to become hovered. Do not change click selection semantics.
- Remove `TextPlate.lines` and multiline `drawPlate` branch only after final whole-browser search confirms no other producer; keep shared model checkout identity helpers and roster checkout data.
- Test fixtures: one repo with main, two worktrees, missing proof, root and helper workers; a second exact repo with the same display name; separate host scope and active-page changes. Assert unique repo sign, correct selected badge count/text/color, no permanent checkout/root lines, unchanged camera/worker identity. Move actor point while desk remains fixed: badge box stays fixed while ring follows worker.
- Capture font and painted rectangles at actual camera zoom 0.3/0.8/1.5, DPR 1/2. Verify 13px minimum, ellipsis/full title on long name, correct desk-bottom relation, non-overlap and viewport bounds. Use representative dense desk layout success plus an impossible coincident-desk case with deterministic omission and no hover region for omitted plates. Do not count the impossible case as proof of normal badge completeness.
- Exercise click toggling, switching repositories, host/page changes, session removal, pointer leave, pan/zoom invalidation and disposal. Verify title clears, stale hits fail and roster keyboard/inspector alternatives remain intact. Extend existing browser fixture through actual painted sign coordinates and native pointer hover; capture selected/unselected overview/detail screenshots and inspect readability independently.

**Interfaces:**

- Consumes: `LabelContext.selectedRepo`, `Worker.row` observed identity fields, `Worker.desk`, projection, existing exact repo-selection callbacks.
- Produces: `FrameOverlays.repositoryColor(id: string): string`; optional badge metadata on `TextPlate`; accepted-only `ViewRuntime.badgeRegions`; `Interaction.badgeAt(point: Point)` returning a badge region or null; optional native canvas title. No public application API, persisted schema or server contract change.

**Dead-code scope:** Audit only during planning. Runtime trace: `Plates.paintPlates` consumes `PlatformLabels.collect` and `WorkerLabels.collect`, then `drawPlate`/`recordTargets`; interaction consumes accepted targets. Confirmed replacement candidates: overview suppression, `sectionLines`, checkout-ID gathering in platform labels, permanent multiline-only paint/type support, obsolete multiline sign assertions and omission comment. `checkoutSuffix`, `checkoutLabel`, sectionData and scene checkout fields remain reachable outside signs and must remain. `placePlates`, staging and worker-title behavior remain supported; no resolver signature change or displacement helper is needed. Implementation owns all affected consumers and final reference checks.

**Review target:** selected option fidelity, exact identity/deduplication scope, truthful main/unknown text, stationary desk geometry, shared colors, all-tier readability, normal dense completeness, honest exhaustion, hover clearing, accepted hit targets and accessible alternatives.

- [ ] **Step 1: Establish the pre-change check**
  - Add the synthetic view cases above; replace obsolete multiline expectations with name-only plus selected-badge outcomes.
  - Cleanup: inventory multiline producers and target consumers; preserve supported identity and roster coverage.
- [ ] **Step 2: Prove the check exposes the intended gap**
  - Run `bun --no-env-file test ./src/browser/view/index.test.ts`.
  - Expect failures for missing overview sign, repeated checkout signs and absent selected desk badges, not fixture/type errors.
  - Cleanup: no production reachability change; retain Step 1 inventory.
- [ ] **Step 3: Implement the minimum behavior**
  - Apply intended edits in existing owners; extend browser synthetic fixture.
  - Cleanup: remove confirmed obsolete multiline producer/consumer paths and test expectations; preserve shared identity helpers and nonselected detail behavior.
- [ ] **Step 4: Prove focused behavior passes**
  - Run `bun --no-env-file test ./src/browser/view/index.test.ts`.
  - Expect all new cases and existing interaction/crew regressions pass; return dense-layout failures rather than weaken selected-desk acceptance.
  - Cleanup: run `rg -n 'sectionLines|checkoutSuffix|badgeRegions|repositoryColor|plate\.lines|overview.*omit' src/browser`; inspect every remaining reference for an actual consumer.
- [ ] **Step 5: Run the task gate**
  - Run `bun run lint`, `bun run typecheck`, `bun run check:knip`, `bun run check:fallow`, `bun run check:format`, then `bun run build` and `bun run test:browser` under applicable locks.
  - Expect zero failures; inspect synthetic screenshots for flat desk placement, readable short text and unobscured controls. No live integrations. CI retains package/full-suite ownership.
  - Cleanup: no orphaned type fields, imports, fixtures or exports; release generated-output/browser locks. Check commands must not fix files implicitly.
- [ ] **Step 6: Review and record the task**
  - Review: controller dispatches independent `wnz-code-reviewer` over full task diff and affected consumers.
  - Record fresh commands, actual zooms, screenshots, full cleanup disposition and finite-capacity residuals. No implementation completion claim before evidence.
  - Cleanup: confirm every proposed removal and retained contract; no known obsolete code remains in scope.

## Plan self-review

F1 and F2 map to one coherent task with no intermediate incompatible API. Human-facing behavior matches the execution details. Projection uses desks, color has one owner, full hover uses only accepted geometry, and selection uses existing lifecycle. Replacement audit identifies both producer and consumer cleanup without deleting shared identity data. Normal dense acceptance and physically impossible exclusions are explicit. No solver, settings, dependencies, general relocation or speculative file split is introduced. The data-flow table suffices; a diagram would repeat this linear flow. Commands come from package scripts and source/test owners were inspected. Planning changed no source or workflow state. This self-review is not independent approval; simplicity and plan-review gates remain controller-owned.
