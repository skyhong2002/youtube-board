# 關鍵字影片查詢逾時修正（2026-10-12）

公開關鍵字頁的影片查詢，原先將 UTF-8 來源 videoId 與 ASCII 證據 video_id 直接比較，無法穩定使用比對標記主鍵。正式站「新聞」與「沈伯洋」約5.2秒回503。

修正保留來源影片的期間、分類、排序、分頁與原始文字指紋判定；只將來源ID轉成ASCII作為索引查找鍵，另保留BINARY byte-exact檢查。證據查詢採既有 SHA-256(source + NUL + term) 詞條鍵與BINARY詞彙檢查，不改寫詞庫、影片或證據。

發布前以正式唯讀帳號、原5秒SQL上限量測：新聞407ms、50筆／總數5120；沈伯洋305ms、50筆／總數1194。期間為2026-10-06至2026-10-12。這是已比對且文字仍新鮮的影片數，並非期間全站覆蓋率。

API typecheck及隔離MariaDB兩組35個測試通過；修正測試fixture使用與正式匯入相同的詞條鍵。Codex獨立審查通過，採納補上證據ID的BINARY防護。

部署只更換API service.ts，保留既有編譯前端、環境、權限、路由與Laravel scheduler。沒有資料庫DDL/DML，也不啟動比對工作。部署後的實際驗收另行記錄；新品質比對、API文件與前端失敗狀態屬後續批次。

## 正式部署驗收

2026-10-12 13:06 UTC，commit `a12c546` 已透過 Dokploy image-only 更新，映像固定為 `sha256:4149a56ad4d20ae8721d448d980b6eab69b8d2cd4620aa90ff73f42e93a0c590`。31項隔離 canary 檢查通過；映像來源、API檔案雜湊、編譯前端完整樹、既有 runtime 設定均驗證。

公開 HTTPS 驗收：新聞 API 574ms、沈伯洋 API 525ms，皆200、50筆，總數分別5120與1194；相同期間頁面855ms與831ms，皆200。`/auth/me`與`/my`保留private/no-store；tag/blog均200；Laravel scheduler仍是原容器，未重新啟動。這些是單次端對端量測，不是負載測試。

回退只需在TS compose把web與account-maintenance的image改回前一個固定映像 `sha256:a4bb06fa67b25a5d7736250a4ad578cec8da75c8cc4a8b613dca772b1f2a7812` 並部署；不還原資料、不更動Laravel。

後續仍需完成首次讀取失敗的中文錯誤畫面與串流CSP整合驗收；本次僅宣告查詢逾時修正完成。
