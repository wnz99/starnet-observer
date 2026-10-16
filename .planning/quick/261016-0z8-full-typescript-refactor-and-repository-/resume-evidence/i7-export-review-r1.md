# Independent review: i7 duplicate export cleanup

No findings. Outcome: **Clean**. Verdict: **Approved** for the exact 52-file rename package only.

Requirements: **Pass**. Code quality: **Pass**. This approval does not approve unrelated modified/untracked files, legacy cleanup, final HTML/build wiring, or a globally clean scanner result.

## Scope and identity

- Read-only reviewer leaf; no delegation, source edits, staging, installs, live inventory, providers, control actions, SSH, or optional configuration.
- Target: /home/david/Projects/starnet-observer-i7-export-cleanup, branch feat/typescript-i7-export-cleanup.
- Baseline/HEAD: 0cc9ad6d87fd5805d251fe75b174b57b9c73c535. Working-tree patch limited to the 52 tracked manifest paths below; no owned deletions/renames/untracked additions.
- Patch SHA-256: 9705a1200980be9b51cbffe46f81727841e25e36804bc380265f70d4b41a40f5. Independently matched current git diff for exactly those paths byte-for-byte.
- Independently verified all 52 before hashes against both baseline copies and git show HEAD:path, all 52 current hashes against manifest, and all 60 read-only dependency states against manifest. Two legacy dependency paths intentionally have null hashes and remain absent. Prepaint head hashes also match.
- Read all 52 complete scoped diffs. No unavailable scoped files. Other worktree changes were excluded.
- Reviewer skills: wnz-code-reviewer (including deep-analysis), wnz-clean-code-js for TypeScript, wnz-test-quality, verify-before-complete; caveman for conversation. Host-resolved model identity unavailable; requested gpt-6.1-sol/medium per controller dispatch metadata, not independently measurable here.

## Contract and cross-file traces

1. Model identityHash declaration, model hues, scene ActorState/movement, and createModel return traced through model.scene.integration tests and unchanged app/view consumers. The public factory key remains hash: identityHash. The new name is absent from returned object properties; unchanged hash implementation preserves six representative values including Unicode. No JSON/CLI/fixture expected key changed.
2. OfficePoint/OfficeRect declarations traced through Composition.project, office-art origin/draw/tile/edge, human painter, office-art test, and unchanged view/resources/office composition receiving Scene.project and scene coordinate shapes. Scene Point/Rect remain unchanged. Existing drawing fixture checks projected anchors and bounds.
3. ObserverInputRow/ObserverBus/ObserverExecute traced through ObserverOptions, makeObserver dependency construction, State, inventory, enrichment, ownership/inspection proofs, lineage publication, warmup, aggregate counters, snapshot/publicBus, and server main entrypoint. Unchanged presentation Row/Bus consume Inventory structurally; wire fields remain unchanged.
4. Four execution domains retain distinct existing callback settings and return shapes: observer requires timeout/maxBuffer and optional env; identity requires timeout/maxBuffer; project requires timeout/maxBuffer/env; control uses optional timeout/env and optional stderr. Traced through default execFile adapters, identity reader configuration/birth, ProjectDiscovery/ProjectResolver, control transport registry and factory injection. No shared abstraction or copied callback shape introduced.
5. BusPane retains exact id/provider/sessionId Pick. publicBus exact and ambiguous identity joins preserve output fields. busRecord retains null/object/array behavior. Traced SQL bus selection, relay payload parsing, HelperGraph edge intake, SQLite request/reply/result validation, worker port messages, client submit/readBus/inspectMessage/readHelperEdges and snapshot publication. Dynamic worker dispatch still uses unchanged operation strings and request/result envelopes.
6. requiredHttpValue retains assertion, return identity, generic shape and failure text. All affected HTTP, SQLite oracle, control, presentation and start fixture imports/calls updated. Remote fixture required and model required remain separate. Existing assertions and expected payloads are unchanged.

## Independent structural and cleanup assessment

