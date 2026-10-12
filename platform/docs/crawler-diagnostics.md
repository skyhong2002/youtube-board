# Persistent crawler diagnostics

The TS gateway emits `CRAWLER_RESPONSE` for `/robots.txt`, the sitemap index and
supported children, and requests identifying themselves as Googlebot or
Google-InspectionTool. A crawler name alone is **not proof of Googlebot identity**: user-agent,
country and ray headers can be spoofed when reaching an origin directly. The
`verified` field separately records bounded forward-confirmed reverse DNS. Cloudflare cache hits do not reach this gateway.

## Storage and limits

Set `CRAWLER_LOG_DIRECTORY` on the **web service only** to a writable persistent
mount. Production uses host `/var/lib/youtube-board-ts/crawler-logs` mounted at
`/var/log/youtube-board/crawlers`, owned by UID/GID 1000. Directory mode is 0700;
JSONL files and the lock are 0600. The existing media mount remains read-only.
The account-maintenance service receives no log mount or setting.

`crawler.jsonl` is the active file; `.1`, `.2`, `.3` are older rotations. Each is
at most 5 MiB; retention is at most **20 MiB total**, plus an empty lock file.
Retention is size based, not a promised number of days. Automatic rotation only
removes this logger's oldest rotation, never other logs, backups or directories.
No response bodies are stored. Records have a 2 KiB maximum and the in-memory
queue is limited to 256 KiB. At most 300 response records/minute are emitted;
`CRAWLER_LOG_SUPPRESSED` summarizes rate-budget overflow on the next window.
Queue pressure or disk errors can drop records and produce bounded aggregate
sink diagnostics on stderr; this must never prevent a public response.

The image requires the existing Linux `flock` binary. A descriptor-owned lock
serializes file rotation and append across overlapping start-first deployments.
A new process waits at most 60 seconds, with the same bounded queue, for the old
process to release its descriptor. Graceful close drains queued writes and
releases the lock (waiting lock acquisition is cancelled after five seconds on
shutdown). Process death releases the OS lock; there is no stale PID lock to
remove. Logs survive container replacement. This is not an offsite backup or a
power-loss durability guarantee.

## Fields and interpretation

- `at`: completion/disconnection time, UTC ISO 8601.
- `method`, sanitized `path`, `status`: query strings, private identifiers and
  keyword/search values are omitted or replaced by route shapes.
- `bytes`: **encoded response-body bytes** submitted to the HTTP response after
  proxying/compression; excludes HTTP headers, chunk framing and TLS overhead.
  Completed responses count actual body bytes, including streamed robots.txt;
  HEAD, 204 and 304 have zero body bytes. Cloudflare may transform origin bytes.
- `completed`: true on response finish, false on early close. For an incomplete
  response, bytes is only bytes submitted; it cannot prove remote receipt.
- `userAgent`: only known crawler/browser product/version tokens, not the raw UA.
  Acceptance requests use `youtube-board-verify/1.0`, never a Google crawler UA.
- `verified`: true only for a Google crawler UA whose trusted ingress client IP
  passes reverse DNS to a boundary-matched `googlebot.com` or `google.com` name
  and forward DNS resolves back to that same IPv4/IPv6 address. Caller-supplied
  `cf-verified-bot` is ignored; no trusted Cloudflare header rewrite has been
  established. Verification is bounded, cached and separate from HTTP completion.
  Timeout, saturation, DNS failure and ordinary browsers/verifiers yield false.
  Old records without the field remain unverified; they are never upgraded.
  IPs and DNS names exist only briefly in bounded process memory, never in logs.
- `cfRay`: strictly validated ray value; `cfColo`: its three-letter suffix as
  received at the origin. Cloudflare may use a different colo suffix in the
  client response (observed KIX at origin, TPE at client for the same ray ID);
  correlate the hexadecimal ID, not the suffix alone.
- `cfCountry`: two uppercase letters, otherwise null. No IP is logged.

No cookies, authorization headers, service tokens, full URLs, request bodies or
response bodies are included. On an unchanged production host, an operator can
read recent records with:

```sh
ssh skyhong.tw 'sudo python3 -' < platform/tools/summarize-crawler-logs.py
```

The summary includes all retained discovery requests with agent category and
`verified`, and a separate `verifiedGooglebotChildSitemaps` list. Only entries
from that verified list can be reported as Googlebot fetching child sitemaps.
The summarizer reads all rotations without changing permissions or exposing IPs
or full UAs. Historical acceptance probes before this policy used a Google UA;
they are unverified test traffic, not Google evidence.

Check rotations too when correlating a GSC submission. A missing entry does not
prove Google never requested it: edge caching, log suppression, transport failure
before the app, and retention are separate possibilities. These logs begin at
deployment; old container stdout cannot be reconstructed.

## Verification

