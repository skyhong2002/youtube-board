# UI review ledger

## 解凍後單一候選與重拍清單

操作計畫：[f2-single-candidate-after-thaw.md](../platform/docs/f2-single-candidate-after-thaw.md)。
逐項矩陣：[ui-retake-matrix.json](ui-retake-matrix.json)，由
`python3 platform/tools/ui-retake-plan.py --check` 離線檢查與本 ledger 的一對一覆蓋。
這是待辦清單，不是 capture 或 review 證據。所有截止窗口已取消。SM 不新增 build／capture／restore；名額順序 tag → YT → blog，等待新交接。YT 採 skyhong-blog 原生 arm64 建置／封裝、Mint 只截圖。全站 1 個建置（含遠端）、2 個截圖瀏覽器；完整首頁相對閘門 tag/YT 2 秒、blog 6.17 秒；任一 5xx、未知或逾時、load >12 不啟動。建置開始至少40GiB、執行低於30GiB暫停。精確映像、隔離 API/readiness、executor guard、累計容量盤點未證前不執行。

- 376 個 UI 狀態、110 個 UI route；每項分列亮／暗 × 1280／390，支援的頁面另列今日／近七日。合計 **2,060 個 viewport packages**（一個 package 包含整頁與必要分段），240 項仍需補實際樣本或既有隔離 mock；缺圖、缺權限或缺樣本都維持 pending。
- 初始預算組：首頁與 `/keywords` 各今日／近七日，`/keywords/合成焦點甲/videos` 各今日／近七日，`/channels` 原有期間；7 個完整組、28 個 packages、3 小批（12／12／4）。這些是 source-backed synthetic fixture 計畫，尚無實際fixture收據；沈伯洋與支持的4個真實範例組另列 postponed，合成詞不替代原finding的真實資料複驗。首頁必須在每張整頁與分段前後確認文字雲及排行期間相同、資料世代未變。今日與七日只套用有該功能的區塊，不把頻道近期開始直播條件當成歷史日期範圍。
- 期間依源碼：一般 from/to 為台北 D 至 D 或 D-6 至 D；群組指標起日排除，七日用 D-7 至 D。單日頁另拍既有歷史日；沒有期間選擇器的頁面明示不適用，不捏造控制項。雲／部分 AI 的 backend query 能力與可見 UI 分開記錄。
- 既有 654 目錄224張PNG共49,932,059 bytes；manifest內24個viewport packages引用202張、43,225,260 bytes，另22張保留但不擅自歸屬。每包中位1.31MB、最大5.90MB；規劃每包2.5MB、保守上界6MB。全矩陣約 **5.15 GB**，保守 **12.36 GB**，另需互動／參考圖／網路收據；這不代表獲准使用這些容量。
- 本機兩個retained目錄已按device+inode核對，不重疊；舊目錄包含224 PNG的49,932,059 bytes及metadata1,562,080 bytes，停止批全部5,222,891 bytes，兩目錄小計56,717,030 bytes。初始28 packages圖片預估70MB／上界168MB，另留30MB證據，共198MB；已知保留加新增上界254,717,030 bytes，餘45,282,970 bytes只供尚未盤點的保留證據／誤差，不是新增組授權。三批上界82／82／34MB，均≤90,000,000 bytes。完整保留參考圖、網路與metadata scope仍未驗證，故全部executionAllowed=false；若實測保留量增加，重新分配並整組postpone，不刪除、不重置。全2060只是未解決Cartesian slots，不是可執行清單。
- loading、empty、error、partial、互動及登入／權限是獨立狀態，不能用預設畫面取代。必須使用既有權限或經核准的去識別隔離資料，不能新增帳號／權限、不能在正式站故意製造錯誤或試寫。每一張新圖保存 SHA、BUILD_ID、artifact proof 連結與有上限的去識別網路紀錄；舊 zero-GA 未證保持未證。

全站仍 **0 個完整 UI route 通過**；原0550／0620／0640 finding 與 SHA 限制不變。

