# 頻道名稱與頭像更新（2026-10-24）

## 起因

`/live/current` 上有些頻道名稱是舊的，例如 u_id 2902「Puma Shen」在 YouTube 上已改名為「沈伯洋Puma」。日テレNEWS、TBS NEWS DIG 等頻道則沒有頭像。

- 舊站只在後台新增頻道時寫一次 `urt_channel.title` 和 `urt_channel.thumbnails`，之後從未更新。
- 存的 yt3.ggpht.com 頭像網址已失效（404）。
- 頭像快取的備援 `--resolve-missing` 會去抓頻道頁，但 YouTube 頻道頁的 `<head>` 現在約 770 KB，超過 `CHANNEL_PAGE_LIMITS.headBytes`（256 KB），所以全部失敗（`CHANNEL_PAGE_METADATA_MISSING` / `CHANNEL_PAGE_TOO_LARGE`）。
  - 失敗的頻道有 947 個，每小時還白白下載約 430 MB。

## 一次性更新（09:35Z）

- 用 channels.list `part=snippet` 查 3,474 個活躍頻道：呼叫 70 次，已手動記入 `ingestion_youtube_quota_daily`（當日累計 837 → 907）。
- 更新了 761 個名稱、2,781 個頭像網址。
  - YouTube 沒有回傳其中 17 個頻道，資料維持不變。
- 備份：`skyhong-blog:/home/ubuntu/backups/services/channel-profile-refresh-20261024T093536Z/`
  - `before.tsv`：更新前的 u_id、youtube_id、title、thumbnails、flag_del
  - `api.json`：API 回傳的資料
  - `apply.sql`：實際執行的 UPDATE
- 手動跑頭像快取（不帶 `--resolve-missing`）：manifest 從 2,511 個增加到 3,463 個。
  - 有 11 個頻道的頭像網址下載失敗（`DOWNLOAD_STATUS`）。

## 自動維護

- `447990a`：`youtube.channels.stats` 改要 `part=snippet,statistics`。
  - 每 50 個頻道仍只算 1 點配額。
  - 會寫回目前的名稱和 default 頭像網址；只接受 yt3.ggpht.com / yt3.googleusercontent.com。
  - snippet 有問題時只略過名稱和頭像，統計數字照寫。
- 這個排程每 9 分鐘處理 25 個頻道，所以每個頻道約每 22 小時更新一次。
- 正式環境的 facade view 有 `title`、`thumbnails` 欄位，`youtube_ts_w_youtube_source` 帳號有 UPDATE 權限，不需要改 grant。

## 正式環境變更

- 映像 `youtube-board-ts:release-channel-447990a` = `sha256:0c8b556f4e998d6afed28b8bdf174c7c6ca3a820604b87791b8b1c17810a0d32`
  - 以 `release-live-425ecfb`（`44dcc1d5…`）為基底，多一層 COPY 447990a 的 `ingestion/src/youtube.ts`、`ingestion/src/channel-jobs.ts`。
  - 換版前，線上這兩個檔案的 sha256 與 447990a 的前一版相同（`4838083b…`、`cf5d2019…`）；換版後與 447990a 相同（`74cc1bbf…`、`1c20f612…`）。
  - 建置目錄：`/home/ubuntu/yt-release-channel-447990a`
- 候選驗收：在 `--network none --read-only` 的容器內用 tsx 載入 `ingestion/src/index.ts`，`channelStatisticsJob` 和 `YoutubeDataApiClient` 都能正常載入。
- 換版：`.local/dokploy/release-service-image.py --service=worker-youtube-source`（10:01:57Z，執行前 load 4.0）。
  - 只換 worker-youtube-source；worker-ai-hourly 仍是 `44dcc1d5…`。
  - 備份：`release-service-image-before-20261024T100157Z.private.json`
- 換版後第一次執行（10:09Z）：completed，API 呼叫 1 次，applied 25，skipped 0。
- 回復：`release-service-image.py --service=worker-youtube-source --old=sha256:0c8b556f… --new=sha256:44dcc1d5… --title=Rollback --execute`

## 頭像排程

- `/etc/systemd/system/youtube-board-ts-avatars.service` 拿掉 `--resolve-missing`。
  - 原檔備份在上述備份目錄的 `youtube-board-ts-avatars.service.before`。
  - 名稱和頭像網址改由每日統計排程更新，抓頻道頁的備援已經不需要。
