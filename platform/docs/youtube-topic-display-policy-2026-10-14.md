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
supplement, limited to the exact words supplied in that acceptance. Bare
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
is part of this fix. The display version is `youtube-platform-display-v3`;
the matching rule remains `youtube-quality-v2`.

Partial measured views now read `≥1,118.35 萬 次（509 支缺值）`, with an exact
measured subtotal in the tooltip. Compact lower bounds round down, so formatting
cannot overstate the measured minimum. Completely missing measurements still
read 無觀看值; measured zero remains a real zero. The same formatter serves the
ranking table and homepage cloud cards. Deployment and new-image review are
pending; the prior image's static approval does not transfer to this successor.
