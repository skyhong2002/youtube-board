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
