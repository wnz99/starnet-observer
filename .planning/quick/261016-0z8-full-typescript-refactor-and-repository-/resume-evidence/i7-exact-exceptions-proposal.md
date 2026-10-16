# Proposed exact fixture protocol exceptions

Proposal only. No repository changes or implementation approval. Current PLAN forbids scanner suppressions, so these five exceptions require explicit user approval before application. This proposal supersedes the earlier wider heritage-rule option and avoids changing production optionality or exporting production types for scanner recognition.

## Minimal amendment

Permit exactly one native `// fallow-ignore-next-line unused-class-member` directive immediately above each declaration below. Add a short rationale above the directive naming its actual protocol consumer and Fallow 3.27.0 limitation. Keep every original scanner category, severity, full-gate command, and semantic setting unchanged. Do not permit file/global suppressions, heritage-wide exemptions, new exception identities, or fake consumer calls.

| Exact source-owned exception | Real consumer evidence |
| --- | --- |
| src/browser/app/dom.fixture.ts — AppFixtureNode.type | AppFixtureDocument.setType forwards through update/Object.assign. Inspector builders write type through generic InspectorNode. AppNode extends that genuine optional protocol. |
| src/browser/inspector/dom.fixture.ts — FixtureNode.type | Implements InspectorNode. inspector/panel.ts assigns button type in header and controls; roster.ts and mail-panel.ts also assign it through the protocol. |
| src/browser/sprites/recorder.fixture.ts — RecordingContext.isContextLost | Implements SpriteContext. sprites/renderer.ts, lighting.ts, and light-painter.ts invoke the optional capability; sprite drawing tests exercise context loss and recovery. |
| src/browser/view/drawing.fixture.ts — DrawingContext.roundRect | Implements ViewContext<Resource>. view/crew.ts and props.ts use roundRect when present, with runtime fallback otherwise. |
| src/browser/theme/native.fixture.ts — FontFaceFixture.load | theme/native.ts browserThemeFont<F extends FontResource> invokes existing.load and newly constructed face.load. native.test.ts passes the fixture and checks shared identity and rejected-load behavior. |

The native issue registry explicitly supplies this exact directive for unused-class-member. It applies to the following declaration's category; it does not disable that class, file, other members, or future classes implementing the same port. It remains a human-reviewed exception, not semantic proof. Remove it when its consumer disappears or an analyzer fix recognizes the implementation. Retain stale-suppression checking.

## Installed limitation and design judgment

fallow-type-aware/src/semantic.mjs:960–985 records optional heritage. Lines 1149–1151 add uncertainty; lines 1190–1209 preserve required contracts and exact positive references only. Optional implementation without concrete-symbol reference remains a finding. Generic structural FontResource dispatch also fails to associate the concrete load implementation. Changing production contracts to make this analyzer happy would add broader scope than five local annotations.

Declaration-local exceptions are the smallest available native mechanism for these five established false positives. Unlike usedClassMembers heritage rules, they do not preapprove future classes or same-name members elsewhere. This design preserves detection of unrelated dead members on the very same fixture class. Approval should name all five identities above explicitly; it must not grant general permission to suppress later warnings.

## Private proof

Probe directory: /tmp/starnet-ts-resume/i7-exact-probe. Uses the installed project Fallow 3.27.0 executable and sidecar, native typeAware.enabled=true, private-type-leaks=off, default full dead-code categories. Source models the four existing optional-port shapes and required generic FontResource dispatch. Each scanner invocation independently acquires /tmp/starnet-ts-resume/p2-heavy-check.lock. No repository source or configuration was changed.

- Unsuppressed source snapshot models.red.txt; red.json: exactly five class-member findings, all other categories zero. Four findings report optional-contract. FontFaceFixture.load reports confirmed-no-static-references even though main calls font(new FontFaceFixture()), whose generic body invokes face.load(). This is direct evidence that that negative static result does not establish actual runtime nonuse.
- Suppressed source snapshot models.green.txt: exactly the same declarations and consumers, plus five exact native directives. green.json: zero total issues, zero class issues, zero stale suppressions; native exit code 0.
- Same-class sentinel proof sentinel.json: adding trulyDeadSentinel to RecordingContext without a directive leaves exactly one total issue, RecordingContext.trulyDeadSentinel, classified confirmed-no-static-references. All other categories and stale suppressions remain zero; native exit code 1. Its isContextLost exception remains local.

Commands use `fallow dead-code --no-cache --format json --quiet` from the private probe directory. Do not call this a completed implementation review or a final repository verification. After user approval and actual application, controller must rerun the ordinary full repository gate and independent review against the resulting patch.

Evidence integrity (SHA-256):

- models.red.txt: fec0437ef3844681121da4c078f69df80485ed2d3184788a3b659c35f1751bf2
- models.green.txt: a3f6d9da3ac40960284e0893ef78c9d4770901b33483a4f1d222ae2b32ffbfb4
- models.ts: f81ba0d8d7aac60a16a9bdd189845fc244b02c894218789c8c50592aeeaf82fe
- red.json: e3a696fef12acb0116c74b9565ec4c3bc1776bebb24366d5b7320a20b6cbd440
- green.json: 199bc4085b9d214ee0cde0cd7218ff37b185acb33b13b7f3bf0134b8afee70ea
- sentinel.json: b19aa4a927cb0176497ee54fc619ea55413ab1b3adaf59f6e24b3115cb086d7f
