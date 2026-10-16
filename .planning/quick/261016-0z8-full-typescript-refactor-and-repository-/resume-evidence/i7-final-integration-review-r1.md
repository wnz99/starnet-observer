# Task 7 final integration review R1

No unresolved code findings. **Clean / Approved for the integration code scope below. Requirements and code quality: Approved within this scope.** High 0, Medium 0, Low 0, Nit 0 remaining.

One High integration defect was found and corrected during this single batched pass: making scene/mail.ts mailOf private stranded the direct import in app/couriers.ts:3 and call at :74, breaking main bundling/typechecking. Controller restored the real module export while removing the unused scene/index.ts barrel export. Fresh reread confirms the corrected declaration and consumer agree. Controller also removed the now-unused Point type import after Props.glow deletion; fresh diff confirms that cleanup. Neither defect remains.

This is not Task 7 completion or whole-repository gate approval. Latest supplied native scanner result still reports five real protocol members as unused. No suppression was configured at review time. Any later scanner exception or source amendment needs separate bounded review; all required final root gates remain the controller's responsibility.

## Target and integrity

Independent reviewer leaf; read-only repository review, no delegation. Applied wnz-code-reviewer, its full deep-analysis reference, and wnz-clean-code-js. Read repository AGENTS.md and approved Task 7 PLAN and linked CONTEXT. Model identity is host-assigned and unavailable; no identity claim is inferred. Review target: /home/david/Projects/starnet-observer-resume, HEAD 0cc9ad6d87fd5805d251fe75b174b57b9c73c535, uncommitted tracked modifications/deletions and new files only within the explicit integration/package inventory below. No staging, source edits, checkout, installs, external services or live operations.

Independently compared current bytes against all four supplied manifests. App: 44/52 exact; eight changed paths exactly match fresh amendments. Entry: all six owned entries exact, including both expected deletions; both independently recorded prepaint producer hashes exact. UI: 6/6 exact. Export cleanup: 51/52 exact; sole merged HTTP test equals integration receipt hash and differs from reviewed package only by legacy-bridge.js to main.js URL. All 16 closure-before snapshots independently match declared hashes. Read both integration receipts; did not substitute receipt booleans for the independent current-byte comparisons.

Authorized exact-content reuse: i7-app-full-review-r1.md for 44 unchanged app paths; i7-shared-ports-review-r2.md for unchanged shared/native contents and the pre-amendment basis of two fixture export changes; i7-entry-review-r1.md for eight entries/producers; i7-ui-oracle-review-r1.md for six typed suites/fixture and its complete 607-original-oracle analysis; i7-export-review-r1.md for 51 exact export-cleanup paths. Read reports and preserve their stated limitations. No unchanged package was redundantly re-reviewed. Fresh deltas and their actual callers received direct semantic review. No intended scoped file unavailable.

## Fresh behavior and dependency traces

