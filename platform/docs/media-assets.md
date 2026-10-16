# Channel avatars and video thumbnails

Channel branding is presentation metadata, separate from historical evidence and report freshness. Public DTOs include a nullable192×192 avatar with its content SHA-256 revision and `cachedAt`. The site only serves published local PNGs at `/media/channels/<u_id>/<revision>.png`. Missing, failed or invalid images show a fixed-size fallback and leave the source name/link usable. Video thumbnails use exact11-character video IDs at `https://i.ytimg.com/vi/<id>/mqdefault.jpg`; arbitrary database image URLs are not forwarded.

The shared appearance follows the mother's `afe0a653` MediaIcon/favicons approach. Channel avatars appear in directories/rankings, channel headers, video/live listings, event source comparisons, filter suggestions and followed channels. Video thumbnails also appear in lists and event sources. The site does not download an avatar during a report request or on a cache miss.

## Storage and refresh

Set `MEDIA_CACHE_ROOT` to an absolute path outside the immutable Next public tree. The packaged local overlay mounts persistent `rewrite-media` at `/var/lib/youtube-board/media`: web read-only, worker read/write. The image initializes the directory for its unprivileged `node` user. Native development can use an ignored absolute `.local/media` directory; Next dev forwards only `/media/channels/...` to loopback API4100. The Next video optimization cache is separate and capped at128MiB.

`channels:avatars:refresh` defaults to a no-I/O dry run:

```sh
npm run start --workspace=@youtube-board/jobs -- channels:avatars:refresh --limit=100
```

Execution requires `--execute`, `APP_ENV=local|test|production`, `TS_INGESTION_ENABLED=true` and `channels.avatars.refresh` in `TS_INGESTION_OWNERS`; production additionally requires its exact write allowlist and production gate. A queued/scheduled execution also requires the scheduler gate. Set only for the explicitly authorized environment. The worker selects stored channel IDs/thumbnail URLs using bounded parameterized SQL; source YouTube tables are never modified. Durable run summaries use `ts_job_runs`. No Google API key is used, and copying a stored thumbnail URL is not verification of the current channel metadata.

Default batches are100 channels (maximum500), with a7-day successful-cache freshness interval. Without explicit `--u_id` or `--after-id`, an atomic persistent cursor sweeps through active channel IDs and resets at the end. It advances only through processed entries; failed entries keep old-good assets and are reconsidered on a subsequent sweep. Explicit channel/cursor inspection does not change the recurring sweep cursor. Invalid cursor/cache data fails closed. A database workflow lock serializes cursor and run bookkeeping; the cache publisher also holds an exclusive filesystem lock.

An opt-in hourly schedule can be placed in an operator-reviewed schedule file:

```json
{"version":1,"timezone":"Asia/Taipei","schedules":[{"id":"channel-avatars","workflow":"channels.avatars.refresh","cron":"17 * * * *","options":{"limit":100,"max-age-days":7}}]}
```

This is documentation only. The repository's default schedule remains empty and all runtime execution gates remain disabled. Production activation still needs an approved persistent volume, writable worker/read-only web grants, a backup and restore plan, and ownership/rollback approval. Do not switch Laravel or reuse the production database for a local test.

## Download boundary and operational recovery

Only exact `yt3.ggpht.com` and `yt3.googleusercontent.com` HTTPS sources are eligible. All resolved addresses must be public; the checked address is pinned into the TLS request. Redirects, private/Tailscale addresses, credentials, oversized bodies and unsupported/corrupt image formats are rejected. Downloads and raster conversion have deadlines and memory/pixel/byte bounds. Converted output strips metadata. Immutable PNG bytes are published before the manifest pointer, so a failed refresh preserves the previous image.

A crash can leave `.refresh.lock`; stop and verify no refresh worker remains before removing a stale lock. Never remove a lock merely because it is old. Back up manifest, channel files and sweep cursor together. Restore to a separate local volume and verify revision hashes and public route responses before attaching it. Each channel retains at most16 immutable revisions (maximum512KiB each). When this limit is reached, the publisher returns `CACHE_REVISION_LIMIT` and retains the current good revision. Before an operator removes any older revision, stop refresh writers, back up the volume, and identify the current revision from the manifest; never remove that active revision. Old URLs may be cached for one year, so prefer increasing the reviewed storage allowance or archiving over early deletion. Neither HTTP requests nor the refresh command silently garbage-collect old revisions.

Video optimization accepts only canonical thumbnail URLs, one URL parameter, allowed widths and quality75. Next image redirects are disabled, local/private fetches and SVG are disabled, upstream response bodies are capped at2MiB, and loading failures render a local placeholder. Avatar cache dates are never shown as source-data update times.

## Precomputed avatar WebP sizes

The original192px PNG URL, revision hash and v1 manifest remain unchanged.
Writers now also prepare48/96/192px WebP files, at
`/media/channels/<u_id>/<revision>/<width>.webp`. Each derivative is at most64KiB;
all three sizes have one-year immutable caching and separate ETags.
Only those three widths exist. Missing files return404 without encoding,
downloading or modifying storage during a request. Frontend fallback remains
the original PNG, then the fixed-size source initial. Existing derivative files
are never overwritten, including after a codec upgrade; changing encoding at an
existing immutable URL is forbidden.

