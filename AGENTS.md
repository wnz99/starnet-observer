# Development rules

- Read README.md, docs/index.md and .bootstrap.json before changing setup. Preserve unrelated edits, MIT LICENSE/NOTICE and existing hook ownership.
- Use Bun 1.3.13, Node 24.19.0 for tooling and pinned uv 0.13.1. Follow package.json commands. Keep checks read-only; use explicit format/fix commands for changes.
- Preserve strict compiler flags and deterministic Clean Code/SonarJS/Unicorn rules. Keep Knip/Fallow, tests, builds and isolated consumers connected. Never hide migration findings with blanket exclusions or weaker rules.
- Keep tests beside tested files. Runtime, browser and tools/test compiler projects own distinct ambient boundaries; browser source must not depend on privileged Bun/Node globals.
- Preserve --no-env-file on supported Bun launch commands and bunfig.toml env=false. Exported variables remain supported. Preserve child/worker environment restrictions.
- Trace public entrypoints, HTML scripts, dynamic workers and external contracts before removing code. Use fresh applicable verification before completion.
- Use trusted shared documentation, independent reviewer, test-quality and language skills; see docs/sources.md for exact provenance. Semantic Clean Code MCP supports concrete local hypotheses; it is advisory and never a hook dependency.
- Keep credentials and machine-specific state outside version control. Project MCP configuration is ignored and local. Preserve existing registration/settings when integrating it.
- Keep docs/index.md canonical. Concept documents use YAML type/title/description; final bootstrap digests follow docs/bootstrap-records.md after validation.
- Leave unanswered optional integrations pending. Do not publish, deploy, provision, run paid/live integrations or change account-wide settings without authorization. No Co-Authored-By trailers or timeline estimates.
