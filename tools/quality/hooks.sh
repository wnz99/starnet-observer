#!/bin/sh
# SPDX-License-Identifier: CC0-1.0
set -eu

repo_root=$(git rev-parse --show-toplevel)
cd "$repo_root"

case "${1:-}" in
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
    sh "$repo_root/tools/quality/format-index.sh" "$repo_root" "$snapshot_root"
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
  *) printf '%s\n' 'Usage: hooks.sh {hygiene|pre-commit|pre-push}' >&2; exit 64 ;;
esac
