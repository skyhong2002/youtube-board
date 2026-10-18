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

## Telegram 交接（批次 7，2026-10-18 09:04–09:10 UTC）

- 09:04 UTC `youtube-board-scheduler`（Laravel）縮到 0；停之前只剩 `schedule:run` 迴圈，沒有執行中的 artisan。Laravel 至此全部停用。
- 備份：skyhong-blog `/home/ubuntu/backups/services/telegram-handoff-20261018T090439Z/`（`telegram_digest_*`、`cache`、`cache_locks`、
  `ts_notification_*`，含 SHA256SUMS）。
- 三筆 pending dispatch：使用者在頻道確認都沒有送出（今天的最後一則是 01:12 台北；9/9 的搜尋結果從 9/8 跳到 9/10），用
  `notify:telegram:resolve --outcome=not-sent` 記錄（`ts_notification_resolutions`）。d:2026-10-17 由 TS 補發；
  d:2026-08-06、d:2026-09-08 因每日只處理最新一天，不會補發。之後 `notify:telegram:readiness` 為 ready。
- 通知 store：Laravel 未設定 `TELEGRAM_DEDUP_STORE`（預設 database）、`DB_CACHE_TABLE` 預設 `cache`，前綴 `youtube-board-cache-`（cache 表中的
  `tg:digest:*` 鍵）。`cache` 為 InnoDB；migration 009 的 `ts_notification_*` 表已存在。
- facade `youtube_board_ts_worker_telegram`／帳號 `youtube_ts_w_telegram`（16 個 view），secret `yb_ts_worker_telegram_env_v1`
  （DB 密碼、REDIS_URL，以及從 Laravel scheduler 服務設定複製的 bot token、channel id、AI key），schedules config `yb_ts_schedules_v5`
  （v4 加 `runtime/schedules.batch7.json`，共 26 筆）。手動維護指令用 host 上的 `/tmp/run-telegram-cli.sh`（同一個 facade；
  只有它開 `TS_NOTIFICATION_RECONCILE_ENABLED`）。
- 09:10 UTC 第一次每小時執行回 `notification_legacy_schedule_activity`：Laravel 09:00:58 剛佔過 slot，TS 30 分鐘內不送，屬預期。
- 回復：停掉 worker-telegram（`handoff-runtime.py` 拿掉 telegram、換回 `yb_ts_schedules_v4`），先跑 readiness 確認沒有 pending，
  再 `docker service scale youtube-board-scheduler=1`。有 pending 時不可恢復 Laravel（Laravel 每小時不讀 TS 的未確定紀錄）。
- d:2026-10-17 補發：10:00、10:30 UTC 排程與三次手動診斷都被 Telegram 拒絕，回 429 `Too Many Requests: retry after N`
  （N 為 2→30→8，照 retry_after 重送會加長）。bot 仍是頻道管理員、`sendChatAction` 正常、HTML 解析正常、可見長度 4,073；
  連結減到 42 個仍 429。Laravel 今早 09:01、09:31 也是同樣的 429。過去 Laravel 的每日摘要也曾延遲數小時
  （10/10 14:01、10/14 16:31 台北才送出），也有整天沒送的日子（9/16、9/18、9/30、10/3、10/13 沒有 dispatch）。TS 照 Laravel
  的方式每 30 分鐘重試到 20:30 台北；拒絕屬確定未送出，不會留下 pending。b79e99a 讓失敗紀錄保留錯誤碼與 retry_after（尚未上線）。
- 原因（11:00 UTC 查明）：先送一則靜音的「·」再立刻刪除（message 1886、1887），用編輯測試：全文加 YouTube 預覽 → 429（約 10 秒）；
  全文不加預覽 → 成功；所以是 Telegram 抓不到 YouTube 預覽時回 429，不是頻道被限、也不是連結數。
- 修正 b4dc2bc：送出若帶預覽且收到 429，等 retry_after（最多 30 秒）後以同樣內容、不帶預覽重送一次；429 是確定未送出，不會重複。
  11:03 UTC 以掛載修正檔的一次性 CLI 補發 d:2026-10-17 成功（message 1888，dispatch 84）。
- 上線：patch image `youtube-board-ts:release-b4dc2bc`（`sha256:f99823b0…`）= release-788550e 加一層（只換
  `notifications/src/clients.ts`；layer 前綴、執行設定、檔案 SHA256 已核對）。11:07 UTC `release-all.py` 換全部 TS 服務，全部完成、
  web 沒有自動退回；重啟後第一個首頁請求 503（12 秒），之後 200。回復：`release-all.py --old=<f99823b0…> --new=<47301a99…> --execute`。
  一般重建 image 需要先重做 flat base：`youtube-board-ts:base-release-8388492` 已不在 host 上。

## 全面檢查（2026-10-18 20:57–22:20 UTC，台北 10/19 清晨）

