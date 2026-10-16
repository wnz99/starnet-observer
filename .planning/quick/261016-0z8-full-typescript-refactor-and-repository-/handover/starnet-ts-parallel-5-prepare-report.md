# Parallel 5-P browser primitives — continuation checkpoint

Status: **NEEDS_CONTEXT**. Controller explicitly requested a coherent verified partial checkpoint, then a fresh bounded sprite continuation. This package is **not complete or accepted**. Do not start I5 or claim Task 5 completion from this report.

## Resume boundary

- Assigned checkout: `/Users/davidfava/Projects/Personal/starnet-observer-typescript-5-prepare`, branch `wip/typescript-refactor-5-prepare`.
- Initial preparation baseline was `7420c52`. Controller refreshed clean checkout to frozen GO producer `6599db57b79f9e178b4157927418ef0c788812cc`, then applied runtime key catalogs in `src/shared/theme-keys.ts`.
- Independent **full 5-P** review must use base **`357b45b`**, including controller-owned shared/bootstrap/theme/compiler prelude and runtime catalogs, plus this worker and the sprite continuation. Do not review only the diff after `6599db5`.
- Worker owns only `src/browser/**`. Controller owns shared/root configuration, roles, office art, server themes, build, HTML, bridge, classic consumer wiring and runtime deletion at I5. No worker edits to those paths. Current modified shared catalog is controller-owned; preserve it.
- All classic frontend JS, original tests/fixtures, HTML dependency ordering and server theme loader remain live and unchanged. Typed files are preparation for I5, not the active public application.
- No commits, branch changes, GSD/FLOW writes, source deletion outside owned new modules, delegation, credentials/private artwork/native inventory, live SSH/control/provider calls or paid runs. Only synthetic local tests and canonical authored theme were read.
- Requested model/effort: gpt-6.1-sol/medium. Resolved host identity unavailable; no external provider invoked to force selection.
- Applied skills: caveman for chat, wnz-task-implementer, wnz-dead-code directly, wnz-clean-code-js, wnz-test-quality, verify-before-complete; wnz-doc-write-expert for this external handoff. Graphify source instructions read during preparation, but no graph existed and generation would violate read-only/no-delegation preparation, so direct source tracing supplied evidence.

## Completed preparation code and exact interfaces

### Shared bootstrap, theme and prepaint

Controller-owned `src/shared/{theme,theme-keys,bootstrap}.ts` defines readonly `ThemeDefault` (canonical manifest with `id: starnet`) separately from resolved `ThemeSnapshot` (`requestedId`, `effectiveId`, warnings). Runtime key catalogs are single sources for UI/scene color, crew ID and track completeness.

`src/browser/bootstrap.ts` exports `readBootstrap(source: unknown): ObserverBootstrap`:

- Reads five injected fields, returns normalized token/theme/defaultTheme/themePack/control.
- Missing or non-string token becomes `''`, preserving authenticated API failure/reload rather than introducing a startup throw, as controller explicitly decided.
- Missing/invalid canonical default throws `Canonical theme default bootstrap is unavailable`.
- Invalid/absent selected pack becomes null; prepaint falls back to canonical default.
- Structural checks occur in one browser owner, `theme/validation.ts`, before recursive freezing. `freezeSnapshot` is not presented as validation. No server inheritance, filesystem/resource budget validation or default manifest is duplicated.
- Browser display contracts promise only checked fields. No `any`, unchecked input casts, TS suppressions, ambient legacy globals, scanner exclusions or fake entrypoints were added.

`createThemePack(defaults, font?)` from `theme.ts` returns prior theme API names: freezeSnapshot/getDefault/applyInterface/createStatus/applyLogo/start/reportWarning/reportNotice. Canonical defaults are frozen by the factory; selected bootstrap values are deeply frozen by reader. Font capability is `{install(family, source, weight): Promise<unknown>}`; prepaint supplies native FontFace installation.

Theme methods accept narrow `ThemeDocument` from `theme/dom.ts`. It supplies documentElement style/attributes, readyState, `getStatusRegion().replaceLines`, getElementById, querySelector and DOMContentLoaded registration. Native document adaptation currently lives inside `prepaint.ts`. Status only writes plain text; warnings are bounded/deduplicated; font/logo local URL guards and decode/failure fallbacks stay. Font URL check additionally retains the original full-match check, not just regex captures.

