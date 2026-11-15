# YouTube 內容管理與 favicon 發布 — 2026-11-15

使用者核准「push to main + 部署」。功能及介面見 [內容管理工具](content-admin-2026-11-15.md)。

## 程式與建置

- `main` 原先落後遠端 29 個提交；先提交此次精確 31 個檔案，再無衝突 rebase 到 `38ffb599`，保留 PR #23 的首頁與共用介面更新。正常 fast-forward 推送 `4fa6e4ed4af5a383910cf98869c587efc8e9c0c9`，沒有 force push。
- 其他 session 的 `tools/restore-live-tracking.mjs` 及測試維持未追蹤，未納入提交或建置。
- 本機完整隔離 MariaDB／Redis integration lane 已通過。整合遠端後再次完成全平台 typecheck、web 全套 447 通過／2 原有跳過。ICO frame 測試 3 項、品牌與新介面 focused tests 6 項皆通過。來源 worker 另有 13 項拋棄式 MariaDB 測試，包括影片／直播寫入、重播與故障回滾。
- `sky-server` 當時剩餘約 25 GiB、load1 約 14，沒有在正式主機重新編譯 Next。`sky-mini` 用 Node 24.22.3、乾淨 git archive、鎖定依賴 `npm ci`、`NODE_OPTIONS=--max-old-space-size=2048`、低優先權執行正式建置，GA ID `G-X2G1PLNP7K`。
- 將可攜的 `.next/standalone/web`（沒有 native node_modules）、static 與 public 資產帶回 sky-server，在既有 amd64 runtime base 上封裝；沿用 base 的 Linux amd64 依賴。所有 workspace production dependency 的實際版本與候選 source 安裝一致。封裝使用 legacy Docker builder、1 CPU、1800 MiB 記憶體上限，沒有在其中重新編譯 Next。
- 候選來源為乾淨 `4fa6e4ed`；建置目錄 `/home/sky/yt-release-content-4fa6e4e`。映像 `youtube-board-ts:release-content-4fa6e4e-amd64`：
  `sha256:79f86ec48c7b63e7567fec15c4a7b6ff28de7b44d8b4e00259f1a3d1675ac713`。

## 發布邊界

只更換 `web.image`、`worker-youtube-source.image`。排程、secrets、資料庫 grants、其他服務與 Dokploy env 皆由發布腳本逐欄比對保持不變；無 migration 或手動來源資料異動。

- 原 web：`sha256:64c599e5d7872a62cae50b2fe88c132240228973b95d270716d07177526f8765`。
- 原 source worker：`sha256:f64737e8ff5002e64418631054c64f8d7f8d424efd6239bda8f6418f54b56a2c`。
- 候選及正式 source worker 都以自身憑證實際通過 `connectDatabase` 的精確授權／facade 映射驗證。工作流程能力宣告雖擴充，youtube-source 的有效授權聯集仍為原有 26 張表。
- 對照現有 source worker 的 318 個 runtime/source 模組；`ingestion/src` 只有本次 `channel-admin.ts` 改動，沒有遺失線上擷取修正。
- source worker 既有更新策略為 `stop-first`、parallelism 1，web 為 `start-first`；工作仍受資料庫 writer lock 保護。

Dokploy 在 **2026-11-15 13:26:40 UTC（台灣 21:26:40）**接受發布。source worker 於 13:26:55、web 於 13:27:12 完成 Swarm 更新，兩者皆 1/1，web healthy。

## 驗證

候選與正式站各 11 項 HTTP 檢查通過：readiness、liveness、首頁、保留 add/title 的管理入口、來源／直播搜尋 API 的未登入 401、請求紀錄未登入 401、頻道、即時直播、新 ICO、深色 SVG。ICO 實際回傳 bytes 與本次修正檔一致，首頁品牌版本為 `20261115`。

正式 worker 的 `youtube.channels.admin` 於 13:27:03 UTC 成功完成，確認部署後的每分鐘排程仍正常。正式 web 以自己的 reports reader 唯讀呼叫新 lookup：示範影片 `NMD7UT4hzf4` 已收錄、所屬頻道 #4156、沒有直播追蹤列；直播關鍵字「音樂」成功回傳上限 25 筆。沒有為驗證而新增影片、直播或修改標籤。

