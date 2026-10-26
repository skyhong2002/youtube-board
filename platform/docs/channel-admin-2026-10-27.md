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
| `urt_tag_log` | INSERT、SELECT（新 view）。**SELECT 不是多餘的**：worker 每次連線都會讀外觀 view 的定義與實體表欄位來驗證映射，而 MariaDB 對只有 INSERT 的帳號會把這些隱藏起來，整個連線就被拒絕（見上線紀錄的事故）。日誌仍不能 UPDATE／DELETE |
| `urt_channel` | INSERT（原本 SELECT、UPDATE） |
| `urt_tag` | INSERT（原本 SELECT） |

**這是這個功能最敏感的地方**：整個 youtube-source worker 第一次能在 `urt_channel` 新增列。全部沒有 DELETE、DDL。`tools/channel-admin-upgrade.test.mjs` 鎖定了這 8 條授權語句的完整內容。上線後用 worker 自己的帳號做過無副作用的權限探測：三張表的 INSERT 都通過（刻意送重複主鍵，得到 `ER_DUP_ENTRY` 而不是權限錯誤）、請求表可 UPDATE，`urt_tag_log` 的 UPDATE／DELETE 被拒。

## 上線步驟（使用者已核准，2026-10-26 UTC 已執行，見下方紀錄）

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
2. **瀏覽器操作沒有實測。** 介面只過型別檢查與純邏輯測試，沒有在瀏覽器裡點過（我無法用 Google 登入）。請在第一次使用時實際操作一次。
3. **「新增頻道」與「新增分類」在正式環境沒有實際執行過。** 上線驗證只實際執行了「改分類」（含真實日誌、被拒絕、沒變動三種結果）；`urt_channel`／`urt_tag` 的 INSERT 只做了權限探測，沒有真的新增一列，因為新增會留下永久的編號（頻道 4155、分類 115）。

已在正式環境驗證的：經由 worker 外觀 view 的寫入、同一交易裡同時更新 `youtube_board` 的來源表與 `youtube_board_ts` 的請求狀態（跨 schema）、緊接著授權比對的連線檢查。

## 正式環境上線紀錄（UTC 2026-10-26）

程式 main `105954c`（功能）與 `721e183`（`urt_tag_log` 授權修正）；`ingestion` 的 `after` 欄位小修在其後。腳本 `.local/dokploy/release-channel-admin.py`（預設 dry-run，`--phase=web|workers|schedule`）、`/home/ubuntu/yt-release-chadmin-105954c/run-upgrade.sh`（在 `dokploy-network` 上的拋棄式容器裡執行升級工具）。

| 時間 | 動作 |
|---|---|
| 19:10:53 | 備份：`/home/ubuntu/backups/services/channel-admin-20261026T191053Z/`（`principals/` 12 個帳號 396 條授權，sha256 `bbd7004c…`；`source-tables.sql.gz` 含 `urt_tag`、`urt_tag_log`、`urt_channel`、`urt_count`，已驗證 gzip 與 SHA256SUMS）。 |
| 19:11 | 在正式主機上建置網頁映像。**事故，見下。** |
| 19:12 | `channel-admin-upgrade.mjs --phase=prepare`：建 `ts_channel_admin_requests`、兩個 worker 外觀 view、web 的 SELECT／INSERT。plan sha256 `159cc8cf…`；來源寫入 0、DDL 0。 |
| 19:32–19:34 | 在有限制的條件下重新建置網頁映像（2 分鐘完成，期間主機壓力全程正常）。候選容器（loopback、writers 關閉）驗證：就緒、新路由存在且未登入 GET／POST 皆 401。 |
| 19:43:44 | 換 web：`d56073e1…` → `90d896e3…`（`release-channel-admin-web-before-*.private.json` 留存換版前的 compose）。公開網域驗證新路由回 401。 |
| 19:48:39 | 換 `worker-youtube-source`（`6fb522ec…` → `32334284…`）與 scheduler（`6ae19ba5…` → `ccbb7afd…`），3 秒後套用 8 條 worker 授權。**這一組映像有缺陷，見下。** |
| 20:01:07 | 修正後的映像（worker `4dfe93ef…`、scheduler `3076111f…`），同時補 `urt_tag_log` 的 SELECT；52 條 worker 授權逐條比對通過。 |
| 20:02:32 | 排程設定 v9 → v10（多一筆 `channel-admin-v1`），20:02:59 完成。`youtube.channels.admin` 每分鐘一筆，`completed`。 |
| 20:04:16 | 端到端驗證（見下）。 |

### 事故 1：網頁映像編譯拖垮主機（約 19:14–19:22，對外中斷約 6 分鐘）

在正式主機上用不受限制的 `docker build` 編譯 Next（Turbopack）。主機只有 2 核、約 12GB 記憶體，而前一個 release（`62b01eb`）把 InnoDB 緩衝池加到 3.5GB，可用記憶體已經不多；編譯把 swap 用滿（4095/4095）、I/O 壓力近 100%、負載平均到 55，連 SSH 都逾時。web 與資料庫容器被系統終止並由 Swarm 重新拉起（MariaDB 19:20:34 起來，InnoDB 正常崩潰復原，19:20:59 就緒，沒有損毀訊息；匯入的 265 個頻道、prepare 建立的物件都完整）。網站 19:21:53 恢復。

