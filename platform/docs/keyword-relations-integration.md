# Y2 relations integration (source preparation)

This is an offline integration, not activation or deployment evidence. The
upstream reference is `tag-f1-release` commit
`b8d030c747f87c997800371e33e1ab2d168ad257`,
`app/src/v1/openapi.ts` SHA-256
`8d020d20cc23e62ef0170144a363c1fe0c68ef5da42ad5610fa8a9f6713849a1`.
The upstream endpoint has not been verified as deployed during this freeze.

`GET /api/v1/keywords/:keyword/relations` defaults to `disabled` without reading
credentials, connecting to a database, or contacting tag. Only
`TS_TAG_RELATIONS_ENABLED=true` enables the adapter. Its fixed upstream is
`https://tag.observe.tw/api/v1/tags/:keyword/relations`.

The adapter reuses the existing assigned `TAG_SERVICE_TOKEN` or token file and
therefore shares that service quota with vocabulary jobs. No new key is created;
it never falls back to anonymous or personal API-key quota. Credentials are
initialized lazily once per process. A failed initialization remains unavailable
until restart; token/config changes require the normal reviewed reload. Inbound
credentials are never forwarded. Upstream redirects are not followed.

Enabled responses, including successful approved relations, are `private,
no-store`: the upstream credentialed cache boundary is preserved. Static
disabled metadata may use the normal anonymous public policy. Credentialed
requests, errors and partial responses retain the global private/error policy.
There is no indefinite request queue: at most two upstream operations, bounded
body/row/time budgets, and a cross-term 429 cooldown honoring the complete
numeric or valid IMF-fixdate Retry-After. Overflowing numeric holds are bounded
at the maximum representable Date and require a reviewed process restart to
recover sooner; concurrent 429 responses cannot shorten an existing hold.
An oversized result is unavailable, not
a purported complete list.

`target.href` is relative to **https://tag.observe.tw**, never the YouTube site.
Only validated tag/group paths are exposed. The client keeps raw source IDs and
approved provenance. `is-a` is directional; `related` is a maintained relation,
not measured co-occurrence; `alias` does not merge identities or matching pools.
Disabled, unavailable, truncated, and successfully empty responses are distinct.
The primary evidence page remains independent of this optional enhancement.

Before activation after the freeze: independently review the new candidate UI
and its states, verify the actual upstream contract using the existing service
quota, and record the release SHA and pinned image through Dokploy. Turning the
flag off is the rollback for new relations requests; existing evidence and
vocabulary source writers are unaffected. No tag source changes are included.

The application accepts 1–60 Unicode scalar keyword characters. The global router
rejects path parameters longer than 240 UTF-16 units with 404 before application
validation; shorter invalid keyword values return 400. Disabled metadata may
remain in a shared cache for its 60-second TTL plus 120-second stale window after
activation; this is not evidence that the flag failed.
