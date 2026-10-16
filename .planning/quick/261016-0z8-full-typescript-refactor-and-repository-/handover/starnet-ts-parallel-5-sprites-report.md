# 5-P sprite continuation and combined package handoff

Status: **STOPPED AT USER REQUEST — verified WIP, not independently accepted.** Implementation is stopped for the machine move. This handoff does not authorize further implementation or start I5. All owned test/build jobs finished; no source writer remains. No commits, staging, branch changes or FLOW/GSD writes were performed.

## Checkout, ownership and baseline

- Checkout: `/Users/davidfava/Projects/Personal/starnet-observer-typescript-5-prepare`.
- Branch: `wip/typescript-refactor-5-prepare`; HEAD `6599db5`.
- Independent **full 5-P** review base: **`357b45b`**, including controller prelude `6599db5`, controller-owned shared catalog changes, all prior browser preparation and this sprite continuation. Reviewing only the sprite diff or post-6599db5 diff is insufficient.
- Previous coherent checkpoint: `/tmp/starnet-ts-parallel-5-prepare-report.md`. Its exact interfaces, 51-file inventory and consumer requests remain applicable. Its NEEDS_CONTEXT status was a partial checkpoint, not acceptance.
- Preserved all previous browser edits and controller-owned dirty `src/shared/theme-keys.ts`. Final tracked status remains modified shared catalog plus untracked `src/browser/` (70 files total). No classic frontend, shared/root/config/build/HTML/bridge/office-art/server-theme source was edited by this continuation. Frozen `sprites/load-plan.ts` and its test were reused without semantic edits.
- Applied caveman, wnz-task-implementer, wnz-clean-code-js, wnz-test-quality, wnz-dead-code, wnz-doc-write-expert and verify-before-complete. Resolved host model unavailable; no external provider was invoked.
- Synthetic local inputs only; authored canonical theme JSON was the only artwork catalog read. No private artwork/inventory, SSH, live controls/actions, paid runs or delegation.

## Current sprite files

Nineteen new files supplement the two previously prepared load-plan files, all under `src/browser/sprites/`:

- `assets.ts`: direct public factory and original surface.
- `types.ts`: genuine resource/context/catalog/body/appearance/init contracts.
- `native.ts`: real HTMLCanvasElement/HTMLImageElement browser dependencies.
- `loading.ts`: manifest planning, startup, lazy sets, atomic replacements and metadata.
- `geometry.ts`: alpha padding, foot-band and visible stride measurements/caches.
- `lighting.ts`: quantization, probation/kept tiers, recycling and context-loss invalidation.
- `light-painter.ts`: native-resolution ramp and emissive-edge composition.
- `facing.ts`: eased facing, angular velocity/braking, displacement trust and sector hysteresis.
- `pose.ts`: track selection, walk/cardinal fallback, pivot, gesture and blink.
- `animation.ts`: distance/angular frame phase and walk tween.
- `placement.ts`: native geometry, feet, seating, speech/breath and pose-transition state.
- `paint.ts`: conservative visibility, source composition, shadow/speech/desk clipping and painting.
- `destination.ts`: per-destination re-entry raster warm-up.
- `renderer.ts`: synchronous draw orchestration, shared tween canvas and destination state.
- `shadow.ts`: unchanged penumbra/contact/spill geometry.
- `runtime.fixture.ts`: direct typed runtime/resource fixture, delayed/error/decode image hooks and context events.
- `recorder.fixture.ts`: drawing calls, save/restore/transforms, device extents and alpha readback.
- `assets.test.ts`: faithful original atomic-replacement regression port.
- `drawing.test.ts`: canonical/bootstrap, startup/error, drawing, alpha/stride, culling/re-entry, light-cache and fallback oracles.

`types.ts` keeps only consumed exports. SpriteCrew, SpriteBounds, SpritePose and SpriteFade remain internal types used by the exported outer contracts. No fake native Canvas/Document casts, unknown-body assertions, any, ambient compatibility shims, TS/ESLint suppressions or scanner exclusions were added. Tuple `as const` annotations retain real immutable tuple shapes; they are not boundary assertions.

## Exact I5 sprite interfaces

`assets.ts` exports:

```ts
createSprites<I extends SpriteResource, C extends SpriteCanvas<I | C>>(
  dependencies: SpriteDependencies<I, C>,
)
```

Dependencies are `{ data, createCanvas, loadImage, fetch, log? }`:

- `data`: `{ DEFAULT_SKIN: string; SKINS: Readonly<Record<string, SpriteMetadata>> }`.
- `createCanvas(): C`, `loadImage(path: string): Promise<I | null>`.
- `fetch(path, {cache: 'no-cache'})` returns `{ok, json(): Promise<unknown>}`.
- Optional logger supplies log/warn. No clock/global singleton is created; drawing still takes caller `nowMs`.

