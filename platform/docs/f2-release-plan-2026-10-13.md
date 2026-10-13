# F2 小批發布與回退計畫

目前正式基線：`7eb48f4`，映像 `sha256:5b7d9171d9633c132766c65abd934c791787693a72b7f016bcd1408097dedadd`。候選由 `b6881ce` 後代建立，包含既有市長分享頁與導覽調整；不使用另一個 thread 的 `7d4d945` 映像。

## 第一批：公開排行與命中依據

- 讀取既有正式資料，沿用目前詞庫版本；加入可解釋的顯示排除、標題 3／說明 1 加權、同頻道 1、0.5、0.25… 遞減。保留來源詞及舊 evidence。舊規則的頁面必須明示尚未套用品質 v2 描述去樣板。
- 支持影片以批次查詢最多 50 支、每支最多 3 個短命中片段，不逐列發出查詢。缺觀看合計顯示「無觀看值」，已知小計另外標示。
- 公開首頁資料採單一讀取合併與 60 秒有上限快取。只保留完整成功的公開 DTO，個別回應深複製；私人回應的 HTTP cache 邊界完全不变。分開報告首次查詢與暖快取延遲，不能把暖快取數字說成冷查詢數字。
- 前端由獨立 Opus 5.5 CLI 實作。候選使用唯讀來源、既有 TS schema，不開背景工作；只綁主機 loopback，保留資源上限、cap_drop、唯讀根目錄及 tmpfs。
- 獨立 Playwright 驗收 DNT=1、先封鎖 GA/GTM、零外送；1280／390、明／暗模式及主要空／錯誤狀態與 tag 參考畫面交獨立 Opus 或 GPT-6.1 Sol 審查，附 transcript、SHA、截圖。未審或未通過不得稱完成。
- 建置前確認 /home 至少 10GB；nice 19／ionice idle，與備份還原串行。只封裝乾淨工作樹的指定 commit 與其驗證過的 Next 輸出，不納入髒的主工作樹。
- 部署前檢查 `git diff --stat 7eb48f4..<candidate>` 完整差異；只經 Dokploy 更新既有 TS compose 的 pinned image，維持 env、掛載與路由。不得 docker service update。Laravel scheduler、DB 權限、Cloudflare 均不變。
- 上線後檢查 `/`、`/keywords`、實際詞的支持影片、`/vocabulary`、`/mayor` 分享與導覽；確認健康、API 私人快取邊界、sitemap、tag/blog 200。等 babysit 真正瀏覽器驗收，再記為正式可見。

## 第二批：候選品質比對資料

這批才會寫 TS 自有狀態。先完成新的 TS 資料、帳號授權、view 與稽核 trigger 備份，離機實際還原並驗證行為；來源資料庫沿用已保留的一致性備份，本批不寫來源資料。

1. 以既有最小權限 vocabulary worker、既有 execute gates 與 writer lock 建立不可变候選版本，引用完全相同的來源標籤池。不移動 current 指標。
2. recent matcher 明確指定候選版本、小批 dry-run → execute，沿用既有全日預算，獨立 checkpoint；不因新版本重置預算。保留原始片段、上下文排除原因及樣板取樣依據。
3. 在候選上確認 SQL 延遲、實際覆蓋率、前後 20 名、正常「24小時」語境與樣板排除。任何失敗保留舊版本 serving。
4. 確认仍持有 vocabulary/video locks、current 仍等於预期 parent、候選條件通過後，原子移動 current 指標。舊詞庫與 evidence 不刪除；記錄 UTC、版本與驗證證據。
5. 新資料也要重新檢查候選畫面、公開再生後的內容與來源／規則標示，才做正式驗收。

## 回退

- 程式：經 Dokploy 把兩個既有 TS compose service 的 image 改回上述基線 digest，Deploy；保留所有既有 env／掛載／路由。驗證健康與公開頁面。不要回寫 Laravel 資料。
- 資料：停候選批次，以相同受控指令與 writer locks，把 current 從確切候選 CAS 回原 parent；不得改寫或刪除任一版本的 evidence。等最長 60 秒資料快取與公開 ISR 週期，確認來源版本恢復。
- 備份還原只在確認資料損毁時採用隔離驗證後的回復程序；正常程式／版本回退不需覆盖正式資料庫。

