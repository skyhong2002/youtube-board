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
