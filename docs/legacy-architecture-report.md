# Legacy YouTube Board Reading Report

這份報告整理 legacy `youtube.board.tw` 程式的閱讀結果，重點不是逐行翻譯 PHP，而是說明原系統設計了什麼、每一塊如何接在一起、以及它為什麼能做出一般 YouTube 排行頁做不到的分析。

Legacy snapshot 來源：

- `/Users/sky/Documents/youtube-board-legacy/urtube`
- `/Users/sky/Documents/youtube-board-legacy/vh-board.conf`
- 目前 repo 中的 schema dump：`storage/app/db-dumps/urtube-schema-20260524-173342.sql`

這份文件也把它視為一個家人長期投入設計的 civic media observatory 來保存。報告會刻意保留原設計的思路：哪些問題是他想回答的、哪些資料結構是為了讓那些問題能被回答、哪些看似簡單的 PHP/cron 寫法其實是在承載一套很明確的觀測模型。

## Executive Summary

這個 legacy 系統是一套針對台灣 YouTube 公共議題、媒體、政治人物與直播生態設計的「持續觀測型儀表板」。它不是只查 YouTube API 後顯示結果，而是把 YouTube 頻道、影片、直播觀看數、留言、標籤、關鍵字、媒體事件與 AI 摘要分成多條背景資料流，持續寫入本地資料庫，再由前台頁面用很快的查詢與預先計算好的快取表組合成報告。

最重要的設計特徵有幾個：

- 用 `urt_channel.stime`、`urt_channel.vtime`、`urt_video_schedule.stime` 等欄位，把資料表本身當成工作佇列與下一次抓取時間表。
- 用 `urt_count.tags` 內的 `[tag_id]` 字串快速表達頻道分類，讓前台可以用 `tagid`、`or`、`not` 組合出很多政治、媒體、議題、直播條件。
- 用 `urt_log.thedata`、`urt_video_log.thedata`、`urt_video_live_log.log_json` 這類 JSON 欄位保存時間序列，省掉大量細粒度 log table join，也讓 sparkline、週/月差分、預測很容易從一筆資料還原。
- 用 `urt_show_*` 和 `data/keyword*.json` 做前台快取層，把重計算和外部 API 呼叫移到 cron 裡。
- 用 cron 把系統分成「發現新內容」、「更新統計」、「建立快取」、「產生 AI 摘要」、「留言分析」等 pipeline。
- 用簡單但有效的防重複執行機制避免 cron 疊加：多數 maintenance script 都用 `ps ax | grep $phpname` 檢查同一支 PHP 是否已經在跑。
- 很早就把 AI 當成新聞事件整理層：先對各媒體頻道的影片標題做事件萃取，再把多家媒體事件合併成每日事件，並計算媒體數、影片數、關鍵字、人物、角度、陣營。

整體來看，這是「資料採集 + 時間序列 + 標籤分類 + 快取報表 + AI 摘要」的系統。它使用的技術很直接：PHP、MySQL/MyISAM、cron、shell、YouTube Data API、OpenAI API、一些前端表格與 sparkline。但設計重點不在框架，而在資料流切分、排程節奏、觀察指標與報告視角。

## High-Level Architecture

現行 PHP 站台由 Apache vhost 對外提供 `youtube.board.tw`，程式根目錄是 `urtube/`。`vh-board.conf` 將 `/ch/...`、`/rank/...`、`/day/...` 等友善 URL rewrite 到對應 PHP，例如 `/ch/{u_id}/...` 對到 `channel*.php`，`/day/{date}/{condition}` 對到 `ai_day.php`。

主要目錄可以分成：

- public PHP pages：`live.php`、`rank.php`、`tag.php`、`channel.php`、`ai_day.php` 等，負責使用者看到的報告。
- `api/`：給前台或其他 PHP 呼叫的 JSON / cache API，例如 `cloud_tag_date.php`、`tags_all.php`、`video_live.php`。
- `maint/`：cron 背景工作，例如 `get_video.php`、`get_live.php`、`get_video_count.php`、`make_keyword.php`、`show_live.php`、`make_ai_day.sh`。
- `prompt/`：AI prompt 與 AI 事件產生入口，例如 `ai_hour_prompt.php`。
- `redir/`：手動寫入與管理入口，例如加入影片、加入直播、更新頻道、變更 tag。
- `html/`、`mayor/`：靜態頁產生或特定報表輸出。
- `include/`、`nav_*.php`：共用條件組合與導覽。