## 尚未完成的完整 F2 範圍

管理員覆核／覆寫、tag person／tag-groups 身分別名整合仍要後續小批實作及 review，不因第一批頁面上線就宣稱完整 F2 已完成。全量詞庫匯入維持背景準備，不擋住此批。所有 UI 頁面的 ledger 範圍不縮減；優先級只是順序。

## 第一批 Opus blockers 查核（2026-10-12 19:39 UTC）

- B1：Dokploy compose 只更新 web 與 account-maintenance；`RUNTIME_ROLE=web`，scheduler／ingestion gates 均 false，write allowlist 空。既有 presentation controller 仍固定 worker 映像 `sha256:17946f9366a4fd43ea49d0d4c52770546d527c6ce8b167a362c0bc73a6f0d6de`，本批不更新該 controller、排程或 worker。正式主機 systemd timers／units 及 /etc/cron.d 沒有 YT presentation matcher 定義。不得把新 v2-only jobs 當成既有 v1 worker 的替代品；正式 v1 呼叫者保持原固定映像。
- B2：v1／v2 支持影片查詢都讀取池內實際原始 term key，ASCII 大小寫只合併顯示，不猜測來源 key。實際 MariaDB 測試證明兩種規則下首頁合併數與支持影片 total 相同；正式唯讀 AI 查詢為 **1,161 = 1,161**，來源 identities lookup 兩次讀取共 **77 ms**。
- B3：首頁與支持影片覆蓋率都加入相同 byte-exact newest-pk 條件。測試用 connection-local 非唯一影片表重現舊／新 duplicate，確認 denominator 不重複計數，舊 marker 不冒充新資料。35 個 focused tests 通過。正式最新 probe 首頁8個SQL合計 **4,059 ms**（來源掃描897ms、主要排行2,311ms）；這是未命中應用快取的串行SQL耗時，不是暖HTTP延遲。
- B4：`worker-permissions.json` 只新增 generic matcher 未啟用設定的稽核表權限定義。web launcher、server、account-maintenance 不呼叫 schema／grant 工具；本批不執行 migration、grant 或 worker bootstrap。既有 schema 不變，基線映像可直接回退。第二批 writer 啟用仍需另行備份、review 與最小權限確認。

證據保存在 ignored 的 `platform/.local/f2/caller-audit.json`、`shadow-benchmark-blockers.json`、`blocker-tests.log`；沒有環境秘密。HTTP暖快取負載與候選UI仍待驗證，不能將上述SQL測試當作上線驗收。

## 候選執行期驗證（2026-10-12 20:07 UTC，尚未部署）

- 程式 `7f1b5db609551362a2b26658e1cabe208f2870d0`，前端輸出 `536b909a8a2069bd2a383bece1184600a41c21bd`；候選映像 `sha256:13ae0d01ddb241119e8715393a1f4c0b58987e2670e5b93c5a9ab31704889a00`。重新合併封裝為 95 層，避免前次 128 層超過 Docker overlay 上限；1,252 個封裝檔逐一 SHA-256 比對通過。這是候選，不是正式部署紀錄。
- Webpack 的 canonical 編碼動態路徑以同一個實際檔案雜湊加入 manifest；16 支實際 script 經 gateway 讀出的內容與 SRI 全部相符，沒有放寬 CSP。Opus 獨立 review 有實際返回意見並通過。
- 首頁 DTO 共用 metadata 物件曾被 bounded cache 誤判成 cycle，造成每次重跑查詢。改以祖先路徑判斷真正循環；重複物件的每次 JSON 出現仍各自計入大小預算。11 個 focused tests、API typecheck 及 Opus 獨立 review 通過。
- 20:05:26–20:05:50 UTC，候選有限負載（每類 10 次、總併發 2）：暖首頁 API p95 **295 ms**（修正前 **4,789 ms**），沈伯洋支持影片 p95 **262 ms**。首次 `/keywords` HTML（包含冷查詢與 ISR 產生）**6,860 ms**；不把暖快取數字當作冷啟動結果。先前 SQL probe 的 8,322 ms 外層耗時含八次故意加入的 500 ms 節流，SQL 本身合計 4,059 ms。
- 匿名 API `public, max-age=0, s-maxage=60, stale-while-revalidate=120`；Cookie、Authorization、X-Api-Key、X-Service-Token、RSC 五種請求皆 `private, no-store`。候選 `/runtime/ready` 在 sitemap warmup 後回 200。
- 既有 TS recent worker 狀態唯讀查核只看到 12:17 的 running/reserved 紀錄，不能據此宣稱持續成功執行；本批不替換既有固定 worker，也不啟用新 writer。Laravel scheduler 不變。
- 發布前已讀 Dokploy application metadata：Laravel Web `autoDeploy=false`，TS compose 同為手動發布；push 不應啟動 Laravel migration。
- UI 修正與新 SHA review 尚在進行。舊截圖只能證明其受審 SHA／狀態；channel 407 的 static-visual pass 不涵蓋登入、互動或其他狀態。完整 route 不宣稱完成。

