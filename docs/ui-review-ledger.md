# UI review ledger

目前來源清單（凍結期間更新）：**351 route templates／622 entries**，其中
**376 UI entries（110 routes）**：歷史review25筆（24 issues、1 static-only pass）、
未review351筆；另246筆`n/a-ui`。**完整UI route完成0，下一候選376筆全部待重拍。**
新增Y2狀態與admin介面尚無截圖／runtime證據；`/manage`由舊redirect改為
待review的管理入口，因此不再列為non-UI。下文344／591等數字為歷史批次，
不代表本次總數。所有既有review只適用其原SHA。


`ui-review-ledger.json` is the route/state inventory and evidence ledger. Generated
inventory starts **pending** and is not a visual review. `summary.uniqueRoutes`
counts URL templates; `summary.reviewEntries` also counts distinct required states.
`kind: UI` covers HTML pages; `kind: nonUI`, `state/status: n/a-ui` covers
JSON/PHP APIs, redirects, RSS, sitemap, metadata, images and operations. Non-UI
rows link actual contract test source; that link does not claim the test ran.
UI-only pending/reviewed counts exclude those responses.

Review each public, admin and error route at 1280px desktop and 390px mobile,
against the relevant live `tag.observe.tw` surface and the cached reference
repository. Dynamic templates require a real public example plus separate
abundant, sparse, empty, error and denied states where applicable. Explain an
inapplicable state explicitly; never turn missing evidence into a pass.

Each reviewed entry records the reviewer/model, actual deployed SHA, timestamp,
private desktop/mobile screenshots, reference URLs/screenshots, deviations,
findings and private per-page review transcript. A fix needs its commit and
fresh retest SHA/screenshots. `issues` means observed findings; `fixed` means a
fix exists but review still needs resolution; `pass` requires actual complete
evidence. Undeployed frontend changes remain pending.

Acceptance screenshots must come from independent Playwright, using fresh
anonymous contexts, `DNT: 1` and `navigator.doNotTrack = "1"`. Install GA/GTM
network blocks before navigation and assert zero outbound analytics requests.
Earlier collaborative-browser screenshots are observations only and cannot
count as acceptance. The reviewer must actually view both screenshots and the
tag reference screenshots. Implementers cannot self-review their UI changes.

Screenshots and transcripts belong outside git in a private directory. Do not
capture authenticated names, email, pictures, tokens or admin account rows.
Anonymous gates do not establish authenticated admin/account acceptance. Use
existing authorized permissions or non-identifying approved fixtures. Keep
analytics guards/DNT intact; navigation is observational, without synthetic
analytics, DB writes, deployment or infrastructure changes.

The public homepage and event-list routes map to `/render-isr/...`; filtered
reports map to `/render-filtered/report/...`. These internal renderer paths are
explicit exclusions, blocked by the public gateway, and never count as reviewed
public routes. Review the mapped public URL, including its query state.

Inventory includes Laravel compatibility/admin declarations because `/ops`
still routes to the retained Laravel service. Source declarations do not prove
that an endpoint is publicly exposed or currently deployed: resolve exposure
and record it during review. API, metadata, redirects and non-GET operations
retain `n/a-ui` rows with their relevant contract test source;
do not execute production mutation merely to satisfy the ledger.

Current recorded production reviews: **25 route/state entries**: 24 with issues,
1 **static-visual-only pass** for production channel407's real example. Login,
interactions and other data states remain pending; the route is not complete.
Twenty-two cover
full-page visuals; three are partial first-viewport issue reviews. **325 UI
entries remain pending**, alongside 241 `n/a-ui` entries. Two keyword and two
live entries include actual returned Claude Opus5.5 text from two fresh review
instances; seven include GPT-6.1 Sol findings from the first reviewer; fourteen
include actual second GPT review text and388 personally inspected image hashes, including the complete method
reference.
Captures alone never increase this count. `reviewExtent` distinguishes full
visual scope from partial findings. Unseen interactions/states and candidate F2
remain pending. `/groups/media/live`404 is an error-state issue review; its
populated real-example row remains pending. Fullpage lazy-image limitations
are documented without inventing asset failures.

Inventory reconciliation: 344 distinct route templates, **591 entries = 350 UI
+ 241 non-UI**. The initial 591-entry inventory gained one `/events` **empty**
state because the public registry is actually empty; its original default row
remains pending. Exposure inspection then replaced two incorrect `/manage` UI
states with one `n/a-ui` redirect row: actual anonymous GET returned307 to
`/manage/editorial`, matching the Next redirect source. The destination has its
own UI entries. These two corrections net to the original total entry count
while changing its UI/non-UI split. All summary counts derive from the entries.

