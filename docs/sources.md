---
type: Reference
title: Acquisition sources
description: Runtime, package, skill and optional-integration installation sources.
---

# Acquisition sources

Use these official runtime downloads and package-registry pages to obtain the tools named below. The copied manifests and frozen lockfiles own installed versions: a landing page may show a newer release, which is not an instruction to upgrade. Install packages through the selected uv/Bun workflow and preserve frozen lockfiles. The Python and npm packages named FastMCP and Clean Code Tools have distinct distributions.

| Runtime or prerequisite | Installation source                                                                    |
| ----------------------- | -------------------------------------------------------------------------------------- |
| uv                      | [Official installation guide](https://docs.astral.sh/uv/getting-started/installation/) |
| Bun                     | [Official installation guide](https://bun.sh/docs/installation)                        |
| Node.js                 | [Official downloads](https://nodejs.org/en/download)                                   |
| Git and its shell       | [Official downloads](https://git-scm.com/downloads)                                    |

The original baseline pins have these acquisition sources. They are reference pins; record accepted changes in manifests and locks instead of upgrading from a landing page:

| Ecosystem | Package and pinned version     | Registry source                                                     |
| --------- | ------------------------------ | ------------------------------------------------------------------- |
| Python    | `shellcheck-py==0.11.0.1`      | [PyPI](https://pypi.org/project/shellcheck-py/0.11.0.1/)            |
| Python    | `uv==0.13.1`                   | [PyPI](https://pypi.org/project/uv/0.13.1/)                         |
| npm       | `@eslint/js@10.0.1`            | [npm](https://www.npmjs.com/package/@eslint/js/v/10.0.1)            |
| npm       | `@types/bun@1.3.13`            | [npm](https://www.npmjs.com/package/@types/bun/v/1.3.13)            |
| npm       | `@types/node@24.19.2`          | [npm](https://www.npmjs.com/package/@types/node/v/24.19.2)          |
| npm       | `clean-code-tools@1.0.7`       | [npm](https://www.npmjs.com/package/clean-code-tools/v/1.0.7)       |
| npm       | `eslint@10.11.0`               | [npm](https://www.npmjs.com/package/eslint/v/10.11.0)               |
| npm       | `eslint-plugin-sonarjs@4.2.1`  | [npm](https://www.npmjs.com/package/eslint-plugin-sonarjs/v/4.2.1)  |
| npm       | `eslint-plugin-unicorn@69.0.0` | [npm](https://www.npmjs.com/package/eslint-plugin-unicorn/v/69.0.0) |
| npm       | `fallow@3.27.0`                | [npm](https://www.npmjs.com/package/fallow/v/3.27.0)                |
| npm       | `globals@17.12.0`              | [npm](https://www.npmjs.com/package/globals/v/17.12.0)              |
| npm       | `knip@6.37.0`                  | [npm](https://www.npmjs.com/package/knip/v/6.37.0)                  |
| npm       | `prettier@3.9.8`               | [npm](https://www.npmjs.com/package/prettier/v/3.9.8)               |
| npm       | `typescript@6.0.3`             | [npm](https://www.npmjs.com/package/typescript/v/6.0.3)             |
| npm       | `typescript-eslint@8.70.0`     | [npm](https://www.npmjs.com/package/typescript-eslint/v/8.70.0)     |

Skill download locations point to complete directories at the fixed revisions. Preserve their references and upstream licensing when copying them into the user-selected shared `~/.agents/skills/`.

| Skill                    | Source directory                                                                                                                                                                                                                                         |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `wnz-doc-write-expert`   | [Pinned skill directory](https://github.com/wnz99/llm-dev-skills/tree/1e6b0d8cc149ee26729319bc109414ca7d77145b/skills/wnz-doc-write-expert)                                                                                                              |
| `wnz-code-reviewer`      | [Pinned skill directory](https://github.com/wnz99/llm-dev-skills/tree/1e6b0d8cc149ee26729319bc109414ca7d77145b/skills/wnz-code-reviewer)                                                                                                                 |
| `wnz-test-quality`       | [Pinned skill directory](https://github.com/wnz99/llm-dev-skills/tree/1e6b0d8cc149ee26729319bc109414ca7d77145b/skills/wnz-test-quality)                                                                                                                  |
| `wnz-clean-code-js`      | [Pinned skill directory](https://github.com/wnz99/llm-dev-skills/tree/1e6b0d8cc149ee26729319bc109414ca7d77145b/skills/wnz-clean-code-js)                                                                                                                 |
| `clean-code-tools`       | [Pinned skill directory](https://github.com/wnz99/clean-code-tools/tree/c51c7aa0a9ad555f81e8096e4a7e1c83f9156c1a/skills/clean-code-tools)                                                                                                                |
| `verify-before-complete` | No verified public URL in the pinned trees. Require a user-supplied trusted repository/download URL or installed copy; record its license, source and content digest. Do not invent an upstream link or report installation complete without the source. |

Optional integrations have their own acquisition sources and still require explicit inclusion: [Serena source](https://github.com/oraios/serena) and [setup guide](https://oraios.github.io/serena/02-usage/020_running.html); [Clean Code semantic MCP source](https://github.com/wnz99/clean-code-tools/tree/c51c7aa0a9ad555f81e8096e4a7e1c83f9156c1a). Their links do not authorize server registration, account changes, or installing an unpinned revision.

## Installed-source boundaries

`.bootstrap.json` records content digests and actual Codex discovery locations. Existing `wnz-doc-write-expert` and `wnz-test-quality` match the pinned directory; the reviewer and JS skill have preserved local adaptations. Missing files were filled only from their pinned complete directories, and the upstream MIT license was retained as `UPSTREAM-LICENSE`. Existing files were not replaced. `verify-before-complete` is the trusted installed copy supplied by the environment: no public source or license is declared, it is preserved locally and not redistributed. Its installed-content digest is the provenance anchor.

The Clean Code source declares `UNLICENSED` in package.json and has no LICENSE file. Its complete skill and runtime are used only in the explicitly authorized local installation; no source, corpus or local settings are copied into this application. The deterministic npm dependency is recorded normally by the application lockfile.

## Local semantic MCP setup

Use the immutable Clean Code revision linked above. Keep existing shared runtime/custom corpus intact. Create a new directory `~/.clean-code-tools/versions/<revision>/source`, check out that exact revision, then use `uv tool run --from uv==0.13.1 uv sync --frozen --group mcp --project "$runtime_source"`. This Python environment is external tool infrastructure; this application has no Python project.

Install the complete skill only when absent, from that source:

```sh
python3 scripts/install_codex_skill.py --agent codex --project "$project_root" \
  --dest "$HOME/.agents/skills" --no-mcp-runtime
```

Here `--no-mcp-runtime` prevents the installer's overwrite/unpinned-pip path; the isolated manual runtime above is required separately. Run `skills/clean-code-tools/scripts/install_clean_code_linting.py --repo "$project_root"` without `--apply` to inspect the plan. Keep the starter's deterministic lint/hooks owner; do not apply a second installer.

Build the index using the versioned `.venv/bin/python scripts/sqlite_vec_ingest_clean_code.py --index-path "$runtime_root/clean-code-index.sqlite"`. Set `CLEAN_CODE_INDEX_BASE="$runtime_root"` and `FASTEMBED_CACHE_PATH="$runtime_root/cache"`. The default local model is `BAAI/bge-small-en-v1.5`; record downloaded cache digests and populated index metadata. No provider key is needed.

Merge only `[mcp_servers.clean-code]` into the ignored project `.codex/config.toml`, preserving every existing setting. Use the absolute versioned `.venv/bin/python` as `command`, the absolute source `scripts/clean_code_mcp_server.py` as the sole `args` item, and absolute environment paths `CLEAN_CODE_INDEX_BASE`, `CLEAN_CODE_VECTOR_INDEX_PATH` and `FASTEMBED_CACHE_PATH`. These values differ per workstation and are not committed. Verify `codex mcp get clean-code`, then actual selected-client discovery, `clean_code_index_info` and a narrow `search_clean_code_patterns` query. Metadata alone is insufficient. Restart the working client when needed; a local ephemeral Codex app-server thread can verify MCP calls without a provider turn.

Rollback removes only the added project registration and newly owned version directory after checking its consumers. Never remove the whole shared runtime, existing skill owners or custom corpus. To deactivate this baseline's hooks, remove only this checkout's worktree-local hooksPath after confirming it is `.githooks`; leave unrelated hooks and shared extension settings intact.
