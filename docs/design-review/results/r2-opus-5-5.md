## 組 A
一句話總評：資料版面與深色模式都已成形，但錯誤頁和載入狀態兩處明顯壞掉，議題頁仍外露內部術語，手機直播卡片過長，整體完成度落後 C。

| 項目 | 分數 | 證據（頁面／狀態 ID、尺寸、看到的事實） |
|---|---|---|
| 資訊層級 | 6.5 | home_desktop、home_mobile 頁首沒有「有影儀表板」字標：桌面頁首只剩導覽列，手機頁首只剩搜尋框，品牌只出現在文字雲中央。channel_desktop 頁首的頻道名稱與「訂閱 158 萬／觀看 41.96 億／影片 704,476」主次分明。events_desktop 的議題標題與編號清楚，但每張卡都有「報導角度／政黨觀點」兩列全是 0 則，稀釋了重點。 |
| 字體排印 | 6.5 | keywords_desktop 的數字欄右對齊、看起來是等寬數字，但「(2,463 支缺值)」約 9px 淺灰，難讀。events_mobile、event-day_mobile 標題斷成「…各媒體報／導」，最後一行只剩一個字。channel_mobile 頻道名斷成「Formosa TV News／network」。home_desktop 熱門標籤的「熱度 1,920.2」約 10px。 |
| 色彩 | 7 | YouTube 紅用在導覽目前頁、CTA、資料來源連結、排名數字，品牌辨識度高。events-dark、channel-dark 深色模式層次正確，縮圖不突兀。但 live-all 與 keywords 的走勢 sparkline 不論升降都用紅／粉紅，keywords「升溫」正值紅、負值黑，紅色同時代表品牌、連結與上升，語意過載。 |
| 間距與版面 | 7 | channel_desktop 是 2/3 主欄加 1/3 側欄（頻道資料、期間觀測增量），1440 寬利用得當。events_desktop 每張議題卡內距一致，三欄縮圖整齊。但 home-error、channel-error、events-error（desktop）的錯誤卡貼在頁面最上緣，下方大片空白。 |
| 一致性 | 5.5 | 錯誤狀態有兩套：home-error、channel-error、events-error 用虛線框、亮紅「重新讀取」按鈕加底線連結；live-error 用另一種虛線框，只有「←回到總覽」，沒有重試。channel-loading、events-loading 沿用排行表格骨架，與實際頁面版型完全不同。 |
| 資訊密度 | 6 | live-all_mobile 每場直播是全寬 16:9 縮圖、兩欄數字、單獨一行「今日走勢」與「頻道分類 —」，第一屏只看得到 1 場。channel_desktop 每列影片都重複「民視新聞網 Formosa TV News network ·」與頻道 icon。keywords_desktop 一屏 40 列、10 欄，密度很好。 |
| 導覽 | 6 | live-loading_desktop 導覽列同時亮起「關鍵字」與「直播」，events-loading 亮起「關鍵字」與「議題」，channel-loading 只亮「關鍵字」，目前位置錯誤。live-all_mobile 子分頁列沒有捲到目前的「全部頻道」，看不到選中項。錯誤頁（home-error 等）沒有任何導覽。日期前後切換（events「←2026-11-11／2026-11-13→」）好用。 |
| 狀態與回饋 | 4.5 | home-error、channel-error、events-error（desktop 與 mobile）整頁空白，只剩一張卡，沒有頁首與品牌。live-error 沒有重試按鈕。events-empty 只寫「2026-11-12目前沒有 AI 每日彙整。」，沒有原因。好的一面：live-empty、channel-empty 有說明「沒有觀測結果不代表 YouTube 上沒有直播」。 |
| 響應式 | 6.5 | keywords、live 桌面用表格，手機改成卡片，不是單純縮放。但 live-all_mobile 卡片過長。events_mobile 縮圖列橫向截斷第二張，沒有捲動提示。events_mobile 摘要卡「紀錄 #5717・資料類型 oneday」在窄欄中斷成 4 行。 |
| 文案 | 5 | events_desktop／mobile 摘要卡外露「原始收錄 —」「每日彙整 242 則・紀錄 #5717・資料類型 oneday」。分頁籤「提示詞預覽」是內部術語。keywords_desktop 欄名「標題／僅說明」、註記「(2,463 支缺值)」。events-empty 日期與文字之間少一個空格。 |
| 無障礙 | 6 | 大量 9–11px 淺灰中繼資料（keywords「支缺值」、home 熱門標籤熱度、events「3 則」）。channel-error 的亮紅 #DC2626 類按鈕配白字，對比勉強及格。手機分頁籤點擊區約 44px，尚可。直播中標記有「直播中」文字，不只靠顏色。 |
| 動畫與轉場 | 5 | 靜態截圖只能看到 *-loading 頁首下有一條紅色進度線與灰色骨架。但 channel／events 的骨架形狀與目標頁不符，載入完成時版面會大幅跳動。看不到其他轉場線索，給保守分數。 |

