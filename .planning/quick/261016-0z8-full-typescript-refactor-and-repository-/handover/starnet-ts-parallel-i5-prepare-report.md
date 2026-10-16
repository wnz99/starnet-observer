# I5 read-only preparation readiness

Status: **NEEDS_CONTEXT** for implementation. The bounded read-only preparation is complete. No implementation is authorized by this report. Resume only after the controller accepts/freezes whole Task 4 and whole 5-P (including sprites), refreshes the assigned checkout to those exact producers, supplies the accepted sprite interface, and explicitly sends GO.

## Scope and provenance

Reader: the execution controller and the next bounded I5 implementer. Purpose: preserve the real theme/office-art behavior and identify exact controller-owned integration changes before the atomic public runtime switch.

- Checkout: `/Users/davidfava/Projects/Personal/starnet-observer-typescript-5-integration`; branch `wip/typescript-refactor-5-integration`; inspected clean HEAD `c8e3379ad654b1a2225e417736e9581442ddfa13`.
- Brief: `/tmp/starnet-ts-parallel-i5-prepare-brief.md`. Frozen non-sprite interface evidence: `/tmp/starnet-ts-parallel-5-prepare-report.md`. That report explicitly says 5-P is not accepted. No mutable worker checkout was read.
- Read-only source audit covers `sidecar/theme-packs.js`, shared theme/bootstrap/key contracts, classic role/office-art modules, mixed theme/office-art/view/model/query suites, narrow arrangement integration, observer polling/query consumers, HTML, server, validator, runtime-paths, package/build/compiler/scanner wiring.
- Future worker ownership: themes/office-art domain code and colocated tests, plus explicitly assigned narrow arrangement-model and observer-query coordinating test ports. Controller exclusively owns shared producers, bootstrap/bridge, root/build/public/HTML/package/server/CLI/scanner and common caller wiring. Any larger UI-suite movement needs controller ownership allocation.
- No source/config edits, deletions, staging, commits, branch changes, FLOW/GSD writes, delegation, provider turns, SSH, live inventories or private-pack reads. The only written deliverable is this `/tmp` report. Tests use canonical authored assets and disposable synthetic roots.
- Skills applied: `wnz-task-implementer` reporting/input discipline, `wnz-clean-code-js`, `wnz-dead-code` in audit mode, `wnz-test-quality`, `verify-before-complete`, and `wnz-doc-write-expert` for this report. Caveman applies to chat, not this durable report. Graphify instructions were read; no `graphify-out` exists. Graph generation would violate read-only/no-delegation constraints, so source tracing was used.
- Bun is 1.3.13. Resolved exact model identity/effort is unavailable from the host; no provider was invoked to force defaults. `llm-bus whoami` and `llm-bus list` ran; no peer message was warranted by read-only work.

## Verified domain invariants

### Theme schema and pure resolution

`sidecar/theme-packs.js` remains the live server loader. Four supported exports are `validatePack`, `resolvePack`, `loadThemePack`, and `validateInstalledPacks`. Preserve their meaningful behavior with typed imports; do not retain CommonJS wrappers solely for old tests.

- ID is `/^[a-z0-9][a-z0-9-]{0,31}$/`; version must be 1. Custom packs extend `starnet`. Unknown fields fail at every checked object. Default manifests require complete UI, scene and crew data.
- UI color keys derive from canonical defaults. Values allow six-digit hex or bounded rgba channels/alpha. Chrome is classic/pixel independently of typography classic/dm-sans/pixel. Typography scale is finite 0.9–1.1. Authored typography cannot supply derived font URLs.
- Shape radii have four finite entries 0–24; badgeCut classic/none; decor values are booleans. Logo has only branding PNG path and nonempty alt up to 80 characters, excluding controls and `<`/`>`.
- Scene colors derive from defaults; projectAccents contains exactly ten six-digit hex colors. Effects are rain/none and station/none. Art is station with no assets, or complete 34-role home-office art. Home-office resolves both effects to none; omission does not evade inherited-effect checks.
- Crew has only blank/blank_blue/blank_amber. Canonical metadata is set, scale 0.25, sourceStandingHeight 76, presentation review and complete tracks. Custom replacement groups allow tracks only. Track counts: eight rot directions ×1, eight walk directions ×6, south/east/north/west sit ×1, type.north ×4.
- Canonical frame paths are `assets/sprites/<set>/<frame>.png`; replacement paths are contained relative `crew/...png`. Scene paths are `scene/...png`; no traversal, escapes, query, remote, backslash or arbitrary extension.
- Resolution clones canonical defaults; only UI colors/typography/shapes/decor and scene colors merge by key. Other fields replace. Replaced logical crew inherits canonical geometry/presentation, changes set to `<pack>_<logical>`, and replaces complete tracks. Resolution does not derive resource URLs and must not mutate defaults.
- Legacy color overrides allow accent/background/panel/text hex only. Accent sets phosphor and chrome and derives rgba(r,g,b,.22). Invalid legacy colors throw even for invalid selected packs; do not swallow them into fallback.