證據：ignored `platform/.local/f2/image-consolidated-proof.json`、`candidate-cache-proof.json`、`candidate-cache-http-check.json`、`opus-webpack-csp-result.json`、`opus-home-cache-result.json`。快照離機還原結果另見 [備份驗證](f2-backup-verification-2026-10-13.md)。

## 最終候選組件一致性（2026-10-12 20:18–20:19 UTC）

- 程式與前端均為 `729bcf78f6218851dee7757fb5ca9be0042c44ce`，BUILD_ID `plLXEQDQ9IC3eyI7SxLXo`。候選映像固定為 `sha256:f85bcd157e6d1905c8160d501188b560818379e411cdb729b1463dae4d27f5e0`，95 層。
- 1,393 個封裝檔案雜湊全部相符；再於執行中的候選容器比較 1,361 個前端／執行期檔案，包含 standalone server、58 個 static chunks、17 個 server chunks、56 個 manifests。36 個 app entry 與 build manifest 的 7 個 chunk reference 均存在。這些檔案綁定同一份建置 proof；套件本身沒有 BUILD_ID，以相同建置輸入的檔案雜湊與實際解析路徑綁定。
- 實際 require resolution：Next **16.3.8**、React／React DOM **19.2.8**，均由 standalone node_modules 載入。React 套件 70 個檔案也在該目錄以同一份建置依賴封裝；沒有只靠版本號推定內容一致。
- 候選 read-only、cap-drop ALL、PID 1 `NoNewPrivs: 1`，資源限制保留。正式 PID 1 實測也是 `NoNewPrivs: 1`（entrypoint 設定，Docker inspect 的 SecurityOpt 為 null 不能直接判成沒有保護）。發布只改兩個 service 的 image，完整比對其餘設定、GA runtime env、crawler bind、掛載、入口與 writer 設定不變。
- 候選 crawler 使用隔離的持久化 host 目錄，mount target 與正式相同 `/var/log/youtube-board/crawlers`；不把候選紀錄寫入正式紀錄目錄。候選 OAuth 停用、runtime GA ID 留空，前端 hostname/DNT 與擷取的 GA/GTM 封鎖仍保留；正式 GA 設定不改。
- 核心 canary：首頁、`/keywords`、`/keywords/沈伯洋/videos`、`/channels`、`/videos`、`/live/current`、`/mayor` 均 HTTP 200、CSP 與 Vary 存在；16 支 script SRI 一致。直播導覽的實際路徑為 `/live/current`，`/live` 既有路徑則回 404，沒有將該 404 算成直播頁通過。
- 真實 source `https://i.ytimg.com/vi/ZToV_P7PTcA/mqdefault.jpg` 回 404，Next optimizer 對同一來源也回 404。保留來源 URL／錯誤證據，不試探其他 variants。新 UI 將 missing／pending／loaded／error 分開；只有自然尺寸大於零的 loaded 圖片算真實圖片，SVG fallback 不列入成功圖片驗收。
- 最新前端修正由 Opus 5.5 執行，31 項 focused tests 通過，整體 webpack build（含 TypeScript）通過。核心 HTTP 通過不等於 UI review 通過；新 SHA 截圖與空／錯誤狀態的獨立 review 仍是部署前置條件。