**Controller-frozen singleton decision implemented:** emitted prepaint starts the theme synchronously and uses `Object.assign(window, {ThemePack: result.theme})` to publish exactly the existing temporary global name. No ambient declaration or extra state/global exists. **I5 bridge must retain this exact object, never recreate/overwrite it.** Emitted-prepaint test calls later reportWarning/reportNotice through the published object and observes the same mounted active status.

`prepaint` is an internal function/side-effect entry, not an unused exported API. `prepaint.test.ts` runs actual Bun browser IIFE output in a VM with synthetic boot and DOM, proves styles before body mount, and proves shared active status handoff. Final HTML/CSP/public-root integration remains controller I5/Task 8 work.

### Harness, shared query resources, catalog

`createHarness({token, fetch, reload, schedule})` returns `{api:{get,post}, tokenRejected, reloadScheduled}`. Fetch takes native RequestInit and returns an object with ok/status/json():Promise<unknown>. `get(path,{signal}?)` preserves GET/no-store/same-origin/token and abort; `post` preserves JSON POST/token. Repeated token 403s schedule one 1500ms reload; other failures do not. Bridge must inject a receiver-safe reload closure and browser timer function.

`createQuerySpine({getJson, now?, interval?})` returns define/get/refresh/state/invalidate/update/subscribe. `interval(callback,ms)` returns its cancel closure. Native browser implementation is supplied when omitted. QuerySpec and QuerySnapshot live under queryspine/types.ts; heterogeneous resource data stays unknown until a consumer validates it. Cron/journey default resources and validators are retained. State class owns mutation; requester preserves shared promise identity, timeout/abort, generation invalidation, stale last-good data and ephemeral resource eviction. Typed factory injection replaces VM-only global mutation hooks; classic hooks/fixture remain with live classic runtime until I5.

`createData(defaults)` returns AGENT, DEFAULT_SKIN and SKINS with canonical metadata and unchanged Cadet/Codex/Claude labels. `sprites/load-plan.ts` exports groupTracks/frameCount/initialTracks and SpriteTrack. It narrows path arrays to strings; valid production track selection/copy/dedup/count behavior stays.

### Model and courier

`createModel(defaults)` returns prior model API names: projectName/hostOf/projectKey/repoKey/arranged/checkoutKey/checkoutLabel/checkoutSuffix/sectionKey/helperStations/hash/palette/activity/age/idleAge/taskTitle/hoverLabel/createLayout. Defaults supply canonical accents; optional createLayout projectAccents only recolors fixed floor slots. Layout methods remain reconcile/pages/onPage/pageFor/colorFor/seatFor. Implementation is split into identity, description, layout and hues, preserving stable desks, reused holes, annexes, exact helper chains/bounded stations, per-host room slots, deck hues and checkout identity. ModelRow inputs are structurally narrow display rows, not a fabricated full ObserverSnapshot.

`mail.ts` exports createMail plus along/LEG/SORT/FLIGHT/FADE/GAP/MAX_AIRBORNE/MAX_QUEUE. **To form transitional ObserverMail, I5 should combine named module constants/functions with `createMail(defaults)`**, whose return supplies createCourier. Courier exposes update/step/reset/position/state/frame with unchanged message metadata, route clock/batching/queue/ACK fade/rebase and neutral frame snapshots. position accepts only from/to/start, the fields it reads. `CourierBus<T>` and update's generic route preserve consumer message metadata without claiming more than id/acknowledgedAt.

### Inspectors and DOM fixture contracts

`inspector.ts` exports createInspector/buildPanel/statRows/turnParts/formatDuration/REASONS/MOBILE. `mail-inspector.ts` exports createMailInspector/buildPanel/REASONS/valid/validId/validIdentity. Lifecycles and returned focusTarget/current/isOpen methods remain; session inspector also retains isCovered. Underlying native elements remain actual native elements, not wrapper nodes.

`inspector/dom.ts` exports structural `InspectorNode`, `InspectorDocument<N>` and `browserInspectorDocument(document): InspectorDocument<HTMLElement>`. InspectorNode contains only properties/methods used by panels. Port operations are createElement/children/attach/replaceChildren/insertBefore. Native attach uses appendChild; native children filters actual HTMLElement instances. Panels return `{root: N, get(part): N}` with exact classes/IDs/accessible labels, so classic stack can still append/focus/show native root nodes after bridge adaptation.

