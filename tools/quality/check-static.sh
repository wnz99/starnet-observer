#!/bin/sh
set -eu
cd "$(git rev-parse --show-toplevel)"
bun run lint
bun run typecheck