要保留的優點：
- keywords_desktop 排行表：40 列、熱度、升溫、sparkline、影片數、已測觀看與代表頻道同屏可比，非常適合研究者。
- channel_desktop 的頁首數字摘要與右側「期間觀測增量」卡，主次清楚。
- events 議題卡的「頻道 → 該台說法」列表加上三欄代表縮圖，「同一件事各台怎麼說」一眼可見。
- 每頁頁首固定有「更新於…台北時間・本頁的資料來源與計算方式」，資料時間交代完整。
- 空狀態文案（live-empty、channel-empty）主動說明「沒有觀測不代表沒有發生」。
- events-dark、channel-dark 深色模式完整，卡片與標籤層次正確。

最重要的五個問題（由嚴重到輕微）：
1. [狀態與回饋] [home-error] [兩者] 錯誤頁沒有頁首、品牌與導覽，只剩一張貼在頁頂的虛線卡；live-error 又是另一套樣式，而且沒有重試。另見 channel-error、events-error、live-error。 —— 使用者失去定位，只能重試或回總覽，也看不出還在同一個網站。 —— 統一成一個錯誤元件，保留完整網站頁首，同時提供重試、回總覽與其他入口。
2. [導覽] [channel-loading] [兩者] 載入骨架一律套用排行表格版型，而且導覽目前頁錯誤（channel-loading 亮「關鍵字」，events-loading／live-loading 同時亮兩項）；手機版 channel-loading 是直播卡骨架。另見 events-loading。 —— 使用者會以為點錯頁，載入完成時版面劇烈跳動。 —— 每頁用符合目標版型的骨架，導覽目前頁依路由正確標示。
3. [文案] [events] [兩者] 摘要卡外露「紀錄 #5717」「資料類型 oneday」「原始收錄 —」，分頁籤叫「提示詞預覽」；keywords 欄名「標題／僅說明」「支缺值」；events-empty 沒有說明原因。另見 event-day、events-empty、keywords_desktop。 —— 記者與讀者看不懂，也削弱「觀測值可解釋」的信任。 —— 改寫成使用者語言（例如分析頻道數、引用影片數、跨頻道議題數），內部 ID 收進「計算方式」。
4. [資訊密度] [live-all] [mobile] 每場直播卡都有全寬大縮圖與單獨成行的欄位，一屏只看到 1 場，162 場要捲動非常久；events 每張卡另有兩列全是 0 的「報導角度／政黨觀點」。另見 events_desktop。 —— 手機是主要使用情境，比較排行的效率很差。 —— 手機改用左圖右文的精簡卡，數字壓成一行；全為 0 的欄位隱藏。
5. [資訊層級] [home] [兩者] 首頁頁首沒有字標（桌面只有導覽，手機只有搜尋框），和其他頁不一致；頻道概覽每列重複頻道名與 icon；手機子分頁列沒有捲到目前分頁（live-all_mobile 的「全部頻道」看不到），標題最後一行只剩一個字（events_mobile「導」）。另見 channel_desktop、live-all_mobile。 —— 品牌與目前位置都不夠清楚。 —— 全站固定字標；移除重複的頻道名；分頁列自動捲到選中項；標題用平衡斷行。

