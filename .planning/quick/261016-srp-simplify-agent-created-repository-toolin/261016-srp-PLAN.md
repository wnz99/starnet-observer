# Repository simplification

Remove agent-created maintenance scaffolding without changing observer features, security boundaries, package contents or supported commands. Base: `463d73d7ad0bb80309ccfa451a26ad01a8cf67cb` (merged PR #15).

## Changes

1. Delete bootstrap inventory/digests, skill-attestation records and the migration acceptance runner. Preserve project-owned hook safety tests and package privacy fixtures. Existing manifests, lockfiles, Git and CI own their actual contracts.
2. Replace generic component/monorepo isolation with a single-app installed-package smoke check. Keep external temporary roots, no inherited dependencies or implicit dotenv, production-first server verification, pinned/frozen browser test dependencies and both real installed consumers. Replace the hashed JSON record with a plain Bun fixture lock.
3. Remove forwarding-only browser launcher/tests, duplicate format/helper lint commands and the check.sh wrapper. Pre-push stays lint/typecheck plus version/Git guards. CI retains formatting, scanners, builds, native tests, packaged consumers and Chromium.
4. Remove unreachable build package mode/re-export, test-only View helper facade, unused sprite data shim and copied StationArt method facade. Preserve behavior assertions using direct owner imports.
5. Replace generated governance/provenance/migration-status documents with one practical development guide. Keep LICENSE/NOTICE, user documentation and screenshots. Preserve existing GSD PLAN/CONTEXT/SUMMARY records; this task adds only PLAN and SUMMARY.

## Ownership and verification

Parallel read-only audits identified these concrete cuts. Implement tooling and source changes in disjoint paths; the controller owns documentation, integration and commits. Independent review covers the complete final diff and all affected callers. No speculative rewrite of lifecycle, DOM ports, source discovery, runtime validation or privacy guards.

Run lint and all five strict compiler projects locally through the real pre-push hook. No local builds or tests. GitHub Ubuntu CI runs full static checks, builds, existing meaningful tests, installed consumers and Chromium. Remove tests only when their sole purpose is retaining deleted scaffolding; preserve hook safety, archive privacy, native fixtures and application behavior coverage. Fix actual review/CI failures before completion. No paid/live runs, external tool installation or optional external configuration changes.