Actual live report tables now have16 supplemental, personally inspected start/
middle/end and vertical-mid screenshots across both widths. Header position
follows below the site header; the leading column remains fixed. The computed
shadow is present after horizontal scrolling but visually subtle. These checks
do not resolve the title/metric findings or prove tag reference interaction parity.

Capture batches going forward log uptime and tag/blog/YouTube homepage TTFB
before and after, with at most two shared capture browser instances and one
Next/Docker build. Pause captures when one-minute load exceeds12 or blog
homepage **totalSeconds** exceeds2seconds, or a timeout/unknown/5xx occurs.
TTFB is recorded for diagnosis only and cannot pass the gate. Earlier completed batches lack those timing
measurements; none are inferred retrospectively.

Presentation comparison uses the shared tag typography, spacing, surfaces,
table tokens and interaction patterns. Red links, active controls and accent
marks identify the linked YouTube product in the corresponding component
positions; red branding alone does not justify other presentation differences.
Each retained difference needs concrete route-specific evidence. Fixes require
fresh independent review at the actual new SHA; old screenshots are never
relabeled as retests. No UI route is completely accepted across its states.

Candidate F2 source5f5566b has20 captured viewport pairs:14 candidate pairs
and6 live-reference pairs. Two independent GPT reviewers returned actual
ranking/vocabulary/evidence findings, with74 and257 inspected image hashes.
Candidate rows do not change the production25-reviewed/325-pending counts.
Full ranking and light evidence review scope, selected dark interiors and
remaining interactions are distinguished in the private reports. Fixes and
the final core canary remain pending at their actual new SHA.

A separate7f1b5db source-image check found the「成功」row's canonical YouTube
thumbnail404 at both the original source and optimizer. The SVG fallback is
recorded as fallback, never real image acceptance. Other lazy placeholders
are not automatically classified as failures.

Final candidate729bcf78f6218851dee7757fb5ca9be0042c44ce is recorded in a
separate batch with parent-verified image/build provenance. Its completed25
viewport pairs comprise14 fresh core candidate pairs,10 fresh reference pairs,
and one preserved mixed-window homepage observation. The latter is superseded
by a fresh pair with both period controls explicitly selected and asserted.
The core reviewer personally inspected226 hash-verified images, including all
core fullpages/readable slices at both widths and themes and the matching
ranking reference for mayor. Mobile channel names and video/live identities
remain blockers; homepage sidebar wrapping and secondary-text contrast remain
follow-ups. Mobile auxiliary fetch503 is preserved even though primary
navigation returned200. Its cause and prefetch classification remain unproven.
No whole-route or interactive pass is claimed.

The14 final keyword/evidence pairs remain pending while the shared capture gate
is unhealthy. At20:36:21UTC it rejected before browser launch at one-minute
load22.77 and unhealthy blog timing; no capture browser was running. Important
isolated empty/error fixtures are separate, explicitly synthetic states and
cannot establish production data acceptance. Fresh screenshots resolve only
the state and SHA actually reviewed. A new frontend fix requires new captures.

Further captures of729bcf7 are held while the implementation owner prepares a
new SHA for the core identity and mayor-coverage fixes. The next failure capture
will record only the agreed sanitized request-header allowlist and safe error
code. Existing captured states cannot carry acceptance onto the new SHA.

The second final-candidate reviewer supplied285 personally viewed, hash-verified
images:112 reference images,152 selected candidate images, and21 private
empty-fixture images. These overlap the core review and are not a count of285
new route reviews. The mayor report has a P1 rolling-coverage finding: October
10/11/12 have27/23/19 observed category-day buckets out of28, yet solid chart
points and latest-value cards lack nearby partial-coverage encoding. October9
Guo's zero is observed at28/28; it must remain distinguishable from an incomplete
zero. The implementation owner is preparing a fix. Empty today/week ranking
and vocabulary light fixtures render gracefully, but remaining empty/error
states and every new-SHA renewal are pending. The fresh method-reference
captures have not been counted as personally reviewed by this ledger reviewer.

