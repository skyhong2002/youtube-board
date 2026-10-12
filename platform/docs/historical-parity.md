# Historical response comparison

`tools/parity-compare.mjs` compares two captured bundles **offline**. It makes no
HTTP or database connections, starts no processes or servers, imports no dumps,
and never runs a source writer. It ignores runtime endpoints and credentials.
It supports the 36 reviewed public compatibility GET paths from
`api/src/legacy/index.ts`; it does not compare arbitrary HTML pages, authenticated
APIs, v1 reports with different contracts, or production state.

```bash
cd platform
node tools/parity-compare.mjs \
  .local/historical-parity/laravel/manifest.json \
  .local/historical-parity/typescript/manifest.json
```

Exit codes are `0` for equal, `1` for differences, and `2` for invalid or unreadable
evidence. Standard output contains one sanitized JSON result; it never includes
raw response values, request queries, credentials or filesystem paths. The output
contains case IDs, mismatch paths/kinds, exact mismatch counts, truncation state,
body byte count and `externalCalls: 0`. Unusual/long object keys are represented
by a hash in mismatch paths, and long paths are truncated with a hash suffix.

An `equal` result means the captured responses compare equal under this contract.
It is not approval for deployment or proof of successful source collection.
`errorResponseCases` counts pairs where either response is HTTP 400 or greater:
two identical 503 responses may compare equal but cannot establish working report
parity. Invalid evidence is not converted into an accepted difference.

## Bundle contract

Each side uses a private directory with a `manifest.json` and one raw `.body` file
per case. The collector must write directories as `0700` and files as `0600`,
keep them ignored/outside version control and assign a retention deadline. Body
files must be ordinary single-link files; symlinks, hardlinks and directories
are rejected. File reads use bounded handles with no-follow semantics.

The manifest has exactly these fields; extra fields are rejected:

```json
{
  "format": "youtube-board-parity-v1",
  "source": {
    "artifacts": [{"sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}],
    "rowFingerprint": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  },
  "reader": {
    "name": "laravel",
    "fingerprint": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
  },
  "clock": "2026-05-24T00:00:00Z",
  "origin": "http://parity.local",
  "cases": [{
    "id": "live-day",
    "request": "/api/api_live_day.php?videoId=AbCdEFg_123&date=2026-05-24",
    "status": 200,
    "contentType": "application/json",
    "bodyFile": "live-day.body",
    "bodySha256": "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
  }]
}
```

The repeated-character digests above only illustrate the format. A collector must
compute real SHA-256 hashes from the artifacts, preserved source rows, reader
source/image evidence and exact body bytes.

- Left reader name must be `laravel`; right must be `typescript`. Their 64-character
  lowercase hexadecimal fingerprints normally differ and are not equated.
- Source artifact lists must have 1–8 unique digests and match **in order**; order
  represents the reviewed import order. Both source row fingerprints must match.
  Schema differences are recorded outside this response bundle; source rows must
  refer to the same original-column scope and normalization contract.
- Clock must be a valid UTC `Z` timestamp with seconds and optional three-digit
  milliseconds. Both strings must be exactly equal. Origin is fixed to
  `http://parity.local`; the collector must use it for both request environments.
- Case IDs are 1–80 ASCII letters/digits/underscores/hyphens, beginning with a
  letter/digit, and are unique. `bodyFile` must be precisely `<id>.body`.
- Requests are exact origin-relative `/api/<known-name>.php` paths with optional
  query text, capped at 4096 characters. Query order/encoding is not rewritten.
  Absolute URLs, path normalization/traversal, encoded paths, fragments, control
  characters and unreviewed routes are refused. GET is implicit; there is no
  caller-supplied method/header/auth option.
- Case order may differ, but the case-ID/request pairs must match exactly.
  Status must be an integer from 200–599; every redirect status 300–399 is refused.
  Each body is verified against its declared SHA-256 before comparison.

