<!-- 由 platform/tools/gen-api-docs.ts 依 OpenAPI 規格產生，請勿手改。 -->
# 有影儀表板公開 API

公開取用有影儀表板的影片、頻道排行、直播觀測與議題標籤資料。標籤來源：新文易數（tag.observe.tw）。YouTube 頻道分類（/tags）與內容標籤（/vocabulary、/keywords）分開；新聞文章數不等於影片數。標籤快照的 coverage 與 version 說明同步範圍，觀測期間快照不代表完整標籤池。

## 使用規則

- 基底網址 https://youtube.observe.tw。查詢使用 GET（也接受 HEAD），回傳 UTF-8 JSON。一般報表使用 data 與 meta；null 表示未知，不是零。
- 公開查詢不需金鑰。每個 IP 每分鐘60次（IPv6 合併 /64）；回應帶 x-ratelimit-limit、x-ratelimit-remaining、x-ratelimit-reset，超過回429與 Retry-After。請依 Retry-After 等待，勿更換來源規避限流。
- 登入後在 /my/settings 建立個人 API 金鑰，每人最多3把有效金鑰、累計最多建立100把（含已撤銷）；以 x-api-key: ytb_… 傳送，同一帳號所有金鑰合計每分鐘1000次。伺服器只存 SHA-256，明文只在建立時顯示。失效或撤銷的金鑰使用匿名額度；金鑰不授予帳號或管理權限，勿放在網址、日誌或公開程式碼中。
- 額外防濫用預算：每個 IP 網段每分鐘最多1000次金鑰驗證；IPv6 /48 合計4000次；單一 gateway 每分鐘保留匿名4000次與金鑰8000次，合計12000次；兩者不互相借用。未知金鑰每網段最多20次未命中驗證，超過後使用匿名額度並禁止共享快取。共享網路或過載時，這些上限可能先於個別額度生效。
- 允許跨網域，CORS Access-Control-Allow-Origin: *，不傳送跨站憑證。
- v1 所有時間點（instant）一律為 UTC ISO 8601，以 Z 結尾，例如 2026-10-11T16:00:00.000Z；需要台北時間請自行轉換為 Asia/Taipei（UTC+8）。「一天」與日期視窗指台北日曆日，日期型欄位（YYYY-MM-DD）與 from/to 日期參數不轉換時區。舊 PHP API 保留相容格式。
- 回應帶 Cache-Control：直播通常30秒、一般報表60秒、詞彙300秒、規格3600秒；快取時間不是來源保證更新頻率。請勿更頻繁輪詢，並檢查 meta.updatedAt 與 coverage。CDN 命中不消耗源站額度，限流標頭可能是建立快取時的快照。
- 帶 x-api-key、Authorization、Cookie 或 Set-Cookie 的回應 private, no-store；私人追蹤、個人 RSS 與管理介面不屬於公開 API。
- 公開 v1 錯誤格式為 {"error":"訊息","code":"MACHINE_CODE"}（code 可省略）。400參數錯誤、404找不到、409狀態已改變、422讀取預算不足、429太頻繁、500非預期錯誤、501未支援、503資料來源暫時無法使用。舊 PHP 與私人帳號路徑保留既有錯誤格式。
- 路徑參數須 URL 編碼，結尾不加 /。v1 發布後只做向後相容新增；移除或改名會先公告。部分報表的欄位文件仍標示 partial 或 envelope-only，這表示文件深度，不表示功能未實作。
- YouTube 標題、縮圖與影片內容著作權屬原頻道。本 API 提供公開標題、連結、統計與短摘要，不提供完整逐字稿。引用請註明「資料來源：有影儀表板 youtube.observe.tw」並保留原影片連結。
- 不寫程式也能追：RSS /feeds/videos.xml 支援影片搜尋條件（q 最長100個 UTF-16 字元）；網址清單在 /sitemap.xml。

## 分頁與狀態

影片列表保留 limit/offset。依 publishedAt 排序時，可將 nextCursor 放入 cursor，保持其他篩選條件相同，offset 省略或為0；limit 可以調整。其他排序不提供 cursor。游標是有界公開選取器，並非憑證或資料庫一致性快照，24小時後過期。下一頁排除第一頁之後新增的較大 PK；既有資料更新仍可能改變結果。游標或標籤版本不相容回400。nextCursor 為 null 或不存在時停止；total 為 null 時請查看 totalStatus 與 hasNext。

## 相容性變更紀錄

- 2026-10：時間戳統一改為 UTC（破壞性變更）。先前部分 v1 欄位輸出台北偏移，例如 2026-10-12T00:00:00+08:00，少數欄位輸出無時區的台北時間，例如 2026-10-12 00:00:00；本次發布起同一時間點一律改為 2026-10-11T16:00:00.000Z。表示的時間點不變，但字串不同：直接比較字串、切字串取日期或小時、或比對 +08:00 的程式須改用 ISO 8601 解析，需要時再轉換為 Asia/Taipei。影響範圍：影片與頻道 publishedAt/updatedAt、直播 startedAt 與逐時 trend/series 的 time、meta.updatedAt 與報表 updatedAt、報表 datetime 欄（例如 /groups/:name 的 updatedAt、留言收錄 latestComment/observedAt、頻道 AI 來源 from/to）、影片分析逐時 time 與 latestAt、首頁標籤 from/to/comparison/vocabularyWindow、/vocabulary 的 window 與 publishedAt、標籤關係 createdAt、/ai/days 的 dateFrom/dateTo、AI 提示詞預覽 period，以及文字雲 periods.*.observedUntil。YYYY-MM-DD 日期欄位、台北日曆日視窗、說明文字中的「台北時間」與舊 PHP API 不受影響。

