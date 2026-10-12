# Authorized stages after the current cutover

The user added these requirements on2026-10-12. Preserve this order: finish the
current frontend repair/acceptance, then individually hand off background jobs
with Telegram last, then implement and deploy the transcript stage to
`youtube.observe.tw`. No change to tag/blog services is implied.

## Upstream vocabulary rate limits

Before enabling sustained upstream synchronization, align anonymous pacing with
tag's60 requests/minute IP quota: default at least1,100ms, bounded429 retry using
Retry-After, resumable failures. Support optional x-api-key from protected env
or file; keyed pacing may be100ms for the separate1,000/minute allowance.
Obtaining a personal tag API key remains the user's choice; anonymous operation
must work. Daily synchronization uses one-day incremental windows; historical
backfill is batched across minute boundaries. Public rendering continues to use
the local published snapshot and never calls tag synchronously.

## Transcript stage

Plan and review the phase before assigning file boundaries. Add versioned TS
schema records for caption, ASR engine and OCR source, language, coverage,
segments/times/confidence/speaker, status and cost. Define provider adapters,
priority queues, daily budgets and bounded retry with all external execution
disabled initially. Acquisition strategy: captions first, ASR next, supplemental
OCR at approximately five-second frame intervals. A caption adapter, if enabled,
must honor the existing quota ledger and explicit execution gates.

Match segments against the locally synchronized tag vocabulary with version and
provenance; return video/term/person/timestamp evidence. Reserve sky-quality AI
extraction for inferred keywords, entities and claims with human overrides;
prepare explicit simplified-Chinese vocabulary correspondence. Never represent
inferred stance as an established source label.

Required UI: video-content tab and timestamp links; cross-video/channel mentions
with title-versus-content distinction; daily coverage/status/source/failure and
budget dashboard; switchable persistence/peak/decay and comment-time burst
estimates, retaining raw negative deltas. Missing inputs show explicit missing
coverage instead of fabricated metrics. Stance comparison is a clearly explained
framework until labeled evidence exists. Reuse the mother site's interaction and
component conventions.

Document caption→ASR→OCR, shared H100/H200, rented/Taiwan academic GPU and Mac
Studio options. Workshop quantities and monthly cost estimates are planning
assumptions, not measured operating budgets. Public default is excerpts and
summaries, with full transcripts private unless the user explicitly changes
that boundary. Back up before production schema writes; test, review and deploy
the completed stage after the current handoffs.
