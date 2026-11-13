## 組 A
一句話總評：品牌識別清楚、資料時間與計算方式交代完整，空資料、錯誤、載入中狀態都做得很成熟；剩下的問題在議題頁太長、寬螢幕兩側空白，以及小字對比偏低。

| 項目 | 分數 | 證據（頁面／狀態 ID、尺寸、看到的事實） |
|---|---|---|
| 資訊層級 | 8 | home_desktop：頁首有 logo，下面是文字雲主視覺，接著三欄「熱門標籤／焦點議題／即時直播」，焦點議題用大圖加大標題，主次分明。缺點是文字雲中央的「有影儀表板／同一件事，各台怎麼說」字很小，第一次來的人不容易一眼看懂網站在做什麼。home_mobile 的文字雲佔掉第一屏約 540 CSS px，之後才看到內容。 |
| 字體排印 | 8 | keywords_desktop 的數字欄靠右對齊、看起來是等寬數字，例如「1,920.2」「≥1,505.74 萬 次」。events_mobile 的標題在詞與詞之間換行（「各媒體／報導」），沒有把一個詞拆開。home_desktop 的頻道動態有長頻道名被截斷（「Formosa TV…」「TBS NEWS DIG Powere…」）。events_desktop 的 metadata 和 chip 約 11–12px，字偏小。 |
| 色彩 | 8 | 整站以 YouTube 紅為品牌色，用在頁首底線、導覽目前頁、期間切換膠囊和連結。keywords_desktop 的升溫用紅色 ▲、下降用灰色 ▼，走勢線紅色代表上升、灰色代表持平或下降，還附了圖例。events-dark、home-dark 的深色外觀成立，卡片、chip、縮圖邊界都分得清楚。紅色同時用在標籤名、連結和上升數字，用得有點多。 |
| 間距與版面 | 7.5 | 內容欄只有約 935px 寬（events_desktop、keywords_desktop），在 1440 寬螢幕上兩側各留約 250px 空白，同時 keywords 卻要把 11 欄塞進這個寬度。events_desktop 每張議題卡約 520px 高，其中三張大縮圖就佔了一半。卡片、表格的留白節奏是一致的。 |
| 一致性 | 8.5 | 每頁的標題區格式相同（標題、更新時間、台北時間、「本頁的資料來源與計算方式 ⓘ」）。分段控制、期間切換膠囊、卡片圓角都是同一套。錯誤頁 events-error 和其他錯誤狀態都用同一張紅色頂邊卡片，加上「也可以先看」捷徑。 |
| 資訊密度 | 7.5 | keywords_desktop 一屏可以看完 40 列排行和 11 欄數字，密度很好。events_desktop 一屏只放得下約 1.5 個議題，縮圖佔太多面積。home_desktop 的熱門標籤一列有 4 行文字，偏鬆。 |
| 導覽 | 7.5 | 桌面頁首有 8 個主項，目前頁用紅底標示（議題、關鍵字）。手機版是漢堡選單加搜尋。events_mobile 的子分頁列可以橫向捲動，但最後一項只露出「AI」，沒有明顯的捲動提示。日期前後切換（← 2026-11-11 / 2026-11-13 →）很清楚。 |
| 狀態與回饋 | 9 | events-empty 有標題「2026-11-12 還沒有整理好的跨頻道議題」，說明「尚未產出不代表沒有公共討論」，並給出「← 看 2026-11-11」。events-error 有完整頁首頁尾，主按鈕「重新讀取這一頁」、次按鈕「回到總覽」，下方有四個捷徑，還說明「無法讀取不代表…為零」。events-loading 與 channel-loading_mobile 的骨架形狀都和實際版面對應。 |
| 響應式 | 8 | keywords_mobile 改成 4 欄（標籤、熱度、升溫、走勢），沒有橫向溢出。events_mobile 的代表影片改成橫向捲動，並附「代表影片 3 支，左右滑動看全部」提示。events_mobile 的三張統計卡塞在 390px 寬裡，說明文字被擠成 2–3 行。 |
| 文案 | 8 | 資料時間、時區、期間（11/07—11/13）、「列出 40 個標籤」都有寫。數字附單位（則、支、頻道、萬 次），「≥」表示這是下限。events 的子分頁「AI 輸入內容」稍微偏向內部用語。 |
| 無障礙 | 7.5 | 升降同時用 ▲▼ 符號和顏色表示，不只靠顏色。events-error 的按鈕大、對比足夠。events_desktop 的灰色 metadata 和 chip 數字字小又淡，對比偏低。截圖裡看不到焦點樣式的線索。 |
| 動畫與轉場 | 7 | 只能從靜態線索判斷：events-loading、channel-loading 有對應版面的骨架，頁首下方有紅色進度底線。看不到實際動態，所以保守給分。 |