### Filesystem, resources and failure contracts

Existing `readBounded` resolves the lexical candidate inside root, verifies its realpath remains inside root, opens canonical path with O_RDONLY|O_NOFOLLOW|O_NONBLOCK, requires a regular bounded file, reads at most size+1/limit+1, then checks size, candidate device/inode and containment again. Preserve these protections rather than replacing them with exists/readFile alone. Existing checks are not a claim of exhaustive hostile concurrent-filesystem protection.

Pack directory resolution canonicalizes `assets/themes`, verifies containment, rejects a selected pack-directory symlink, requires the resolved pack directory inside themes, and requires a directory. Author discovery ignores directory symlinks, accepts real directories only, validates directory IDs and manifest identities, enforces a 16-pack maximum, and returns sorted IDs.

| Resource | Per-resource and aggregate contract |
| --- | --- |
| Manifest and OFL text | 65,536 bytes each |
| Crew PNG | 131,072 bytes; exactly 144×144; at most 384 unique public URLs, 4 MiB charged crew bytes, 32 MiB decoded bytes |
| Scene PNG | 262,144 bytes; exact role-native width/height; at most 34 unique URLs, 6 MiB bytes, 36 MiB decoded bytes |
| Combined image decoding | Crew + scene at most 68 MiB |
| Logo PNG | 131,072 bytes; positive dimensions at most 1024×256 |
| Font | 524,288 bytes; at least 48 bytes, wOF2 signature, embedded length equals actual length |
| Font license | SIL OPEN FONT LICENSE and Version 1.1 required |

PNG structural validation requires at least 33 bytes, PNG signature, IHDR length 13/type IHDR, positive dimensions and exact/bounded sizes; decoded cost is width×height×4. This is header validation, not full image decode. Browser atomic decode remains necessary.

Crew resource accounting includes canonical fallback groups alongside replacements, deduplicates by public URL, and validates every referenced image. Crew byte charging follows existing rule: selected-root resources, or every resource for canonical pack; fallback decode/count remains included. Scene shared URLs must satisfy every assigned role's dimensions even when bytes/decoded totals are deduplicated. URLs are derived from resolved public root, never filesystem paths.

Font mapping is fixed: dm-sans.woff2 + DM-Sans-OFL.txt; pixel uses jersey-10.woff2/Jersey-10-OFL.txt and silkscreen.woff2/Silkscreen-OFL.txt. Preserve local derived `font` versus `fonts` output shape.

`loadThemePack` behavior partitions matter:

1. Bad requested ID throws `Invalid theme.pack ID`.
2. Canonical manifest/resources are loaded first; canonical failure fails startup.
3. Requested canonical pack resolves overrides and uses validated canonical crew URLs.
4. Missing selected `theme.json` throws `Unknown or uninstalled theme pack: <id>`; this is not fallback.
5. An installed invalid selected pack falls back to canonical, retaining requestedId, effectiveId starnet and one bounded theme-pack-invalid warning. Specific structural reasons remain; otherwise resource-unavailable. No raw filesystem errors/private paths reach warnings.
6. `validateInstalledPacks` fails invalid installations rather than silently accepting fallback. Build must not accidentally call strict author validation as a new selection policy and reject a startup-compatible invalid unselected pack.

### Office-art group and rendering

Live API is `load`, `create`, `ROLE_NAMES`. Preserve no-retry/no-timeout behavior. `load` validates all role URLs and image capability before constructing images. Same-origin scene regex permits only `/assets/themes/<id>/scene/<safe folders>/<safe name>.png`. It rejects remote URLs, dot segments, queries, wrong directory and uppercase IDs.

Each URL creates one image, marks async decoding, and decodes once. Every role sharing it must match its own native dimensions. Successful publication occurs once, only after every decode, as frozen ready result + frozen role map. First known decode rejection publishes scene-art-load immediately; first known dimension mismatch publishes scene-art-dimensions immediately. An unrelated hung decode cannot delay known failure. Late success/rejection never reactivates or adds another settlement; late rejected promises remain handled. Failure exposes only state/reason, no staged image map or raw error. Constructor/decode synchronous failures remain bounded. Existing image.onload/image.onerror fallback remains meaningful for image capabilities lacking decode.