- HTML boot marker precedes synchronous classic prepaint in head; exactly one module main follows application DOM. Public build bundles prepaint as IIFE and main as browser ESM, requires one output per entry, writes only generated staging paths with exclusive creation, and retains existing atomic promotion/resource containment. Removing classic transpilation/copying does not leave a referenced asset. Public fixture now copies browser/shared TypeScript and excludes only fixture/test files; no deleted classic source is required to build it.
- Root paths mappings connect actual HTML app/prepaint.js and app/main.js URLs to real maintained entries for scanner resolution. They do not change browser ambient ownership: browser tsconfig still extends strict base directly, with DOM libraries and types:[], rather than inheriting root Bun types. Knip project narrowing removes only now-absent old domains/extensions; maintained scripts/frontend executable inventory contains TypeScript only, while required tools/config MJS remain covered. No current application/test JavaScript source is hidden.
- Native Fallow typeAware enabled uses installed semantic refinement. Installed schema explicitly shows private-type-leaks default off; preserving that one off-default rule does not disable an original enabled category. Original ignore patterns unchanged. Read independent i7-class-usage-diagnosis.md; no claim of complete semantic analysis or zero findings is made. Remaining uncertainty remains reported by native scanner.
- Server boot insertion/security/static serving retain nonce, loopback/origin/token authorization, self script CSP, JavaScript MIME, canonical path checks and asset revalidation. New main module is permitted by existing self policy. HTTP test retains its accepted requiredHttpValue rename and boot-before-main assertion; no oracle weakened.
- Fresh runtime import traversal using installed TypeScript parser walked both main and prepaint: 156 concrete source files, zero missing/external imports, zero server/sidecar/test/fixture inputs. Main has exactly one mountObserver call. This source traversal corroborates earlier emitted graph proof; it is not a new emitted build. Type-only edges erase and do not cross the runtime boundary. Fresh source search found no application global publication or bridge consumer.
- Main reads existing bootstrap globals then composes native document/window, real sprites and mount. Pure head creates no application/session owner. Core owns one actual ThemePack, Harness, QuerySpine, state/model and couriers. Mount wires real PanelStack through lifecycle/overlays/renderer. Their new Pick types select actual existing methods; imports are type-only, no runtime cycle or behavior change. PanelStack methods preserve lifecycle suspension, fresh-proof resume, Escape close and roster refresh contracts. Query fixture implements the already-consumed AppQuery port; image fixture implements actual OfficeImage and RecordingResource ports passed through loading/recording, adding no runtime behavior or scanner-only abstraction.
- Reused mount/control/native evidence remains applicable after type/export-only deltas. Fresh traces confirm hidden/terminal generation guards, no hidden subscription/deadline/frame, abort/no-replay control paths, exact identity proof before inspector resume, and actual View.stop teardown remain unmodified. No changed authorization or transport policy.
- Palette audit now recursively includes actual scene/view TypeScript files, alongside model/mail/CSS; entry path included only if present. Absolute typed filenames resolve correctly, tests/fixtures are excluded from production literal inventory, unchanged canonical normalization and independent expected palette remain intact.

## Deletion, dead-code and clean-code assessment

All 12 intended old files absent. Eight classic app/test files plus legacy bridge and three bridge/legacy fixtures/tests have replacements in reviewed typed production/tests or were deliberately obsolete global/VM adapters. The five UI suites reuse accepted 607-oracle preservation, not assertion-count inference. Entry tests retain pure head/active-owner and native-font contracts. Removed bridge has no production HTML/build/scanner consumer; legacy-modules fixture source slicing has no retained importer. No rerun of original AST comparison was needed because all six accepted typed bytes match. Historical docs may mention former paths; they are not runtime consumers and final documentation/disposition delivery remains separately owned.

Props.glow had no actual consumer: StationArt creates Props and uses its five concrete paint methods; glow calls resolve to GeometryPainter, Stations or Surfaces. Removal preserves every painter branch and removes its unused Point import. mailTarget stays used internally by Ledger. constrain stays used by scene camera fit/focus/zoom/pan. Fixture storage remains instantiated through AppFixtureWindow.storage, while unused direct exports disappear. Unused ControlAction type removed. View native adapters remain directly imported from view/native.ts by app/native.ts; only unused index reexports removed. SceneMessage is an exact type rename with every consumer updated. mailOf must remain exported from its actual producer module because Couriers consumes it; corrected accordingly.

Five native class findings were independently traced and retained: AppFixtureNode.type and inspector FixtureNode.type are optional real node-port properties written through document/UI boundaries; RecordingContext.isContextLost is called through optional SpriteContext capability; FontFaceFixture.load is called through real generic FontResource by theme/native.ts:83/:88; DrawingContext.roundRect is called through optional ViewContext by crew.ts:197 and props.ts:196. No evidence of actual dead members among them. This dismissal establishes semantic usage, not permission to suppress the scanner or weaken the approved zero-finding gate.

