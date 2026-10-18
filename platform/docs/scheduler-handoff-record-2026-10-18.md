# Laravel 排程交接紀錄（2026-10-18 台北）

計畫見 [laravel-scheduler-handoff-2026-10-18.md](laravel-scheduler-handoff-2026-10-18.md)。

## 結果

台北 05:52 起，Laravel 排程器不再寫入任何資料（`INGESTION_SCHEDULED_WRITE_ALLOWLIST=off`）。寫入工作由 TS 接手：

| 批次 | 工作 | TS 接手時間（台北） |
| --- | --- | --- |
| cache | counts、people、tag_cloud、tag_date、keywords.cache、schedule、live.build、live.clean | 04:38 |
| youtube-live | live.poll、tvbs.live.poll | 05:03（05:27 起獨立 worker） |
| youtube-source | channels.stats、videos.general/live/live_group、tvbs.videos、videos.stats、videos.duration、live.cleanup、tag_videos.backfill | 05:03 |
| ai-daily | ai.daily、ai.daily.catchup（含彙整統計） | 05:03 |
| ai-hourly | ai.hourly | 05:03 |
| ai-mayor | ai.mayor_person | 05:52（Laravel 05:45 那次跑完後） |

停用、不需 TS 版：reports.keywords.build、reports.live.show、reports.live.static、reports.mayor.static、reports.groups.build、
reports.channel_cloud.build。留言（youtube.comments.queue／fetch）在正式環境本來就不在 Laravel 寫入白名單，維持停用。
Telegram 摘要（第 7 批）仍由 Laravel 發送：`telegram_digest_dispatches` 有 2 筆 2026-09-09 的 pending，需先在頻道核實是否送出，
才能依交接清單切換。

## 正式環境配置

- TS compose `youtube-board-ts-6oukfq`：redis（AOF、noeviction、密碼）、scheduler、worker-cache、worker-youtube-live、
  worker-youtube-source、worker-ai-daily、worker-ai-hourly、worker-ai-mayor，與 web 同一個 image。
  由 `platform/.local/dokploy/handoff-runtime.py` 產生；換 image 用 `release-all.py`。
- 每批一個 facade schema（`youtube_board_ts_worker_<batch>`）與帳號（`youtube_ts_w_<batch>`，限 10.0.1.0/24），
  用 `tools/worker-schema.mjs`（`WORKER_BATCH`）在線上 image 內建立，只有 view 與資料表層級權限。
- 密碼與金鑰放在 swarm secret（`yb_ts_worker_<batch>_env_v1`、`yb_ts_scheduler_env_v1`、`yb_ts_redis_conf_v1`），
  root 專用副本在 skyhong-blog `/etc/youtube-board-ts/`。排程設定為 swarm config `yb_ts_schedules_v4`（24 筆，Laravel 同一時間）。
- 關鍵字比對與頭像仍由原本的 systemd timer（ts-worker.py）執行。

## 過程中的修正

- `whereKeys` 的 `BINARY col <=> BINARY ?` 用不到索引，影片統計每支影片掃整張 `urt_video_log_history`（DB 90% CPU）；
  改成 `col = ? AND BINARY col = BINARY ?`（9cf0414）。
- 個別項目跳過（例如已刪除頻道）改記為 incomplete，不再整筆失敗（470c1a5）。
- 每分鐘直播輪詢獨立成 youtube-live 批次，避免排在數分鐘的統計與探索之後（333db97）。
- 首頁關鍵字每日歷史上限（91463cd）。
- 影片長度、直播維護、影片統計、留言的 `BINARY col = BINARY x` 一樣用不到索引（影片長度查詢跑了 8 分鐘，卡住整個
  youtube-source 佇列）；正式環境 ID 欄位本來就是 utf8mb4_bin，改成 `col = BINARY ?` 與 `a = b AND BINARY a = BINARY b`（788550e）。
- 788550e 同時重啟 8 個服務時，web 新容器在啟動等待期內沒通過健康檢查而自動退回；之後單獨 `docker service update --image`
  成功。之後換 image 時先換 worker、再單獨換 web。
- 補跑每小時 AI 2026-10-18 02:00–02:59（交接前備份暫停時漏掉）與 04:00–04:59（換 image 時中斷）。

## 回復

依批次反向：關掉 TS 該批（從 `handoff-runtime.py --batches` 移除並換回前一個排程 config），把 Laravel 白名單恢復為
`/etc/youtube-board-ts/laravel-allowlist-before-batch*.txt` 的值後 `docker service update --env-add`。不可兩邊同時寫同一個工作。

## Laravel 網站停用（2026-10-18 08:48 UTC）

- Traefik `youtube-board-ts-cutover.yml` 移除 `yt-cutover-ops`（priority 400，`/ops/*` → Laravel），`/ops/ingestion`
  改由 TS web 的 `yt-cutover-public` 回應；其他舊 `/ops/*` 子路徑在 TS 為 404，見 `operator-surface-disposition.md`。
- 新增 `yt-cutover-http`（`web` entryPoint，priority 300，`redirect-to-https@file`）。原本 http→https 只靠 Dokploy 產生的
  `youtube-board-web-mwafzd.yml`，移除 Laravel 後會一起消失。
- `youtube-board-web-mwafzd` 縮到 0（原 1，image `youtube-board-web-mwafzd:latest`）。沒有其他服務的 env 或 systemd 指向它；
  Dokploy Auto Deploy 已於 2026-10-12 關閉。`yt-cutover-laravel`（priority 110）與 Dokploy 的 websecure 路由仍在，
  但優先權低於 `yt-cutover-public`，不會收到請求。
- 回復：`sudo cp /etc/youtube-board-ts/traefik-cutover-before-ops-20261018T084805Z.yml
  /etc/dokploy/traefik/dynamic/youtube-board-ts-cutover.yml` 並 `docker service scale youtube-board-web-mwafzd=1`。
- Laravel scheduler 仍在跑（Telegram 摘要），待 Telegram 交接後縮到 0。之後再刪除兩個 Laravel 服務與其路由；資料庫保留。