**I5 caller adaptation:** wrap raw native Document once with browserInspectorDocument; pass that port to buildPanel and createInspector. `get` then returns native HTMLElement. Do not cast fake nodes to HTMLElement/Document. Existing `createMailInspector` had an unused document argument; typed options deliberately omit it, so migrated typed callers should drop that unused property. The mail panel builder still needs its InspectorDocument port.

Session InspectorOptions: get, document port, QuerySpine define/subscribe, describe(id):RosterDescription|null, optional onChange/requestClose/inspectHelper/now. RosterDescription and HelperDescription live in inspector/types.ts. Query define return is unknown because unused; subscribe receives full QuerySnapshot. View state owns follow/pause/unseen/buffer/windowed transitions; Rows owns stable stat/turn nodes; RosterView owns stable metadata/helper nodes; core owns exact identity/poll/lock/cover/hide lifecycle. Every unknown HTTP snapshot uses minimal browser `InspectionDisplay` validation; it does **not** claim current shallow backend/legacy checks establish full shared SessionInspection. turnParts checks only documented fields and drops private/unknown-role content unless explicitly loaded UI.

Mail options: get, fetchJson(path,{signal,timeoutMs}), describe(id):{text,identity,eligible}|null, optional onChange/requestClose. Exactly one explicit open reads; same-turn superseded opens never fetch; cover/close/hide cancel and discard late results; ledger replacement/loss withdraws body permanently until explicit reopen. `MessageDisplay` validates used fields and permits `asOf:null` on unavailable responses, matching existing tests. This is intentionally distinct from a false assertion of full shared MessageInspection.

Synthetic fixture port is `fixtureDocument` and `FixtureNode` in inspector/dom.fixture.ts. Nodes model children/order/parent links, attributes/dataset, text, click/scroll handlers, mutable scroll metrics and details state. Operations preserve raw fixture node identity. theme/dom.fixture.ts separately models its narrower port. Canonical theme fixture reads authored JSON via node:fs inside a test-only fixture, validates unknown data, and never uses an ESM JSON import: Bun's shared ESM/CJS JSON namespace cache otherwise breaks the still-live classic `Object.freeze(require(theme.json))` path.

## Fresh verification

After final source/export cleanup:

- `bun run typecheck`: exit 0, all five strict projects: root/runtime/browser/tools/browser-tests. Final explicit repeat returned exit 0; log `/tmp/starnet-ts-5p-typecheck-final.log`.
- `PATH=/Users/davidfava/.local/share/starnet-quality-tools/node-v24.19.0-darwin-arm64/bin:$PATH bunx eslint src/browser --max-warnings 0`: exit 0, no owned findings. Log `/tmp/starnet-ts-5p-lint-final.log`.
- `bun --no-env-file test src/browser`: **30 pass, 0 fail, 187 expect calls, 11 files**. `/tmp/starnet-ts-5p-focused-final.log`.
- `bun --no-env-file test /tmp/starnet-ts-5p-parity.test.mjs`: **4 pass, 0 fail**. `/tmp/starnet-ts-5p-parity-final.log`. Diagnostic executes unchanged original model/mail/session-inspector/mail-inspector regression suites against imported typed factories. Its only adaptations are factory construction and original synthetic DOM operation ports; original assertions and fixtures remain. This caught and fixed null unavailable mail timestamps and the JSON module cache issue. It is external diagnostic evidence, not a production compatibility shim or replacement for colocated typed tests.
- `bunx prettier --check src/browser`: exit 0, all matched files formatted. `/tmp/starnet-ts-5p-format-final.log`.
- `git diff --check`: exit 0.

Broader unchanged-classic compatibility run before the final removal of unused export keywords:

- `bun run test`: **89 pass, 0 fail, 226 expect calls, 58 files**, 50.59s. `/tmp/starnet-ts-5p-all-tests.log`. Export-only cleanup afterward removed no supported consumer; refreshed focused/parity/type/lint checks above passed. Full package must run whole suite again after sprite continuation and I5.

Required diagnostic failures are reported, not suppressed:

- `bun run lint`: exit 1, **259 errors**, no src/browser findings (search confirmed). Remaining classic/tooling migration scope. `/tmp/starnet-ts-5p-rootlint.log`.
- `bun run check:knip`: exit 1, **19 unused exports**, no unused exported types after cleanup. `/tmp/starnet-ts-5p-knip-final.log`. Six owned findings: session REASONS/MOBILE facade, underlying MOBILE, native browserInspectorDocument, mail-inspector REASONS facade, mail GAP facade. Actual I5/native/controller or preserved original-suite consumers are documented below; no false scanner entries added.
- `bunx fallow dead-code --format json`: exit 1, **21 findings: 9 exports + 12 class members**, zero unused files/types/dependencies/import-resolution/boundary issues. `/tmp/starnet-ts-5p-fallow-final.json`. Three exports are legacy control; six are the owned facade/native items above. Class members have actual injected/generic consumers: fixture type/disabled/replace/click; layout reconcile/pages/onPage/pageFor/colorFor/seatFor through createModel factory; Resource invalidate/startTimer through requester/subscriber composition. Do not delete real methods based on analyzer limitations.
- `bunx fallow dupes --summary --quiet`: exit 1, **16 clone families, 25 groups, 483 lines, 1.7%** against 1.0% threshold. Classic and typed preparation coexist deliberately until I5. Re-run after actual switch/deletion; do not ignore or promise it will then pass without evidence.

No final application browser/CSP/public asset build proof is claimed. Controller captured separate original-app Playwright baseline at /tmp/starnet-ts-baseline-browser-proof.json and screenshots; new runtime comparison remains I5/Task 8.

## Dead-code audit and cleanup evidence

Mode: direct **audit**, then authorized **cleanup** within new src/browser ownership. No classic removal was authorized before I5.

1. Preparation traced HTML head/body script references, globals/CommonJS/VM consumers, canonical injection, server resolve/validation and original suites. All old runtime candidates retained because HTML and tests still reach them.
2. Harness/query migration replaced hidden singleton test construction with explicit factories. New typed code has no unused test mutation hooks or copied VM loader. Classic VM fixture/hooks remain reachable until controller wiring changes.
3. Theme/bootstrap migration owns one structural validator and one canonical source. Removed no canonical JSON/resources; extracted focused status/style/assets ports without privileged browser imports. Prepaint's unused export removed; actual side-effect entry test proves reachability. Same active ThemePack instance publication is controller-authorized.
4. Model/mail migration retained supported public names and exact original-suite behavior. Removed a temporary unused layout-values re-export wrapper during development. Kept required layout/hue/route/frame responsibilities; no generic framework or alternate allocation policy introduced.
5. Inspector migration kept raw node identity, poll ownership, locks/withdrawal and plain text semantics. Removed unused key/details expandos from new InspectorNode/fixture after Rows owned its actual node metadata. Native DOM adapter is retained for concrete I5 buildPanel/createInspector callers, currently not wired.
6. Export/scanner cleanup removed only export keywords from internal folderOf/checkoutIdOf, PendingEnvelope, RoomRow, ThemeNode, ThemeFixtureNode and internal prepaint. References remain within their owners. Retained public reason/breakpoint/gap facades because unchanged original tests and/or still-classic controller API need them at I5. If controller chooses to port those tests directly and remove a purely test-facing facade, that must be an evidence-backed cleanup at integration, not scanner suppression.
7. Final source/fixture checks: no worker any/casts/ambient compatibility declarations/TS or ESLint suppressions; no production node:fs/sidecar/server imports. Exact grep's only `as` hits were export alias and human text. Final compiler and owned lint pass; full source paths listed below. No docs/commands/runtime paths changed, so no repository documentation edit belongs to this preparatory checkpoint.

The scoped checkpoint audit is complete; **final 5-P cleanup/acceptance is incomplete** until sprites and integration consumers are finished. No self-review is represented as independent approval.

## Sprite continuation ownership and smallest next steps

Next bounded worker should own sprite runtime migration only in this same assigned checkout, preserving every current edit and controller catalog. Read the original task brief `/tmp/starnet-ts-parallel-5-prepare-brief.md`, this report, current source and original sprite fixture/tests. **Do not redo other domains or alter shared/root/config/HTML/bridge/roles/office-art/server-theme/classic files.** Start with current `src/browser/sprites/load-plan.ts` and its test; remaining renderer source is still untouched `frontend/js/assets.js` (1345 lines), fixture `frontend/js/sprite-runtime.fixture.js`, suite `frontend/js/sprite-theme.test.js`, plus original observer-view drawing/culling/re-entry tests.