Composition takes already-owned geometry and colors; it never reads observer state or computes routes. `draw` uses native source dimensions and rounded projected foot-anchor position. `tile` clips the projected diamond rect and draws whole tiles across floor(rect.x/y) to rect extents, including partial boundary cells. `edge` clips the horizontal projected span and repeats whole units; orientation x holds x constant and advances y, orientation y advances x. Human fallback preserves 16×crewHeight bounds scaled by size, sitting proportions and provider hair tones amber/cyan; unknown skin keeps neutral head. No new resizing policy belongs here.

## Minimal shared producer request — controller-owned

Move the exact existing `frontend/app/scene-art-roles.js` data into `src/shared/scene-art-roles.ts`, preserving all 34 keys, insertion order and every numeric/string value. Preserve runtime freezing of source/foot/extent, each role and the table. No parallel role-name list or copied table in server/browser/fixtures.

Proposed shared contract, subject to controller freeze:

- `SceneArtRole` readonly fields: source {width,height}, foot {x,y}, extent {w,h,height}; orientation diamond|x|y|corner|none; repeat tile|edge|none; depthPass surface|rear|furniture|chair|crew|mail.
- `SCENE_ART_ROLES`: exact-key readonly runtime table satisfying that shape.
- `SceneArtRoleName = keyof typeof SCENE_ART_ROLES`.
- Change `ThemeContents.scene.art` home-office assets from `Readonly<Record<string,string>>` to `Readonly<Record<SceneArtRoleName,string>>`, using a type-only import. Canonical ThemeDefault remains separate from resolved ThemeSnapshot. Do not introduce a second default manifest, color catalog, crew catalog or track catalog.
- The controller must also update the accepted browser unknown-bootstrap validator in `src/browser/theme/validation.ts`: for home-office assets, prove every actual role from this same runtime table has a string value before returning ThemeSnapshot/ThemeDefault. A string-valued arbitrary record is insufficient for the narrowed contract. Preserve existing handling of extra fields unless the controller explicitly changes that behavior; no duplicated role catalog or type-only promise. Browser `readBootstrap` and theme construction consume this validator; the server manifest validator must independently prove complete allowed role keys against the same table.
- If typed iteration needs an exported role-name collection or predicate, derive it from the table in the same owner. Do not assert arbitrary Object.keys data to the role union at consumers. Expose only helpers with real consumers.

Expected worker server owner: `src/sidecar/themes/` with colocated tests. Keep raw external JSON unknown until manifest-specific validation; raw inherited custom manifest is not ThemeSnapshot or ThemeDefault. Local server input types need not become a shared schema framework. Consume existing shared ConfigInput theme shape and accepted runtime theme key catalogs instead of copying catalogs currently present in classic source. Existing API's required explicit publicRoot should replace the old __dirname-based default. Proposed caller shape is `loadThemePack(theme, publicRoot)` and `validateInstalledPacks(publicRoot)` unless controller freezes a different coherent signature before GO.

Office-art owner should retain a small injectable image capability and draw capability that preserve native image identity. Tests must use honest synthetic image/context types; native Canvas drawImage must receive actual browser image objects. The accepted sprite capability is still unknown: this report deliberately specifies no factory name or constructor arguments for it.

## Meaningful test migration map

All ranges below refer to unchanged baseline files, not future stable line numbers. Preserve assertions by behavior; remove obsolete VM/string plumbing only after replacement evidence exists.

