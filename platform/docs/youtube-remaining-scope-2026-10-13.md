# YT 未完成 scope 與執行依賴盤點

唯一 owner：d7967e77。本輪盤點來源是乾淨的 OPS 基底
`5a5be6833ee2f32d35bce021db43d3627fdd7c8f` 與獨立 review 過的 APP
`70529cff13b6b7f5b3e0571a229e2b61660f9df4`。OPS 後續離線修正另行提交，
不把準備分支當 APP build input。此文件是剩餘工作清單，沒有任何 runtime 或 UI 批准。

tag 從 UTC 10:10 持有全站唯一建置名額，最新通知仍在第三次 guard 重試。
YT 不建置、不 capture、不啟動 Mint DB/API，不因空鎖自行取用名額。
SM 不新增 build/capture/restore；不開新 agent，只沿用既有 author/reviewer。

F2 由 YT 負責；Y2 是 tag F1 relations 的消費端。F1 的來源與上線由 tag owner
負責，F3/F4 由對應站 owner 負責；本 thread 不將其他站的實作列成自己的已完成項目。
以下另列本 repository 原有完整 TS handoff 與 transcript scope，避免只盤 F2 而遺漏。

分類：**離線**＝現在可以寫原始碼、mock 測試、文件或獨立 source review；
**名額／鎖**＝一定要取得新 tag→YT 交接、共享鎖、fresh guard 與隔離 readiness；
**上游**＝需要實際 upstream contract/資料；**操作授權／真人**＝受控 writer handoff、
既有帳號權限或真人驗收。具有多階段的項目分行，不把後續 runtime 依賴當作離線停工理由。

## F2：排名、品質、證據與覆核

| ID | 未完成項目與現在的證據界線 | 分類 | 下一個具體動作 |
| --- | --- | --- | --- |
| F2-01 | 新候選 Today/Week、亮/暗、loading/empty/error、手機表格、四項 654 finding 的 source 已修，APP70529 尚無 build/image；旧 pass 不沿用 | 名額／鎖 | 原生 arm64 建置同一 APP，隔離 canary，再逐狀態重拍和獨立實圖 review |
| F2-02 | 正常排名資料、期間一致性、支持影片不誤示空警告，仍欠新 runtime 驗證；原 /keywords 失敗回應未保留，初始原因無法離線復原 | 名額／鎖 | 真正 SQL/HTTP readiness、保存安全診斷；不能聲稱已證明歷史 query timeout 根因 |
| F2-03 | 最終同期間正式資料前後前20名與正式可見畫面未完成；已有28詞/56配對/16去重片段是刻意挑選樣本 | 名額／鎖 | 程式與資料版本固定後，唯讀比較、記 UTC/期間/coverage；不能推估全站失真率 |
| F2-04 | 描述去樣板、URL/社群/hashtag、平台詞上下文及標題加權的 v2 source 已有，但正式 serving 仍需受控資料切換 | 離線 | 完成正常 sync 不覆蓋 v2 的連續世代設計、candidate/rollback ownership mock；不刪詞、不全詞排除24小時 |
| F2-05 | v2 近期影片補比對、coverage/checkpoint、指標 CAS 與延遲/升溫尚未正式驗收 | 名額／鎖＋操作授權 | 保護備份與既有最小權限，reviewed preview→bounded execute→coverage acceptance→CAS；不啟動第二 writer |
| F2-06 | 詞库有 ASCII 關鍵字 identities 顯示合併；人物查詢仍按確切名稱，tag person/tag-groups 身分關聯與 approved alias 顯示整合未完成，Y2 alias 不自動合併 identity | 離線＋上游 | 先對來源 person/group 契約建 identity/provenance mock，真實上游驗證後接；不猜人物、不改池 |
| F2-07 | 源 urt_video.viewCount NULL 已查明不是這批 JOIN 缺值，但統計未寫入的來源原因與持續 coverage 仍未結案 | 離線 | 查 reviewed ingestion/log/schema 的漏值路徑，補 missing/partial 判定；實際 poll 修復仍走原 owner workflow |
| F2-08 | 新 SHA 代表圖/人物圖/影片縮圖真實載入、sourceURL/status/fallback與缺頭像未重新验收 | 名額／鎖 | 真實圖片 network/status與尺寸驗收；占位圖不當真圖，不盲試 variants；avatar 補齊走原受控 job |
| F2-09 | 覆核介面與 record-only proposal source 已審，但 migration015 未套用，feature/write gate off，覆核不會改公開排行 | 離線 | 設計 reviewed override→quality generation 的受控套用/撤回鏈與mock；保留 raw/exclusion/audit，不手改 DB |
| F2-10 | 覆核 anonymous/denied/既有admin、互動/error及真的提案寫入未验收 | 名額／鎖＋既有權限／操作授權 | 隔離 mock/現有角色逐狀態驗收；正式 migration/grant/gate 走備份與已審流程，不建新帳號或權限 |