要保留的優點：
- events-error 的錯誤頁：完整頁首頁尾、紅色頂邊卡片、主次兩個按鈕、「也可以先看」捷徑，加上「無法讀取不代表為零」的說明。
- events-empty 的空資料說明「尚未產出不代表沒有公共討論」，並直接連到前一天。
- keywords_desktop 的走勢圖例加上 ▲▼ 雙重編碼，數字靠右對齊、用等寬數字。
- events_mobile 代表影片的「左右滑動看全部」提示。
- 每頁標題下固定一行「更新於…・台北時間・本頁的資料來源與計算方式」。
- 骨架畫面和實際版面一致（events-loading 是議題卡結構，channel-loading_mobile 是頻道頭加清單）。

最重要的五個問題（由嚴重到輕微）：
1. [資訊密度] [events] [desktop] 每張議題卡約 520px 高，三張大縮圖佔了一半，一屏只看得到約 1.5 個議題（另見 event-day_desktop）—— 研究者要比對 25 個議題，捲動成本太高 —— 建議把縮圖縮小成一列小圖，或提供「精簡清單」檢視。
2. [間距與版面] [keywords／events] [desktop] 內容欄寬約 935px，1440 寬螢幕兩側大片空白，keywords 的 11 欄因此擠成小字 —— 在寬螢幕上長時間比對的使用者用不到多出來的空間 —— 建議把資料表頁的最大寬度放寬到 1200px 以上。
3. [無障礙] [events] [desktop] 媒體數、關鍵字、人物等標籤和 chip 計數約 11–12px 淺灰字，對比不足（另見 home_desktop 熱門標籤的次要行）—— 長時間閱讀吃力，也可能不符合 WCAG 對比要求 —— 建議提高字級到 13px 以上，並加深灰階。
4. [資訊層級] [home] [mobile] 文字雲佔掉第一屏，網站定位「同一件事，各台怎麼說」字小，夾在詞彙中間（另見 home_desktop）—— 新使用者第一眼抓不到網站在做什麼 —— 建議把定位句拉出來當清楚的標題，並壓低文字雲高度。
5. [導覽] [events] [mobile] 子分頁列最後一項被截成「AI」，沒有漸層或箭頭提示可以捲動 —— 使用者可能不知道還有其他分頁 —— 建議加上邊緣漸層或改成兩行排列。

## 組 B
一句話總評：三個成熟的參考產品（Google Trends、Playboard、Social Blade），資料呈現直接、元件成熟，但各自有廣告空白、登入牆和語意色濫用等問題，狀態設計也沒有呈現。