| Original evidence | Future responsible owner and protected behavior |
| --- | --- |
| theme-pack.test.js 20–126 | themes colocated tests: canonical defaults, independent chrome/profile, merge/default immutability, legacy overrides, complete schema/invalid values |
| theme-pack.test.js 127–165 | shared role tests owned by controller: 34-role footprint, root/helper chair distinction, projected boxes inside native bounds, 512×512 ceilings |
| theme-pack.test.js 166–226 | browser theme/bootstrap tests: recursive freezing and canonical default availability. Old pre-nonce helper VM bootstrap is replaced by real emitted prepaint boot order rather than retaining obsolete classic loading |
| theme-pack.test.js 227–346 | browser theme tests: all 54 color bindings, fixed shapes, sparse/default fallback, unknown key exclusion, decor/badge flags, independent chrome/profile, type-scale behavior |
| theme-pack.test.js 347–491 | browser theme asset/status tests: DM Sans descriptors/local URL guard/classic skip, pixel two-font mapping/local guards, async failure fallback and one plain warning |
| theme-pack.test.js 492–569 | browser theme logo tests: original mark until successful decode, fallback restore, correct alt/metrics and local URL guards |
| theme-pack.test.js 570–654 | browser theme/prepaint tests: text-only deduplicated bounded warnings/notices; requested/effective status, delayed mount, canonical boot style before body |
| theme-pack.test.js 655–669 | tools/build and server tests: nonce bootstrap before synchronous head prepaint, exactly one executable prepaint, before body/mount; inspect emitted served document rather than stale classic filenames |
| theme-pack.test.js 670–856 | retain canonical palette/CSS configuration audit in typed nearby theme test owner: model/mail/view palette inventories, all interface CSS variables, no remote CSS, fixed numeric metrics, independent pixel chrome/type, unclipped focus/scroll/decorative pseudo-elements, unchanged logo metrics. Update executable-source inputs to actual typed owners; do not drop obligations merely because old source paths disappear |
| theme-pack.test.js 857–1145 | themes colocated synthetic IO tests: missing/bad IDs; valid inheritance; bounded/path-safe fallback; malformed/oversize manifests; replacement metadata/URLs and default siblings; path grammar/track cardinality/metadata protection; dimensions/size; escape symlinks; complete office roles/effects; PNG headers and scene budget; crew bytes; logo; font headers/licenses/size/missing files; pixel derived fields; pack symlinks/discovery/count; invalid canonical startup; CLI sanitized failures |
| observer-office-art.test.js entire suite | browser office-art colocated tests: complete publication, prefetch guards, held-last-role pending, decode/dimension fail-fast, first reason wins, harmless late rejection/success, same-URL dedupe and cross-role size check, independent concrete draw oracle (desk 72×74 at foot 24,38; helperChair 22×27), tile clipping/count, orientation-specific edges, human bounds/provider tones |
| observer-view.test.js theme sections near 1990–2445 | controller-owned classic view suite consumer rewiring now, view typed port in Task 7: canonical draw equality, palette completeness/isolation, effect toggles, replacement readiness and single repaint |
| observer-view.test.js office sections 2446–3476 | same view owner: station while pending, one office activation/static-cache rebuild, procedural/replacement crew, stop/start/settlement, bounded warnings, all native roles, no station primitives/additive glow, steady statuses, chair-body-desk depth, unchanged camera/hits, drone/carrier coordinates, canonical standing height, idle tint restore |
| src/sidecar/arrangement/model.integration.test.js | worker narrow colocated TS port: real synthetic Git linked checkout/subfolder resolver into accepted createModel; four distinct section keys; arranged identity/no-arrangement identity; grouping two rooms into one; stable seats across polls |
| frontend/app/queryspine.test.js | accepted browser query owner; map original full invariants before deleting classic fixture: exact shared promise, TTL edge, last-good error metadata, validated write-through, generation race, invalidation, one timer, final unsubscribe, ephemeral eviction, late detached response and hung-request recovery |
| sidecar/observer.test.js pollingFreshness | worker narrow observer-query typed integration after Task 4 acceptance: actual accepted observer + createQuerySpine with synthetic now/getJson/cancelable interval. Preserve two-second start cadence, ≤1700ms synthetic publication budget, 20 rows, nine RPC/two birth reads per row, independent old desktop timestamp, held helpers, retained unavailable rows, authoritative empty inventory and recovery. Move this coordinating obligation once; no classic observer wrapper or duplicate model/query implementation |
| frontend/app/observer-ui.test.js real query block near 1500 | controller common caller rewiring: inject actual typed query factory into still-classic observer VM; preserve hide/resume fresh request and rejection of pre-hide response as inspector proof |

Existing synthetic image tests independently check concrete native draw arguments; keep them rather than adding tests that merely recalculate values from the same role table. Shared table geometry tests can use the table because they test physical containment against independent projection equations. Header fixtures do not substitute for browser decode. Do not duplicate already accepted 5-P unit cases; compare their actual final assertions before porting remaining ones.

Needed integration cases not proved by this baseline: emitted JS/public URL closure, no privileged/TS/config files publicly served, nonce/CSP head order, retained exact ThemePack singleton with later reportWarning/reportNotice reaching existing mounted status, native inspector roots remaining real HTMLElements, source resources unchanged, ignored synthetic local pack inclusion, missing selection throws, invalid installed selection retains fallback warning, escaped regular-resource/pack symlink rejection, output collisions and preservation of last good owned output. Build tests must use isolated fixtures, never real private pack enumeration.

