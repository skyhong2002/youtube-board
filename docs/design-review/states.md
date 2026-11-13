# 設計評審截圖清單

每一輪都照這份清單截圖，ID 與 `tools/states.mjs` 一致。每個狀態截兩張：

| 尺寸 | 視窗 | 像素比 | 截圖高度 |
|---|---|---|---|
| `desktop` | 1440 × 900 | 1 | 從頁首起，最多 2400 px |
| `mobile` | 390 × 844（觸控） | 2 | 從頁首起，最多 1688 CSS px |

固定條件（第二段起在 sky-mini 拍攝；第一段 r1–r3 在 sky-server，字型與渲染不同，兩段截圖不混用）：

- 主機：sky-mini（macOS，Apple Silicon 10 核），Playwright 1.65 的 Chromium headless shell（`~/.cache/yb-review-pw/node_modules`，以 `NODE_PATH` 傳入）。建置與每個狀態開拍前都等 1 分鐘負載（`tools/load1.sh`：Linux 讀 `/proc/loadavg`，macOS 讀 `sysctl vm.loadavg`）≤ 10；建置用 `nice -n 19`（macOS 沒有 `ionice`，有才加）。一次只開一個瀏覽器。
- 基準：`main` 4ce5bf19 另開 worktree 建置；新版：`ui-hill-climb` 分支建置。兩者用同一份快照、同一台機器、同一組工具拍攝。

- 資料：`youtube.observe.tw` 公開 `/api/v1` 的一次性快照，於 2026-11-13 02:3x（台北）錄製，之後每一輪只回放，不再連正式 API。快照伺服器（`tools/snapshot-server.mjs`）站在正式閘道的位置：`/api/v1/*` 與 `/media/*`（頻道頭像）從快照回放，其餘轉給本機 `next start`；Next 伺服器端讀取也指向它。快照缺的網址回 404 並記錄，不會退回即時資料。它也照正式閘道（`api/src/ui-unavailable.ts`）的做法，把 Next 回的 5xx 頁面換成 `web/public/errors/unavailable.html`（503），所以錯誤狀態拍到的是讀者實際看到的頁面。
- YouTube 縮圖走 Next 的 `/_next/image`：由本機 `next start` 在伺服器端向 `i.ytimg.com` 取圖（這是 YouTube 的圖片 CDN，不是正式 API），存進該次建置的 `.next/cache/images`。瀏覽器若直接要 `i.ytimg.com`，只從 `/tmp/yb-review/data/ytimg` 快取供應（預設不補錄，缺圖回 404）；其他站外請求一律擋下。
- 每個瀏覽器 context 都送 `DNT: 1`、`Sec-GPC: 1`，`navigator.doNotTrack = "1"`，導覽前先擋 Google Analytics／GTM。
- 瀏覽器時鐘固定在 2026-11-13 02:40（Asia/Taipei）。伺服器時鐘不固定：替換 `Date` 的預載會讓 Next 的資料快取失效（頁面 500），而伺服器端用到「現在」的只有每日議題的「今天」判斷，資料本身都是凍結的。
- 繁中、`zh-TW`、淺色外觀（另列深色狀態）、減少動態效果；CJK 用 macOS 內建的 PingFang TC（網站字型堆疊的第一順位）。
- 每批資料情境（有資料、空、錯誤）各自重啟一次 `next start`，載入中的每個狀態也各自重啟，避免記憶體 ISR 快取跨情境。

## 範圍說明：活動頁

正式站的 `/events` 與 `/events/:id` 都以 307 轉到 `/ai/days`（`platform/web/next.config.ts`：編輯事件未策展，時間軸永遠是空的）。讀者打開 `/events` 實際看到的是「每日公共議題」，所以 `events-*` 狀態拍 `/ai/days`，`/events/[id]` 的對應是單日頁 `/ai/days/2026-11-10`。

## 頁面與狀態