私有證據：`platform/.local/f2/final-artifact-consistency.json`、`image-final-runtime-proof.json`、`candidate-final-runtime-http-check.json`；縮圖原始回應與 DOM fallback 證據在 `/home/deck/.cache/youtube-ui-review/ui_ledger-2026-10-13/candidate-image-target-7f1b5db/`。截圖不入 Git。

## 修正後候選（2026-10-12 20:54–20:58 UTC，未部署）

- 程式／前端 SHA `654cdf5c9829f2a5f884b063b117e6f6e0403e34`，BUILD_ID `2FFvSyVcDfwEmllyRVVv1`；映像 `sha256:184ffb87caedfcb714cb4c2524cd26c5cafc735d09e6e6fc41a6af855da73e06`，95 層。與正式 `7eb48f4` 的完整差異為 103 個檔案，沒有 migration 或 infra 變更；未提交的第二批 jobs 修正不在此映像。
- 實際執行容器內 1,393 個檔案全部 SHA-256 相符：standalone server、58 static chunks、17 server chunks、56 manifests，36 app entry 與 7 build chunk reference 均存在。Next 16.3.8、React／React DOM 19.2.8 由相同建置的 standalone 依賴解析。新舊映像的完整 Config 除 revision label 外相同，保留 User、Entrypoint、Cmd、Env、Healthcheck、WorkingDir 與 ExposedPorts。
- 本批前端由 Opus 5.5 CLI 實作：手機頻道表優先保留頭像與名稱，影片／直播表讓次要縮圖或排名讓位給識別資訊；首頁排行不再讓短詞擠成多行。表格仍為單行，首欄 9.5rem／橫捲後 5.5rem。
- 市長占比與原始量圖直接使用 `rows[].observedBuckets`，每日期的分母為 4 個分類 × 7 日＝28 個分類日桶。未完整／未知來源以虛線與空心點標示，摘要與圖表旁列出實際涵蓋數；完整區間不被虛線跨越。保留真實零值；任一候選人缺值時不推算 100% 占比。原始表格數值保留。
- 乾淨驗證工作樹的前端 209 項測試通過，單一 CPU、nice 19、ionice idle 的 webpack build／TypeScript 檢查通過。API 938 通過、jobs 261 通過／4 skip 的測試來源是 `729bcf7`；`git diff 729bcf7..654cdf5 -- platform/api platform/jobs platform/shared` 為空，沒有把不同後端來源的測試冒充新結果。
- 核心 7 頁均 200，HTML 包含本次 BUILD_ID；104 次外部 script 檢查（17 個不同檔案）的 SRI 與所有執行型 inline script 的 CSP hash 相符，沒有放寬 strict-dynamic。匿名 API 可共享，Cookie／Authorization／X-Api-Key／X-Service-Token／RSC 均 private/no-store，`/my` 同樣不可共享。
- 本次首次冷首頁 **11,197 ms**；其餘核心頁 **226–1,735 ms**。冷啟動時同時建立 sitemap，不能將冷首頁說成小於 2 秒或以暖快取數字替代。首次 readiness 曾為 503，待 sitemap warmup 後實際確認 ready。
- 此 SHA 的新畫面審查仍 pending。20:56:45 UTC 的截圖嘗試在瀏覽器啟動前被效能閘門拒絕（load 15.95、blog timing probe timeout）；沒有截圖、沒有略過守門條件，舊 SHA 的 review 不轉用。正式仍為 `7eb48f4`。

### 部署與回退補充

