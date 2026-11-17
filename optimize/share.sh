#!/usr/bin/env sh
set -eu
share_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec node "$share_dir/share.cjs" "$@"
