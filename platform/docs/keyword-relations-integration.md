# Y2 relations integration (source preparation)

This is an offline integration, not activation or deployment evidence. The
upstream reference is `tag-f1-release` commit
`b8d030c747f87c997800371e33e1ab2d168ad257`,
`app/src/v1/openapi.ts` SHA-256
`8d020d20cc23e62ef0170144a363c1fe0c68ef5da42ad5610fa8a9f6713849a1`.
The upstream endpoint has not been verified as deployed during this freeze.

Offline source audit on 2026-10-13 (GPT-6.1 Sol) compared the retained upstream
commit `48bc174bbcddaa3f84d8da65024e328a0b2abc71`, rather than assuming the
earlier `08f42aa` checkout was still current. Its tracked OpenAPI and relation
sources matched that committed tree; unrelated untracked Mint tools were not
contract inputs. The current OpenAPI SHA-256 is
`29c959bca8498ddf1eeb0bc07b693e403634682d7f7e3cee04302a259a237862`.
The original `b8d030c` pin and hash above remain the historical integration
reference. The response fields and route are compatible with the adapter;
the newer source explicitly caps all classification, ancestor and submitted
rows together at 200, with depth at most 8 and truthful `truncated` metadata.
This comparison does not establish the deployed upstream contract or authorize
activation, a build, capture, migration or credential change.

Three added offline API mock contracts cover the 200-row/depth-8 partial
projection with all relation types and inherited origin IDs, exact once-only
UTF-8 encoding (including slash, percent, emoji, distinct Unicode spellings and
literal `group:N` tag labels), and a valid-shaped 200-row multibyte response
above the unchanged 128 KiB client budget. The oversized response stays
`unavailable` through `response-cap`, rather than becoming an empty success;
the 200-row limit alone does not guarantee a small byte payload. The focused
client and route suites passed 58 tests with one worker at nice 19. These are
mock/source checks, not upstream requests or UI acceptance; the runtime flag
remains disabled. The immutable private audit receipt is
`/home/deck/.cache/youtube-ui-review/f2_visual_sol-2026-10-13/y2-contract-audit-20261013T0750Z.json`.

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

## F1 public activation successor — 2026-10-14

Babysit reports upstream APPaff5c028 / BUILD_IDd1LVsC3sk6p04uOyWUx5T
switched13:46UTC and verified1280/390/GA0 at13:58. Actual DNT1/GPC1
GET at13:59:35 returned柯文哲→政治人物 and public,max-age=60. Retained
receipt `/tmp/babysit/mint-queue/youtube-live-f1-contract-20261014T135936Z.json`,
SHA256e931ebf95486fe505a1ac0ef0422b9f0494bcb06f8ed02e9fa68a9d680c20875.
Historical offline contract pins above are preserved rather than rewritten.

YT current deployed image has no relations flag or tag credentials configured.
For this published public read, explicitly select TS_TAG_RELATIONS_ENABLED=true
and TS_TAG_RELATIONS_AUTH_MODE=anonymous. Default mode remains service; missing
service credentials still fail closed and invalid modes do not contact tag.
Anonymous mode never reads/forwards credentials, adds DNT1/Sec-GPC1, respects
429/body/time/concurrency bounds and only reuses upstream explicitly public
responses for at most60seconds. Downstream enabled DTOs remain private,no-store
even in anonymous mode, preserving existing credential/privacy boundaries.

All three relation types stay visible: successful empty types say 尚未收錄;
missing types in a truncated response say 本次未取得（來源結果不完整）.
This source change is not yet built or deployed; image integration follows.

### Maintained tag pictures

`GET /api/v1/keywords/:keyword/illustration` reads public person/avatar metadata,
then nonperson visual metadata only after a successful empty person read. The
DTO keeps only maintained image kind/label, a same-origin image path and original
page/author/license links; all extra fields are dropped. Missing images say
「尚未收錄」; timeouts, malformed data and upstream errors remain unavailable.
Person/visual/emoji kinds do not change vocabulary, IDs, match counts or aliases.

`GET /media/tag-illustrations/:keyword/:kind/:revision` fetches only the fixed
tag avatar/visual-image endpoint for that exact keyword/version, using YT red.
No user-supplied host/URL, redirects or visitor credentials are accepted. The
browser never contacts tag for image bytes; CSP does not gain external origins.
Both metadata and image responses remain private/no-store; there is no disk
cache. Only anonymous upstream responses explicitly public and without
Set-Cookie may be reused in a32-entry memory cache for at most60seconds
(maximum about16MiB raw bytes). The two upstream slots remain occupied by
abort-ignoring work until it settles. Each read has a3-second hard deadline,
128KiB JSON/512KiB image cap and upstream429 cooldown; no automatic retries.

WebP requires RIFF/WebP framing and declared length. SVG is parsed and rebuilt
from a restricted inert-shape/attribute set, rejecting scripts, entities,
foreignObject, links, styles and resource URLs. Served SVG also has sandbox CSP
and nosniff. Unsupported source shapes degrade to an unavailable image, not
false absence. UI includes image source and supplied author/license attribution,
escaped as text, and safe HTTPS source links. This does not claim images or
licenses are newly created/verified by YT; tag remains their authority.

Candidate acceptance still needs actual keyword pages with a known image and
with missing data,1280/390 light/dark, observed Google0/DNT and private/no-store
checks. Home/top40 pool correction is a separate pending upstream contract.
Source tests are not candidate or formal-site visual acceptance.
