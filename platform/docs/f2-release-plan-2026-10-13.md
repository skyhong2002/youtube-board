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