Preserve SPRITES API: init/drawBody/groundShadow/ensureSkin/isSkinReady/replacementState/bodyScale/bodyAppearanceStats/setForBody and ready/loading getters. Inject validated catalog, fetch/image/canvas/clock/log capabilities without privileged imports or fake Canvas/Document casts. Returned native sprite canvases/images must remain usable by classic raw Canvas context at I5. Browser-side source state and caller-owned body render fields need honest concrete types from actual producers; do not assert an unknown body/light/manifest into those types.

Existing behavior obligations include default south-pose first paint, early ensureSkin before manifest planning, exact startup budgets, loaded-set jobs, atomic replacement groups/dimension failure/degraded fallback, canonical portrait scale, measured transparent foot padding and stride, smooth facing/walk tween/pose fades/speech state, two-tier bounded/recycled light cache and context-loss restoration, shadow clipping, shouldPaint culling without canvas/light work, per-destination re-entry raster warm-up and deterministic drawing calls. Typed fixture must preserve current synthetic pixel/readback fidelity. Original observer-view tests use sprite-runtime fixture dynamically, so controller must update those paths only at I5 and retain classic fixture until then.

Confirmed source-only cleanup candidates to audit during sprite migration: hexToHsl/BASE_HUE/BASE_SAT have no callers; filterFor always returns empty string but its tint/cache behavior must be traced before removal. SkinStudy appears only in two optional assets.js branches, with no checked-in defining script or test injector found by source search; determine supported injection/compatibility scope before deleting. Do not port arbitrary dead branches or silently drop legitimate fallback/ULTRON behavior.

After sprite implementation, run fresh owned strict compilers/lint/focused/full tests and diagnostics, preserve exact transitional duplicate reporting, then controller performs full independent package review over base357b45b. Final build/native browser integration and classic deletion remain I5; bridge deletion remains Task 7. No source edits should resume until the fresh sprite owner takes over.

## Changed file inventory

Controller-owned modified `src/shared/theme-keys.ts` is not worker-owned. Worker added 51 src/browser TS source/test/fixture files, 4554 physical lines before report:

- `src/browser/bootstrap.test.ts`
- `src/browser/bootstrap.ts`
- `src/browser/data-shim.test.ts`
- `src/browser/data-shim.ts`
- `src/browser/harness.test.ts`
- `src/browser/harness.ts`
- `src/browser/inspector/dom.fixture.ts`
- `src/browser/inspector/dom.ts`
- `src/browser/inspector/format.ts`
- `src/browser/inspector/mail-panel.ts`
- `src/browser/inspector/mail-validation.ts`
- `src/browser/inspector/panel.ts`
- `src/browser/inspector/roster.ts`
- `src/browser/inspector/rows.ts`
- `src/browser/inspector/types.ts`
- `src/browser/inspector/validation.ts`
- `src/browser/inspector/view.ts`
- `src/browser/inspector.test.ts`
- `src/browser/inspector.ts`
- `src/browser/mail/frame.ts`
- `src/browser/mail/geometry.ts`
- `src/browser/mail/types.ts`
- `src/browser/mail-inspector.test.ts`
- `src/browser/mail-inspector.ts`
- `src/browser/mail.test.ts`
- `src/browser/mail.ts`
- `src/browser/model/description.ts`
- `src/browser/model/hues.ts`
- `src/browser/model/identity.ts`
- `src/browser/model/layout.ts`
- `src/browser/model/types.ts`
- `src/browser/model.test.ts`
- `src/browser/model.ts`
- `src/browser/prepaint.test.ts`
- `src/browser/prepaint.ts`
- `src/browser/queryspine/request.ts`
- `src/browser/queryspine/state.ts`
- `src/browser/queryspine/types.ts`
- `src/browser/queryspine.test.ts`
- `src/browser/queryspine.ts`
- `src/browser/sprites/load-plan.test.ts`
- `src/browser/sprites/load-plan.ts`
- `src/browser/theme/assets.ts`
- `src/browser/theme/dom.fixture.ts`
- `src/browser/theme/dom.ts`
- `src/browser/theme/status.ts`
- `src/browser/theme/style.ts`
- `src/browser/theme/validation.ts`
- `src/browser/theme.fixture.ts`
- `src/browser/theme.test.ts`
- `src/browser/theme.ts`