The654cdf5 artifact and core HTTP canary are verified. Both initial capture
attempts failed the shared performance gate before browser launch, then an
operator disk freeze held capture work. The user subsequently clarified that
offline review and small captures from the existing candidate/release are
allowed. Builds/images/layers, new containers, release copies, deploy and large
exports/artifacts remain prohibited; explicit解除 is required for those actions.
Small batches must be estimated at100MiB or less and preserve at least112GiB
available under/home, checked before each item/screenshot/write and afterward.
The shared two-browser/load12/blogTTFB2s guards and DNT/analytics assertions
remain mandatory. No old image is relabeled as654 acceptance.

At21:31UTC available/home space measured121,717,944,320bytes (113.359GiB).
The first six core-light pairs use a35.219MiB estimate, based on15.609MiB of
actual equivalent729 PNGs, multiplied by2 plus4MiB metadata margin. The private
runner logs disk bytes before/after every write and enforces a100MiB batch cap.
Fresh actual screenshots and independent review receipts are required before
any fix is marked resolved; the first pair alone cannot clear all home503 states.

During the freeze the second reviewer added36 personally inspected old729
mayor/Taipei dark images, bringing that existing index to285; all72 mayor
images are now covered. A separate44-image Taiwan-reference receipt retains
the original20:30/20:32UTC capture times. These existing-image reviews generate
no new PNGs and add no654 candidate acceptance. Both receipts were hash-verified.

Fresh654 core-light capture completed six pairs. The core reviewer actually
viewed and hash-verified89 candidate images plus12 original-timestamp tag
references. Home Today/Week light density and channel/video light identities
receive limited static acceptance at1280/390. LIVE390light remains a blocker:
channel-first lead text leaves same-channel titles indistinguishable. Source-only
follow-up changes cannot resolve the deployed654 evidence. Dark, mayor and full
interactions remain pending; no complete route or candidate approval is claimed.
Both654 light home states had no recorded HTTPerrors, without establishing
the cause or clearance of old503 bursts across every state. Production counts
remain25 reviewed,325 pending and0 complete UI routes.

The later user clarification raises the available-space guard to112.5GiB and
caps all new654 candidate plus fixture artifacts at300MiB combined. Any site
5xx, unknown response or timeout pauses capture, alongside load12 and blog
TTFB2seconds. The own dark capture runner was interrupted before completing
its first pair when this update arrived; partial files were preserved. The
runner now applies the stricter guard before resumed priority captures. Existing
new images captured since21:33UTC remain valid evidence for offline review.

The ledger reviewer personally viewed19 fresh ranking-light images and3 actual
original-timestamp tag reference images. Week ranking static presentation is
accepted within those images, including required null-total plus known-subtotal
wording and truthful success-thumbnail404 fallback. Today default shows an old
04:54 degraded200 page with no ranking; it remains a blocker. Later healthy API
reads do not prove the underlying timeout cause or renew cached-page acceptance.
The300MiB capture budget excludes the preexisting199.6MB fixture release; only
new screenshots, slices, manifests and diagnostics count. No release copy was
made. A stalled dark pair has preserved partial PNGs and no complete manifest;
a uniquely named retry avoids overwriting that evidence.

The second reviewer returned a132-image fresh654 receipt. All hashes verify;
together with the core reviewer and overlapping ranking review there are202
unique actually inspected candidate images across12 light pairs, not202 routes.
Mayor and Taipei light partial/hollow/dashed and true-zero encoding is accepted
only within the pictured static scope. Sequential widths have differing source
update times, so they are not a simultaneous data snapshot. Vocabulary retains
raw media IDs as a P2 readability finding. Empty/error and mayor null/zero/
missing/partial synthetic fixtures, dark themes and full interactions remain
pending. The two blockers are LIVE mobile identity and Today default degraded
ranking. Capture is held after the112.5GiB disk assertion; a subsequent reading
was111.027GiB. All existing files remain preserved. Auxiliary response-body
waiting is bounded5seconds and timeout means unknown diagnostics, not clearance.

Latest core receipt contains89 candidate and12 reference images; its added19
mayor images overlap reviewer2, so the combined unique candidate total remains
202. Source-only working-tree fixes are now recorded: LIVE lead keeps avatar
and original title with the channel in its own column; cached home rejects
unavailable exploration sections, and API partial200 uses private,no-store.
Opus returned actual author text for both frontend changes. The read proof
contains14 API and6 table-layout test passes; parent additionally reported20
focused web passes, with typecheck still in progress. No build, commit or deploy
is claimed. Both654 blockers remain open pending an actual new build/SHA and
fresh independent visual review; source changes are never marked fixed/pass.


