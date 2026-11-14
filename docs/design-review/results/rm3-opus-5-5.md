# 有影儀表板 · 設計評審（rm3）

## 組 A
一句話總評：版面骨架和資料透明度都有基礎，但錯誤頁、載入骨架和議題頁的文案還停在「工程師版」。三個錯誤頁連頁首、導覽和頁尾都沒有，使用者會被困在頁面上，整體一致性明顯落後 B。

| 項目 | 分數 | 證據（頁面／狀態 ID、尺寸、看到的事實） |
|---|---|---|
| 資訊層級 | 7 | home_desktop：文字雲 hero 中央是「有影儀表板／同一件事，各台怎麼說」，下面分熱門標籤、焦點議題、即時直播三欄，主次清楚。但同一張圖的頁首沒有品牌 logo，導覽列直接從「關鍵字」開始，一進站的品牌錨點只能靠 hero。channel_desktop：訂閱 158 萬、觀看 41.96 億、影片 704,476 放在右上，夠醒目。 |
| 字體排印 | 6.5 | channel_desktop：每列影片上方先有一行灰色小字「民視新聞網 Formosa TV News network · 2026/11/13 上午01:53」，標題才在第二行，掃讀時節奏被打斷。events_desktop：各頻道一行的「3 則」與「報導角度 0 則」等用淺灰小字（約 11px），很難讀。數字大致等寬對齊，例如 channel_desktop 右側「期間觀測增量」表。 |
| 色彩 | 7 | 品牌紅一致用在 active 導覽、連結和主按鈕。home_desktop 熱門標籤的走勢線全是紅色，升跌只靠旁邊綠／紅的小字「+1,568.0」「−246.7」，語意色和品牌色打架。深色版（channel-dark_desktop、events-dark_mobile）層次成立，卡片和底色有區隔。 |
| 間距與版面 | 7 | home_desktop 三欄格線整齊，1440 寬有善用。channel_desktop 左欄影片列表搭配右側資訊欄，比例合理。home-error_desktop 是一張靠頂、置中的虛線卡，下面約 700px 全是空白，頁面像沒畫完。 |
| 一致性 | 5.5 | 錯誤頁至少有三種長相：home-error、channel-error、events-error 只有一張虛線卡、沒有頁首頁尾；live-error_desktop 有完整頁首頁尾，但只有「← 回到總覽」連結，沒有重試按鈕。channel 分頁籤叫「提示詞預覽」，其他地方又寫 AI 議題。 |
| 資訊密度 | 6.5 | channel_desktop：在頻道自己的頁面，每一列都重複頻道全名。channel-videos_mobile：每張卡下面都重複兩行「資料最後記錄…各項統計未必在同一時間觀測；「—」表示未取得。」events_desktop：每個議題都附上「報導角度 0／0」「政黨觀點 0／0」兩列全為零的資料，佔版面又沒有資訊。 |
| 導覽 | 6.5 | live-loading_desktop、channel-loading_desktop、events-loading_desktop 的頂部導覽同時亮起「關鍵字」和目的地頁兩顆 active，目前位置不明。live-all_mobile 的兩排分頁籤在螢幕邊緣把字切成「分」「新聞政治」，看不出可以橫向捲動。 |
| 狀態與回饋 | 5 | home-error_desktop／mobile、channel-error_*、events-error_*：只有「資料暫時無法讀取」、紅色「重新讀取」和「← 回到總覽」，沒有頁首、導覽、頁尾，使用者無法轉去其他頁。events-empty_desktop：「2026–11–12目前沒有 AI 每日彙整。」只有一句加一個前一天連結。keywords-empty 是一個灰框加一句話，沒有建議改看過去 24 小時。 |
| 響應式 | 6.5 | live-all_mobile：每場直播一張卡，大縮圖加 2×3 數字格、「今日走勢」淡粉色條、「頻道分類 —」和 YouTube 連結，一場約 800 CSS px，一屏不到一場。events_mobile 三張統計小卡被擠成「35 / 35 個頻／道・176 個事／件」四行斷字。channel_mobile 標題換行正常。 |
| 文案 | 5.5 | events_desktop 統計卡寫「原始收錄 —」「每日彙整 242 則・紀錄 #5717・資料類型 oneday」，內部欄位和 ID 直接外露。分頁籤「提示詞預覽」是內部術語。events-empty 日期和中文之間少了空格。優點是 live 頁「已列出的同時在線加總 1.4 萬人（同一觀眾可能重複計入）」交代清楚。 |
| 無障礙 | 6 | 升跌只靠紅綠小字（home_desktop 熱門標籤）。淺灰 11px 的計數字（events_desktop）對比不足。錯誤頁沒有導覽，鍵盤使用者只剩兩個控制項。截圖裡看不到焦點樣式。 |
| 動畫與轉場 | 5.5 | 有骨架和頁首下方的紅色進度線（live-loading_desktop）。但 live、channel、events 的載入中都套用同一個「表格列」骨架，跟實際的卡片或議題版型完全不同，載入完會整頁跳動。 |

