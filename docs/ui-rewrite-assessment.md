# 有影儀表板全 TypeScript 重寫

更新：2026-10-12。舊系統基準 commit：`0304909`。

使用者已決定由 agent 完整實作，前後端技術棧盡量與 `tag.observe.tw` 一致，最終移除 Laravel。先前建議的「Next.js + 長期保留 Laravel」已被此決策取代。

## 目標架構

- Node.js 24、TypeScript、Next.js 16、React 19、Tailwind 4、ECharts。
- 2026-10-12 使用者指定主題色為 YouTube 紅色 `#FF0000`；深淺色模式均使用紅色品牌，文字對比採合適紅色變體。
- Fastify 5 API、Drizzle/MariaDB、Redis/BullMQ 6，Docker/Dokploy。
- 新程式位於 `platform/`，獨立本機 MariaDB/Redis；現有 Laravel 仍是正式環境唯一現行系統。
- 保留歷史資料、公開網址、舊 API 格式、配額、續跑、鎖、通知去重與資料新鮮度語意。
- 新舊報表以同一批固定來源比較；shadow 計算只重播已捕獲資料，不重复打外部 API。
- 正式資料工作逐項轉移唯一寫入者；交接包含停止舊 writer、驗證 in-flight 工作、啟用明確 allowlist、觀察與回退。

## 共用標籤

`tag.observe.tw` 是共享詞彙來源，兩站各自計算新聞與 YouTube 指標。YouTube 頻道分類與內容標籤分開。標籤比對保留來源、版本、規則、原文欄位、位置及上下文。

上游 `/api/v1/articles` API 提供指定期間文章與標籤、cursor 分頁；這條同步流程標為 `observed-article-window`，不能稱為完整詞庫。完整索引快照的 exporter/importer 已在本機實作並完成跨專案契約測試，上游發布與實際快照驗收仍待交接，見[詞彙交接文件](../platform/docs/vocabulary-export-handoff.md)。原生文章關鍵字、編輯與規則補標混合，不能一概宣稱記者手動標註；兩種來源模式保留各自版本、涵蓋範圍與移除語意。

## 同時納入的產品工作

- 可分享自訂看板：來源、標籤、時間篩選。
- RSS 與後續訂閱通知，沿用來源佐證與通知去重。
- 穩定事件識別與事件 merge/split/rename 稽核；評估抽出既有 `TelegramStoryTracker` 的跨日追蹤。
- 顯示實測/推估、來源更新時間、涵蓋率與失效狀態。
- 新頻道候選與審核納入；新聞與影片事件交叉參考、標題措辭比較。
- 逐字稿/ASR 先作可選試驗，尚非已完成資料管線；獨立 blog crawler 不併入本次核心重寫。

會議內容僅提取產品需求；不保存私人逐字稿或分享 token。

## 執行與完成判準

由主 agent 與工具允許的並行 agent 分工，以 Codex 負責實作、一般 review 與日常拆解；約四分之一至三分之一的高價值節點經本機 CLI Proxy 呼叫 `claude-opus-5-5`，優先處理帳號安全、正式寫入風險與大型整合。每份 review 必須有實際回覆，Opus 回傳型號須核對；空回覆或截斷不算完成。建議處置、測試與實際次數記在 gitignore 目錄，不為湊比例重送小修正。

自動產生盤點 `platform/inventory/legacy.json` 包含 196 個路由宣告（68 reports、78 redirects、36 compatibility APIs、12 operations、2 write guards）和 45 項 ingestion jobs。宣告數不等於独立畫面數。進度與驗證證據另外記錄，不把 route stub 當成功能完成。

以 agent 實際交付校準時間，不使用人類工程師人日估算，也不把先前「約一天」當成保證。完整完成必須有功能/資料契約測試、真 MariaDB 行為驗證、前端建置與桌面/手機檢查，以及可執行部署/回退方案。

正式切換仍受既有操作限制：可還原備份、精確寫入 allowlist、唯一 writer 交接與明確 operator approval。此文件不啟用任何 production job。

目前實作與執行說明見 [`platform/README.md`](../platform/README.md)。本機候選已完成 1,029 項隔離測試、封裝與核准歷史切片比對；[驗收證據](../platform/docs/release-evidence.md)列出各項限制與待完成的正式環境驗收。尚未切換正式網站或 writer。
