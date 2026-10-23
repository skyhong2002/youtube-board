# GSC-20261023：youtube.observe.tw 參數網址與舊格式路徑相容（附：已作廢的 board.tw 跨服務轉址紀錄）

## 範圍界線（現行有效，優先於本文件其他內容）

- **board.tw 是另一個服務。** board.tw 及其所有子網域（`youtube.board.tw`、`youtube2.board.tw`、`mayor.board.tw` 等）屬於另一個服務，和 youtube.observe.tw 不同，**本來就不在這次修改範圍內**。
  - youtube.observe.tw 不是 board.tw 的遷移目的地。
  - 不得修改 board.tw 的 DNS、Cloudflare 規則或安全設定、轉址、origin、程式或資料，也不得掃描它。
  - 完整界線見專案 `AGENTS.md` 的「Service boundary: board.tw is a separate service」。
- **跨服務 301 是錯誤操作，已停用。**
  - 2026-10-23，board.tw zone 裡被加了一條跨服務 301，規則名稱「YouTube public pages - board to observe - GSC 20261023」，把 youtube.board.tw 轉到 youtube.observe.tw。這是錯誤操作。
  - Codex 已於 2026-10-23 23:23 停用這條規則，重載後確認是 OFF。之後的匿名請求中，首頁、`/ch/3113/`、`/rank/5/` 都不再有導往 observe 的 Location，原有的 Cloudflare 403 照舊。
  - 依 Codex 的 zone 稽核，當日只有 rulesets 動作，沒有 DNS 動作。
  - **禁止重新啟用或重建這條規則**，也不能根據本文件、git 歷史或任何舊版文字重建。
- **運算式檔已作廢。** `platform/docs/youtube-board-public-redirect-expression.txt` 已改成 INVALID／DO NOT DEPLOY 說明。git 歷史裡的舊版本（commit `4967591`）不得部署。
- **仍然有效的只有 youtube.observe.tw 本身的變更**，見下方前四節：舊格式路徑在 observe.tw 一次 308、正式 Web 映像、sitemap 盤點。

分工：Claude 負責本專案（youtube.observe.tw）的程式、測試與部署；Codex 負責 youtube.observe.tw 的 Search Console、Sitemap 提交與 Google 端驗證。
本文件記錄的都是來源端證據。提交 sitemap 或 Google 讀取不代表已索引，本文件也不宣稱任何索引成效。

## 已經正確、這次沒有重做的部分

- 影片頁回 200，canonical 指向自己。
- 時間、篩選等參數變體回 `X-Robots-Tag: noindex, follow`，`<meta robots>` 也一樣，canonical 指向去掉參數的網址。
  例：`/keywords/清水派出所/groups/trends?days=7&type=total_views&group=politician`、
  `/channels/3113/videos?hours=24&…`、`/live/days/2026-10-17?tag=1`。
- 新站 `shared/legacy-redirects.ts` 從 2026-10-12 起，就把舊 PHP 路徑以 308 一對一轉到語意相同的新報表，不會一律導回首頁。
  任務說明附的範例 `tag_group.php`、`tag_live.php`、`live_videos.php`（含 `date`／`from`）本來就正確。

## 根因與缺陷

1. **`/ch/{id}/{view}/&k=v` 在新站回 404。** 舊 Apache（`vh-board.conf`）的規則是
   `RewriteRule ^/ch/(.*)/(.*)/(.*) /channel_$2.php?u_id=$1&$3`，舊頁面也照這個格式產生篩選連結，
   例如 `/ch/%s/videos/&hours=%s`、`/ch/%s/comments/&hours=%s`、`/ch/%d/cloud/&days=7`、`/ch/%d/line/&orig=1`、
   `/ch/%s/prompt/&date=%s`、`/ch/%s/date/&date=%s`。新站的對應只認 `/ch/{id}/{view}`，所以這類路徑在 youtube.observe.tw 上回 404。
   這次任務說明附的範例 `/ch/3113/videos/&hours=24` 就是這個格式。
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

## youtube.observe.tw 上的舊格式路徑對應（全部 308，只在 observe.tw）

| 送到 youtube.observe.tw 的舊格式路徑 | 轉到的 youtube.observe.tw 報表 |
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

這張表只描述 youtube.observe.tw 自己怎麼處理送到它的舊格式路徑，**不是** board.tw 的遷移對應，也不能拿來設定 board.tw 的任何規則。

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

robots.txt（youtube.observe.tw）是 `Allow: /`，只排除私人和 API 前綴，以及 `/redir/` 與 `/prompt/`，並宣告 `Sitemap: https://youtube.observe.tw/sitemap.xml`。

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

## 歷史紀錄（已作廢，不是操作指引）：board.tw 跨服務 301

以下只留作稽核證據，**不得照做或據此重建任何規則**。

- **起因：** 本專案沒有 board.tw 的權限，原本的判斷是「需要 zone 擁有者處理」。之後 Codex 取得一個已登入的 Cloudflare 帳號。
- **錯誤操作：** Claude 把 board.tw 誤當成這次的遷移範圍，提供了只轉 GET/HEAD 的白名單運算式（commit `4967591`）。Codex 依此在 board.tw zone 部署了跨服務 301。
  - d4940f0、c39ad52 記錄了部署後的匿名請求與 Google live 測試。
  - 這些紀錄描述的狀態**已不存在**。
- **Claude 實際碰過 board.tw 的方式：** 只有匿名的 GET/HEAD（curl），以及一次瀏覽器預覽，那次只看到 Cloudflare 挑戰頁。
  - Claude 從來沒有 board.tw 的 Cloudflare、DNS 或 origin 憑證，也沒有改過它的 DNS、規則、安全設定或 origin。
  - 依 Codex 的 zone 稽核，board.tw 上的實際變更只有上述那條 301 規則（rulesets 動作），由 Codex 部署，也已由 Codex 在 23:23 停用；當日沒有 DNS 動作。
- **現況：** 規則是 OFF，board.tw 回到原本的狀態，即 Cloudflare 403 挑戰。

## 未完成（只限 youtube.observe.tw）

1. **`/ai/days/{date}/{非 ASCII 條件}` 回 503**（例如 `全部`），而未知的 ASCII 條件（`xyz`）回 200。正確的回應應該是 404。這次沒有改服務，留給後續修正。
2. **其他 session 要注意：** 之後任何換 `web` 的 release，都必須包含 main 的 `7ea09a5`，或覆蓋同樣兩個檔案，否則 observe.tw 上的舊格式路徑相容會退回。
3. **新站目標頁的 TTFB 約 1–1.5 秒。** 同一時段 `/channels/3113` 曾因 reader statement deadline 回過 503，那是另一個 session 在追的資料庫問題。