For existing **local cache files**, the standalone backfill defaults to dry-run:

```sh
nice -n 19 ionice -c3 node --import tsx tools/avatar-derivatives.ts --root=/absolute/media/path --limit=100
nice -n 19 ionice -c3 node --import tsx tools/avatar-derivatives.ts --root=/absolute/media/path --limit=100 --execute
```

Use `--after-id=<lastProcessedId>` for the next batch. Only current manifest
revisions are considered. No source API or database is read or written. The CLI
sets its process niceness to19 and uses the same `.refresh.lock` as the refresh
worker. Each batch is sequential, at most500 sources/32MiB input/120seconds,
with200ms pacing by default (`--delay-ms`, minimum100ms). One killable5second
subprocess uses one libvips thread and96MiB V8 heap; only192×192 PNG input is
accepted, animation is rejected, and output dimensions/bytes are checked.
Neither backfill nor refresh deletes old revisions or changes existing PNGs.
If an existing derivative is malformed, the batch reports failure and preserves
it for operator investigation; it never silently replaces immutable content.
Partial derivative publication can be resumed, and manifest pointers change
only after all derivatives for a new revision have been safely prepared.


Crash recovery requires more than clearing the writer lock: immutable publication
links a fully synced temporary file to its final name, then removes that temporary
name. A crash between these steps can leave both names pointing to the same inode
(`nlink=2`); serving and backfill deliberately reject that file. Stop writers and
verify the exact published filename plus its matching `.UUID.tmp` filename are
regular files with the same device/inode, expected revision/dimensions and bytes.
After preserving recovery evidence and obtaining operator approval, remove only
that verified extra temporary link, never the published PNG/WebP. Verify `nlink=1`
and the public response before resuming. Do not use wildcard cleanup or automatic
removal of existing files. Unrelated or unexplained links require investigation.

Backfill's cursor advances past ordinary per-ID failures, which are included in
`failures`; retain that list. After resolving a failure, rerun starting immediately
before its ID (`--after-id=<failedId-1> --limit=1`), or repeat from zero (valid
existing derivatives are skipped). Cancellation/run-budget interruptions leave
the cursor before the interrupted item. Refresh forwards cancellation into the
encoder and checks it again before committing the manifest pointer; partial
unreferenced image files may remain and are not deleted automatically.

## Optional stale-source resolution

`--resolve-missing` explicitly enables a cache-only fallback when the stored URL is
empty/rejected or its CDN responds with404/410. It is off by default, including
existing schedules. A403/429/5xx, timeout, corrupt raster or transient failure does
not trigger extra page requests. HTTP failures now include only a numeric
`httpStatus`, so a generic download failure is not mislabeled as an expired URL.

The worker constructs `https://www.youtube.com/channel/<exact UC channel ID>`
itself. It accepts neither handles nor arbitrary page URLs. All DNS answers must
be public and the selected address is pinned into verified TLS. Redirects,
credentials, cookies, compression and script execution are disallowed. Both the
page's canonical URL and `og:url` must identify that exact channel; only one
unambiguous `og:image` from the existing two-host CDN allowlist may be downloaded.
HTML is capped at2MiB/10seconds, metadata parsing at256KiB of head markup, and
resolved images use the existing raster validation and192px PNG conversion.
A resolved avatar is published through the same writer as any refresh, so it
also receives the48/96/192px WebP derivatives described above.
The run retains its120second/32MiB limits and allows at most20 page resolutions.

Worker-only `avatar-resolutions.json` binds each resolution to the local channel
ID, exact YouTube identity and original stored-URL fingerprint. Successful
resolutions last7days; failed resolution attempts back off6hours. At most2,000
entries/6MiB are retained, newest first. Atomic publication and the existing
writer locks protect this file. Corrupt/symlink state fails closed. Include this
file (`<MEDIA_CACHE_ROOT>/avatar-resolutions.json`, next to `manifest.json`) in
media-volume backups/restores; restoring a volume without it only forgets cached
resolutions/backoff and causes fresh page lookups. It is not a source-table
replacement and is never served publicly. Failed refreshes preserve the last-good
avatar, and neither the fallback nor its metadata changes `urt_channel`, source freshness or
YouTube API quota. Source/identity changes invalidate the cached binding.

Example for an explicitly authorized cache-only execution:

```sh
npm run start --workspace=@youtube-board/jobs -- channels:avatars:refresh --u_id=123 --resolve-missing --execute
```

A schedule may opt in with `"resolve-missing": true` only after reviewing its
network scope: the flag adds HTTPS egress from the worker to `www.youtube.com`,
which requires operator approval before production use. Public channel pages may require consent, redirect to a handle,
return different markup or reject automated requests; these cases fail closed
and retain the fixed-size text fallback. No live page compatibility is claimed
by the offline transport/parser fixtures.
