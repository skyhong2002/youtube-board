# 首頁關鍵字快照、關鍵字頁掃描一次（2026-10-24，只換 web）

接續 `release-home-cache-e68b57c-2026-10-24.md`。使用者要求三件事都做：
1. 重啟後立刻有首頁資料；
2. 讓首頁計算變輕；
3. 修關鍵字明細頁的逾時。

## 變更

- main：`344193e`、`a6b516f`。另外補上只在 release 分支、已在正式環境的 `1720243`，main 上是 cherry-pick。
- release 分支：`release/home-snapshot-344193e` = `d007cfb`（e68b57c + 344193e + a6b516f）。

### 1. 首頁關鍵字快照存進資料庫（`344193e`）

- 正式 web 刻意不接 Redis（Redis 存的是排程佇列），所以上一版的 Redis 副本改成一列 TS 資料表 `ts_home_keyword_snapshot`（id、computed_at_ms、payload）。
  - 由 own-state 帳號 `youtube_ts_state` 經 `TS_DATABASE_URL` 讀寫。
  - 沒有 `TS_DATABASE_URL` 時停用，所以測試和本機不會讀到別處算的排行。
- `jobs/migrations/018_home_keyword_snapshot.sql`；`frontend-schema.mjs` 的 accountWrites 加上這張表（INSERT/UPDATE/DELETE，另有 SELECT）。
- 升級工具 `tools/home-keyword-snapshot-upgrade.mjs`：建表並授權，前後都用 `verifyGrants` 完整比對。

### 2. 首頁計算本身（沒有改程式）

- 在正式資料庫實測 `home-term-labels` 和 `home-ranking` 的 SQL：
  - 先線上加上涵蓋索引 `evidence_ranking (video_id, vocabulary_version, rule_version, term)`；EXPLAIN 確認是 index-only。
  - 輪流量測（load 4–6）：有索引 4.4–12.2 秒，主鍵 5.0–6.5 秒，看不出改善。
- 瓶頸是主機 CPU（2 核心，load 4–8），不是讀取量：buffer pool 3 GB，命中率 99.97%。
- 所以已移除索引（14:42Z，`ALGORITHM=INPLACE, LOCK=NONE`），evidence 表回到原本的 PRIMARY 和 version_term。
- 改用詞彙表取標籤雖然更快，但會改變首頁已公開的「排除詞數」統計的意思，沒有採用。
- 計算維持在背景每 10 分鐘一次、只佔一條連線（見上一版）。

### 3. 關鍵字明細頁（`344193e`、`a6b516f`）

- **舊做法：** `loadDerivedSource` 用字串比對預篩候選影片，同一段期間要整段掃描並計算雜湊 3 次：大小、讀取、再讀一次確認。
  - 以「賴清德」30 天實測：14.3 萬部中 3,980 部符合，大小 2.1 秒、讀取 3.3 秒。再讀一次也要一樣久，而時限是 5 秒。
  - 舊 web task 的 log 有 109 次 `derived-keyword-source` 逾時。
- **新做法：** 預篩只掃一次，取得 pk 和大小，時限 10 秒。之後兩次讀取改成 `v.pk IN (...) AND 原條件`，只做主鍵查詢。
- **語意差異：** 第二次讀取只確認這些已選中的影片。兩次讀取之間新發布的影片會留到下一次推算。

## 測試

- api vitest：894 pass、0 fail；`tsc` 0 錯誤。
- tools：110 pass、0 fail。
- 本機 MariaDB 整合測試：
  - `derived-cache` 23/23
  - `keyword-alias-database` 5/5
  - `home-exploration` 21/21（上一版的 JSON_TABLE 改動也一併驗證）
  - `home-keyword-store` 2/2：寫入、覆寫、清除，表不存在時當作冷啟動

## 正式環境變更（UTC）

- **14:52:48 權限備份：** `skyhong-blog:/home/ubuntu/backups/services/home-keyword-snapshot-20261024T145248Z/principals/`
- **14:52:53 升級工具：** plan `b85db816…`。建立 `ts_home_keyword_snapshot`；`youtube_ts_state` 取得 SELECT 和 INSERT/UPDATE/DELETE，前後比對一致。
- **候選容器：** 18179，唯讀，排行池直連。
  - 第一次啟動 58 秒時寫入快照（87,474 bytes）。
  - 重啟後 ready（37 秒）時，`/api/v1/home` 0.07 秒就回 synchronized、40 筆，用的是快照。
  - 關鍵字頁沒有任何 `data-source-failure`。「颱風」cloud 5.1 秒算完，狀態是 `incomplete-evidence`：30 天裡有影片還沒比對過，不再是逾時。其他 0.06–1.0 秒。
- **映像：** `youtube-board-ts:release-snap-d007cfb` = `sha256:e9eb081ead23d762c80737bbff3994767b74e8ad8fd9f13da1c7e7e3a2fd1003`。
  - 以 `release-home-e68b57c` 為基底，覆蓋 4 個檔：`api/src/app.ts`、`home-keyword-store.ts`、`home-keyword-cache.ts`、`derived-cache.ts`。和基底比對，只有這 4 個檔不同。
- **14:58:30 換 web：** `66a36512…` 換成 `e9eb081e…`。
  - 換版後第一個請求 `/` 就是 200，用的是資料庫快照；keywords 和 keywordToday 都是 synchronized、40 筆。
- **回復：**
  ```
  release-service-image.py --service=web --old=sha256:e9eb081ead23d762c80737bbff3994767b74e8ad8fd9f13da1c7e7e3a2fd1003 --new=sha256:66a36512ea4f8165d49e49d5257e60585b52d8ceb8c5f80c5608e40d7b27120d --title=Rollback --execute
  ```
  快照表留著不影響舊版本。