要保留的優點：
- home_desktop 的文字雲 hero 加三欄（熱門標籤／焦點議題／即時直播），一眼就知道網站在做什麼。
- 每頁標題下都有「更新於 … 台北時間・本頁的資料來源與計算方式 ⓘ」，資料時間交代一致（channel_desktop、events_desktop）。
- live 頁的加總說明「同一觀眾可能重複計入」，以及錯誤頁的「無法讀取不代表影片、頻道或觀看數為零」，都替觀測資料講清楚了邊界。
- channel_desktop 右側「頻道資料／期間觀測增量」的數字右對齊、等寬，好比對。
- 深色外觀完整（channel-dark、events-dark），縮圖和卡片在暗底上仍清楚。

最重要的五個問題（由嚴重到輕微）：
1. [狀態與回饋] [home-error, channel-error, events-error] [兩者] 錯誤頁只剩一張虛線卡，沒有頁首、導覽、頁尾 —— 使用者被困住、失去品牌與位置感，看起來像整站壞了 —— 錯誤卡放回完整版型，補上原因說明、重試與「也可以先看」的替代入口。
2. [文案] [events, event-day, events-empty] [兩者] 統計卡外露「紀錄 #5717」「資料類型 oneday」「原始收錄 —」，分頁籤寫「提示詞預覽」—— 一般讀者看不懂，也削弱可信度 —— 改成讀者語言，例如「分析的頻道」「引用的影片」「跨頻道議題」，ID 收進方法說明。
3. [動畫與轉場] [live-loading, channel-loading, events-loading] [兩者] 所有頁共用關鍵字表格骨架，頂部導覽同時亮兩顆 —— 載入完版型大跳動、目前位置錯亂 —— 每頁做對應的骨架，導覽只亮目的地。
4. [資訊密度] [channel] [兩者] 每列重複頻道全名，channel-videos_mobile 每張卡重複兩行免責說明，events 每個議題都有全零的「報導角度／政黨觀點」列 —— 擠掉真正內容、拉長捲動 —— 重複說明集中到列表頂部一次，全零的維度隱藏。
5. [響應式] [live-all] [mobile] 直播卡一張約 800 CSS px，分頁籤在螢幕邊緣把字切成「分」「新聞政治」—— 手機上很難比對排名 —— 改成縮圖在左、數字在右的精簡卡，分頁籤加上淡出或箭頭，提示可以橫向捲動。

## 組 B
一句話總評：跟 A 同一個骨架，但把文案、空狀態、錯誤頁、載入骨架和重複資訊都整理過，成熟度明顯較高。剩下的問題是錯誤頁的頁首殼不一致、手機斷字，以及大量「—」的影片表。