- 服務：Laravel web／scheduler 皆 0/0；TS 10 個服務 1/1。資料持續更新（影片、直播、觀看歷史到台北 05:10；每日 AI 10/19 00:28；人物 AI 10/18 20:45）。
- `ts_job_runs` 的 `failed`／`incomplete` 大多是標籤：快取工作只要有個別項目跳過就記 failed（`reports.schedule.build` 每次跳過
  349fCtjgPuE、TpZVYJWcBUM 兩支 `invalid_history_payload`，`reports.counts.build` 的 `invalid_log_payload`），有上限截斷就記 incomplete；
  YouTube 工作的 incomplete 是個別影片／頻道 API 缺項。行為與 Laravel 相同。
- **每小時 AI 交接後每個排程時段都失敗**（`urt_ai_hour` 停在 10/18 06:14 台北，Telegram 每小時摘要因此一直停在 `h:2026-10-18 05:00:00`）：
  ai.hourly 在 :10 先用 `youtube:channels:videos` 逐頻道補來源，但 youtube-source 的 `youtube.channels.videos.general`（每 5 分鐘）同時持有
  同一把 writer lock，`GET_LOCK(…,0)` 立刻失敗，第一個頻道失敗後整小時 blocked。修正：
  - 99cd9fb：來源補抓遇到 writer lock 被佔時等 10 秒重試，最多 12 次（拿鎖失敗時尚未呼叫 API 或寫入）。21:07 UTC 上線，21:10 那次排程成功發布。
  - 8be259a：`youtube:channels:videos --until=<ISO>`，分頁到達時段起點就停；每小時來源補抓帶時段起點。原本會抓滿 `--max-pages`
    （補跑一個 2 小時前的時段在 `--max-pages=8` 用掉 200 次呼叫並 blocked）；改後每時段 39 次呼叫、約 45 單位。排程時段本來就是 1 頁，不變。
  - patch image：`release-99cd9fb`（`sha256:9e80ef08…`）= release-b4dc2bc 加一層；`release-8be259a`（`sha256:b847531d…`）= release-99cd9fb 加一層
    （`ingestion/src/channel-jobs.ts`、`jobs/src/youtube-cli.ts`、`jobs/src/ai-hourly-source.ts`；舊檔 SHA256 與 repo 前一版相同、新檔與 repo 相同）。
    21:28 UTC 換全部 TS 服務，web 沒有退回、首頁 200。回復：`release-all.py --old=<b847531d…> --new=<f99823b0…> --execute`。
  - 補跑 10/18 06:00–10/19 03:59 台北共 22 個時段：`/tmp/aihourly-backfill.sh`（ai-hourly facade 的一次性 CLI `/tmp/run-aihourly-cli.sh`，
    `--missing-only`，配額超過 6,500 即停）。21:21–22:06 UTC 全部 published（03:00 時段用新 image 先試；每時段 39–64 次呼叫，共約 1,150 單位，
    當日累計 4,539）。Telegram 每小時只看最新時段，補跑的舊時段不會發文。
- 頻道文字雲：`reports.channel_cloud.build` 在 Laravel 正式環境本來就不在寫入白名單，`urt_show_cloud` 最後寫入 2026-07-14；不是交接造成的缺口。
- 備份：`/etc/nas-backup/jobs/youtube-board.sh` 的 dump 補上 7 個新 facade schema（cache、youtube_live、youtube_source、ai_daily、ai_hourly、
  ai_mayor、telegram；只有 view，試 dump 114 個 view 正常；原檔 `.before-worker-facades.<UTC>`）。PATHS 仍含 Laravel app 的 `.env` 與
  `/etc/dokploy/backups/youtube-board-web-mwafzd`；刪除 Laravel app 後只會記 warning、不會失敗，舊 `.env` 已在既有 snapshot。
- Traefik：`yt-cutover-public`／`yt-cutover-accounts` 自己有 `certResolver: letsencrypt`，刪除 `yt-cutover-laravel` 與 Dokploy 的 Laravel 路由不影響憑證。

### 刪除 Laravel 的前提

- 服務（`youtube-board-web-mwafzd`、`youtube-board-scheduler`）與兩組 Laravel 路由：沒有執行期依賴，可刪；刪前把
  `youtube-board-web-mwafzd:latest` 另外打 tag 保留，否則刪除後就沒有回復路徑。
- 資料表不可刪：TS 直接用 `cache`、`cache_locks`、`telegram_digest_*`、`ingestion_youtube_quota_daily` 等 Laravel 建的表。
- PHP 程式碼不能直接整批刪：TS 的工具與測試仍讀 `database/schema/legacy-dashboard-baseline.sql`、`app/Support/YoutubeIdentifierSchema.php`
  （`tools/bootstrap-db.mjs`）、`database/migrations/0001_01_01_000001_create_cache_table.php`、`app/Services/Legacy/GroupDirectoryReport.php`、
  `routes/web.php`／`config/ingestion.php`（`tools/inventory.mjs`），CI 觸發路徑也指向 Laravel 目錄；需先搬進 `platform/`。