Source-only follow-up: parent executed API 14 / web 20 focused tests and both no-emit TypeScript checks; all passed. Independent seven-file code review returned without blocking code findings: `/home/deck/.cache/youtube-ui-review/ui_core_review-2026-10-13/source-review-seven-files.json`. No build, new image, commit or deployment. `654cdf5` LIVE/Today issues remain open; this does not replace fresh new-SHA screenshot review.


Operator hard stop (latest instruction): no new capture, even if capacity/load later recover. Only existing-image offline review and small code/document edits; no builds, exports, large writes, deletion or tag-backup changes. Incomplete dark files remain retained and do not establish a complete capture pair.


Offline evidence reconciliation: all **224 existing PNGs** now have actual independent image-review receipts (202 in complete light captures,22 in incomplete dark files). Index: `/home/deck/.cache/youtube-ui-review/ui_ledger-2026-10-13/candidate-retest-654cdf5/independent-review-index.json`. The original capture-time `reviewed=false` fields were not rewritten; the index links later returned reviews and exact input hashes. No complete-route pass follows from image review alone.

Contemporaneous DNT/analytics fields do exist under each `viewports.desktop.analytics` / `viewports.mobile.analytics` and `dom.dnt`: DNT1 and zero matching request/response counters. No GPC value, HAR or complete request list was retained. Full **zero-GA 未證**; no retrospective network log was fabricated. The old `assertedZeroOutbound` flag is historical script output with these evidentiary limits.

Performance policy now checks blog **totalSeconds ≤2**, not TTFB alone, and stops on any site5xx/unknown/timeout. The original20:56timeout already recorded `allowed=false`. Historical gate rows are preserved. The helper now has an explicit operator hard-stop flag and does not even run probes while stopped; no new capture is authorized.


Latest 654 offline follow-up: no new capture, build, staging, probe or deployment is authorized. The local Today fullpages and 14 slices are pixel-identical in corresponding regions (receipt: `/home/deck/.cache/youtube-ui-review/ui_core_review-2026-10-13/offline-today-light-consistency.json`); the external 0550 input is unavailable, so its finding remains unresolved. Browser period switching remains pending.

Support-page root cause is established: full-history coverage deliberately omits several counts, while the result total is 1,137 and actual videos are present. `KeywordEvidenceNotice` defaults to misleading empty-list wording. Receipt: `/home/deck/.cache/youtube-ui-review/ui_review_2-2026-10-13/654-keywords-offline-findings.json`. Data-aware wording and mobile channel identity fixes are source-only.

Ranking evidence establishes Today unavailable versus Week populated and a code path allowing semantic partial HTTP200 into shared HTTP/ISR caches. It does **not** establish the original upstream error or that cache caused this particular captured difference; displayed data timestamps are not screenshot times. All new source fixes require new-SHA independent visual/interaction review. **zero-GA 未證; zero complete-route passes added.**


Offline source follow-up completed by Opus5.5 (sessions `957cc7ee-9004-4e52-bec5-b1b2a911ad4a`, `9af3e6f8-8a3e-436c-b366-5360f0e8abc9`): data-aware keyword notice and empty-pagination message; mobile channel names wrap, selected metric follows identity; period markers limited to controlled regions so caption/method DOM spacing is preserved. Parent ran **34 focused web unit tests, all passing**. Independent GPT-6.1 Sol source reviews returned no blocking findings, with all ten current source hashes checked: `source-review-opus-first-batch.json` and `source-review-opus-marker-final.json` under `/home/deck/.cache/youtube-ui-review/ui_core_review-2026-10-13/`. Source-test proof: `platform/.local/f2/offline-findings-tests-proof.json` (private, untracked). No stage/commit/build/capture/probe/deploy, no new whole-route pass. Exact new-SHA browser review remains required.


External 05:50 review original received and read: `/home/deck/.cache/youtube-ui-review/root-candidate-visual-review-0550.json`; SHA-256 `7317bfc8ab304489eeab7b9e2bb33285de6e4911b2a2bb478a2c70ded186ad92`; model `GPT6.1Sol`; reviewed `2026-10-12T21:51:30.193630+00:00`; source `654cdf5c9829f2a5f884b063b117e6f6e0403e34`; BUILD_ID `2FFvSyVcDfwEmllyRVVv1`. The earlier note that this report was unavailable is now superseded; the original is unchanged. Its **4 routes / 10 findings and observations / 5 prioritized issues** are individually mapped in JSON `externalReview0550.pages`, with the exact reviewed and unreviewed states, source paths, references and remediation.