- 發布工具只對既有 compose 的兩行 image 做精確替換，部署前綁定 image、commit、BUILD_ID、完整 artifact proof 與獨立 review 收據的雜湊。先記錄 prepared／compose-updated／deploy-requested 階段，失敗也保留回退依據；只走 Dokploy。
- 執行期比較整份 Swarm Spec（只排除 Image、衍生的 stack image label 與 ForceUpdate），涵蓋 env、掛載、路由、網路、resources、更新／回退策略。另比較本機 presentation controller 的內容雜湊／固定 worker image，及正式主機三個 controller/schema 工具檔雜湊；執行中的 worker 依名稱識別，不能先按 image 篩選再聲稱 image 一致。
- 基線 image 已另存為 Docker 之外的 868,119,040-byte 封存檔，SHA-256 `78714eb474d3c78e8dbb613af0a21da9faf8b4bb1a1461789a86bc29f01f9967`，權限 0600；實際讀回檢查大小、SHA-256 與 tar 中 image config 的雜湊等於原固定 digest。Docker image prune 不會移除這份檔案。這是程式映像的回退封存，不冒充資料庫備份；原資料库與所有備份保留。
- 回退工具預設 dry-run；已用相同驗證函式模擬 image 替換來回，env、command、read_only 三種漂移皆被拒絕。實際部署後再跑一次真實設定的 dry-run，並在正式容器重新比對全部 artifacts、公開 canary、115 個 OpenAPI endpoint 與 17 個 sitemap 子檔；未完成不得宣稱正式驗收。

私有證據：`platform/.local/f2/{image-654cdf5-runtime-proof,artifact-654cdf5-all-files,candidate-canary-654cdf5,test-provenance-654cdf5,runtime-before-v3,rollback-image-archive,rollback-dry-run-proof}.json`。Opus 執行與獨立審查紀錄、截圖均保留在 Git 外；逐頁範圍見根目錄 `docs/ui-review-ledger.md`。

## 磁碟凍結期間的審查（2026-10-12 21:30 UTC）

- 使用者澄清：凍結禁止新建置、映像／Docker layer、資料匯出、release 複製、部署及預估超過 500 MB 的 artifact；不禁止閱讀既有截圖與獨立逐頁 review。解除須由使用者／babysit 明確通知，不能由代理自行推定。
- 新擷取僅用已存在的候選與 release。每批先估算大小，保留至少 112.5 GiB 的可用空間及批次預估餘裕（依後續使用者收緊門檻），避免逼近備份的約 111.5 GiB 門檻；同時維持全站最多兩個瀏覽器、1 分鐘 load 不超過 12，以及 blog 整頁 totalSeconds ≤2 秒閘門（後續更正，不能只看 TTFB）。DNT=1、啟動前封鎖 GA／GTM、零分析傳輸證據不變。任何條件不滿足即停止新擷取，改做離線 review。
- 21:30 UTC 核對：`654cdf5` 新截圖仍為零，先前擷取均在瀏覽器啟動前被拒絕；既有 `729bcf7` 截圖不可改標或轉作新 SHA 通過證據。新候選仍可連線，按小批擷取、逐批交給獨立 reviewer 的順序繼續。
- 每頁須有實際桌機／手機圖像輸入、對應 tag 參考、model、受審 SHA、時間及返回的 review transcript 才算該範圍審查；code sanity、thread 完成訊息或單純 HTTP 200 均不能取代。

### 凍結中新增的真實審查與尚未建置修正

