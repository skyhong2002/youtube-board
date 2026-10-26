# YouTube 推播通知（WebSub）：新直播不再等一週才被發現（2026-10-26）

## 起因

2026-10-26 蔣萬安的競選總部成立直播（`zpqFQ8ilYD0`，13:50 開播）沒有出現在 `/live/current?or=1,2,12,13,14,81`。

- 新直播只會經由頻道探索（`youtube.channels.videos.general`）進入 `urt_video_live`。
- 探索的下次檢查時間 `urt_channel.vtime` 由「一週內發片數」推算（`nextUploadsCheck`）。蔣萬安頻道一週沒有新片，04:40 查過之後被排到 11/02 08:40。
- 臨時開播的低頻頻道因此最久一週看不到。舊站用同一套規則，所以這不是新架構才有的問題。
- 當天的處理：把該頻道 `vtime` 手動改成 `2000-01-01 00:00:00`（原值 `2026-11-02 08:40:03`），下一輪探索 2 分鐘內掃到，14:41 開始顯示。
- 範圍：`or=1,2,12,13,14,81` 的 786 個頻道中，725 個只靠一般探索，其中 391 個下次檢查在 6 小時以後，288 個在 24 小時以後。

縮短所有頻道的檢查間隔不可行：近 24 小時 API 約 7,500 / 9,000，探索佇列已積壓 967 個逾期頻道，且一般探索每輪最多 10 個頻道（Laravel 沿用的上限）。

## 做法

YouTube 的 WebSub hub（`pubsubhubbub.appspot.com`）會在頻道有新影片、新直播或影片資料變動時，主動 POST 一則 Atom 通知給我們。訂閱與接收都不是 YouTube Data API，不吃配額。

```
hub ──POST──▶ /websub/youtube/<channelId>/<token>   接收端（api/src/websub.ts）
                 驗簽章 → LPUSH Redis yt-ts:websub:events
                                   │
          youtube.websub.sync（每 2 分鐘，youtube-source worker）
            1. 消化事件：影片不在 urt_video → urt_channel.vtime = 2000-01-01
            2. 訂閱／續訂：每輪最多 40 個頻道向 hub 送 subscribe
                                   │
          youtube.channels.videos.general（每 5 分鐘）先讀 vtime 最小的頻道
                                   ▼
          照原本流程寫入 urt_video / urt_video_live，live.poll 接手追蹤
```

設計重點：

- **接收端不碰資料庫。** 回呼網址含頻道 ID 和由 `WEBSUB_SECRET` 導出的 token；`hub.secret` 也是由同一個密鑰與頻道 ID 導出，所以驗證不用查表。接收端只寫 Redis。
- **沒有新資料表、沒有新資料庫授權。** 事件與訂閱狀態都在 web 與 worker 本來就共用的私有 Redis。`youtube.websub.sync` 的資料表權限（`urt_channel` SELECT/UPDATE、`urt_count` SELECT、`urt_video` SELECT、`ts_job_runs`）是 youtube-source 現有權限的子集，批次權限聯集不變（已用權限清單算過）。
- **Redis 掉資料是安全的。** 事件只是加速用，漏掉就退回原本的探索節奏；租約表掉了就重新訂閱一次（786 個請求，冪等）。
- **租約只由接收端寫。** hub 回頭驗證回呼網址時，接收端才記下租約；job 只記「多久內不要再問 hub」，所以「已請求」與「已建立」不會混淆。到期前 24 小時續訂。
- **只處理新影片。** 已在 `urt_video` 的影片被編輯會再通知一次，直接忽略。
- **通知可能比上傳清單更新得早。** 未入庫的影片會被觀察 30 分鐘，期間最多再提前頻道 2 次，間隔 6 分鐘。
- **範圍。** 預設 `--or=1,2,12,13,14,81`（社論、政治人物、電視台、新聞、政黨、廣播），可用 `--or=` 調整。

### 程式

