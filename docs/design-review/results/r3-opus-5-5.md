## 組 A
一句話總評：資料頁的表格與卡片已經很完整，但錯誤頁和載入狀態仍是弱點：全站錯誤頁沒有頁首、跨頁載入時仍顯示舊頁面，紅色也同時用在上升、下降和走勢圖上。

| 項目 | 分數 | 證據（頁面／狀態 ID、尺寸、看到的事實） |
|---|---|---|
| 資訊層級 | 7 | home_desktop：中央是品牌標誌加文字雲 hero，下方分三欄（熱門標籤、焦點議題、即時直播），焦點議題的大圖與 H2 標題最先被看到。但這頁頁首左側沒有「有影儀表板」字標，導覽直接從「關鍵字」開始；keywords_desktop 與其他頁的頁首都有字標。 |
| 字體排印 | 6.5 | keywords_desktop 的數字欄靠右對齊，看起來是等寬數字，「≥1,505.74 萬 次（2,463 支缺值）」的括號字很小。home_desktop 熱門標籤卡的「熱度 1,920.2 +1,568.0／4,024 支・430 頻道」約 10–11px 灰字，在 1440 寬的畫面上也很難讀。 |
| 色彩 | 6.5 | 紅色品牌一致，深色外觀成立（home-dark、keywords-dark）。但 keywords_desktop 的 40 列走勢圖全部是紅色填色；升溫欄的正值是紅字、負值是黑字，紅色因此同時代表品牌、上升和一般走勢，語意不清。 |
| 間距與版面 | 7 | home_desktop 三欄對齊，焦點議題列表節奏穩定。keywords_desktop 的表格寬度合理。錯誤頁（home-error_desktop）只有一張虛線卡片貼在畫面頂端，下方大片空白，沒有版面骨架。 |
| 一致性 | 6 | 錯誤有兩種樣式：全站錯誤頁（home／keywords／channel／events-error 四頁的圖檔完全相同）有「重新讀取」紅鈕；live-error_desktop 是頁內虛線卡片，只有「←回到總覽」，沒有重試，標題用詞也不同（「資料來源暫時無法讀取」對「資料暫時無法讀取」）。 |
| 資訊密度 | 7.5 | keywords_desktop 一屏可看到十多列，每列有熱度、升溫、走勢、影片、命中、頻道、觀看、代表頻道。channel_mobile 卻在每部影片上方重複頻道名與頭像（「民視新聞網 Formosa TV News network」），在頻道頁是冗餘資訊。 |
| 導覽 | 6.5 | 主導覽有目前位置的紅底標示（keywords_desktop 的「關鍵字」）。但 home_desktop 頁首沒有字標，少了常見的「回首頁」入口；全站錯誤頁完全沒有頁首導覽，只能點「回到總覽」。 |
| 狀態與回饋 | 5 | home-error_desktop／mobile：沒有品牌、沒有導覽，也沒有說明是哪一頁。home-loading_desktop：從其他頁點進首頁時，畫面仍是完整的「即時直播觀測」舊頁，只有頁首一條紅線，看起來像點擊沒有作用。空資料頁的文案則有交代原因。 |
| 響應式 | 7 | live_mobile 與 channel_mobile 都改成卡片或列表，不是單純縮放；keywords_mobile 精簡欄位。keywords／live／channel／events-loading_mobile 四張圖完全相同（同一種大圖卡片骨架），沒有對應各頁的實際形狀。 |
| 文案 | 7 | 「無法讀取不代表影片、頻道或觀看數為零」交代清楚；有更新時間與台北時間。keywords_desktop 的「（2,463 支缺值）」是統計術語，讀者不易理解。 |
| 無障礙 | 5.5 | 升降只靠紅字、黑字與 +／− 號，沒有 ▲▼ 圖示（keywords_desktop、home_desktop 熱門標籤）。多處 10–11px 淺灰字；錯誤頁的次要動作是底線文字連結，點擊範圍小。 |
| 動畫與轉場 | 5 | 可見線索只有頁首紅色進度線（home-loading_desktop），以及一套所有頁共用的通用骨架（各 loading_mobile 圖檔相同）；轉場期間保留舊內容，容易誤導。依據有限，給保守分。 |

要保留的優點：
- keywords_desktop 的熱門標籤表：欄位完整、數字靠右，「≥ 萬次＋缺值數」誠實交代觀測下限。
- home_desktop 焦點議題卡：「56 個頻道在談／另有 109 支相關影片／AI 引用 20 筆」，把 AI 整理的範圍講清楚。
- live_mobile 的直播卡：同時在線、今日高峰、歷史高峰三個數字並列，旁邊附小走勢圖。
- 每頁都有「本頁的資料來源與計算方式」與更新時間（台北時間）。
- 深色外觀完整，keywords-dark 與 channel-dark 的對比都正常。

