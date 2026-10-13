# 654cdf5 關鍵字 unavailable：離線追查與修正

本紀錄只根據已保存的檔案與原始碼；凍結期間沒有 HTTP probe、DB 查詢、capture、建置或部署。工作樹修正尚未形成新的候選 SHA，不能當成視覺驗收。

## 已確認的失敗路徑

`/keywords` 排行透過 `report-pages.tsx` 讀取 `/api/v1/home`，不是詞庫清單的 `/api/v1/keywords`。`home-exploration.ts` 在同一次 `keywordTask` 中計算今日與近七日；來源不可用或容量／數值精度防護失敗會令兩個期間一起降級。無已發布詞庫是另一種 `not-synchronized` 狀態，不等同資料源故障。

內部 `home-result-cache` 原本已拒絕 unavailable 結果，但公開 API 仍可對語意降級的 HTTP 200 回傳共享快取標頭，Next 資料快取也只檢查 HTTP 成功。現在 API 對任一 unavailable 首頁區塊標記 private/no-store；Next 的公開 home 資料快取驗證語意完整性，失敗時拋出不含資料的錯誤，避免取代既有良好快取。真正的空結果與未同步狀態仍然可辨識，不冒充資料源錯誤。

## 歷史觸發原因的證據界線

21:38 的既有截圖中 Today 顯示 unavailable，Week 顯示40項；這是不同時間的畫面，不代表同一次後端結果只壞掉一個期間。保存的健康 home JSON 在19:55、20:05、20:19 UTC，兩期間均 synchronized，版本 youtube-first-20261011；不能拿較早的正常回應替代21:38的失敗回應。

20:54–20:55 的 canary 首頁200耗時11,197ms，關鍵字頁200耗時387ms；當時的成功條件只涵蓋HTTP/CSP等，未證明排行有內容。不得以canary passed宣稱正常資料畫面通過。

原失敗回應的 reason、cache age／render mode、DB錯誤沒有保存。**確切初始觸發原因無法從現有離線證據復原**，不能宣稱已證實查詢逾時、fixture問題或某一容量上限。程式證實的共享快取缺口是可修正因素，尚非這批截圖的因果證明。新增的安全階段診斷會供解除凍結後區分故障路徑，不追溯補造歷史紀錄。

## 其他 findings

- 支持影片：全歷史查詢有意省略部分coverage計數，已有total=1,137及實際影片列；舊提示卻預設空列表。改由實際visibleCount與total選文案，未知coverage仍顯示未知。
- 頻道表：手機名稱最多兩行，排序中的數值欄緊接身分欄；保留其餘數字欄與sticky規則。
- 首頁期間：加入可核對的選擇／內容標記，擷取腳本要求穩定且一致的期間狀態。原混合期間finding保持open，不能由SSR測試或不同bytes的新圖直接關閉。

前端修改由Opus5.5實作，獨立來源review與34項focused web測試證據見ui-review-ledger。新SHA的視覺、深色與互動驗收仍待使用者解除凍結後進行；歷史zero-GA未證。

## 原始證據指紋

- `/home/deck/.cache/youtube-ui-review/ui_ledger-2026-10-13/candidate-retest-654cdf5/captures.json`：SHA-256 `6e44ffd5fc432fa93507169b63e4ab2c36161db3536e415e3646646ccfdd0cf5`
- `/home/deck/Projects/youtube-board-f2/platform/.local/f2/candidate-canary-654cdf5.json`：SHA-256 `9c1e4f6e327d2953edddbbb0d2288d427042602299f3ff6754ec4fd874957c45`
- `/home/deck/Projects/youtube-board-f2/platform/.local/f2/candidate-home-response.json`：SHA-256 `d53b6d34cfcff264b54e86292847568ed9d87e1451348f17afa2690abc3de0d5`
- `/home/deck/Projects/youtube-board-f2/platform/.local/f2/candidate-cache-home-response.json`：SHA-256 `d3528408229a0426b8157a0a7e80c4b69103c8b06c9421f65ffc117c1779c7df`
- `/home/deck/Projects/youtube-board-f2/platform/.local/f2/candidate-final-home-response.json`：SHA-256 `bd8da1c25a8f3fdf5846f9362b51624aa8170c2db144e33d13747ae2e714cb52`

## 離線驗證結果

新增固定欄位的HOME_SECTION_UNAVAILABLE診斷，區分詞庫、影片来源、term、排行、逐日、代表圖及版本檢查階段；每組每分鐘最多一筆，未輸出SQL、參數、詞、URL或原始錯誤。API契約保持不變；版本切換的API reason仍為source-cap，但診斷明確為version-changed。

DB-free failure、partial HTTP cache與home result cache三檔共25項測試通過；API TypeScript noEmit（incremental=false）通過。前端34項focused測試既有檔案hash仍一致。無DB存取、HTTP probe、建置或部署。私有證據：`platform/.local/f2/offline-backend-failure-proof.json`。