Returned surface remains `init`, `drawBody`, `groundShadow`, `ensureSkin`, `isSkinReady`, `replacementState`, `bodyScale`, `bodyAppearanceStats`, `setForBody`, and live `ready`/`loading` getters. `drawBody(context, body, nowMs, appearance?)` returns `{top,w,h,painted?:false} | null`. `groundShadow(context,x,y,r,options?)` retains its original call shape. Render-side body fields are enumerated in `SpriteBody<R>`; callers can pass their genuine structural body objects without assertions.

`native.ts` exports:

```ts
browserSpriteDependencies(
  data: SpriteCatalog,
  document: Pick<Document, 'createElement'>,
): SpriteDependencies<HTMLImageElement, HTMLCanvasElement>
```

Concrete I5 construction:

```ts
const sprites = createSprites(browserSpriteDependencies(DATA, document));
```

Native canvases/images remain actual native objects usable by raw CanvasRenderingContext2D. The native loader preserves successful onload when an older image implementation omits decode, and returns null on decode rejection/synchronous decode failure or image error. Context-loss and getTransform optional-capability fallbacks remain supported.

`init({crew?, onDegraded?})` accepts checked crew groups with set/scale/sourceStandingHeight/presentation and string-path track records. Degradation is `{skin, reason: 'image-load' | 'image-dimensions'}`. **I5 must keep the already-started prepaint ThemePack object and its status lifetime.** Sprites neither recreates nor overwrites that object; wire degradation through the existing object's warning callback and pass its selected crew snapshot at the existing caller. No shared producer changes are needed.

Typed fixture exports `prepare(options?)` for explicit pre-init tests and `load(options?)` for awaited init/optional skin settlement. Results are `{SPRITES, offscreen, canvases, context(log, extents?, destination?)}`. Image hooks preserve load/error/decode delays; alpha hooks add genuine per-frame foot/stride partitions. Recorder state and extents track scale/translate/transform/save/restore. Fixture resources implement the structural capability contracts directly.

## Preserved behavior and oracle mapping

- Original baseline `bun --no-env-file test frontend/js/sprite-theme.test.js`: 1 pass, 0 fail before the port.
- `assets.test.ts` preserves original atomic success, delay, load/dimension failure, fallback readiness/promise identity, replacement-independent settlement, decode delay, reused set-name isolation, leading-slash inherited matching, exact 64 replacement requests, scale/standing-height/cycle/seat metadata and six distinct distance-phased frames. The original VM bootstrap-composition segment is covered through actual readBootstrap/createData construction in `drawing.test.ts`, using changed canonical sets and all three crew skins.
- Startup test preserves early pre-manifest recovery, first south request, 89 synthetic startup image requests with exactly two south requests (prime plus canonical warm), deduplicated set jobs and first paint before a held typing frame.
- Direct drawing tests retain native master dimensions, device snapping, premultiplied lighter tween, seat clipping, pose fade, per-frame alpha packing, measured review stride, cold manifest fallback, failed prime fallback, decode failure and degradation-listener isolation.
- Culling/re-entry tests preserve identical render state, lazy light sampling, no warm-frame canvas emission on rejection, conservative transformed bounds including speech and rings, and destination-specific warm-up before shadow work.
- Light tests verify 600ms stable-frame promotion, 96-frame probation ring/recycling, 4,194,304 kept-pixel limit, context loss/restoration flush/rebuild, and original-master fallback on lost offscreen contexts.
- Exact original-recorder diagnostic compares classic and typed factories across **1,440 draws**, including walk/idle/facing/speech/sit/reduced motion/lighting/culling/re-entry. Every body state field, conservative bounds, returned geometry, stage call, offscreen pixel/readback/blend/light call and cache statistic matches.
- Exact original observer-view regression suite also passes with only the sprite fixture construction adapted to the typed factory. All original assertions remain, including 192-body render-state culling/re-entry and real replacement sprites in station/office poses.
- Important existing nuance retained: first-use foot/stride alpha measurement can happen before shouldPaint rejects a cold frame. Rejection skips paint/light composition; the direct zero-Canvas-work assertion uses already-warmed geometry. This is original behavior, not a new approximation.

## Last actual verification after final source edits

Bun 1.3.13; ESLint/Fallow use Node24 prefix `/Users/davidfava/.local/share/starnet-quality-tools/node-v24.19.0-darwin-arm64/bin` on PATH.

