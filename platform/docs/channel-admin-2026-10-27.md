# 管理員新增頻道與編輯分類（2026-10-27）

## 為什麼做

舊站（youtube.board.tw，爸爸維護）每月都有新頻道，由爸爸貼網址到 `app/admin.php` 加入，再在頁面上按「+標籤」逐一分類。2026-10-27 起以本站為主：一次性把舊站 `u_id` 3890–4154 的 265 個頻道匯入（編號與 tag 保持一致，見下方「一次性匯入」），之後頻道與分類改在本站後台維護。設計參照 tag.observe.tw 的管理後台：Google 管理員登入、每次寫入有同源與 CSRF 檢查、每次異動留下紀錄。

## 能做什麼

後台 `/admin`（頻道管理表）新增：

- **新增頻道**：貼 `youtube.com/channel/UC…`、`youtube.com/@名稱`、`@名稱` 或 `UC…` 頻道 ID，可同時選分類。`/user/`、`/c/` 舊式網址無法在不搜尋的情況下確定是哪個頻道，會直接說明請改貼 `@名稱`。
- **編輯分類**：表格每列的「分類」按鈕，用名稱選擇；只送出差異（加入哪些、移除哪些），兩位管理員同時改不會互相蓋掉。
- **新增分類**：建立新的 `urt_tag`；同名（含已存在）回傳既有的，不會重複。
- **最近的變更**：每筆請求的狀態（等待中／已套用／未套用）、原因與結果。有等待中的請求時每 4 秒自動更新，套用完成後頻道表自動重新載入。

沒有做：停用／還原頻道（`flag_del`）、分類改名與刪除、書籤式一鍵加入、AI 或規則建議分類、讀者回報。這些等實際使用後再決定。

## 運作方式

```
管理員 ──POST /auth/admin/channel-requests──▶ web（api/src/channel-admin.ts）
                                              │ 驗證格式、同源、CSRF、每人每分鐘 60 次
                                              ▼ INSERT（web 自己的狀態帳號，沒有來源表權限）
                                     ts_channel_admin_requests（pending）
                                              │ 每分鐘
                                              ▼
              youtube-source worker：youtube.channels.admin（ingestion/src/channel-admin.ts）
                 每筆請求在自己的資料庫交易裡套用，同一交易內把請求標成 done／failed
                                              ▼
                       urt_channel / urt_count / urt_tag / urt_tag_log
```

為什麼不讓 web 直接寫：正式環境的 web 沒有任何來源表寫入權限，這是刻意的；新增頻道還要呼叫 YouTube API 並計入共用配額帳本，這些只有 worker 有。做法與 WebSub（`ts_websub_events`）相同。代價是套用要等最多約 1 分鐘。

**套用規則（與舊站 `redir/tag.php`、`admin.php` 一致）**

- 加分類：在 `urt_count.tags` 尾端加 `[id]`；移除：從字串中取掉；移光後是空字串，不是 NULL。每個真正有變動的分類寫一筆 `urt_tag_log`（`add`／`del`）。沒有變動就什麼都不寫。不改 `mtime`。
- 欄位是 `VARCHAR(100)`，約 20 個分類。超過會整筆拒絕（`TAGS_TOO_LONG`），不會截斷。同一請求內先移除再加入，所以已滿時可以換掉一個。
- 新頻道：用 YouTube 回傳的完整資料寫入 `urt_channel` 與 `urt_count`，`stime`、`vtime` 留空，所以下一輪統計與影片探索會優先處理它（統計每 9 分鐘 25 個、探索每 5 分鐘 10 個）。已追蹤的頻道只會加分類，不重複新增；已封存的頻道拒絕（`CHANNEL_RETIRED`）。
- 加入的分類必須存在且未停用，在呼叫 YouTube 之前就檢查，不會浪費配額。
- 請求編號（UUID）唯一：重送同一個請求是重播，不會做第二次；同編號拿去做別的事回 409。
- 失敗的請求標成 `failed` 並記錄原因碼，不會自動重試；YouTube 配額用盡或金鑰失效時請求維持 `pending`，下一輪再處理。非預期的資料庫錯誤標成 `failed`（`APPLY_FAILED`）並讓該輪 job 顯示為 incomplete。
- 資料表永不刪除：`ts_channel_admin_requests` 就是稽核紀錄（誰、何時、做什麼、結果）。`actor` 是 `user:<帳號編號>`。