本輪追加原始碼修正：`6a7e83a` 修正分類群組直播導覽（獨立10項測試）；
`f86ceca` 修正事件／影片歷史空資料提示、逐日數字與趨勢名稱（8項API mock、
31項前端／快取／CSP測試、API/web noEmit，独立reviewer另跑8項API測試）。
兩批均由實際Opus5.5實作、GPT-6.1 Sol獨立review，來源hash、時間與完整receipt路徑
已記入JSON的`frozenSourceReviews`。noEmit使用既有依賴與generated types，沒有執行
Next typegen/build；不同批次重疊測試不相加當唯一總數。
`p0SourceFollowupBatch`逐項對照五個finding與commit；其餘本輪未重查的finding
明確保留原狀，不宣稱全部P0已修完。這些修正都還沒有新SHA的畫面複驗。

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

最新建置來源 `a77f84d`、BUILD_ID `dSzDaU9M4jqYXzUwz7XSr` 已完成編譯與同份產物恢復；988 來源／3,414 payload 檔案核對。未開始新 capture、candidate、部署；376 個新候選 UI 狀態仍 pending，完整 UI route 完成數仍為 0。新的 guardian／文件更正不把舊截圖或 source review 提升為視覺通過。

最新 v6 擷取程序及建置守門原始碼已由另一個 GPT-6.1 Sol 獨立 review，收據 `capture-v6-root-five-file-independent-review.json`（SHA-256 `4703f0a2bc74bf6ac12c8dfb73c6ddfa7b78c9dee6f97ac59cd0a167db13c487`）記於 JSON；兩個 capture hard stop 仍啟用。這是工具原始碼審查，沒有新增任何 UI pass。

05:47:30–05:48:30 UTC 固定 baseline 已記錄於 `platform/tools/performance-gate-baseline.json`：每站以 curl、DNT:1、Accept:text/html，5 次完整首頁 HTML 的 time_total 取中位數，間隔 3 秒，不帶 query/cookie、不執行 JS。tag 0.256 秒 → 2 秒；blog 3.085 秒 → 6.17 秒；YT 0.289 秒 → 2 秒。來源收據 `/tmp/babysit/gate-baseline-receipt.md`，SHA-256 `c897d26530db7e78b988b5c8c2614d5baa6a7e1716d8852cdc29f43c612d267b`。執行探測與部署 receipt 記錄這份固定基準，不自行重新放寬。

獨立 GPT-6.1 Sol 盤點原檔 `/home/deck/.cache/youtube-ui-review/root-sprint-review-evidence-1340.json`（7,718 bytes，SHA-256 `7e9b48ddb82a44990abe2dd7ac3859e8388d47140b1998c84b273e3b28f78ad2`）已核對並登錄 JSON。這是既有證據盤點，沒有看新圖，也沒有獨立驗證 source/artifact。`a77f84d` 首輪 36 項全部 pending，首頁、/keywords、/keywords/支持/videos、/channels 均無新版本 pass；candidateApproval=false。不能沿用 654cdf5 的通過狀態。

固定 baseline v7 與對應 guardian／部署收據原始碼的獨立 review 收據為 `frozen-baseline-v7-root-delta-independent-review.json`，SHA-256 `b63a5cb636c27e7d28ae22fd9af816bae5012ed30637ce2399d00e93d5d01e54`；16 項 local guardian mock tests、6 項 capture policy tests 與 syntax checks 通過，無 runtime／視覺驗收。

## 06:04 UTC 建置名額交接後的準備

06:16 UTC 歷史狀態：blog 完成建置後，協調者已將全站唯一名額交給 YT。同一個 a77f84d 產物的薄封存已驗證：20,039,680 bytes、解壓增量 69,260,800 bytes；完整 OCI 保留，沒有重建。匯入暫因既有 BuildKit daemon 的活動狀態待核對而停止，尚無 candidate、capture 或部署。

截圖工具 v8 補上安裝版 `chrome-headless-shell` 的根程序識別；7 項離線測試通過。作者與獨立 GPT-6.1 Sol source review 收據列於 JSON `queueRelease0604.captureV8SourceEvidence`；兩個 hard stop 仍為 true。這不增加任何視覺通過：376 個新候選 UI 狀態與首輪 36 個 packages 仍 pending。