- `bun run test`: **exit 0, 101 pass, 0 fail, 390 expect calls, 60 files, 49.69s**. `/tmp/starnet-ts-5p-combined-all-tests-final.log`.
- `bun --no-env-file test src/browser`: **exit 0, 42 pass, 0 fail, 351 expect calls, 13 files**. `/tmp/starnet-ts-5p-combined-focused-final.log`.
- Focused sprite suite: **13 pass, 0 fail, 168 expect calls, 3 files**. `/tmp/starnet-ts-sprites-focused.log`. Final native-adapter-only change is additionally covered by strict compilation and emitted entry proof below; it is not imported by this fixture suite.
- `bun run typecheck`: **exit 0**, all five strict projects. `/tmp/starnet-ts-5p-combined-typecheck-final.log`.
- `PATH=<Node24-prefix>:$PATH bunx eslint src/browser --max-warnings 0`: **exit 0**. `/tmp/starnet-ts-5p-combined-lint-final.log`.
- `bunx prettier --check src/browser`: **exit 0**. `/tmp/starnet-ts-5p-combined-format-final.log`.
- `bun --no-env-file test /tmp/sprite-parity.test.mjs /tmp/starnet-sprite-original-view.test.mjs /tmp/starnet-sprite-emitted.test.mjs`: **exit 0, 3 pass, 0 fail**, 4.21s. `/tmp/starnet-ts-sprites-parity-view-emitted-final.log`. The emitted test builds the **real assets.ts and native.ts browser ESM entry files**, checks generated source has no node:/bun: imports, imports actual emitted assets/native modules and paints through the emitted factory using the original recorder. It creates no fake production entrypoint. This is sprite entry emission proof, not public HTML/CSP/root build acceptance.
- `bun --no-env-file test /tmp/starnet-ts-5p-parity.test.mjs`: **exit 0, 4 pass, 0 fail** for unchanged typed model/mail/session-inspector/mail-inspector against original regression assertions. `/tmp/starnet-ts-5p-combined-original-domains-final.log`. Later changes were sprite loading/native only, with no dependency path from these four domains.
- `git diff --check`: **exit 0**; owned untracked file formatting is separately covered by Prettier. `git diff --name-only -- frontend` is empty.
- Isolated source-copy mutation diagnostic `python3 /tmp/starnet-sprite-mutations.py`: **exit 0**, both intentionally faulty copies exit 1 for the intended failures: ground-anchor change breaks drawing/atomic geometry assertions; early manifest-miss memoization breaks startup recovery/budget assertions. Scripts never mutate the real checkout. `/tmp/starnet-sprite-mutations.json`, `/tmp/starnet-sprite-mutation-foot-anchor.log`, `/tmp/starnet-sprite-mutation-pre-manifest-memo.log`.

All final owned jobs were polled to completed exit status after the user stop. Earlier duplicate verification sessions also completed. No background job needs termination or resumption.

## Required diagnostics and ownership

These failures remain explicit; no suppression or fake scanner entry was added:

- Root `bun run lint`: **exit 1, 259 errors**, no src/browser findings. `/tmp/starnet-ts-5p-combined-rootlint.log`. Remaining classic/tooling migration belongs to controller/other tasks.
- `bun run check:knip`: **exit 1, 1 unused file + 19 exports, zero unused exported types**. `/tmp/starnet-ts-5p-combined-knip-final.log`. Native adapter file `src/browser/sprites/native.ts` is deliberately retained for the exact I5 construction above and is exercised by actual emitted-entry diagnostics; no active bridge imports it yet. Six previous browser facade/native findings remain as documented in the prior checkpoint (session REASONS/MOBILE, underlying MOBILE, browserInspectorDocument, mail-inspector REASONS, mail GAP). Remaining exports belong to legacy sidecar/query fixture owners.
- `bunx fallow dead-code --format json`: **exit 1, 58 findings = 1 unused adapter file + 9 exports + 48 class members**. `/tmp/starnet-ts-5p-combined-fallow-final.json`. No unresolved imports, unlisted/unused dependencies, unused types, private type leaks or circular/re-export cycles reported. Boundary/policy zero counts do **not** establish verification: Fallow explicitly says architecture boundaries and rule packs are not configured.
- Fallow members retained on concrete reachability evidence: previous 12 inspector/layout/query members remain documented by prior checkpoint. New 36 comprise geometry getTrackPad/getFootPad (called by placement.contact), recorder accessors/drawing/transform/readback methods (consumed through SpriteContext and drawing tests), and fixture getContext/addEventListener/context-event/pixels/resize/decodeWith methods (consumed through SpriteCanvas/load hooks/tests). Getter/setter pairs are reported twice. Scale is exercised directly by the native geometry test. These generic/injected member findings are not evidence of dead code.
- `bunx fallow dupes --summary --quiet`: **exit 1, 23 clone families, 32 groups, 628 duplicated lines, 2.0% versus 1.0% threshold**. `/tmp/starnet-ts-5p-combined-dupes-final.log`. Classic and TS source/tests coexist intentionally until I5; no claim that later deletion automatically makes the gate pass.
- `bun run dependency-isolation`: **exit 1**, `Script not found "build"`; root has no build script at this preparation boundary. `/tmp/starnet-ts-5p-combined-isolation.log`. Controller I5 owns root build/public/package wiring; this worker did not create it.