資料流大致是：

```text
YouTube Data API / 新文易數 tag.analysis.tw / OpenAI
  -> maint/*.php cron jobs
  -> MySQL core tables and JSON log columns
  -> api/*.php cache builders and urt_show_* tables
  -> public report pages
```

前台頁面大多不直接呼叫外部 API，而是讀本地 DB 或已建好的快取。這讓頁面可以服務即時排行、文字雲、事件頁、趨勢線，而不需要每個 request 等外部 API。

## Data Model

核心資料表不是嚴格 normalized 的設計，而是為了報表效率與 cron 寫入方便做了取捨。

### Channel Layer

`urt_channel` 是頻道基本資料表，包含 YouTube channel id、名稱、縮圖、uploads playlist、總觀看數、訂閱數、影片數，以及兩個很重要的排程欄位：

- `stime`：channel statistics 下一次或最近更新時間，用在 `maint/get_statics.php`。
- `vtime`：channel uploads / new videos 下一次或最近更新時間，用在 `maint/get_video.php`。

`urt_count` 是頻道 aggregate table。它保存目前總數、週/月差分、tag 字串、預測觀看數。前台排行頁 `rank.php` 主要查這張表，再回查 `urt_channel` 補頻道名稱與縮圖。

這個分層很有意思：`urt_channel` 保存「頻道本體」，`urt_count` 保存「報表用指標」。這讓頻道 metadata 與排名指標可以分開更新。

### Video Layer

`urt_video` 是影片主表，保存影片標題、頻道、發布時間、縮圖、描述、觀看數、like、commentCount。`videoId` 有 unique key。

`urt_video_schedule` 是影片統計更新佇列。`maint/get_video_count.php` 會挑 `stime` 到期或 NULL、且發布時間在範圍內的影片，批次呼叫 YouTube `videos.list(part=statistics)`，再更新 `urt_video`、`urt_video_schedule`、`urt_video_log`、`urt_video_log_history`。

`urt_video_log` 把每月每日的 view/like/comment 寫進 JSON；`urt_video_log_history` 保存較細的歷史抽樣。這是影片長期趨勢與排行差分的基礎。

### Live Layer

直播是 legacy 系統最特別的一條資料流。

`urt_video_live` 保存直播目前狀態：

- `videoId`
- `u_id`
- `actualStartTime`
- `scheduledStartTime`
- `concurrentViewers`
- `actualEndTime`
- `activeLiveChatId`
- `max_current`
- `del_flag`

`urt_video_live_log` 保存每日直播觀看數曲線。它不是每分鐘一列，而是一列一天，`log_json` 內用 `HH:MM => concurrentViewers` 表示時間序列，並另外存 `max_current`。

`urt_show_video_live` 是展示快取，把 live row 與 video metadata 合併，前台 `live.php` 才不需要每次 join 或補資料。

這三層讓系統可以同時回答：

- 現在哪些直播正在播？
- 現在觀看數是多少？
- 今天最高多少？
- 全期最高多少？
- 最近趨勢線長什麼樣？
- 這場直播屬於哪些頻道 tag？

### Tags And Keywords

`urt_tag` 是人工或系統定義的 tag id/name。`urt_count.tags` 用字串保存頻道所屬 tag，例如 `[52]`、`[89]` 這種形式。多數頁面都用 `tags like '%[id]%'` 來篩選。

這個設計看起來粗糙，但它讓 PHP 很容易把 URL 參數轉成組合條件：

- `tagid=3,13` 表示同時包含多個 tag。
- `or=1,2,13,14` 表示任一 tag。
- `not=3,4,5,6,31,41` 表示排除。

共用的條件組合邏輯在 `include/condition.php`，大量 public pages 和 AI scripts 都使用相同概念。

`tags` 表則存來自新文易數 `tag.analysis.tw` 的文字關鍵字。`maint/make_keyword.php` 從這個外部 API 同步關鍵字，再輸出 `data/keyword.json` 與 `data/keyword_all.json`。這是文字雲與關鍵字頁的基礎。

`tag_group` 用來把關鍵字放進群組，例如政治人物、議題分組等。`maint/get_group.php` 從新文易數 `tag.analysis.tw/api/group.php` 同步。

### Comments Layer

留言系統用三類表：