## 組 B
一句話總評：三個成熟的參考產品（Google Trends、Playboard、Social Blade）。表格、評級與語意色都很完整，但有廣告空位、登入牆與英文介面的摩擦，也沒有可評估的狀態頁。

| 項目 | 分數 | 證據（頁面／狀態 ID、尺寸、看到的事實） |
|---|---|---|
| 資訊層級 | 7.5 | google-trends_desktop 從篩選列、趨勢名稱、搜尋量到「已開始」的層次非常清楚。playboard-channel_desktop 頂部是頻道名加 Subscribers／Views／Super Chat／Videos，下方是 Rank、Avg. Views 卡。socialblade-channel_desktop 的大橫幅與 A- 評級搶眼，但促銷橫幅（「Use code CATEGORIES…」）壓在頻道資料之前。 |
| 字體排印 | 7 | Google Trends 中英數字搭配良好，「10萬+」「↑1,000%」層次清楚。Playboard 數字用細字重（「138th」「9,242」），中文標題與英文標籤混排略顯不一。Social Blade 表格字級約 10px，數字欄對齊良好。 |
| 色彩 | 7.5 | Google Trends 用綠色「活躍」徽章表示狀態。Playboard 的紅黃綠半圓儀表加「VERY LOW」，語意明確。Social Blade 品牌紅鋪滿頁首，表格中正值用綠色「+7,819,304」，但紅色大面積略顯沉重。 |
| 間距與版面 | 6.5 | google-trends_desktop 卡片留白舒適。playboard-channel_desktop 中段有兩塊空白廣告位（約 y=565–660、1690–1785），手機版也有大片空白（約 1270–1590）。socialblade 左側欄大片灰色未使用。 |
| 一致性 | 7 | 各產品內部元件一致：Google 的 Material 下拉篩選、Playboard 的卡片加儀表、Social Blade 的排名卡加漸層底線。 |
| 資訊密度 | 7.5 | socialblade-channel_desktop 的 Daily Channel Metrics 一屏 14 天 × 5 欄，密度高。Google Trends 一屏 11 個趨勢。Social Blade 手機版每張排名卡占滿寬度，5 張卡就占掉一整屏，密度低。 |
| 導覽 | 7.5 | Playboard 桌面有左側欄（Home／Charts／Insights／Trending Live），手機有底部分頁列。Google Trends 手機有浮動底部導覽（首頁／探索／最新熱搜榜）。Social Blade 手機分頁籤被截斷（「Future Projectio…」）。 |
| 狀態與回饋 | 5 | 只有資料狀態截圖，看不到載入或錯誤頁。可見的回饋有：Social Blade「Refresh stats」、「You must be logged in to use this feature」登入牆，Google Trends 分頁顯示「第 1-25 列，共 174 列」。證據不足，給保守分數。 |
| 響應式 | 7 | google-trends_mobile 表格改成清單，每列有搜尋量、活躍狀態與時間。playboard-channel_mobile 把頂部數字改成表格。socialblade-channel_mobile 頻道名被截斷成「民視新聞網 Fo…」。 |
| 文案 | 6.5 | Google Trends 中文在地化完整（「已開始」「趨勢詳細資料」）。Playboard 與 Social Blade 多為英文。Social Blade「$65K - $1M Monthly Estimated Earnings」區間過寬，沒有交代方法。Playboard「VERY LOW」有 ⓘ 說明。 |
| 無障礙 | 6.5 | Google Trends 對比與點擊區良好。Playboard 細字重灰字（「Upward trend」）對比偏低。Social Blade 紅底白字頁首對比尚可，表格 10px 字偏小。儀表除了顏色，也有文字標示。 |
| 動畫與轉場 | 5 | 靜態截圖看不到骨架或轉場線索，給保守分數。 |

要保留的優點：
- Google Trends 篩選列（地區、時間範圍、類別、排序）與分頁計數「第 1-25 列，共 174 列」，範圍交代清楚。
- Playboard 的儀表加文字評級（「VERY LOW, 0.6% of subscribers」），把數字轉成可理解的判斷。
- Social Blade 的每日指標表加「Daily Average／Last 30 Days」彙總列，方便比對。
- Google Trends 手機版的清單加底部浮動導覽，單手操作效率高。
- Playboard 的「Similar channels」側欄，方便橫向探索。