/api/status 在瀏覽器呈現 HTML，以 Accept: application/json 取得 JSON。只顯示 API 回應狀態與端點用途，不代表資料新鮮度或背景擷取正常。/api/v1/status 保留端點清單格式。36支舊 PHP API 保留相容輸出，新舊對照見下方。未知 /api/v1/* 報表回501。

## 規格與文件入口

- API index: `GET /api/v1`
- OpenAPI 3.1: `GET /api/v1/openapi.json`
- Availability: `GET /api/status` with `Accept: application/json`
- Human documentation: `/api`

## 快速開始

Examples below use synthetic fixtures. Availability and quotas depend on the deployed release; this generated document is not deployment evidence.

```bash
curl --fail-with-body --get 'https://youtube.observe.tw/api/v1/videos' \
  --data-urlencode 'q=交通' --data-urlencode 'limit=20' \
  | jq '{rows: .data.rows, nextCursor: .data.nextCursor, totalStatus: .data.totalStatus, coverage: .meta.coverage}'

curl --fail-with-body --get 'https://youtube.observe.tw/api/v1/vocabulary' \
  --data-urlencode 'q=交通' --data-urlencode 'limit=20' \
  | jq '.data | {version, source, coverage, rows}'
```

Follow a cursor without changing filters. Keep API keys in an HTTP header, never in the URL. Respect `Retry-After` if a request returns 429.

```js
const base = new URL('https://youtube.observe.tw/api/v1/videos');
base.searchParams.set('q', '交通');
base.searchParams.set('limit', '20');
let cursor;
do {
  const url = new URL(base);
  if (cursor) url.searchParams.set('cursor', cursor);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`API HTTP ${response.status}`);
  const {data, meta} = await response.json();
  console.log(data.rows, meta.coverage);
  cursor = data.nextCursor;
} while (cursor);
```

### 常用情境（curl + jq）

```bash
# 熱門標籤：今日與近七日、比對覆蓋率與已知觀看值
curl --fail-with-body 'https://youtube.observe.tw/api/v1/home' | jq '.data.exploration | {keywordToday, keywords}'

# 頻道排行：每週觀看數前十名
curl --fail-with-body 'https://youtube.observe.tw/api/v1/channels?column=view_week&limit=10' | jq '.data.rows'

# 某頻道最新影片：8為站內頻道ID，可從頻道目錄取得
curl --fail-with-body 'https://youtube.observe.tw/api/v1/channels/8/videos?limit=20' | jq '.data | {rows, nextCursor}'

# 目前直播中的頻道與觀眾數
curl --fail-with-body 'https://youtube.observe.tw/api/v1/live/current?limit=20' | jq '.data.rows'

# 人工確認的事件清單；取得UUID後查看同事件各來源（空清單表示尚未建立）
curl --fail-with-body 'https://youtube.observe.tw/api/v1/editorial/events?limit=10' | jq '.data'
curl --fail-with-body 'https://youtube.observe.tw/api/v1/editorial/events/<事件UUID>' | jq '.data | {event, sources, metricPolicy}'
```

### Synthetic response: /api/v1/channels

```json
{
  "data": {
    "rows": [
      {
        "id": 990001,
        "youtubeId": "UCSynthetic990001",
        "title": "範例新聞甲（合成）",
        "avatar": null,
        "thumbnail": null,
        "description": null,
        "publishedAt": null,
        "youtubeUrl": "https://www.youtube.com/channel/UCSynthetic990001",
        "views": null,
        "subscribers": null,
        "videoCount": null,
        "weeklyViews": 1000,
        "monthlyViews": null,
        "weeklySubscribers": null,
        "weeklyVideos": null,
        "monthlySubscribers": null,
        "monthlyVideos": null,
        "estimatedWeeklyViews": null,
        "estimatedMonthlyViews": null,
        "monthlyEstimateGap": null,
        "legacyGrowthPercent": null,
        "averageWeeklyViewsPerVideo": null,
        "updatedAt": "2026-10-11T10:00:00.000Z",
        "tags": [
          {
            "id": 990001,
            "name": "範例分類（合成）",
            "kind": "channel"
          }
        ]
      }
    ],
    "total": 1,
    "limit": 50,
    "offset": 0,
    "ranking": {
      "column": "view_week",
      "scope": "directory",
      "min": null,
      "minMetric": "subscribers"
    }
  },
  "meta": {
    "schemaVersion": 1,
    "requestedAt": "2026-10-11T10:00:00.000Z",
    "updatedAt": "2026-10-11T10:00:00.000Z",
    "timezone": "Asia/Taipei",
    "source": "mariadb",
    "dataset": "fixture",
    "coverage": {},
    "warnings": [
      "Synthetic documentation example; not production observations."
    ]
  }
}
```

### Synthetic response: /api/v1/videos

```json
{
  "data": {
    "rows": [
      {
        "id": "FixtureAa01",
        "channelId": 990001,
        "youtubeChannelId": "UCSynthetic990001",
        "channelTitle": "範例新聞甲（合成）",
        "title": "合成：城市交通規劃",
        "description": "",
        "channelAvatar": null,
        "thumbnail": "https://i.ytimg.com/vi/FixtureAa01/mqdefault.jpg",
        "publishedAt": "2026-10-11T10:00:00.000Z",
        "views": 200,
        "likes": 5,
        "comments": null,
        "updatedAt": "2026-10-11T10:00:00.000Z",
        "youtubeUrl": "https://www.youtube.com/watch?v=FixtureAa01"
      }
    ],
    "total": null,
    "totalStatus": "not-computed",
    "hasNext": false,
    "limit": 50,
    "offset": 0,
    "nextCursor": null
  },
  "meta": {
    "schemaVersion": 1,
    "requestedAt": "2026-10-11T10:00:00.000Z",
    "updatedAt": "2026-10-11T10:00:00.000Z",
    "timezone": "Asia/Taipei",
    "source": "mariadb",
    "dataset": "fixture",
    "coverage": {},
    "warnings": [
      "Synthetic documentation example; not production observations."
    ]
  }
}
```

### Synthetic response: /api/v1/keywords/:keyword/relations

```json
{
  "data": {
    "keyword": "交通",
    "source": "https://tag.observe.tw",
    "sourceUrl": "https://tag.observe.tw/tag/%E4%BA%A4%E9%80%9A/",
    "status": "disabled",
    "reason": "disabled",
    "tagId": null,
    "truncated": false,
    "relations": [],
    "retryAfterSeconds": null
  },
  "meta": {
    "schemaVersion": 1,
    "requestedAt": "2026-10-11T10:00:00.000Z",
    "updatedAt": null,
    "timezone": "Asia/Taipei",
    "source": "tag.observe.tw",
    "dataset": "fixture",
    "coverage": {},
    "warnings": [
      "Synthetic documentation example; not production observations."
    ]
  }
}
```

### Synthetic response: /api/v1/videos/:id/tags

```json
{
  "data": {
    "videoId": "FixtureAa01",
    "version": "synthetic-vocabulary",
    "status": "matched",
    "matchedAt": "2026-10-11T10:00:00.000Z",
    "source": "https://tag.observe.tw",
    "rows": [
      {
        "key": "example-term-key",
        "term": "交通",
        "field": "title",
        "start": 5,
        "end": 7,
        "text": "交通",
        "snippet": "合成：城市交通規劃",
        "snippetStart": 0,
        "ruleVersion": "exact-text-v1"
      }
    ]
  },
  "meta": {
    "schemaVersion": 1,
    "requestedAt": "2026-10-11T10:00:00.000Z",
    "updatedAt": "2026-10-11T10:00:00.000Z",
    "timezone": "Asia/Taipei",
    "source": "mariadb",
    "dataset": "fixture",
    "coverage": {},
    "warnings": [
      "Synthetic documentation example; not production observations."
    ]
  }
}
```

### Synthetic response: /api/v1/vocabulary

```json
{
  "data": {
    "rows": [
      {
        "key": "example-term-key",
        "term": "交通",
        "articleCount": 3,
        "media": [
          "範例媒體"
        ],
        "provenance": "upstream-article-tag-origin-unspecified"
      }
    ],
    "total": 1,
    "limit": 50,
    "offset": 0,
    "version": "synthetic-vocabulary",
    "source": "https://tag.observe.tw",
    "attribution": "標籤來源：新文易數（tag.observe.tw）",
    "window": {
      "since": "2026-10-09T16:00:00.000Z",
      "until": "2026-10-10T16:00:00.000Z"
    },
    "publishedAt": "2026-10-11T01:00:00.000Z",
    "coverage": "observed-article-window",
    "upstreamSnapshotConsistent": false
  },
  "meta": {
    "schemaVersion": 1,
    "requestedAt": "2026-10-11T10:00:00.000Z",
    "updatedAt": "2026-10-11T10:00:00.000Z",
    "timezone": "Asia/Taipei",
    "source": "mariadb",
    "dataset": "fixture",
    "coverage": {},
    "warnings": [
      "Synthetic documentation example; not production observations."
    ]
  }
}
```

## 端點一覽

Schema coverage `partial` or `envelope-only` explicitly identifies incomplete field documentation. Legacy entries retain their existing wire types. HEAD may be generated by Fastify for GET; private auth/ops routes are excluded.

| Method | Path | Summary | Schema coverage |
| --- | --- | --- | --- |
| GET | `/api/v1` | Public API catalog | detailed |
| GET | `/api/v1/openapi.json` | OpenAPI 3.1 specification | partial |
| GET | `/api/v1/status` | Existing read-only route inventory | detailed |
| GET | `/api/status` | Public API availability | detailed |
| GET | `/api/v1/filter-options/{kind}` | Bounded channel or taxonomy selector | detailed |
| GET | `/api/v1/home` | Home dashboard and independent today/seven-day exploration | partial |
| GET | `/api/v1/channels` | Channel directory and observed rankings | detailed |
| GET | `/api/v1/channels/{id}` | Channel profile | detailed |
| GET | `/api/v1/channels/{id}/videos` | Channel videos | detailed |
| GET | `/api/v1/tags/videos` | Taxonomy-filtered videos | detailed |
| GET | `/api/v1/videos` | Video search | detailed |
| GET | `/api/v1/keywords/{keyword}/videos` | Videos with fresh maintained vocabulary evidence | detailed |
| GET | `/api/v1/keywords/illustrations` | Bulk maintained tag pictures for many keywords (word cloud): kind, same-origin image path, emoji and optional width/height aspect clamped to 0.25–8. Valid avatars win over visuals; malformed upstream entries are omitted, so a missing keyword is not proof of absence. No license attribution; read /keywords/{keyword}/illustration for credits. Enabled reads remain private/no-store. | detailed |
| GET | `/api/v1/keywords/{keyword}/relations` | Maintained upstream tag relations; explicit activation after F1 publication. is-a is directional, related is not co-occurrence, and aliases do not merge identities. target.href is relative to https://tag.observe.tw, never this site. Enabled upstream reads remain private/no-store; no shared downstream caching. | detailed |
| GET | `/api/v1/keywords/{keyword}/illustration` | Maintained tag picture and license attribution; optional explicit public/source-service mode. Browser images use same-origin bounded reads; no visitor credentials reach tag. | detailed |
| GET | `/api/v1/videos/{id}` | Video details and stored observations | partial |
| GET | `/api/v1/videos/{id}/tags` | Video vocabulary matching evidence | detailed |
| GET | `/api/v1/live/current` | Current observed livestreams | detailed |
| GET | `/api/v1/tags` | YouTube channel taxonomy | detailed |
| GET | `/api/v1/tags/{id}/channels` | Channels in a taxonomy category | detailed |
| GET | `/api/v1/tags/{id}/videos` | Videos in a taxonomy category | detailed |
| GET | `/api/v1/ai/days` | Daily AI topic evidence | envelope-only |
| GET | `/api/v1/ai/events/{id}` | AI event details | envelope-only |
| GET | `/api/v1/ai/days/{id}/events` | Named event in an AI daily record | envelope-only |
| GET | `/api/v1/vocabulary` | Maintained tag.observe.tw content vocabulary | detailed |
| GET | `/api/v1/keywords` | Content vocabulary alias | detailed |
| GET | `/api/v1/videos/{id}/analytics` | videos · id · analytics | envelope-only |
| GET | `/api/v1/comments/authors/{key}` | comments · authors · key | envelope-only |
| GET | `/api/v1/ai/aspects` | ai · aspects | envelope-only |
| GET | `/api/v1/groups` | groups | envelope-only |
| GET | `/api/v1/groups/{name}` | groups · name | envelope-only |
| GET | `/api/v1/groups/{name}/ranking` | groups · name · ranking | envelope-only |
| GET | `/api/v1/groups/{name}/trends` | groups · name · trends | envelope-only |
| GET | `/api/v1/mayor` | mayor | envelope-only |
| GET | `/api/v1/mayor/cities/{city}` | mayor · cities · city | envelope-only |
| GET | `/api/v1/mayor/cities/{city}/people/{person}` | mayor · cities · city · people · person | envelope-only |
| GET | `/api/v1/mayor/cities/{city}/people/{person}/days/{date}` | mayor · cities · city · people · person · days · date | envelope-only |
| GET | `/api/v1/editorial/events` | editorial · events | envelope-only |
| GET | `/api/v1/editorial/events/{id}` | editorial · events · id | envelope-only |
| GET | `/api/v1/channels/{id}/prompt` | channels · id · prompt | envelope-only |
| GET | `/api/v1/ai/days/prompt` | ai · days · prompt | envelope-only |
| GET | `/api/v1/ai/days/{date}/prompt` | ai · days · date · prompt | envelope-only |
| GET | `/api/v1/ai/days/{date}/{condition}/prompt` | ai · days · date · condition · prompt | envelope-only |
| GET | `/api/v1/ai/events/{id}/people` | ai · events · id · people | envelope-only |
| GET | `/api/v1/ai/events/{id}/wall` | ai · events · id · wall | envelope-only |
| GET | `/api/v1/ai/events/{id}/history` | ai · events · id · history | envelope-only |
| GET | `/api/v1/ai/days/{id}/events/history` | ai · days · id · events · history | envelope-only |
| GET | `/api/v1/live/days` | live · days | envelope-only |
| GET | `/api/v1/live/periods` | live · periods | envelope-only |
| GET | `/api/v1/live/days/{date}` | live · days · date | envelope-only |
| GET | `/api/v1/live/channels` | live · channels | envelope-only |
| GET | `/api/v1/live/trends/daily` | live · trends · daily | envelope-only |
| GET | `/api/v1/live/hours` | live · hours | envelope-only |
| GET | `/api/v1/live/tags` | live · tags | envelope-only |
| GET | `/api/v1/live/groups/{group}/hours` | live · groups · group · hours | envelope-only |
| GET | `/api/v1/keywords/{keyword}/live/trends` | keywords · keyword · live · trends | envelope-only |
| GET | `/api/v1/groups/{name}/live` | groups · name · live | envelope-only |
| GET | `/api/v1/tags/live/videos` | tags · live · videos | envelope-only |
| GET | `/api/v1/tags/{id}/live/videos` | tags · id · live · videos | envelope-only |
| GET | `/api/v1/live/continuous` | live · continuous | envelope-only |
| GET | `/api/v1/live/videos/{id}/trend` | live · videos · id · trend | envelope-only |
| GET | `/api/v1/live/walls/{variant}` | live · walls · variant | envelope-only |
| GET | `/api/v1/tags/compare` | tags · compare | envelope-only |
| GET | `/api/v1/keywords/{keyword}/groups/trends` | keywords · keyword · groups · trends | envelope-only |
| GET | `/api/v1/ai/hours` | ai · hours | envelope-only |
| GET | `/api/v1/ai/periods` | ai · periods | envelope-only |
| GET | `/api/v1/channels/{id}/cloud` | channels · id · cloud | envelope-only |
| GET | `/api/v1/tags/cloud` | tags · cloud | envelope-only |
| GET | `/api/v1/tags/{id}/cloud` | tags · id · cloud | envelope-only |
| GET | `/api/v1/keywords/{keyword}/cloud` | keywords · keyword · cloud | envelope-only |
| GET | `/api/v1/tags/days` | tags · days | envelope-only |
| GET | `/api/v1/tags/trends` | tags · trends | envelope-only |
| GET | `/api/v1/tags/{id}/days` | tags · id · days | envelope-only |
| GET | `/api/v1/tags/{id}/trends` | tags · id · trends | envelope-only |
| GET | `/api/v1/keywords/{keyword}/days` | keywords · keyword · days | envelope-only |
| GET | `/api/v1/channels/{id}/comments` | channels · id · comments | envelope-only |
| GET | `/api/v1/tags/comments` | tags · comments | envelope-only |
| GET | `/api/v1/tags/{id}/comments` | tags · id · comments | envelope-only |
| GET | `/api/v1/channels/{id}/trends` | channels · id · trends | envelope-only |
| GET | `/api/v1/channels/{id}/ai` | channels · id · ai | envelope-only |
| GET | `/api/v1/channels/{id}/ai/days` | channels · id · ai · days | envelope-only |
| GET | `/api/v1/channels/{id}/people` | channels · id · people | envelope-only |
| GET | `/api/api_live_day.php` | api_live_day | legacy-wire |
| GET | `/api/api_live_date.php` | api_live_date | legacy-wire |
| GET | `/api/api_live_hour.php` | api_live_hour | legacy-wire |
| GET | `/api/api_live_tag_date.php` | api_live_tag_date | legacy-wire |
| GET | `/api/live_date.php` | live_date | legacy-wire |
| GET | `/api/live_tvbs.php` | live_tvbs | legacy-wire |
| GET | `/api/video_live.php` | video_live | legacy-wire |
| GET | `/api/csv_live_line.php` | csv_live_line | legacy-wire |
| GET | `/api/tags_list.php` | tags_list | legacy-wire |
| GET | `/api/tags_index.php` | tags_index | legacy-wire |
| GET | `/api/tags_all.php` | tags_all | legacy-wire |
| GET | `/api/video_tags.php` | video_tags | legacy-wire |
| GET | `/api/video_tags_title.php` | video_tags_title | legacy-wire |
| GET | `/api/channels_list.php` | channels_list | legacy-wire |
| GET | `/api/channel_videos.php` | channel_videos | legacy-wire |
| GET | `/api/channels_videos.php` | channels_videos | legacy-wire |
| GET | `/api/api_tag.php` | api_tag | legacy-wire |
| GET | `/api/api_tag_log.php` | api_tag_log | legacy-wire |
| GET | `/api/tags_day.php` | tags_day | legacy-wire |
| GET | `/api/tags_video.php` | tags_video | legacy-wire |
| GET | `/api/tags_relation_date.php` | tags_relation_date | legacy-wire |
| GET | `/api/tag_month.php` | tag_month | legacy-wire |
| GET | `/api/tag_period.php` | tag_period | legacy-wire |
| GET | `/api/tag_tags_days.php` | tag_tags_days | legacy-wire |
| GET | `/api/cloud.php` | cloud | legacy-wire |
| GET | `/api/cloud_tag_date.php` | cloud_tag_date | legacy-wire |
| GET | `/api/cloud_tag_date_noapi.php` | cloud_tag_date_noapi | legacy-wire |
| GET | `/api/group_view.php` | group_view | legacy-wire |
| GET | `/api/api_channel_log.php` | api_channel_log | legacy-wire |
| GET | `/api/channel_pred.php` | channel_pred | legacy-wire |
| GET | `/api/ai_day.php` | ai_day | legacy-wire |
| GET | `/api/api_topic.php` | api_topic | legacy-wire |
| GET | `/api/api_event.php` | api_event | legacy-wire |
| GET | `/api/api_comment.php` | api_comment | legacy-wire |
| GET | `/api/api_duration.php` | api_duration | legacy-wire |
| GET | `/api/api_get_photo.php` | api_get_photo | legacy-wire |

## 參數

All path parameters are required. Query parameters are optional unless marked otherwise. For envelope-only reports, route-specific query documentation remains incomplete. Runtime rejects out-of-range values rather than silently clamping them.

### /api/v1/filter-options/{kind}

Typed report response; additive response fields are permitted.

| Parameter | In | Schema / bounds | Description |
| --- | --- | --- | --- |
| `kind` (required) | path | {"type":"string"} | Route selector; preserve exact spelling. |
| `q` | query | {"type":"string","maxLength":100} | Literal search text; runtime limit is 100 JavaScript UTF-16 code units. |
| `ids` | query | {"type":"string","maxLength":256} | Up to twenty comma-separated IDs; cannot combine with nonempty q. |
| `limit` | query | {"type":"integer","minimum":1,"maximum":20,"default":20} | Maximum selector rows. |

### /api/v1/channels

Typed report response; additive response fields are permitted.

| Parameter | In | Schema / bounds | Description |
| --- | --- | --- | --- |
| `limit` | query | {"type":"integer","minimum":1,"maximum":200,"default":50} | Page size. |
| `offset` | query | {"type":"integer","minimum":0,"maximum":100000,"default":0} | Offset pagination; keep filters and ordering unchanged. |
| `q` | query | {"type":"string","maxLength":100} | Literal search text; runtime limit is 100 JavaScript UTF-16 code units. |
| `tagid` | query | {"type":"string","maxLength":256} | Comma-separated channel taxonomy IDs, all required. |
| `or` | query | {"type":"string","maxLength":256} | Comma-separated taxonomy IDs, any may match. |
| `not` | query | {"type":"string","maxLength":256} | Comma-separated taxonomy IDs to exclude. |
| `column` | query | {"type":"string","enum":["viewCount","subscriberCount","videoCount","view_week","view_month","views_pred_week","views_pred_month","sub_week","sub_month","video_week","video_month"]} | Directory default view_week; taxonomy default view_month. Estimates remain explicitly distinct from observations. |
| `min` | query | {"type":"integer","minimum":0,"maximum":9007199254740991} | Minimum subscribers, or cumulative views when an or taxonomy selector is supplied. |

### /api/v1/channels/{id}

Typed report response; additive response fields are permitted.

| Parameter | In | Schema / bounds | Description |
| --- | --- | --- | --- |
| `id` (required) | path | {"type":"integer","minimum":1,"maximum":9007199254740991} | Local positive numeric record ID. |

### /api/v1/channels/{id}/videos

Typed report response; additive response fields are permitted.

| Parameter | In | Schema / bounds | Description |
| --- | --- | --- | --- |
| `id` (required) | path | {"type":"integer","minimum":1,"maximum":9007199254740991} | Local positive numeric record ID. |
| `limit` | query | {"type":"integer","minimum":1,"maximum":1000,"default":50} | Page size. |
| `offset` | query | {"type":"integer","minimum":0,"maximum":100000,"default":0} | Offset pagination; keep filters and ordering unchanged. Cursor requests require 0 or omission. |
| `q` | query | {"type":"string","maxLength":100} | Literal search text; runtime limit is 100 JavaScript UTF-16 code units. |
| `tagid` | query | {"type":"string","maxLength":256} | Comma-separated channel taxonomy IDs, all required. |
| `or` | query | {"type":"string","maxLength":256} | Comma-separated taxonomy IDs, any may match. |
| `not` | query | {"type":"string","maxLength":256} | Comma-separated taxonomy IDs to exclude. |
| `channelIds` | query | {"type":"string","maxLength":256} | Up to twenty comma-separated local channel IDs. |
| `column` | query | {"type":"string","enum":["publishedAt","viewCount","likeCount","commentCount"]} | Descending order, with source PK as deterministic tie-breaker; default publishedAt. |
| `from` | query | {"type":"string","format":"date"} | Inclusive Taipei publication date. |
| `to` | query | {"type":"string","format":"date"} | Inclusive Taipei publication date. |
| `since` | query | {"type":"string","format":"date-time"} | Exact UTC publication start, inclusive; paired with until. Cannot combine with from/to/days/hours. |
| `until` | query | {"type":"string","format":"date-time"} | Exact UTC publication end, exclusive; paired with since, past window at most 90 days. |
| `rankingPool` | query | {"type":"string","enum":["early"]} | For keyword evidence with exact since/until: keep only same-window qualified news labels and display rules. |
| `hours` | query | {"type":"integer","minimum":1,"maximum":8760} | Relative publication window, anchored by the first cursor page. |
| `min` | query | {"type":"integer","minimum":0,"maximum":9007199254740991} | Minimum cumulative video views. |
| `keyword` | query | {"type":"string","minLength":1,"maxLength":240} | Exact maintained content term; not a taxonomy ID. |
| `days` | query | {"type":"integer","minimum":1,"maximum":90} | Optional relative date window when keyword filtering is used. |
| `cursor` | query | {"type":"string","maxLength":1024} | Opaque nextCursor from a previous publishedAt page; keep the same filters. |

### /api/v1/tags/videos

Typed report response; additive response fields are permitted.

| Parameter | In | Schema / bounds | Description |
| --- | --- | --- | --- |
| `limit` | query | {"type":"integer","minimum":1,"maximum":1000,"default":50} | Page size. |
| `offset` | query | {"type":"integer","minimum":0,"maximum":100000,"default":0} | Offset pagination; keep filters and ordering unchanged. Cursor requests require 0 or omission. |
| `q` | query | {"type":"string","maxLength":100} | Literal search text; runtime limit is 100 JavaScript UTF-16 code units. |
| `tagid` | query | {"type":"string","maxLength":256} | Comma-separated channel taxonomy IDs, all required. |
| `or` | query | {"type":"string","maxLength":256} | Comma-separated taxonomy IDs, any may match. |
| `not` | query | {"type":"string","maxLength":256} | Comma-separated taxonomy IDs to exclude. |
| `channelId` | query | {"type":"integer","minimum":1,"maximum":9007199254740991} | Local numeric channel ID. |
| `channelIds` | query | {"type":"string","maxLength":256} | Up to twenty comma-separated local channel IDs. |
| `column` | query | {"type":"string","enum":["publishedAt","viewCount","likeCount","commentCount"]} | Descending order, with source PK as deterministic tie-breaker; default publishedAt. |
| `from` | query | {"type":"string","format":"date"} | Inclusive Taipei publication date. |
| `to` | query | {"type":"string","format":"date"} | Inclusive Taipei publication date. |
| `since` | query | {"type":"string","format":"date-time"} | Exact UTC publication start, inclusive; paired with until. Cannot combine with from/to/days/hours. |
| `until` | query | {"type":"string","format":"date-time"} | Exact UTC publication end, exclusive; paired with since, past window at most 90 days. |
| `rankingPool` | query | {"type":"string","enum":["early"]} | For keyword evidence with exact since/until: keep only same-window qualified news labels and display rules. |
| `hours` | query | {"type":"integer","minimum":1,"maximum":8760} | Relative publication window, anchored by the first cursor page. |
| `min` | query | {"type":"integer","minimum":0,"maximum":9007199254740991} | Minimum cumulative video views. |
| `keyword` | query | {"type":"string","minLength":1,"maxLength":240} | Exact maintained content term; not a taxonomy ID. |
| `days` | query | {"type":"integer","minimum":1,"maximum":90} | Optional relative date window when keyword filtering is used. |
| `cursor` | query | {"type":"string","maxLength":1024} | Opaque nextCursor from a previous publishedAt page; keep the same filters. |

### /api/v1/videos

Typed report response; additive response fields are permitted.

| Parameter | In | Schema / bounds | Description |
| --- | --- | --- | --- |
| `limit` | query | {"type":"integer","minimum":1,"maximum":1000,"default":50} | Page size. |
| `offset` | query | {"type":"integer","minimum":0,"maximum":100000,"default":0} | Offset pagination; keep filters and ordering unchanged. Cursor requests require 0 or omission. |
| `q` | query | {"type":"string","maxLength":100} | Literal search text; runtime limit is 100 JavaScript UTF-16 code units. |
| `tagid` | query | {"type":"string","maxLength":256} | Comma-separated channel taxonomy IDs, all required. |
| `or` | query | {"type":"string","maxLength":256} | Comma-separated taxonomy IDs, any may match. |
| `not` | query | {"type":"string","maxLength":256} | Comma-separated taxonomy IDs to exclude. |
| `channelId` | query | {"type":"integer","minimum":1,"maximum":9007199254740991} | Local numeric channel ID. |
| `channelIds` | query | {"type":"string","maxLength":256} | Up to twenty comma-separated local channel IDs. |
| `column` | query | {"type":"string","enum":["publishedAt","viewCount","likeCount","commentCount"]} | Descending order, with source PK as deterministic tie-breaker; default publishedAt. |
| `from` | query | {"type":"string","format":"date"} | Inclusive Taipei publication date. |
| `to` | query | {"type":"string","format":"date"} | Inclusive Taipei publication date. |
| `since` | query | {"type":"string","format":"date-time"} | Exact UTC publication start, inclusive; paired with until. Cannot combine with from/to/days/hours. |
| `until` | query | {"type":"string","format":"date-time"} | Exact UTC publication end, exclusive; paired with since, past window at most 90 days. |
| `rankingPool` | query | {"type":"string","enum":["early"]} | For keyword evidence with exact since/until: keep only same-window qualified news labels and display rules. |
| `hours` | query | {"type":"integer","minimum":1,"maximum":8760} | Relative publication window, anchored by the first cursor page. |
| `min` | query | {"type":"integer","minimum":0,"maximum":9007199254740991} | Minimum cumulative video views. |
| `keyword` | query | {"type":"string","minLength":1,"maxLength":240} | Exact maintained content term; not a taxonomy ID. |
| `days` | query | {"type":"integer","minimum":1,"maximum":90} | Optional relative date window when keyword filtering is used. |
| `cursor` | query | {"type":"string","maxLength":1024} | Opaque nextCursor from a previous publishedAt page; keep the same filters. |

### /api/v1/keywords/{keyword}/videos

Typed report response; additive response fields are permitted.

| Parameter | In | Schema / bounds | Description |
| --- | --- | --- | --- |
| `keyword` (required) | path | {"type":"string"} | Exact maintained content term, percent-encoded as UTF-8. |
| `limit` | query | {"type":"integer","minimum":1,"maximum":1000,"default":50} | Page size. |
| `offset` | query | {"type":"integer","minimum":0,"maximum":100000,"default":0} | Offset pagination; keep filters and ordering unchanged. Cursor requests require 0 or omission. |
| `q` | query | {"type":"string","maxLength":100} | Literal search text; runtime limit is 100 JavaScript UTF-16 code units. |
| `tagid` | query | {"type":"string","maxLength":256} | Comma-separated channel taxonomy IDs, all required. |
| `or` | query | {"type":"string","maxLength":256} | Comma-separated taxonomy IDs, any may match. |
| `not` | query | {"type":"string","maxLength":256} | Comma-separated taxonomy IDs to exclude. |
| `channelId` | query | {"type":"integer","minimum":1,"maximum":9007199254740991} | Local numeric channel ID. |
| `channelIds` | query | {"type":"string","maxLength":256} | Up to twenty comma-separated local channel IDs. |
| `column` | query | {"type":"string","enum":["publishedAt","viewCount","likeCount","commentCount"]} | Descending order, with source PK as deterministic tie-breaker; default publishedAt. |
| `from` | query | {"type":"string","format":"date"} | Inclusive Taipei publication date. |
| `to` | query | {"type":"string","format":"date"} | Inclusive Taipei publication date. |
| `since` | query | {"type":"string","format":"date-time"} | Exact UTC publication start, inclusive; paired with until. Cannot combine with from/to/days/hours. |
| `until` | query | {"type":"string","format":"date-time"} | Exact UTC publication end, exclusive; paired with since, past window at most 90 days. |
| `rankingPool` | query | {"type":"string","enum":["early"]} | For keyword evidence with exact since/until: keep only same-window qualified news labels and display rules. |
| `hours` | query | {"type":"integer","minimum":1,"maximum":8760} | Relative publication window, anchored by the first cursor page. |
| `min` | query | {"type":"integer","minimum":0,"maximum":9007199254740991} | Minimum cumulative video views. |
| `days` | query | {"type":"integer","minimum":1,"maximum":90} | Optional relative date window when keyword filtering is used. |
| `cursor` | query | {"type":"string","maxLength":1024} | Opaque nextCursor from a previous publishedAt page; keep the same filters. |

### /api/v1/keywords/{keyword}/relations

Typed report response; additive response fields are permitted.

| Parameter | In | Schema / bounds | Description |
| --- | --- | --- | --- |
| `keyword` (required) | path | {"type":"string","minLength":1,"maxLength":60,"description":"Unicode scalar characters; no surrounding whitespace or control characters."} | Exact maintained content term, percent-encoded as UTF-8. |

### /api/v1/keywords/{keyword}/illustration

Typed report response; additive response fields are permitted.

| Parameter | In | Schema / bounds | Description |
| --- | --- | --- | --- |
| `keyword` (required) | path | {"type":"string","minLength":1,"maxLength":60,"description":"Unicode scalar characters; no surrounding whitespace or control characters."} | Exact maintained content term, percent-encoded as UTF-8. |

### /api/v1/videos/{id}

Core response fields are specified; nested presentation extensions remain open.

| Parameter | In | Schema / bounds | Description |
| --- | --- | --- | --- |
| `id` (required) | path | {"type":"string"} | Byte-exact YouTube video ID. |

### /api/v1/videos/{id}/tags

Typed report response; additive response fields are permitted.

| Parameter | In | Schema / bounds | Description |
| --- | --- | --- | --- |
| `id` (required) | path | {"type":"string"} | Byte-exact YouTube video ID. |

### /api/v1/live/current

Typed report response; additive response fields are permitted.

| Parameter | In | Schema / bounds | Description |
| --- | --- | --- | --- |
| `limit` | query | {"type":"integer","minimum":1,"maximum":200,"default":50} | Page size. |
| `offset` | query | {"type":"integer","minimum":0,"maximum":100000,"default":0} | Offset pagination; keep filters and ordering unchanged. |
| `q` | query | {"type":"string","maxLength":100} | Literal search text; runtime limit is 100 JavaScript UTF-16 code units. |
| `tagid` | query | {"type":"string","maxLength":256} | Comma-separated channel taxonomy IDs, all required. |
| `or` | query | {"type":"string","maxLength":256} | Comma-separated taxonomy IDs, any may match. |
| `not` | query | {"type":"string","maxLength":256} | Comma-separated taxonomy IDs to exclude. |
| `hours` | query | {"type":"integer","minimum":1,"maximum":168} | Optional maximum time since livestream start; current observations must also have been updated within the last hour. |

### /api/v1/tags

Typed report response; additive response fields are permitted.

| Parameter | In | Schema / bounds | Description |
| --- | --- | --- | --- |
| `limit` | query | {"type":"integer","minimum":1,"maximum":200,"default":50} | Page size. |
| `offset` | query | {"type":"integer","minimum":0,"maximum":100000,"default":0} | Offset pagination; keep filters and ordering unchanged. |
| `sort` | query | {"type":"string","enum":["num","total","ave","median"]} | Order by channel count (default), total, average or median weekly views. |
| `min` | query | {"type":"integer","minimum":0,"maximum":2147483647,"default":10} | Minimum weekly channel views included in category aggregation. |

### /api/v1/tags/{id}/channels

Typed report response; additive response fields are permitted.

| Parameter | In | Schema / bounds | Description |
| --- | --- | --- | --- |
| `id` (required) | path | {"type":"integer","minimum":1,"maximum":9007199254740991} | Local positive numeric record ID. |
| `limit` | query | {"type":"integer","minimum":1,"maximum":200,"default":50} | Page size. |
| `offset` | query | {"type":"integer","minimum":0,"maximum":100000,"default":0} | Offset pagination; keep filters and ordering unchanged. |
| `q` | query | {"type":"string","maxLength":100} | Literal search text; runtime limit is 100 JavaScript UTF-16 code units. |
| `tagid` | query | {"type":"string","maxLength":256} | Comma-separated channel taxonomy IDs, all required. |
| `or` | query | {"type":"string","maxLength":256} | Comma-separated taxonomy IDs, any may match. |
| `not` | query | {"type":"string","maxLength":256} | Comma-separated taxonomy IDs to exclude. |
| `column` | query | {"type":"string","enum":["viewCount","subscriberCount","videoCount","view_week","view_month","views_pred_week","views_pred_month","sub_week","sub_month","video_week","video_month"]} | Directory default view_week; taxonomy default view_month. Estimates remain explicitly distinct from observations. |
| `min` | query | {"type":"integer","minimum":0,"maximum":9007199254740991} | Minimum subscribers, or cumulative views when an or taxonomy selector is supplied. |

### /api/v1/tags/{id}/videos

Typed report response; additive response fields are permitted.

| Parameter | In | Schema / bounds | Description |
| --- | --- | --- | --- |
| `id` (required) | path | {"type":"integer","minimum":1,"maximum":9007199254740991} | Local positive numeric record ID. |
| `limit` | query | {"type":"integer","minimum":1,"maximum":1000,"default":50} | Page size. |
| `offset` | query | {"type":"integer","minimum":0,"maximum":100000,"default":0} | Offset pagination; keep filters and ordering unchanged. Cursor requests require 0 or omission. |
| `q` | query | {"type":"string","maxLength":100} | Literal search text; runtime limit is 100 JavaScript UTF-16 code units. |
| `tagid` | query | {"type":"string","maxLength":256} | Comma-separated channel taxonomy IDs, all required. |
| `or` | query | {"type":"string","maxLength":256} | Comma-separated taxonomy IDs, any may match. |
| `not` | query | {"type":"string","maxLength":256} | Comma-separated taxonomy IDs to exclude. |
| `channelId` | query | {"type":"integer","minimum":1,"maximum":9007199254740991} | Local numeric channel ID. |
| `channelIds` | query | {"type":"string","maxLength":256} | Up to twenty comma-separated local channel IDs. |
| `column` | query | {"type":"string","enum":["publishedAt","viewCount","likeCount","commentCount"]} | Descending order, with source PK as deterministic tie-breaker; default publishedAt. |
| `from` | query | {"type":"string","format":"date"} | Inclusive Taipei publication date. |
| `to` | query | {"type":"string","format":"date"} | Inclusive Taipei publication date. |
| `since` | query | {"type":"string","format":"date-time"} | Exact UTC publication start, inclusive; paired with until. Cannot combine with from/to/days/hours. |
| `until` | query | {"type":"string","format":"date-time"} | Exact UTC publication end, exclusive; paired with since, past window at most 90 days. |
| `rankingPool` | query | {"type":"string","enum":["early"]} | For keyword evidence with exact since/until: keep only same-window qualified news labels and display rules. |
| `hours` | query | {"type":"integer","minimum":1,"maximum":8760} | Relative publication window, anchored by the first cursor page. |
| `min` | query | {"type":"integer","minimum":0,"maximum":9007199254740991} | Minimum cumulative video views. |
| `keyword` | query | {"type":"string","minLength":1,"maxLength":240} | Exact maintained content term; not a taxonomy ID. |
| `days` | query | {"type":"integer","minimum":1,"maximum":90} | Optional relative date window when keyword filtering is used. |
| `cursor` | query | {"type":"string","maxLength":1024} | Opaque nextCursor from a previous publishedAt page; keep the same filters. |

### /api/v1/ai/events/{id}

Report is implemented. Only its data/meta envelope is specified in this catalog; route-specific data and query parameter documentation remains incomplete.

| Parameter | In | Schema / bounds | Description |
| --- | --- | --- | --- |
| `id` (required) | path | {"type":"integer","minimum":1,"maximum":9007199254740991} | Local positive numeric record ID. |

### /api/v1/ai/days/{id}/events

Report is implemented. Only its data/meta envelope is specified in this catalog; route-specific data and query parameter documentation remains incomplete.

| Parameter | In | Schema / bounds | Description |
| --- | --- | --- | --- |
| `id` (required) | path | {"type":"integer","minimum":1,"maximum":9007199254740991} | Local positive numeric record ID. |

### /api/v1/vocabulary

Typed report response; additive response fields are permitted.

| Parameter | In | Schema / bounds | Description |
| --- | --- | --- | --- |
| `limit` | query | {"type":"integer","minimum":1,"maximum":200,"default":50} | Page size. |
| `offset` | query | {"type":"integer","minimum":0,"maximum":100000,"default":0} | Offset pagination; keep filters and ordering unchanged. |
| `q` | query | {"type":"string","maxLength":100} | Literal search text; runtime limit is 100 JavaScript UTF-16 code units. |

### /api/v1/keywords

Typed report response; additive response fields are permitted.

| Parameter | In | Schema / bounds | Description |
| --- | --- | --- | --- |
| `limit` | query | {"type":"integer","minimum":1,"maximum":200,"default":50} | Page size. |
| `offset` | query | {"type":"integer","minimum":0,"maximum":100000,"default":0} | Offset pagination; keep filters and ordering unchanged. |
| `q` | query | {"type":"string","maxLength":100} | Literal search text; runtime limit is 100 JavaScript UTF-16 code units. |

### /api/v1/videos/{id}/analytics

Report is implemented. Only its data/meta envelope is specified in this catalog; route-specific data and query parameter documentation remains incomplete.

| Parameter | In | Schema / bounds | Description |
| --- | --- | --- | --- |
| `id` (required) | path | {"type":"string"} | Byte-exact YouTube video ID. |

### /api/v1/comments/authors/{key}

Report is implemented. Only its data/meta envelope is specified in this catalog; route-specific data and query parameter documentation remains incomplete.

| Parameter | In | Schema / bounds | Description |
| --- | --- | --- | --- |
| `key` (required) | path | {"type":"string"} | Route selector; preserve exact spelling. |

### /api/v1/groups/{name}

Report is implemented. Only its data/meta envelope is specified in this catalog; route-specific data and query parameter documentation remains incomplete.

| Parameter | In | Schema / bounds | Description |
| --- | --- | --- | --- |
| `name` (required) | path | {"type":"string"} | Route selector; preserve exact spelling. |

### /api/v1/groups/{name}/ranking

Report is implemented. Only its data/meta envelope is specified in this catalog; route-specific data and query parameter documentation remains incomplete.

| Parameter | In | Schema / bounds | Description |
| --- | --- | --- | --- |
| `name` (required) | path | {"type":"string"} | Route selector; preserve exact spelling. |

### /api/v1/groups/{name}/trends

Report is implemented. Only its data/meta envelope is specified in this catalog; route-specific data and query parameter documentation remains incomplete.

| Parameter | In | Schema / bounds | Description |
| --- | --- | --- | --- |
| `name` (required) | path | {"type":"string"} | Route selector; preserve exact spelling. |

### /api/v1/mayor/cities/{city}

Report is implemented. Only its data/meta envelope is specified in this catalog; route-specific data and query parameter documentation remains incomplete.

| Parameter | In | Schema / bounds | Description |
| --- | --- | --- | --- |
| `city` (required) | path | {"type":"string"} | Route selector; preserve exact spelling. |

### /api/v1/mayor/cities/{city}/people/{person}

Report is implemented. Only its data/meta envelope is specified in this catalog; route-specific data and query parameter documentation remains incomplete.

| Parameter | In | Schema / bounds | Description |
| --- | --- | --- | --- |
| `city` (required) | path | {"type":"string"} | Route selector; preserve exact spelling. |
| `person` (required) | path | {"type":"string"} | Route selector; preserve exact spelling. |

### /api/v1/mayor/cities/{city}/people/{person}/days/{date}

Report is implemented. Only its data/meta envelope is specified in this catalog; route-specific data and query parameter documentation remains incomplete.

| Parameter | In | Schema / bounds | Description |
| --- | --- | --- | --- |
| `city` (required) | path | {"type":"string"} | Route selector; preserve exact spelling. |
| `person` (required) | path | {"type":"string"} | Route selector; preserve exact spelling. |
| `date` (required) | path | {"type":"string","format":"date"} | Taipei calendar date. |

### /api/v1/editorial/events/{id}

Report is implemented. Only its data/meta envelope is specified in this catalog; route-specific data and query parameter documentation remains incomplete.

| Parameter | In | Schema / bounds | Description |
| --- | --- | --- | --- |
| `id` (required) | path | {"type":"string"} | Canonical editorial event UUID. |

### /api/v1/channels/{id}/prompt

Report is implemented. Only its data/meta envelope is specified in this catalog; route-specific data and query parameter documentation remains incomplete.

| Parameter | In | Schema / bounds | Description |
| --- | --- | --- | --- |
| `id` (required) | path | {"type":"integer","minimum":1,"maximum":9007199254740991} | Local positive numeric record ID. |

### /api/v1/ai/days/{date}/prompt

Report is implemented. Only its data/meta envelope is specified in this catalog; route-specific data and query parameter documentation remains incomplete.

| Parameter | In | Schema / bounds | Description |
| --- | --- | --- | --- |
| `date` (required) | path | {"type":"string","format":"date"} | Taipei calendar date. |

### /api/v1/ai/days/{date}/{condition}/prompt

Report is implemented. Only its data/meta envelope is specified in this catalog; route-specific data and query parameter documentation remains incomplete.

| Parameter | In | Schema / bounds | Description |
| --- | --- | --- | --- |
| `date` (required) | path | {"type":"string","format":"date"} | Taipei calendar date. |
| `condition` (required) | path | {"type":"string"} | Route selector; preserve exact spelling. |

### /api/v1/ai/events/{id}/people

Report is implemented. Only its data/meta envelope is specified in this catalog; route-specific data and query parameter documentation remains incomplete.

| Parameter | In | Schema / bounds | Description |
| --- | --- | --- | --- |
| `id` (required) | path | {"type":"integer","minimum":1,"maximum":9007199254740991} | Local positive numeric record ID. |

### /api/v1/ai/events/{id}/wall

Report is implemented. Only its data/meta envelope is specified in this catalog; route-specific data and query parameter documentation remains incomplete.

| Parameter | In | Schema / bounds | Description |
| --- | --- | --- | --- |
| `id` (required) | path | {"type":"integer","minimum":1,"maximum":9007199254740991} | Local positive numeric record ID. |

### /api/v1/ai/events/{id}/history

Report is implemented. Only its data/meta envelope is specified in this catalog; route-specific data and query parameter documentation remains incomplete.

| Parameter | In | Schema / bounds | Description |
| --- | --- | --- | --- |
| `id` (required) | path | {"type":"integer","minimum":1,"maximum":9007199254740991} | Local positive numeric record ID. |

### /api/v1/ai/days/{id}/events/history

Report is implemented. Only its data/meta envelope is specified in this catalog; route-specific data and query parameter documentation remains incomplete.

| Parameter | In | Schema / bounds | Description |
| --- | --- | --- | --- |
| `id` (required) | path | {"type":"integer","minimum":1,"maximum":9007199254740991} | Local positive numeric record ID. |

### /api/v1/live/days/{date}

Report is implemented. Only its data/meta envelope is specified in this catalog; route-specific data and query parameter documentation remains incomplete.

| Parameter | In | Schema / bounds | Description |
| --- | --- | --- | --- |
| `date` (required) | path | {"type":"string","format":"date"} | Taipei calendar date. |

### /api/v1/live/groups/{group}/hours

Report is implemented. Only its data/meta envelope is specified in this catalog; route-specific data and query parameter documentation remains incomplete.

| Parameter | In | Schema / bounds | Description |
| --- | --- | --- | --- |
| `group` (required) | path | {"type":"string"} | Route selector; preserve exact spelling. |

### /api/v1/keywords/{keyword}/live/trends

Report is implemented. Only its data/meta envelope is specified in this catalog; route-specific data and query parameter documentation remains incomplete.

| Parameter | In | Schema / bounds | Description |
| --- | --- | --- | --- |
| `keyword` (required) | path | {"type":"string"} | Exact maintained content term, percent-encoded as UTF-8. |

### /api/v1/groups/{name}/live

Report is implemented. Only its data/meta envelope is specified in this catalog; route-specific data and query parameter documentation remains incomplete.

| Parameter | In | Schema / bounds | Description |
| --- | --- | --- | --- |
| `name` (required) | path | {"type":"string"} | Route selector; preserve exact spelling. |

### /api/v1/tags/{id}/live/videos

Report is implemented. Only its data/meta envelope is specified in this catalog; route-specific data and query parameter documentation remains incomplete.

| Parameter | In | Schema / bounds | Description |
| --- | --- | --- | --- |
| `id` (required) | path | {"type":"integer","minimum":1,"maximum":9007199254740991} | Local positive numeric record ID. |

### /api/v1/live/videos/{id}/trend

Report is implemented. Only its data/meta envelope is specified in this catalog; route-specific data and query parameter documentation remains incomplete.

| Parameter | In | Schema / bounds | Description |
| --- | --- | --- | --- |
| `id` (required) | path | {"type":"string"} | Byte-exact YouTube video ID. |

### /api/v1/live/walls/{variant}

Report is implemented. Only its data/meta envelope is specified in this catalog; route-specific data and query parameter documentation remains incomplete.

| Parameter | In | Schema / bounds | Description |
| --- | --- | --- | --- |
| `variant` (required) | path | {"type":"string"} | Route selector; preserve exact spelling. |

### /api/v1/keywords/{keyword}/groups/trends

Report is implemented. Only its data/meta envelope is specified in this catalog; route-specific data and query parameter documentation remains incomplete.

| Parameter | In | Schema / bounds | Description |
| --- | --- | --- | --- |
| `keyword` (required) | path | {"type":"string"} | Exact maintained content term, percent-encoded as UTF-8. |

### /api/v1/channels/{id}/cloud

Report is implemented. Only its data/meta envelope is specified in this catalog; route-specific data and query parameter documentation remains incomplete.

| Parameter | In | Schema / bounds | Description |
| --- | --- | --- | --- |
| `id` (required) | path | {"type":"integer","minimum":1,"maximum":9007199254740991} | Local positive numeric record ID. |

### /api/v1/tags/{id}/cloud

Report is implemented. Only its data/meta envelope is specified in this catalog; route-specific data and query parameter documentation remains incomplete.

| Parameter | In | Schema / bounds | Description |
| --- | --- | --- | --- |
| `id` (required) | path | {"type":"integer","minimum":1,"maximum":9007199254740991} | Local positive numeric record ID. |

### /api/v1/keywords/{keyword}/cloud

Report is implemented. Only its data/meta envelope is specified in this catalog; route-specific data and query parameter documentation remains incomplete.

| Parameter | In | Schema / bounds | Description |
| --- | --- | --- | --- |
| `keyword` (required) | path | {"type":"string"} | Exact maintained content term, percent-encoded as UTF-8. |

### /api/v1/tags/{id}/days

Report is implemented. Only its data/meta envelope is specified in this catalog; route-specific data and query parameter documentation remains incomplete.

| Parameter | In | Schema / bounds | Description |
| --- | --- | --- | --- |
| `id` (required) | path | {"type":"integer","minimum":1,"maximum":9007199254740991} | Local positive numeric record ID. |

### /api/v1/tags/{id}/trends

Report is implemented. Only its data/meta envelope is specified in this catalog; route-specific data and query parameter documentation remains incomplete.

| Parameter | In | Schema / bounds | Description |
| --- | --- | --- | --- |
| `id` (required) | path | {"type":"integer","minimum":1,"maximum":9007199254740991} | Local positive numeric record ID. |

### /api/v1/keywords/{keyword}/days

Report is implemented. Only its data/meta envelope is specified in this catalog; route-specific data and query parameter documentation remains incomplete.

| Parameter | In | Schema / bounds | Description |
| --- | --- | --- | --- |
| `keyword` (required) | path | {"type":"string"} | Exact maintained content term, percent-encoded as UTF-8. |

### /api/v1/channels/{id}/comments

Report is implemented. Only its data/meta envelope is specified in this catalog; route-specific data and query parameter documentation remains incomplete.

| Parameter | In | Schema / bounds | Description |
| --- | --- | --- | --- |
| `id` (required) | path | {"type":"integer","minimum":1,"maximum":9007199254740991} | Local positive numeric record ID. |

### /api/v1/tags/{id}/comments

Report is implemented. Only its data/meta envelope is specified in this catalog; route-specific data and query parameter documentation remains incomplete.

| Parameter | In | Schema / bounds | Description |
| --- | --- | --- | --- |
| `id` (required) | path | {"type":"integer","minimum":1,"maximum":9007199254740991} | Local positive numeric record ID. |

### /api/v1/channels/{id}/trends

Report is implemented. Only its data/meta envelope is specified in this catalog; route-specific data and query parameter documentation remains incomplete.

| Parameter | In | Schema / bounds | Description |
| --- | --- | --- | --- |
| `id` (required) | path | {"type":"integer","minimum":1,"maximum":9007199254740991} | Local positive numeric record ID. |

### /api/v1/channels/{id}/ai

Report is implemented. Only its data/meta envelope is specified in this catalog; route-specific data and query parameter documentation remains incomplete.

| Parameter | In | Schema / bounds | Description |
| --- | --- | --- | --- |
| `id` (required) | path | {"type":"integer","minimum":1,"maximum":9007199254740991} | Local positive numeric record ID. |

### /api/v1/channels/{id}/ai/days

Report is implemented. Only its data/meta envelope is specified in this catalog; route-specific data and query parameter documentation remains incomplete.

| Parameter | In | Schema / bounds | Description |
| --- | --- | --- | --- |
| `id` (required) | path | {"type":"integer","minimum":1,"maximum":9007199254740991} | Local positive numeric record ID. |

### /api/v1/channels/{id}/people

Report is implemented. Only its data/meta envelope is specified in this catalog; route-specific data and query parameter documentation remains incomplete.

| Parameter | In | Schema / bounds | Description |
| --- | --- | --- | --- |
| `id` (required) | path | {"type":"integer","minimum":1,"maximum":9007199254740991} | Local positive numeric record ID. |

## 回應欄位

The machine-readable spec is authoritative for complete constraints. Additive fields are allowed. Tables expand nested objects to depth three; deeper objects and route-specific extensions are not flattened here.

### ReportMeta

| Field | Type | Required in parent | Description |
| --- | --- | --- | --- |
| `schemaVersion` | number | yes |  |
| `requestedAt` | string | yes | UTC ISO 8601 instant ending in Z, e.g. 2026-10-11T16:00:00.000Z. |
| `updatedAt` | string \| null | yes | UTC ISO 8601 instant ending in Z, e.g. 2026-10-11T16:00:00.000Z. |
| `timezone` | string | yes |  |
| `source` | string | yes |  |
| `dataset` | string | yes |  |
| `coverage` | object | yes | Route-specific provenance, completeness and source-quality evidence; inspect the route description. Nested evidence is permitted. |
| `warnings` | array | yes |  |
| `warnings[]` | string | no |  |

### ApiError

| Field | Type | Required in parent | Description |
| --- | --- | --- | --- |
| `error` | string | yes |  |
| `code` | string | no |  |

### VideoCollection

| Field | Type | Required in parent | Description |
| --- | --- | --- | --- |
| `rows` | array | yes |  |
| `rows[]` | object | no |  |
| `rows[].id` | string | yes |  |
| `rows[].channelId` | integer | yes |  |
| `rows[].youtubeChannelId` | string | yes |  |
| `rows[].channelTitle` | string | yes |  |
| `rows[].title` | string | yes |  |
| `rows[].description` | string | yes |  |
| `rows[].thumbnail` | string \| null | yes |  |
| `rows[].publishedAt` | string \| null | yes | UTC ISO 8601 instant ending in Z, e.g. 2026-10-11T16:00:00.000Z. |
| `rows[].views` | number \| null | yes |  |
| `rows[].likes` | number \| null | yes |  |
| `rows[].comments` | number \| null | yes |  |
| `rows[].updatedAt` | string \| null | yes | UTC ISO 8601 instant ending in Z, e.g. 2026-10-11T16:00:00.000Z. |
| `rows[].youtubeUrl` | string | yes |  |
| `rows[].keywordEvidence` | array | no | At most three fresh matching snippets for each of the first fifty keyword-result videos; offsets are UTF-16 positions in the original source. Absence means enrichment unavailable. |
| `total` | integer \| null | yes |  |
| `limit` | integer | yes |  |
| `offset` | integer | yes |  |
| `hasNext` | boolean | yes |  |
| `totalStatus` | string | yes |  |
| `nextCursor` | string \| null | no |  |
| `evidenceCoverage` | object | no | Route-specific provenance, completeness and source-quality evidence; inspect the route description. Nested evidence is permitted. |

### ChannelCollection

| Field | Type | Required in parent | Description |
| --- | --- | --- | --- |
| `rows` | array | yes |  |
| `rows[]` | object | no |  |
| `rows[].id` | integer | yes |  |
| `rows[].youtubeId` | string | yes |  |
| `rows[].title` | string | yes |  |
| `rows[].thumbnail` | string \| null | yes |  |
| `rows[].description` | string \| null | yes |  |
| `rows[].publishedAt` | string \| null | yes | UTC ISO 8601 instant ending in Z, e.g. 2026-10-11T16:00:00.000Z. |
| `rows[].youtubeUrl` | string | yes |  |
| `rows[].views` | number \| null | yes |  |
| `rows[].subscribers` | number \| null | yes |  |
| `rows[].videoCount` | number \| null | yes |  |
| `rows[].weeklyViews` | number \| null | yes |  |
| `rows[].monthlyViews` | number \| null | yes |  |
| `rows[].weeklySubscribers` | number \| null | yes |  |
| `rows[].weeklyVideos` | number \| null | yes |  |
| `rows[].monthlySubscribers` | number \| null | yes |  |
| `rows[].monthlyVideos` | number \| null | yes |  |
| `rows[].estimatedWeeklyViews` | number \| null | yes |  |
| `rows[].estimatedMonthlyViews` | number \| null | yes |  |
| `rows[].monthlyEstimateGap` | number \| null | yes |  |
| `rows[].legacyGrowthPercent` | number \| null | yes |  |
| `rows[].averageWeeklyViewsPerVideo` | number \| null | yes |  |
| `rows[].updatedAt` | string \| null | yes | UTC ISO 8601 instant ending in Z, e.g. 2026-10-11T16:00:00.000Z. |
| `rows[].tags` | array | yes |  |
| `total` | integer | yes |  |
| `limit` | integer | yes |  |
| `offset` | integer | yes |  |
| `ranking` | object | yes |  |
| `ranking.column` | string | yes |  |
| `ranking.scope` | string | yes |  |
| `ranking.min` | number \| null | yes |  |
| `ranking.minMetric` | string | yes |  |

### Vocabulary

| Field | Type | Required in parent | Description |
| --- | --- | --- | --- |
| `rows` | array | yes |  |
| `rows[]` | object | no |  |
| `rows[].key` | string | yes |  |
| `rows[].term` | string | yes |  |
| `rows[].articleCount` | integer | yes |  |
| `rows[].media` | array | yes |  |
| `rows[].provenance` | string | yes |  |
| `rows[].displayExclusion` | string \| null | no | Explainable display exclusion code; null means eligible. Original vocabulary terms and evidence are retained. |
| `rows[].rankingEligibility` | object | no |  |
| `total` | integer | yes |  |
| `limit` | integer | yes |  |
| `offset` | integer | yes |  |
| `version` | string \| null | yes |  |
| `source` | string | yes |  |
| `attribution` | string | yes |  |
| `window` | union | yes |  |
| `window` | object | no |  |
| `window.since` | string | yes | UTC ISO 8601 instant ending in Z, e.g. 2026-10-11T16:00:00.000Z. |
| `window.until` | string | yes | UTC ISO 8601 instant ending in Z, e.g. 2026-10-11T16:00:00.000Z. |
| `window` | null | no |  |
| `publishedAt` | string \| null | yes | UTC ISO 8601 instant ending in Z, e.g. 2026-10-11T16:00:00.000Z. |
| `coverage` | string | yes |  |
| `upstreamSnapshotConsistent` | boolean | yes |  |
| `sourceQuality` | object | no |  |
| `sourceQuality.normalizedTags` | integer | yes |  |
| `sourceQuality.rejectedTags` | integer | yes |  |
| `sourceQuality.articlesWithRejectedTags` | integer | yes |  |

### VideoTagEvidence

| Field | Type | Required in parent | Description |
| --- | --- | --- | --- |
| `videoId` | string | yes |  |
| `version` | string \| null | yes |  |
| `status` | string | yes |  |
| `matchedAt` | string \| null | yes | UTC ISO 8601 instant ending in Z, e.g. 2026-10-11T16:00:00.000Z. |
| `source` | string | yes |  |
| `rows` | array | yes |  |
| `rows[]` | object | no |  |
| `rows[].key` | string | yes |  |
| `rows[].term` | string | yes |  |
| `rows[].field` | string | yes |  |
| `rows[].start` | integer | yes |  |
| `rows[].end` | integer | yes |  |
| `rows[].text` | string | yes |  |
| `rows[].snippet` | string | yes |  |
| `rows[].snippetStart` | integer | yes |  |
| `rows[].ruleVersion` | string | yes |  |

### Home

| Field | Type | Required in parent | Description |
| --- | --- | --- | --- |
| `summary` | object | yes |  |
| `summary.channels` | integer | yes |  |
| `summary.videos` | integer | yes |  |
| `summary.weeklyViews` | number | yes |  |
| `summary.liveChannels` | integer | yes |  |
| `summary.liveViewers` | number | yes |  |
| `channels` | array | yes |  |
| `channels[]` | object | no |  |
| `channels[].id` | integer | yes |  |
| `channels[].youtubeId` | string | yes |  |
| `channels[].title` | string | yes |  |
| `channels[].thumbnail` | string \| null | yes |  |
| `channels[].description` | string \| null | yes |  |
| `channels[].publishedAt` | string \| null | yes | UTC ISO 8601 instant ending in Z, e.g. 2026-10-11T16:00:00.000Z. |
| `channels[].youtubeUrl` | string | yes |  |
| `channels[].views` | number \| null | yes |  |
| `channels[].subscribers` | number \| null | yes |  |
| `channels[].videoCount` | number \| null | yes |  |
| `channels[].weeklyViews` | number \| null | yes |  |
| `channels[].monthlyViews` | number \| null | yes |  |
| `channels[].weeklySubscribers` | number \| null | yes |  |
| `channels[].weeklyVideos` | number \| null | yes |  |
| `channels[].monthlySubscribers` | number \| null | yes |  |
| `channels[].monthlyVideos` | number \| null | yes |  |
| `channels[].estimatedWeeklyViews` | number \| null | yes |  |
| `channels[].estimatedMonthlyViews` | number \| null | yes |  |
| `channels[].monthlyEstimateGap` | number \| null | yes |  |
| `channels[].legacyGrowthPercent` | number \| null | yes |  |
| `channels[].averageWeeklyViewsPerVideo` | number \| null | yes |  |
| `channels[].updatedAt` | string \| null | yes | UTC ISO 8601 instant ending in Z, e.g. 2026-10-11T16:00:00.000Z. |
| `channels[].tags` | array | yes |  |
| `tags` | array | yes |  |
| `tags[]` | object | no |  |
| `tags[].id` | integer | yes |  |
| `tags[].name` | string | yes |  |
| `tags[].kind` | string | yes |  |
| `tags[].channels` | integer | yes |  |
| `tags[].weeklyViews` | number | yes |  |
| `tags[].average` | number | yes |  |
| `tags[].median` | number | yes |  |
| `live` | array | yes |  |
| `live[]` | object | no |  |
| `live[].id` | string | yes |  |
| `live[].channelId` | integer | yes |  |
| `live[].youtubeChannelId` | string | yes |  |
| `live[].channelTitle` | string | yes |  |
| `live[].title` | string | yes |  |
| `live[].description` | string | yes |  |
| `live[].thumbnail` | string \| null | yes |  |
| `live[].publishedAt` | string \| null | yes | UTC ISO 8601 instant ending in Z, e.g. 2026-10-11T16:00:00.000Z. |
| `live[].views` | number \| null | yes |  |
| `live[].likes` | number \| null | yes |  |
| `live[].comments` | number \| null | yes |  |
| `live[].updatedAt` | string \| null | yes | UTC ISO 8601 instant ending in Z, e.g. 2026-10-11T16:00:00.000Z. |
| `live[].youtubeUrl` | string | yes |  |
| `live[].currentViewers` | number | yes |  |
| `live[].todayPeak` | number | yes |  |
| `live[].allTimePeak` | number \| null | yes |  |
| `live[].startedAt` | string \| null | yes | UTC ISO 8601 instant ending in Z, e.g. 2026-10-11T16:00:00.000Z. |
| `live[].trend` | array | yes |  |
| `live[].tags` | array | yes |  |
| `events` | array | yes |  |
| `events[]` | object | no | AI topic presentation; inspect evidence and unresolvedReferences. |
| `aiDate` | string \| null | yes |  |
| `exploration` | object | yes |  |
| `exploration.keywords` | object | yes |  |
| `exploration.keywords.sourceQuality` | object | no |  |
| `exploration.keywords.vocabularyCoverage` | string | yes |  |
| `exploration.keywords.vocabularyWindow` | union | yes |  |
| `exploration.keywords.source` | string | yes |  |
| `exploration.keywords.version` | string \| null | yes |  |
| `exploration.keywords.status` | string | yes |  |
| `exploration.keywords.reason` | string \| null | no |  |
| `exploration.keywords.from` | string | yes | UTC ISO 8601 instant ending in Z, e.g. 2026-10-11T16:00:00.000Z. |
| `exploration.keywords.to` | string | yes | UTC ISO 8601 instant ending in Z, e.g. 2026-10-11T16:00:00.000Z. |
| `exploration.keywords.updatedAt` | string \| null | yes | UTC ISO 8601 instant ending in Z, e.g. 2026-10-11T16:00:00.000Z. |
| `exploration.keywords.rows` | array | yes |  |
| `exploration.keywords.sourceVideos` | number \| null | yes |  |
| `exploration.keywords.freshVideos` | number \| null | yes |  |
| `exploration.keywords.staleVideos` | number \| null | yes |  |
| `exploration.keywords.unprocessedVideos` | number \| null | yes |  |
| `exploration.keywords.metric` | string | yes |  |
| `exploration.keywords.rankingPool` | object | no | Exact publication-window tag news pool, early gate (two media each two articles). Available includes immutable provenance/checksum; unavailable includes reason/windows. Short window is rolling 24h, week is seven Taipei calendar dates. Rise/history reuse current qualified cohort. |
| `exploration.keywords.rankingMethod` | string | no | Title weight 3, description-only weight 1; per-channel geometric decay 1, 0.5, 0.25…, with title matches first. |
| `exploration.keywords.riseMethod` | string | no |  |
| `exploration.keywords.ruleVersion` | string | no |  |
| `exploration.keywords.comparison` | union | no |  |
| `exploration.keywords.exclusions` | union | no |  |
| `exploration.keywordToday` | object | yes |  |
| `exploration.keywordToday.sourceQuality` | object | no |  |
| `exploration.keywordToday.vocabularyCoverage` | string | yes |  |
| `exploration.keywordToday.vocabularyWindow` | union | yes |  |
| `exploration.keywordToday.source` | string | yes |  |
| `exploration.keywordToday.version` | string \| null | yes |  |
| `exploration.keywordToday.status` | string | yes |  |
| `exploration.keywordToday.reason` | string \| null | no |  |
| `exploration.keywordToday.from` | string | yes | UTC ISO 8601 instant ending in Z, e.g. 2026-10-11T16:00:00.000Z. |
| `exploration.keywordToday.to` | string | yes | UTC ISO 8601 instant ending in Z, e.g. 2026-10-11T16:00:00.000Z. |
| `exploration.keywordToday.updatedAt` | string \| null | yes | UTC ISO 8601 instant ending in Z, e.g. 2026-10-11T16:00:00.000Z. |
| `exploration.keywordToday.rows` | array | yes |  |
| `exploration.keywordToday.sourceVideos` | number \| null | yes |  |
| `exploration.keywordToday.freshVideos` | number \| null | yes |  |
| `exploration.keywordToday.staleVideos` | number \| null | yes |  |
| `exploration.keywordToday.unprocessedVideos` | number \| null | yes |  |
| `exploration.keywordToday.metric` | string | yes |  |
| `exploration.keywordToday.rankingPool` | object | no | Exact publication-window tag news pool, early gate (two media each two articles). Available includes immutable provenance/checksum; unavailable includes reason/windows. Short window is rolling 24h, week is seven Taipei calendar dates. Rise/history reuse current qualified cohort. |
| `exploration.keywordToday.rankingMethod` | string | no | Title weight 3, description-only weight 1; per-channel geometric decay 1, 0.5, 0.25…, with title matches first. |
| `exploration.keywordToday.riseMethod` | string | no |  |
| `exploration.keywordToday.ruleVersion` | string | no |  |
| `exploration.keywordToday.comparison` | union | no |  |
| `exploration.keywordToday.exclusions` | union | no |  |
| `exploration.categories` | object | yes |  |
| `exploration.categories.status` | string | yes |  |
| `exploration.categories.reason` | string \| null | yes |  |
| `exploration.categories.rows` | array | yes |  |
| `exploration.categories.summary` | object | yes |  |
| `exploration.categories.updatedAt` | string \| null | yes | UTC ISO 8601 instant ending in Z, e.g. 2026-10-11T16:00:00.000Z. |
| `exploration.categories.minimumWeeklyViews` | number | yes |  |

### ApiAvailability

| Field | Type | Required in parent | Description |
| --- | --- | --- | --- |
| `status` | string | yes |  |
| `scope` | string | yes |  |
| `checkedAt` | string | yes | UTC ISO 8601 instant ending in Z, e.g. 2026-10-11T16:00:00.000Z. |
| `services` | array | yes |  |
| `services[]` | object | no |  |
| `services[].id` | string | yes |  |
| `services[].status` | string | yes |  |
| `endpoints` | array | yes |  |
| `endpoints[]` | object | no |  |
| `endpoints[].method` | string | yes |  |
| `endpoints[].path` | string | yes |  |

## 舊版 PHP API 對照

These are related reports, not redirects or wire-compatible replacements. The 36 legacy routes keep their existing status codes, body shapes, MIME types and compatibility headers.

| Legacy path | Related v1 report | Wire | Notes |
| --- | --- | --- | --- |
| `/api/api_live_day.php` | `/api/v1/live/videos/{id}/trend` | json | Related v1 report; query names and response shape differ. This is not a redirect or wire-compatible replacement. |
| `/api/api_live_date.php` | `/api/v1/live/days/{date}` | json | Related v1 report; query names and response shape differ. This is not a redirect or wire-compatible replacement. |
| `/api/api_live_hour.php` | `/api/v1/live/hours` | json | Related v1 report; query names and response shape differ. This is not a redirect or wire-compatible replacement. |
| `/api/api_live_tag_date.php` | `/api/v1/live/tags` | json | Related v1 report; query names and response shape differ. This is not a redirect or wire-compatible replacement. |
| `/api/live_date.php` | `/api/v1/live/days/{date}` | json | Related v1 report; query names and response shape differ. This is not a redirect or wire-compatible replacement. |
| `/api/live_tvbs.php` | None | json | Broadcaster-specific legacy cache; no one-to-one v1 replacement. |
| `/api/video_live.php` | `/api/v1/live/current` | html | HTML fragment; replacement is structured JSON. |
| `/api/csv_live_line.php` | `/api/v1/live/videos/{id}/trend` | csv | CSV download; replacement is structured JSON. |
| `/api/tags_list.php` | `/api/v1/tags` | json | Related v1 report; query names and response shape differ. This is not a redirect or wire-compatible replacement. |
| `/api/tags_index.php` | `/api/v1/keywords` | json | Maintained vocabulary replaces the legacy keyword cache; counts and provenance differ. |
| `/api/tags_all.php` | `/api/v1/keywords` | json | Maintained vocabulary replaces a legacy keyword cache; not channel taxonomy. |
| `/api/video_tags.php` | `/api/v1/videos/{id}/tags` | json | Vocabulary evidence is distinct from legacy tag extraction. |
| `/api/video_tags_title.php` | `/api/v1/videos/{id}/tags` | json | Vocabulary evidence is distinct from legacy title extraction. |
| `/api/channels_list.php` | `/api/v1/channels` | json | Related v1 report; query names and response shape differ. This is not a redirect or wire-compatible replacement. |
| `/api/channel_videos.php` | `/api/v1/channels/{id}/videos` | json | Related v1 report; query names and response shape differ. This is not a redirect or wire-compatible replacement. |
| `/api/channels_videos.php` | `/api/v1/videos` | json | Related v1 report; query names and response shape differ. This is not a redirect or wire-compatible replacement. |
| `/api/api_tag.php` | `/api/v1/tags` | json | Related v1 report; query names and response shape differ. This is not a redirect or wire-compatible replacement. |
| `/api/api_tag_log.php` | `/api/v1/tags/trends` | json | Related v1 report; query names and response shape differ. This is not a redirect or wire-compatible replacement. |
| `/api/tags_day.php` | `/api/v1/tags/cloud` | json | Related v1 report; query names and response shape differ. This is not a redirect or wire-compatible replacement. |
| `/api/tags_video.php` | `/api/v1/tags/cloud` | json | Legacy response contains weighted terms, not a video listing. |
| `/api/tags_relation_date.php` | `/api/v1/keywords/{keyword}/days` | json | Related v1 report; query names and response shape differ. This is not a redirect or wire-compatible replacement. |
| `/api/tag_month.php` | `/api/v1/keywords/{keyword}/days` | json | Legacy monthly buckets are not identical to daily report buckets. |
| `/api/tag_period.php` | `/api/v1/keywords/{keyword}/days` | json | Legacy monthly period cache is not identical to daily report buckets. |
| `/api/tag_tags_days.php` | `/api/v1/keywords/{keyword}/cloud` | json | Related v1 report; query names and response shape differ. This is not a redirect or wire-compatible replacement. |
| `/api/cloud.php` | `/api/v1/tags/cloud` | json | Related v1 report; query names and response shape differ. This is not a redirect or wire-compatible replacement. |
| `/api/cloud_tag_date.php` | `/api/v1/tags/cloud` | json | Related v1 report; query names and response shape differ. This is not a redirect or wire-compatible replacement. |
| `/api/cloud_tag_date_noapi.php` | `/api/v1/tags/cloud` | json | Related v1 report; query names and response shape differ. This is not a redirect or wire-compatible replacement. |
| `/api/group_view.php` | `/api/v1/groups/{name}/trends` | json | Related v1 report; query names and response shape differ. This is not a redirect or wire-compatible replacement. |
| `/api/api_channel_log.php` | `/api/v1/channels/{id}/trends` | json | Related v1 report; query names and response shape differ. This is not a redirect or wire-compatible replacement. |
| `/api/channel_pred.php` | `/api/v1/channels/{id}/trends` | json | Inspect estimated versus observed metrics. |
| `/api/ai_day.php` | `/api/v1/ai/days` | json | Related v1 report; query names and response shape differ. This is not a redirect or wire-compatible replacement. |
| `/api/api_topic.php` | `/api/v1/ai/days` | json | Related v1 report; query names and response shape differ. This is not a redirect or wire-compatible replacement. |
| `/api/api_event.php` | `/api/v1/ai/events/{id}` | json | Related v1 report; query names and response shape differ. This is not a redirect or wire-compatible replacement. |
| `/api/api_comment.php` | `/api/v1/videos/{id}/analytics` | json | Legacy stored-comment payload has no identical v1 analytics wire payload. |
| `/api/api_duration.php` | `/api/v1/videos/{id}` | text | Plain-text seconds; see data.durationSeconds in v1. |
| `/api/api_get_photo.php` | None | text | Legacy photo lookup; no matching v1 endpoint. |

## 產生與驗證

From `platform/`:

```bash
node --import tsx tools/gen-api-docs.ts
node --import tsx tools/gen-api-docs.ts --check
node --import tsx tools/check-openapi.ts
```

The checker validates all documented examples with JSON Schema 2020-12, including every array element. It performs no network request unless an explicit `--base-url` is supplied. API tests additionally compare the catalog with actual Fastify `onRoute` registrations and exercise legacy wire fixtures.

## 來源與授權

The catalog-driven OpenAPI, documentation generation and API/status conventions follow tag-visuals at commit `748978854035050c4de56e365ab94c178f4ddbe0` (MIT, Sky Hong). This implementation documents YouTube Board contracts; it does not assert wire compatibility with tag.observe.tw. The maintained vocabulary is separately attributed in every relevant response.

```text
MIT License

Copyright (c) 2026 Sky Hong

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