## Exact atomic controller integration requests

1. Freeze shared role producer/types and browser runtime role-proof validator together, plus accepted Task 4/5-P producers before implementation. Controller owns shared/browser/common changes; worker sends requests only. Reuse accepted bootstrap `readBootstrap`, canonical ThemeDefault, ThemeSnapshot and existing catalogs.
2. Create `src/browser/legacy-bridge.ts` and any minimal browser bootstrap owner. Retain the **exact** object published by prepaint as `window.ThemePack`; never call createThemePack/start again or overwrite ThemePack. Prepaint already performs synchronous application and active status registration.
3. Temporary globals with current live classic consumers: ThemePack (view/controller), Harness and QuerySpine (observer controller), AGENT/DEFAULT_SKIN/SKINS (view and sprite bridge as needed), SPRITES (view/controller), ObserverModel (scene/view/controller), ObserverMail (controller), ObserverInspector and ObserverMailInspector (controller), SCENE_ART_ROLES and ObserverOfficeArt (view). Final accepted sprite implementation determines whether sprite-load-plan needs any remaining global; do not expose SpriteLoadPlan solely because the deleted classic assets used it. No unused aliases.
4. Construct harness with native fetch, token, receiver-safe reload closure and timer. Construct query spine from that same harness JSON getter. Construct model/data/mail from accepted canonical defaults. ObserverMail facade combines createMail result with required named constants/functions, as frozen 5-P report documents. Do not duplicate runtime singletons per consumer.
5. Inspectors: use `browserInspectorDocument(document)` once and preserve returned native nodes. Either bridge-adapt buildPanel/createInspector arguments at their existing classic signatures, or update those exact controller callers coherently; controller chooses one, not both. Typed mail create options omit unused document. Existing classic panel stack appends root, handles native dialog cancel/close and focuses nodes, so wrappers replacing nodes would break it.
6. Rewrite remaining CommonJS view/scene/UI test consumers to direct typed factories/shared imports. In particular observer-view.js loads Model/Themes/OfficeArt/roles and observer-scene.js loads Model. Do not add a production default-factory wrapper merely to keep old CommonJS tests unchanged. Controller owns this wider common caller patch; worker reports exact produced domain exports.
7. `tools/build.ts`: retain existing runtime build and add approved `build({mode:'local'|'package',outputRoot}):Promise<void>` public build boundary. Local mode must enumerate source pack directories with filesystem APIs, including ignored synthetic packs; copy only regular contained resources; reject escapes/output collisions. Do not invent a stricter manifest selection policy. Stage separately and replace only owned generated output. Existing runtime compilation stages under dist and rejects aliased dist; preserve last-good/runtime tests. Package inventory selection remains Task 8.
8. Copy authored HTML/CSS/assets, excluding executable frontend/app and frontend/js directories from blind asset copy. Emit prepaint IIFE, temporary bridge, remaining classic observer-scene/view/observer scripts through Bun as inputs. No TypeScript source or server/config/native runtime tree in public output. Build must not copy an entire source directory as a shortcut.
9. HTML: nonce boot marker then synchronous `app/prepaint.js` in head; body bridge before still-classic observer-scene/view/observer. Remove all replaced classic primitive/role/office script tags in the same switch. Preserve dependency order and CSS/assets. Include script inventory/URL/MIME/CSP/HEAD tests using actual emitted paths.
10. `server.js`: load new typed themes owner, keep canonical manifest injection from the existing canonical source, use explicit installRoot and `dist/public` publicRoot; retain nonce and `<` escaping. Update `src/server/runtime-paths.ts` agreed public-root default and its test expectations consistently. CLI `scripts/validate-theme-packs.mjs` imports typed validator directly through Bun, retaining optional explicit root and sanitized error exit behavior; no wrapper. Decide and document whether its omitted root continues authoring `frontend` (current behavior), while server uses generated public root.
11. Package start/dev/build wiring: start/dev build runtime+public then existing source server through Bun --no-env-file until Task 6; keep presentation/test/validate:themes commands functional. No watcher framework. Existing package has only build:runtime and no dev/build yet. Controller owns command/docs consistency.
12. Remove classic primitive JS, sidecar theme loader, replaced classic tests/fixtures only after all consumers move atomically. Update knip actual entries to emitted source entries/prepaint/bridge rather than listing every module to quiet diagnostics. Preserve strict browser/runtime/test boundaries. Controller updates README role-table link and validator/runtime instructions when their targets change.
13. Document each bridge name and its still-classic consumer. Task 7 removes bridge and all its consumers together after typed scene/view/controller replacement; the bridge has no supported external API promise.