| Finding | Current disposition |
| --- | --- |
| F0550-HOME-01: Today fullpage/slices mismatch | Capture-source safeguards implemented; artifact hash reconciliation in progress; no browser clearance. |
| F0550-HOME-02: desktop sidebar keyword wrapping | Open; exact654 source already contains nowrap/ellipsis rules. Investigate artifact/CSS association before further layout edit. |
| F0550-KEYWORDS-01: unavailable Today ranking | Partial HTTP/ISR cache prevention source fix tested; populated Today evidence and initial source failure still pending. |
| F0550-SUPPORT-01: empty warning with 1,137 matches | Data-aware wording and pagination source fix tested; fresh visual review pending. |
| F0550-CHANNELS-01: clipped identity/wrong first metric | Mobile name wrapping and active metric prioritization source fix tested; horizontal scrolling/visual review pending. |

**Original identity limitation:** Every selected manifest item has exact submittedSHA/frontendBuildSourceSHA/buildID. Image identity remains parent-supplied manifest metadata; screenshots do not independently prove package/runtime identity.

**Original review limits:** Only existing PNGs and two manifests copied locally. No new remote screenshots, browser actions, builds, tests, source/official ledger/backup/disk mutations. Full tall images were downscaled by viewer; precise top/source findings use original existing viewport slices. No whole-route pass. Prior missing-evidence snapshot remains historical, not current.

Every route retains its unreviewed dark theme, live interaction/navigation, loading, authentication, filter/sort/pagination actions and backend-count correctness. `candidateApproval=false`, `routeComplete=false`, all `wholeRoutePass=false`, **zero-GA 未證**. No new capture/build/staging/probe/deployment.


Original 0550 image reconciliation now complete: **38 hashes compared,33 match,5 differ**. Differing files are candidate fullpages: channels mobile; home Today desktop/mobile; home Week desktop/mobile. The references and listed slices match. Each affected page in JSON now records the reviewer-copied-image hash and current local hash separately. No cause is inferred; current fullpage files are not substitutes for the original review inputs. Receipt: `/home/deck/.cache/youtube-ui-review/ui_core_review-2026-10-13/0550-reconciliation-receipt.json`. Both original home findings remain open.

Capture helper now accepts a genuinely empty rendered cloud marker while rejecting hidden or wrong-window markers; **20 offline helper tests passed**. Receipt: `/home/deck/.cache/youtube-ui-review/ui_ledger-2026-10-13/review-logs/capture-coherence-empty-pane-addendum.json`. Hard stop remains active; complete request/GPC evidence remains a pre-resume requirement, **zero-GA 未證**.


Final sidebar source-only cleanup: Opus5.5 session `a91f14ef-322d-47e4-aaf5-afd16c2bd20d` removed the earlier redundant `.rankBody strong` `overflow-wrap:anywhere`; the higher-specificity nowrap/ellipsis rule is unchanged, so this is **not a claimed behavior/visual fix**. Independent source review: `/home/deck/.cache/youtube-ui-review/ui_core_review-2026-10-13/source-review-home-css-cleanup.json`; source hash verified. The original external P2 remains unresolved. Frozen-batch result:34 focused web tests and20 offline capture-helper tests pass; original review mapping/limits validation passes. No build, staging, commit, new capture, probe or deployment. Ledger still344routes/591entries;25production entries reviewed,325UI entries pending,241non-UI; **0 complete UI routes**. Candidate source reviews are separate and do not promote any status.


## 附錄：06:20 首頁期間獨立複查（取代 05:50 的期間描述，finding 維持 open）

原檔：`/home/deck/.cache/youtube-ui-review/root-period-reconciliation-0620.json`。SHA-256：`49259a5aa628287ba3428c158bc563def4d997c4ee87965853c8c88e5f3c1945`。Reviewer/model：`GPT6.1Sol`；UTC：`2026-10-12T22:20:36.001520+00:00`；受審 SHA：`654cdf5c9829f2a5f884b063b117e6f6e0403e34`；BUILD_ID：`2FFvSyVcDfwEmllyRVVv1`。原始 05:50 報告與截圖保留不變；JSON 同時保留其歷史文案 `original0550Finding` 與本次更正。