最重要的五個問題（由嚴重到輕微）：
1. [狀態與回饋] [home-error（另見 keywords-error、channel-error、events-error）] [兩者] 全站錯誤頁沒有頁首、品牌、導覽與頁面名稱，只有一張貼在頂端的虛線卡片 —— 使用者不知道身在哪個網站、哪一頁，也無法改去其他頁 —— 保留完整頁首與頁尾，標出原本要開的頁名，並提供重試與其他頁面的入口。
2. [狀態與回饋／動畫與轉場] [home-loading（另見 keywords／live／channel／events-loading_mobile）] [兩者] 點進首頁時仍顯示完整的舊「即時直播」頁，只有頁首一條紅線；手機各頁載入骨架完全相同 —— 讀者可能把舊頁的數字當成新頁的內容，或以為點擊失敗 —— 切頁時立即換成目標頁形狀的骨架（表格列、卡片、議題卡），並淡化舊內容。
3. [無障礙／色彩] [keywords（另見 home 熱門標籤）] [兩者] 升降只靠紅字、黑字與正負號；40 條走勢圖全是紅色填色 —— 色覺障礙者難以分辨方向，紅色也失去「上升或警示」的意義 —— 加上 ▲▼ 圖示，走勢圖預設改用中性灰，只在顯著上升時強調。
4. [導覽／資訊層級] [home] [desktop] 首頁頁首沒有字標，導覽從「關鍵字」開始；其他頁都有 —— 頁首在各頁不一致，捲動後也少了品牌錨點 —— 首頁頁首同樣保留字標，並標示目前在首頁。
5. [資訊密度／一致性] [channel] [mobile] 頻道頁的每部影片都重複頻道頭像與完整頻道名；live-error 與全站錯誤頁的元件、用詞和按鈕都不同 —— 浪費手機版面，也讓整體不像同一套系統 —— 頻道頁內省略重複的頻道名；錯誤狀態統一成一個元件。

## 組 B
一句話總評：載入骨架照各頁形狀設計、錯誤頁有下一步、升降有圖示，整體是同一套系統；但頻道頁手機版截圖是全白頁，標籤表也有文字被裁切，需要先確認。