Applied wnz-clean-code-js to fresh TypeScript deltas and affected callers, with reused prior assessments only for exact bytes. Nine quality candidates considered and dismissed: build entry table; root URL paths; scanner native mode configuration; Pick of actual PanelStack; real fixture implements clauses; recursive palette inventory; narrowed exports/storage privacy; exact SceneMessage rename; removal of Props forwarding helper. Existing patterns and ownership justify each change; no new wrapper, duplicate source of truth, fake call, unsafe cast, broad ambient workaround or copied schema. Ten cleanup candidates considered: nine safe removals/export reductions above and mailOf export reduction. The latter produced the corrected High finding; remaining nine dismissed as unresolved cleanup. Existing five protocol candidates retained for concrete consumers, not speculative public API.

## Verification and limits

Fresh reviewer checks: manifest/receipt/closure SHA256 comparisons above; parser-backed runtime graph traversal (156 files, zero invalid edges); source references and full scoped deltas; git diff --check exit 0 on corrected bytes. No heavy compiler, broad suite, scanner or build rerun: controller explicitly owns those shared-resource jobs. Parent reported strict TS2459 independently reproduced the mailOf defect and started all five strict projects after both fixes; that is controller evidence, not this reviewer's completed-command claim. Existing accepted package checks remain historical exact-byte evidence, not newly executed final-root tests.

Latest inspected supplied i7-finalgraph-fallow-r2.json: five class-member findings; all other categories zero. It predates the final two fixes and must not be labeled final-byte clean evidence. Earlier native Chromium proof, control latch paired proof and UI mutation evidence remain reused within original limits. Dynamic DOM callbacks, generic resource dispatch, browser fonts/images and module evaluation were statically traced and covered by accepted synthetic evidence; no new browser/desktop/macOS/live-provider/SSH/control execution occurred. No visual-parity or final packed acceptance claim.

Code integration review is complete for this inventory. Overall Task 7 convergence remains pending required current root gates and resolution of the scanner-policy requirement. Any later source/config amendment invalidates exact-byte approval only for its affected scope and composition.

## Exact inventory

Fresh integration files (current SHA256):

- `frontend/observer.html` — `37ee279ba2ccac8c62f5bff9afc44b1564f7c7ebd3ef9de0af05c1540fa4c755`
- `tools/public.ts` — `dc97c828d6b79b657d618e3bcd9123d82728ac6c236c955d283795605ba5cea7`
- `tools/public.fixture.ts` — `2d46d4fdac8b138e2761d6362e36fddf69938ea961142e43c6b676860ef3e00b`
- `tools/public.test.ts` — `53574843706e880f3ec837e0a70e1227f5b9570a3440dd5ed5b50a8358a08aa4`
- `tsconfig.json` — `564307aa807bdd01a69a7e52a04f0224e84ed0f84975a00d04db564938fd5e33`
- `.fallowrc.json` — `4580fe60b1438c339b48424f22612d855511dfda048900c56a8c59aefb5d14aa`
- `knip.json` — `55f6358bbf629ce36be4b40f1657097981a5c1ef72678d7ed1652126c3f76183`
- `src/server/http.test.ts` — `8b6e7360f0e16624b962131cbdc78842a46a504adf2c0a9afbc1d61cd7b16cbd`
- `src/browser/theme/configuration.test.ts` — `c404363f6300ae080303c5e5448e5958e26eecde1db710baeda0a72ef8d2a0df`
- `src/browser/app/lifecycle.ts` — `6ede9e162ddeea8535464c0e0b0cf1c6ee8ac067a8705e78aeaa13dfc4a6be8b`
- `src/browser/app/overlays.ts` — `f00285bf6d40b8303fc837f001463a48daf89359a71f470aa15356d96ccfb7b9`
- `src/browser/app/render.ts` — `4ebb8470fbc210e974c8f67b1e87f2dbb26759871a597aa685b64b038387db52`
- `src/browser/app/mount-lifecycle.fixture.ts` — `4cc3024f227013c0cc0d37be02e999475d10befa4dc7a5751a5aadb74b5888cf`
- `src/browser/view/drawing.fixture.ts` — `cbb04dfe513902599293b6d16f520843628f5f8d4153c51c28b3e9e20237a4ed`
- `src/browser/view/props.ts` — `9c80389d7e8468dbf48c799148768866fc277ce2fde09f47c4c07b3d5b7ae621`
- `src/browser/scene/mail.ts` — `f0801f5f7f4fa8e0d2a2cf31a1548e8e5fa3e4f07680018a86968704e2232682`
- `src/browser/scene/index.ts` — `c507f09a70c3529035dae5bfd5d9cbf324b8eccb291cbc5629545d5f6ecbe24d`
- `src/browser/scene/camera.ts` — `cb077f0c8bd7df0de1497aff461ba10df03dddd6a5ae3327f00d821a6575bf36`
- `src/browser/app/controls.ts` — `8e560ca41f79463c977d9f93d15515c9d79114709100e508a2ffa390165bfed3`
- `src/browser/app/environment.fixture.ts` — `7c4bb186a5fd8a3442d4123fb29317603d3b18d18f6593bbbc7079077e1084ae`
- `src/browser/app/dom.fixture.ts` — `a289f9ef88563166ba0d8eeb485d3556be9d3c47a7f9d3c461818ecb4e06f530`
- `src/browser/app/ledger.ts` — `980004d8d90350d2d16ee3b1f0cb8f76249a7bc8ed92e39aa90bcbb1a9fef672`
- `src/browser/scene/types.ts` — `5aa6082c69b96139f52a67b2237b6424fa06e1fa5ef447739e122c9e4936bc48`
- `src/browser/scene/relay.test.ts` — `feba724cf6c4a4057de32f28a99faf6c82999286543bf399f6244e92b5203024`
- `src/browser/view/index.ts` — `af457c2ca5de7f2ae8f87d0252d98000a8347c4a4e78aec93938b149cc6a1666`