| ID | 頁面 | 狀態 | 重現方式 |
|---|---|---|---|
| `home` | 首頁 `/` | 有資料（預設近七日） | — |
| `home-dark` | 首頁 | 深色外觀 | `prefers-color-scheme: dark` |
| `home-today` | 首頁 | 篩選：切到「過去24小時」 | 點期間切換 |
| `home-empty` | 首頁 | 空資料 | API 回應的 `data` 內所有陣列清空，清單的 `total` 歸零；篩選名稱查詢（`filter-options`）不受影響 |
| `home-error` | 首頁 | 載入錯誤 | API 回 500 |
| `home-loading` | 首頁 | 載入中 | 從直播頁點頁首站名，`/api/v1/home` 不回應，只截視窗 |
| `keywords` | 熱門標籤排行 `/keywords` | 有資料（近七日） | — |
| `keywords-dark` | 熱門標籤排行 | 深色外觀 | — |
| `keywords-today` | 熱門標籤排行 | 篩選：過去24小時 | `?window=today` |
| `keywords-empty` | 熱門標籤排行 | 空資料 | 同上 |
| `keywords-error` | 熱門標籤排行 | 載入錯誤 | 同上 |
| `keywords-loading` | 熱門標籤排行 | 載入中 | 從直播頁點導覽「關鍵字」，`/api/v1/home` 不回應 |
| `live` | 即時直播 `/live/current?or=1,2,12,13,14,81` | 有資料（導覽預設的新聞台範圍） | — |
| `live-dark` | 即時直播 | 深色外觀 | — |
| `live-all` | 即時直播 `/live/current` | 篩選：全部直播 | — |
| `live-empty` | 即時直播 | 空資料 | — |
| `live-error` | 即時直播 | 載入錯誤 | — |
| `live-loading` | 即時直播 | 載入中 | 從 `/keywords` 點導覽「直播」，`/api/v1/live*` 不回應 |
| `channel` | 頻道頁 `/channels/96`（民視新聞網） | 有資料 | — |
| `channel-dark` | 頻道頁 | 深色外觀 | — |
| `channel-videos` | 頻道影片 `/channels/96/videos` | 篩選：影片分頁 | — |
| `channel-empty` | 頻道頁 | 空資料 | — |
| `channel-error` | 頻道頁 | 載入錯誤 | — |
| `channel-loading` | 頻道頁 | 載入中 | 從 `/keywords` 點民視的頻道連結，`/api/v1/channels/96*` 不回應 |
| `events` | 每日公共議題 `/ai/days` | 有資料 | — |
| `events-dark` | 每日公共議題 | 深色外觀 | — |
| `event-day` | 單日議題 `/ai/days/2026-11-10` | 篩選：指定日期 | — |
| `events-empty` | 每日公共議題 | 空資料 | — |
| `events-error` | 每日公共議題 | 載入錯誤 | — |
| `events-loading` | 每日公共議題 | 載入中 | 從 `/keywords` 點導覽「議題」，`/api/v1/ai/days*` 不回應 |

## 參考對手

第一輪截一次，之後每輪重用同一組檔案（見 `tools/states.mjs` 的 `REFERENCES`）。實際採用的組合與截圖結果記在 `results/README.md`。

## 重現

```bash
# 0. 依賴：platform/node_modules（npm ci）；Playwright 取自 NODE_PATH（預設 ~/.cache/yb-review-pw/node_modules）
# 1. 建置（load1 ≤ 10 才開始；Linux 另加 ionice -c3）
(cd platform/web && NODE_ENV=production nice -n 19 ../node_modules/.bin/next build)
# 2. 快照伺服器：第一次加 --record https://youtube.observe.tw 錄製，之後只回放
node docs/design-review/tools/snapshot-server.mjs --data /tmp/yb-review/data --port 8501 --next http://127.0.0.1:3101
# 3. 截一整組（每批重啟 next start；一次只開一個瀏覽器）
docs/design-review/tools/run-set.sh platform /tmp/yb-review/sets/NAME
# 4. 參考對手（只截一次）
NODE_PATH=... node docs/design-review/tools/capture.mjs references /tmp/yb-review/sets/reference
# 5. 盲測組裝：A/B/C 隨機，對照表寫在評審資料夾外
python3 docs/design-review/tools/make_round.py m1 /tmp/yb-review/sets/new-m1   # 第二段輪次 m1、m2…，資料夾 rounds/rm1
# 長時間的一組在 macOS 用 nohup 背景執行；中斷後加 SKIP_EXISTING=1 重跑 run-set.sh 續拍
```