## 完整 tag 詞庫（獨立 parked 批次，不擋 F2 首版）

| ID | 未完成項目與現在的證據界線 | 分類 | 下一個具體動作 |
| --- | --- | --- | --- |
| V-01 | queue workflow 的500頁舊上限已在本輪source修正並独立review；尚待提交與runtime验收 | 離線source已接受→名額／鎖 | queue入口共用MAX_EXPORT_PAGES；23項測試通過/3 Redis integration跳過，jobs noEmit通過；保留小預設，不偷開排程 |
| V-02 | 全池逐頁 DB 與 active-only loader、checksum移出發布交易/失鎖拒發布 source 已審；真實完整 DB import 未完成 | 名額／鎖 | 真實隔離 SQL/integrity/記憶體測試，再正式 preview；不能用 mocks 聲稱4.73m詞已進 DB |
| V-03 | changes每10分鐘、跨世代對帳/409重讀、每日完整快照、429退避、24h備援排程尚缺完整管線 | 離線 | 新增可續跑的 delta generation/CAS/幂等及每日 reconciliation mock；持續來源契約兼容，憑證只用既有服務 token |
| V-04 | NFKC/零寬字元只在 preview，正式 matcher仍 ASCII folding；原文 offsets/aliases/evidence尚未接到正規化 | 離線 | versioned normalized matcher＋原文字元位置映射，保留 exact raw identities；測TPBL、全形、Unicode expansion與大小寫邊界 |
| V-05 | inactive低頻/超预算原因尚無公開 UI/API；活躍預算截斷與近期新詞優先需明確 membership evidence | 離線 | 原始詞照查、原因及budget可解釋 DTO/UI/mock；不可刪池或說active就是完整詞庫 |
| V-06 | 正式切換、delta輪耗時、持續10分鐘延遲與一天觀察尚未完成 | 名額／鎖＋操作授權 | 保護備份/ownership、controlled pointer與排程；保留24h來源備援，記真實輪耗時及rollback |

## Y2 / F1 消費端

| ID | 未完成項目與現在的證據界線 | 分類 | 下一個具體動作 |
| --- | --- | --- | --- |
| Y2-01 | source/65項契約mock已審，large UTF-8 response安全拒絕；flag off，所有 UI 狀態待新產物 | 名額／鎖 | disabled/loading/unavailable/empty/truncated/full的隔離 candidate 實圖/互動 review；同一份產物發布旗標關閉 |
| Y2-02 | tag F1 真正 deployed OpenAPI/relations兼容、服務 token quota、來源身份未驗證 | 上游＋名額／鎖 | upstream owner回報後，以既有credential及限流驗契約，記upstream SHA；不可正式API代替fixture |
| Y2-03 | 正式啟用及旗標 rollback 尚未執行 | 上游＋操作授權 | 獨立驗收實際資料與所有guards後controlled reload；目前off保持off |

## 建置／隔離 runtime／capture／部署