- `urt_comment_queue` / `urt_comment_queue_done`：留言抓取佇列與完成紀錄。
- `urt_comment`：每支影片的留言 JSON、作者 JSON、統計數。
- `urt_comment_author` / `urt_comment_rev`：留言作者索引，以及作者出現在哪些影片。

`maint/make_comments.php` 先依 tag、發布時間、觀看數、commentCount 找值得抓留言的影片，放進 queue。`maint/do_comments.php` 逐筆 drain queue，呼叫 `maint/get_comment.php`。`get_comment.php` 會呼叫 YouTube `commentThreads.list`，整理 top-level comments、replies、authors，並建立 author reverse index。

特殊點是它不是只展示某支影片留言，而是能反過來看「哪些留言者跨影片出現」。`comments.php` 會把一段時間、某些 tag 下的影片留言作者聚合，計算作者出現次數。這已經接近社群參與者分析。

### AI Layer

AI 相關表包括：

- `urt_channel_ai`：單一媒體/頻道在某日或某段時間的事件整理。
- `urt_ai_date`：跨媒體的每日事件合併。
- `urt_ai_hour`：小時級事件整理。
- `urt_ai_event`、`urt_ai_period`：事件與期間延伸報告。

AI pipeline 的重要分層是：

1. `maint/make_channel_ai.php` 選出一批媒體頻道，逐一呼叫 `get_channel_openai.php`，把某媒體當天影片標題整理成事件。
2. `maint/get_ai_day.php` 把多個媒體的事件列表再丟給 AI，要求合併成跨媒體的主要事件。
3. `prompt/ai_hour_prompt.php do=1` 針對前一個完整小時的影片標題，整理成小時事件。
4. `ai_day.php` 讀 `urt_ai_date` 與 `urt_channel_ai`，把 AI 事件再計算成媒體數、影片數、關鍵字、人物、媒體 tag、台灣/中國角度、民進黨/國民黨觀點，並嵌入代表影片。

這裡的設計不只是「叫 AI 幫忙摘要」。它先把頻道分開、再做跨媒體聚合，最後再把 AI 輸出的 JSON 與原始影片資料、頻道 tag、媒體分類重新結合。這讓報告可以說明「同一事件有哪些媒體報導」、「各媒體用什麼事件名稱」、「這個事件的政治/角度分布」。

## Cron And Background Pipelines

`urtube/cron` 是整個系統的心跳。它用不同頻率執行不同任務：

- 每 9 分鐘更新頻道統計：`maint/get_statics.php`
- 每分鐘輪詢直播觀看數：`maint/get_live.php`
- 每 5 分鐘探索一般影片：`maint/get_video.php`
- 指定時段探索直播群組影片：`get_video.php live=1`、`get_video.php live=2`
- 每 7 分鐘更新影片統計：`maint/get_video_count.php`
- 每 7 分鐘建立直播展示快取：`maint/show_live.php`
- 多個固定時間建立 count、keyword、people、group、schedule 報表
- 每日產生 AI day report：`maint/make_ai_day.sh`
- 每小時產生 AI hour report：`prompt/ai_hour_prompt.php do=1`
- 每日數次建立留言 queue，並每小時抓留言

這些任務大致可以分為五層：

- Discovery：找新頻道、新影片、新直播。
- Polling：更新 live/current viewers、video statistics、channel statistics。
- Aggregation：計算週/月差分、tag cloud、group、keyword、people。
- Cache Materialization：寫 `urt_show_*` 或 JSON 檔，讓前台讀快取。
- Interpretation：用留言分析與 AI 摘要生成更高階的事件與社群解讀。

多數 background scripts 都有同一個模式：讀 CLI args 到 `$_GET`，設定 Asia/Taipei，連 DB，檢查重複執行，再以小批量 loop 處理。這讓同一支 PHP 可以從 web URL 或 cron CLI 執行，也方便手動 debug。

## Live Ranking: The Most Distinctive Mechanism

直播排行的設計值得單獨講，因為這是一般 YouTube 頁面不會直接給的能力。

### Step 1: Discover Live Candidates

`maint/get_video.php` 從頻道 uploads playlist 抓最新影片。它會檢查：

- `snippet.liveBroadcastContent == live`
- `snippet.liveBroadcastContent == upcoming`
- thumbnail URL 是否包含 `default_live.jpg`

符合條件就 insert `urt_video_live`。這代表系統不等 YouTube 首頁推薦，而是從自己關心的頻道清單主動發現直播。

### Step 2: Poll Current Viewers

