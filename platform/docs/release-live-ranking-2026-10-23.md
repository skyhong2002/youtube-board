# 直播排行修復（2026-10-23）：直播判斷、抓取頻率、補資料與舊站版面

## 起因

爸爸比較了兩張截圖：舊站 youtube.board.tw 的「正直播排行(排除帶狀)」第一名是新聞大白話（6,903 人），
新站 `/live/current` 第一名卻是 24 小時連播的戲劇台（166 人），也有兒童台。查到兩個資料問題和一組版面差異。

### 1. YouTube 改了直播縮圖網址（10/22 04:00 台北起）

- 頻道抓取靠縮圖網址含 `default_live.jpg` 判斷直播。這是照舊站 get_video.php 寫的，playlistItems 不會回傳 liveBroadcastContent。
- 10/22 04:00 左右，YouTube 把直播與預定直播的縮圖改成 `default.jpg?v=<hex>`，新直播就不再寫進 `urt_video_live`。

| 日期 | 新發現影片 | `default_live.jpg` | `default.jpg?v=` | 寫進 urt_video_live |
|---|---|---|---|---|
| 10/21 | 5,785 | 116 | 0 | 331 |
| 10/22 | 6,509 | 9 | 141 | 73 |
| 10/23 | 8,435 | 0 | 193 | 1 |

- 抓取工作每天照常完成，YouTube 配額也沒用完（`google_exhausted_at` 一直是 NULL），所以只有這條判斷規則壞了。
- 抽查 `?v=` 縮圖的影片，標題幾乎都是直播、首播、即時影像或預定直播。

### 2. 一般頻道抓取只讀 3 部，大頻道約 19 小時才查一次（10/12 起）

- `nextUploadsCheck` 用第一頁的「一週內發片數」估下次檢查時間：`604800 / 週發片數 / 3`，最少 2 小時。
- 舊站 get_video.php 每次讀 50 部。Laravel 移植時把一般抓取改成 `--max-results=3`，tag 52/89 改成 5，TS 照搬。
  週發片數因此最多算到 3，大頻道被排在約 18.7 小時後才再查。
- 新聞大白話（u_id 8）三天內只被一般抓取查了 2 次，每天 14:00–18:00 的直播都錯過；`urt_video_live` 最後一筆是 10/12。
  它有 tag 29（TVBS），所以直播會寫進 `urt_video_live_tvbs`，但排行頁不讀那張表，舊站也一樣。
- 舊站每輪最多查 81 個頻道，可以 3 輪並行；新站每 5 分鐘只查 5 個。

### 3. 版面

舊站主選單「直播排行榜」直接帶 `or=1,2,12,13,14,81`（社論、政治人物、電視台、新聞、政黨、廣播），
有「現在正直播排行／正直播排行(排除帶狀)／全台灣／個人社論」捷徑，表格有「時間」和「最近趨勢線」欄。
新站預設不分類，那幾個捷徑和兩個欄位也都沒有。

## 變更

- `425ecfb`（main）：
  - `isLiveThumbnail` 改成兩種縮圖格式都算直播候選，`channel-jobs.ts` 和 `tag-backfill.ts` 都改用它。
  - `runtime/schedules.batch2.json`：一般抓取改成 `--limit=10 --max-results=50`，tag 52/89 改成 `--max-results=50`。
  - playlistItems 不管讀幾部都只算 1 點配額。
- `34b45bc`（main）＝ release 分支上的 `b2e372b`：
  - 主選單「直播」改連到 `/live/current?or=1,2,12,13,14,81`。
  - `/live/current` 加一排範圍分頁：現在正直播排行、正直播排行(排除帶狀)、新聞政治頻道、全台灣、個人社論、全部頻道。
  - 標題下方列出目前的預設分類範圍。
  - 表格：「更新時間」換成「開播時間」（更新時間移到 tooltip），新增「最近趨勢」走勢線。標題欄讓出 80px，桌機表格仍放得下內容欄。
  - 方法說明區塊補上排行範圍、開播時間、最近趨勢的說明。

## 配額估算

- 2026-10-21 16:00–10-22 16:00 UTC 各工作的 API 呼叫：
  - general 2,321（含 AI 每小時報表的頻道更新）
  - tvbs.live.poll 1,440
  - tag_videos.backfill 865
  - live.poll 319
  - 其他約 800
  - 合計約 5,700。
- 每日上限是程式預設的 9,000（`INGESTION_YOUTUBE_DAILY_QUOTA_BUDGET` 沒有設定），只有 1 把 key。
- 一般抓取從每輪 5 個改成 10 個，排程每天最多多用 1,440 點，預估合計約 7,150 點。
- 每次改讀 50 部之後，估算每天需要約 5,635 次頻道檢查，比可用次數多，所以佇列仍會排隊；排序依 vtime，最逾期的先查。

## 正式環境變更

### 資料面（10:00:59Z）

- 映像 `youtube-board-ts:release-live-425ecfb` = `sha256:44dcc1d5c2a97b71d21992d19ef0171e2af1afe620337822b1c1f49322e95973`
  - 在 `release-c51bebd`（`65038431…`）上多一層：COPY 425ecfb 的 `channel-jobs.ts`、`tag-backfill.ts`。
  - image 內兩檔的 sha256 與 git 一致：`cf5d2019…`、`00097214…`。
  - 換版前正式 image 的兩檔等於 425ecfb 的前一版。建置目錄 `/home/ubuntu/yt-release-live-425ecfb`。
