# Persistent crawler diagnostics

The TS gateway emits `CRAWLER_RESPONSE` for `/robots.txt`, the sitemap index and
supported children, and requests identifying themselves as Googlebot or
Google-InspectionTool. This is operational evidence, **not proof of Googlebot
identity**: user-agent, country and ray headers can be spoofed when reaching an
origin directly. Cloudflare cache hits do not reach this gateway.

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
- `cfRay`: strictly validated ray value; `cfColo`: its three-letter suffix.
- `cfCountry`: two uppercase letters, otherwise null. No IP is logged.

No cookies, authorization headers, service tokens, full URLs, request bodies or
response bodies are included. On an unchanged production host, an operator can
read recent records with:

```sh
ssh skyhong.tw 'sudo tail -n 100 /var/lib/youtube-board-ts/crawler-logs/crawler.jsonl'
```

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
