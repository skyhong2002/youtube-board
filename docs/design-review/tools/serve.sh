#!/usr/bin/env bash
# Start (or restart) the snapshot server and `next start` for one built platform/.
#   docs/design-review/tools/serve.sh PLATFORM_DIR [--record]
# PIDs go to /tmp/yb-review/{snapshot,next}.pid; never stop them with pkill -f.
set -euo pipefail
PLATFORM=$(realpath "$1"); RECORD=${2:-}
TOOLS=$(dirname "$(realpath "$0")")
for f in snapshot next; do
  [ -f /tmp/yb-review/$f.pid ] && kill "$(cat /tmp/yb-review/$f.pid)" 2>/dev/null || true
done
sleep 1
nohup node "$TOOLS/snapshot-server.mjs" --data /tmp/yb-review/data --port 8501 --next http://127.0.0.1:3101 \
  --errors "$PLATFORM/web/public/errors" \
  ${RECORD:+--record https://youtube.observe.tw} >/tmp/yb-review/snapshot.log 2>&1 &
echo $! >/tmp/yb-review/snapshot.pid
cd "$PLATFORM/web"
YOUTUBE_API_BASE_URL=http://127.0.0.1:8501/api/v1 YOUTUBE_PUBLIC_URL=http://127.0.0.1:8501 NODE_ENV=production \
  nohup nice -n 10 ../node_modules/.bin/next start --hostname 127.0.0.1 --port 3101 >/tmp/yb-review/next.log 2>&1 &
echo $! >/tmp/yb-review/next.pid
for _ in $(seq 60); do curl -sf -o /dev/null http://127.0.0.1:8501/robots.txt && exit 0; sleep 1; done
echo "next did not start" >&2; exit 1