Deleted files, reviewed through accepted transfers and fresh consumer closure:

- `frontend/app/control-ui-hosts.test.js`
- `frontend/app/control-ui.test.js`
- `frontend/app/observer-arrange-ui.test.js`
- `frontend/app/observer-prefs-ui.test.js`
- `frontend/app/observer-scene.js`
- `frontend/app/observer-ui.test.js`
- `frontend/app/observer-view.js`
- `frontend/app/observer.js`
- `src/browser/legacy-bridge.fixture.ts`
- `src/browser/legacy-bridge.test.ts`
- `src/browser/legacy-bridge.ts`
- `src/browser/legacy-modules.fixture.ts`

Exact-content reuse from `i7-app-manifest.json` (44 entries; deleted entries shown as such):

- `src/browser/app/admission.test.ts`
- `src/browser/app/admission.ts`
- `src/browser/app/auth-reload.test.ts`
- `src/browser/app/auth-reload.ts`
- `src/browser/app/contracts.ts`
- `src/browser/app/couriers.ts`
- `src/browser/app/data.ts`
- `src/browser/app/deadline.ts`
- `src/browser/app/dom.fixture.test.ts`
- `src/browser/app/dom.ts`
- `src/browser/app/floor.ts`
- `src/browser/app/format.test.ts`
- `src/browser/app/format.ts`
- `src/browser/app/header.ts`
- `src/browser/app/hosts.ts`
- `src/browser/app/mail-text.ts`
- `src/browser/app/mount-control-json.test.ts`
- `src/browser/app/mount-core.ts`
- `src/browser/app/mount-panels.ts`
- `src/browser/app/mount-spawn.test.ts`
- `src/browser/app/mount-sprites.ts`
- `src/browser/app/mount-view.ts`
- `src/browser/app/mount.test.ts`
- `src/browser/app/mount.ts`
- `src/browser/app/native.ts`
- `src/browser/app/navigation.ts`
- `src/browser/app/panel-adapter.ts`
- `src/browser/app/panel-descriptions.ts`
- `src/browser/app/panel-stack.ts`
- `src/browser/app/preferences.ts`
- `src/browser/app/roster/checkouts.ts`
- `src/browser/app/roster/grouping.ts`
- `src/browser/app/roster/project.ts`
- `src/browser/app/roster/repositories.ts`
- `src/browser/app/roster/roster.fixture.ts`
- `src/browser/app/roster/roster.test.ts`
- `src/browser/app/roster/row-view.ts`
- `src/browser/app/roster/row.ts`
- `src/browser/app/roster-ports.ts`
- `src/browser/app/roster.ts`
- `src/browser/app/state.ts`
- `src/browser/app/totals.ts`
- `src/browser/app/ui.ts`
- `src/browser/main.ts`