| 項目 | 分數 | 證據（頁面／狀態 ID、尺寸、看到的事實） |
|---|---|---|
| 資訊層級 | 7.5 | home-today_desktop：hero 文字雲加三欄，焦點議題的大圖、標題與「56 個頻道在談」層級清楚。live_desktop：頁名「即時直播觀測」下一行交代範圍與更新時間，再往下是兩排分頁和篩選列，接著是「19 場直播・同時在線加總 4,049 人」。 |
| 字體排印 | 7 | keywords_desktop 的數字欄對齊整齊，升溫加了 ▲▼。但同一頁第 15、36、37 列的代表頻道「籌碼大師 李忠興分析師」「民視新聞網 Formosa T」被容器邊緣直接切掉，沒有「…」；keywords-today_desktop 同類文字有正確加「…」。home-today_desktop 熱門標籤卡的副資訊約 11px。 |
| 色彩 | 7.5 | 紅色系統一致：主導覽目前頁是紅底、主要按鈕紅色、升溫 ▲ 紅色、下降 ▼ 深灰。keywords_desktop 只有大幅上升的走勢圖（如婚外情、外遇）用紅色強調，其他是灰色。深色外觀（keywords-dark、live-dark、events-dark）完整，紅色在暗底上提亮。 |
| 間距與版面 | 7.5 | events_desktop 的議題卡內部依序為來源列、統計區、三張縮圖，節奏清楚。channel-empty_desktop 主欄與側欄對齊良好。home-today_desktop 的「頻道動態」長頻道名「TBS NEWS DIG Powered by JNN」換成三行，把右側數字擠到旁邊。 |
| 一致性 | 7.5 | 分頁籤、日期切換、篩選膠囊與統計卡在 live、events、channel 各頁共用同一套樣式。不一致處：全站錯誤頁（home／keywords／channel／events-error 圖檔相同）的頁首拿掉了搜尋與深色切換，手機版改成文字按鈕「選單」；live-error 則保留完整頁首、頁尾與頁名。 |
| 資訊密度 | 7.5 | live_desktop 一列有同時在線、今日高峰、今日走勢、歷史高峰、頻道、分類、開播時間，19 列一屏多可看完。channel-videos_mobile 每部影片都附「資料最後記錄 2026/11/13 上午03:10」，同一個時間重複十多次。 |
| 導覽 | 7.5 | 主導覽目前頁有明確標示；live 有兩層分頁籤；events 有前後日期切換與陣營篩選；錯誤頁有「也可以先看」四個入口。手機第二排分頁籤是橫向捲動，live_mobile 左側的「排行」被切掉一半。 |
| 狀態與回饋 | 7.5 | 錯誤卡：紅色頂邊、「重新讀取這一頁」主按鈕、「回到總覽」次按鈕，並說明「無法讀取不代表…為零」。空資料（live-empty、events-empty）說明原因，並給「← 看 2026-11-11」。載入骨架依各頁形狀設計（keywords 表格列、live_mobile 卡片、events 議題卡、channel 列表加側欄）。 |
| 響應式 | 6 | channel_mobile.png 整張是白色，沒有任何內容（圖檔只有 14KB，而 channel-dark_mobile 正常），請以 1:1 原圖確認。其他頁的手機版處理良好：live_mobile 改成卡片，keywords_mobile 只留四欄。 |
| 文案 | 8 | 「（2,463 支未取得觀看）」「同一觀眾可能重複計入」「議題由 AI 讀過當天來源影片後整理；尚未產出不代表沒有公共討論」都精準。home-empty 的同一句「近七日已完成比對 47,074 支影片…」出現兩次；頁尾「87 個頻道直播中」與上方「目前沒有符合…的直播」並列，讀者容易誤會。 |
| 無障礙 | 6.5 | 升降有 ▲▼ 圖示，不只靠顏色；手機按鈕夠大（套用、清除、錯誤頁按鈕）。但 live_desktop 的「頻道分類」「開播時間」與 events_desktop 的「3 則」等計數是小號淺灰字，對比偏低。 |
| 動畫與轉場 | 7 | 頁首在載入時有紅色進度線（各 loading 圖），骨架形狀接近實際內容，切換時版面不會大跳。靜態截圖無法驗證動畫本身。 |

要保留的優點：
- 各頁量身設計的載入骨架：keywords-loading 是表格列，live-loading_mobile 是直播卡，events-loading 是議題卡加三張縮圖。
- 錯誤卡的「重新讀取這一頁＋回到總覽＋也可以先看」三層下一步，加上「不代表為零」的說明。
- keywords 表的 ▲▼ 升降，只有顯著上升的走勢圖才用紅色強調。
- events 議題卡的來源列（頻道 → 該台說法 N 則）加統計區（媒體數、關鍵字、人物、媒體陣營），能直接比較各台說法。
- live_mobile 卡片：大數字顯示同時在線，旁邊是今日高峰、歷史高峰、走勢圖和 YouTube 原始來源連結。
- 空資料文案（live-empty、events-empty、channel-empty）說明「沒有結果不代表…」，並提供替代路徑。

最重要的五個問題（由嚴重到輕微）：
1. [響應式] [channel] [mobile] channel_mobile.png 是整張空白（channel-dark_mobile 與 channel-empty_mobile 都正常），請維護者先看 1:1 原圖 —— 若是真實的渲染失敗，手機讀者會在最常被分享的頻道頁看到白畫面 —— 查明淺色主題首次載入是否會出錯，加上錯誤邊界，並補上這個狀態的截圖測試。
2. [字體排印／間距與版面] [keywords（另見 keywords-dark）] [desktop] 「代表頻道」欄的長名稱被容器邊緣直接截斷，沒有「…」（第 15、36、37 列）；keywords-today 同欄有處理 —— 看起來像版面溢出，名字也讀不完整 —— 這一欄統一用 ellipsis 加 title，或給固定欄寬。
3. [一致性／導覽] [home-error（另見 keywords／channel／events-error）] [兩者] 全站錯誤頁的頁首拿掉了搜尋與深色切換，手機版改成「選單」文字按鈕；live-error 則保留完整頁首與頁尾 —— 同一網站出現兩種頁首，錯誤時也找不到搜尋 —— 錯誤狀態沿用標準頁首（漢堡選單、搜尋、主題切換）並顯示頁名。
4. [文案／資訊層級] [home-empty] [兩者] 「近七日已完成比對 47,074 支影片…」在文字雲下與熱門標籤卡內重複出現；頁尾「87 個頻道直播中・1.44 萬人在線」與「目前沒有符合…的直播」並列 —— 讀者會以為數字互相矛盾 —— 合併重複說明，並在空直播區塊註明「有直播但不符合條件」。
5. [字體排印／無障礙] [home-today（另見 live 的頻道分類欄、events 的計數）] [desktop] 首頁側欄卡片的副資訊約 11px 淺灰；長頻道名換成三行把數字擠歪；events_mobile 縮圖說明的左緣被裁掉 —— 寬螢幕長時間比對時閱讀吃力 —— 副資訊至少 12–13px 並提高對比，頻道名限制兩行，修正橫向捲動起點的內距。