06:18:23 UTC 映像匯入完成，來源與95層diffID/config吻合；全站建置名額已釋出。06:19:06 UTC candidate 啟動，06:21:06 UTC 容器內3,414檔、BUILD_ID `dSzDaU9M4jqYXzUwz7XSr`、Next/React版本與NoNewPrivs逐一核對。冷首頁16.03秒，不能拿暖值宣稱冷啟動改善；其後核心canary於06:22:41 UTC通過（6組快取邊界、7個核心頁與108個script比對），HTTP通過不代表視覺pass。實際proof路徑與hash列於JSON `queueRelease0604.runtimeEvidence`；目前無新截圖或視覺pass。

14:20 收據文字更正：blog 的3.085秒DYNAMIC time_total包含origin渲染、Cloudflare edge及網路，並非精確的origin渲染耗時。guard既有scope已正確；原始凍結收據/hash保留，最新更正hash與原始copy列於 `platform/tools/performance-gate-baseline-clarification.json`，門檻2／6.17／2秒不變。

06:29:59 UTC 首批capture preflight停於程序盤點unknown；三站均200且健康閘門通過，但無法確定瀏覽器根程序數量。沒有釋出capture hard stop、未建立capture envelope、無新PNG。未知盤點仍fail-closed，待既有權限下的唯讀盤點修正與獨立review。

06:41:38 UTC v9程序盤點source獨立review及11項mock測試通過；依可讀的comm、argv0、Chromium旗標判斷候選，任何疑似瀏覽器仍須核對exe，未知仍拒絕，不新增權限。06:42:59 UTC實際盤點known=true、0個瀏覽器根程序；新preflight僅因正式YT首頁2.855321秒超過2秒而拒絕。原始兩份拒絕及v9獨立review的路徑／hash列於JSON `queueRelease0604.capturePreflightEvidence`。無新PNG或pass，後續僅在新閘門通過後恢復。

06:45 UTC新閘門通過後，batch001產生首頁今日淺色桌機整頁與5張同buffer切片，共2,534,848 bytes。context關閉後仍有2個fetch缺少terminal事件，收據complete=false／accepted=false；擷取停止、own browser已關閉、空lock保留、原圖不刪。這6張PNG不算完成package；沒有mobile、completed item或完整manifest。獨立reviewer只可用它找視覺問題，不可宣稱pass、zero-GA或關閉原finding。診斷hash／path見JSON `queueRelease0604.partialCaptureStopEvidence`。

06:58 UTC 實際獨立 GPT-6.1 Sol 看圖 review 已返回：首頁今日、淺色、1280，共6張candidate PNG與1張tag參考圖，逐圖觀察和hash均在 `queueRelease0604.partialIndependentImageReview`。兩個可見期間均為今日，未發現新的桌機阻斷性版面問題，但網路收據拒絕、沒有完整coherence manifest／手機畫面，且tag參考只有深色首屏、缺同主題完整來源證據。因此只計findings-only review；不算pass、zero-GA或關閉歷史finding，376個新版本狀態仍pending。

v10網路settlement source由另一GPT-6.1 Sol instance獨立review，23項mock tests、3項syntax checks通過。只有讀取真實pending狀態與有上限等待，未合成terminal事件，也未放寬拒絕條件。既有partial證據與budget保留；僅授權新閘門通過後重試batch001，不自動執行後續批次。source收據路徑／hash見 `queueRelease0604.captureV10SourceEvidence`。

07:04:09–07:04:29 UTC：v10重試在新SM排隊指示送達前已啟動，未中斷而自然exit1。桌機94筆網路生命週期完整，DNT/GPC與Google零attempt／response僅限該收據觀察；手機遇到candidate `/ai/days/:id/events` prefetch503，故仍無手機PNG、completed item或配對manifest。全部partial與lock保留，固定envelope總計5,222,891 bytes。receipt/hash見 `queueRelease0604.v10RetryResult`。不把桌機網路通過當視覺pass；所有376新版本狀態仍pending。