| 項目 | 分數 | 證據（頁面／狀態 ID、尺寸、看到的事實） |
|---|---|---|
| 資訊層級 | 7.5 | google-trends_desktop 是一張表，搜尋量、開始時間、相關詞一目了然。socialblade-channel_desktop 的大 banner 和促銷橫幅壓過了排名數字。playboard-channel_desktop 的頻道名、訂閱數、觀看數放在頂部，主次清楚。 |
| 字體排印 | 7 | Google Trends 字級層次清楚。Playboard 的英文介面混排中文標題，綠色數字用等寬打字機字體（「2,206 Per Week」），風格突兀。Social Blade 的表格字很小。 |
| 色彩 | 6.5 | Social Blade 整頁紅底，又把紅色用在走勢圖，語意不清。Playboard 的紅黃綠儀表在每一項都出現「VERY LOW」紅字，警示色過度。Google Trends 只用綠色「活躍」標籤，配色克制。 |
| 間距與版面 | 6.5 | playboard-channel_desktop 有兩大塊空白卡（約 565–650px、1690–1785px），playboard_mobile 約 1270–1590px 也是一大片空白（看起來是廣告位）。socialblade_desktop 的 CREATOR STATISTICS 上方也有空白區。 |
| 一致性 | 6 | 三個產品本來就不同。單看 Playboard 內部，儀表、卡片樣式是一致的；Social Blade 混用排名卡、紅色表頭表格、鋸齒圖。 |
| 資訊密度 | 8 | socialblade_desktop 的 Daily Channel Metrics 一屏 14 天乘 5 欄。google-trends_desktop 一屏 11 列加分頁。 |
| 導覽 | 7 | Google Trends 有篩選列和分頁（第 1–25 列，共 181 列），手機底部有浮動導覽。Playboard 桌面有側欄，手機有底部 tab bar。Social Blade 的分頁籤在手機上被截斷（「Future Projectio」）。 |
| 狀態與回饋 | 5 | 沒有提供空資料、錯誤、載入狀態的截圖。看得到的只有 socialblade 的「You must be logged in to use this feature」登入牆，以及 Playboard 的空白卡片，都不算好的回饋。 |
| 響應式 | 7 | google-trends_mobile 把欄位改成單欄列表，處理得好，但底部浮動導覽蓋住了「馬傑」那一列。socialblade_mobile 的排名卡改成單欄後非常長。 |
| 文案 | 6.5 | Google Trends 繁中自然，「5萬+ 次搜尋」「9 小時前」單位清楚。Playboard 對中文使用者全是英文。Social Blade 的估算收入「$68K - $1.1M」範圍太大，說明不足。 |
| 無障礙 | 6.5 | Google Trends 對比和點擊範圍都好。Playboard 的儀表只靠紅黃綠表示高低（雖然有附文字）。Social Blade 紅底白字的小字對比勉強。 |
| 動畫與轉場 | 5 | 靜態截圖看不到骨架或進度線索，保守給分。 |

要保留的優點：
- google-trends_desktop 的篩選列（地區、期間、類別、排序）加上明確的分頁與總列數。
- google-trends_mobile 把表格改成「標題＋一行 metadata」的單欄列表。
- socialblade_desktop 的每日指標表附有 Daily／Weekly／Last 30 Days 彙總列。
- playboard-channel_desktop 頂部的頻道摘要列，關鍵數字一行看完。

最重要的五個問題（由嚴重到輕微）：
1. [間距與版面] [playboard-channel] [兩者] 大面積空白卡片（mobile 約 320px 高）—— 中斷閱讀，看起來像壞掉 —— 建議載入失敗時收起，或給出佔位說明。
2. [狀態與回饋] [socialblade-channel] [desktop] RECENT VIDEO、CHANNEL CATEGORY 都被登入牆擋住 —— 核心資料不可見 —— 建議顯示部分內容，再做登入引導。
3. [色彩] [playboard-channel] [兩者] 每一項都是紅色「VERY LOW」儀表 —— 警示色失去意義 —— 建議只在真正異常時用警示色。
4. [響應式] [google-trends] [mobile] 底部浮動導覽蓋住最後一列內容 —— 有內容被遮住 —— 建議預留底部安全距離。
5. [資訊層級] [socialblade-channel] [desktop] 促銷橫幅和大 banner 把核心數字推到第一屏下方 —— 使用者要找的數字被行銷內容擠下去 —— 建議縮減或移除行銷區塊。

## 組 C
一句話總評：主要版面和組 A 相同，但錯誤頁沒有站點外框、內部欄位外露、走勢顏色失去語意、骨架不對應頁面，狀態與文案品質明顯較弱。

