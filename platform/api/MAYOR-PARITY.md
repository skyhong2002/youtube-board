# Mayor observation parity

`mayor.ts` follows `App\Services\Legacy\MayorReport` for the fixed historical
22-city candidate configuration, four channel categories (`3/4/5/6`), seven-day
raw positive keyword weights and candidate share of the raw total. It does not
apply political factors or claim polling, support, unique viewers or current
nominations.

- Undated reports end yesterday in Taipei. Explicit `from`/`to` or presence of
  `today` prevents latest-date fallback; empty `from`/`to` are absent.
- If no displayed candidate has a positive value, an undated request retries the
  latest exact-selection cache date for the requested metric. It does not walk
  backward past a pending publication or search unrelated categories.
- After date selection, an omitted/empty metric may fall back from `tags_views`
  to `tags_video` if the latter contains candidate observations. Explicit metrics
  retain their units even when empty. `views`, `tags_view`, `videos`, and `result`
  map to their Laravel metric equivalents.
- Period, unit, fallback reason, observed buckets, incomplete seven-day windows,
  missing/malformed/oversized/changed/withheld buckets and positive-data status
  appear in the report or `meta.coverage`. Genuine `{}` or numeric zero preserves
  observed zero. Missing or invalid payloads remain null (a deliberate stricter
  distinction than Laravel's empty decoder map).
- The scalar-map decoder keeps exact names; it does not reinterpret nested
  envelopes or record arrays. Positive values are summed without rounding, with
  finite/safe-number limits. Percentages use raw candidate sum / all candidates.

Reads select only the latest revision per date/category before transferring
JSON. A request window is at most366 display dates plus6 warmup dates, hence1488
buckets. Each body is bounded to128KiB and each attempted metric/window read to
8MiB. SQL verifies hash, length, mtime and latest revision before body transfer;
publication is checked before/after and lineage/window identity must remain
unchanged. These are conservative reader guards, not a transactional snapshot of
legacy MyISAM data. Broad production-volume SQL performance is not yet measured;
the existing reader timeout still applies.

Unknown metrics and malformed/reversed/overlarge dates return400 instead of
Laravel's silent coercion. Connection failures use the shared503 contract and
programmer/schema errors use500. No production writer or scheduler was changed.

Validation:12 focused pure cases and2 new MariaDB cases, plus13 existing
report-parity cases passed. Two actual Opus5.5 reviews are recorded locally in
`platform/.local/reviews/mayor.json` and `mayor-followup.json`. First-review
findings were fixed with regressions; follow-up found no remaining P1/P2.
The subsequent real MariaDB tests confirmed the payload schema and SQL behavior. Production access was not used.