Manifests are consistency/integrity evidence, not signatures. The comparator can
detect a mismatched source declaration or a modified body that no longer matches
its hash; it cannot authenticate a collector or detect two coordinated changes
to both manifests and their hashes. Retain the independent approved artifact
checksums, capture logs and frozen reader revisions. Do not substitute matching
self-declared hashes for actual same-source preparation.

## Exact comparison and limits

JSON media types (`application/json` and `+json`) use a bounded parser that retains
each number's original decimal/exponent token. Thus `1`, `1.0`, `1e0`, `"1"`,
`0` and `-0` remain distinguishable, as do integers beyond JavaScript's safe range.
Object key ordering is ignored; key spelling/case, null, booleans, strings,
array order and array length are preserved. Duplicate decoded keys, malformed
JSON, invalid UTF-8 and unpaired Unicode surrogates invalidate the bundle.
No `meta`, freshness, source coverage or timestamp field is automatically removed.

Plain text, CSV, HTML and other media compare byte-for-byte, including line endings
and trailing whitespace. Content-Type comparison lowercases the media type and
parameter names, sorts parameters and treats quoted parameter values like their
unquoted equivalents. Charset values are case-insensitive; other parameter values
remain case-sensitive. Missing charset remains distinct from explicit UTF-8.
Duplicate parameters or malformed headers invalidate the bundle. A content-type
difference is reported even when the body bytes match.

Limits are 1–40 cases per side, 256 KiB per manifest, 2 MiB per body and **32 MiB
combined body bytes across both sides**. JSON depth is at most 64, with 100,000
nodes per document and 500,000 across the pair including manifests. At most 100
diff entries and 256 characters per reported path are emitted. The total mismatch
count still includes omitted entries; missing subtrees count as one missing-key
difference, and array length differences count once plus differing shared elements.
Limits fail closed; truncated evidence never receives an equal result.

Reviewed intentional differences, including PHP versus JS number formatting or
absent versus explicit charset, remain visible. Record their exact scope/reason
in a separate acceptance decision; this tool has no generic ignore-field switch
and does not silently rewrite raw captures.

## Preparing same-source evidence

The separately reviewed collector/lab is responsible for these prerequisites:

1. Verify the already approved local artifact checksums and import scope. Copy
   them to private immutable lab intake before validation/import; document any
   overlapping tables and import order. The guarded Laravel importer remains
   unchanged. Never import approved replacement dumps into the shared preview.
2. Prepare isolated legacy and migrated copies from those same artifacts; keep
   all schedulers, workers, providers and mail off. Run readers with restricted
   credentials and isolated settings, not inherited production environment or
   cached Laravel configuration. Freeze Laravel and TS clocks and request origin.
3. Verify source rows before/after reviewed migrations using the original columns,
   byte-sorted row evidence and explicit type normalization. Preserve IDs, history,
   nulls and exact timestamp meaning. Expected DDL additions/type widening are
   tracked separately; a source mismatch stops acceptance.
4. Capture a bounded explicit GET case manifest from both frozen readers. Save
   exact response bytes before computing hashes; record the reader revisions and
   source evidence. Capture is not implemented by this comparator and its success
   does not imply these prerequisites have been performed.
5. Run the offline comparison, review every mismatch and retain the independent
   decision/coverage record. Recapture after any relevant reader code change.

Historical slices can validate represented old records and known edge cases. They
do not prove current production completeness, source freshness, production-size
latency/memory, upstream exporter deployment, configured OAuth or writer handoff.
The existing backup drill and runtime handoff/rollback plan remain separate.

Focused verification: `node --test tools/parity-compare.test.mjs`. Tests use private
temporary synthetic bundles only, cover all route allowlist entries, numeric
precision, tampered evidence, bad paths/files, clock/source mismatches, redirects,
oversized/deep/node-heavy responses, bounded diagnostics and CLI exit codes.

## Executed historical slice — 2026-10-12

