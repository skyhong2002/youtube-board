#!/bin/bash
# Keep the public entry pages warm so a reader is not the first, cold request (12 s API read timeout → 503).
# Requests go to the local Traefik (not Cloudflare), one at a time, so the 2-core host never sees a burst.
# Installed on the production host as youtube-board-ts-warm.{service,timer}; see docs/page-warming.md.
set -u
ORIGIN=${WARM_ORIGIN:-https://youtube.observe.tw}
HOST=${ORIGIN#https://}
GAP=${WARM_GAP_SECONDS:-2}
TOP=${WARM_TOP_KEYWORDS:-20}
# Skip a run while the host is busy: warming should never add to a load spike (e.g. a release swap).
load=$(cut -d' ' -f1 /proc/loadavg)
if awk "BEGIN{exit !($load > ${WARM_MAX_LOAD:-4})}"; then echo "skip: load $load"; exit 0; fi
fetch() { curl -s -o /dev/null --max-time 60 --resolve "$HOST:443:127.0.0.1" -A 'youtube-board-warm/1' -w "%{http_code} %{time_total}s $1\n" "$ORIGIN$1"; sleep "$GAP"; }
for path in / /keywords /tags /tags/cloud /tags/days /channels /videos /groups /mayor /ai/days /ai/hours /ai/periods \
  /live/current /live/channels /live/hours /live/tags /live/periods /live/trends/daily /compare/titles; do
  fetch "$path"
done
# The top of the /keywords ranking is what the report caches cover (runtime/schedules.report-caches.json).
for term in $(curl -s --max-time 60 --resolve "$HOST:443:127.0.0.1" "$ORIGIN/api/v1/keywords?limit=$((TOP * 3))" \
  | python3 -c 'import json,sys,urllib.parse
rows=json.load(sys.stdin).get("data",{}).get("rows",[])
ok=[r["term"] for r in rows if not r.get("displayExclusion")][:int(sys.argv[1])]
print("\n".join(urllib.parse.quote(t,safe="") for t in ok))' "$TOP" 2>/dev/null); do
  fetch "/keywords/$term/videos"
  fetch "/keywords/$term/cloud"
  fetch "/keywords/$term/days"
done