`F0550-HOME-01` 的精確描述：原『今日』手機 fullpage（`88add932…`）內，文字雲選擇器是『今日』，排行選擇器是『近七日』，更新標示為04:18；原『今日』分段截圖的兩個選擇器都是『今日』，更新標示為05:30。因此是**原始截圖內及 fullpage／slices 之間的期間矛盾**，不能說整張都是近七日，也不是已證實拿錯檔，更不能推論目前 runtime 仍有同一錯誤。

下列五組不同 bytes 由既有 receipt 記錄；原審查 hash 與本機 receipt hash 分列，差異原因仍未判定。檔案所在目錄為 `/home/deck/.cache/youtube-ui-review/ui_ledger-2026-10-13/candidate-retest-654cdf5/`；完整路徑亦存於 JSON `periodReconciliation0620.fiveHashMismatches`。

| 檔名 | 原審查保存的 SHA-256 | 本機 receipt 的 SHA-256 |
| --- | --- | --- |
| `channels-light-mobile.png` | `3f57dfa02565a3c80c9505af0655d908d3927fdbc23b73d16d979dc263282cf2` | `4927eca00a85d692664d7f0d1f6eaed555e79d03b6de120d81535ed1d10aec54` |
| `home-today-light-mobile.png` | `88add93249a0a0be0db2880ded7f3e4cc9d57b88e1d674cbc31b877f99c64c4f` | `f76aca31c3db7e73f61929e90a52ab1a0cfa1020ae1596cc56b85b82cc9c4d1e` |
| `home-week-light-desktop.png` | `d683096f382820ef8f382f527a268f50bae753ff8a3c7e862dfb1a14e4e945ae` | `a3742883927f14b189fbf8a7eb6cfed0eb4a5ce49e0878f8949804177bd59edb` |
| `home-week-light-mobile.png` | `d7a77fdd96b29970d313aedb5c260a71b7d3f96f7ec872e377b08bdfe903bb8d` | `58730c651b446ee127dc8cc36c6151d99940b5f72cf109ade78553326ebe8363` |
| `home-today-light-desktop.png` | `1b4e4004e117b62304294d27836e31559c35e74bad99eeb87572d70899f837ae` | `4aee330ee9a50a6cc400f8eed0947a77d898d5f1c7372ec20b9c898fb66a53ee` |

比對 receipt：`/home/deck/.cache/youtube-ui-review/ui_core_review-2026-10-13/0550-reconciliation-receipt.json`。本機 `f76aca31…` 與原始 `88add932…` 是不同 bytes，**不得拿目前或後來的新圖替代原圖、抹除或直接關閉原 finding**。所有原始 PNG、manifest、review JSON 保留，不覆寫、不刪除。

**關閉條件：** `F0550-HOME-01` 維持 **open／issues**；程式修正與單元測試不構成關閉。須由使用者明確解除凍結後，以修正版本重新擷取、使用獨立檔名保存，再由獨立 reviewer 對照原 finding 確認期間一致，才能關閉。不得只憑一張新截圖關閉。

截圖身分仍取自 manifest metadata，本身不獨立證明 package/runtime 身分。`candidateApproval=false`、`routeComplete=false`、zero-GA 未證；其他 findings 與所有未驗證狀態不變。原複查限制：No browser/capture/build/test/source/official ledger/backup writes. Only read named existing owner receipt remotely; original local images and0550 JSON unchanged. Small local derived inspection crops and this new audit.

本次操作僅讀取既有證據並修改 ledger Markdown/JSON；無建置、新 capture、probe、staging、部署或截圖變更。


## 附錄：06:40 深色模式證據 audit（四個 route 全部 missing／pending）

原檔：`/home/deck/.cache/youtube-ui-review/root-candidate-dark-review-0640.json`。SHA-256：`751f7c1a42c67545ed0a893d1ba2a51415f5983727e2cc1d98bd8b7d589c2e1b`。Model：`GPT6.1Sol`；UTC：`2026-10-12T22:40:06.349876+00:00`。本次 audit 範圍只有四個 route；要求的候選 SHA：`654cdf5c9829f2a5f884b063b117e6f6e0403e34`，BUILD_ID：`2FFvSyVcDfwEmllyRVVv1`。這是證據清查，audit 未檢視圖片，不是新增視覺驗收。

