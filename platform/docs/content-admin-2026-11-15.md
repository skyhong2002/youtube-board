# 影片、直播與頻道管理工具（2026-11-15）

已於 2026-11-15 推送 main 並部署，見[發布紀錄](release-content-admin-2026-11-15.md)。

## 管理流程

`/admin?add=<YouTube 網址>&title=<頁面標題>` 保留既有書籤入口。新版書籤帶入頁面標題作為顯示提示；收錄身分仍以網址及 YouTube 回傳資料確認，不採信頁面標題。影片網址優先於可能因 YouTube SPA 導航而過時的頻道 meta。登入後保留帶入參數。

主要工具預設展開，貼上網址後自動查詢影片、直播追蹤與頻道各自的來源表紀錄，提供對應公開頁連結與頻道標籤編輯。管理頁移除與全站搜尋重複的「搜尋已收錄內容」分頁；後端搜尋 API 保留。這是本站資料查詢，沒有新增 YouTube 全站搜尋或 discovery 排程。

新增動作分為納入頻道、收錄指定影片與加入直播追蹤。標籤屬於頻道分類，不是影片內容關鍵字或 tag.observe.tw 的新聞詞彙。編輯分類沿用增減差異與稽核日誌。頻道標籤、書籤安裝與變更紀錄直接展開；介面不提供建立新標籤的表單。

## 讀寫邊界

- `GET /auth/admin/content?source=...` 或 `?q=...&kind=live|video|channel`：管理員 session、私有回應、參數驗證與頻率上限；只讀 reports reader，不呼叫外部服務。無法確認影片所屬頻道時明確顯示未知；重複 handle 不任選一筆。
- `POST /auth/admin/channel-requests`：沿用同源、CSRF、UUID、防重送、容量上限。新 kind `add-video`、`add-live` 使用 `{source,tags}`，只接受指定影片網址。
- `youtube.channels.admin`：仍由 youtube-source worker 在既有 workflow ownership 下處理。指定影片透過 YouTube 查核，必要時建立所屬頻道，再沿用 `publishUploads` 寫入影片、統計排程與適用的直播紀錄。一般影片不能冒充直播；已結束直播可用 streaming details 確認。已停用的直播不會自動復活。
- 每筆請求的頻道、標籤、影片、排程、直播及完成狀態共用交易。失敗回滾；配額／憑證中斷保持 pending。Web 不持有來源表寫權限。
- `worker-permissions.json` 增加此 workflow 的影片表能力宣告；youtube-source 批次原有的授權聯集不變，不需新增正式資料庫 grants 或 migration。

即時狀態查詢顯示來源表已收錄，不代表公開報表快取已完成；介面會提示等待更新。套用通常等待既有每分鐘 worker，實際時間取決於 runtime 排程和佇列狀態。

## 參考與驗證

經使用者授權，以 SSH 唯讀查看 meta3 的 `/home/urtube/app/admin.php` 與 `redir/add_video.php`、`add_live.php`、`tag.php`。只參考操作語意，沒有執行舊 PHP、資料寫入或管理網址。

針對新增路徑的驗證包括 API 權限／查詢參數／搜尋上限、書籤網址與標題編碼、UI 靜態渲染及狀態呈現、worker 單元測試，以及拋棄式 MariaDB 寫入、重播與故障回滾測試。另在本機隔離的完整來源 schema 上實際執行六種 lookup/search SQL，皆成功。型別檢查與 Next 正式編譯通過。瀏覽器拖曳書籤及真實登入點擊未驗證；正式 lookup 與每分鐘工作已在核准部署後驗證，詳見發布紀錄。

完整 `npm run test:integration` 已成功（所有 workspace、隔離 MariaDB／Redis），另新增介面與客戶端相關的 22 項 focused checks 全數通過。

完成一次 Codex 與一次有實際回文的 Opus 5.5 審查（一次截斷嘗試不計）。採納搜尋頻道身分、封存狀態、查詢時停用送出、分類說明與錯誤提示等修正；審查後 API 23、ingestion 34、web 22 項 focused tests 全數通過，完整型別檢查與 Next 編譯再次通過。

介面後續調整：桌面改雙欄，頻道標籤預設可編輯；移除建立新標籤表單與工具收合，最近變更直接顯示。Tailscale 示範頁改用正式 `SiteHeader`、`SiteFooter` 與 `AdminLayout` 元件，資料仍為隔離示範，不會寫入正式站。

桌面介面再次精簡：移除內容工具、收錄狀態、標籤編輯與最近變更的多層灰底及外框；左側網址與狀態佔一欄，右側標籤佔兩欄。既有頻道與加入時的標籤都完整展開，沒有標籤區內部高度限制或捲動條。
