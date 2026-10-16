#!/bin/sh
# SPDX-License-Identifier: CC0-1.0
set -eu

repo_root=$(git rev-parse --show-toplevel)
cd "$repo_root"
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
