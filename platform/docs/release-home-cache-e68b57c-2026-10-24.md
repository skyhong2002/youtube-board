# 首頁關鍵字快取（2026-10-24，只換 web）

## 起因

- 2026-10-24 約 07Z 起，首頁 `/` 和 `/keywords` 一直回 503（`HOME_SECTION_UNAVAILABLE`，keywords 區塊 `video-source` / `source-cap`），舊 web task 每小時約 40 次。使用者也說首頁常常讀不出來。
- **直接原因：** 首頁關鍵字一次讀出 14 天的影片，13:3xZ 時約 78k 部。10/22 `425ecfb` 恢復每頁 50 筆抓取後，每天收錄從約 5k 增加到 7.5k 部。
  - 解碼後的物件 JSON 超過 16 MiB（每列約 200 bytes，含每列重複的 vocabulary_version），觸發上限。
- **根本原因：** 放寬上限後，關鍵字計算在請求裡也做不完。以候選容器、正式資料、不設時限量測：

  | 步驟 | 時間 | 筆數 |
  | --- | --- | --- |
  | home-video-source | 2.3 s | 75,669 |
  | home-term-labels | 11.1 s | 10,907 |
  | home-ranking | 22.2 s | 5,382 |
  | home-daily-history | 3.9 s | 31,777 |
  | 合計 | 約 40 s | |

  請求端讀取的語句上限是 15 秒，Fastify 請求上限也是 15 秒。所以只要快取過期或 web 重啟，首頁就會失敗。

## 變更

- main：`4113b80`、`f2e0b83`。
- release 分支：`release/home-cache-4113b80` = `e68b57c`。從 `release/channel-names-ca6ad51` 開始，cherry-pick 這兩個 commit。

### `4113b80` 來源上限

- 影片來源上限改成 200k 列。位元組上限改為檢查每個實際送給 MariaDB 的 JSON_TABLE literal：12 MiB，`max_allowed_packet` 是 16 MiB。
- literal 不再每列帶 vocabulary_version；fresh 的列本來就已限定為目前版本。

### `f2e0b83` 背景計算與快取

- **背景讀取：** 關鍵字查詢改走獨立的背景讀取，`createReader(..., {acquireMs:3000, statementMs:60000}, {maxStatementMs:60000, connectionLimit:1})`。
  - 請求端讀取仍是 15 秒上限、6 條連線。
  - 背景讀取最多 60 秒、只有 1 條連線，用 `api/test/reader-deadline.test.ts` 鎖住。
- **快取：** `keywordWindowCache` 新鮮 10 分鐘。之後最多 6 小時內都直接回最後一次成功的結果，同時只跑一個背景重算。超過 6 小時才讓請求等待，算不出來就顯示 unavailable，不會無限期沿用舊排行。
- **管理員排除關鍵字：** 不再清空結果。下一次讀取時重算，算好之前先顯示原排行；原本的做法要等約 40 秒，會超過請求時限。
- **啟動預熱：** `runtime/server.ts` 傳 `homeWarmup:true`，啟動時先算一次首頁。
- **共享副本：** 可選的 `redisKeywordWindowStore`（`REDIS_URL`，key `yt-ts:home:keyword-windows:v1`，TTL 6 小時），讓重啟後可以從上一份開始。
  - 正式 web 的 `REDIS_URL` 是刻意留空的：Redis 存的是排程佇列，web 不接。所以正式環境沒有啟用，讀不到時就退回只用記憶體。

## 測試

- api vitest：889 pass、0 fail（`--testTimeout=60000`）；api `tsc` 和 runtime `tsc` 都是 0 錯誤。
- 新增的測試：
  - 背景讀取的時限上限；
  - 6 小時內回舊結果、只跑一個背景重算；
  - 共享副本：讀取一次、寫入、清除；讀取失敗或時間在未來時當作冷啟動；
  - 管理員排除後仍回原排行並重算；
  - 120k 列不再觸發上限，過大的 literal 仍會觸發。

## 建置與候選

- **映像：** `youtube-board-ts:release-home-e68b57c` = `sha256:66a36512ea4f8165d49e49d5257e60585b52d8ceb8c5f80c5608e40d7b27120d`。
  - 以 `release-names-ef11cd2` 為基底，只覆蓋 7 個檔：`api/src/app.ts`、`api/src/db/client.ts`、`api/src/reports/service.ts`、`home-exploration.ts`、`home-keyword-cache.ts`、`home-keyword-store.ts`（新檔）、`runtime/server.ts`。
  - 沒有 web/ 變更，不必重跑 next build。
  - 覆蓋前，線上這些檔案與 main 上的前一版雜湊相同。
- **候選容器：** 127.0.0.1:18179，唯讀，沒有 Redis；這次刻意不把 tag.observe.tw 指到本機，讓排行池和完整計算都實際跑過。
  - 38 秒 ready；57 秒時 `/api/v1/home` 的 keywords 已是 synchronized、40 筆。
  - 之後 `/` 0.08–0.2 秒、`/keywords` 0.2 秒；log 沒有錯誤；容器記憶體 413 MiB（上限 1 GiB）。

## 換版

- 14:13:49Z：`release-service-image.py --service=web --old=sha256:63e66873… --new=sha256:66a36512…`，執行前 load 4.5。
- 14:14:53Z：正式 `/` 回 200。`/keywords`、`/live/current`、`/channels/2902`、`/api` 都是 200。
- keywords 和 keywordToday 都是 synchronized、各 40 筆（來源 42,207 / 5,003 部），rankingPool available。
- **回復：**
  ```
  release-service-image.py --service=web --old=sha256:66a36512ea4f8165d49e49d5257e60585b52d8ceb8c5f80c5608e40d7b27120d --new=sha256:63e668735b560ffe7e3a1fc1605472d8d598ce032c37bdc182b4e7f9391759bb --title=Rollback --execute
  ```
  回到 `63e66873` 首頁會再次 503，因為它就是今天發生 `source-cap` 的版本。

## 之後

- 計算本身仍然很重，約 40 秒，且隨影片量增加。每 10 分鐘在背景跑一次，同一時間只有一條連線。
- 長期可以改成：
  - 由 worker 預先算好寫入資料表；
  - 或拆分 `home-ranking` 查詢（例如依頻道分組再合併）。
- 若要讓 web 重啟後立刻有資料，可以把最後一份存在 TS 資料表，由 web 的 state 帳號寫入，不必讓 web 接 Redis。
