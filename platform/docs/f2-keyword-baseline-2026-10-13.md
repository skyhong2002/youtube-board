# F2 正式關鍵字品質基準（2026-10-13 台北）

此文件是修正前的公開端證據。只做匿名 GET，沒有資料庫查詢、寫入、部署、瀏覽器或 GA 操作。標籤池保留新文易數原始池；以下判斷針對影片中的使用上下文，不是新增全域停用詞表。

- 首頁基準：2026-10-12 18:53:25 UTC（台北 2026-10-13 02:53:25），來自既存 `/tmp/yt-f2-home.json`；未重新抓取覆蓋。
- 首頁實際窗口：`2026-10-07T00:00:00+08:00` 至 `2026-10-13T02:53:25+08:00`。
- 證據採集：`2026-10-12T18:54:56.794854+00:00` 至 `2026-10-12T18:56:41.156544+00:00`（UTC）；關鍵字請求固定 `from=2026-10-07&to=2026-10-13&limit=2`。
- 共 44 次請求，全部 HTTP 200；28 個詞各取最新兩支候選，共 56 組詞／影片配對，去重後 16 支影片。所有配對的 `/videos/:id/tags` 都實際回傳該詞證據與 `status: matched`。
- 單一並行、相鄰新請求至少間隔 550 ms；UA 為 `youtube-board-verify/1.0`，同影片的 tags 回應重用，不傳 Cookie、Authorization 或 API 金鑰。
- 詞彙版本 `youtube-first-20261011`，coverage=`observed-article-window`，詞庫文章窗口 `2026-10-10T16:00:00.000Z` 至 `2026-10-11T16:00:00.000Z`；不是完整池已啟用的證據。
- 首頁覆蓋率：8,057 / 23,551 = 34.21%；另有 43 stale、15,451 unprocessed。所有抽样 evidence 的規則仍為 `exact-text-v1`。
- 這是刻意挑選可疑詞的案例，不是隨機樣本；不能據此推算全站失真、無用詞或樣板比例。34.21% 是已完成有效比對的影片覆蓋率，並不是這組可疑樣本的失真比例。同頻道重複片段僅證明下方抽樣重複，尚不能取代近 N 片達 50% 的正式樣板判定。

## 修正前首頁前 20 名

觀看數在此基準的前 20 列均為 `null`，API 另回傳尚無觀看值的影片数。這份公開證據無法判定缺值是統計未覆蓋或 JOIN 錯誤；顯示時須寫「無觀看值」，不可將 null 當作零，也不可在觀看值排序中當作最小值參與排名；缺值列需獨立呈現。

| 名次 | 詞 | 影片數 | 尚無觀看值影片數 | 觀看值 |
| ---: | --- | ---: | ---: | --- |
| 1 | 新聞 | 5,102 | 2,390 | 無觀看值 |
| 2 | 看 | 4,919 | 2,336 | 無觀看值 |
| 3 | 訂閱 | 4,122 | 1,955 | 無觀看值 |
| 4 | 直播 | 3,684 | 1,722 | 無觀看值 |
| 5 | YouTube | 2,830 | 1,318 | 無觀看值 |
| 6 | FB | 2,365 | 1,135 | 無觀看值 |
| 7 | 下載 | 2,313 | 1,110 | 無觀看值 |
| 8 | 台灣 | 2,205 | 1,035 | 無觀看值 |
| 9 | 即時新聞 | 2,148 | 1,026 | 無觀看值 |
| 10 | 會員 | 2,130 | 986 | 無觀看值 |
| 11 | instagram | 2,077 | 980 | 無觀看值 |
| 12 | IG | 1,903 | 932 | 無觀看值 |
| 13 | 全球 | 1,798 | 831 | 無觀看值 |
| 14 | LIVE | 1,701 | 739 | 無觀看值 |
| 15 | 節目 | 1,607 | 764 | 無觀看值 |
| 16 | LINE | 1,574 | 758 | 無觀看值 |
| 17 | 連結 | 1,502 | 709 | 無觀看值 |
| 18 | 24小時 | 1,489 | 675 | 無觀看值 |
| 19 | 平台 | 1,465 | 690 | 無觀看值 |
| 20 | 影片 | 1,448 | 710 | 無觀看值 |
## 28 個詞的具體命中證據

