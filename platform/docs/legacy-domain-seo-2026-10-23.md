# GSC-20261023：舊域 youtube.board.tw 遷移與參數網址整併

分工：Claude（本 thread）負責程式、測試、部署；Codex 負責 Search Console、Sitemap 提交、Google 端驗證。
本文件記錄的都是來源端證據。提交 sitemap 或 Google 讀取不代表已索引，本文件也不宣稱任何索引成效。

## 已經正確、這次沒有重做的部分

- 影片頁回 200，canonical 指向自己。
- 時間、篩選等參數變體回 `X-Robots-Tag: noindex, follow`，`<meta robots>` 也一樣，canonical 指向去掉參數的網址。
  例：`/keywords/清水派出所/groups/trends?days=7&type=total_views&group=politician`、
  `/channels/3113/videos?hours=24&…`、`/live/days/2026-10-17?tag=1`。
- 新站 `shared/legacy-redirects.ts` 從 2026-10-12 起，就把舊 PHP 路徑以 308 一對一轉到語意相同的新報表，不會一律導回首頁。
  GSC 範例 `tag_group.php`、`tag_live.php`、`live_videos.php`（含 `date`／`from`）本來就正確。

## 根因與缺陷

1. **`/ch/{id}/{view}/&k=v` 在新站回 404。** 舊 Apache（`vh-board.conf`）的規則是
   `RewriteRule ^/ch/(.*)/(.*)/(.*) /channel_$2.php?u_id=$1&$3`，舊頁面也照這個格式產生篩選連結，
   例如 `/ch/%s/videos/&hours=%s`、`/ch/%s/comments/&hours=%s`、`/ch/%d/cloud/&days=7`、`/ch/%d/line/&orig=1`、
   `/ch/%s/prompt/&date=%s`、`/ch/%s/date/&date=%s`。新站的對應只認 `/ch/{id}/{view}`，所以 Google 抓這類網址時拿到 404。
   GSC 範例 `/ch/3113/videos/&hours=24` 就是這個情況。
2. **結尾斜線的舊網址要跳兩次。** `/ch/{id}/`、`/ch/{id}/{view}/`、`/rank/{id}/`、`/day/{date}/{cond}/` 會先被 Next 去掉結尾斜線（308），
   之後 proxy 才做舊路徑對應（308）。舊站自己產生的連結大多帶結尾斜線。

修正（commit `7ea09a5`，在 main）：
- `legacyRedirect` 會把結尾的 `&k=v` 段落讀成查詢參數。這段的值優先於真正的 query string，和 Apache 改寫後 PHP 看到的一致。
  單一結尾斜線視為同一個舊頁。
- Fastify gateway（`api/src/ui-proxy.ts`）在轉給 Next 之前先呼叫同一個函式，一次 308 到報表，
  並帶 `Cache-Control: public, max-age=3600`（HSTS 照舊）。
- Next proxy 保留同一份對應，當作直接連 Next 時的後備。
- 不會被轉址的路徑：不是舊路徑的網址、`/ch/{id}/{未知view}/…`、`/group/*.php`（舊站的設定 include，不是頁面）、`nav_*.php`。這些照舊回 404，沒有導到首頁。

測試：
- `web/src/lib/legacy-redirects.test.ts`：4 組，涵蓋 GSC 範例、舊站產生的每種 `/ch` 格式、結尾斜線、不轉址的路徑。
- `api/test/ui-proxy.test.ts` 新增一個 gateway 測試：GET 和 HEAD 都回一次 308，不送到 Next；POST 回 405；非舊路徑照常轉給 Next。
- 另跑 `csp-proxy`／`public-render`（25 個通過）、`ui-proxy`／`ui-proxy-diagnostics`（7 個通過），api 與 web 的 `tsc --noEmit` 都通過。

## 對應表（舊 → 新，全部 308）