| ID | 未完成項目與現在的證據界線 | 分類 | 下一個具體動作 |
| --- | --- | --- | --- |
| R-01 | native admission/executor 是已審無預設backend的spec；真正Docker inspect、kernel IO與native launcher未接完 | 離線／本輪正在做 | 實作固定/owned backend＋mock，不能讓 caller JSON 的true變成批准；物理STOP另驗 |
| R-02 | 全站durable reservation/lease、Mint kernel flock、跨host custody、失聯/主程序crash watchdog尚未整合 | 離線 | 接真正coordinator/continuing guard與fail-closed containment；fixture buildCount0路徑不能冒充可與build並存 |
| R-03 | 隔離 MariaDB/API bootstrap source21mocks已審，worker已實作有SQL liveness的/ready與/runtime/ready，尚未啟動驗證；dependency runner/tunnel及全狀態fixture接線仍缺 | 離線 | 固定exact APP依賴與fixture拓展mock，完善離線命令/identity receipt；不安裝/啟動；實際SQL/HTTP另列R-04 |
| R-04 | DB/API SQL VERSION、JSON_TABLE/Unicode/HTTP、native STOP、跨host guard與實際依賴 compatibility未執行 | 名額／鎖 | fresh handoff/admission後受控隔離服務＋真正kernel proof；不能以舊read-only盤點代替 |
| R-05 | 原生arm64單次build/package与standalone/chunks/manifests/Next/React一致性尚未建立 | 名額／鎖 | skyhong-blog native target，同一BUILD_ID；Mint x64 node_modules不搬到ARM；確認linux/arm64、imageID與manifest digest分別留證 |
| R-06 | 2060重拍package只是Cartesian規劃，240 entries缺resolved sample；首批包容舊圖的300MB預算仍不通過 | 離線／本輪正在修 | 實際retained evidence盤點，縮成完整variant組、明列postponed；缺fixture樣本維持pending |
| R-07 | capture SM絕對路徑尚須Mint materialize；zero-GA/期間coherence/terminal request證據要一併保存 | 離線 | 移植固定路徑、禁production fallback、mock檢驗DNT/GPC/預navigation block、bounded redacted lifecycle |
| R-08 | 110個UI routes/376states新SHA review全部pending；歷史25項review不等於新artifact接受；admin/登入/互動也未全驗 | 名額／鎖＋既有權限 | Mint依priority逐頁/逐狀態取1280/390亮暗圖、tag參考，既有獨立reviewer真看圖；缺圖/role明列missing |
| R-09 | 部署、正式瀏覽器驗收、市長分享/導航與media thread後檢未完成 | 名額／鎖＋candidate通過 | 完整diff對7eb48f4、備份runtime設定，Dokploy部署同一reviewed image；回報commit/真正digest/UTC/URLs/截圖給babysit及peer |
| R-10 | 新候選冷/暖查詢p95、負載下<2s、API credentials/private/4xx/429/5xx、ISR/STALE/CSP/Vary/br回歸尚未驗 | 名額／鎖 | bounded sequential canary/負載收據，不忽略5xx，不把暖cache數字說成冷SQL；任何gate失敗停止 |

## 原 API、SEO、GA、圖片 scope 的剩餘部分

115支OpenAPI、`/api`、`/api/status`、17個非空sitemap、canonical、持久crawler log、
X-Service-Token no-store、GA loader與圖片優化已有**較早正式發布紀錄**，不是全都重新待實作。
新candidate仍須R-08/09/10回歸；不把舊發布證據轉成新SHA review。

| ID | 未完成項目與現在的證據界線 | 分類 | 下一個具體動作 |
| --- | --- | --- | --- |
| A-01 | 個人API key申請/撤銷、SHA256-only、1000/min與x-ratelimit-*，發布文件明示pending | 離線 | 按tag既有reader api-keys做原始碼/schema/限流/session/no-store及mock；部署schema另走授權流程 |
| A-02 | cursor/nextCursor目前文件誠實列offset；UTC ISO序列化與tag慣例仍有未統一部分 | 離線 | 向後相容新增cursor，keyset/identity/version失效mock、UTC明確轉換；重生同源OpenAPI/docs/網站例子 |
| A-03 | event/keyword detail sitemap還未有完整inventory，故沒有列入index | 離線 | bounded complete keyset inventory與lastmod/count/byte/失敗保留mock；不能先列404子檔 |
| A-04 | GSC仍Unknown/Couldn't fetch；root回報log230筆、可信Googlebot0，原篩選receipt未提供，與保留141筆discovery subset分開；沒有真實子sitemap抓取證據 | 外部GSC/Google | 已交去識別摘要；只再分析真實新log，由root處理GSC；不spoof UA、不改CF/WAF、不推測已抓到 |
| A-05 | login自訂GA事件仍缺安全單次callback receipt；禁止從已有session捏造login | 離線 | 用一次性server receipt做安全契約/mock，method=google且無identity；不送合成事件 |
| A-06 | 新產物privacy/hostname/DNT/GPC/opt-out、history僅一次page_view与安全事件需回歸；真實Realtime由root處理 | 名額／鎖＋真人 | capture只測blocked transport與零外送；真人正式GA由root對照，不能混成zero-GA工具驗收 |
| A-07 | mobile PSI較早已97/LCP2.250s/FCP1.148s/CLS0.000802/TBT89ms；新F2畫面/圖片LCP未重測 | 名額／鎖 | 實際修改且候選通過後3次mobile median；不重跑原基準、不報lab INP、占位圖不算真圖 |