Search found additional concrete caller inventory beyond primary files: server.test.js; frontend/js/sprite-theme.test.js and sprite-runtime.fixture.js; observer-{ui,prefs-ui,arrange-ui,hosts-view,relay-scene,scene,view,inspector,mail-inspector,mail,model}.test.js; control-ui{,-hosts}.test.js; sidecar/observer-remotes.test.js model consumer; sidecar/observer.test.js query fixture consumer; observer-ui.test.js raw query source VM. Recheck these exact references after accepted producers land; this is a consumer map, not permission to edit them now.

## Dead-code audit evidence

Mode: audit only. Baseline is clean c8e3379; no code diff was introduced.

| Candidate | Reachability evidence and disposition |
| --- | --- |
| classic theme/primitive/model/mail/inspector/sprite files | HTML head/body script tags and classic test/VM imports still reach them. Supported/live now; remove only at atomic I5 switch with full caller updates |
| classic role and office-art files | HTML, live view, live server loader, theme/office/view suites and README role link reach them. Live now; replace single role producer and loader/browser imports together |
| sidecar/theme-packs.js | server.js, author CLI and mixed theme suite import it. Live now; domain replacement plus controller consumer updates required before deletion |
| queryspine.fixture.js and hidden test hooks | query suite, inspector suite and observer polling integration still use them; observer-ui also reads raw query source. Retain now; factory injection replaces hooks after all consumers migrate |
| sprite-runtime.fixture.js | view culling/re-entry/native-height tests and sprite suite still use it. Retain until accepted sprite fixture and common callers replace it; no guessed continuation API |
| proposed temporary bridge | not present here; only justified names have live classic consumers listed above. Mandatory Task 7 deletion. Do not create extra shims to manufacture reachability |
| duplicate role/default/catalog candidates | no new copies created. Shared roles remain requested producer; canonical JSON remains sole authored default. Existing shared runtime catalogs must be reused after accepted refresh |

No candidate was deleted. All retained candidates have actual entrypoint/test/config/document consumers, rather than merely uncertain scanner output. No source reachability changed in this preparation, so no repeated lint/scanner runs or removal mutations were necessary. Remaining cleanup is owned by future worker/controller boundaries; this report is not cleanup closure or independent review.

## Fresh verification and limitations

Commands ran in the assigned checkout after inspection; no source changes followed:

- `bun --version`: 1.3.13.
- `bun --no-env-file test frontend/app/theme-pack.test.js frontend/app/observer-office-art.test.js frontend/app/observer-model.test.js frontend/app/queryspine.test.js`: **4 pass, 0 fail, four files**, exit 0, 2.85s. Includes synthetic theme IO/CLI and canonical source only; does not inventory private installed packs.
- `bun --no-env-file test src/sidecar/arrangement/model.integration.test.js frontend/app/observer-view.test.js`: **3 pass, 0 fail, two files**, exit 0, 2.03s. Linked Git worktree belongs to disposable fixture root; view uses synthetic image/canvas/observer fixtures.
- `git status --short` before and after tests: empty. `git rev-parse HEAD`: c8e3379ad654b1a2225e417736e9581442ddfa13. No staged paths or commits.
- Exact reference searches used `rg` over named runtime, HTML, package, test and scanner files. Missing guessed paths were corrected: config theme type is shared ConfigInput, not a nonexistent config/types.ts; no observer-controller.js exists (controller is observer.js). No guessed API from these misses enters the proposed patch requests.

Not run: new typed domain tests, accepted 5-P comparison, public build/type/lint/scanners, served emitted page/CSP and browser UI. Those outputs do not exist in this checkout and prerequisites are not accepted. No whole Task 4/5-P/I5 completion or application browser correctness is claimed. No independent reviewer was dispatched because this assignment explicitly forbids delegation and implementation.

Self-review checked reader action, source-backed invariants, exact shared/caller requests, test ownership and authorization. Main unresolved dependencies are accepted observer composition and final sprite factory/fixture interfaces. On GO, refresh those contracts first, then implement only assigned domains and request controller-owned common patches explicitly. Do not start from this stale baseline or re-create the already-started ThemePack.
