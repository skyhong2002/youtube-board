# Release live-table 5f78c3e（2026-10-24 台北 04:47，只換 web）：篩選列與即時直播表格改版

範圍只限 youtube.observe.tw 的 web。API、worker、scheduler 都沒有變。

## 起因

前一版 `/live/current` 恢復了舊站的範圍、開播時間和走勢線之後，使用者覺得篩選表單很難用：搜尋、顯示筆數、進階篩選面板、三個分類選擇器和小時輸入擠在一起。先在本機用正式資料做了三個版本（工具列＋摘要、膠囊、條件列表），使用者選了膠囊版，之後逐項調整：

- 顯示筆數改成往下捲動載入；
- 所有欄位可排序（含開播時間）；
- 「最近趨勢」看不出時間單位；
- 表格內容上下置中、標題與分類最多兩行、列高等於兩行字；
- 分類選單被表格標題列蓋住（破圖）；
- 「任一分類」和「同時符合」太重複；
- 滑過縮圖可以看直播畫面，點過網站後預設有聲音；
- 統計卡片和「更新觀測」列太佔空間。

## 變更

- main：`d91e604`（14 檔，只有 `platform/web/src`）。
- release 分支：`release/live-table-d91e604` = `5f78c3e29f01fbd959492233cdac71fdc837030e`，也就是正式的 `f4b6d39`（`release/home-pool-f8cf5dd`）再 cherry-pick `d91e604`。所以 `f8cf5dd` 和 `7ea09a5` 都在裡面。

### 篩選列（直播、頻道、影片列表共用）

- 一列膠囊：搜尋、「分類」、「排除」、直播的開播時間（不限／6 小時／24 小時／3 天／7 天，原有的自訂值保留可選），非直播列表才有筆數。頻道與影片的其他條件放在「更多條件」。
- 「分類」膠囊裡可切換「符合任一」（`or`）與「全部符合」（`tagid`）。舊連結同時帶 `or` 和 `tagid` 時照舊顯示兩顆，不會丟條件。
- 選單層級改成 `z-40`，在表格的跟隨標題列（`z-index:20`）上面。

### 即時直播表格

- **捲動載入：** 先列 50 場，捲到底再載入 50 場（`router.replace` 加大 `limit`），最多到 API 每頁上限 200；之後或帶 `offset` 的舊連結仍用頁碼。
- **排序：** 每一欄都能在瀏覽器排序（舊站 live.php 用 DataTables，也是前端排序）。未知值一律排最後；「直播」欄回到同時在線排名；「今日走勢」依起訖增減比例排序。若還有未載入的列，排序前先載入全部（最多 200）。手機用上方的排序選單。
- **列高與版面：**
  - 每列是兩行字高（49px）：縮圖 72×40；標題 232px，最多兩行；頻道分類 136px，最多兩行。每格上下置中。
  - 第一欄固定。1280px 寬時整張表放得下（溢出 ≤1px，TableScroller 視為不可捲動）。較窄時可左右捲動，不再顯示「左右捲動表格可查看其餘欄位」。
- **今日走勢：** 原「最近趨勢」。線下標出第一筆到最後一筆取樣的台北時間；tooltip 顯示筆數與起訖人數。資料是今天 0 點起最近 24 筆，約每 11 分鐘一筆。
- **直播預覽：**
  - 電腦版滑鼠停在縮圖 0.35 秒，縮圖下方開一個 youtube-nocookie 播放器，最寬 720，放不下時改放上方。播放器 portal 到 `<body>`，不會被表格裁切；離開或捲動就關閉。
  - 聲音：頁面已有使用者互動（`navigator.userActivation.hasBeenActive`）時預設有聲音，否則靜音。之後依讀者在播放器裡最後一次的靜音與音量（postMessage 的 `infoDelivery`，存在 localStorage `livePreviewAudio`）。
  - 瀏覽器仍擋有聲自動播放時，2.5 秒後改靜音播放。這次自動靜音和送出的 `setVolume` 都不會被記成讀者的選擇。
  - 沒有載入 YouTube 的 iframe_api 腳本；CSP 原本就允許 `frame-src https://www.youtube-nocookie.com`。
- **手機卡片：** 卡片最上方是整排寬的縮圖，點了在卡片內播放（`YouTubeFacade`）。
- **摘要列：** 兩張統計卡和「更新觀測」列合成表格上方一行：「N 場直播 · 已列出的同時在線加總 M 人（同一觀眾可能重複計入）」，右邊是「每 60 秒自動更新」和「立即更新」。自動更新的行為不變，背景分頁仍會暫停。
- 方法說明補上今日走勢、排序、載入更多、直播預覽。

## 測試

在乾淨的 release worktree（`5f78c3e`）上執行：

| 項目 | 結果 |
| --- | --- |
| web `tsc --noEmit` | 0 錯誤 |
| web `node --test` | 390 項：388 pass、2 skipped、0 fail |