Exact-content reuse from `i7-entry-tests-manifest.json` (6 entries; deleted entries shown as such):

- `src/browser/legacy-bridge.test.ts` (deleted)
- `src/browser/legacy-bridge.fixture.ts` (deleted)
- `src/browser/composition.test.ts`
- `src/browser/prepaint.integration.test.ts`
- `src/browser/theme/native.fixture.ts`
- `src/browser/theme/native.test.ts`

Exact-content reuse from `i7-ui-tests-manifest.json` (6 entries; deleted entries shown as such):

- `src/browser/app/observer-ui.test.ts`
- `src/browser/app/observer-prefs-ui.test.ts`
- `src/browser/app/observer-arrange-ui.test.ts`
- `src/browser/app/control-ui.test.ts`
- `src/browser/app/control-ui-hosts.test.ts`
- `src/browser/app/ui-test.fixture.ts`

Exact-content reuse from `i7-export-cleanup-manifest.json` (51 entries; deleted entries shown as such):

- `src/browser/model.ts`
- `src/browser/model/hues.ts`
- `src/browser/model/identity.ts`
- `src/browser/office-art.test.ts`
- `src/browser/office-art.ts`
- `src/browser/office-art/human.ts`
- `src/browser/office-art/types.ts`
- `src/browser/scene/actor.ts`
- `src/browser/scene/movement.ts`
- `src/server/http.fixture.ts`
- `src/server/http.sqlite-oracle.test.ts`
- `src/sidecar/bus/index.test.ts`
- `src/sidecar/bus/public.ts`
- `src/sidecar/bus/relay.ts`
- `src/sidecar/bus/selection.ts`
- `src/sidecar/bus/types.ts`
- `src/sidecar/control/control-remote.integration.test.ts`
- `src/sidecar/control/control.integration.test.ts`
- `src/sidecar/control/overseer.test.ts`
- `src/sidecar/control/transport.ts`
- `src/sidecar/control/types.ts`
- `src/sidecar/helpers/graph.ts`
- `src/sidecar/identity/birth.ts`
- `src/sidecar/identity/configuration.ts`
- `src/sidecar/identity/execute.ts`
- `src/sidecar/identity/index.test.ts`
- `src/sidecar/identity/types.ts`
- `src/sidecar/observer/aggregation.ts`
- `src/sidecar/observer/contracts.ts`
- `src/sidecar/observer/counters.ts`
- `src/sidecar/observer/enrichment.ts`
- `src/sidecar/observer/evidence.ts`
- `src/sidecar/observer/identity-process.test.ts`
- `src/sidecar/observer/index.test.ts`
- `src/sidecar/observer/index.ts`
- `src/sidecar/observer/inspection-proof.ts`
- `src/sidecar/observer/inspection.ts`
- `src/sidecar/observer/inventory.ts`
- `src/sidecar/observer/lineage.ts`
- `src/sidecar/observer/ownership.ts`
- `src/sidecar/observer/publication.ts`
- `src/sidecar/observer/state.ts`
- `src/sidecar/observer/warm-transcripts.test.ts`
- `src/sidecar/observer/warmup.ts`
- `src/sidecar/presentation/presentation.integration.test.ts`
- `src/sidecar/projects/discovery.ts`
- `src/sidecar/projects/index.test.ts`
- `src/sidecar/projects/types.ts`
- `src/sidecar/sqlite/protocol.ts`
- `src/sidecar/sqlite/validate-bus.ts`
- `tools/start.test.ts`

Additional exact producer reuse: `src/browser/prepaint.ts`, `src/browser/prepaint.test.ts`.
