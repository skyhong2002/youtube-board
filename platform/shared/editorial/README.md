# Editorial event registry and channel review

The meeting workflow lives beside the imported sources: `ts_editorial_*` tables never rewrite AI results, notification stories, article snapshots, or maintained tag vocabulary. Registry IDs are UUID v4 and names are mutable labels; equal names never imply equal events. All editor associations are explicit.

## Public and operator surfaces

- `/events` and `/events/:uuid`: event list, source timeline, side-by-side original headlines, latest 100 reviewed changes (including merged aliases). A merged UUID resolves to its current canonical event; later merges flatten older aliases.
- `/manage/editorial`: Google administrator session by default, with create/rename/attach/refresh/merge/split and submit/approve/reject channel forms. Session mutations require same-origin CSRF protection; audit identity is server-resolved `user:<id>`. An optional in-memory bearer token selects service authentication with `service:<TS_OPS_ACTOR>`, which identifies the configured service account rather than an individual. No browser token persistence. An explicitly present Authorization header always selects the service path, even if empty or invalid; it never falls back to the session. See [accounts handoff](../../docs/accounts-handoff.md).
- `/api/v1/editorial/events[/:uuid]`: read-only public API. Public history excludes actor and private review reasons.
- `/api/ops/editorial`, `/events/:uuid`, `/preview`, `/execute`: authenticated operator API. Preview only reads; no queue/provider calls. Execute requires the exact preview hash, expected revisions, UUID request key, and `execute: true`. A successful request replay returns its original result. Reusing a request UUID with different content or actor returns 409.

An explicit refresh replaces the active observation of the same exact source; its old snapshot/link remains archived. Ordinary attachment rejects an already-linked source identity. Merging retains the target event’s existing observation when both sides cite the same exact source, as shown by the preview and audit. **Merge is irreversible in this version:** the preview hash includes this warning and the console labels the action accordingly. Archived sources/audit remain, but split only creates a new UUID; it cannot restore the original identity, aliases, or deduplicated snapshot. No unmerge workflow is implemented.

An event may reference up to 500 source snapshots; each attachment batch accepts 25. Splits select existing snapshot UUIDs explicitly, retaining the original link and immutable before/after audit. Merge aliases and source moves occur in one InnoDB transaction. Source records, audit entries and completed request results have database triggers rejecting UPDATE and DELETE; runtime database privileges must exclude schema/TRUNCATE/DROP rights. Migrations use a separate privileged connection during deployment.

## Evidence types

- `video`: byte-exact 11-character YouTube video ID. Current title, description, owning channel and timestamps are captured with a content hash. Scheduled `stime` and mutable view counters are excluded.
- `daily`: `urt_ai_date.pk:eventIndex` (zero-based), exact daily result entry plus whole result hash. Array entries are references, never inferred durable event identities.
- `event`: `urt_ai_event.pk`, preserving source AI payload and lineage.
- `story`: `telegram_digest_stories.id`, preserving only the stable story key, title and UTC first-seen time (also the observation timestamp). Hourly last-seen, videos and observation arrays are excluded, so unrelated polling does not invalidate a preview; changing the title/key/first-seen still does. A notification matcher does not establish editorial identity.
- `article`: exact `tag.observe.tw` article ID and a **published** local `ts_vocabulary_runs.id`; resolved against `ts_vocabulary_stage`. Current shared snapshots contain media, publication time and tags but do not capture titles or article URLs. The editor supplies those quotations, visibly labeled `operator-transcribed`; the article identity/tags remain pinned to the maintained snapshot. The API does not fetch supplied URLs. No coverage beyond the observed article window is claimed.

Article identity remains the exact upstream article ID across runs; selecting a newer run requires refresh. Unchanged refresh is rejected. A daily result with duplicate event names retains its exact index/hash but has no ambiguous name-based link.

Rejected candidates are a terminal review decision in this version; re-submission of that same canonical UC ID is rejected and the original decision remains visible. Reopening decisions needs a separately reviewed future workflow, never deleting audit rows.

Source content changes between preview and execute invalidate the preview. Old attachments remain immutable observations. YouTube/news metrics are not combined; article terms remain maintained upstream tags rather than channel classifications. Legacy YouTube timestamps are interpreted in Asia/Taipei; new editorial and notification timestamps are UTC.

## Write gates and handoff

Registry mutation requires an authenticated Google administrator or a configured service token, plus all of the execution gates below. Login alone does not enable registry writes:

```text
TS_OPS_EXECUTION_ENABLED=true
TS_OPS_WRITE_ALLOWLIST=editorial.registry
TS_INGESTION_ENABLED=true
TS_INGESTION_OWNERS=editorial.registry
```

In production also require `TS_INGESTION_PRODUCTION_ENABLED=true` and exact `TS_INGESTION_WRITE_ALLOWLIST=editorial.registry`, plus the approved ownership/handoff and rollback plan. The examples show this feature in isolation; preserve other approved exact entries rather than replacing existing lists. No default enables writes. The optional service path additionally requires `TS_OPS_TOKEN` (at least32characters) and `TS_OPS_ACTOR` (the documented service label, at most92characters before the prefix). Individual attribution uses the Google administrator account; preview/replay identity cannot be supplied by the client or shared across actors. Workflow queue APIs remain bearer-only and do not inherit Google editorial authority.

Approved channels do **not** mutate `urt_channel` from HTTP. A reviewed, operator-only source command adopts exactly one candidate with at most two Google API attempts:

```bash
npm run start -w @youtube-board/jobs -- youtube:channels:adopt \
  --candidate-id=<candidate-uuid> --expected-version=2 --request-id=<request-uuid>
# Append --execute only after reviewing the dry-run and authorizing this source write.
```

This command additionally requires exact ownership and gates for `youtube.channels.adopt`. It is excluded from queue and recurring registries. Production requires `TS_LARAVEL_LOCK_STORE=stopped`, confirming the corresponding Laravel channel writers are stopped. The command holds both the source writer lock and editorial registry lock, validates exact `UC` IDs, verifies Google snippet/statistics/uploads identity, and preserves existing channel taxonomy. A retired existing channel is rejected. New channels have no invented taxonomy; the normal separately owned source ingestion jobs can later discover uploads.

The legacy channel table is MyISAM. An interruption after its unique-ID insert but before editorial commit leaves an approved candidate; replay repairs adoption using that exact existing row without inserting a duplicate. No rollback of this channel insert is promised. Journal and candidate adoption transition are atomic in InnoDB. Provider failures leave the candidate approved. Backups and operator reconciliation are required for a production handoff.

## Validation

Migration `010_editorial.sql` is additive. Focused unit/auth/fake-provider tests are in API/jobs/ingestion; `jobs/test/editorial-db.test.ts` runs real transactions and triggers only against the enforced loopback `youtube_board_test_rewrite` database under `JOBS_DB_TEST=1`. Its fixture cleanup uses privileged TRUNCATE solely in that isolated test database. No production access or real provider calls are required.

### Indexed public history migration

Migration011 adds the immutable `(event_id, sequence)` audit lookup and a `merged_into` index. Existing audits are backfilled from both before/after event states; repeated execution deduplicates mappings. Disable and drain **all** `editorial.registry` writers before running011, deploy every writer at the new revision, rerun011 while still disabled, verify mapping completeness, then restore the exact reviewed gate. Old writers must not run after backfill: they cannot populate the new lookup. Run the two backfill statements in a maintenance window; they parse all retained audit JSON and may hold InnoDB locks. For a large history, the reviewed migration task should batch them by bounded `a.sequence` ranges. Never run this maintenance through a public request.

Preflight must find valid JSON, valid version4 lowercase UUID event IDs and no malformed event arrays; historical supported writers already enforce that contract. Preserve the original audit table. After backfill, compare the distinct `(sequence, event_id)` rows obtained from **both** JSON_TABLE projections against the lookup (anti-join must return zero); also confirm candidate-only audits produce no event mapping. Do not accept an empty public history as migration verification. Production reader credentials need SELECT only; writer credentials must not permit DROP/TRUNCATE, which bypass append-only triggers.

The public reader limits aliases to500 and reads at most100 indexed changes per alias before choosing the global latest100. It checks a shared16MiB audit/source-provenance payload budget before fetching large immutable fields. Oversized histories return422. After reading, it rechecks the canonical event version and merge target: concurrent edits return409 for an explicit retry, rather than mixing old identity with new links. This is optimistic revision validation, not a claim of a transaction across all dashboard tables.

The16MiB check budgets stored audit JSON and source-provenance bytes. It is not an exact serialized-response or process-memory ceiling: bounded titles/URLs and JSON escaping add overhead. No auto-retry of409 is performed by this reader.