## 組 C
一句話總評：三個成熟的參考產品，數據呈現直接，但都有廣告空白、登入牆或促銷橫幅干擾，資料時間與口徑的交代也不如有影儀表板。

| 項目 | 分數 | 證據（頁面／狀態 ID、尺寸、看到的事實） |
|---|---|---|
| 資訊層級 | 7.5 | google-trends_desktop：篩選列加清單，主欄依序是搜尋量、已開始、趨勢詳細資料，焦點明確。socialblade-channel_desktop：頻道橫幅、四個大數字，接著是等級與排名卡，層級強烈，但最上方先是促銷橫幅。 |
| 字體排印 | 7 | google-trends 的字級與行高舒適。socialblade 的每日表格約 11px，數字沒有千分位以外的對齊處理。playboard_desktop 的數字使用等寬風格字體（「2,206 Per Week」）。 |
| 色彩 | 7 | socialblade 全面使用紅色品牌，排名卡下緣是紅到綠的漸層。playboard 用紅、黃、綠儀表與「VERY LOW」紅字。google-trends 是低彩度系統色，「活躍」綠色膠囊。 |
| 間距與版面 | 6.5 | playboard_desktop 在 Engagement 與 Super Chat 之間、以及 Latest videos 下方有大片空白區塊（疑似廣告位）。playboard_mobile 在 Live Streaming Stats 之後約 300px 空白。socialblade_desktop 左側欄整條灰色、幾乎沒有內容。 |
| 一致性 | 7 | 各站內部元件一致：playboard 的卡片標題、資訊圖示，socialblade 的卡片與表格，google-trends 的 Material 元件。 |
| 資訊密度 | 7.5 | socialblade_desktop 的每日表一屏有 14 天乘 5 欄，資訊密集。google-trends_desktop 一屏只約 11 列。socialblade_mobile 五張排名卡各佔滿一列，首屏被促銷橫幅與頻道橫幅吃掉。 |
| 導覽 | 7.5 | google-trends_mobile 有底部浮動分頁（首頁、探索、最新熱搜榜）；playboard_mobile 有固定底部導覽列；socialblade 的分頁籤橫向捲動（「Future Projectio」被截斷）。 |
| 狀態與回饋 | 5 | socialblade_desktop 有「You must be logged in to use this feature」與「Log in…to see this creator's categories」，用登入牆取代內容。playboard 的空白區塊沒有任何說明。google-trends 有分頁與總數（「第 1–25 列，共 174 列」）。 |
| 響應式 | 7 | google-trends_mobile 改成兩行列表，但底部浮動導覽蓋住「抗議」那一列。playboard_mobile 把統計改成鍵值表。socialblade_mobile 單純堆疊，密度很低。 |
| 文案 | 6.5 | google-trends 的「2萬+ 次搜尋」「10 小時前」簡潔，但區間較模糊。playboard 的「VERY LOW, 0.6% of subscribers」好懂。socialblade 的「$65K – $1M Monthly Estimated Earnings」估算區間極寬，也沒有說明口徑。 |
| 無障礙 | 6.5 | playboard 的儀表靠顏色，但有附「VERY LOW」文字；socialblade 是紅底白字的導覽列，加上很多 11px 表格字；google-trends 的對比與點擊範圍良好。 |
| 動畫與轉場 | 4 | 截圖中沒有載入、骨架或轉場的線索，只看到 google-trends 頁籤底線，依據不足，給保守分。 |

要保留的優點：
- google-trends 的篩選膠囊列（地區、期間、類別、排序），以及明確的「第 1–25 列，共 174 列」分頁。
- google-trends_mobile 每列只放「名稱／搜尋量・狀態・時間」兩行，很好掃讀。
- playboard 的「Avg. Video Views 9,242 — VERY LOW, 0.6% of subscribers」，把數字直接轉成判讀。
- socialblade 的每日頻道指標表，加上「Daily／Weekly Average、Last 30 Days」彙總列。
- playboard 的 Similar channels 側欄，提供橫向探索。