瀏覽器登入後實際提交異動尚未代使用者操作；API 權限與 CSRF 有自動化測試，來源 writer 有真實 MariaDB 故障回滾測試。預覽示範資料不作為正式資料驗證。

## 回復

`python3 /home/sky/yt-release-content-4fa6e4e/release-content.py --execute --rollback`

腳本先檢查兩個服務的映像符合本次版本，再恢復前一版。部署前 compose/env/command 的 0600 備份：
`/home/sky/yt-release-content-4fa6e4e/release-content-before-20261115T132640Z.private.json`。
正式驗證通過後移除暫時候選容器與其私有環境檔。

## 介面精簡後續版本

依使用者回饋，`33e2a8984e9e87e916d80b65b49588d74801ef89` 移除重複的收錄內容搜尋分頁與多層灰底／外框，桌面右側標籤佔兩欄；既有頻道與新增時的標籤都完整展開，沒有內部捲動。Tailscale 預覽改用約 100 個示範標籤。

型別檢查通過，web 全套 448 通過、2 原有跳過；其中新增 120 個標籤完整顯示的回歸檢查。以乾淨 commit archive 在 sky-mini 用 Node 24 完成 Next 正式編譯，沿用前次 Linux amd64 runtime 封裝。傳回編譯產物後移除 macOS archive metadata。

後續映像 `youtube-board-ts:release-admin-flat-33e2a89-amd64`：
`sha256:19c4c02d1645fc7879b7a11ac702eb465dea07d07df79ca9e87c1eb2f2093a15`。

發布腳本 `/home/sky/yt-release-admin-flat-33e2a89/release-flat.py` 逐欄比對，只允許 `web.image` 從前版 `79f86ec4` 更換；不更換 worker、env 或其他 compose 設定。

Dokploy 於 **2026-11-15 13:46:51 UTC（台灣 21:46:51）**接受後續發布，web 於 13:47:25 UTC 完成更新。候選及正式站各 11 項 HTTP 檢查通過，正式 web healthy；source worker 保持前版映像。套件輸出也確認包含加寬的標籤版面，且沒有重複搜尋分頁。沒有為驗證而提交正式資料異動。

回復此次介面版本：`python3 /home/sky/yt-release-admin-flat-33e2a89/release-flat.py --execute --rollback`；此命令只回復 web 到 `79f86ec4`，保留前次已上線的內容管理功能與 source worker。

## 縮圖、頭像與標籤數量後續版本

`0965f0a63365d7f448b0381bbe698bc60b4d443e` 在收錄狀態顯示影片縮圖與快取頻道頭像，桌面左右欄各半。兩種標籤編輯入口都顯示頻道數並由多到少排序；數量取完整管理頻道清單（含封存），同一頻道同一標籤不重複計數，零使用標籤保留。同數量按 tag ID 排序。沒有 API、schema、worker 或額外 YouTube API 呼叫的變更。

web 型別檢查通過；全套 450 項通過、2 原有跳過，涵蓋媒體輸出與標籤頻道數／排序。乾淨 commit archive 在 sky-mini 用 Node 24 完成 Next 正式編譯，僅傳回可攜編譯輸出，使用前版 Linux amd64 runtime 封裝。

映像 `youtube-board-ts:release-admin-media-0965f0a-amd64`：
`sha256:919c638a0070a19262349c91a6f2a2247652fa17fe1d33f25079bd32a84497e5`。
發布腳本 `/home/sky/yt-release-admin-media-0965f0a/release-media.py` 只允許更換 `web.image`，並逐欄驗證其他 compose/env 不變。

Dokploy 於 **2026-11-15 13:55:16 UTC（台灣 21:55:16）**接受發布，web 於 13:55:49 UTC 完成更新並 healthy。候選與正式站各 11 項 HTTP 檢查通過；另以既有影片 `NMD7UT4hzf4` 驗證縮圖 endpoint 的設定寬度 320、quality 75，候選回傳 JPEG 320×180，正式站 HTTP 200。手動測試使用不允許的寬度 384 被正常拒絕；不存在的影片縮圖回傳 404，既有媒體元件會顯示替代圖示。沒有為驗證而提交正式資料異動。