`maint/get_live.php` 挑出 `mtime` 過舊、尚未結束、已到 scheduled start、未刪除的 `urt_video_live` rows，批次呼叫 YouTube `videos.list(liveStreamingDetails)`。

它會更新：

- actual start/end time
- scheduled start time
- active live chat id
- current concurrent viewers
- max current viewers

如果有 `concurrentViewers`，它會把當下時間 `HH:MM` 對應到觀看數，寫進 `urt_video_live_log.log_json`。這就是直播趨勢線的資料來源。

### Step 3: Build Display Cache

`maint/show_live.php` 把 `urt_video_live` 和 `urt_video` 合併到 `urt_show_video_live`。這張表保存 title、thumbnail、channelTitle、description 等前台需要的資料。

### Step 4: Render The Ranking

`live.php` 先用 tag condition 找出目標頻道，再查目前直播，依 `concurrentViewers` 排序。它同時讀：

- `urt_show_video_live`：影片展示資料。
- `urt_video_live`：目前人數、全期最高。
- `urt_video_live_log`：今日最高、sparkline。
- `urt_count.tags` / `urt_tag`：媒體分類 tag。

因此一個表格可以同時展示即時排名、今日最高、趨勢線、全期最高與媒體分類。這是靠多層快取與 minute-level polling 做出來的。

## Tag System And Report Composition

Legacy 系統的報告彈性主要來自 tag condition。許多頁面都有相似的條件建構：

- `tagid`：必須包含某些 tag。
- `or`：包含任一 tag。
- `not`：排除 tag。

這讓同一支報表可以變成：

- 政治媒體直播榜
- 泛綠/泛藍媒體比較
- 財經/國際新聞事件
- 政治人物相關影片
- 特定 tag 的文字雲或每日趨勢

從資料庫角度看，`urt_count.tags` 是簡化過的 inverted index。雖然不是傳統 many-to-many 表，但在 PHP + MySQL 的環境下，它讓建構報表很快、很直覺。

## Time-Series Strategy

系統大量使用「每月一筆 JSON」或「每日一筆 JSON」保存時間序列：

- `urt_log.thedata`：頻道每日 view/subscriber/video count。
- `urt_video_log.thedata`：影片每日 view/like/comment。
- `urt_video_live_log.log_json`：直播每日分鐘曲線。

這個設計的優點是：

- 寫入簡單，不需要為每個時間點新增大量 rows。
- 讀某個 channel/video/live 的整段時間序列只要少量 rows。
- 前台 sparkline 或差分計算可以在 PHP array 裡完成。
- MyISAM 下避免大量細碎 insert 導致表暴增。

缺點是 JSON 欄位不容易用 SQL 做複雜查詢，也需要 PHP 端處理資料品質。但對這個系統的主要查詢方式而言，這是很務實的取捨。

## Prediction And Derived Metrics

`maint/channel_pred.php` 是一個很有特色的自製預測模型。它讀最近幾個月的 `urt_log.thedata`，把累積觀看數轉成每日增量，濾掉負值、過大值、前日資料缺失等異常，再計算每週各星期幾的觀看比例中位數。

當某天資料缺失時，它用同週已知資料加上歷史 weekday median ratio 補估。最後加總最近 7 天與 29 天，寫回 `urt_count.views_pred_week` 和 `urt_count.views_pred_month`。

這不是機器學習模型，但很符合媒體頻道流量的週期性：週一到週日的觀看分布通常有固定型態。它讓排行榜不只看已發生的週/月成長，也能顯示預估觀看數與實際差距。

## Comments And Audience Analysis

留言 pipeline 的特殊之處是它建立了 author-level reverse index。

`maint/get_comment.php` 抓留言時不只保存 comment JSON，也會整理作者：

- 新作者寫入 `urt_comment_author`。
- 作者出現過的 videoId 寫入 `urt_comment_rev.index_json`。
- 每支影片保存 authors_json 和 comments_json。

前台 `comments.php` 會在一段時間、某個 tag 範圍內找影片，再聚合留言作者出現次數。這讓系統可以觀察「哪些帳號在多支熱門影片留言」，比單純影片留言列表更進一步。

## AI Event Architecture

AI 事件設計是 legacy 系統近年最有代表性的演化。

它不是把所有影片標題一次丟給 AI，而是分層：

- 先按媒體頻道整理事件：每個媒體自己的影片標題被聚成事件。
- 再跨媒體合併事件：把不同媒體可能在講同一件事的事件合併。
- 再把合併結果回接到原本的 channel/video/tag 資料。