## Direct dead-code audit and authorized cleanup

Mode: audit then cleanup within new sprite ownership; classic deletion remained prohibited.

1. Traced original assets, HTML, VM fixture, sprite-theme tests and original observer-view consumers. Classic assets/load-plan/fixture/tests are still active and must remain until the atomic I5 switch. No classic cleanup performed.
2. Root explicitly confirmed SkinStudy has no checked-in definition/injector/HTML consumer. Omitted its two unreachable optional branches. Removed unused hexToHsl, BASE_HUE, BASE_SAT and meta from the new implementation.
3. Traced filterFor as fixed empty-string output and tintFrames as its sole caller. Removed redundant per-agent arrays/tint branch; every selected native frame identity and draw outcome is proven identical by complete call/state parity. Meaningful light/tween/frame/foot/cycle caches remain.
4. Removed temporary unused rendering helper wrappers and unnecessary exported internal types/constants. Unknown manifest validation now calls the frozen groupTracks owner once; no duplicated default catalog or permissive boundary cast remains.
5. Preserved native adapter and generic fixture contracts on explicit supported consumer evidence above. Source comment technical detail was retained; minimal prose/date rewording avoids demonstrated heuristic false positives that mistook ordinary words such as if/for/while, braces and dates for disabled code.
6. Scoped cleanup is complete for new sprite code. Full legacy/source closure remains I5 controller work. No unresolved in-scope obsolete source is knowingly left. Self-review does not replace the fresh independent full-package review.

## Combined 5-P package and precise resume boundary

The prior checkpoint remains the authoritative detailed handoff for unchanged bootstrap/prepaint/theme, harness/query resources, data/model/mail and inspectors. Final fresh strict/lint/focused/full checks above cover that entire 70-file preparation together with sprites. Prepaint's emitted test still proves synchronous theme application and exact same active ThemePack status object on handoff.

Preserve these prior exact I5 caller requests:

- ReadBootstrap owns narrowing of injected unknown fields and canonical default validation; do not duplicate server validation or invent a default manifest.
- Reuse the already-started `window.ThemePack` object. Do not construct a new theme factory or overwrite its status lifetime.
- Construct factories using validated canonical defaults, receiver-safe reload/timers and genuine native capabilities.
- Combine mail named constants/functions with `createMail(defaults)` for the transitional ObserverMail facade.
- Wrap native Document using browserInspectorDocument for panel/buildInspector calls; returned nodes remain genuine HTMLElement objects. Drop the unused document option from createMailInspector.
- Construct SPRITES exactly through createSprites/browserSpriteDependencies above; pass active checked crew and degradation callback at the existing controller call site.
- Update original observer-view real-sprite fixture imports only during I5; the old VM fixture/classic sprite test remains live until that switch.

No public application browser/CSP/local public-root switch, role-dependent office art/server themes, bridge wiring/deletion or Task5 acceptance is claimed. Root's original 1440x1000 Playwright screenshots/proof remain separate baseline evidence for later I5/Task8 browser verification.

After the machine move and explicit resumption:

1. Restore this WIP checkout and prior checkpoint/report context, preserving every edit. If carrying diagnostic evidence, copy this report plus the named /tmp scripts/logs; temporary files are not tracked by the branch.
2. Controller performs fresh independent **full357b45b package** review, including controller shared/bootstrap/compiler/catalog prelude and all 70 browser files. No previous partial checkpoint or this self-review grants approval.
3. Resolve review findings only under resumed authorization. Then controller performs I5's sequential bridge/build/public/HTML/role/server-theme consumer switch and required original consumer cleanup. Keep native adapters with their named callers, not fake scanner entrypoints.
4. Re-run strict/owned/full suites, actual root/public browser/CSP checks, dependency isolation and unsuppressed scanners on the integrated reviewed head. Actual new browser baseline comparison remains I5/Task8.
5. No worker implementation should restart automatically; user explicitly stopped for migration. Root owns snapshot/push/branch records and all commits.