| 舊網址（youtube.board.tw） | 新網址（youtube.observe.tw） |
| --- | --- |
| `/`、`/index.php` | `/` |
| `/ch/{id}`、`/ch/{id}/`、`/channel.php?u_id={id}` | `/channels/{id}` |
| `/ch/{id}/videos/&hours=24` | `/channels/{id}/videos?hours=24&min=1000&column=viewCount&limit=1000`（帶舊站預設值；noindex，canonical 指向 `/channels/{id}/videos`） |
| `/ch/{id}/comments/&…` | `/channels/{id}/comments?…` |
| `/ch/{id}/cloud/&days=N` | `/channels/{id}/cloud?days=N` |
| `/ch/{id}/line/&orig=1` | `/channels/{id}/trends?orig=1` |
| `/ch/{id}/days/` | `/channels/{id}/people` |
| `/ch/{id}/date/&date=D` | `/channels/{id}/ai/days/D` |
| `/ch/{id}/prompt/&date=D` | `/channels/{id}/prompt?date=D` |
| `/rank/{id}/`、`/rank.php?tagid={id}` | `/tags/{id}/channels?limit=200` |
| `/day/{date}/{cond}/`、`/ai_day.php?date=&condition=` | `/ai/days/{date}/{cond}` |
| `/tag_group.php?tag=T&…` | `/keywords/T/groups/trends?…` |
| `/tag_live.php?tag=T&…` | `/keywords/T/live/trends?…` |
| `/tag_days.php`、`/tag_cloud.php`、`/tag_video.php` `?tag=T` | `/keywords/T/days`、`/cloud`、`/videos` |
| `/live_videos.php?date=D`；有 `from` 時 | `/live/days/D`；`/live/periods?from=…` |
| `/live.php`、`/live_*.php` | `/live/current`、`/live/continuous`、`/live/channels`、`/live/hours` 等 |
| `/tags.php`、`/tag.php` | `/keywords`、`/tags/compare` |
| `/days.php`、`/cloud.php`、`/line.php`、`/videos.php`、`/comments*.php` `?tagid=N` | `/tags/N/{days,cloud,trends,videos,comments}` |
| `/group_*.php?group=G` | `/groups/G[/live,/ranking,/trends]` |
| `/video.php?videoId=V`、`/video_data*.php` | `/videos/V`、`/videos/V/analytics` |
| `/ai_event*.php?pk=N` | `/ai/events/N[/people,/wall]` |
| `/mayor/{city}.php`、`/mayor/html_{city}.html` | `/mayor/cities/{city}` |
| `/html/group_chart*.html`、`/html/group_line*.html`、`/html/live_social.html` | 對應的 `/groups/…/ranking|trends`、`/live/current?or=…` |
| `/api/*.php`（舊 JSON API） | 新站同路徑直接回 200，相容 API，不轉址 |

完整規則與預設值見 `platform/shared/legacy-redirects.ts`。

## 可部署範圍與等待點

- **新站（本專案）**：可以部署，見下方部署紀錄。
- **舊域 youtube.board.tw（等待點）**：board.tw 是另一個 Cloudflare zone（NS greg/rita），origin 不在 skyhong-blog，本專案也沒有它的憑證。
  依 AGENTS 的保護規則，這次沒有進舊主機，也沒有改它的設定。
  匿名的 curl 和瀏覽器，包括 `/robots.txt`，都只拿到 Cloudflare 互動挑戰（403，`cf-mitigated: challenge`），所以無法驗證舊站目前回什麼。
  也不能因此推定已驗證的 Googlebot 一定拿到 403；GSC 的 404／5xx／redirect error 數字本身就說明 Google 有拿到其他回應。
  需要 board.tw zone 的擁有者做的設定：

  ```
  Single Redirect（Rules → Redirect Rules）
  When:  (http.host eq "youtube.board.tw")
  Then:  Dynamic, expression concat("https://youtube.observe.tw", http.request.uri.path)
         status 301, Preserve query string = on
  ```

  - 這條規則把路徑和 query 原樣交給新站，新站 gateway 再一次 308 到語意頁。整條鏈是 board.tw 301 → observe.tw 舊路徑 308 → 報表，共兩跳。
    不需要 Worker，也不需要逐條列出對應。
  - 套用後要先確認 301 出現在挑戰之前，也就是匿名請求拿到 301 而不是 403。如果還是被挑戰，請在 board.tw 的 WAF／Security Level 為這個 host 排除挑戰。
  - 保留舊站：這條規則只作用在邊緣，舊 origin 的程式、資料和 DB 都不動，停用規則就能還原。
    如果還需要在網路上看得到舊站（例如 `youtube2.board.tw` 別名，它目前也解析到同一個 zone），建議**不要**把它加進規則，
    改用 Transform Rule 加上 `X-Robots-Tag: noindex`，避免它和新站競爭。要不要這樣做由 zone 擁有者決定。