- swarm config `yb_ts_schedules_v8`：v7 只改三個抓取排程的 options（40 筆）。
  - 主機上的檔案：`/tmp/sched-v7.json`、`/tmp/sched-v8.json`。
  - 用 image 內的 `readScheduleConfig` 和 `workflowArgs` 驗證過。
- 候選驗收：用新 image 和 source principal 跑 `youtube:channels:videos --limit=10 --max-results=50` dry-run，沒有錯誤。
- 換版腳本 `.local/dokploy/release-live-discovery.py`（預設 dry-run）。
  - 只換 worker-youtube-source、worker-ai-hourly 的 image，並把 scheduler 的 config 改成 v8；其他服務逐一比對不變。
  - 備份 `release-live-discovery-before-20261023T100059Z.private.json`。
- 執行前 load 3.9。約 60 秒內三個服務都 completed、healthy。web（`3326d8f1…`）和其他服務沒變。
- 回復：`release-live-discovery.py --old=sha256:44dcc1d5… --new=sha256:65038431… --old-config=yb_ts_schedules_v8 --new-config=yb_ts_schedules_v7 --execute`。

### 補資料（10:02Z）

- 把 `urt_video` 裡 10/22 04:00 之後 ctime、縮圖是 `default.jpg?v=`、但不在 `urt_video_live` 的影片補進去。
  - 共 310 筆、145 個頻道，用 `INSERT IGNORE`。
  - 欄位跟 get_video.php 一樣：ctime＝現在、videoId、publishedAt、u_id。
  - pk 範圍 648376–648685，撤回只要刪掉這個範圍。
- live.poll 在 8 分鐘內輪詢完全部：
  - 39 場還在直播，重新開始追蹤
  - 189 場已結束（取得開播、結束時間）
  - 31 部已無法取得（del_flag）
  - 其餘是預定直播
- 10/22 04:00 到 10/23 18:00 之間的同時在線人數是每分鐘快照，錯過的補不回來。

### 換版後確認

- 18:05–18:17 台北，一般抓取每輪查 10 個頻道、每頻道讀 50 部。新發現的直播有關鍵時刻、57爆新聞、東森新聞 CH51、鏡新聞、少康戰情室等。
- 新聞政治範圍（`or=1,2,12,13,14,81`）的即時直播從 2 場恢復到 36 場，同時在線加總 2.24 萬人。

### 版面（10:24:05Z，只換 web）

- 來源：分支 `release/live-ranking-34b45bc` 的 `b2e372b2a5b83ad1c835e1d4b151745af034f77b`。
  它等於正式 web 的 `3be3464`（`release/legacy-seo-20261023`），再 cherry-pick main 的 `34b45bc`。web 測試 380 項全過。
- 映像 `youtube-board-ts:release-live-ui-b2e372b` = `sha256:d2ed326bc25cef943f0cb9901ac33b64ac45a9af5d22851d0e4bc549f0744f06`，
  建置目錄 `/home/ubuntu/yt-release-live-ui-b2e372b`（`Dockerfile.web-overlay`）。
  - build 階段：在 `release-3be3464` 上用 release 分支的整個 `platform/` 覆蓋，沿用 image 內的 node_modules，只跑 `next build`。
    只覆蓋 web/shared/api 會失敗，因為 `/api` 頁要讀 `docs/api.md`。
  - runtime 階段：在 `release-3be3464` 上先刪掉 `web/.next`，再放入新的 standalone、static、public、BUILD_ID（`iXgkt2QbHtbss7Xm8cOYt`）。
    其他目錄（api、shared、runtime 等）維持正式 image 的內容。
- 候選：唯讀 loopback 18175（`/tmp/yt-candidate-b2e372b.sh`），api、ui、security 都 ready。
  - 17 個路徑的狀態碼與正式站相同，包括 `/live/*`、`/tags`、`/channels/8`、`/ai/days`、`/mayor`、`/api`、sitemap，
    以及舊路徑 `/ch/3113/` 和 `/live.php?...` 的 308。
  - 新分頁、欄位與範圍說明都有出現。驗完已移除。
- 換版：`.local/dokploy/release-service-image.py --service=web`（備份 `release-service-image-before-20261023T102405Z.private.json`）。
  執行前 load 3.1，10:25:24Z completed，healthy、restart 0，其他 10 個服務不變。
  `/keywords` 換版後短暫 503（首頁區塊暖機），約 30 秒後 200。
- 回復：`release-service-image.py --service=web --old=sha256:d2ed326b… --new=sha256:3326d8f186f9a7289dbe34455dc8f37b576b119bb810f5325ae2d2cca979d424 --execute`。

## 換版後的服務 image

- web：`d2ed326b…`
- worker-youtube-source、worker-ai-hourly：`44dcc1d5…`
- worker-ai-daily：`feb3fdf3…`
- 其他 6 個 TS 服務：`65038431…`
- redis：`redis:7.4-alpine`
- scheduler 使用 `yb_ts_schedules_v8`。

## 尚待觀察

- 新聞大白話的 vtime 是舊規則排的 10/24 08:05。之後應約每 2 小時查一次，10/24 14:00 的直播應該會進 `urt_video_live`。
- 配額：換版後幾天要確認每日用量低於 9,000。如果接近上限，先把一般抓取的 `--limit` 調回 5–8。