新增的測試：
- 排序規則（`sortLiveRows`）；
- 播放器位置（`previewPlace`）；
- 聲音規則（`previewAudio`、`readPreviewAudio`）；
- 只讀 YouTube 的 info 訊息（`playerReport`）；
- 分類膠囊依比對方式送出 `or` 或 `tagid`；
- 直播表格的排序按鈕、置中、兩行版面、走勢時間標示。

本機預覽用 Playwright 經 Tailscale 驗證，Chrome 預設播放政策 `document-user-activation-required`：
- 點過之後預覽有聲音；按靜音後下一個預覽是靜音，取消後恢復有聲；
- 存的音量 30 會套用，不會被改回 100；
- 手機版不會左右溢出。

## 建置

- **映像：** `youtube-board-ts:release-live-table-5f78c3e` = `sha256:a0b429fe88c3a9750b4e500beddc907c6e9372666eadea4fb5b7ec45433d2550`
  - revision label 是 `5f78c3e…`，BUILD_ID 是 `lUUlLFq--uEvzCtUqgocg`；建置時間 20:41:44–20:44:17Z。
- **做法：** 建置目錄 `/home/ubuntu/yt-release-live-table-5f78c3e/`，source 來自 `git archive 5f78c3e platform`；`Dockerfile.web-overlay` 的 sha256 是 `c3aded68…`。
  - build 與 runtime 兩個 stage 都以正式映像 `release-home-pool-f4b6d39`（`100a11fd`）為基底，只重跑 `next build`；runtime 只換 `.next` standalone、static、public、BUILD_ID。
  - 和前一版不同，沒有覆蓋任何 API 檔。
- **映像內核對：** `api`、`shared`、`runtime`、`ingestion` 全部檔案的 sha256 清單，與 `100a11fd` 完全相同（`f832bec0…`）。

## 隔離 smoke（20:44:48–20:46:49Z）

- **設定：** 唯讀 loopback 候選 127.0.0.1:18177（`/tmp/yt-candidate-live-table.sh`）。用 live web env，但拿掉 Redis 與所有寫入；`tag.observe.tw` 指到 loopback。
- **結果：**
  - 約 48 秒 ready，api／ui／security 都 ready。
  - 23 個路徑的狀態碼和正式站完全相同：`/`、`/keywords`、5 種 `/live/current` 範圍、`/live/current?or=1,2&tagid=3`、`/live/current?limit=20`、`/channels`、`/videos?tagid=1`、`/tags/1/channels`、`/channels/8`、`/channels/8/videos`、`/keywords/颱風/videos`、`/ai/days`、`/mayor`、`/api`、`/sitemap.xml`，以及 `/ch/3113/` 與 `/live.php?...` 的 308。
  - 新文字都有出現；舊的「更新觀測」「進階篩選」「左右捲動表格…」「本頁同時在線加總」都是 0。
  - CSP 的 frame-src 有 youtube-nocookie；log 錯誤 0。
- 驗完已移除候選容器。

## 換版

- **指令：** `.local/dokploy/release-service-image.py --service=web --old=sha256:100a11fd… --new=sha256:a0b429fe… --title=…`。
  - 先 dry-run，只有 web 會換。
  - 執行前 load 6.2，I/O avg10 11.5%。
- **時間：** 20:47:04Z 送出；新 task `xjbrm2hf5u4u` 在 20:48 前後 healthy、沒有重啟，`UpdateStatus=completed`。
  - 私有備份：`release-service-image-before-20261023T204704Z.private.json`。
- **其他 10 個服務沒有變：**
  - worker-ai-daily：`feb3fdf3…`
  - worker-ai-hourly、worker-youtube-source：`44dcc1d5…`
  - 其餘：`65038431…`，redis 維持原映像
- **回復：**
  ```
  release-service-image.py --service=web --old=sha256:a0b429fe88c3a9750b4e500beddc907c6e9372666eadea4fb5b7ec45433d2550 --new=sha256:100a11fd0f78991b01f9786c0bc643774bbaac67b10996d062d0926d60aea6fe --title="Rollback to release-home-pool-f4b6d39" --execute
  ```

## 正式驗證（經 Cloudflare）

- **狀態碼：** 13 個路徑都是 200，`/ch/3113/` 是 308。
- **新版內容：** `/live/current?or=1,2,12,13,14,81` 已是新版：「今日走勢」54 處、「每 60 秒自動更新」、「已列出的同時在線加總」，沒有舊用語。
- **Playwright（youtube.observe.tw，1280×900）：**
  - 23 場、每列 49px、表格不需左右捲動；
  - 依開播時間排序正常；
  - 點過頁面後，停在縮圖會開預覽播放器，`mute=0`；
  - 頁面錯誤 0、CSP 拒絕 0；
  - 手機 390px：23 張卡片，不會左右溢出。

## 之後

- 之後任何換 web 的 release 都必須包含 `f8cf5dd`、`7ea09a5` 和 `d91e604`。
- 頻道、影片列表也換成同一個篩選列，但仍是筆數加頁碼，沒有捲動載入，也沒有前端排序。