- Google 端（Codex）：套用規則前，舊域的 404 數字不會因為這次部署改變。這次部署只修好「舊 URL 進到新站之後」的那一段。

## 正式部署（2026-10-23，只換 Web）

- 來源：分支 `release/legacy-seo-20261023` 的 `3be3464599adb1afcbabb5313c7d0a2fe94d70d5`。
  它等於當時正式 Web 的 `1720243`（`release/runtime-monitoring-20261022`），再 cherry-pick main 的 `7ea09a5`。
- 映像：`youtube-board-ts:release-3be3464`，`sha256:3326d8f186f9a7289dbe34455dc8f37b576b119bb810f5325ae2d2cca979d424`。
  做法是在 `release-1720243` 上覆蓋兩個 TS 原始檔，`/home/ubuntu/yt-release-3be3464/`。
  容器內兩檔的 sha256 與 git 一致：`legacy-redirects.ts` 3094c538…、`ui-proxy.ts` 5db7baf8…。
- 候選驗證：唯讀 loopback 候選（18174，關閉所有寫入、不帶 Redis）。全部舊路徑格式都一次 308，非舊路徑行為不變，驗完已移除。
  候選的 API readiness 因 sitemap 準備遇到 statement deadline 而不是 ready。這和本變更無關，同一時段主機 IO pressure 約 85%。
- 換映像：`.local/dokploy/release-web-legacy-seo.py`。它要求 compose 裡舊 digest 只出現在 web 一處，其餘服務必須逐位元相同，執行前另存私有備份。
  - 時間（UTC）：09:38:53 送出部署，09:38:58 新 task 啟動，09:39:49 `UpdateStatus=completed`。
  - 新 task：healthy、restart 0、未 OOM，`/runtime/ready` 的 api/ui/security 都是 ready。
  - 其他 10 個服務的映像沒有變（worker-ai-daily `a12b06a1…`，其餘 `65038431…`，redis）。
- 協調：換映像前和 AI 日報／people-validation thread 約好由我先換 web，完成後才通知對方換 worker-ai-daily，避免 `compose.update` 互相覆蓋。
  換映像是等主機 load 降到 3.9、IO pressure avg60 低於 30% 才做。
- 後續：AI 日報 thread 在 09:41:39Z 只換了 worker-ai-daily（`a12b06a1…` → `feb3fdf36da7…`，ai/src/event.ts 來自 172f6eb），09:41:56Z 完成。Web 沒有重啟，仍是 `3326d8f1…`（09:38:58Z 啟動的同一個 task，healthy、restart 0），`/ch/3113/videos/&hours=24` 仍回一次 308。
- 回退：`release-web-legacy-seo.py --old=sha256:3326d8f1… --new=sha256:e5cab99fe82c2485aaf3b543c8b8b002d8ec972cf77546232fbb2e56ada8f6f8 --execute`。

### 正式網址證據（經 Cloudflare，09:40–09:45 UTC）

部署前：`/ch/3113/videos/&hours=24` 與 `/ch/3113/comments/&hours=24` 回 404；`/ch/3113/` 與 `/rank/5/` 要跳 2 次。

部署後每一個都是一次 308，`Cache-Control: public, max-age=3600`，HSTS 照舊：

| 請求 | 回應 | 最終頁（跟隨轉址後） |
| --- | --- | --- |
| `/ch/3113/videos/&hours=24` | 308 → `/channels/3113/videos?hours=24&min=1000&column=viewCount&limit=1000` | 200，`noindex, follow`，canonical `/channels/3113/videos` |
| `/ch/3113/comments/&hours=24` | 308 → `/channels/3113/comments?hours=24&limit=200&sourceLimit=1000` | |
| `/ch/3113/cloud/&days=7` | 308 → `/channels/3113/cloud?days=7` | |
| `/ch/3113/line/&orig=1` | 308 → `/channels/3113/trends?orig=1` | |
| `/ch/3113/prompt/&date=2026-10-17` | 308 → `/channels/3113/prompt?date=2026-10-17` | |
| `/ch/3113/` | 308 → `/channels/3113` | 200，可索引，canonical 指向自己 |
| `/ch/3113/days/` | 308 → `/channels/3113/people` | |
| `/rank/5/` | 308 → `/tags/5/channels?limit=200` | 200，`noindex, follow`，canonical `/tags/5/channels` |
| `/day/2026-10-01/all/` | 308 → `/ai/days/2026-10-01/all` | 200，canonical 指向自己 |
| `/tag_group.php?&tag=清水派出所&days=7&type=total_views&group=politician` | 308 → `/keywords/清水派出所/groups/trends?days=7&type=total_views&group=politician` | 200，`noindex, follow`，canonical 去參數 |
| `/tag_live.php?tag=柯文哲&days=7` | 308 → `/keywords/柯文哲/live/trends?days=7` | 200，`noindex, follow`，canonical 去參數 |
| `/live_videos.php?date=2026-10-17` | 308 → `/live/days/2026-10-17` | 200，canonical 指向自己 |
| `/live_videos.php?from=2026-10-01&to=2026-10-02` | 308 → `/live/periods?from=2026-10-01&to=2026-10-02` | |
| `/index.php` | 308 → `/` | |
| `/group/group_media.php` | 404（`private, no-store`） | 這是舊站的設定 include，不是頁面 |