使用者已要求SM不再開新的build／capture／restore，全部排隊等Mint。唯一YT owner交接清單：`/tmp/babysit/mint-queue/youtube.md`。現有candidate依原生命週期自然結束，不在SM重建／重拍；原始碼、mock測試、文件與既有截圖離線review繼續。正式站未部署。

Mint離線準備：實際matching-light tag參考已找到，原capture時間20:22:01 UTC及hash可核對。獨立GPT-6.1 Sol逐圖比較兩批a77桌機partial共12張與7張tag參考，支援P2finding：升溫資料不足後的支援影片／頻道數被ellipsis藏住。來源CSS改讓次要metrics自然換行，詞身分仍保留原規則；20個focused資料／元件測試通過，另instance source review通過。圖像finding不關閉；需要Mint新SHA／BUILD_ID的雙寬度亮暗重拍。收據、逐圖path/hash與source限制列於JSON `mintOfflineFollowup`。

quality第二批修改已park在35a4794並推到自己的分支，獨立source review及45個mock/offline測試、jobsnoEmit通過，17個DB測試跳過。當前a77artifact不包含該批；啟用仍受syncownership／freshbackup／exactdeployedimplementation／operatorauthorization阻擋。未新增帳號、grant、schema或scheduler動作。

396196c原始碼小修：RSC的合法HTMLfallback同樣協商identity完整entity，再做原hashCSP／SRI及privatecache檢查。作者14個mock測試及API noEmit通過，獨立reviewer另跑13個proxy／cache診斷／publicHTML測試通過。Flightstream及編碼staticbytes保留；真實5xx／不安全inline／不遵守identity仍503。已觀察手機503的精確根因仍未證，不把修復contractgap當實際驗收。新映像／新SHA重拍排隊Mint。


## Mint 排隊期間的離線驗證

使用者已取消所有截止窗口，最新 SM 不新增 build／capture／restore 的限制維持。固定 Mint 候選是 `e137c5f0a4c0184fe5bae8330b410eed74a07063`；未建置，376 個新候選 UI 狀態與所有完整 route 仍 pending。

另一個 GPT-6.1 Sol 完成管理員覆核 source audit：58 項 focused mocks 通過，沒有阻擋性 source finding；只核對既有 session-only admin、Origin／CSRF、no-store、record-only 標示及安全輸出，不含 mounted React 互動、真實 SQL 或畫面驗收。原始 receipt 與 model provenance companion 的 path/hash 在 JSON `mintOfflineAudits`。root 另完成前端 279 項及 API 35／51 項離線回歸測試；這些測試有範圍重疊，不合算成新的 UI review 數量。

v11 擷取失敗診斷、無截止的 Mint 發布計畫也完成獨立 source／document review；收據 hash 已登錄。兩個 capture hard stop 維持，沒有新的 capture、BUILD_ID 或部署。已有截圖可继续用於歷史 findings-only review，不轉用為 e137 pass。

Y2 上游 source audit 固定在 `48bc174`，原 `b8d030c` 契約來源另保留；沒有發現破壞 adapter 的 DTO 變化。新增 200 列／8 層與來源 ID、特殊 UTF-8／一次編碼、合法大回應拒絕而非空成功三組 mock；作者 58 項 focused tests 通過，另一 instance 獨立 review 並執行新增 3 項通過。未改 runtime/cap、未查正式上游或開旗標。source receipt 的 path/hash 在 JSON `mintOfflineAudits.y2ContractFollowup`，沒有增加 UI pass。

完整詞庫匯入器 source preparation 已移除 500 頁限制：完整池上限 20,000 頁，逐頁寫入與 checksum；比對 loader 只查固定活躍集（每批 500），不反覆全池掃描。原始身份與標籤完整保留。獨立 GPT-6.1 Sol source review 與 44 個 mock tests 通過，1 個真實 DB 測試跳過；啟用所需的增量排程、正規化 offset、非活躍原因介面與備份／ownership／runtime 驗收仍未完成。此批另行保存，不進入 F2 UI candidate，也沒有改 serving pointer。詳見 JSON `mintOfflineAudits.vocabularyCapacityPreparation`。