| 項目 | 分數 | 證據（頁面／狀態 ID、尺寸、看到的事實） |
|---|---|---|
| 資訊層級 | 7.5 | home_desktop：頁首有 logo，hero 和三欄結構清楚。channel_desktop：「近期收錄影片」下先放摘要「這 50 支近期影片中，45 支尚未取得觀看數據；未取得不代表沒有觀看」，再列影片，重點先講。 |
| 字體排印 | 7 | channel_desktop：每列改成「日期・尚未取得觀看數據」一行，下面接標題，節奏比 A 乾淨。home_desktop 頻道名過長時用省略號「Formosa TV…」，不再換成三行。keywords_mobile 的摘要句在「40 個標／籤」中間斷開。 |
| 色彩 | 7.5 | home_desktop 熱門標籤：走勢線改成中性灰，升跌用 ▲綠／▼紅加數字，語意色獨立於品牌紅。events-dark_desktop：active 導覽「議題」是實心深紅膠囊，暗色層次成立。錯誤卡頂端的紅色細邊是有節制的警示語彙。 |
| 間距與版面 | 7.5 | events_desktop 的議題卡比 A 短（少了兩列全零維度）。channel-error_desktop 的錯誤卡、「也可以先看」chips 和頁尾垂直置中，不再留一大片空白。keywords_mobile 的走勢欄貼齊螢幕邊緣，右側沒有留白。 |
| 一致性 | 7 | 錯誤頁統一成紅頂卡、eyebrow「暫時無法連線到資料」、主按鈕「重新讀取這一頁」、次按鈕「回到總覽」，再加 chips（live-error、channel-error、events-error）。但 channel-error_desktop 和 events-error_desktop 的頁首沒有搜尋框和深色切換，頁尾也是精簡版；live-error_desktop 則是完整頁首和完整頁尾，兩套外殼並存。 |
| 資訊密度 | 7.5 | channel_desktop 拿掉每列重複的頻道名。channel-videos_mobile 把免責說明集中在列表頂部，各卡只留「資料最後記錄 …」一行，不過這一行在每張卡上的值都相同。channel-videos_desktop 表格 50 列裡大多數的觀看／喜歡／留言／占比都是「—」，有效數字很稀疏。 |
| 導覽 | 7 | live-loading_desktop、channel-loading_desktop、events-loading_desktop 的導覽只亮目的地一顆。手機分頁籤在右緣用淡出提示還有內容（channel_mobile 的「AI 議題」）。錯誤頁的 chips 會排除目前頁（channel-error 不顯示頻道來源以外的同頁入口）。 |
| 狀態與回饋 | 8 | events-empty_desktop：「2026–11–12 還沒有整理好的跨頻道議題／議題由 AI 讀過當天來源影片後整理；尚未產出不代表沒有公共討論」，再加前一天連結。錯誤頁有原因、恢復時間預期、兩個動作和替代入口。channel-empty 的兩個空區塊都有說明。keywords-empty 仍只是灰框加一句話。 |
| 響應式 | 7 | live-loading_mobile 骨架顯示精簡橫式卡，對應實際的手機版型。events_mobile 統計卡的字比 A 少，不再擠成四行。keywords_mobile 摘要斷字、走勢欄貼邊。 |
| 文案 | 7.5 | 統計卡改成「分析的頻道 35 / 35 個・整理出 176 則頻道事件」「引用的影片 488 則」「跨頻道議題 25 個」。分頁籤改叫「AI 輸入內容」。錯誤頁寫「通常幾秒到幾分鐘內就會恢復」，有給預期。 |
| 無障礙 | 6.5 | 升跌加了 ▲▼ 符號，不只靠顏色（home_desktop）。錯誤頁按鈕目測高度約 44px，點擊範圍足夠（channel-error_mobile）。但大量 11–12px 的淺灰 meta 字仍在（events_desktop 的各頻道計數、channel_desktop 側欄標籤）。焦點樣式看不出來。 |
| 動畫與轉場 | 7 | 各頁骨架對應真實版型：channel-loading 有標題、三個統計、分頁籤、影片列和右側欄；events-loading 有三張統計卡和議題卡；live-loading 有兩排分頁籤。頁首下方有紅色進度線。沒有實際動態可看，依靜態線索保守給分。 |

要保留的優點：
- 統一的錯誤卡（紅頂邊、eyebrow、主次按鈕、「也可以先看」chips）以及「無法讀取不代表為零」的說明。
- events 統計卡改用讀者語言（分析的頻道／引用的影片／跨頻道議題），拿掉 oneday、#5717 這類欄位。
- channel 與 channel-videos 列表頂部集中的覆蓋率說明（50 支中 45／42 支未取得數據）。
- 每頁對應自己版型的載入骨架，加上單一的 active 導覽。
- home 熱門標籤用灰色走勢線加 ▲▼ 語意色升跌。
- events-empty 的空狀態說明了 AI 整理流程，並提供前一天入口。

最重要的五個問題（由嚴重到輕微）：
1. [一致性] [channel-error, events-error] [兩者] 這兩個錯誤頁換成精簡頁首（沒有搜尋框和深色切換）和精簡頁尾，跟 live-error 的完整外殼不同 —— 使用者在錯誤時失去搜尋和外觀設定，品牌外殼也跳動 —— 所有錯誤頁沿用同一個完整頁首與頁尾，只替換內容區（另見 channel-error_mobile 少了深色切換）。
2. [響應式] [keywords] [mobile] 摘要句在「40 個標／籤」中間斷開，走勢欄貼齊螢幕右緣 —— 斷詞和貼邊讓排行看起來沒完成 —— 摘要改用不斷詞的換行或分兩行短句，表格右側保留 16px 邊距（另見 keywords-dark_mobile）。
3. [資訊密度] [channel-videos] [desktop] 50 列裡大多數的觀看、喜歡、留言、占比都是「—」，有數據的少數列被淹沒 —— 研究者最在意的是有數字的影片 —— 提供「只看已取得數據」的篩選或預設把有數據的排前面，「—」列可以壓成較低的行高；手機每卡重複的相同「資料最後記錄」也可以只寫一次。
4. [狀態與回饋] [keywords-empty] [兩者] 只有灰框和一句話，沒有改看過去 24 小時或其他期間的建議 —— 空結果時讀者不知道下一步 —— 比照 events-empty，加上原因說明和切換期間、看熱門議題的按鈕。
5. [無障礙] [events, channel] [desktop] 各頻道「N 則」、側欄標籤、統計卡副說明都是 11–12px 淺灰字 —— 寬螢幕長時間比對時，對比和字級都不足 —— meta 字至少 12–13px，灰階對比提高到 4.5:1。