最重要的五個問題（由嚴重到輕微）：
1. [間距與版面] [playboard-channel] [兩者] 頁面中段有多塊空白廣告位，手機版有約 300px 的空白。 —— 打斷閱讀，看起來像壞掉。 —— 沒有廣告時收合空位。
2. [資訊層級] [socialblade-channel] [兩者] 促銷橫幅與大型頻道橫幅放在資料之前，手機第一屏看不到任何趨勢數字。 —— 主要資訊被推到下方。 —— 縮小橫幅，數字摘要上移。
3. [文案] [socialblade-channel] [desktop] 預估收益「$65K - $1M」區間極寬，沒有方法說明。 —— 數字可信度低，容易被誤用。 —— 標示估算方法與不確定性。
4. [響應式] [socialblade-channel] [mobile] 頻道名截斷成「民視新聞網 Fo…」，分頁籤「Future Projectio…」被裁切，排名卡單欄堆疊，密度很低。 —— 手機可讀性差。 —— 名稱改成兩行，排名卡用兩欄格線。
5. [狀態與回饋] [socialblade-channel] [desktop] 「Recent Video」區塊只顯示登入牆。 —— 功能被鎖，只留下一塊空白區域。 —— 給未登入者預覽，或直接隱藏該區塊。

## 組 C
一句話總評：與 A 同一套設計，但錯誤卡、目標形狀骨架、使用者語言的摘要卡與精簡直播卡都已修好，是兩個版本中明顯較成熟的一個。剩下的問題是錯誤頁頁首不完整、重複的免責文字、小字對比與紅色語意過載。

| 項目 | 分數 | 證據（頁面／狀態 ID、尺寸、看到的事實） |
|---|---|---|
| 資訊層級 | 7.5 | home_desktop 頁首有「有影儀表板」字標，文字雲加三欄（熱門標籤／焦點議題／即時直播），一進來就知道網站在做什麼。channel_desktop 每列影片只留時間與標題，不再重複頻道名，焦點更集中。events_desktop 摘要卡改成「分析的頻道 35/35 個」「引用的影片 488 則」「跨頻道議題 25 個」。 |
| 字體排印 | 7 | events_mobile 標題平衡斷行成「2026-11-12 主要／事件與各媒體報導」，channel_mobile 斷成「民視新聞網 Formosa／TV News network」。keywords_desktop 數字欄對齊。但「(2,463 支未取得觀看)」、home 熱門標籤的「熱度」仍是約 9–10px 淺灰。 |
| 色彩 | 7 | 品牌紅系統與 A 相同。錯誤卡用紅色上緣加紅色 eyebrow「暫時無法連線到資料」，具品牌感但不嚇人。events-dark、channel-dark 成立。走勢線仍是單一紅／粉紅，升降不分色。 |
| 間距與版面 | 7.5 | live-error_desktop 錯誤卡置中、寬度適中，下方有「也可以先看」chips，節奏完整。channel-loading_desktop 骨架與實際頁一樣是主欄加側欄。live-all_mobile 精簡卡內距一致。 |
| 一致性 | 7.5 | home-error、channel-error、events-error、live-error 全部用同一張錯誤卡（eyebrow、標題、說明、主次按鈕、推薦 chips）。但 channel／events／home 錯誤頁的頁首只有字標，live-error 則保留完整導覽，兩者仍有落差。 |
| 資訊密度 | 7.5 | live-all_mobile 每卡是左縮圖、右標題，下方一行「同時在線 2,827／今日高峰／歷史高峰」加 sparkline，一屏約 3.5 場。events 卡移除了全為 0 的「報導角度／政黨觀點」列。但 channel-videos_mobile 每卡都重複整段「資料最後記錄…「—」表示未取得。」 |
| 導覽 | 7 | live-all_mobile、live-empty_mobile 子分頁列會捲到選中項（「全部頻道」「新聞政治頻道」可見）。各 loading 頁導覽只亮正確的一項（channel-loading 亮「頻道」、events-loading 亮「議題」）。錯誤頁有推薦 chips，但 channel／events／home 錯誤頁缺導覽與搜尋。手機分頁籤溢出時沒有漸層或箭頭提示（events_mobile 尾端只露出「AI 輸」）。 |
| 狀態與回饋 | 8 | 錯誤卡同時說明原因與時效（「通常幾秒到幾分鐘內就會恢復」），也提醒「無法讀取不代表…為零」，並提供主次兩個動作與替代入口。events-empty 有標題加原因：「議題由 AI 讀過當天來源影片後整理；尚未產出不代表沒有公共討論。」骨架與目標版型一致（events-loading 是三張摘要卡加含三格縮圖的議題卡）。 |
| 響應式 | 7.5 | 手機版各頁都有專屬版型（直播精簡卡、頻道列表、議題卡）。events_mobile 縮圖列橫向截斷，沒有捲動提示。channel-videos_mobile 每卡的重複註記讓卡片變長。 |
| 文案 | 7.5 | 分頁籤改成「AI 輸入內容」，keywords 欄名改成「標題／說明命中」「支未取得觀看」，events 摘要卡用一般讀者的語言。錯誤文案自然。少數仍偏技術，例如「喜歡占互動 100.00%」（channel-videos_desktop），而且大多數列是「—」。 |
| 無障礙 | 6.5 | 主要按鈕「重新讀取這一頁」改用較深的紅 #B91C1C 類色，配白字對比較佳。錯誤頁 chips 點擊區夠大。但淺灰小字（keywords 的未取得觀看註記、channel 的「尚未取得觀看數據」）對比偏低；走勢只靠線形，沒有文字或顏色區分升降。 |
| 動畫與轉場 | 6.5 | 依據是靜態線索：頁首紅色進度線，加上與目標版型一致的骨架（channel-loading 有頁首數字、分頁、列表加側欄；mobile 是列表加縮圖），載入完成時跳動較小。看不到實際動畫，評分保守。 |

