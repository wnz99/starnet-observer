#!/bin/sh
set -eu
case "$(uv tool run --from uv==0.13.1 uv --version)" in
  "uv 0.13.1"|"uv 0.13.1 "*) ;;
  *) printf "%s\n" "Wrong uv version" >&2; exit 1 ;;
esac
test "$(bun --version)" = "1.3.13"
test "$(node --version)" = "v24.19.0"