| 項目 | 分數 | 證據（頁面／狀態 ID、尺寸、看到的事實） |
|---|---|---|
| 資訊層級 | 6.5 | home_desktop 的頁首沒有 logo，導覽直接從「關鍵字」開始；home_mobile 的頁首把 logo 換成搜尋框，網站名只剩文字雲裡的小字。home_desktop 焦點議題卡和 02 項之間多出一個孤立的「怎麼算 ⓘ」連結，home_mobile 也一樣。 |
| 字體排印 | 7 | events_mobile 標題斷成「各媒體報／導」，最後一字單獨一行（另見 event-day_mobile）。keywords_desktop 的已測觀看欄塞進灰色小字「(2,463 支缺值)」，字太小。好的地方是 home_desktop 頻道動態改成換行顯示完整頻道名。 |
| 色彩 | 6.5 | keywords_desktop、keywords_mobile 的走勢線一律是紅色填色，下降的「沈伯洋 −246.7」也是紅線，紅色不再代表上升；升溫欄上升用紅字、下降用灰字，沒有箭頭。深色外觀（events-dark）本身是成立的。 |
| 間距與版面 | 7 | 和組 A 一樣，內容欄約 935px。events_desktop 每張卡因為多了「報導角度」「政黨觀點」兩列而更高，第一張卡約 565px。 |
| 一致性 | 6 | events-error 和其他錯誤狀態都是虛線框加紅按鈕、文字連結「← 回到總覽」，和全站卡片樣式不同。events-loading_desktop 的骨架是 keywords 的表格版型；events-loading_mobile 與 channel-loading_mobile 用了同一個通用骨架（大圖卡片），和實際頁面不符。 |
| 資訊密度 | 7 | keywords 把未取得觀看併進已測觀看欄，少了一欄；但 events 卡片多了全是 0 的列（「台灣角度 0 則／中國角度 0 則」「民進黨觀點 0 則／國民黨觀點 0 則」），是無效資訊。 |
| 導覽 | 6 | events-loading_desktop 的頁首同時把「關鍵字」和「議題」標成目前頁。錯誤頁完全沒有頁首與導覽，只剩一個「回到總覽」連結。home 沒有 logo，少了回首頁的固定入口。 |
| 狀態與回饋 | 5 | events-error_desktop 與 events-error_mobile 是空白頁上一張虛線卡，沒有頁首、頁尾、捷徑（其他頁的 error 狀態也一樣）。events-empty 只有一句「2026-11-12目前沒有 AI 每日彙整。」，沒說明原因，也沒說「沒有議題不代表沒有討論」。 |
| 響應式 | 7 | keywords_mobile 是 4 欄，沒有溢出。events_mobile 的統計卡文字被擠成 4 行（「25 個議題・紀錄 #5717・資料類型 oneday」）。代表影片可以橫向捲動，但沒有提示。 |
| 文案 | 5 | events_desktop 的統計卡「原始收錄 —」「每日彙整 242 則・紀錄 #5717・資料類型 oneday」外露內部紀錄編號和英文型別；子分頁叫「提示詞預覽」，是內部術語；events-empty 的日期和文字之間少了空格。 |
| 無障礙 | 6.5 | keywords 升降只靠紅色與灰色區分，沒有 ▲▼，走勢線全部紅色，也沒有圖例，色覺障礙者無法分辨方向。灰色缺值小字對比低。 |
| 動畫與轉場 | 6 | 有骨架和頁首紅色進度底線，但骨架形狀和實際頁面不一致（events-loading_desktop 是表格），載入完成時版面會大幅跳動。 |

要保留的優點：
- home_desktop 頻道動態改成換行顯示長頻道名（「Formosa TV News network」），沒有截斷。
- keywords_desktop 把缺值數併入已測觀看欄，少一欄，讀起來比較簡潔。
- 主要頁面的標題區、日期切換、分類分段控制和組 A 一樣完整。
- events-dark 深色外觀的卡片層次清楚。

