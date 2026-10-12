# Channel retention contract

The active channel directory and `/channels/:id` profile retain their existing
active-only condition: `flag_del IS NULL OR flag_del < 1`. A retained channel
with a positive deletion flag is excluded from those surfaces.

The eight public historical child reports remain readable for any existing
`urt_channel` identity: `videos`, `comments`, `cloud`, `trends`, `ai`, `ai/days`,
`people`, and `prompt`. Unknown IDs consistently return HTTP 404 before source
report reads. Archival access neither restores collection nor changes publication
guards, source filters, empty-state semantics, write gates, or stored data.

This matches the identity lookup in Laravel's `ChannelVideosReport`,
`ChannelCommentsReport`, `ChannelCloudReport`, `ChannelTrendsReport`,
`ChannelAiOverviewReport`, `ChannelAiDailyReport`, `ChannelPeopleReport`, and
`ChannelPromptReport`: each looks up the channel by `u_id` without an active
condition. The active-only TypeScript profile/directory policy remains an
intentional separate contract. Unknown legacy empty pages become explicit 404s.

`channel-identity.ts` owns the shared bounded lookup and the explicit route set.
The public registration boundary reads identity once and passes optional context
to handlers that need the channel title or previously checked existence. Those
handlers retain a helper fallback for direct internal calls. Identity is observed
at request time; it is not an immutable historical snapshot.

Every successful child response adds these flat fields to `meta.coverage`,
preserving all existing report coverage:

| Field | Meaning |
| --- | --- |
| `channelId` | Requested existing numeric identity |
| `channelTitle` | Current retained title, capped at 256 characters |
| `channelStatus` | `active` or `archived` |
| `channelProfileAvailable` | Whether the active profile is available |

The web archive notice uses this status. Channel-family navigation must suppress
the profile tab when coverage names the same channel and profile availability is
false; all historical child tabs remain available. A channel title must not be
presented as a working profile link solely because historical data exists.

Validation: `channel-retention.test.ts` covers the null/zero/negative/positive
identity boundary, all eight child routes, a single identity read per request,
unknown IDs before source reads, and unchanged directory/profile predicates.
`channel-retention-database.test.ts` passes on isolated MariaDB for null/zero/one
flags across all eight reports, retained video/AI observations, active-only
profile/directory behavior, and unknown IDs. Its inserted identities and source
rows are cleaned precisely; no preview reseeding or production access is used.