- 真正 `654cdf5` 候選圖從 21:33 UTC 開始擷取；12 組亮色頁面／狀態已完成 manifest，獨立審查者逐張看圖並記錄 model、時間、來源 SHA、BUILD_ID、image digest 與輸入檔案雜湊。既有 `729bcf7` 圖未改標；原 tag 參考圖保留其時間與路徑。深色部分檔案尚未形成完整 pair，不能計通過。
- 全站 ledger 的正式環境紀錄仍為 25 reviewed／325 pending／0 完整 route。候選 scoped review 另列；手機直播無法區分同頻道的影片、今日排行曾顯示 unavailable（原始觸發及快取因果未留證），均仍是本候選的阻擋項。詞彙觀測的媒體 ID 可讀性也是未關閉問題。
- 門檻依使用者後續指示收緊為可用空間至少 **112.5 GiB**、load ≤12、任一站 5xx／無法確認可用就停止新擷取，新增 capture artifact 總計不得超過 300 MB。閘門已因容量不足停止擷取，既有檔案全保留；不刪檔、不修改備份、不自行解除凍結。
- 工作樹原始碼已由 Opus 5.5 修正 LIVE 首欄為頭像與原始標題，頻道名稱仍在獨立頻道欄；不放寬 9.5rem／5.5rem。另一個 Opus instance 加入 ISR `home` 完整度檢查：`categories`／`keywords`／`keywordToday` 任一 `unavailable` 時拒絕寫入快取，保留非 ISR 的降級顯示與合法空資料。Codex 將同類 API 部分成功回應標為 `private, no-store`，保持原 200／partial 資料契約。
- 相關 API 14 項、前端 20 項測試通過，兩者 `tsc --noEmit --incremental false` 通過；均以低優先權執行，型別檢查限制單一 CPU。沒有建置、image、release 複製或部署。這些是未建置的 source-only 修正，不能據此關閉 `654cdf5` 的 UI 問題；仍需獨立 code review、後續新 SHA 建置與畫面複驗。
- 證據：Git 外的 `platform/.local/f2/freeze-source-fixes-proof.json` 及 `opus-live-identity-followup-result.json`、`opus-partial-isr-cache-result.json`；候選 review 的實際檔案路徑與受審範圍在 `docs/ui-review-ledger.json`。原始查詢為何短暫失敗尚未證明，不能把現在讀取成功當作當時資料庫原因已查明。

- 後續獨立 GPT-6.1 Sol 七檔 code review 已實際返回，未發現阻擋程式缺陷；收據 `/home/deck/.cache/youtube-ui-review/ui_core_review-2026-10-13/source-review-seven-files.json` 綁定七檔雜湊與時間。限制：沒有清除既有外部／Full Route Cache，也沒有替 stale 供應增加時效上限；直播的共同標題前綴仍必須在新畫面驗證。本次 code review 不替代 UI review，不關閉目前候選的 issue。

- 最新使用者絕對停止指示優先於前述條件式擷取閘門：不得新增任何截圖／capture，即使容量／load 自行恢復也不重啟。只做既有圖像離線 review、小型程式碼／文件修正；等明確通知才變更停止狀態。


## 2026-10-13 延長授權：凍結中完成、解凍後單次建置

使用者將實作窗口延長到台北18:50（UTC10:50）；**這不是解除磁碟凍結**。禁止新的build/image/staging/capture/正式probe/大型寫入，禁止刪檔與操作tag-backup。所有驗證只能既有隔離資料庫或mock；本批優先mock。`b688739`已提交四項finding修正，但沒有新runtime驗收。

發布順序為F2狀態 → Y2 relations介面 → 管理員關鍵字覆核。前端由Opus5.5實作；作者以外instance做獨立source review。Source tests/review與candidate視覺review分欄，ledger統一維持待重拍，不能把來源review算成頁面pass。

### 解凍前檢查

- F2：首頁Today/Week、`/keywords`排行、實際支持影片頁，覆蓋亮／暗、loading、empty、unavailable、null觀測值；用mock驗證資料狀態，原mixed-period finding持續open。
- Y2：固定tag F1 OpenAPI來源SHA與契約hash；adapter mock涵蓋disabled、未部署404、429/Retry-After、timeout、invalid payload、forward-compatible新增欄位。is-a有方向，related不是共現，alias不自動合併人物ID。開關預設false；不把未啟用假裝成空relations。
- 覆核：只使用既有session-admin與CSRF；只寫TS自有review/audit，不改tag池與Laravel來源。所有proposal呈現applied=false，審核不冒充已套用公開排名；feature/write gate預設false，未執行schema migration/授權。後續套用需要另外的受控發布及證據。
- 每個新增UI route及重要狀態列入ledger待重拍；沒有可驗證exact新SHA圖片便保持missing/pending。所有PNG在Git外；既有證據不得覆寫。

### 收到明確解凍通知後