## 組 C
一句話總評：三個參考產品（Google Trends、Playboard、Social Blade）各有成熟的資料呈現：Trends 密度與節制最好，Playboard 指標視覺化友善，Social Blade 品牌最強烈。但廣告空洞、登入牆和行銷橫幅明顯削弱閱讀體驗。

| 項目 | 分數 | 證據（頁面／狀態 ID、尺寸、看到的事實） |
|---|---|---|
| 資訊層級 | 7.5 | google-trends_desktop：關鍵字、搜尋量、已開始、趨勢細節四欄，主次清楚。playboard-channel_desktop：頂部是頻道名和四個 KPI，再往下是 Summary 卡片。socialblade-channel_desktop：最顯眼的是大橫幅和 A- 等級，與頻道核心數字相比有點喧賓奪主。 |
| 字體排印 | 7 | google-trends_desktop：關鍵字約 18px，搜尋量「5萬+ ↑1,000%」上下兩層，層級清楚。playboard 用等寬字顯示「+NT$150 / d」，和本文混排略顯突兀。Social Blade 的表格數字小而密，但有對齊。 |
| 色彩 | 7 | Trends 用 Google 藍加綠色「活躍」標籤，語意清楚。Playboard 的紅黃綠儀表搭配「VERY LOW」文字。Social Blade 大面積品牌紅，排名卡底部是紅到綠的漸層條，有個性但偏重。截圖裡看不到深色外觀。 |
| 間距與版面 | 6.5 | playboard-channel_desktop 在 Live Streaming Stats 下方，以及 Latest videos 下方，各有大片空白框（推測是廣告位）。mobile 版同樣在約 1260–1590 px 處空白。socialblade-channel_desktop 的「CREATOR STATISTICS」左欄上方留白不明。Trends 版面最整齊。 |
| 一致性 | 6.5 | 各自產品內部大致一致。Social Blade 的元件風格混雜：卡片、紅表頭表格、灰色登入框、漸層條並存。Playboard 中英混排，Category 欄是「News & Politics／Taiwan」。 |
| 資訊密度 | 8 | Trends 一屏約 11 列，每列有四類資訊。Social Blade 的「Daily Channel Metrics」14 天表格，每日訂閱、觀看、影片、收益加總計列都有，非常密。Playboard 卡片化，密度中等。 |
| 導覽 | 7.5 | google-trends_mobile 有底部懸浮膠囊導覽（首頁／探索／最新熱搜榜）。playboard-channel_mobile 有底部五鍵 tab bar。Social Blade 有平台 tab 加頻道子 tab，mobile 版在右緣被截斷（「Future Projectio」）。 |
| 狀態與回饋 | 5 | Social Blade 的「RECENT VIDEO」位置顯示「You must be logged in to use this feature」，頻道分類也要登入。Playboard 有空白框卻沒有說明。截圖裡沒有載入、錯誤狀態，無法評估，保守給分。 |
| 響應式 | 7 | Trends mobile 把表格改成清單卡（關鍵字／次搜尋・活躍・時間），處理得當。Playboard mobile 的 KPI 改成表格列，可讀。Social Blade mobile 的五張排名卡各佔滿一列，約 1,100 px 才看完排名，效率低。 |
| 文案 | 6.5 | Trends「5萬+ 次搜尋」「已開始 9 小時前」精準。Social Blade「$68K - $1.1M Monthly Estimated Earnings」的區間過寬，難以解讀，還有優惠碼行銷橫幅。Playboard「VERY LOW, 0.6% of subscribers」有給基準，相對清楚。 |
| 無障礙 | 6 | Playboard 的儀表同時有文字標籤，不只靠顏色。Social Blade 紅底上的白色小字（Subscribers/Views 標題）和表格裡的綠色增量字對比偏低。Trends 的勾選框和控制項大小充足。 |
| 動畫與轉場 | 4 | 截圖沒有任何載入、骨架或轉場線索，只能保守給分。Playboard 的空白框可能是載入中的廣告，但無從確認。 |