要保留的優點：
- 統一的錯誤卡：紅色上緣、eyebrow、可恢復時效說明、「重新讀取這一頁／回到總覽」，加上「也可以先看」推薦 chips。
- 依目標頁形狀設計的骨架（channel-loading、events-loading、live-loading 的雙列分頁籤）。
- live-all_mobile 精簡直播卡：排名徽章疊在縮圖上，數字一行加 sparkline 與時間範圍「02:08–02:32」。
- events 摘要卡改用讀者語言（分析的頻道、引用的影片、跨頻道議題），加上 events-empty 的原因說明。
- 手機子分頁列自動捲到選中項，標題平衡斷行。
- keywords_desktop 的高密度排行表與深色模式，延續 A 的優點。

最重要的五個問題（由嚴重到輕微）：
1. [導覽] [channel-error] [兩者] channel／events／home 錯誤頁的頁首只剩字標，沒有導覽、搜尋與深色切換；live-error 則保留完整頁首。另見 events-error、home-error。 —— 同一種狀態有兩種外殼，使用者只能靠 chips 離開。 —— 所有錯誤頁都保留完整網站頁首。
2. [資訊密度] [channel-videos] [mobile] 每張影片卡都重複「資料最後記錄：2026/11/13 上午03:10。各項統計未必在同一時間觀測；「—」表示未取得。」，以及頻道名與 icon，約占每卡三分之一高度；desktop 表格多數列是「—」。 —— 降低掃讀效率，免責文字反而沒人讀。 —— 註記放到列表頂端一次；缺值列收合或淡化。
3. [無障礙] [keywords] [desktop] 「(2,463 支未取得觀看)」、home 熱門標籤的「熱度 1,920.2」、channel 的「尚未取得觀看數據」約 9–11px 淺灰。另見 home_desktop、channel_desktop。 —— 長時間比對數字的使用者難以閱讀，對比可能不足 4.5:1。 —— 最小字級 12px，加深灰階。
4. [色彩] [live-all] [兩者] sparkline 不論升降都用紅／粉紅；keywords「升溫」正值紅、負值黑；紅色同時代表品牌、連結、CTA 與上升。另見 keywords_desktop。 —— 語意色不清，讀者難以快速判斷趨勢方向。 —— 定義升／降／持平的語意色（必要時加箭頭），品牌紅只用在互動與強調。
5. [響應式] [events] [mobile] 分頁籤列尾端被截斷（「AI 輸…」），縮圖列橫向截斷第二張，都沒有捲動提示；home_desktop「怎麼算」連結孤立在兩張卡之間。另見 event-day_mobile、channel_mobile 的分頁籤。 —— 使用者不知道還有更多分頁或縮圖。 —— 加邊緣漸層或箭頭；把「怎麼算」併入區塊標題。

