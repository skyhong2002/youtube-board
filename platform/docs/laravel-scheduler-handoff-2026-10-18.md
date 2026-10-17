# Laravel 排程全面交接給 TypeScript（2026-10-18 規劃）

使用者在 2026-10-18 要求所有技術架構都改成和 tag.observe.tw 一樣、用 TypeScript，並要求把所有 Laravel
排程一起規劃交接。本文件以 [cutover-review-plan.md](cutover-review-plan.md) 第 3 階段的 A–L 對照表為基礎，
補上正式環境實際的排程清單、今天新增的需求與執行順序。停止／排空、備份與回復規則沿用該文件，不在此重複。

## 目標架構（比照 tag.observe.tw）

tag.observe.tw 是一個常駐 TS worker（BullMQ + Redis）加上定時批次工作。youtube-board 在 skyhong-blog
的 Dokploy TS compose（`youtube-board-ts-6oukfq`）裡加入：

- `redis`：私有、AOF 持久化、noeviction。
- `worker-*`：每個交接批次一個 worker 程序（快取、YouTube 來源、留言、AI 每日、AI 每小時、AI 人物、Telegram，共 7 個），
  `TS_WORKER_BATCH=<批次>`，每批一條序列佇列（`TS_QUEUE_MODE=batch`，一次一個工作、依到達順序，和 Laravel 一樣），
  長工作（每日 AI 約 40 分鐘）只卡住自己那一批，不會卡住每分鐘的直播輪詢。批次與工作的對應在 `shared/worker-batches.ts`。
  每個 worker 用自己的 facade schema 與資料庫帳號，權限是該批工作在 `shared/worker-permissions.json` 的聯集（`tools/worker-schema.mjs` 的 `WORKER_BATCH`），
  只有資料表層級權限、沒有 DDL。主機 12GB（2026-10-18 可用約 4.7GB）、2 核心：每個 worker 約 150–250MB，合計約 1.5GB；
  每個工作一個 facade 程序（約 29 個、4–5GB）會吃光剩餘記憶體，所以按批分組。
- `scheduler`：依 `jobs/src/scheduler.ts` 的排程設定（Asia/Taipei、五欄 cron）產生工作；與 worker 分開。排程時間沿用 Laravel
  原本錯開的分鐘，避免 2 核心同時被大工作佔滿。
- 全部用與 web 相同的 image digest。

目前暫用的 systemd timer（`ts-worker.py` 的關鍵字比對、頭像）在對應批次交接時一併改由 scheduler 產生。

## 正式環境 Laravel 排程清單（2026-10-18 讀取）

`INGESTION_SCHEDULED_WRITE_ALLOWLIST` 共 25 個寫入工作，另有 4 個不需寫入白名單的工作與 Telegram 摘要。

| 批次 | Laravel 排程（cron，台北時間） | TS 工作 | 備註 |
| --- | --- | --- | --- |
| 1 衍生快取 | `reports.counts.build`、`reports.keywords.build`、`reports.people.build`、`reports.tag_cloud.build`、`reports.channel_cloud.build`、`reports.tag_date.build`、`reports.keywords.cache`、`reports.groups.build`（皆 `27 3,8,11,13,18,23`）、`reports.schedule.build`（`29,47 * * * *`）、`reports.live.build`、`reports.live.clean`、`reports.live.show`、`reports.live.static` | 同名 `reports.*`；`reports.groups.build` 由 `group-status-cli.ts` 執行 | 直接停用、不需 TS 版：`reports.keywords.build`（本機模式不寫入，只有另開的 legacy 同步會寫 `tags`）、`reports.live.show`／`reports.live.static`（只產生 Laravel 儀表板預覽）、`reports.mayor.static`（`13 */5`，已由 Next 路由取代） |
| 2 YouTube 來源 | `youtube.channels.stats`、`youtube.channels.videos.general/live/live_group`、`youtube.tvbs.videos`、`youtube.videos.stats`、`youtube.live.poll`、`youtube.tvbs.live.poll`、`youtube.videos.duration`、`youtube.live.cleanup`、`youtube.tag_videos.backfill` | 同名 `youtube.*` | 共用 YouTube 配額帳本（太平洋時間日），整批同一個時段切換，避免兩邊重複抓 |
| 3 留言 | `youtube.comments.queue`、`youtube.comments.fetch` | 同名 | 先盤點未完成的 claim |
| 4 AI 每日 | `ai.daily`（`0 0`）、`ai.daily.catchup`（`20 2,4,6`） | `ai.daily`、`ai.channel`、`ai.daily.catchup`、`reports.ai_topic.build` | 依賴批次 2 的 `youtube.tag_videos.backfill`；TS 版已在每日流程後寫彙整統計並記錄結果 |
| 5 AI 每小時 | `ai.hourly`（`10 * * * *`） | `ai.hourly` | 依賴批次 2 的 `youtube.channels.videos.general` |
| 6 AI 人物 | `ai.mayor_person`（`45 5,20`） | `ai.mayor_person` | |
| 7 Telegram（最後） | `notify:telegram:digest` 每小時／每日 | `notify.telegram.hourly`、`notify.telegram.daily` | 兩個週期一起交接；沿用 cutover-review-plan 的 dedup／歷史橋接要求 |