Focused tests cover real HTTP identity/gzip/Brotli streams, UTF-8 byte lengths,
final hook transformations, HEAD/204/304, disconnects, field sanitization, file
rotation/reopen, bounded queues, sink failures and cross-process lock ownership.
Deployment acceptance records live in the ignored `.local/dokploy` directory.
No DB/schema, frontend/CSP, Cloudflare or Laravel writer changes are required.

## Production acceptance — 2026-10-12 17:49–17:50 UTC

Code `dfce18e`, pinned image
`sha256:93b364265df858fd019cbf54c25456b72b782b23551670c1668a16e3d7c849d0`
was deployed through Dokploy; Swarm update completed with a healthy web task.
Only two backend source files changed in the image. Both services retain the
previous frontend layers, and only web receives the new bind/setting. Stored
secret environment, routes, DB grants and writer gates were preserved.

- API typecheck and 23 focused crawler/cache/rate-policy tests passed.
- Independent Codex review had no blocker. Its request for separate-container
  lock proof was adopted: the canary's second container waited while the first
  held its descriptor, then appended after the first was removed. A third
  read-only container recovered the identical persisted file checksum. All
  canary containers and temporary log files were cleaned up.
- Fifty public checks passed. Robots GET logged 313 bytes; HEAD logged zero.
  Sitemap index GET logged 2,182 bytes; HEAD zero. These persisted records
  matched the actual external response bodies using CF-Ray hexadecimal IDs.
- All 17 child sitemap GET/HEAD responses were 200, nonempty and had lastmod.
  Static: 21; channels: 3,474; tags: 108; videos 1–13: 50,000 each;
  videos 14: 23,945 (ingestion continues, so this count can grow).
- OpenAPI still has 115 public GET paths. Anonymous API GET is
  `public, max-age=0, s-maxage=60, stale-while-revalidate=120`; Cookie,
  Authorization, X-Api-Key, X-Service-Token or RSC gives `private, no-store`.
  Invalid query returned 400/no-store; isolated canary 429 also used no-store.
- Homepage was Cloudflare HIT, 103 ms request duration, with hash CSP preserved;
  `/my` stayed no-store. Tag/blog were 200; Laravel scheduler remained running.

Receipts: ignored `.local/dokploy/canary-crawler-dfce18e.json`,
`crawler-public-dfce18e.json`, `crawler-acceptance-dfce18e.json` and sanitized
`crawler-persistent-records-dfce18e.json`. This verifies diagnostic availability,
not GSC sitemap acceptance or authenticated Googlebot activity.

Rollback: restore the privately backed-up pre-release compose via Dokploy and
redeploy image `sha256:2a537598c86fbe3c351cab4b9b64e17eca911a0d401872e1becd36a5427c0c6c`.
Keep `/var/lib/youtube-board-ts/crawler-logs` intact. That prior image retains
the X-Service-Token cache fix but only logs crawlers to stdout.

## Verified identity release — 2026-10-12 18:30–18:34 UTC

Commit `7eb48f4` is deployed as pinned image
`sha256:5b7d9171d9633c132766c65abd934c791787693a72b7f016bcd1408097dedadd`.
Three backend source files changed; trusted-ingress source hashes and unchanged
frontend layers/runtime configuration were checked in the built image. Dokploy
rollout completed and the new web task was healthy. No schema or writer changes.

Independent Codex and actual Opus 5.5 reviews completed. The mapped-IPv4 PTR issue
identified by Opus was corrected; tests assert dotted IPv4 resolver input. Trust
boundary tests include forged XFF/CF headers, and a pending-DNS shutdown test proves
that the unverified record reaches persistent storage before close. API typecheck
and 30 focused crawler/ingress/cache tests passed (the new shutdown test and
changed verifier tests were rerun after review).

The same-image isolated canary passed all 17 sitemap children and persistence/
separate-container lock checks, with peak memory 461,295,616 bytes. The 50 public
checks passed again: sitemap GET/HEAD/lastmod, OpenAPI 115 paths, anonymous public
API cache headers, credential/RSC private cache headers, invalid-query no-store,
health, and private `/my`. Homepage retained hash CSP and shareable STALE policy.

At 18:34:38 UTC, all 38 new retained discovery probes had the custom verifier agent
and `verified:false`. There were zero verified Googlebot child-sitemap records.
Historical missing `verified` fields remain unverified. This is not evidence that
GSC accepted the sitemap; cache hits and earlier requests need separate evidence.

Receipts are the ignored `crawler-verified-image-proof.json`,
`canary-crawler-verified-7eb48f4.json`, `crawler-verified-public-7eb48f4.json`, and
`crawler-verified-request-summary.json`. Only this release's temporary build
contexts were removed; persisted logs and images remain.

Rollback: restore the privately saved pre-release compose and deploy
`sha256:93b364265df858fd019cbf54c25456b72b782b23551670c1668a16e3d7c849d0`.
Keep the crawler-log mount and files; older code omits `verified`, which the
summarizer treats as false.