表中名次及影片數固定取自首頁基準；來源頻道來自 keyword videos 回應；field、UTF-16 `[start,end)` 與片段來自該影片 tags 回應。每列至少一筆實際命中。片段含正常事件文字時保留上下文；`24小時` 特別保留作為禁止誤刪的反例。

| 名次／詞／影片數 | 來源頻道、影片 | 實際 field／offset 與短片段 | 判斷範圍 |
| --- | --- | --- | --- |
| 1・新聞・5,102 | Focus全球新聞 Focus Global News；[Z2KhUgVXZ94](https://youtube.observe.tw/api/v1/videos/Z2KhUgVXZ94/tags) | `description [175,177)`：您一起掌握最新趨勢與國際脈動 ↵  ↵ 請鎖定TVBS 56頻道📺 ↵ ‧《FOCUS全球新聞》 由主播 方念華播報 ↵    週一至週五 晚間19:00 提供完整報導／晚間22 | 來源／節目名稱出現在宣傳排程；分類詞依新文易數既有規則處理。 |
| 2・看・4,919 | 民視新聞網 Formosa TV News network；[oSFXQaEKqRQ](https://youtube.observe.tw/api/v1/videos/oSFXQaEKqRQ/tags) | `description [143,144)`：annel/UC2VmWn8dAqkzlQqvy02E1PA/join ↵  ↵ 歡迎收看並訂閱【#民視新聞網】YouTube頻道，另外請記得開啟YouTube🔔小鈴鐺 | 單字在「收看」等一般動詞內命中，非獨立議題。 |
| 3・訂閱・4,122 | Focus全球新聞 Focus Global News；[Z2KhUgVXZ94](https://youtube.observe.tw/api/v1/videos/Z2KhUgVXZ94/tags) | `description [321,323)`：新聞》 ↵    週一至週五 午間12:00/13:00 世界X即時新聞隨時更新 ↵ ●訂閱【FOCUS全球新聞】記得開啟小鈴鐺通知 全球訊息不漏接 ↵ ➔https://ww | 頻道訂閱與小鈴鐺通知 CTA。 |
| 4・直播・3,684 | 全球大視野；[OardXIPHMHY](https://youtube.observe.tw/api/v1/videos/OardXIPHMHY/tags) | `description [1137,1139)`：//pse.is/AR517c ↵  ↵ ☀️《全球大視野》報導國際新聞事件，第一手現場直播，深受全球華人信賴！ ↵ 《全球大視野》節目  每週一至五23:00首播 ↵ 《全球大爆 | 樣本同時有 title 的節目格式標記、description 的頻道宣傳；不能稱為僅描述命中。 |
| 5・YouTube・2,830 | Focus全球新聞 Focus Global News；[Z2KhUgVXZ94](https://youtube.observe.tw/api/v1/videos/Z2KhUgVXZ94/tags) | `description [221,228)`：播 方念華播報 ↵    週一至週五 晚間19:00 提供完整報導／晚間22:00 YouTube頻道更新 ↵ ‧《FOCUS國際話題》 ↵    週一至週五 午間11:00 聚焦國際深 | 節目更新時段的發佈平台名稱。 |
| 6・FB・2,365 | Focus全球新聞 Focus Global News；[Z2KhUgVXZ94](https://youtube.observe.tw/api/v1/videos/Z2KhUgVXZ94/tags) | `description [492,494)`：://news.tvbs.com.tw/focus ↵ ●追蹤【FOCUS全球新聞 FB】最新發展即時更新➔https://bit.ly/3egZd8q | 追蹤來源媒體 FB 的社群 CTA。 |
| 7・下載・2,313 | 壹電視NEXT TV；[n7J32KMAELk](https://youtube.observe.tw/api/v1/videos/n7J32KMAELk/tags) | `description [438,440)`：電視】YouTube看更多直播：https://reurl.cc/9zqvOX ↵ 下載【壹電視】APP： ↵ Android平台：https://reurl.cc/W4d | 來源媒體 APP 下載 CTA。 |
| 9・即時新聞・2,148 | Focus全球新聞 Focus Global News；[Z2KhUgVXZ94](https://youtube.observe.tw/api/v1/videos/Z2KhUgVXZ94/tags) | `description [311,315)`： ↵ ‧《FOCUS世界新聞》 ↵    週一至週五 午間12:00/13:00 世界X即時新聞隨時更新 ↵ ●訂閱【FOCUS全球新聞】記得開啟小鈴鐺通知 全球訊息不漏接 ↵ ➔ht | 節目更新／頻道宣傳文字。 |
| 10・會員・2,130 | 全球大視野；[OardXIPHMHY](https://youtube.observe.tw/api/v1/videos/OardXIPHMHY/tags) | `description [216,218)`：#俄烏戰爭#澤倫斯基#監督的力量在中天 ↵  ↵ 📣支持優質國際新聞，請加入全球大視野會員👉 https://pse.is/3q6hhd ↵ 🎓Anytime Anywh | 加入頻道會員 CTA。 |
| 11・instagram・2,077 | 鏡新聞；[j33PcWYwUGk](https://youtube.observe.tw/api/v1/videos/j33PcWYwUGk/tags) | `description [449,458)`：.com/mnewstw/ ↵ 鏡新聞Instagram👉https://www.instagram.com/mnewstw/ ↵ 鏡新聞X👉 https://twitter.com | URL 網域內命中；與同片 Instagram 分列，顯示未去 URL／大小寫未合併。 |
| 12・IG・1,903 | 94要賺錢；[cFdmKZ80j7c](https://youtube.observe.tw/api/v1/videos/cFdmKZ80j7c/tags) | `description [339,341)`：tps://www.facebook.com/setnews ↵ ◎追蹤【三立新聞網IG】直新聞隨時看：https://www.instagram.com/setnew | 追蹤來源媒體 IG 的 CTA，連到 instagram.com；不是本片事件。 |
| 14・LIVE・1,701 | Focus全球新聞 Focus Global News；[Z2KhUgVXZ94](https://youtube.observe.tw/api/v1/videos/Z2KhUgVXZ94/tags) | `title [1,5)`：【LIVE】20261012 波灣最慘重襲擊! 葉門叛軍飛彈襲沙國機場釀13死逾3百傷 尼 | title 的播出格式標記；不是描述樣板的單一問題。 |
| 15・節目・1,607 | 全球大視野；[OardXIPHMHY](https://youtube.observe.tw/api/v1/videos/OardXIPHMHY/tags) | `description [1157,1159)`：全球大視野》報導國際新聞事件，第一手現場直播，深受全球華人信賴！ ↵ 《全球大視野》節目  每週一至五23:00首播 ↵ 《全球大爆卦》節目  每週一至五16:00首播   | 固定節目時刻表；有多次 description 命中。 |
| 16・LINE・1,574 | 民視新聞網 Formosa TV News network；[oSFXQaEKqRQ](https://youtube.observe.tw/api/v1/videos/oSFXQaEKqRQ/tags) | `description [469,473)`：be.com/FTVNP  ↵  ↵ 👇👇👇民視新聞人氣連結👇👇👇 ↵ 🉐隨時LINE一下新聞不漏接✅ https://goo.gl/hze3Wv ↵ 🉐超方便手機AP | 新聞帳號的 LINE 追蹤宣傳。 |
| 17・連結・1,502 | 全球大視野；[OardXIPHMHY](https://youtube.observe.tw/api/v1/videos/OardXIPHMHY/tags) | `description [1510,1512)`：INCORPORATION ↵  ↵ ⚠️未經著作權人同意，勿將內容用於商業性質之分享、連結。  ↵ ⚠️未經授權，嚴禁複製和用於人工智慧開發及利用。 ↵ ⚠️如有任何營業使用，必 | 著作權聲明的「分享、連結」，不是事件內容。 |
| 18・24小時・1,489 | 全球大視野；[OardXIPHMHY](https://youtube.observe.tw/api/v1/videos/OardXIPHMHY/tags) | `description [91,95)`：名巴基斯坦籍居民死亡、11人受傷，這是這座機場連續第2天遇襲。青年運動宣稱，過去24小時內動用彈道飛彈、巡弋飛彈及無人機攻擊沙國機場、石油設施，並警告除麥加、麥地那兩座 | 反例：本樣本是事件敘述「過去24小時內」；不可只因詞常見就排除。 |
| 19・平台・1,465 | 全球大視野；[OardXIPHMHY](https://youtube.observe.tw/api/v1/videos/OardXIPHMHY/tags) | `description [275,277)`：/3q6hhd ↵ 🎓Anytime Anywhere 想學就學【快點學】線上學習平台👉https://quicklearn.pse.is/8nfrtc 🌸【快點 | 線上學習課程廣告的「學習平台」。 |
| 20・影片・1,448 | 94要賺錢；[cFdmKZ80j7c](https://youtube.observe.tw/api/v1/videos/cFdmKZ80j7c/tags) | `description [241,243)`：.me/setn?openQrModal=true ↵ ◎訂閱【三立新聞網YT】最新影片搶先看：https://www.youtube.com/@setn ↵ ◎按讚【三立 | 訂閱來源媒體 YT、最新影片搶先看的 CTA。 |
| 22・分享・1,294 | 全球大視野；[OardXIPHMHY](https://youtube.observe.tw/api/v1/videos/OardXIPHMHY/tags) | `description [1507,1509)`：ON INCORPORATION ↵  ↵ ⚠️未經著作權人同意，勿將內容用於商業性質之分享、連結。  ↵ ⚠️未經授權，嚴禁複製和用於人工智慧開發及利用。 ↵ ⚠️如有任何營業使 | 著作權聲明的「商業性質之分享」。 |
| 24・家・1,272 | TVBS NEWS；[ps51T0dcD8Y](https://youtube.observe.tw/api/v1/videos/ps51T0dcD8Y/tags) | `description [62,63)`：女子，被發現倒臥血泊中，全身有大面積燒燙傷、頸部還有刀傷。警方追查發現，她走路回家時，遭到一名陌生男子一路尾隨，痛下殺手後還疑似為了毀屍滅跡放火燒，動機則還需要釐 | 單字在「回家／家中／大家」等詞內命中；描述亦有正常事件內容，不可稱為全是樣板。 |
| 25・即時・1,232 | Focus全球新聞 Focus Global News；[Z2KhUgVXZ94](https://youtube.observe.tw/api/v1/videos/Z2KhUgVXZ94/tags) | `description [120,122)`：新聞，最完整的國際新聞，最全面的焦點對談，千萬不可錯過！ ↵  ↵ 面對變動的世局，提供即時分析專業解讀； ↵ 深度報導帶您一起掌握最新趨勢與國際脈動 ↵  ↵ 請鎖定TVBS 56頻 | 社群更新／頻道宣傳文案。 |
| 27・全新・1,185 | 全球大視野；[OardXIPHMHY](https://youtube.observe.tw/api/v1/videos/OardXIPHMHY/tags) | `description [324,326)`：://quicklearn.pse.is/8nfrtc 🌸【快點學】財富力課程全新上線🌸 ↵ 【立刻賺錢】財富架構設計｜林敬倫👉https://quicklear | 課程廣告的「全新上線」。 |
| 28・Facebook・1,170 | 鏡新聞；[j33PcWYwUGk](https://youtube.observe.tw/api/v1/videos/j33PcWYwUGk/tags) | `description [379,387)`：/keGM ↵ 鏡新聞官方網站👉https://www.mnews.tw/ ↵ 鏡新聞Facebook👉https://www.facebook.com/mnewstw/ ↵ 鏡新聞I | 來源媒體社群帳號名稱；FB/Facebook 為顯示別名候選，不可直接相加影片數。 |
| 35・主播・1,070 | Focus全球新聞 Focus Global News；[Z2KhUgVXZ94](https://youtube.observe.tw/api/v1/videos/Z2KhUgVXZ94/tags) | `description [180,182)`：最新趨勢與國際脈動 ↵  ↵ 請鎖定TVBS 56頻道📺 ↵ ‧《FOCUS全球新聞》 由主播 方念華播報 ↵    週一至週五 晚間19:00 提供完整報導／晚間22:00 Y | 固定節目主持人／排程介紹。 |
| 36・資訊・1,069 | 94要賺錢；[cFdmKZ80j7c](https://youtube.observe.tw/api/v1/videos/cFdmKZ80j7c/tags) | `description [118,120)`：https://www.setn.com ↵ ◎下載【三立新聞網APP】掌握最新直播資訊：https://acts.setn.com/event/2024newsapp | 來源媒體 APP 掌握直播資訊的宣傳文案。 |
| 37・精選・1,057 | 鏡新聞；[j33PcWYwUGk](https://youtube.observe.tw/api/v1/videos/j33PcWYwUGk/tags) | `description [142,144)`：/ ↵ -- ↵ 《鏡好買》電商平台全新上線🔥 ↵ 鏡好買是鏡電視全新推出的官方選物平台，精選日常生活中真正好用、安心、有品質的商品，從美食、生活用品到居家好物，幫你把關品質 | 官方電商選物廣告，與新聞事件分離。 |
| 38・Instagram・1,031 | 鏡新聞；[j33PcWYwUGk](https://youtube.observe.tw/api/v1/videos/j33PcWYwUGk/tags) | `description [426,435)`：k👉https://www.facebook.com/mnewstw/ ↵ 鏡新聞Instagram👉https://www.instagram.com/mnewstw/ ↵ 鏡新聞 | 來源媒體社群帳號名稱；同一影片亦有小寫 instagram 的 URL 命中。 |
| 40・三立・1,025 | 三立財經iNEWS；[yp6JHuChQlU](https://youtube.observe.tw/api/v1/videos/yp6JHuChQlU/tags) | `description [60,62)`：明變有錢 💰✨ ↵ 👇👇👇 好康連結通通幫你整理好囉 👇👇👇 ↵  ↵ 🍿 三立財經iNEWS｜24小時財經直播（想知道最新第一手財經動態，就點這！） ↵ 👉 h | 本來源頻道自己的品牌／APP 宣傳；title 也有品牌署名，不能據此全域封鎖媒體名。 |

## 可交叉核對的重複與別名

- 鏡新聞的 `j33PcWYwUGk`、`Y7gC5FBcudc` 皆有相同電商文案「精選日常生活中真正好用、安心、有品質的商品」與 Instagram 社群區塊，證明本次抽樣有同頻道重複廣告。
- 同一影片 `j33PcWYwUGk` 的 `Instagram` 在 description `[426,435)`；小寫 `instagram` 在 `[449,458)`，後者位於 URL。兩筆為不同大小寫原詞且同影片共存；排行第 11／38 名的 2,077／1,031 不可直接相加，應去除 URL 噪音並依影片去重後作顯示合併。
- 三立 CTA 在 `cFdmKZ80j7c` 寫「三立新聞網IG」並接 instagram.com；IG↔Instagram、FB↔Facebook 是語意別名，不是單靠 lowercase 就可證明的字串相等。需要明確顯示別名映射，保留原始詞身分。
- 民視的 `oSFXQaEKqRQ`、`2y9K7aCWE7U` 均有「隨時LINE一下新聞不漏接」；三立財經的 `yp6JHuChQlU`、`_qNs-hk7tLU` 均有「三立財經iNEWS｜24小時財經直播」及 APP 下載區塊。不能把來源媒體自我宣傳當作跨台議題聲量。
- 一字誤配有實證：`oSFXQaEKqRQ` 的「看」在 description `[143,144)`，上下文是「歡迎收看並訂閱」；`ps51T0dcD8Y` 的「家」在 description `[62,63)` 的「回家」和 `[127,128)` 的「家中」。第二支 `5tU1bzzwf5A` 又在 description `[84,85)` 命中「歡迎大家踴躍發問」。
- `24小時` 的兩支最前候選 `OardXIPHMHY`、`jo_qWgWtnTE` 都在 `[91,95)` 敘述事件「過去24小時內動用彈道飛彈」。即使其他影片用在常駐直播文案，也不可在詞池中刪除此詞。
- 台灣、氣象、沈伯洋、AI、台北、蔣萬安未被本文件認定為無用議題；沒有證據就不作噪音判定。

## 重現與後續驗收

只需公開 GET：`/api/v1/keywords/<URL-encoded-term>/videos?from=2026-10-07&to=2026-10-13&limit=2`，再查 `/api/v1/videos/<id>/tags`。日期與來源內容可能前進；比較時應保留本基準而不是改寫歷史數字。

修正後以相同窗口輸出前 20 名、覆蓋率及上述影片 evidence，確認：新文易數噪音規則生效；URL／社群／APP／課程／電商／著作權樣板不再拉高題詞；一字子字串受控；大小寫別名依影片去重；真正事件的時間敘述仍保留。此文件尚未宣稱修正或正式部署完成。

原始公開 JSON 與採集腳本保存在已忽略的 `platform/.local/f2/`：`home-keyword-baseline.json`、`request-001.json` 至 `request-044.json`、`cases.json`。記錄只包含公開回應及取樣時間／路徑／狀態，不收集認證資訊、IP、cookie 或回應標頭。追蹤文件只引用必要短片段，沒有逐字稿或整份影片描述。
