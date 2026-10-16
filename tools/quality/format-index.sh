#!/bin/sh
set -eu
repo_root=$1
snapshot_root=$2
cd "$snapshot_root"
bun "$repo_root/node_modules/prettier/bin/prettier.cjs" --config "$snapshot_root/.prettierrc.json" --ignore-path "$snapshot_root/.prettierignore" --check --ignore-unknown .