Manifest：`/home/deck/.cache/youtube-ui-review/ui_ledger-2026-10-13/candidate-retest-654cdf5/captures.json`，12 個項目全為淺色，對應 exact SHA／BUILD_ID 的深色 manifest 項目為 **0**。另外22張首頁深色檔案的 index 明確標為 **capture identity unverified**，無法驗證其確切 SHA／BUILD_ID。早先提到這22張圖已有人做離線 image-only review，只代表看過圖，**不構成654cdf5深色驗收**。

| Route | 深色證據 | 1280桌機／390手機 review | 視覺驗收 |
| --- | --- | --- | --- |
| `/` | missing：22張深色圖身分未驗證 | pending／pending | 無 |
| `/keywords` | missing：無exact654cdf5深色圖 | pending／pending | 無 |
| `/keywords/支持/videos` | missing：無exact654cdf5深色圖 | pending／pending | 無 |
| `/channels` | missing：無exact654cdf5深色圖 | pending／pending | 無 |

舊候選 `729bcf78f6218851dee7757fb5ca9be0042c44ce`（BUILD_ID `plLXEQDQ9IC3eyI7SxLXo`）的深色截圖不能代替；tag參考圖可用也不代表候選圖存在。**不得以22張或任何檔案數計算pass。** 所有原始PNG、manifest、index與audit保留，不覆寫、不刪除。

凍結解除後，須用654cdf5或之後修正的新SHA，重新擷取四個route的1280／390深色畫面；manifest寫入確切SHA與BUILD_ID，再交獨立reviewer對照tag參考圖。現有未知身分圖片不能補標成已驗證；新圖保存為獨立證據。互動、loading、登入與其他既有pending狀態不變。

`candidateApproval=false`、`routeComplete=false`；四個route深色狀態一律missing／pending，整站計數不增加任何pass。本次只核對JSON並修正文檔；凍結仍有效，無新capture、probe、建置、staging或部署。


## 凍結期間既有圖片盤點（任務2）

- GPT-6.1 Sol，2026-10-12T23:03:39.710410+00:00：`/home/deck/.cache/youtube-ui-review/ui_review_2-2026-10-13/offline-ui-task2-inventory.json`；SHA-256 `e0f79c4f654df5600706611242e55d0c97d22ae874031377062b53a3d5224ea2`。
- GPT-6.1-Sol，2026-10-12T23:04:07.257939+00:00：`/home/deck/.cache/youtube-ui-review/ui_core_review-2026-10-13/offline-mayor-taipei-654-light.json`；SHA-256 `ca0c2f6477a4025c2ea03a762d982843d28b5d52c1e84ad60d5e89701ef34cfd`。

指派範圍內尚未review且具候選SHA／BUILD_ID的圖片為0。台北市長頁19張是另一instance的補充獨立對照，全部與既有receipt重疊，因此新增唯一圖片與完整route通過數都為0。缺少確切654身分的深色、互動、loading、登入、篩選／排序／分頁、空與錯誤狀態，以及tag/group/event/AI/admin畫面，維持missing／pending。不能用舊版本或身分未知的圖片補足。

Ledger仍344個route／591 entries，350 UI中25已review（24 issues、1僅static-visual pass）、325 pending；241 n/a-ui，0個完整UI route完成。此盤點不增加pass；零GA外送仍未證。


離線任務1原始碼與測試完成：Opus前端34項focused測試、API三檔25項DB-free測試及noEmit typecheck通過。新增限頻、固定欄位的故障階段診斷，無SQL或原始錯誤；完整追查見`platform/docs/f2-offline-findings-2026-10-13.md`，私有證據`platform/.local/f2/offline-backend-failure-proof.json`。歷史觸發原因未留證仍未知，不冒稱已確認timeout。四個視覺finding仍open，沒有新增SHA視覺驗收。


## 凍結期間擷取工具修正（任務3）

獨立source review：`/home/deck/.cache/youtube-ui-review/ui_review_2-2026-10-13/capture-tooling-source-review.json`；SHA-256 `ce1b9c3682f443f82264bcc0d86b8cd40da86bfb6c202b1d107bdd3f1fc2f3e4`，GPT-6.1 Sol，2026-10-12T23:17:26.832424+00:00。六個最終source hash與addendum逐一核對一致，reviewed scope無未解blocker。

最終hash/test addendum：`/home/deck/.cache/youtube-ui-review/ui_ledger-2026-10-13/review-logs/capture-manifest-privacy-identity-addendum.json`；SHA-256 `6182167513bf72e6f9fa9bf3a891cd0d81659b26f2b287ee53d238030ddd695b`。38項helper測試在最後metadata修正前全過；metadata修正後新增1項regression及3項syntax檢查通過，不宣稱最後hash跑過完整39項。