The two approved 2026-05-24 artifacts in the root [dump register](../../docs/legacy-inventory/db-dumps.md) were copied to private intake and their SHA-256 values verified. The existing guarded Laravel importer previewed and imported the live slice first, then the AI slice, into two fresh MariaDB containers on separate internal-only networks. The live slice contains 50 table schemas; the AI slice replaces its four AI tables. Neither shared preview/test data nor production was imported or modified.

The original 50 tables contained **298,991 rows** in each copy. Original-column, UTC-session, query-visible field-byte fingerprints matched between copies and remained unchanged after the TS copy applied identifier collations, local schema supplements and all 14 reviewed platform migrations. Sorted per-row hashes preserve duplicate rows and nulls. Twenty-seven original table definitions changed as expected from collations/widening; additive tables were recorded separately. This proves preservation of these query-visible historical values, not physical storage identity or compatibility with every deployed schema.

Both readers used SELECT-only accounts (global USAGE and schema SELECT), disabled providers/schedulers, fixed origin `http://parity.local` and clock `2026-05-24T00:00:00Z`. Laravel ran through its HTTP kernel with array cache/session, null queue, disabled mail, empty cached configuration and masked `.env`; its HTTP facade rejected stray requests. The network denial probe used a documentation-reserved address. TS used Fastify injection from the frozen image plus a fingerprinted API source overlay. The actual Laravel source/vendor hashes were checked before/after capture, and TS source hashes were checked around capture. No remote HTTP capture or provider request was submitted.

**All 36 legacy API routes were captured once on each side, all HTTP 200.** Strict offline replay reports 4 exact matches and 32 different responses, with 43 explicit differences:

- 32 JSON responses add `charset=utf-8` to the same `application/json` media type.
- 8 cache responses add `meta.cache_window:null`, explicitly saying the historical window lineage was not recorded.
- `group_view.php` replaces the obsolete Laravel `cache_builder: reports:group-view:build` instruction with `cache_strategy: dynamic-tag-date-projection` and `projection_complete:false`. This case has no available group metrics.

After the safe-count wire-type correction, there are no other differences in these cases. The comparator still exits 1 and retains the raw diff; the separate reviewed disposition checks each exact path/value and does not rewrite captures or ignore arbitrary metadata. Raw response sizes total 4,417,055 bytes across both readers.

Positive source coverage includes live-day/hour/date/list/CSV, a recorded live-tag cache, tag lists/index, channel/video lists, video tag matching and three AI endpoints. Comment/duration/photo and several cache/history surfaces have only empty/unavailable or derived-shell coverage in this old slice. A nonempty shell or HTTP 200 is not evidence of measured data. Case-level `available`, result shape and empty-contract notes remain in the private disposition; this is not all query permutations or complete nonempty coverage of 36 routes.

The comparison exposed safe BIGINT counts serialized as strings after TS schema widening. Legacy raw channel/video/TVBS count columns now use a per-table allowlist and BigInt range check: safe integers serialize as numbers, nulls and all other fields remain unchanged. Values outside JavaScript's exact range retain their original strings; their wire-type compatibility remains outside the parity claim.24 focused pure/HTTP regressions cover these boundaries.

Evidence is ignored/private under `.local/historical-parity/yt-parity-a1eceee8/`: paired manifests/bodies, `comparison.json`, `disposition.json`, artifact/import metadata, code fingerprints and before/after source fingerprints. The `first-ten/` checkpoint is retained separately. Capture helpers remain with that local evidence; the committed tool is the network-free replay comparator. No raw historical payloads are included in review packets or documentation. Keep these captures for the release review, then remove them; the original approved intake artifacts remain unchanged.

Cleanup is complete: the four isolated lab containers, two internal networks, two anonymous database volumes and two lab copies of approved dumps were removed. Original intake checksums were reverified; private capture evidence remains available for offline replay. `cleanup.json` records the exact resources. The final comparator, including strict raw HTTP-status token validation, still reports the same 43 differences.