回復此版：`python3 /home/sky/yt-release-admin-media-0965f0a/release-media.py --execute --rollback`，僅把 web 恢復至 `19c4c02d`。

## 統一標籤選擇器

使用者比較未帶入網址與已辨識頻道兩種畫面後，`be08a422f4b3a6beb1e878afcfc69ade93f2cff9` 將加入時的 checkbox 列表與編輯頻道的圓角按鈕統一成共用 `TagPicker`。選取、搜尋、頻道數、排序、完整展開一致；加入請求與既有分類差異請求仍沿原流程。型別檢查、7 項 focused tests 與 sky-mini Node 24 的 Next 正式編譯通過。

映像 `youtube-board-ts:release-tag-picker-be08a42-amd64`：
`sha256:860224386daaa3442a93ca4a94460e442955c1ada33b756544e3ba0d8b5ff16f`。
`/home/sky/yt-release-tag-picker-be08a42/release-picker.py` 只允許更換 web image，逐欄保持其他 compose/env 不變。沒有 API、worker、schema 或正式內容資料異動。

Dokploy 於 **2026-11-15 13:59:56 UTC（台灣 21:59:56）**接受發布，web 於 14:00:30 UTC 完成更新並 healthy。候選與正式站各 11 項 HTTP 檢查通過。回復：`python3 /home/sky/yt-release-tag-picker-be08a42/release-picker.py --execute --rollback`，僅把 web 恢復至 `919c638a`。

## 直播辨識、標籤建立與關鍵字覆核修正

`47005aed2dee02c77a81fd7acfef92ba42086b83` 修正未收錄內容被畫成一般影片、無發布頻道資訊、缺少建立標籤入口，以及關鍵字覆核頁拒絕現行 API status 契約的問題。詳見內容管理文件的即時辨識修正。建立標籤沿原有 `create-tag` source 工作流程；編輯草稿在清單刷新時保留並合併同期新增標籤。只加入頻道的按鈕與直播／影片主動作說明各自影響。

API 相關 27 項通過，web 454 項通過、2 既有跳過，API／web 型別檢查及 sky-mini Node 24 Next 正式編譯通過。完成一次有實際回文的獨立審查，已修正草稿刷新、頻道歧義文案及名稱正規化三項問題；新增草稿合併回歸檢查後重跑前端全套通過。

映像 `youtube-board-ts:release-intake-fix-47005ae-amd64`：
`sha256:995a1c2a26a49890db98671bb48a00a77c2c69e75a5a3c9736021c9b1c7344db`。
僅更換 web 映像，包含 API 與 shared 模組更新；不更換 worker、不變更 schema、grants、排程或 Dokploy env。發布腳本 `/home/sky/yt-release-intake-fix-47005ae/release-fix.py` 逐欄驗證設定不漂移。

候選容器以自身 reports reader 唯讀查詢使用者提供的 `Vthypqd1Ni0`，確認 YouTube 公開 metadata 為 `live`，發布頻道 `UCvN5h1ShZtc7nly3pezRayg`／Cecilia Immergreen Ch. hololive；本站影片、直播、頻道均未收錄。辨識沒有寫來源表或新增請求。

Dokploy 於 **2026-11-15 14:17:42 UTC（台灣 22:17:42）**接受發布，web 於 14:18:15 UTC 完成更新。候選與正式站各 12 項 HTTP 檢查通過（含 `/admin/keywords`）；正式 web 映像一致且 healthy。正式 web 再以自己的 reports reader 唯讀確認使用者網址仍為進行中的直播、發布頻道正確，本站仍未收錄，未為測試提交來源資料變更。登入後建立標籤／追蹤直播未代使用者提交；既有寫入工作流程與 API 驗證測試通過。

回復此次版本：`python3 /home/sky/yt-release-intake-fix-47005ae/release-fix.py --execute --rollback`，只把 web 恢復至 `86022438`，source worker 與其他服務不變。
