#!/usr/bin/env bash
# Capture one full screenshot set from a built platform/web.
#   docs/design-review/tools/run-set.sh PLATFORM_DIR OUT_DIR [batch ...]
# Batches: normal empty error loading (default: all). Servers are restarted for
# every batch (serve.sh) so no in-memory ISR entry from another batch survives.
# RECORD=1 lets the snapshot server fill missing entries (first pass only).
# Waits for load1 <= 10 before each batch; one browser at a time.
set -euo pipefail
PLATFORM=$(realpath "$1"); OUT=$2; shift 2
BATCHES=("$@"); [ ${#BATCHES[@]} -eq 0 ] && BATCHES=(normal empty error loading)
TOOLS=$(dirname "$(realpath "$0")")
export NODE_PATH=${NODE_PATH:-/home/sky/.cache/perf-fe-before/node_modules}
mkdir -p "$OUT"
for batch in "${BATCHES[@]}"; do
  for size in desktop mobile; do
    while :; do
      load=$(cut -d' ' -f1 /proc/loadavg)
      awk -v l="$load" 'BEGIN{exit !(l<=10)}' && break
      echo "$(date +%T) load1 $load > 10, waiting"; sleep 30
    done
    # Loading states share API reads, so each one gets a fresh Next with nothing cached.
    if [ "$batch" = loading ]; then ids=$(node -e "import('$TOOLS/states.mjs').then(m=>console.log(m.STATES.filter(s=>s.loading&&(!process.env.ONLY||s.id.includes(process.env.ONLY))).map(s=>s.id).join(' ')))"); else ids=${ONLY:-ALL}; fi
    for id in $ids; do
      "$TOOLS/serve.sh" "$PLATFORM" ${RECORD:+--record}
      # Empty data leaves filter-name lookups alone: an emptied lookup is a different (partial) state.
      case $batch in loading) body='{"mode":"normal"}';; empty) body='{"mode":"empty","match":"^/api/v1/(?!filter-options)"}';; *) body="{\"mode\":\"$batch\"}";; esac
      curl -s -X POST -d "$body" http://127.0.0.1:8501/__review/scenario >/dev/null
      if [ "$id" = ALL ]; then only=(); else only=(--only "$id"); fi
      ONLY_SIZE=$size nice -n 10 node "$TOOLS/capture.mjs" site http://127.0.0.1:8501 "$OUT" --data "$batch" "${only[@]}"
    done
    curl -s -X POST -d '{"mode":"normal"}' http://127.0.0.1:8501/__review/scenario >/dev/null
  done
done