- Reviewed all 12 actual symbol renames covering nine duplicated name groups; checked all 307 recorded locations against original source offsets. The sole language-service shorthand expansion preserves hash object property.
- Independently parsed all 52 original/current TypeScript files and recursively compared complete syntax leaves, including type declarations, string/template payloads, imports and expected keys. Reversed only the 12 intended identifier names, the explicit model hash shorthand expansion, and optional trailing commas. Result: **52/52 equivalent**. This independently checks more than emitted JavaScript and does not rely on supplied equivalence conclusions.
- A raw scanner attempt first misclassified contextual object and unrescanned template tails; parser-backed syntax-leaf comparison resolved those tooling artifacts. No source defect resulted.
- Full diff review found no deleted/shortened comment payload, changed guards, changed async sequencing, wrappers, aliases, copied implementations, dependency additions, or obsolete compatibility exports.
- Old export declarations are gone in renamed domains. Observer Pane and identity object remain intentionally distinct, as do presentation Row/Bus and scene Point/Rect. Model.hash is intentional public API, not an obsolete alias.
- Fresh default Fallow result: duplicate_exports 0, circular_dependencies 0, private_type_leaks 0; no owned unused exports/types. Existing 183 total findings comprise 166 class members, 11 exports, 2 types, 2 files and 2 unresolved legacy HTML imports. This scanner output does not prove architecture-policy checks ran: its own diagnostics say those boundaries/policies are not configured. No configuration weakened.
- Clean-code candidates assessed: 12 renamed declarations/domains and 3 extra consolidation/alias/removal candidates; all 15 dismissed as findings. Domain names improve clarity, existing callback shape distinctions justify separate types, Model.hash preserves required public behavior, and identity object must not be conflated with busRecord. No confirmed dead code was introduced or made obsolete beyond removed old symbol names. Pre-existing class/wiring findings require separate root work.

## Verification and test quality

Fresh reviewer commands used supplied Bun/Node tool PATH. Each heavy command acquired /tmp/starnet-ts-resume/p2-heavy-check.lock individually.

- bun --no-env-file test src/browser/model.scene.integration.test.ts src/browser/office-art.test.ts src/sidecar/sqlite/protocol.test.ts src/sidecar/bus/index.test.ts src/sidecar/presentation/presentation.integration.test.ts: **5 pass, 0 fail across 5 files**, exit 0. These cover real model/scene composition, office anchors, SQLite input rejection, native snapshot and exact bus joins, presentation immutability/privacy.
- node node_modules/typescript/bin/tsc -p tsconfig.runtime.json --noEmit --pretty false: exit 0.
- node node_modules/typescript/bin/tsc -p tsconfig.browser-tests.json --noEmit --pretty false: exit 0.
- Fresh direct runtime probe independently inspected and rerun: Model.hash === identityHash; no identityHash returned property; 6 hash vectors, 8 bus predicate vectors, 5 required-value identities and 2 nullish rejection cases match original implementations. Factory has original 18 keys.
- Fresh default fallow dead-code --no-cache --format json --quiet output inspected at /tmp/starnet-ts-resume/i7-export-review-r1-fallow.json. Duplicate export groups zero; remaining findings acknowledged above.
- Supplied evidence inspected, not represented as freshly rerun: owned ESLint/Prettier exit 0; all five strict compiler projects exit 0; local build exit 0; affected existing suites 68 pass/0 fail across 39 files. Existing Linux/macOS libproc limitation remains truthful. Whole 68-test suite was not repeated because no finding justified duplicate broad work.
- No new tests needed for behavior-preserving symbol renames. Existing boundary fixtures have independent behavioral assertions; adding old-name substring checks or helper-existence tests would couple tests to implementation. No assertion removed, weakened or replaced by renamed expectations.

## Limits

No real-browser visual audit, live desktop integration, macOS libproc execution, live provider/control/SSH, final root HTML script wiring, full repository acceptance or unrelated pre-existing logic review. Dynamic worker behavior was traced statically and covered by existing protocol/native fixtures; no claim about every deployment environment. Review is complete for the specified rename boundary.

## Exact files and hashes

Before hashes are SHA-256 of git HEAD and saved original copies; after hashes are SHA-256 of reviewed working-tree bytes.