## Mint ARM 與離線手機修正（2026-10-13）

唯一 owner 是 d7967e77；Mint 工具鏈已由 coordinator 報告就緒，slot 仍未交接（tag → YT → blog）。
架構策略見 [Mint ARM64 交接](../platform/docs/mint-arm64-handoff-2026-10-13.md)：skyhong-blog 原生 ARM 編譯／封裝、Mint 只拍同一映像。
隔離 API／readiness 與 executor STOP lifecycle 尚待接好，不能以正式 API 代替。未啟動建置、capture 或部署。

獨立 GPT-6.1 Sol 實際看過舊654的 /videos、/live/current、/mayor、/mayor/cities/taipei 桌機／手機及 tag 參考，
新增四份 findings-only 歷史頁 review，六個問題仍 open。路徑／SHA256／model／UTC／圖檔 hash 與限制在 JSON `historicalFindingsOnly654`。
圖檔身分只來自舊 manifest，不作 runtime 套件證明；zero-GA 未證；不提升任何新候選 state。

手機影片／直播改完整標題換行與小縮圖；市長頁保留醒目的覆蓋不全警示，逐日證據用 native disclosure；
市長寬表的可測量橫捲提示移到表格前，避免讀到底才看見。三批 source 都由作者之外 reviewer 核對 final bytes，
23 個 focused tests 通過，web noEmit 通過。來源證據在 JSON `mintOfflineAudits.uiSourceFollowup`；
新 SHA 的密度／深色／圖檔真實載入／橫捲互動都仍待 Mint 重拍，舊 finding 不關閉。

總計351 routes／622 entries；110 UI routes／376 UI states；246 非 UI n/a-ui。
完整 route 完成0，新候選376 states全部待重拍／獨立review。四份補充歷史 review 不算新候選 pass。
GSC 的既有去識別紀錄摘要見 [來源端爬蟲紀錄](../platform/docs/gsc-existing-log-summary-2026-10-13.md)：0筆可信 Googlebot index／子檔抓取，不把未驗證200當Google验收。

上述 UI 原始碼另存於 `4d7dc12100f8cd647f077978beb918d17157633a`（準備分支），不是可直接建置的 release tip。ARM／GSC 文件已由另一 GPT-6.1 Sol 獨立 review；最終 receipt 与 concurrent timing correction 保留於 JSON `mintQueue.architecturePlanReview`。無新增候選通過狀態。

root 台北16:30另回報230筆log、verified Googlebot0、UA宣稱Googlebot且抓sitemap0，已附在JSON `mintQueue.gscExistingLogSummary.rootReportedUpdate`。230的完整篩選範圍／原始receipt未提供，與較早141筆discovery subset分開保留；不推測新增量或Google已抓取。離線比較的五份source與7eb48f4相同；沒有新HTTP／UAprobe，也不宣稱GSC根因或修復。

root16:30的GSC補充與離線source結論另經獨立GPT-6.1 Sol核對，receipt在JSON `mintQueue.gscRoot1630IndependentReview`。未執行新測試／網路請求；沒有GSC修復或Google抓取成功聲稱。


## 本輪離線測試與 Mint 清單（尚未建置）

- `5327497`：詞庫 checksum 掃描／writer ownership與 publication rollback 的七個 adversarial mock；六套51通過、1真實DB跳過，root另跑兩檔25通過／1跳過，jobs noEmit通過。runtime與測試分別由獨立instance review；此批不進UI候選、不發布詞庫。成功COMMIT後丟失ACK仍不確定，不冒稱已測。
- `ce265be`：Y2新增七個 raw-ID、NFKC差異、一次URL編碼、split UTF-8 131072/131073-byte回應界線案例；65通過、API noEmit通過，root另instance核對新測試並重跑65項。旗標仍關閉、無外部請求。
- 重拍 generator／matrix 已独立source review，可用 `--check --mint-manifest --candidate-sha <exact SHA>` 輸出portable清單；SHA參數只檢查格式，沒有驗證runtime。2060 packages全部pending，240項無resolved example、fixture/readiness均未證。receipt的path/hash/time與限制見JSON `mintOfflineAudits`。

