# 新文易數／有影儀表板對照

2026-10-12 更新七組原生瀏覽器並排截圖。左側為公開 tag.observe.tw，右側為 HTTPS 預覽的有影儀表板（六組使用 `youtube-board-ts:cutover-local`；頻道補拍使用 `youtube-board-ts:cutover-final-local`，均為合成資料、未登入）。程式對照以母站固定 commit **afe0a653** 為準；公開站可能包含較新的元件或內容。母站工作目錄未修改。

圖片僅並排加標題，沒有裁掉資料註記、空狀態或修飾內容。完整原圖路徑、URL、viewport 與主題在 `.local/ui-comparison/manifest.json`，DOM 尺寸、互動與 CSP 檢查在 `final-right-checks.json`。

| 類型 | 左／右頁面 | 圖片（本機驗收附件） |
| --- | --- | --- |
| 首頁 | `/`／`/`，1280×800、淺色 | [首頁](../.local/ui-comparison/home-light.png) |
| 排行 | `/ranking/`／`/tags/990001/channels` | [排行](../.local/ui-comparison/ranking-light.png) |
| 事件 | `/eve/1530/?at=…`／首頁實際連至 `/ai/days/990001/events?event=…` | [事件](../.local/ui-comparison/event-light.png) |
| 媒體／頻道 | `/media/cna/`／`/channels/990001` | [頻道](../.local/ui-comparison/channel-light.png) |
| 詞彙／標籤 | `/tag/鴻海/`／`/keywords/交通/videos` | [標籤](../.local/ui-comparison/keyword-light.png) |
| 手機 | `/`／`/`，390×844、淺色 | [手機](../.local/ui-comparison/home-mobile.png) |
| 深色 | `/`／`/`，1280×800 | [深色](../.local/ui-comparison/home-dark.png) |

本輪依原始碼補齊：我的頁面中性 SectionTabs、表格 utility 不再被舊全域 CSS 蓋過、第四組「寫法」導覽、頻道主欄＋19rem資料側欄、關鍵字主欄＋18rem篩選／涵蓋側欄、事件主欄＋240–320px封面／摘要。事件後續來源比較維持母站的全寬段落，沒有自行加永久側欄。詳見 [逐頁稽核](frontend-final-audit.md) 與 [首頁來源對照](home-ui-source-map.md)。

實測所有七頁無 document 水平溢位；字體 stack 相同。首頁欄寬238/561/280px，頻道主欄792px＋304px側欄，關鍵字808px＋288px側欄。手機選單、寫法導覽、主題切換均實際操作；15個首頁 script 皆有 nonce，未觀察到 CSP 或 hydration 錯誤。縮圖404只涉及合成 Fixture* ID，正常退回佔位圖。預覽不存在 `/ai/events/990001` 資料，故保留404診斷並改用首頁真實事件連結，沒有為截圖補造資料。

刻意保留的差異：

- 延續「有影儀表板」，採母站字體家族排列，中間是舊站播放箭頭穿過橢圓環；YouTube 紅代替母站橙色。
- 文章／媒體／署名對應影片／頻道／群組與直播。保留 YouTube 必要入口，不虛構署名、政治分數或新聞關係圖。
- 觀看累計、觀看增量、直播在線、影片引用與共同詞彙文章篇數分開標示，不混用母站文章或流量指標。
- fixture 提醒、來源時間、未比對／過期證據、未發布分析與缺漏照實顯示；此組截圖不代表正式資料數字 parity。
- 母站媒體流量、政治陣營或其他沒有 YouTube 對應來源的區塊，用確有資料的頻道觀測／來源说明替代；不造圖、不造統計。

安全修正後使用 nonce 的 HTML 回應不共用快取；API仍依資料公開／私人性質各自設快取策略。新增正式資料驗收及上線證據會另列，不用這組合成資料截圖代替。

頻道頁補拍已改成母站式分隔影片列表，主欄792px、標題可用684px，保留96px縮圖；不再擠入11欄表格。原生展開／收合實測可讀到全部8組收錄與互動指標、pending收錄註記。390px檢查列表358px、標題250px，沒有document溢位，手機側欄預設收合。淺色截圖已回到頁頂；深色與手機版也檢查過幾何和缺圖退回，未新增或替換其他六組截圖。補拍環境digest與細節在 `channel-followup.json`；此結果不代表正式資料效能驗收。
