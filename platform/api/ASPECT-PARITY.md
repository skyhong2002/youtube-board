# AI aspect comparison parity

The public `/ai/aspects` reader compares existing model output. It never generates analysis, assigns journalist labels or establishes a channel’s political identity.

- Latest nondeleted `aspect` result longer than 10 bytes per active channel with `urt_count` membership. Count flag0 is active; explicit condition shortcuts retain intersecting filters.
- Recursive wrapper keys (up to32), flat lists, grouped objects, Laravel first-existing family precedence and scalar description aliases. Scores use the first numeric alias and truncate toward zero. Unsupported/unsafe/missing scores remain null.
- Legacy balance formula sorts before pagination; internal BigInt preserves exact sums, ties use channel ID. Missing components count as zero only for ordering. Default100/max200, offset supported; invalid query400.
- Metadata-first maximum2000 sources/16MiB, then batches of200. Capacity returns422. A resized, deactivated, deleted or superseded source between selection and fetch is omitted and included in `changedSources`. A same-size modification can be read as current content; publication checks then evaluate its current digest. Category membership is selected at the metadata phase and not rechecked; `sourceBytes` is the selected byte budget, including rows later withheld. This is a bounded live observation, not a transaction snapshot across MyISAM tables.
- Publication uses the shared indexed `publishedChannelAi` guard. Exact pending projections, diverged published outputs and malformed JSON are withheld with separate counts; older versions do not silently replace them.
- Every row links the exact channel analysis PK. Freshness uses visible source timestamps, never scheduling timestamps.

Deliberate differences: deleted analyses are respected; missing scores are null rather than zero; invalid query values are rejected rather than coerced; excessive reads fail explicitly; equal balance has stable channel-ID ordering. There is no production-sized performance or live-production comparison claim.

Validation: offline shape/precision/bound tests and isolated MariaDB ordering, condition filters, pending/diverged output, malformed source and concurrent replacement cases. Actual CLI Proxy Opus review is recorded locally in `.local/reviews/aspects-review.json`; findings and resolutions are in `aspects-resolution.txt`.
