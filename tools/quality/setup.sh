#!/bin/sh
set -eu
cd "$(git rev-parse --show-toplevel)"
bun install --frozen-lockfile
sh tools/quality/check-versions.sh
sh tools/quality/install-hooks.sh