`prompt/ai_hour_prompt.php` 的 prompt 要求 AI 產生事件、描述、角度、陣營、關鍵字、人物、地名、分類與 videoId。`maint/get_ai_day.php` 則要求 AI 將不同媒體事件合併成每日主要事件。

`ai_day.php` 顯示時又做了一層計算：

- 媒體數：多少媒體涉及同一事件。
- 影片數：多少影片屬於同一事件。
- 關鍵字/人物：從各媒體事件累計。
- 標籤分布：從頻道 tag 反推泛綠、泛藍等媒體分類。
- 角度/陣營：從 AI 回傳欄位依影片數加權。
- 代表影片：嵌入部分 YouTube iframe，滑鼠 hover 播放。

這使得報告不是單純 AI 摘要，而是「AI 事件 + 媒體比較 + 原始影片證據」的混合系統。

## Manual Operations And Bookmarklet

`app/admin.php` 是一個很實用的人工補資料入口。它能吃 YouTube channel URL、user URL、custom URL、watch URL，解析出 channel id 或 video id，呼叫 YouTube API 補 channel metadata，建立 `urt_channel` / `urt_count`，並提供 tag add/delete、加入影片、加入直播、抓留言等操作連結。

頁面最後提供 bookmarklet：

```text
+ Yourtube
```

使用者可以在瀏覽 YouTube 時把目前 URL 丟回 `youtube.board.tw/app/admin.php`，快速把頻道或影片納入系統。這代表資料來源不是完全自動 crawler，而是保留了人工策展能力。對政治媒體觀測來說，這很重要，因為頻道名單與 tag 分類常常需要人的判斷。

`redir/` 下的 scripts 是這些手動操作的寫入端，例如 `add_video.php`、`renew.php`、`tag.php`。現代 Laravel rebuild 已經把這些入口改成 controlled Laravel ingestion workflow，避免誤寫 production。

## Static And Cache Generation

Legacy 系統不只動態查 DB，也會產生靜態或半靜態輸出：

- `html/make_html.sh` 產生 group chart/line 相關 HTML。
- `html/make_live.sh` 產生 live static HTML。
- `mayor/make_mayor.sh` 曾用於 mayor report。
- `api/tags_all.php force=1` 會重新計算 `urt_show_data.tags_all`。
- 多個 `urt_show_*` table 是前台查詢快取。

這些設計顯示原系統很重視「前台讀取快」與「昂貴計算背景化」。即使 PHP 頁面看起來是即時輸出，背後很多資料已經先被 cron 算好。

## Design Strengths

### 1. Domain-Driven Pipelines

每條 pipeline 都對應到一個實際報告需求：直播排行、頻道排行、影片成長、留言作者、每日事件。它不是為了抽象而抽象，而是從報表需求反推資料表與 cron。

### 2. Queue State Stored In Domain Tables

`stime`、`vtime`、`mtime`、`del_flag` 這些欄位讓資料本身帶有工作狀態。沒有額外 queue 系統，卻可以做到分批抓取、避免重複、錯開 API quota。

### 3. Tag Condition As A Query Language

`tagid` / `or` / `not` 幾乎是一個小型查詢語言。它讓同一套頁面可以生成很多不同報告視角，也讓 AI 條件如 `blue`、`green`、`neutral`、`finance`、`world` 可以映射到 tag 條件。

### 4. Materialized Views Before The Term Was Used

`urt_show_*`、`urt_show_data`、`data/keyword*.json` 都是在做 materialized view。這讓前台在 MyISAM + PHP 的環境下仍能快速服務多種排行榜與趨勢頁。

### 5. Evidence-Preserving AI

AI 結果沒有取代原始資料，而是保留 videoId、媒體、tag、事件關聯。這讓報告可以回到影片證據，不只是展示一段摘要文字。

### 6. Human-In-The-Loop Curation

`app/admin.php`、`redir/tag.php`、手動加入影片/直播等設計，讓系統能由人快速補足或修正 crawler 未涵蓋的資料。對觀測政治媒體這種半結構化領域，這是必要能力。

## Technical Risks And Historical Constraints

這份報告也應該誠實記錄 legacy code 的風險：