```json
{"A": {"scores": {"資訊層級": 6.5, "字體排印": 6.5, "色彩": 7, "間距與版面": 7, "一致性": 5.5, "資訊密度": 6, "導覽": 6, "狀態與回饋": 4.5, "響應式": 6.5, "文案": 5, "無障礙": 6, "動畫與轉場": 5}, "overall": 6, "issues": ["[狀態與回饋][home-error][兩者] 錯誤頁無頁首與導覽，只剩貼頂虛線卡；live-error 另一套樣式且無重試（另見 channel-error、events-error）", "[導覽][channel-loading][兩者] 骨架一律為排行表格版型，導覽目前頁錯誤（亮「關鍵字」或同時亮兩項）（另見 events-loading、live-loading）", "[文案][events][兩者] 外露「紀錄 #5717」「資料類型 oneday」「原始收錄 —」、「提示詞預覽」、keywords「標題／僅說明」「支缺值」，events-empty 無原因", "[資訊密度][live-all][mobile] 每場直播大縮圖卡一屏只見 1 場；events 每卡兩列全為 0 的報導角度／政黨觀點", "[資訊層級][home][兩者] 首頁頁首無字標；頻道概覽每列重複頻道名；手機子分頁未捲到選中項，標題最後一行只剩一字"]}, "B": {"scores": {"資訊層級": 7.5, "字體排印": 7, "色彩": 7.5, "間距與版面": 6.5, "一致性": 7, "資訊密度": 7.5, "導覽": 7.5, "狀態與回饋": 5, "響應式": 7, "文案": 6.5, "無障礙": 6.5, "動畫與轉場": 5}, "overall": 7, "issues": ["[間距與版面][playboard-channel][兩者] 中段多塊空白廣告位，手機約 300px 空白", "[資訊層級][socialblade-channel][兩者] 促銷與大橫幅把數字推到首屏以下", "[文案][socialblade-channel][desktop] 預估收益 $65K-$1M 區間極寬且無方法說明", "[響應式][socialblade-channel][mobile] 頻道名與分頁籤截斷，排名卡單欄堆疊密度低", "[狀態與回饋][socialblade-channel][desktop] Recent Video 只顯示登入牆"]}, "C": {"scores": {"資訊層級": 7.5, "字體排印": 7, "色彩": 7, "間距與版面": 7.5, "一致性": 7.5, "資訊密度": 7.5, "導覽": 7, "狀態與回饋": 8, "響應式": 7.5, "文案": 7.5, "無障礙": 6.5, "動畫與轉場": 6.5}, "overall": 7.5, "issues": ["[導覽][channel-error][兩者] channel／events／home 錯誤頁頁首只剩字標、無導覽與搜尋，與 live-error 不一致", "[資訊密度][channel-videos][mobile] 每卡重複整段資料記錄註記與頻道名；desktop 多數列為「—」", "[無障礙][keywords][desktop] 9–11px 淺灰小字（未取得觀看註記、熱度、尚未取得觀看數據）對比偏低", "[色彩][live-all][兩者] sparkline 升降同為紅色，紅色同時代表品牌、連結、CTA 與上升，語意過載", "[響應式][events][mobile] 分頁籤與縮圖列截斷且無捲動提示；home「怎麼算」連結孤立"]}}
```
