#!/usr/bin/env bash
# Build platform/web (niced, after load1 <= 10) and shoot a full set from it.
#   docs/design-review/tools/build-and-shoot.sh PLATFORM_DIR OUT_DIR
set -euo pipefail
PLATFORM=$(realpath "$1"); OUT=$2
TOOLS=$(dirname "$(realpath "$0")")
for f in snapshot next; do [ -f /tmp/yb-review/$f.pid ] && kill "$(cat /tmp/yb-review/$f.pid)" 2>/dev/null || true; done
while :; do
  load=$("$TOOLS/load1.sh")
  awk -v l="$load" 'BEGIN{exit !(l<=10)}' && break
  echo "$(date +%T) load1 $load > 10, waiting"; sleep 30
done
# ionice exists only on Linux; on macOS nice alone lowers the build's priority.
IONICE=(); command -v ionice >/dev/null && IONICE=(ionice -c3)
(cd "$PLATFORM/web" && NODE_ENV=production nice -n 19 ${IONICE[@]+"${IONICE[@]}"} ../node_modules/.bin/next build) >"$OUT.build.log" 2>&1 || { tail -30 "$OUT.build.log"; exit 1; }
rm -rf "$OUT"
"$TOOLS/run-set.sh" "$PLATFORM" "$OUT"