最重要的五個問題（由嚴重到輕微）：
1. [間距與版面] [playboard-channel] [兩者] 模組之間有大片無說明的空白區塊（手機版約 300px） —— 讀者以為內容載入失敗，閱讀節奏也被打斷 —— 廣告位要加標示，或在沒有廣告時收合。
2. [狀態與回饋] [socialblade-channel] [desktop] 分類與最近影片被登入牆取代，頁首另有促銷橫幅 —— 核心資訊被遮擋，商業訊息搶走首屏 —— 先給部分內容預覽，橫幅移出首屏。
3. [資訊密度／響應式] [socialblade-channel] [mobile] 五張排名卡逐張堆疊、各佔整列；首屏被促銷與頻道橫幅佔滿 —— 手機上要捲很久才看到每日數據 —— 排名改成 2×3 網格並縮小橫幅。
4. [響應式／導覽] [google-trends] [mobile] 底部浮動導覽蓋住清單最後一列（「抗議」） —— 被遮的資料點不到 —— 清單底部預留浮動列高度的內距。
5. [文案] [socialblade-channel] [desktop] 「$65K – $1M」「$330K – $5.3M」估算區間差距達 15 倍，且沒有說明口徑 —— 讀者無法判斷可信度 —— 註明估算方法，或改用中位數加區間。

```json
{"A": {"scores": {"資訊層級": 7, "字體排印": 6.5, "色彩": 6.5, "間距與版面": 7, "一致性": 6, "資訊密度": 7.5, "導覽": 6.5, "狀態與回饋": 5, "響應式": 7, "文案": 7, "無障礙": 5.5, "動畫與轉場": 5}, "overall": 6.5, "issues": ["[狀態與回饋] home-error（另見 keywords/channel/events-error）兩者：全站錯誤頁沒有頁首、品牌、導覽與頁名，只有一張頂端虛線卡片", "[狀態與回饋/動畫] home-loading 兩者：跨頁載入時仍顯示完整的舊即時直播頁，只有頁首紅線；手機四頁載入骨架完全相同、不符目標頁形狀", "[無障礙/色彩] keywords（另見 home 熱門標籤）兩者：升降只靠紅/黑字與正負號、沒有 ▲▼，40 條走勢圖全是紅色", "[導覽/資訊層級] home desktop：首頁頁首沒有字標，與其他頁不一致", "[資訊密度/一致性] channel mobile 每部影片重複頻道名與頭像；live-error 與全站錯誤頁元件、用詞不同且缺重試"]}, "B": {"scores": {"資訊層級": 7.5, "字體排印": 7, "色彩": 7.5, "間距與版面": 7.5, "一致性": 7.5, "資訊密度": 7.5, "導覽": 7.5, "狀態與回饋": 7.5, "響應式": 6, "文案": 8, "無障礙": 6.5, "動畫與轉場": 7}, "overall": 7, "issues": ["[響應式] channel_mobile.png 整張空白（dark 與 empty 正常），需以 1:1 原圖確認是否為渲染失敗", "[字體排印/版面] keywords（另見 keywords-dark）desktop：代表頻道欄長名稱被容器直接裁切、沒有 ellipsis（第 15/36/37 列）", "[一致性/導覽] home/keywords/channel/events-error 兩者：錯誤頁頁首少了搜尋與主題切換、手機改成「選單」文字鈕，與 live-error 的完整頁首不一致", "[文案] home-empty 兩者：同一句比對說明出現兩次；「87 個頻道直播中」與「沒有符合條件的直播」並列易被誤讀為矛盾", "[字體/無障礙] home-today desktop：側欄副資訊約 11px 淺灰、長頻道名換三行；events_mobile 縮圖說明左緣被裁"]}, "C": {"scores": {"資訊層級": 7.5, "字體排印": 7, "色彩": 7, "間距與版面": 6.5, "一致性": 7, "資訊密度": 7.5, "導覽": 7.5, "狀態與回饋": 5, "響應式": 7, "文案": 6.5, "無障礙": 6.5, "動畫與轉場": 4}, "overall": 7, "issues": ["[間距] playboard-channel 兩者：模組間有大片無說明空白區塊", "[狀態與回饋] socialblade-channel desktop：分類與最近影片被登入牆取代，頁首有促銷橫幅", "[密度/響應式] socialblade-channel mobile：排名卡逐張全寬堆疊，首屏被橫幅佔滿", "[響應式] google-trends mobile：底部浮動導覽遮住清單最後一列", "[文案] socialblade-channel desktop：收入估算區間過寬且未說明口徑"]}}
```
