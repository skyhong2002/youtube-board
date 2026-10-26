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
hub ──POST──▶ /websub/youtube/<channelId>/<token>    接收端（api/src/websub.ts，公開 web）
                 驗簽章 → INSERT ts_websub_events（kind='notice'）
hub ──GET───▶ 同一網址（訂閱驗證）→ 回 challenge，INSERT（kind='verify'，含租約秒數）
                                   │
          youtube.websub.sync（每 2 分鐘，youtube-source worker）
            1. 讀新的 notice：影片不在 urt_video → urt_channel.vtime = 2000-01-01
            2. 訂閱／續訂：每輪最多 40 個頻道向 hub 送 subscribe
            3. 清掉 3 天前的 notice、35 天前的 verify
                                   │
          youtube.channels.videos.general（每 5 分鐘）先讀 vtime 最小的頻道
                                   ▼
          照原本流程寫入 urt_video / urt_video_live，live.poll 接手追蹤
```

設計重點：

- **接收端不讀資料庫，只追加一張表。** 回呼網址含頻道 ID 和由 `WEBSUB_SECRET` 導出的 token；`hub.secret` 也是由同一個密鑰與頻道 ID 導出，所以驗證不用查表。web 的 own-state 帳號對 `ts_websub_events` 只有 `SELECT, INSERT`。
- **web 沒有 Redis 憑證，這是刻意的。** 正式環境 web 的 `REDIS_URL` 是空字串（Redis 有密碼，只有 worker 拿得到），所以通知不能走 Redis。第一版就是這樣設計，上線時 web 回 503 才發現，已回復並改成資料表（見「上線紀錄」）。worker 自己的重試與觀察狀態仍放它的 Redis。
- **租約由接收端記錄。** hub 回頭驗證回呼網址時，接收端寫一筆 `verify`；job 讀每個頻道最新一筆來算到期時間，到期前 24 小時續訂。job 另外記「多久內不要再問 hub」，所以「已請求」與「已建立」不會混淆。
- **只處理新影片。** 已在 `urt_video` 的影片被編輯會再通知一次，直接忽略。
- **通知可能比上傳清單更新得早。** 未入庫的影片會被觀察 30 分鐘，期間最多再提前頻道 2 次，間隔 6 分鐘。
- **範圍。** 預設 `--or=1,2,12,13,14,81`（社論、政治人物、電視台、新聞、政黨、廣播），可用 `--or=` 調整。

### 程式

| 檔案 | 內容 |
|---|---|
| `shared/websub.ts` | 常數、Redis key、token／簽章導出與驗證、通知解析（不用 XML 解析器，只比對兩個固定格式的 ID） |
| `api/src/websub.ts` | `GET`（驗證訂閱）與 `POST`（收通知）；INSERT-only 的小型連線池；未啟用或沒有資料庫時不註冊路由 |
| `runtime/server.ts`、`api/src/index.ts` | `registerWebsub(app, {databaseUrl: databases.state})`。正式環境的啟動器跑的是 `runtime/server.ts`，不是 `api/src/index.ts`，兩處都要註冊 |
| `jobs/src/websub-cli.ts` | `youtube.websub.sync`（指令 `youtube:websub:sync`） |
| `jobs/src/workflow-registry.ts`、`cli.ts` | 註冊 |
| `shared/worker-batches.ts`、`worker-permissions.json` | 放進 `youtube-source` 批次；權限 `ts_websub_events: SELECT, DELETE` 加上既有的 `urt_channel` SELECT/UPDATE、`urt_count`/`urt_video` SELECT、`ts_job_runs` |
| `runtime/schedules.websub.json` | `*/2 * * * *`，`limit=40`。獨立檔案，因為 `schedules.batch2.json` 被測試鎖成與 Laravel 排程一一對應 |
| `jobs/migrations/019_websub_events.sql`、`migrations/002-frontend-state.sql` | 資料表；`tools/frontend-schema.mjs` 的 `accountWrites` 加 `ts_websub_events: INSERT` |
| `tools/websub-upgrade.mjs` | 正式資料庫的兩階段升級（照 `channel-title-history-upgrade.mjs`） |

### 營運觀察

- 資料表：`SELECT kind, COUNT(*), MAX(received_at) FROM ts_websub_events GROUP BY kind`。`verify` 的頻道數就是 hub 已確認的訂閱數（預期約 786）；`notice` 有新增代表 hub 在推播。
- worker Redis：`HGETALL yt-ts:websub:stats`（`drained`、`bumped`、`ignored`、`rebumped`、`resolved`、`expired`、`subscribe_accepted`、`subscribe_failed`），`HLEN yt-ts:websub:watch` 是正在觀察的影片數。
- `ts_job_runs` 裡 `youtube.websub.sync` 的 `result` 有每輪的消化、訂閱、清理摘要。

## 狀態與上線紀錄

- 程式在 main：`2cb3531`（功能）、`7434049`（掛上正式閘道）、之後的資料表版本。
- **第一次上線嘗試（2026-10-26 07:58Z，已回復）：** 照第一版（Redis）換 web，外部驗證接收端回 503／500。原因是正式 web 的 `REDIS_URL` 為空。網站頁面一直正常，也還沒有任何訂閱；08:01Z 用 `release-websub.py --phase=web --rollback` 回到原 image，compose 與 env 與發版前逐位元組相同。已建立的 Swarm secret `yb_ts_websub_env_v1` 保留（尚未被任何服務使用）。
- 該次順便確認：舊 scheduler image 會拒絕含 `youtube.websub.sync` 的排程設定（`Unregistered workflow`），所以一定要先換 scheduler image 再換排程設定。

## 上線步驟（資料表版本，已照此順序執行）

1. **權限備份**（`export-ts-principals.py`）。
2. **prepare：** `tools/websub-upgrade.mjs --phase=prepare --execute`。建表、worker facade view、web 的 SELECT/INSERT；正在跑的 worker 權限不變。
3. **候選容器**（loopback、唯讀、writers 關閉）用新 web image 驗證接收端：驗證、簽章、錯誤路徑；驗完刪掉測試資料列。
4. **換 web**：新 image，env 加 `TS_WEBSUB_ENABLED=true`、`WEBSUB_SECRET`（與 Swarm secret `yb_ts_websub_env_v1` 同值）。從公開網域驗證回呼可達（不被 Cloudflare 擋）。
5. **換 worker-youtube-source 與 scheduler**，並立刻 `--phase=worker`。worker 連線時會逐條比對授權與映像內的權限檔，所以授權要與 worker 換版一起做（上次建表同樣有數秒的空窗）。owners／allowlist 各加 `youtube.websub.sync`，worker 另外掛上 Swarm secret。
6. **排程設定 v8 → v9**（只多一筆 `websub-sync-v1`）。
7. 觀察：`verify` 逐步增加到約 786；有新影片時 `bumped` 增加，頻道 `vtime` 被提前後 5 分鐘內新影片入庫。

回復：移除排程（設定回 v8）、worker／scheduler／web 換回舊 image 與 env。資料表與授權是附加的，留著不影響其他功能；既有訂閱最多 5 天後自然過期。

## 正式環境上線紀錄（資料表版本，UTC 2026-10-26）

main 為 `5460bd4`（`2cb3531` 功能、`7434049` 掛上閘道、`5460bd4` 改成資料表）。腳本 `.local/dokploy/release-websub.py`（預設 dry-run，`--phase=web|workers|schedule`，每階段都斷言 compose 其餘部分不變，備份在 `release-websub-<phase>-before-*.private.json`）。

| 時間 | 動作 |
|---|---|
| 08:46:57 | 權限備份：`export-ts-principals.py` → `skyhong-blog:/home/ubuntu/backups/services/websub-20261026T084657Z/principals/`（12 個帳號、393 條授權，sha256 `8a7ff5d7…`）。 |
| 08:49 | `websub-upgrade.mjs --phase=prepare`（在 overlay 網路上的容器內執行，主機連不到資料庫）：建 `ts_websub_events`、worker facade view、web 帳號 `SELECT, INSERT`。plan sha256 `e285acd5…`；來源 schema 寫入 0、DDL 0。 |
| 08:50 | 候選容器（loopback、唯讀、writers 關閉）連真實資料庫：驗證、簽章、錯誤路徑都符合預期；測試用的合成頻道資料已刪除。 |
| 08:50:41–08:51:27 | 換 web：`132791ba…` → `1d34870c…`（`release-websub-web-5460bd4`），env 加 `TS_WEBSUB_ENABLED`、`WEBSUB_SECRET`。從公開網域驗證回呼可達，Cloudflare 沒有擋。 |
| 08:51:56 | 換 `worker-youtube-source`（`2f60f294…` → `6fb522ec…`）與 scheduler（`65038431…` → `6ae19ba5…`）；owners／allowlist 加 `youtube.websub.sync`；worker 掛上 Swarm secret `yb_ts_websub_env_v1`。 |
| 08:52:00 | `--phase=worker`：worker 的 `DELETE, SELECT`。距 deploy 請求 2 秒，兩個服務 08:52:23 都 `completed`、healthy，一般探索與影片統計照常執行。 |
| 09:02:59 | 排程設定 v8 → v9（多一筆 `websub-sync-v1`），09:03:30 完成。 |
| 09:03:37 | 第一輪：目標 786 個頻道，送出 40 個訂閱全部被接受，hub 幾秒內回頭驗證，`verify` 40 筆。 |

觀察（09:03–09:17）：
- 每 2 分鐘一輪，皆 `completed`，訂閱失敗 0；已建立的訂閱 40 → 280。
- hub 開始推播：33 筆通知，其中 24 支影片已被探索收進 `urt_video`，8 支由觀察機制確認入庫，沒有過期或重試。
- 主機負載 1.2–2.6。

回復（反向依序）：
1. `release-websub.py --phase=schedule --rollback --execute`（設定回 v8）。
2. `release-websub.py --phase=workers --rollback --execute`（worker、scheduler 換回舊 image，移除 owners 與 secret 掛載）。**舊 worker 會比對授權，所以要先收回 worker 的授權**，否則連線會失敗：
   `REVOKE DELETE, SELECT ON youtube_board_ts.ts_websub_events FROM 'youtube_ts_w_youtube_source'@'10.0.1.0/255.255.255.0'`
   `REVOKE DELETE, SELECT, SHOW VIEW ON youtube_board_ts_worker_youtube_source.ts_websub_events FROM 'youtube_ts_w_youtube_source'@'10.0.1.0/255.255.255.0'`
   （升級工具刻意不含收回操作，需用 root 手動執行並以 `verifyGrants` 比對。）
3. `release-websub.py --phase=web --rollback --execute`。
資料表與 web 的 INSERT 授權是附加的，留著不影響其他功能；既有訂閱最多 5 天後自然過期。

## 已知限制與待驗證

- **待驗證：YouTube 是否在「預定直播建立」時就推播。** hub 的行為以官方文件和經驗為準，沒有在正式環境確認過。上線後第一週要看 `notice` 與實際直播的對應；若只在開播時才推，延遲仍是從開播起算約 7 分鐘以內，仍比一週好得多。
- **競態：** 通知消化與探索同時處理同一個頻道時，探索結束後會把 `vtime` 重排，蓋掉剛提前的值。觀察機制會在 6 分鐘後再提前一次，所以最多延遲一輪。
- **佇列公平性：** 被提前的頻道排在逾期佇列前面，大量通知時（例如同時 30 個頻道），原本積壓的頻道會晚一點。範圍限定在 786 個頻道，預期很小。
- **探索仍是一輪最多 10 個頻道。** 不在 `--or` 範圍內的頻道行為完全不變。
- **Cloudflare 或邊緣規則若擋 hub 的 POST／GET，** 訂閱會一直驗證失敗；步驟 4 就是為了先發現這件事。