UI修正successor將只從e137父樹選入4d7dc12的11份reviewed UI code/test、最終Y2契約測試和規劃文件；不追隨準備分支tip，不納入parked jobs／worker permissions。所有376新artifact狀態待重拍，完整route通過0。


## 固定後繼來源（不含 runtime／視覺通過）

實際後繼 `70529cff13b6b7f5b3e0571a229e2b61660f9df4` 已組成，父鏈為e137 → 1ef45cb1 → 70529cff。相對e137只變更20份檔案：11份UI code/test、最終Y2測試、8份規劃／證據／generator文件。1ef的proof頂層Y2欄位曾因作者重用迴圈變數而誤記GSC文件hash，70529cff的新proof明示更正並保留原檔；Git中的Y2 bytes與reviewBindings始終正確。最終tree-boundary獨立review進行中。

計畫輸出約1.45MB，所有package仍executionAllowed=false，沒有任何新截圖。JSON `mintQueue` 指向exact source proof及planning receipt；它們不能替代實際capture manifest。source之外BUILD_ID／digest／readiness／全站名額均未證，所有376狀態仍待重拍，完整route通過0。

獨立實際tree-boundary review已接受70529cff的20檔範圍與review hash-binding，原檔 `mint-successor-70529cff-independent-boundary-review-final.json`，SHA256 `bf0e3513334bf4f57eba094deae061bfe0adb18549880a9c78598c14c891ae14`，UTC2026-10-13T09:07:27.867088Z，既有GPT-6.1 Sol reviewer。完整path/model/SHA/時間見JSON；source接受不等於部署或UI接受。APP源碼70529cff固定，但APP BUILD_ID/digest、OPS exact runtime SHA/digest均null/unverified；隔離API與executor STOP/admission guard仍pending。釋放Mint鎖不能提升ready。

OPS／APP pending欄位另有獨立addendum，path見JSON `mintQueue.runtimeHandoffIndependentAddendum`；SHA256 `e5be92ac2915015d9182d37f66815fce96d33e2752dc8ee57f51c72599293e08`，UTC2026-10-13T09:09:40.418863Z。此追加只記來源review，不更動候選SHA、不提升任何ready或pass。


## 原生 executor 離線準備（不是 ready）

[五項執行前待辦](../platform/docs/mint-executor-prerequisites-2026-10-13.md)已完成獨立文件review；receipt、model、UTC與hash見JSON `mintOfflineAudits.executorPrerequisites`。原guard audit的model欄位未確定exact serving identifier，保留原文，不算GPT-6.1 UI review；本文件另由既有GPT-6.1 Sol reviewer核對。local STOP回讀修正正在另批實作；source/test獨立驗收前仍pending。它不等於remote native executor／cross-host lease／OPS readiness，不改APP70529來源，也未啟動任何main、build或capture。

local STOP補丁已由作者之外的GPT-6.1 Sol完成final-byte source review，root獨立重跑30項mock、in-memory syntax與diff check通過。訊號後需要兩份穩定的stopped/exited觀測，未知／失敗明示STOP-unconfirmed；main不能只因group變空就釋放未確認STOP的guardian。receipt path/model/UTC/hash見JSON `mintOfflineAudits.executorPrerequisites.localStopSourceReview`，原finding與原author receipt保留。此補丁是準備分支的local工具，不混入APP70529；未測真實Linux停止、native remote executor、跨機lease或OPS readiness。五項待辦文件是本批補丁完成前的審查快照；最新source狀態以本段與JSON為準，runtime gate仍pending。


## Mint runtime 小批準備（2026-10-13 UTC 09:46–09:50）

APP70529 固定；OPS 已審基底 b4d85de，新 bootstrap／admission 工具須另經獨立 review。
Mint 私有 APP source 已固定 exact SHA、Git clean、lockfile hash，20,017,713 bytes；沒有安裝依賴或啟動服務。
真正的 Mint→SM pinned SSH probe 與 skyhong-blog 容量盤點已保存 path／hash（JSON `mintRuntimePreparation`），
不以空鎖或當時健康當成名額／readiness。MariaDB10.11.14工具已存在，隔離SQL/API仍未啟動。
沒有 BUILD_ID、新 image、capture 或部署；376新候選UIstates仍全部pending。
接線與限制見 [runtime準備紀錄](../platform/docs/mint-runtime-preparation-2026-10-13.md)。

