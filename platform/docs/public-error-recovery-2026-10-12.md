# 公開報表失敗畫面與 CSP（2026-10-12）

查詢效能修正已另以 `a12c546` 部署。此批處理首次 ISR 失敗：封裝 Next 實測會在 React error boundary 之前直接回純文字500，因此只改 error.tsx 不足。gateway 現在使用 Opus 5.5 實作的本站靜態中文頁回503，保留重試與首頁連結；CSS由gateway提供，Next停止仍可載入。

失敗頁永遠private/no-store、Retry-After:5，清掉上游cookie、redirect與cacheheaders；不輸出URL或診斷。CSP為script-src none、style-src self、default-src none，保留HSTS及frame-ancestors/object-src/base-uri。Flight、靜態資源和feeds回純文字503，不偽裝HTML；公開v1錯誤為 `{error: string, code: string}`，帳號與legacy格式保留。

串流失敗額外允許精確版本的React `$RX` helper與有限literal參數；標記該HTML不可共享快取。採納Opus審查：加入已知notFound及本機redirect digest，外部/不安全redirect仍拒絕。未採納「任意digest字串」建議，現有公開頁不需要此寬度，保持較小接受集合。

驗證：隔離build成功；104項API/CSP/proxy/fallback測試及17項frontend讀取/ISR測試通過。實際封裝Next+gateway無DB測試重現首次讀取503，390px深淺色瀏覽器皆顯示中文頁、CSS成功、無橫向溢出，console只有預期503而無CSP違規。既有成功ISR/data快取機制未改；此批不改schema、資料、環境、路由或writer。

Opus負責 error.tsx、public-data.ts與staticHTML/CSS，Codex負責gateway/API、整合測試及部署。Codex獨立審查採納以pathname區分assets、避免query後綴誤判的修正。
