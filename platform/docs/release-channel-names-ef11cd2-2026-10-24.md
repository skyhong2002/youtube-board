# 頻道名稱紀錄與頻道分析卡片（2026-10-24）

## 起因

- **名稱紀錄：** 10/24 一次性更新頻道名稱後（`release-channel-profiles-447990a-2026-10-24.md`），使用者發現有些頻道改名後意思差很多，例如 u_id 91「村長詹江村」改成「多肉團購直播台」。所以要在頻道頁記下每個名稱，以及當時的頭像。
- **分析卡片：** 頻道頁「頻道分析與資料範圍」在沒有分析時，每張卡都把 API 的長篇方法說明整段印出（「本頁只讀取既有 AI 分析…divergedSources…」），版面很怪。

## 變更

- main：
  - `ea631eb`：分析卡片。
  - `ca6ad51`：名稱紀錄。
  - `bd9a2db` 和它的還原 `9a1895c`，說明見下方「插曲」。
- release 分支：`release/channel-names-ca6ad51`
  - 從正式 web 的 `5f78c3e` 開始，依序 cherry-pick `447990a`、`ea631eb`、`ca6ad51`，得到 `ef11cd2`。
  - 之後再加上 `bd9a2db` 和它的還原，web 的建置來源仍是 `ef11cd2`。

### 頻道分析卡片（`ea631eb`）

- 卡片不再顯示 API 的方法說明；那些說明本來就寫在頁尾方法區的「頻道分析」。只有資料來源不可用時（AI 發布紀錄未設定、超過範圍），才顯示一行提示。
- 只顯示有內容的卡片；缺的那幾項合成一行「尚無既有分析：…」。四項都沒有時，只剩一行「這個頻道目前沒有可呈現的 AI 分析」。
- 卡片的其他調整：
  - 標題和連結在同一行，連結改成小字的品牌色。
  - 沒有更新時間就不顯示，不再出現「更新 未記錄」。
  - 同一張卡的來源都相同時，只在標題下列一次。
  - 人物的模型評價改成標籤。

### 名稱紀錄（`ca6ad51`）

- **資料表：** `youtube_board_ts.ts_channel_title_history`（id、u_id、title、observed_at UTC、origin）。
  - migration 是 `jobs/migrations/017_channel_title_history.sql`，也同步加到 `migrations/002-frontend-state.sql`。
- **寫入：** `youtube.channels.stats` 在更新 `urt_channel` 之前，若 API 名稱和目前存的不同，就先寫入紀錄（`recordTitleChange`）。
  - 先寫紀錄，所以 urt_channel 寫入失敗時，重試不會漏掉這次改名；最新一筆已是這個名稱時就不再重寫。
  - 頻道第一次被記到改名時，同時補一筆收錄時的名稱，`origin=added`，日期是 legacy `ctime` 換成 UTC。
- **讀取：** API `channel` 回傳 `nameHistory`（最多 50 筆，新的在前）；OpenAPI 的 ChannelDetail 也加了這個選填欄位。
  - 每筆的頭像，是下一個名稱出現前、本站最後快取到的頭像版本。頭像快取本來就會保留舊版本，最多 16 個。
  - 資料表或權限還沒建好時回傳 `null`，頁面不顯示這一區。
- **頁面：** 頻道頁側欄「名稱紀錄 N 個」，每列是日期、頭像、名稱，不用箭頭。先列 5 筆，其餘收進「更早的 N 個」。方法說明補上「名稱紀錄」。
- **權限：**
  - `worker-permissions.json`：`youtube.channels.stats` 加 `ts_channel_title_history: SELECT, INSERT`。
  - `frontend-schema.mjs`：`reportStateTables` 加這張表，report 帳號只有 SELECT。
- **升級工具：** `tools/channel-title-history-upgrade.mjs`，分兩段，每段前後都用 `verifyGrants` 完整比對。
  - `--phase=prepare`：建表、建 worker facade view、給 report SELECT。正在跑的 worker 權限不變，不受影響。
  - `--phase=worker`：給 `youtube_ts_w_youtube_source` SELECT/INSERT。worker 連線時會逐條比對權限，所以要和 worker 換版一起做。

## 測試

| 項目 | 結果 |
| --- | --- |
| web `tsc --noEmit`、`node --test` | 0 錯誤；389 pass、0 fail |
| api、ingestion、jobs `tsc` | 0 錯誤 |
| tools `node --test` | 108 pass、0 fail |
| ingestion vitest | 全過（新增 `channel-title-history.test.ts`） |
| api `channel-name-history.test.ts` | pass |
| `check-openapi` | 通過 |

- 全套 vitest 一起跑時，api 有 14 個、jobs 有 6 個逾時。這台機器負載高，這些失敗都在 5 秒逾時內沒跑完。單獨重跑（含 `--testTimeout=60000`）全部通過，而且都和這次改動無關。

## 正式環境變更（UTC）

- **13:16:37 權限備份：** `export-ts-principals.py` 輸出到 `skyhong-blog:/home/ubuntu/backups/services/channel-title-history-20261024T131637Z/principals/`。
- **13:17:11 prepare：** plan `43ffed15…`。建表、建 facade view，`youtube_ts_report` 取得 SELECT；前後權限都和審查過的清單完全一致。
- **13:17:55 換 worker-youtube-source：** `0c8b556f…` 換成 `2f60f294…`（`release-worker-names-ca6ad51`）。
  - 基底是 `release-channel-447990a`，只覆蓋 `ingestion/src/channel-jobs.ts`（ca6ad51，`9d6ac5d0…`）和 `shared/worker-permissions.json`（`c88e7f5b…`）。
  - 換版前，線上這兩個檔案與 447990a 相同（`1c20f612…`、`aaf093e0…`）。