另一個既有 GPT-6.1 Sol instance 已核對本批實測收據／文件，並審查 `ba3a129` admission準備source與30項mock；path／SHA256／UTC記於JSON `mintOfflineAudits`。
原跨機收據沒有保存argv/process transcript，capacity收據没有filesystem identity，SQL readiness未測，這些限制均保留。
source／文件審查不增加UI pass，也不授予名額或runtime許可。

native compiler lifecycle 的另一批 source／29項mock已經由非作者 GPT-6.1 Sol review，parent也重跑通過；收據在JSON `mintOfflineAudits.nativeExecutorLifecycleSourceReview`。
只實作owner／image／cgroup身分與freeze／terminal檢查的無預設backend介面；沒有真實Docker/SSH/kernel操作，並非實際STOP證據。共享coordinator、watchdog、launcher與封裝仍pending。

隔離MariaDB／API的OPS supervisor與worker完成獨立final-byte source review，10Python＋11Node mocks通過；13個APP依賴檔也跟70529Git物件逐一核對。receipt／hash在JSON `mintOfflineAudits.isolatedFixtureBootstrapSourceReview`。
使用實際APP的SQL Reader、合成fixture與三段SQL/injection/HTTP readiness檢查；目前沒有實跑DB或API。
這是fixture-only subset（持續要求buildCount0），不監控nativebuild，不能以它當作完整跨機executor。
UTC10:10起tag持有全站唯一建置名額；YT不啟動build／共享鎖DB/API。可信admission publisher、共享coordinator、runtime依賴、crash-surviving containment／watchdog與實際STOP仍pending。所有UI states維持pending。


## Retake inclusive budget source followup (2026-10-13)

這次只有離線路徑盤點、規劃與mock測試，沒有build、capture、服務啟動或網路probe。TAG仍持有全站名額；APP70529未改。原PNG、manifest與舊review收據全部保留。

| 初始完整組 | 期間 | 亮／暗 ×1280／390 | PNG估算／上界 |
| --- | --- | --- | --- |
| `/` 合成fixture | 今日、近七日，各獨立組 | 每期間4 packages | 每組10／24MB |
| `/keywords` 合成fixture | 今日、近七日，各獨立組 | 每期間4 packages | 每組10／24MB |
| `/keywords/合成焦點甲/videos` 合成fixture | 今日、近七日，各獨立組 | 每期間4 packages | 每組10／24MB |
| `/channels` 合成fixture | existing-window | 4 packages | 10／24MB |

每批另留10MB供新增tag reference、網路与metadata證據，全部計入batch／cumulative cap。7組依序分為3／3／1組，上界82／82／34MB；兩個已盤點目錄加三批共254,717,030 bytes。整體完整scope未盤點前，預算可容納不代表可執行。若新增參考／診斷超過reserve，開始前縮減完整組或停批，不能超額。

`/keywords/沈伯洋/videos`與`/keywords/支持/videos`各今日／近七日共4組明列postponed：缺少對應核准的隔離真實範例fixture，合成詞不能關閉原finding。其餘2060個Cartesian ledger slots全部仍pending；240項缺example URL，376項fixture setup均未實際驗證；多URL、loading、empty、error、互動、權限及其他補充狀態需另列完整組與預算，不可借預設畫面完成。

實際兩目錄identity盤點收據：`/home/deck/.cache/youtube-ui-review/f2_visual_sol-2026-10-13/retake-retained-identity-inventory.json`，SHA-256 `171101d802b62ea3d79bb87ef32d5f97e0b65086507ff568763d9885601dedb6`。247個distinct regular-file identities，cross-root overlap0；內容相同但各自保留的copy仍各計bytes，hardlink／重複path才按device+inode計一次。此收據只證兩個本機目錄，不能宣稱Mint／全累計scope完整。
