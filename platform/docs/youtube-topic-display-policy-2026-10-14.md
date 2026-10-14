# YouTube ranking topic exclusions

The 2026-10-14 11:56 UTC production acceptance found 24 bare common words and
three country/city/party labels still occupying the homepage and `/keywords`.
This successor changes the shared ranking display policy, not source matching.

YT first uses the existing tag `isTagNoise` and `no-equal-tags` checks. The checked
tag source is `61fd537c0f8bc91c687ea2fe875cf0bd79215a77`, specifically
`app/src/tag-noise.ts`, `app/src/v1/media-keywords.ts`, and
`app/data/no-equal-tags.json`. The 299-entry no-equal file is byte-identical to
YT's copied file (SHA256 `1316f8e40390dbbf23bed0a382700919340b72f8e71167f37133b86e938734ee`).
Neither that list nor those display-noise rules covers the audited 24 common
words or 中共、北京、烏克蘭. The existing upstream copy's original provenance is
retained; this inspection does not misattribute new exclusions to tag.

`shared/youtube-ranking-exclusions.json` provides a versioned, checkable
supplement initially based on the exact words supplied in that acceptance. Bare
two-character common actions, descriptions, roles and abstract/general concepts
receive `youtube-generic-two-character`; the three country/city/party additions
receive `youtube-country-city-party`. Comparison trims and NFKC-normalizes the
whole term. This is an explicit reviewed list, not a POS classifier or a rule
excluding every two-character word. Further terms require an evidenced policy
change. 沈伯洋、川普、台積電、AI、國慶、雙十國慶、假新聞 and specific compounds such as
烏克蘭戰爭、支持者 remain eligible under this supplement.

Both homepage and `/keywords` already consume the same backend ranking pool;
display exclusion happens before the top-40 selection and metric aggregation.
The original `/vocabulary` pool keeps exact labels, keys, provenance and source
counts, and exposes the human-readable exclusion reason for both embedded and
separately stored snapshots. Matching evidence and keyword evidence pages stay
intact. No vocabulary publication, rematching, DB mutation or writer transfer
is part of this fix. The display version is `youtube-platform-display-v4`;
the matching rule remains `youtube-quality-v2`.

Partial measured views now read `≥1,118.35 萬 次（509 支缺值）`, with an exact
measured subtotal in the tooltip. Compact lower bounds round down, so formatting
cannot overstate the measured minimum. Completely missing measurements still
read 無觀看值; measured zero remains a real zero. The same formatter serves the
ranking table and homepage cloud cards. Deployment and new-image review are
pending; the prior image's static approval does not transfer to this successor.

## Qualified pool and 2026-10-15 refill audit

The primary eligibility source is the complete tag `ranking-pools` snapshot,
category `news`, gate `early`: at least two media each with two distinct articles.
Fetch every page and validate manifest/checksum before applying YT display policy.
Never substitute all article tags or the capped rolling `/ranking` endpoint.

The short window is always **過去24小時**, not calendar 今日 and not an
unlabeled fallback. Both windows end at the same UTC cutoff floored to ten
minutes; short starts exactly 24 hours earlier. Week starts at Taipei midnight
six dates before the cutoff's local date. Publication intervals are half-open.
Homepage, ranking table and evidence navigation show/preserve actual bounds.
A qualified pool does not promise 40 fresh matched YT terms: show actual rows
and coverage honestly, without filling from unqualified vocabulary.

The retained anonymous SELECT diagnostic
`/tmp/babysit/mint-queue/youtube-ranked-pools-querydiag-union-result.json`
contained 10 short and at least 200 weekly matched qualified groups. Its checksum
is pinned in `youtube-ranking-exclusions.json`. The refill audit derives ranking
order from retained heat, video count and group key; it neither crawls nor writes
production data. Audit output:
`/tmp/babysit/mint-queue/youtube-ranked-pools-refill-audit-final-20261015.json`.

Supplemental generic exclusions are exact, observed general actions, abstract
framing or unspecified roles/background; they are not a broad two-character
classifier. The new `youtube-generic-context` reason covers role/context labels,
including 主持人/議員/政府. Exact Taiwan city/county labels and suffix-free forms
come from the existing 22-city configuration, including 台/臺 variants. Observed
country and political-group labels are recorded separately. All raw labels and
match evidence remain available with exclusion reasons. Named people and
concrete topics such as 沈伯洋/川普/台積電/青年/理財/手機 remain eligible, as do
compounds such as 桃園機場/台北市長.

After this supplement, the retained short sample has nine terms and weekly
refill's first40 centers on people, events and topics. TVBS (original rank16),
聯合 (39) and 三立 (81) were approved by the user on 2026-10-15 and now receive
`youtube-source-or-platform`, alongside Yahoo and 合作媒體. Only exact whole
labels (ASCII case-insensitive for TVBS) are excluded; longer subjects stay intact. No screenshot or deployment pass
is asserted by this source/SQL audit.

Ambiguous 巨大 is retained: it can be the Giant company’s named shorthand,
and aggregate counts alone cannot prove an adjective sense. 巨大機械 remains
eligible as a named compound.

The earlier `youtube-ranked-pools-refill-audit-20261015.json` is preserved as
the pre-media-authorization/pre-ambiguity-correction audit, not the final result.