最重要的五個問題（由嚴重到輕微）：
1. [狀態與回饋] [events-error] [兩者] 錯誤頁沒有頁首、頁尾、導覽，只剩一張虛線卡（另見 home-error、keywords-error、live-error、channel-error）—— 使用者被困在空白頁，品牌也消失了 —— 建議保留完整站點外框，並提供替代入口。
2. [文案] [events] [兩者] 統計卡外露「紀錄 #5717」「資料類型 oneday」「原始收錄 —」，子分頁叫「提示詞預覽」（另見 event-day、events-empty）—— 這是系統用語，讀者無從理解 —— 建議改寫成讀者語言，或把這些欄位移到說明頁。
3. [色彩／無障礙] [keywords] [兩者] 走勢線全部紅色，升降只靠紅灰兩色、沒有箭頭，圖例也拿掉了 —— 上升和下降無法分辨，也違反「不只靠顏色」的原則 —— 建議恢復 ▲▼ 符號，並讓走勢線顏色依方向區分。
4. [一致性／導覽] [events-loading] [desktop] 骨架是表格版型，而且頁首同時把「關鍵字」「議題」標成目前頁；mobile 的 events-loading 與 channel-loading 共用同一個通用骨架 —— 載入完成時版面跳動，目前位置也錯了 —— 建議每頁用對應自己版面的骨架，導覽只標示一個目前頁。
5. [資訊層級] [home] [兩者] desktop 頁首沒有 logo，mobile 用搜尋框取代 logo，焦點議題下方還有一個孤立的「怎麼算」連結 —— 品牌識別和回首頁入口不一致 —— 建議所有頁面都保留 logo，「怎麼算」放回對應區塊的標題列。

```json
{"A": {"scores": {"資訊層級": 8, "字體排印": 8, "色彩": 8, "間距與版面": 7.5, "一致性": 8.5, "資訊密度": 7.5, "導覽": 7.5, "狀態與回饋": 9, "響應式": 8, "文案": 8, "無障礙": 7.5, "動畫與轉場": 7}, "overall": 8, "issues": ["[資訊密度] events desktop：議題卡約 520px 高、三張大縮圖，一屏只見約 1.5 個議題", "[間距與版面] keywords/events desktop：內容欄僅約 935px，1440 寬螢幕兩側大片空白而表格擠成小字", "[無障礙] events desktop：11–12px 淺灰 metadata 與 chip 計數對比不足", "[資訊層級] home mobile：文字雲佔滿第一屏，網站定位句太小", "[導覽] events mobile：子分頁列截成「AI」且無捲動提示"]}, "B": {"scores": {"資訊層級": 7.5, "字體排印": 7, "色彩": 6.5, "間距與版面": 6.5, "一致性": 6, "資訊密度": 8, "導覽": 7, "狀態與回饋": 5, "響應式": 7, "文案": 6.5, "無障礙": 6.5, "動畫與轉場": 5}, "overall": 6.5, "issues": ["[間距與版面] playboard-channel 兩者：大面積空白卡片", "[狀態與回饋] socialblade-channel desktop：核心區塊被登入牆擋住", "[色彩] playboard-channel：每項都是紅色 VERY LOW 儀表，警示色濫用", "[響應式] google-trends mobile：底部浮動導覽蓋住內容列", "[資訊層級] socialblade-channel desktop：促銷橫幅與 banner 把核心數字擠到第一屏下方"]}, "C": {"scores": {"資訊層級": 6.5, "字體排印": 7, "色彩": 6.5, "間距與版面": 7, "一致性": 6, "資訊密度": 7, "導覽": 6, "狀態與回饋": 5, "響應式": 7, "文案": 5, "無障礙": 6.5, "動畫與轉場": 6}, "overall": 6.5, "issues": ["[狀態與回饋] events-error 兩者：錯誤頁沒有頁首頁尾與導覽，只剩一張虛線卡（各頁 error 皆同）", "[文案] events 兩者：外露「紀錄 #5717」「資料類型 oneday」「提示詞預覽」等內部用語", "[色彩/無障礙] keywords 兩者：走勢線全部紅色、升降無箭頭也無圖例", "[一致性/導覽] events-loading desktop：骨架是表格版型且兩個導覽項同時標為目前頁；mobile 骨架通用、不對應頁面", "[資訊層級] home 兩者：頁首沒有 logo 或被搜尋框取代，另有孤立的「怎麼算」連結"]}}
```