要保留的優點（可借鏡）：
- google-trends 的「數值＋成長率」上下兩層，以及手機改成清單卡、保留所有欄位的作法。
- google-trends_mobile 的底部懸浮導覽，在長清單中仍能快速切換頁面。
- playboard 的指標附帶相對基準（「0.6% of subscribers」）和文字等級，不只靠顏色。
- socialblade 每日表格加上「Daily/Weekly Average、Last 30/14 Days」總計列，方便比對期間。
- playboard 右欄「Similar channels」提供橫向探索。

最重要的五個問題（由嚴重到輕微）：
1. [間距與版面] [playboard-channel] [兩者] 主欄中段出現大片空白框（desktop 約 y=564–660、y=1690–1785；mobile 約 1260–1590）—— 看起來像壞掉或缺內容 —— 廣告位應保留高度並標示，或載入失敗時收合。
2. [狀態與回饋] [socialblade-channel] [兩者] 近期影片和頻道分類都被登入牆擋住 —— 核心內容中斷，讀者無法完成比對 —— 至少顯示部分內容，再提示登入可以看更多。
3. [資訊層級] [socialblade-channel] [兩者] 頂部行銷橫幅加大幅封面圖，把頻道核心數字推到第二屏（mobile 約 470 px 以下）—— 主次顛倒 —— 縮小封面、橫幅改成可關閉的細條。
4. [文案] [socialblade-channel] [desktop] 收益估計區間「$68K - $1.1M」跨了 16 倍，又沒有說明方法 —— 讀者容易誤用 —— 標示估算方法和信賴範圍，或縮小區間。
5. [響應式] [socialblade-channel] [mobile] 五張排名卡逐列堆疊，子 tab「Future Projectio」被截斷 —— 一屏只看得到一兩個數字 —— 排名卡改成 2×2 格線，tab 加上捲動提示。

```json
{"A": {"scores": {"資訊層級": 7, "字體排印": 6.5, "色彩": 7, "間距與版面": 7, "一致性": 5.5, "資訊密度": 6.5, "導覽": 6.5, "狀態與回饋": 5, "響應式": 6.5, "文案": 5.5, "無障礙": 6, "動畫與轉場": 5.5}, "overall": 6, "issues": ["home-error/channel-error/events-error 兩者：錯誤頁只剩虛線卡，無頁首導覽頁尾，使用者被困住", "events/event-day 兩者：統計卡外露「紀錄 #5717」「資料類型 oneday」「原始收錄 —」，分頁籤「提示詞預覽」為內部術語", "live/channel/events-loading 兩者：共用關鍵字表格骨架，導覽同時亮起「關鍵字」與目的頁兩顆 active", "channel 兩者：每列重複頻道全名；channel-videos_mobile 每卡重複兩行免責說明；events 每議題有全零的報導角度／政黨觀點列", "live-all mobile：單張直播卡約 800 CSS px，分頁籤在邊緣切字成「分」「新聞政治」"]}, "B": {"scores": {"資訊層級": 7.5, "字體排印": 7, "色彩": 7.5, "間距與版面": 7.5, "一致性": 7, "資訊密度": 7.5, "導覽": 7, "狀態與回饋": 8, "響應式": 7, "文案": 7.5, "無障礙": 6.5, "動畫與轉場": 7}, "overall": 7.5, "issues": ["channel-error/events-error 兩者：精簡頁首（無搜尋框、無深色切換）與精簡頁尾，與 live-error 的完整外殼不一致", "keywords mobile：摘要在「40 個標／籤」中間斷開，走勢欄貼齊螢幕右緣", "channel-videos desktop：50 列多數數字欄為「—」，有效數據被淹沒；手機每卡重複相同的資料最後記錄時間", "keywords-empty 兩者：只有灰框一句話，沒有切換期間等下一步建議", "events/channel desktop：大量 11–12px 淺灰 meta 字，對比與字級不足"]}, "C": {"scores": {"資訊層級": 7.5, "字體排印": 7, "色彩": 7, "間距與版面": 6.5, "一致性": 6.5, "資訊密度": 8, "導覽": 7.5, "狀態與回饋": 5, "響應式": 7, "文案": 6.5, "無障礙": 6, "動畫與轉場": 4}, "overall": 7, "issues": ["playboard-channel 兩者：主欄中段大片空白框（疑似廣告位），像缺內容", "socialblade-channel 兩者：近期影片與頻道分類被登入牆擋住", "socialblade-channel 兩者：行銷橫幅與大封面把頻道核心數字推到第二屏", "socialblade-channel desktop：收益估計區間 $68K–$1.1M 過寬且無方法說明", "socialblade-channel mobile：五張排名卡逐列堆疊，子 tab 被截斷"]}}
```