最終頁的 TTFB 在 0.95–1.52 秒之間（單次量測，不是 CWV）。

robots.txt 是 `Allow: /`，只排除私人和 API 前綴，以及舊站的 `/redir/` 與 `/prompt/`，並宣告 `Sitemap: https://youtube.observe.tw/sitemap.xml`。

### Sitemap 有效 URL（09:4x UTC 快照，換映像後重建）

Index `https://youtube.observe.tw/sitemap.xml`：200，`application/xml; charset=utf-8`，`public, max-age=0, s-maxage=3600`。
13 個子檔全部 200、`application/xml`。每個檔都不超過 50,000，`<loc>` 都不帶 query，沒有外部 origin，檔內與跨檔也都沒有重複：

| 子檔 | URL 數 |
| --- | --- |
| https://youtube.observe.tw/sitemaps/static/1.xml | 20 |
| https://youtube.observe.tw/sitemaps/channels/1.xml | 3,474 |
| https://youtube.observe.tw/sitemaps/videos/1.xml | 50,000 |
| https://youtube.observe.tw/sitemaps/videos/2.xml | 50,000 |
| https://youtube.observe.tw/sitemaps/videos/3.xml | 50,000 |
| https://youtube.observe.tw/sitemaps/videos/4.xml | 50,000 |
| https://youtube.observe.tw/sitemaps/videos/5.xml | 50,000 |
| https://youtube.observe.tw/sitemaps/videos/6.xml | 50,000 |
| https://youtube.observe.tw/sitemaps/videos/7.xml | 50,000 |
| https://youtube.observe.tw/sitemaps/videos/8.xml | 50,000 |
| https://youtube.observe.tw/sitemaps/videos/9.xml | 50,000 |
| https://youtube.observe.tw/sitemaps/videos/10.xml | 7,941 |
| https://youtube.observe.tw/sitemaps/tags/1.xml | 114 |
| **合計** | **461,549** |

Codex 稍早的快照是 461,084，兩者時間不同，影片數會隨收錄增加。
從 static、channels、videos/1、videos/10、tags 各隨機抽一個 URL：全部 200、可索引、canonical 指向自己。

## 未完成

1. **board.tw zone 的轉址規則**（見上方）：需要 zone 擁有者操作。套用後要驗證匿名請求拿到 301 而不是 403 挑戰，再由 Codex 在 GSC 追蹤舊域。
2. **舊域的 404／duplicate／redirect error／5xx 數字**：這次沒有直接改變它們，因為那是舊 origin 的回應。轉址上線之前不能宣稱改善。
3. **舊域的回應時間（7242 ms）與 CWV**：屬於舊 origin，轉址後舊頁不再渲染，不另外調整。
   新站目標頁的 TTFB 約 1–1.5 秒；同一時段 `/channels/3113` 曾因 reader statement deadline 回過 503，那是另一個 session 在追的資料庫問題。
4. **`/html/` 底下 40 個有日期的歷史快照**（如 `group_line_media_2022_half.html`），以及 `/prompt/*.php`、`/redir/*.php`：沒有看到 GSC 證據，沒有加對應，目前回 404。
   如果 Codex 從 GSC 匯出看到它們有流量或索引，再逐一補上語意對應。
5. **其他 session 要注意**：之後任何換 `web` 的 release，都必須包含 main 的 `7ea09a5`，或覆蓋同樣兩個檔案，否則會退回這次的修正。