| Path | Before SHA-256 | After SHA-256 |
| --- | --- | --- |
| src/browser/model.ts | 4f049ca0669a406374ec8c3ec568cdc0509c0632dffb32b84a8e7e3cb45c6a0d | 4d64364788ae02e3e7b46e649344921ed109698b194a39cf6ff776d66f582833 |
| src/browser/model/hues.ts | 41d72f95ce9e6fe58860fb9869a4068b400fa876af02cd99e7024d0578973241 | 8a0fd9f44f4b9b706f5bb06b5c1d54bf879841e11e20bf0c8abdedf3b04568cf |
| src/browser/model/identity.ts | 7630f667a72a3034a13ead66fb436dff9c7cb2e767ece94ede97969d8e8bbf43 | f228727130ec184801d9346a56637496ff4f0162e12935102f0ae79256a69cd8 |
| src/browser/office-art.test.ts | d084d57b48753d8ebdef70cd751b2fe92d0e5284f25d8cc9a4506a4bc027bd44 | 3cacc7a883c08de90c8dd5d42376523858cf3f70b936e2b992ff7b46d3daa2ba |
| src/browser/office-art.ts | 4f0c1f253131d79e1947e61d4662e6abc8528939a50cfc02a804d6649166a102 | 1d21066ca6667d604136dd22c69a8b4c45a6f48f470dba85180dff22fa6955bd |
| src/browser/office-art/human.ts | b4d8d86cb0cd8e5f49d635495edbf919f0c479bd85d24aefe87bf0972188e551 | 4fdb281bace0e511f1d66707fad5975f3e272ebd3048a6c01d3f0d9c2e5b9c28 |
| src/browser/office-art/types.ts | 0ecb24d4681ccba963415e63d3a6b9923327de7c7a863df56e24042ce86b3d94 | 5e92fc8e06d036cd85e9cf2610741efac3bc04b6dcddd45909fff64827ccf294 |
| src/browser/scene/actor.ts | 94e4bf3b23f638c3b37e80911e144de452a8f850821d1f99d9091eed14f1a288 | 6137446718de26e61f20094d1320621fad365468be4edc944da07f45d235088f |
| src/browser/scene/movement.ts | 5bcbd3f61e11bb369bebbd9abc3f732cb9c671c7a54627afff88d1ccb962867c | 07fa669a45c0d50379dd2d9486f1cf33f97c313a8a34f70688df8f6f5a2f6e5d |
| src/server/http.fixture.ts | e9b7be2a76afdf7b8b4b0ad6cf8ccd43c00e689fe3c37c18d018f247acbc221d | 46f99295abaf9aa10d33b44dbb62fb30d9e171daa343316a12c326cc7b2dd3cb |
| src/server/http.sqlite-oracle.test.ts | 16e4d5501ef4cd452a793bc7a228e1fe799a1c340d3b51b6080058563dd4f6fe | cdc2aa4c9623c7742f3c483ec695e7ff5b3f23bac5e52cc01b7303d753fa0ce2 |
| src/server/http.test.ts | d53a5f8fcde6cd26ef8e0b0a6be2843d25f643095d447ff97bf9402ccea91b98 | 65a737d4987ecd3fbbde438398e325ff0fe0cc67f2c6b74e085650a20065b340 |
| src/sidecar/bus/index.test.ts | 53aa19a1fd650a193846cd06daa0b15aafb43276084bc2c2854fe022824db8ba | fec355ac4de978cc415476e6d52badb1b7ae773903974bf5e388edcf8b47db27 |
| src/sidecar/bus/public.ts | cff04a6ba738bda0f860ce73a3ea3c3ba63e3ef9213f9517e87b805bb7a6be01 | 02bb8fdc1cd6f4d3bd56a6d8ca00747b376a335b1db39954f32eb1275c7a3f08 |
| src/sidecar/bus/relay.ts | b241e2d3fcbc9affb1a5130412ef7358a82b14abe6943b653632eec2c8c3d382 | 7cd7d73c31da7539937fa034ec84f4d155dd420d6aa4f2896dd27fbb5fcec6de |
| src/sidecar/bus/selection.ts | 7ab2992f946813ba8135ffc34b5e275d0df2234d9a9991b79cc4b2533476ebd3 | 4ca3753d5c01e992ad94e538b58308b665c1326ef63639a4d3a2b90e631fcaac |
| src/sidecar/bus/types.ts | a121f9e56d9836fb9e33c39ca0dcf1556d713772fd4ee8f0e7ca991e67c442fd | 536606b6a76eac95c3f6895d2bd731c9d433048237a995fe84f940ab09bd9d2d |
| src/sidecar/control/control-remote.integration.test.ts | 167abd4119e39f9d9c8e54fcbb12adbf19d4b3feba73188730530be003dbb68a | 46fca581c81f6e81595bf9b1d423a1a50d54972cd2bea0074da1011431a815e2 |
| src/sidecar/control/control.integration.test.ts | 7074980a2377c6cdf978a5239a47b70ffbff8a344d3741a55edc305b529836b3 | 68ea1ab3a4e25fbc9dad874de232bbbe4a9304ce6b8fd56cab30558983ebe31f |
| src/sidecar/control/overseer.test.ts | fdffc25b44282cd0bbf290d34de24707462bfafdec0519c3b330486a8c82f36d | 2aaab65d2683c289cf59a3679069eb55b5e8232442e15e15289de6aabf11f431 |
| src/sidecar/control/transport.ts | 39e6c466461a58cfd74d4f56e6437f7602622ddc36c5781c0c86c0d58e28b6c3 | ae2373f4967da610657bcbd9cbfb0e26b599c6c863866ff2da0b1db03d5e4743 |
| src/sidecar/control/types.ts | fa6673f67baefcde23c56b49ed309135de0503aec33b45ca6c0c34db3e2667e3 | 81435e267a51737a114e71f0810233dfe3a28c8b37413abaca4e498c761acc75 |
| src/sidecar/helpers/graph.ts | aa391bbcddffc12f87b46d6287f4de70d488069bc1972453ca11f603882f20e7 | c5e77c874a1cf52467d5d8ca75d3be471121bea7a8c42437389756918932ef39 |
| src/sidecar/identity/birth.ts | 36656c60d50e11a25a037a0699b39618b30161a7be9e65bf6da23cbf28c7378e | f46cfed796184d117b086c3471a7eea3415119047574173be0f17440d48e822f |
| src/sidecar/identity/configuration.ts | e6c4f8104092f756b0a308238f5eafc766c799e98716d983d1b65c6b601e88b4 | 2277687a0ddb83d6c03e303d3d3279ca1ea5e731ac76aeebe89b582faf059991 |
| src/sidecar/identity/execute.ts | a788d1fdf3cd8e8a9f2fd1e680b2f27cd6a8ae55ab37824bc426b3e49fc623cf | b7e9f19b77df29e41c9beee9c756d73d399e408c10f69420f2034376e4fdbc2d |
| src/sidecar/identity/index.test.ts | 6752eb540d6172a4b7470a4c3d726119de9978eae1d2282a28a8cd70ac9e809e | 7cf0a8683903aa986b142973a242fa2069f3d7087797ac006140b034e431904b |
| src/sidecar/identity/types.ts | f3c430b30500ebe2f7610a8e60b80606e67bca65a19e667ff0dd9514c1b3479e | e5f45bdb3e1c725943822a587e7643359782a6f413daa0b516e3dd751eb1f990 |
| src/sidecar/observer/aggregation.ts | 8bba7cbaa7fa4765918820da7a57a305c9d66c2f1b7e474a935ea82f187a4013 | 32342a0fce47ce08f599d244e9cba21f42eafa63ac893eced1ef6c2f1a85cb61 |
| src/sidecar/observer/contracts.ts | 24ed6a2d34a86bdbeec7e5e82a0fec7e9a3ca16c4ab71a115fba90fc8912b33a | 25bea0ea8a8acce244afec513fdf800e19c1aab5125021d548917563d973ac97 |
| src/sidecar/observer/counters.ts | 7aa305f916e998c0d89cc9d42d94cd7664d820cd3e6fb72b4f47415dad3cbe69 | 2f3e30c03134daa1b39050ba0f45c82f63fbaf2b6561c61f72680612c212e452 |
| src/sidecar/observer/enrichment.ts | 10b941acc96f3c6e5198b2db045e61eb088ca73c360895fc0f92531a5904505d | 90a40c158f6fbb9b64adb10d9f2609441de1a1c53ce3d1e88508f27e2a0717d0 |
| src/sidecar/observer/evidence.ts | e55d01df362a9e937d3236c44c1b29398e4bf92d71593a213232624f6c03f79e | 41850dedb47647559940ff0cb5e746cd7d265df79f49cf8fccf7599a814dd792 |
| src/sidecar/observer/identity-process.test.ts | ed9da1a15866c80b82c9cc0638b0d25ba4c051abffecd870d893cce47adcffa0 | f531d3ea8842b00cadf2c0d41130dcf48cb37d967904e4767075d1c06c8aef8a |
| src/sidecar/observer/index.test.ts | 79b92f89288f5833d84d9c7140c2c6895e8644159650bc97f9d8e2a2155d0f3d | 5c91850ebe8559f861e6c05123b04632b484de2be6350cb13d79376db7f092ad |
| src/sidecar/observer/index.ts | 00f905b8181156392cf46842990ef158cdfee73527bebd0ce67aa368ae83f564 | 9c98073460d29b94bc61890b9f3031f38580c4806eaaa7dc550277b2d274c06f |
| src/sidecar/observer/inspection-proof.ts | 4046ef9cdcd919960eaa78c79552415b8d72a49ab713cfff43ce7e8e55c2ca23 | 9d841989953a06be024dc748081af2ae0a0a87e5fcd8475fd9275da92f435a6a |
| src/sidecar/observer/inspection.ts | 7237fc40a5ce453f873b8a1c516259a6302aa8ae77eab6cf156638f878d7ee88 | 953c240c23364b5a83b4c768e9f78375cf6c43094f096747fda0da66094d8b22 |
| src/sidecar/observer/inventory.ts | 11689a7e4d5677821cea5a78e92c8f3e557380ebf01cfafc0bbaf74f388e198a | b792b84e50825ceb02e40aee0346d6b8c5f5f04ef1ce166a479bfcb75f115c57 |
| src/sidecar/observer/lineage.ts | 7cb67a420bd8847e436c3be1e51273446858cad9cf83816927ebd5a43e4dbe6a | f1c260f90adf53743a57d55bb36ec89680b02772351f0ef2fd60d671537b9996 |
| src/sidecar/observer/ownership.ts | c4a40b2327a9b08ffd593e33b23621656d19d63460c8a6f3d879aaca150fbed4 | 747de98215161515b0f9a426bc4a5af6a6d3b46d309007b535a440665670ad4c |
| src/sidecar/observer/publication.ts | 54923690e06d1bea20dea08536e11aede461c1ddef242bf443e0f8ffd00b266a | 1cb874d477f9582916429999992e6338b87a469ece10f267e00c8f560e2669ee |
| src/sidecar/observer/state.ts | b5d1736d9d4e115b299bc73cd1bf6fffa21e2891d60c3b06e67b0a88e50064e2 | 352cef18fe33f1eaeda281e436522e276203b0208521f36067894794f400cdfe |
| src/sidecar/observer/warm-transcripts.test.ts | 864ca7b69bae9a0adf81e7162b70f64fc501b745a6c615a9de14b6655e52db83 | 709b0b99f7acc778cb7c7b28d333eebab7351074d8e4b6d487dae6e28227a7d2 |
| src/sidecar/observer/warmup.ts | 8762176ef1b7d2a87c18a277005c021d7f30c0c82d462caaf71334b450da2025 | ccfefa90731b10c27a00df21c1f06014932b500dcd3a0a943f17aa6ee86bc6ad |
| src/sidecar/presentation/presentation.integration.test.ts | 93689b7574f3dedd86f99ec14dde2dc0b03121c1f62dd68308a8b6b92791a643 | b89d92fbab3e5e0b09a4562733951b9d6915d82b42ade02817cf5aa0710c80c1 |
| src/sidecar/projects/discovery.ts | 8babc6142699bd911de58e3432fc4082097b6911d5293468a16d155a5aff4a15 | dc58383c506ee45134238951431fec2ac06b74d8331531872552617fd92f65f4 |
| src/sidecar/projects/index.test.ts | 3fce32bc35ce20f542983c8ef884928674365c6f7106a903f4a5ec4cc5e02199 | 990d154992697da03fa5098016528668ee942651b059693f00195cc6d49a2499 |
| src/sidecar/projects/types.ts | c91e769af59372977052101e8664454d5e0da4bee817207bc6d969990bcf6cbd | 350d6a1c0928914694ed82060aa24c4f024afd8b5975d7fdcbf307facda25d37 |
| src/sidecar/sqlite/protocol.ts | 03280829f08f6880a47a91b81976c93123a03e02f85912299a582e6923bf25cc | 1084d614a1b81928d728c0f4bb6c790dc4c6198226b8b30d9ebd7b3c61016fb0 |
| src/sidecar/sqlite/validate-bus.ts | 9c78240f0911d0488962dd743c0ba6995fae5661abbcda8b872543d8366d1206 | 49014c23969fe3d847be5593b3a76e23b09bf00fb6dcc12882fd34d681b93e0c |
| tools/start.test.ts | 9d4102de1c7d885218cdd60e1cf7de21eaed1043ad1bbc7e34bdaeb9ce052c91 | 3151f6e6abfbeeef489aa69378b5ee8aec28dce4599dcb4007d46792c9fa2990 |