效能閘門使用blog整頁totalSeconds≤2，遇5xx、timeout、unknown、load>12停止。DNT1、預設GPC、Google阻擋與request lifecycle觀察器在導航前安裝；i.ytimg.com例外只限HTTP(S)圖片。網路紀錄上限512KiB／1500requests，去除query、headers、credentials、IP、raw錯誤；overflow／未配對／inflight／unknown不可驗收。manifest不複製headers或任意options，保留格式驗證過的release身份與公開route；這仍是plan-supplied metadata，不等於runtime證明。

硬停止仍為true。無browser、capture、probe、build、staging、部署或刪除；舊證據未修改，zero-GA仍未證。source review不構成視覺pass或解除凍結。


## 下一候選：待重拍（凍結持續）

原始碼修正提交`b688739`，後續F2狀態／Y2／覆核功能完成後再固定最終SHA。現有350筆UI驗收項目全部新增`nextCandidateReview: pending／待重拍`，下一候選通過數0；歷史25筆review及其受審SHA不改寫，也不轉用為新候選approval。

優先首頁今日／近七日、`/keywords`、支持影片與`/channels`，1280／390與亮／暗都要有圖；再補loading、empty、unavailable、互動／導覽與權限狀態。零值與缺值分開，少筆／多筆各用實際或明示mock場景。新Y2與admin路由加入後同樣待重拍，admin僅既有帳號與權限。擷取前須使用者明確解凍；程式測試/source review不是視覺pass。


## 凍結中已提交的 source 批次（不是視覺 pass）

- `59a7d1b`：Y2 relations adapter/API 與管理員覆核後端。81項相關mock／契約測試、API noEmit通過；116 schema、5 examples驗證，0外部請求。兩功能預設false，migration與grants未執行，決定僅記錄未套用。
- `b0d2762`：F2深色樣式、pending提示與empty/error/unknown狀態。最後修正後44項focused測試、web noEmit通過；此前86項通過屬較早hash，不冒稱完整87項已跑。

獨立source review的model、receipt路徑、SHA-256與提交寫在JSON的`frozenSourceReviews`。F2由actual Opus5.5實作、GPT-6.1 Sol獨立review；後端由Codex實作、actual Opus5.5／另一GPT-6.1 Sol instance review。所有原0550／0620 finding仍open；深色、導航、loading、登入等runtime證據仍待重拍。

- `5d92387`：管理入口與關鍵字覆核介面，actual Opus5.5實作、GPT-6.1 Sol獨立source review；66項mock／SSR／既有邊界測試與web noEmit通過。vocabulary選原始key/version，預覽確認、衝突與不確定結果保留同UUID重試；不宣稱hook互動已經瀏覽器驗證。

- `ba6069d`：Y2可選關聯區塊，actual Opus5.5實作與修正、另一GPT-6.1 Sol獨立review。最終75項focused測試與web noEmit通過，reviewer另跑15項關聯測試通過。未啟用／不可用／空／partial分開、full Retry-After不截短、固定tag origin連結，原SSR影片與證據不等待此區塊。

本次來源盤點固定於`ba6069d1e1430a6a55dfea1a8575f24ff4dd482c`的已提交程式碼，ledger與部署計畫由後續文件commit一併固定；不把尚未commit的worktree當candidate。獨立release-plan review只指出當時UI與文件未提交的發布範圍缺口；UI現已完成提交及各自source review，文件由本commit固定。這是owner逐項對應，不冒稱該plan reviewer驗證過正式runtime。

**接下來仍是待重拍**：376筆下一候選UI項目全部pending，無新SHA／BUILD_ID的截圖。歷史25筆review不變、完整UI route完成0；新F2／Y2／admin source review不能補成視覺pass。解凍必須由使用者明確通知並涵蓋build、candidate staging與capture；單純磁碟恢復或source測試通過都不解除。

已提交樹的補充檢查：`893b2ab`的API與web TypeScript均0 diagnostics。以記憶體中的git HEAD blobs覆蓋14份dirty tracked檔、隱藏5份untracked檔；未修改檔案／建立checkout／emit／typegen／build。收據`platform/.local/f2/committed-source-noemit.json`及source tree IDs記在JSON；仍使用既有安裝依賴與既有Next generated types，不能替代解凍後的正式build。
