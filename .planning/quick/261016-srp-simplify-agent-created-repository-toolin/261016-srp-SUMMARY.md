---
status: complete
---

# Repository simplification

Removed bootstrap inventory/digest/skill-attestation records, migration tool-mutation probes, generic monorepo isolation branches, forwarding-only wrappers and their obsolete tests. Consolidated six generated governance/provenance/migration documents into the development guide. Tools decreased from 34 files to 21.

The installed-package check now has one TypeScript owner and a plain frozen Bun fixture lock. Production-only verification still precedes browser test dependencies. Application behavior assertions, package privacy and hook safety coverage remain; tests import their actual owners instead of obsolete facades.

Independent review R1 identified two Low single-owner wrappers; R2 verified their removal and approved the complete scope with no remaining findings. Initial CI identified one leftover LOD re-export; it was removed without suppressions. Enabled pre-push lint and all five strict compiler projects passed.

Ubuntu CI at implementation head `82e4e806b8a884c588f8d28fc3ee95cb69fa1d22` passed: **238 tests, 0 failures, 95 files**, builds/static checks, production-only installed consumer, both installed consumers and Chromium. [CI run](https://github.com/wnz99/starnet-observer/actions/runs/38966234735).

Final record/CI cleanup removes a redundant standalone browser invocation already exercised by the aggregate, duplicate feature-push jobs covered by pull-request CI, and unreachable macOS version logging in the Ubuntu-only workflow. Product/tool/test/policy bytes remain identical to the passing implementation. Builds and tests ran only in CI. No paid/live runs or external settings changed; native macOS/live integration is unverified.

Delivery and final review: [PR #16](https://github.com/wnz99/starnet-observer/pull/16). CI and PR records own final merge outcomes rather than copied local evidence archives.

## Essential-tools follow-up

User requested a stricter reduction after PR #16. Five executable owners now cover build, launch, package, installed-package CI and Git checks. Helpers/tests are consolidated under those owners; the actual child-process fixture remains separate. Tools decreased from 21 files to 11. Independent review of `ed9469bb2aeb1398bd5e442ad0c123a3321d0bea` approved the full scope with no findings. Enabled pre-commit formatting/hygiene and pre-push lint/all five compiler projects passed. [Ubuntu CI](https://github.com/wnz99/starnet-observer/actions/runs/38969805089) passed **238 tests, 0 failures, 94 files**, builds/static checks, production-only installed consumer and both installed consumers, including real Chromium. Builds and tests ran only in CI. [PR #17](https://github.com/wnz99/starnet-observer/pull/17) owns the final review and merge outcome. This final records-only update changes no verified source, tests, configuration or workflow bytes. Native macOS/live integration remains unverified.