1. 重新核對使用者指定磁碟門檻與共享負載/單一build時段；僅建置一個包含已審查提交的候選，nice19/ionicec3。候選程式、standalone/chunks/manifests、Next/React由同次build綁定；記錄SHA、BUILD_ID與pinned digest。
2. 保留read-only、no-new-privileges、cap_drop、limits、CSP、GA guards、crawler volume；候選繼續關閉任何背景job及新review寫入gate。若要驗證admin寫入，僅既有隔離DB/mock，不能用正式寫入驗證。
3. 用唯一新capture目錄及修正後腳本；DNT1，預先Google阻擋，保存有上限且去識別request lifecycle；zero-GA未知即不驗收。每批blog整頁≤2s、load≤12、無5xx；全站最多2個瀏覽器。舊hard-stop必須在明確通知後才調整。
4. 各頁1280/390及所需狀態交獨立reviewer，對照tag實圖；有issue就修正，不能為追求一次build而略過失敗。一次建置是準備目標，不是通過保證。
5. 全差異`git diff --stat 7eb48f4..<candidate>`、完整source/artifact/test/review收據核對後，只走Dokploy更新既有TS compose。Laravel scheduler/AutoDeploy/Cloudflare均維持。公開API credential/no-store邊界、sitemap、mayor導覽一併回歸；正式browser驗收前不稱完成。

### 回退與未啟用功能

- 程式仍回退到已保留的正式digest，走Dokploy並維持runtime環境與volume。不得docker service update，不動retained Laravel scheduler。
- Y2開關false立即停止新upstream relations呼叫；原影片/詞庫/evidence功能保留。不得因tag尚未發布而偷開來源或改tag。
- 覆核預設disabled；migration只新增TS自有表且不在本批自動startup執行。不執行grant、不新增帳號。若後續正式啟用，先用既有批准程序驗證備份、restore、最小權限及feature gate，再小批上線。回退關閉writes，保留提案與audit，禁止drop表清理。


凍結中source提交：`59a7d1b`（Y2及admin後端）和`b0d2762`（F2狀態）。
最終candidate必須從明確已提交／review的SHA建立，不能直接把dirty worktree
或其他尚未獨立review的quality/jobs變更裝進image；保留那些既有檔案，不刪除。
本批Y2 enabled回應全部private/no-store，上游未驗證部署前gate保持false；
完整cache／reload／rollback限制見`keyword-relations-integration.md`。


### 本輪已提交 source 與驗證

| 範圍 | Commit | 離線驗證 |
| --- | --- | --- |
| Y2 adapter/API + 覆核後端 | `59a7d1b` | 81項相關mock/contract tests、API noEmit；116schemas/5examples，0外部請求 |
| F2深色/pending/empty/error/unknown | `b0d2762` | 最後修正後44項focused tests、web noEmit；此前86項屬較早hash |
| 管理員覆核console | `5d92387` | 66項mock/SSR/guard tests、web noEmit |
| Y2可選關聯UI | `ba6069d` | 75項focused tests、web noEmit；獨立reviewer另跑15項 |

不同批次測試有重疊，不把表格數字相加當唯一測試數。全部scope有作者以外
Opus5.5或GPT-6.1 Sol的source review，收據與hash見ledger frozenSourceReviews。
本輪仍無build、typegen、DB migration/grants、probe、capture或deployment；
實際瀏覽器狀態、runtime CSP與新BUILD_ID皆待驗，正式版未因此改變。

Source盤點固定在`ba6069d1e1430a6a55dfea1a8575f24ff4dd482c`；本文件與ledger由後續
文件commit固定。Plan reviewer原先指出的「UI還未commit、文件還未固定」
由上述提交及本文件commit解決；不是runtime批准。其餘dirty quality/jobs/
worker-permissions仍保留，不納入此candidate，不刪檔。候選從最終明確commit
產生，不能從dirty worktree打包。

解凍通知須涵蓋build、candidate staging和capture；在通知前繼續禁止所有三項。
解除後先保存來源SHA、單次BUILD_ID、standalone/chunks/manifests/Next/React
一致性與pinned image證據，再作獨立UI review。僅當source和實圖驗收皆通過，
才依前述Dokploy單一owner流程發布；如需修正則重走必要檢查，不能承諾一次build必過。