| 檔案 | 內容 |
|---|---|
| `shared/websub.ts` | 常數、Redis key、token／簽章導出與驗證、通知解析（不用 XML 解析器，只比對兩個固定格式的 ID） |
| `api/src/websub.ts` | `GET`（驗證訂閱）與 `POST`（收通知）；未啟用時不註冊路由 |
| `runtime/server.ts`、`api/src/index.ts` | `registerWebsub(app)`。正式環境的啟動器跑的是 `runtime/server.ts`，不是 `api/src/index.ts`，兩處都要註冊 |
| `jobs/src/websub-cli.ts` | `youtube.websub.sync`（指令 `youtube:websub:sync`） |
| `jobs/src/workflow-registry.ts`、`cli.ts` | 註冊 |
| `shared/worker-batches.ts`、`worker-permissions.json` | 放進 `youtube-source` 批次與權限檔 |
| `runtime/schedules.websub.json` | `*/2 * * * *`，`limit=40`。獨立檔案，因為 `schedules.batch2.json` 被測試鎖成與 Laravel 排程一一對應 |

### 營運計數器

`HGETALL yt-ts:websub:stats`：`received`、`rejected`、`drained`、`bumped`、`ignored`、`rebumped`、`resolved`、`expired`、`subscribe_accepted`、`subscribe_failed`。
`HLEN yt-ts:websub:leases` 是已被 hub 驗證的訂閱數；`HLEN yt-ts:websub:watch` 是正在觀察的影片數。

## 狀態

程式、測試都已完成（api 7 項、jobs 16 項新測試；jobs 全套 314 項、tools 112 項通過；另用真的 Redis 跑過接收端 → 佇列 → 消化／訂閱一輪）。**尚未上線。** 上線是正式環境變更，需要明確核准。

## 上線步驟（尚未執行）

1. 產生 `WEBSUB_SECRET`（至少 32 字元的隨機值），只放 Dokploy／Swarm 設定，不進 git、log 或聊天。
2. 建新 image（照 `ts-site-manual-release` 的流程）。web、`worker-youtube-source` 換同一個 image。
3. 環境變數：
   - web：`TS_WEBSUB_ENABLED=true`、`WEBSUB_SECRET`（web 已有 `REDIS_URL`）。
   - `worker-youtube-source`：`TS_WEBSUB_ENABLED=true`、`WEBSUB_SECRET`（同一個值）、`TS_INGESTION_OWNERS` 與 `TS_INGESTION_WRITE_ALLOWLIST` 各加 `youtube.websub.sync`。可選 `TS_WEBSUB_CALLBACK_ORIGIN`（預設 `https://youtube.observe.tw`，必須是 https）。
   - scheduler：排程設定改為 v8 加上 `schedules.websub.json` 的那一筆（新的 swarm config）。
4. **先換 web，再開排程。** web 起來後，從外部驗證回呼可達（含 Cloudflare 在前面時不被擋）：
   `GET /websub/youtube/<channelId>/<token>?hub.mode=subscribe&hub.topic=<topic>&hub.challenge=x&hub.lease_seconds=100` 應回 `x`；錯的 token 回 404。
5. 再換 worker 並加排程。每輪 40 個頻道，786 個約 40 分鐘訂完。
6. 確認：`HLEN leases` 逐步增加到約 786；`received` 開始增加；有新影片時 `bumped` 增加，且頻道 `vtime` 被提前後 5 分鐘內新影片入庫。

回復：移除排程與環境變數即可。接收端未啟用時不註冊路由；既有訂閱最多 5 天後自然過期，期間收到的通知沒有人消化，不影響其他功能。換回舊 image 同樣安全。

## 已知限制與待驗證

- **待驗證：YouTube 是否在「預定直播建立」時就推播。** hub 的行為以官方文件和經驗為準，沒有在正式環境確認過。上線後第一週要看 `received` 與實際直播的對應；若只在開播時才推，延遲仍是從開播起算約 7 分鐘以內，仍比一週好得多。
- **競態：** 通知消化與探索同時處理同一個頻道時，探索結束後會把 `vtime` 重排，蓋掉剛提前的值。觀察機制會在 6 分鐘後再提前一次，所以最多延遲一輪。
- **佇列公平性：** 被提前的頻道排在逾期佇列前面，大量通知時（例如同時 30 個頻道），原本積壓的頻道會晚一點。範圍限定在 786 個頻道，預期很小。
- **探索仍是一輪最多 10 個頻道。** 不在 `--or` 範圍內的頻道行為完全不變。
- **Cloudflare 或邊緣規則若擋 hub 的 POST／GET，** 訂閱會一直驗證失敗；步驟 4 就是為了先發現這件事。