## 檔案

| 檔案 | 內容 |
|---|---|
| `shared/channel-admin.ts` | 請求型別、分類字串解析與套用（`applyTagDelta`）、貼上內容辨識（`parseChannelSource`）、錯誤碼；web、API、worker 共用一份 |
| `api/src/channel-admin.ts` | `GET/POST /auth/admin/channel-requests`；INSERT／SELECT 的小型連線池；佇列上限 100 筆待處理 |
| `api/src/index.ts`、`runtime/server.ts` | 註冊（兩處都要，正式環境跑的是 `runtime/server.ts`） |
| `api/src/manage/routes.ts` | 頻道管理表改為回傳所有未停用的分類（編輯器要能選到還沒人用的分類） |
| `ingestion/src/channel-admin.ts` | `channelAdminJob` |
| `ingestion/src/youtube.ts` | `channelIdForHandle`（`channels.list?forHandle`，1 配額單位） |
| `jobs/src/youtube-cli.ts`、`workflow-registry.ts` | 指令 `youtube:channels:admin`（job `youtube.channels.admin`，`--limit` 預設 10、最多 50） |
| `shared/worker-batches.ts`、`worker-permissions.json` | 放進 `youtube-source` 批次；新增權限見下 |
| `runtime/schedules.channel-admin.json` | `* * * * *`，`limit=10`；獨立檔案，理由同 `schedules.websub.json` |
| `jobs/migrations/020_channel_admin_requests.sql`、`migrations/002-frontend-state.sql` | 資料表；`tools/frontend-schema.mjs` 的 `accountWrites` 加 `ts_channel_admin_requests: INSERT` |
| `tools/channel-admin-upgrade.mjs` | 正式資料庫的兩階段升級（照 `websub-upgrade.mjs`） |
| `web/src/app/admin/ChannelTools.tsx`、`Channels.tsx` | 介面 |
| `web/src/lib/channel-admin-client.ts`、`account-client.ts` | 前端呼叫與文字；`account-client.ts` 的路徑白名單加 `channel-requests` |

## 權限變更（需要審查）

web（own-state 帳號 `youtube_ts_state`）：`ts_channel_admin_requests` 的 SELECT、INSERT。沒有 UPDATE／DELETE。

worker（`youtube_ts_w_youtube_source`，整個 youtube-source 批次共用）新增：

| 物件 | 新增權限 |
|---|---|
| `ts_channel_admin_requests` | SELECT、UPDATE（新表） |
| `urt_tag_log` | INSERT（新 view，只能新增，不能讀） |
| `urt_channel` | INSERT（原本 SELECT、UPDATE） |
| `urt_tag` | INSERT（原本 SELECT） |

**這是這個功能最敏感的地方**：整個 youtube-source worker 第一次能在 `urt_channel` 新增列。全部沒有 DELETE、DDL。`tools/channel-admin-upgrade.test.mjs` 鎖定了這 8 條授權語句的完整內容。

## 上線步驟（需要使用者核准；尚未執行）

順序與 WebSub 相同，原因也相同（worker 連線時逐條比對授權與映像內的權限檔）。

1. **備份**：`export-ts-principals.py` 匯出目前權限；來源表 `urt_tag`、`urt_tag_log` 也做一次傾印（`yt-innodb-maint.sh backup`）。
2. **prepare**：`node tools/channel-admin-upgrade.mjs --phase=prepare --execute`（需要 `FRONTEND_BOOTSTRAP_URL`、`FRONTEND_ACCOUNT_HOST`，在 `dokploy-network` 的容器裡執行，SQL 用檔案不要用 `docker exec` 內嵌引號）。建表、兩個 worker facade view、web 的 SELECT／INSERT；正在跑的 worker 權限不變。先用 `--dry-run` 核對輸出的 8 條授權。
3. **換 web**：新 image（含 `runtime/server.ts` 的註冊）。驗證 `/auth/admin/channel-requests` 未登入回 401、管理員 GET 回空陣列。
4. **換 worker-youtube-source 與 scheduler**，並**立刻** `--phase=worker`（數秒的空窗，與 WebSub 相同）。owners／allowlist 加 `youtube.channels.admin`。
5. **排程設定** 加 `channel-admin-v1`。**一定要先換 scheduler image 再換排程設定**（舊 scheduler 會拒絕沒見過的 workflow：`Unregistered workflow`）。
6. **驗證**：用管理員帳號新增一個測試分類，約 1 分鐘內在「最近的變更」變成已套用；再把它設為某個頻道的分類並移除。`ts_job_runs` 的 `youtube.channels.admin` 每分鐘一筆。