## 原完整 TS workflow handoff / transcript 後續 scope

| ID | 未完成項目與現在的證據界線 | 分類 | 下一個具體動作 |
| --- | --- | --- | --- |
| H-01 | 所有未交接的YouTube stats/uploads/live/comments/TVBS/tag-backfill、cache/report、AI daily/hourly/channel/derived workflows仍由Laravel持有；TS source不等於交接 | 離線 | 逐workflow對registry/來源表/rollback/備份/限額/幂等/unknown-result做source audit與mock，不改owner/allowlist |
| H-02 | TS workflow實際隔離SQL/Redis/provider dry-run與least-privilege驗收、正式逐一handoff未完成 | 名額／鎖＋操作授權 | 每個workflow先一致性備份離機restore、驗exact facades/grants；小批handoff避免雙writer，原scheduler保留 |
| H-03 | Telegram/notification真正投遞與切換最後做，既有記錄/unknown-dispatch需保留，未授權自行送訊息 | 離線＋操作授權 | 先mock/source與reconciliation，正式送出只在明確相應操作授權後 |
| T-01 | caption→ASR→OCR完整stage、來源/segment/成本schema、adapter/queue/budget/重試及簡繁詞對應尚未完成 | 離線 | 依post-cutover backlog先phase plan與mock，所有external execution off；AI詞不混入tag主要池 |
| T-02 | content/timestamp UI、跨片/台提及、daily coverage/budget、persistence/peak/decay與stance框架仍待stage實作/逐頁review | 離線→名額／鎖 | 原始觀測/null/negative保留，公開僅短摘摘要；全文transcript私人，沒有來源不捏造coverage |
| T-03 | transcript/providers/GPU實際執行與正式schema/workflow發布尚未進行 | 操作授權＋名額／鎖 | 完成前置writer handoff與備份後逐adapter啟用；不使用Mac筆電算力、CCLabPC不作常規worker |

## 此輪立即推進與下一順位

現在不是「只剩等待名額／上游」。可離線項目包括正式增量與正規化、別名、覆核套用、
API key/cursor、runtime backend、fixture及capture移植等；本輪先修V-01、R-01、R-06，
都經既有獨立 reviewer後提交。接著R-02/R-03/R-07與V-03/V-04分小批推進。
未執行的功能維持pending，沒有把規劃欄位補true。

執行時基準：2026-10-13T05:47Z、DNT1抓完整首頁HTML五次取time_total中位數，
tag0.256s→2.0s、blog3.085s→6.17s、YT0.289s→2.0s。
blog包含origin/Cloudflare edge/網路，不是精確origin渲染耗時。
全站1build/2browsers、load≤12、任一5xx/timeout/unknown拒絕、建置40→30GiB、
nice19/ionicec3/Next≤2；所有舊release/回滾/backup/worktree/原始證據保留。

盤點參照：`f2-offline-findings-2026-10-13.md`、`quality-candidate-operations.md`、
`vocabulary-full-pool-preparation-2026-10-13.md`、`keyword-relations-integration.md`、
`api-release-2026-10-13.md`、`sitemaps.md`、`analytics.md`、
`mobile-performance-2026-10-13.md`、`post-cutover-stage-backlog.md`與
`docs/ui-review-ledger.json`。歷史時間/版本的正常回應不推定當前runtime。