- **13:17:57 worker 權限：** 套用後比對一致。
  - 換版當下，舊 task 正在跑的 `youtube.tag_videos.backfill` 失敗一次（`source-workflow-failed`，13:18:03），之後依排程重跑。
  - 13:18:10 新 worker 第一次跑 `youtube.channels.stats`：completed，applied 25。
- **13:21:16 / 13:25:58 兩次額外換版：** 見下方「插曲」。最後回到 `2f60f294…`。
- **13:25:26 回補：** 一個 transaction 寫入 1,504 筆，即 752 個頻道各一筆 `added` 和一筆 `refresh`（`2026-10-24 09:35:36`）。
  - 舊名稱取自 06:35Z 的 `youtube-board-mariadb.sql.gz`（`20261024-063542/`），它早於 09:35 的一次性更新，用 `dump-channel-titles.py` 解析。
  - 新名稱取自 `channel-profile-refresh-20261024T093536Z/api.json`。
  - 只差在前後空白的 30 個頻道不算改名。
  - 檔案 `pre-refresh-titles.tsv`、`current.tsv`、`backfill.tsv`、`backfill.sql`、`SHA256SUMS` 都在上述備份目錄。
- **13:27:03 換 web：** `a0b429fe…` 換成 `63e66873…`（`release-names-ef11cd2`，revision `ef11cd2…`）。
  - 以 `release-live-table-5f78c3e` 為基底重跑 `next build`。runtime 再覆蓋 6 個檔：`api/src/contracts.ts`、`api/src/public-api/schemas.ts`、`api/src/reports/service.ts`、`api/src/reports/channel-title-history.ts`、`shared/media-cache/index.ts`、`shared/media-cache/store.ts`。
  - 和基底比對 api、shared、runtime、ingestion、jobs、ai、notifications、inventory 的所有檔案雜湊，只有這 6 個不同。
  - 候選容器（127.0.0.1:18178，唯讀）：13 個路徑狀態碼正確；新文字出現、舊的方法說明消失。
    - 建表前，`nameHistory` 回傳 `null`，log 有一行 `ER_TABLEACCESS_DENIED_ERROR`，頁面 200。
    - 建表後，API 回傳完整紀錄。
- **其他服務沒有變。**

### 插曲：emoji 誤判（bd9a2db 與還原）

- 第一次產生回補資料時，有 11 個頻道看起來像在 09:35 之後又改名，差別只在 emoji 變成 `?`。當時以為資料庫存的名稱被弄壞，所以做了 `bd9a2db`（比對時把 4 位元組字元視為 `?`），換上 `74a20511…`。
- 用 `--default-character-set=utf8mb4` 重新讀取後確認：資料庫存的名稱是對的，`?` 是讀取用的 mariadb client 連線編碼造成的。早上的 `before.tsv` 也是這樣讀出來的，所以裡面的 emoji 變成了 `?`。
- `bd9a2db` 會讓只換 emoji 的改名漏記，所以用 `9a1895c` 還原。還原後的 `channel-jobs.ts` 和 ca6ad51 完全相同，13:25:58 換回 `2f60f294…`。
- 74a20511 在線上約 4 分鐘，期間沒有寫入任何名稱紀錄。

## 正式驗證

- `/channels/2902`、`/91`、`/154`、`/16`、`/2183` 都有「頻道名稱紀錄」。舊名稱都對，包括 emoji「陸妻糖糖🍬在大陸」；舊的方法說明一處都沒有。
- Playwright 截圖：91 的舊頭像是 YouTube 預設人像；頁面錯誤 0。

## 回復

- **web：**
  ```
  release-service-image.py --service=web --old=sha256:63e668735b560ffe7e3a1fc1605472d8d598ce032c37bdc182b4e7f9391759bb --new=sha256:a0b429fe88c3a9750b4e500beddc907c6e9372666eadea4fb5b7ec45433d2550 --title=Rollback --execute
  ```
- **worker：**
  ```
  release-service-image.py --service=worker-youtube-source --old=sha256:2f60f294ebd9d37354c75233c34410d6397826ad5297d84abd131aab16d47b13 --new=sha256:0c8b556f4e998d6afed28b8bdf174c7c6ca3a820604b87791b8b1c17810a0d32 --title=Rollback --execute
  ```
  - 先換 worker，再 `REVOKE SELECT, INSERT ... FROM youtube_ts_w_youtube_source`（兩條：state 表和 facade view，facade view 另含 SHOW VIEW）。
  - 舊 worker 驗證權限時會拒絕多出來的權限，所以換回舊 worker 時一定要把權限收回。
- 資料表留著不影響舊版本。

## 發版時另外發現（未處理）

- 首頁 `/` 和 `/keywords` 回 503（`HOME_SECTION_UNAVAILABLE`，keywords 區塊 `source-cap`）。換版前的舊 web task 在 11:59Z 之前就已經是這樣，和這次發版無關。
- 原因：首頁關鍵字區塊會一次讀出近 14 天的影片，13:3x 時約 78,120 部。10/22 的 `425ecfb` 恢復每頁 50 筆抓取後，每天收錄從約 5 千增加到 7.5 千部，整包資料應該是超過了 `home-exploration.ts` 的 16 MiB 上限。