## 今天新增、所有 AI 工作都適用的要求

- AI 只走 CLIProxyAPI gateway 的 `sky-quality`／`sky-fast` 別名。順序：skyhong-blog `172.17.0.1:8317` →
  skyhong-SM `100.85.214.25:8317` → sky-mini `100.71.224.62:8318`（同一把金鑰，2026-10-18 實測三台皆可用）。
  只在連不上或持續 429/5xx 時換下一台；結果不明的呼叫不重送。不使用 opencode.ai（`qwen3.6-plus`）。
- `urt_ai_date.data_json` 已於 2026-10-18 02:23（台北）改為 LONGTEXT（備份
  `/home/ubuntu/backups/services/ai-topic-cache-column-20261017T182259Z/`），並補寫 9/20–10/17 共 22 天彙整統計。
  10/13 因 AI 回傳的媒體名稱對不上頻道而無法計算，待另案處理。
- 每日流程的彙整結果與失敗原因必須出現在執行紀錄；補跑在每日資料齊全時仍補寫缺少的彙整。

## 執行順序

**批次 0 — 準備（不改變任何寫入者）**
1. 發布含今天修改的 TS image（`/ai` 頁面、API 補回資料、AI gateway 備援與彙整步驟）。
2. 完整一致備份並在隔離環境還原驗證（cutover-review-plan 第 1 階段）。
3. 在 TS compose 加入 `redis`、`worker`、`scheduler`，所有 gate 關閉、排程為空，確認啟動與 grant 檢查通過。
4. 依批次建立 facade 帳號與最小權限（2026-10-12 已在還原副本上驗證 46 個 worker profile）。
5. 寫好與 Laravel 相同時間的排程設定檔，先以預覽模式比對。

**批次 1–7 — 每批相同流程**
1. 從 Laravel `INGESTION_SCHEDULED_WRITE_ALLOWLIST` 移除該批工作（Dokploy env），再
   `docker service update --force youtube-board-scheduler`，確認排程器容器已讀到新設定。
2. 等執行中的工作結束，確認沒有 Laravel 寫入者。
3. 把該批 TS 工作加入 `TS_INGESTION_OWNERS`／`TS_INGESTION_WRITE_ALLOWLIST` 與排程設定。
4. 先跑一次有上限的手動執行，核對來源時間、筆數、配額與 AI 用量，再觀察至少一個排程時段
   （每日工作需觀察一晚）。
5. 有疑慮就停止擴大：關掉 TS 該批工作、把 Laravel 白名單恢復原樣即可回復。

全部完成後，Laravel 排程器服務縮為 0（保留 image 供回復），`/ops` 管理頁由 TS `/admin` 取代後再退場。

## 需要使用者決定

- 執行方式：Dokploy compose 內的 `redis`／`worker`／`scheduler`（建議，與 TS 程式設計一致），或沿用
  systemd timer 一次性容器。
- 上述批次順序與每批的觀察時間。
- 停用不需 TS 版的 4 個 Laravel 工作：`reports.keywords.build`、`reports.live.show`、`reports.live.static`、`reports.mayor.static`。