**回復**：移除排程；worker／scheduler／web 換回舊 image。worker 換回舊 image 前要先手動 REVOKE 這 8 條授權（worker 授權是精確比對，多出來的授權會被拒絕）。資料表與 view 是附加的，留著不影響其他功能。已套用的頻道與分類異動不會自動還原；每一筆都在 `ts_channel_admin_requests.result` 記錄了異動前後，可據此手動還原。

## 驗證到哪裡

- 單元測試（假資料庫）：`ingestion/test/channel-admin.test.ts`、`api/test/channel-admin.test.ts`、`web/src/lib/channel-admin-client.test.ts`、`jobs/test/schedules-channel-admin.test.ts`、`tools/channel-admin-upgrade.test.mjs`。
- **真實 MariaDB 11.4**（拋棄式容器、正式環境的真實表結構）：`ingestion/test/channel-admin-db.test.ts`，9 項。涵蓋分類加減與日誌、移光變空字串、停用／不存在／已滿的拒絕、重複建立分類、新增頻道（含 emoji、多行描述、隱藏訂閱數）、`@handle`、重複與封存頻道，以及**新增到一半失敗時整筆回滾**（頻道列與計數列都不留下）。需設定 `INGESTION_DB_TEST_URL=mysql://root:…@127.0.0.1:<port>`，只接受本機位址。
- 完整 `npm test` 與 `npm run typecheck` 全部通過。

**還沒有驗證的假設**

1. **YouTube 查不到頻道時的回應。** 現有 `get()` 對沒有 `items` 的回應丟 `invalid-response`，我假設查單一不存在的頻道（或 handle）會是這種回應，所以把它對應成「找不到這個頻道」。若不是，使用者會看到「YouTube 回應異常」，不影響資料正確性。第一次實際新增時請留意。
2. **經由 facade view 寫入。** 真實資料庫測試是直接連到表，沒有經過 worker 的 facade view（`youtube_board_ts_worker_youtube_source`）與逐表授權。view 是 `ALGORITHM=MERGE` 的單表 view，MariaDB 可更新，但 INSERT 經 view 加 `urt_tag_log` 只有 INSERT 權限這個組合，要在 prepare／worker 階段之後第一次實際執行時才能確認。
3. **交易跨 schema。** 請求狀態（`youtube_board_ts`）與來源表（`youtube_board`）在不同 schema，同一連線的交易應涵蓋兩者（都是 InnoDB），測試環境是同一個 schema，沒有覆蓋跨 schema。
4. **瀏覽器操作沒有實測。** 介面只過型別檢查與純邏輯測試，沒有在瀏覽器裡點過。請在上線驗證時實際操作一次。

## 一次性匯入（2026-10-27，已完成）

舊站 `u_id` 3890–4154（265 個）以唯讀查詢取出，原編號與 `urt_count.tags` 不變地寫入 `urt_channel`／`urt_count`（`stime`、`vtime` 清空讓本站排程重抓）。逐筆欄位雜湊比對 0 筆不一致。備份、匯出資料與回滾 SQL 在 skyhong-blog 的 `/home/ubuntu/backups/services/<時間>-pre-legacy-channel-import/`。

匯入之後本站與舊站的編號會分岔：本站下一個是 4155，舊站爸爸之後新增的也是 4155。以本站為主表示爸爸改在本站新增；舊站不再同步。`urt_tag` 同理，本站 109–114 是自己建的（舊站最大是 108）。