- 使用舊 `mysql_*` API，現代 PHP 已不支援。
- SQL 多用字串拼接，安全性依賴內部使用情境與信任邊界。
- API keys 和 DB credentials 在 legacy snapshot 中原本是硬編碼；目前閱讀時已視為敏感資訊，不應搬入新 repo。
- MyISAM 沒有 transaction，背景 job idempotency 主要靠 unique key、排程欄位與腳本習慣維持。
- 多個 script 有重複的參數解析、DB 連線、tag condition code。
- JSON 欄位好用但難以用 SQL 驗證一致性。
- cron 與 shell script 是系統真實控制面，若沒有文件化，後續維護者很難知道哪些資料是誰生成的。

不過，這些風險多半來自年代、工具與快速演化需求。從產品角度看，系統的資料流和觀察方法是清楚而且有創造性的。

## What The Laravel Rebuild Should Preserve

現代化時最值得保留的不是舊 PHP 寫法，而是這些 domain ideas：

- Live stream polling should keep the three-layer model: live state, daily time-series log, display cache.
- Channel/video statistics should keep explicit queue state and idempotent updates.
- Tag filtering should remain expressive enough to support `tagid`, `or`, `not`, and named conditions.
- AI reports should remain evidence-linked: event -> media -> channel -> videoId.
- Comment analysis should keep author reverse indexing.
- Background jobs should keep an explicit preview/execute split and clearly list write targets.
- Materialized report caches should be explicit and documented.
- Human curation should remain possible, but guarded and audited.

## Suggested Follow-Up Documentation

The current repo already has useful inventory files, but this report can be complemented by:

- A diagram of the full data flow from cron to DB to public pages.
- A table mapping every important legacy table to modern Eloquent/query service ownership.
- A glossary of tag ids and named conditions (`blue`, `green`, `neutral`, `finance`, `world`, `live=1`, `live=2`).
- A separate AI report explaining prompt design, JSON schemas, and how daily/hourly/channel AI outputs relate.
- A preservation note describing this project as a family-built civic media observatory, not just a technical migration.

## Known Gaps

This reading report is based on the legacy snapshot and schema dumps. It is enough to explain the main architecture and design intent, but a few areas would benefit from a later production data inspection if they become important:

- Current `meta3` crontab and process supervision, to confirm whether it still exactly matches the copied `urtube/cron`.
- Runtime-only files not fully represented by the source snapshot, especially generated `data/*.json`, static `html/*.html`, and log files under `/home/urtube/log`.
- The exact current tag taxonomy and group taxonomy in production data, including the meaning of older or rarely used numeric `urt_tag` ids.
- Production row counts and freshness for cache tables such as `urt_show_tag_date`, `urt_show_tag_cloud`, `urt_show_video_tag_date`, `urt_show_data`, and AI period/event tables.
- Operational history around manual curation: which `app/admin.php` and `redir/*` workflows were used regularly, and which were one-off tools.
- Older backup/correction scripts under `maint/backup_202211` and `maint/correct`, which appear to be maintenance or repair utilities rather than core runtime paths.

If production inspection is needed, keep it real-time YouTube dashboard. Useful commands would be limited to `hostname`, `pwd`, `ls`, `find`, `crontab -l`, `stat`, `du`, `tail` of non-secret logs, and real-time YouTube dashboard MySQL metadata queries. Do not edit files, restart services, run maintenance scripts, dump secrets, write to MySQL, or enable polling/generation from an SSH session.

## Key Files Read

- `urtube/cron`
- `vh-board.conf`
- `urtube/include/condition.php`
- `urtube/app/admin.php`
- `urtube/live.php`
- `urtube/rank.php`
- `urtube/comments.php`
- `urtube/ai_day.php`
- `urtube/api/tags_all.php`
- `urtube/maint/get_statics.php`
- `urtube/maint/get_video.php`
- `urtube/maint/get_video_count.php`
- `urtube/maint/get_live.php`
- `urtube/maint/show_live.php`
- `urtube/maint/make_count.php`
- `urtube/maint/channel_pred.php`
- `urtube/maint/make_keyword.php`
- `urtube/maint/get_group.php`
- `urtube/maint/make_comments.php`
- `urtube/maint/do_comments.php`
- `urtube/maint/get_comment.php`
- `urtube/maint/make_ai_day.sh`
- `urtube/maint/make_channel_ai.php`
- `urtube/maint/get_ai_day.php`
- `urtube/prompt/ai_hour_prompt.php`
- `urtube/redir/add_video.php`
- `urtube/redir/renew.php`
