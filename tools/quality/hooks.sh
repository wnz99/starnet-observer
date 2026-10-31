#!/bin/sh
# SPDX-License-Identifier: CC0-1.0
set -eu

repo_root=$(git rev-parse --show-toplevel)
cd "$repo_root"

case "${1:-}" in
  versions)
    case "$(uv tool run --from uv==0.13.1 uv --version)" in
      "uv 0.13.1"|"uv 0.13.1 "*) ;;
      *) printf "%s\n" "Wrong uv version" >&2; exit 1 ;;
    esac
    bun --no-env-file -e 'if (!Bun.semver.satisfies(Bun.version, require("./package.json").engines.bun)) { console.error("Unsupported Bun version; run bun upgrade"); process.exit(1); }'
    test "$(node --version)" = "v24.19.0"
    ;;
  install)
    if [ ! -x .githooks/pre-commit ] || [ ! -x .githooks/pre-push ]; then
      printf '%s\n' 'Executable pre-commit and pre-push stubs are required.' >&2
      exit 1
    fi
    configured=$(git config --get core.hooksPath) || {
      status=$?
      [ "$status" -eq 1 ] || exit "$status"
    }
    if [ "$configured" = '.githooks' ]; then
      exit 0
    fi
    if [ -n "$configured" ]; then
      printf '%s\n' 'Existing hooksPath preserved; integrate this baseline with its owner.' >&2
      exit 1
    fi
    hooks_directory=$(git rev-parse --git-path hooks)
    for hook in "$hooks_directory"/*; do
      [ -e "$hook" ] || continue
      case "$hook" in *.sample) continue ;; esac
      printf '%s\n' 'Existing hooks preserved; integrate this baseline with their owner.' >&2
      exit 1
    done

    # The extension is shared, but hooksPath must apply only to this checkout.
    # Refuse dormant configuration that enabling the extension would activate.
    if [ "$(git config --get extensions.worktreeConfig || true)" != true ]; then
      common_directory=$(git rev-parse --git-common-dir)
      for config in "$common_directory/config.worktree" "$common_directory"/worktrees/*/config.worktree; do
        [ -e "$config" ] || continue
        printf '%s\n' 'Dormant worktree configuration preserved; enable the extension with its owner.' >&2
        exit 1
      done
      if git config --local --get core.worktree >/dev/null ||
         [ "$(git config --local --get core.bare || true)" = true ]; then
        printf '%s\n' 'Shared worktree/bare configuration requires owner migration before activation.' >&2
        exit 1
      fi
      git config --local extensions.worktreeConfig true
    fi
    git config --worktree core.hooksPath .githooks
    ;;
  hygiene)
    if [ -n "$(git ls-files -- .agent-local.json)" ]; then
      printf '%s\n' 'Local-only .agent-local.json must not be tracked.' >&2
      exit 1
    fi
    if ! git check-ignore -q .agent-local.json; then
      printf '%s\n' 'Local-only .agent-local.json must be ignored.' >&2
      exit 1
    fi
    if [ -n "$(git ls-files --cached --ignored --exclude-standard)" ]; then
      printf '%s\n' 'Tracked ignored files violate repository hygiene.' >&2
      exit 1
    fi
    ;;
  pre-commit)
    snapshot_root=$(mktemp -d "${TMPDIR:-/tmp}/repo-index.XXXXXX")
    trap 'rm -rf -- "$snapshot_root"' EXIT
    trap 'exit 129' HUP
    trap 'exit 130' INT
    trap 'exit 143' TERM
    git checkout-index --all --prefix "$snapshot_root/"
    # Use staged ignore files with the original index; unstaged rules cannot change this verdict.
    GIT_DIR=$(git rev-parse --absolute-git-dir) GIT_WORK_TREE="$snapshot_root" \
      sh "$repo_root/tools/quality/hooks.sh" hygiene
    cd "$snapshot_root"
    bun "$repo_root/node_modules/prettier/bin/prettier.cjs" --config "$snapshot_root/.prettierrc.json" --ignore-path "$snapshot_root/.prettierignore" --check --ignore-unknown .
    ;;
  pre-push)
    if ! git diff --quiet || ! git diff --cached --quiet ||
       [ -n "$(git ls-files --others --exclude-standard)" ]; then
      printf '%s\n' 'Pre-push requires a clean checkout of the pushed commit.' >&2
      exit 1
    fi
    checked_head=$(git rev-parse HEAD)
    check_required=false
    while read -r _local_ref local_oid _remote_ref _remote_oid; do
      case "$local_oid" in *[!0]*) ;; *) continue ;; esac
      if [ "$(git rev-parse "$local_oid^{commit}")" != "$checked_head" ]; then
        printf '%s\n' 'Pre-push cannot verify a ref other than checked-out HEAD.' >&2
        exit 1
      fi
      check_required=true
    done
    if [ "$check_required" = true ]; then
      bun run lint
      bun run typecheck
    fi
    ;;
  *) printf '%s\n' 'Usage: hooks.sh {versions|install|hygiene|pre-commit|pre-push}' >&2; exit 64 ;;
esac