之後的建置改用 `guarded-build.sh`：舊式建置器加 `--memory=2500m --memory-swap=2500m --cpu-quota=100000`（超過上限只會自己失敗），加上監看程式（可用記憶體 < 700MB、記憶體壓力 ≥ 25 或 I/O 壓力 ≥ 85，連續兩次就中止建置）。重跑 2 分鐘完成、主機沒有異常。**以後這台主機上不要再跑不受限制的 Next 編譯。** 若上限內失敗，改去 sky-mini（arm64、已有 Docker）建置，不要放寬上限。

### 事故 2：worker 連線被拒，youtube-source 的所有工作中斷約 12.5 分鐘（19:48:40–20:01:20）

第一組 worker 映像用 `urt_tag_log: INSERT`（只新增）。worker 連線時會驗證每個外觀 view 的定義與實體表欄位，MariaDB 不會把這些資訊給只有 INSERT 的帳號，檢查回報 `Worker source view mapping mismatch`，**一個 view 不符整個連線就被拒絕**，所以不只新功能，youtube-source 批次的統計、影片探索、WebSub、影片統計等全部在連線階段失敗（日誌只有 `Worker job failed`，沒有 `ts_job_runs` 資料列）。升級工具在 prepare 階段對這個 view 的驗證是通過的，因為它用的是有完整權限的管理帳號，驗證不到 worker 的視角。

影響：這些工作都是依到期時間輪詢的，恢復後自己補上；WebSub 通知存在 `ts_websub_events`（保留 3 天），沒有遺失。不影響網站。修正：`urt_tag_log` 改為 INSERT＋SELECT（`721e183`），重建映像並補授權。

**教訓（寫進測試與工具）：** 「升級工具能通過」不等於「worker 能連線」。往後新增 worker 授權時，上線前要用 worker 自己的帳號在候選容器裡跑一次 `connectDatabase`，而不是只相信管理帳號的驗證；本次事故後我在線上容器用同樣方法重現並確認了修正。

### 端到端驗證（20:03–20:04）

用資料庫管理帳號代替網頁，在請求表插入 4 筆（`actor = system:release-test`，留在表裡作為紀錄）：

| 請求 | 結果 |
|---|---|
| 頻道 4154 移除一個本來就沒有的分類 | `done`，沒有寫入（4154 仍是 NULL） |
| 頻道 4149（`4ForceLab`，`[1]`）加入分類 2 | `done`，`[1]` → `[1][2]`，`urt_tag_log` 多一筆 `add`（pk 5433） |
| 頻道 4149 移除分類 2 | `done`，回到 `[1]`，`urt_tag_log` 多一筆 `del`（pk 5434） |
| 頻道 4154 加入不存在的分類 9999 | `failed`，`TAG_NOT_FOUND`，沒有任何寫入 |

這次測試在 `urt_tag_log` 留下 2 筆永久的日誌（`u_id 4149`，tag 2，add／del）。

## 回復（上線後的版本）

反向依序：`--phase=schedule --rollback`（v10 → v9）；`--phase=workers --rollback`（worker／scheduler 換回舊映像）**之前必須先收回 worker 的新授權**，否則舊映像連線一樣被拒絕（授權是精確比對）：對 `youtube_ts_w_youtube_source`@`10.0.1.0/255.255.255.0` 收回 `ts_channel_admin_requests`、`urt_tag_log` 兩張新表在實體表與 facade 的全部權限，以及 `urt_channel`、`urt_tag` 的 INSERT（facade 與實體表各一），再用 `verifyGrants` 對舊版計畫逐條比對（升級工具刻意不含收回操作）；最後 `--phase=web --rollback`。上線前的 compose 與環境變數在 `.local/dokploy/release-channel-admin-*-before-*.private.json`（權限 0600，不要印出或提交）。注意 `release-channel-admin.py` 內 worker／scheduler 的「前一版」現在是有缺陷的 `32334284…`／`ccbb7afd…`，回復到更早版本要改成 `6fb522ec…`／`6ae19ba5…`。

## 一次性匯入（2026-10-27，已完成）

舊站 `u_id` 3890–4154（265 個）以唯讀查詢取出，原編號與 `urt_count.tags` 不變地寫入 `urt_channel`／`urt_count`（`stime`、`vtime` 清空讓本站排程重抓）。逐筆欄位雜湊比對 0 筆不一致。備份、匯出資料與回滾 SQL 在 skyhong-blog 的 `/home/ubuntu/backups/services/<時間>-pre-legacy-channel-import/`。

匯入之後本站與舊站的編號會分岔：本站下一個是 4155，舊站爸爸之後新增的也是 4155。以本站為主表示爸爸改在本站新增；舊站不再同步。`urt_tag` 同理，本站 109–114 是自己建的（舊站最大是 108）。
