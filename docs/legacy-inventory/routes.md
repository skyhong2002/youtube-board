# Legacy Route Inventory

## Apache Rewrites

Source: `/Users/skyhong/Documents/youtube-board-legacy/vh-board.conf`

| Legacy URL | Legacy target | Modern target |
| --- | --- | --- |
| `/ch/{u_id}/` | `/channel.php?u_id={u_id}` | `/channels/{u_id}` |
| `/ch/{u_id}/{section}/` | `/channel_{section}.php?u_id={u_id}` | Explicit per-section routes listed below, such as `/channels/{u_id}/videos`; Laravel does not expose a generic `{section}` route. |
| `/ch/{u_id}/{section}/{query}` | `/channel_{section}.php?u_id={u_id}&{query}` | Use the matching explicit per-section route with standard `?key=value` query parameters; the legacy third path segment is not a modern route. |
| `/rank/{tagId}/` | `/rank.php?tagid={tagId}` | `/tags/{tagId}/channels` |
| `/day/{date}/{condition}` | `/ai_day.php?date={date}&condition={condition}` | `/ai/days/{date}/{condition}` |

## Initial Compatibility

Implemented now:

Compatibility coverage is guarded by `tests/Feature/LegacySurfaceInventoryTest.php`, which always checks the committed `legacy-public-files.txt` inventory. When an approved local legacy snapshot is mounted, an additional test requires that snapshot to match the committed inventory. The suite verifies that all top-level public PHP files are routed or documented as include-only helpers, every `urtube/api/*.php` file has a real-time YouTube dashboard route, and every `redir` / `prompt` PHP file returns the Laravel real-time YouTube dashboard guard.

| Legacy URL | Modern URL | Status |
| --- | --- | --- |
| `/` | `/` | Real-time YouTube dashboard tag/category index |
| `/index.php?...` | `/?...` | 308 redirect to real-time YouTube dashboard tag/category index |
| `/tags` | `/tags` | Same tag/category index |
| `/tags.php?...` | `/keywords?...` | 308 redirect |
| `/days.php?tagid=...` | `/tags/{tagId}/days?...` | 308 redirect to ingestion dashboard data source; cache generation runs through Laravel ingestion jobs |
| `/tag_days.php?tag=...` | `/keywords/{keyword}/days?...` | 308 redirect to ingestion dashboard data source; cache generation runs through Laravel ingestion jobs |
| `/comments.php?tagid=...` | `/tags/{tagId}/comments?...` | 308 redirect to real-time YouTube dashboard recent comment videos + author ranking; queue/fetch refresh is owned by `youtube:comments:queue` and `youtube:comments:fetch` |
| `/comments_recent.php?tagid=...` | `/tags/{tagId}/comments?...` | 308 redirect to real-time YouTube dashboard recent comment videos + author ranking; queue/fetch refresh is owned by Laravel commands |
| `/author_comments_bak.php?author_id=...` | `/comments/authors/{authorId}?...` | 308 redirect to real-time YouTube dashboard author comment analysis; author/revision rows are populated by `youtube:comments:fetch` |
| `/author_comments_bak.php?ChannelId=...` | `/comments/authors/{ChannelId}?lookup=ChannelId...` | 308 redirect to real-time YouTube dashboard author comment analysis; author/revision rows are populated by `youtube:comments:fetch` |
| `/cloud.php?tagid=...` | `/tags/{tagId}/cloud?...` | 308 redirect to real-time YouTube dashboard tag cloud dashboard data source; cache generation runs through Laravel ingestion jobs |
| `/tag_cloud.php?tag=...` | `/keywords/{keyword}/cloud?...` | 308 redirect to real-time YouTube dashboard keyword cloud dashboard data source; reviewed cache rebuilds use manual `reports:keyword-cloud:build` |
| `/tag_video.php?tag=...` | `/keywords/{keyword}/videos?...` | 308 redirect to real-time YouTube dashboard keyword video dashboard data source; reviewed relation-cache rebuilds use manual `reports:keyword-relations:build` |
| `/tag_live.php?tag=...` | `/keywords/{keyword}/live/trends?...` | 308 redirect to real-time YouTube dashboard keyword live group trend; reviewed cache rebuilds use manual `reports:live-tag-date:build` |
| `/tag.php?tags=...` | `/tags/compare?...` | 308 redirect to real-time YouTube dashboard multi-keyword trend comparison; cache generation runs through Laravel ingestion jobs |
| `/line.php?tagid=...` | `/tags/{tagId}/trends?...` | 308 redirect to real-time YouTube dashboard `urt_show_tag_date` trend dashboard; cache generation runs through Laravel ingestion jobs |
| `/tag_group.php?tag=...` | `/keywords/{keyword}/groups/trends?...` | 308 redirect to real-time YouTube dashboard keyword group trend from `urt_show_tag_month`, with `urt_show_tag_date` fallback; reviewed monthly cache generation uses manual `reports:tag-month:build` |
| `/group_view.php?group=...` | `/groups/{groupName}?...` | 308 redirect to real-time YouTube dashboard group membership |
| `/group_people.php?group=...` | `/groups/{groupName}?...` | 308 redirect to real-time YouTube dashboard group membership |
| `/group_tag.php?group=...` | `/groups/{groupName}?...` | 308 redirect to real-time YouTube dashboard group membership |
| `/group_live.php?group=...` | `/groups/{groupName}/live?...` | 308 redirect to real-time YouTube dashboard group live trend from `urt_show_live_tag_date`; manual cache rebuild is owned by `reports:live-tag-date:build` |
| `/group_two.php` | `/groups/two/trends` | 308 redirect to real-time YouTube dashboard Taiwan-vs-China position trend; `all=1` maps to `/groups/two_all/trends` |
| `/group_chart.php?group=...` | `/groups/{groupName}/ranking?...` | 308 redirect to real-time YouTube dashboard group aggregate from `urt_show_tag_date`; cache generation runs through Laravel ingestion jobs |
| `/group_line.php?group=...` | `/groups/{groupName}/trends?...` | 308 redirect to real-time YouTube dashboard group daily trend from `urt_show_tag_date`; cache generation runs through Laravel ingestion jobs |
| `/mayor/city.php?city=...` | `/mayor/cities/{city}?...` | 308 redirect to real-time YouTube dashboard mayor candidate support report; reviewed cache rebuild uses Laravel tag-date/mayor commands |
| `/mayor/{city}.php?...` | `/mayor/cities/{city}?...` | 308 redirect for legacy city config entrypoints such as `/mayor/taipei.php`; cache generation runs through Laravel ingestion jobs |
| `/mayor/html_{city}.html?...` | `/mayor/cities/{city}?...` | 308 redirect to dynamic real-time YouTube dashboard mayor report; static HTML output is previewed by `reports:mayor:static` and not written |
| n/a | `/mayor/cities/{city}/people/{person}`, `/mayor/cities/{city}/people/{person}/days/{date}` | New real-time YouTube dashboard mayor/person daily AI page. HTTP reads `urt_mayor_person_ai` and local source caches only; generation runs through `ai:mayor-person --execute`. |
| `/html/group_chart.html` | `/groups/media/ranking?days=7` | 308 redirect to dynamic real-time YouTube dashboard group ranking used by the legacy 7-day static output |
| `/html/group_chart_30.html` | `/groups/media/ranking?days=30` | 308 redirect to dynamic real-time YouTube dashboard group ranking used by `html/make_html.sh` |
| `/html/group_chart_all.html` | `/groups/media_all/ranking?days=30` | 308 redirect to dynamic real-time YouTube dashboard all-media group ranking used by `html/make_html.sh` |
| `/html/group_line.html` | `/groups/media/trends?days=30` | 308 redirect to dynamic real-time YouTube dashboard group trend used by `html/make_html.sh` |
| `/html/live_social.html?...` | `/live/current?or=1,2,12,13,14,81...` | 308 redirect to the dynamic real-time YouTube dashboard live social ranking used by `reports:live:static`; static HTML output is not written |
| `/videos.php?tagid=...` | `/tags/{tagId}/videos?...` | 308 redirect |
| `/live_videos.php?date=YYYY-MM-DD...` | `/live/days/YYYY-MM-DD?...` | 308 redirect to the legacy video-ranking surface; preserves `tagid`, `or`, `not`, `limit`, and other filters |
| `/live_videos.php?from=YYYY-MM-DD&to=YYYY-MM-DD...` | `/live/periods?...` | 308 redirect to the period video-ranking surface |
| `/video.php?videoId=...` | `/videos/{videoId}?...` | 308 redirect to real-time YouTube dashboard video metadata and live summary |
| `/video_data_att.php?videoId=...` | `/videos/{videoId}/analytics?...` | 308 redirect to real-time YouTube dashboard video/comment analytics |
| `/video_data.php?videoId=...` | `/videos/{videoId}/analytics?...` | 308 redirect for legacy stale link emitted by `video.php` |
| `/live.php?...` | `/live/current?...` | 308 redirect |
| `/live_index.php?...` | `/live/current?...` | 308 redirect |
| `/live_cont.php?...` | `/live/continuous?...` | 308 redirect |
| `/live_day.php?date=YYYY-MM-DD...` | `/live/days/YYYY-MM-DD?...` | 308 redirect |
| `/live_line.php?videoId=...` | `/live/videos/{videoId}/trend?...` | 308 redirect; defaults to legacy `oka2UDaeFZw` when `videoId` is omitted |
| `/live_day_line.php?...` | `/live/trends/daily?...` | 308 redirect |
| `/lives_date.php?group=...&date=...` | `/live/groups/{group}/hours?date=...` | 308 redirect to real-time YouTube dashboard group hourly matrix from `urt_show_live_tag_date.hour_result`; reviewed cache rebuilds use manual `reports:live-tag-date:build` |
| `/live_channels.php?...` | `/live/channels?...` | 308 redirect |
| `/live_channel.php?date=...` | `/live/days/{date}?...` | 308 redirect to real-time YouTube dashboard live video ranking |
| `/live_channel.php?from=...&to=...` | `/live/periods?...` | 308 redirect to real-time YouTube dashboard period live video ranking |
| `/live_hour.php?...` | `/live/hours?...` | 308 redirect to a real-time YouTube dashboard hourly heatmap; prefers `urt_show_live_tag_date.hour_result` cache and falls back to raw live logs, with reviewed cache rebuilds owned by manual `reports:live-tag-date:build` |
| `/live_period.php?...` | `/live/periods?...` | 308 redirect |
| `/live_tag.php?...` | `/live/tags?...` | 308 redirect |
| `/api/api_live_day.php?videoId=...` | same URL | Real-time YouTube dashboard JSON from `urt_video_live_log`; ingestion jobs own data refresh |
| `/api/api_live_date.php?date=...` | same URL | Read-only real-time YouTube dashboard JSON derived from local live logs first, with approved imported `urt_show_live_date` used only as a no-log historical fallback; legacy request-time cache writes are intentionally replaced |
| `/api/api_live_hour.php?date=...` | same URL | Read-only real-time YouTube dashboard hourly JSON derived from `urt_video_live_log`; the incomplete legacy `urt_show_live_hour` cache path is intentionally replaced and no such table is required |
| `/api/api_live_tag_date.php?tagid=...&date=...` | same URL | Real-time YouTube dashboard JSON dashboard cache endpoint from `urt_show_live_tag_date` with direct/wrapped cache-column parsing; cache misses stay empty, and reviewed rebuilds use manual `reports:live-tag-date:build` |
| `/api/live_date.php?tagid=...&date=...` | same URL | Real-time YouTube dashboard filtered live video JSON; `youtube:live:poll` and `reports:live:build` refresh its local log/display sources, while the HTTP request remains read-only |
| `/api/live_tvbs.php?date=...` | same URL | Real-time YouTube dashboard TVBS live log JSON shell |
| `/api/video_live.php?videoId=...` | same URL | Real-time YouTube dashboard HTML snippet for current/max live viewers |
| `/api/csv_live_line.php?videoId=...` | same URL | Real-time YouTube dashboard CSV hourly live trend export |
| `/api/tags_list.php` | same URL | Real-time YouTube dashboard tag id/name JSON from `urt_tag` |
| `/api/tags_index.php` | same URL | Real-time YouTube dashboard keyword index from `tags` with computed weight |
| `/api/tags_all.php` | same URL | Real-time YouTube dashboard `urt_show_data.tags_all` dashboard cache endpoint with direct/wrapped/list-shaped metric payload parsing; empty cache returns unavailable metadata. Manual rebuild is `php artisan reports:keywords:cache --execute`, which writes only `urt_show_data.tags_all` from local DB. |
| `/api/video_tags.php?pk=...` | same URL | Real-time YouTube dashboard video keyword extraction; `urt_show_video_tag` refresh is handled by Laravel ingestion jobs |
| `/api/video_tags_title.php?videoId=...` | same URL | Real-time YouTube dashboard title keyword extraction; `urt_show_video_tag_title` refresh is handled by Laravel ingestion jobs |
| `/api/channels_list.php?tagid=...` | same URL | Real-time YouTube dashboard channel JSON using legacy tag filters |
| `/api/channel_videos.php?u_id=...` | same URL | Real-time YouTube dashboard recent videos for one channel |
| `/api/channels_videos.php?tagid=...` | same URL | Real-time YouTube dashboard recent videos for filtered channel set |
| `/api/api_channel_log.php?u_id=...` | same URL | Real-time YouTube dashboard channel daily trend expansion from `urt_log.thedata` |
| `/api/channel_pred.php?u_id=...` | same URL | Real-time YouTube dashboard channel prediction summary; reviewed `urt_count` prediction refresh uses manual `reports:channel-predictions:build` |
| `/api/api_tag.php` | same URL | Legacy bare tag id/name map from `urt_tag` |
| `/api/api_tag_log.php?tagid=...&or=...&not=...&limit=...` | same URL | Real-time YouTube dashboard tag-filtered aggregation of per-channel `urt_log.thedata` series into daily `count`, `videos`, `orig`, `pred`, and `moving` values; requests without `tagid`, `or`, or `not` preserve the legacy empty-channel selection |
| `/api/tags_day.php?tagid=...` | same URL | Real-time YouTube dashboard `urt_show_tag_cloud` dashboard cache endpoint with map/list/wrapped keyword-weight parsing |
| `/api/tags_video.php?tagid=...` | same URL | Real-time YouTube dashboard `urt_show_tag_cloud` dashboard cache endpoint with map/list/wrapped keyword-weight parsing |
| `/api/tags_relation_date.php?tag=...&date=...` | same URL | Real-time YouTube dashboard `urt_show_video_tag_date` dashboard cache endpoint with map/list/wrapped `tags_json` and `videos_json` payload parsing; reviewed rebuild is manual `reports:keyword-relations:build --keywords=... --from=... --to=... --execute` |
| `/api/tag_month.php?tag=...&month=...` | same URL | Real-time YouTube dashboard `urt_show_tag_month` dashboard cache endpoint with direct/wrapped date-metric payload parsing; reviewed rebuild is manual `reports:tag-month:build --months=... --subjects=... --execute` |
| `/api/tag_period.php?tag=...&days=...` | same URL | Real-time YouTube dashboard period merge from `urt_show_tag_month` with direct/wrapped date-metric payload parsing; cache ownership is the manual tag-month builder |
| `/api/tag_tags_days.php?tag=...&days=...` | same URL | Real-time YouTube dashboard `urt_show_tag_cloud_tag` dashboard cache endpoint with direct/wrapped `tags_result` and `videos_json` parsing; manual cache rebuild is `reports:keyword-cloud:build --keywords=... --days=3,7,30 --execute` |
| `/api/cloud.php?uid=...&days=...` | same URL | Real-time YouTube dashboard channel cloud dashboard cache endpoint from `urt_show_cloud` with map/list/wrapped payload parsing; cache refresh is handled by `reports:channel-cloud:build` |
| `/api/cloud_tag_date.php?tagid=...&date=...` | same URL | Real-time YouTube dashboard `urt_show_tag_date` dashboard cache endpoint with `type` support and map/list/wrapped payload parsing |
| `/api/cloud_tag_date_noapi.php?tagid=...&date=...` | same URL | Real-time YouTube dashboard legacy noapi tag-date cache shell with map/list/wrapped payload parsing |
| `/api/group_view.php?group=...&view=...` | same URL | Real-time YouTube dashboard `urt_show_group` dashboard cache endpoint, with `tag_group` membership shell fallback when the cache table is absent |
| `/api/ai_day.php?date=...&condition=...` | same URL | Real-time YouTube dashboard daily AI JSON from `urt_ai_date` + `urt_channel_ai` |
| `/api/api_topic.php?date=...&condition=...` | same URL | Real-time YouTube dashboard topic/video dashboard cache endpoint or derived topic shell from list or wrapped legacy AI JSON; `urt_ai_date` cache refresh is handled by Laravel AI ingestion jobs |
| `/api/api_event.php?pk=...&event=...` | same URL | Real-time YouTube dashboard event match shell plus `urt_ai_period.result_json` history expansion when period rows exist; `prefetch` keyword generation is handled by Laravel AI/ingestion jobs |
| `/api/api_comment.php?videoId=...` | same URL | Real-time YouTube dashboard comment JSON; comment API logging is handled by Laravel ingestion jobs |
| `/api/api_duration.php?videoId=...` | same URL | Real-time YouTube dashboard plain-text duration lookup; duration queue inserts are handled by Laravel ingestion jobs |
| `/api/api_get_photo.php?tag=...` | same URL | Real-time YouTube dashboard plain-text photo cache lookup; reviewed refresh is manual `reports:photos:build --tags=... --execute` |
| `/redir/{script}.php` | same URL | 403 real-time YouTube dashboard guard for legacy writeback endpoints: add video/live, restore live, renew channel, mutate tags, and AI/channel AI writebacks |
| `/prompt/ai_hour_prompt.php?do=1...` | same URL | 403 real-time YouTube dashboard guard; AI calls and `urt_ai_hour` inserts are routed through `ai:hourly` or `/ai/hours` |
| `/prompt/ai_cont_prompt.php?do=1...` | same URL | 403 real-time YouTube dashboard guard; AI calls and `urt_ai_period` inserts are routed through Laravel AI ingestion jobs |
| `/prompt/ai_event_prompt.php?do=1...` | same URL | 403 real-time YouTube dashboard guard; blocks AI call and `urt_ai_event` insert, use cached `/ai/events/{id}` pages |
| `/prompt/ai_period_prompt.php?...` | same URL | 403 real-time YouTube dashboard guard for raw legacy prompt output; use `/ai/periods` |
| `/live_rank.php?date=YYYY-MM-DD...` | `/live/days/YYYY-MM-DD?...` | 308 redirect |
| `/live_rank.php?from=...&to=...` | `/live/periods?...` | 308 redirect |
| `/live4.php?type=...` | `/live/walls/news?type=...` | 308 redirect |
| `/live5.php?...` | `/live/walls/alternate?...` | 308 redirect |
| `/live_china.php?...` | `/live/walls/china?...` | 308 redirect |
| `/ai_hour.php?...` | `/ai/hours?...` | 308 redirect |
| `/ai_period.php?from=...&to=...` | `/ai/periods?from=...&to=...` | 308 redirect to live period summary |
| `/ai_day.php?date=YYYY-MM-DD&condition=...` | `/ai/days/YYYY-MM-DD/{condition}?...` | 308 redirect |
| `/ai_day_prompt.php?date=YYYY-MM-DD&condition=...` | `/ai/days/YYYY-MM-DD/{condition}/prompt?...` | 308 redirect to AI prompt builder; `/redir/ai_day.php` writeback is replaced by Laravel AI ingestion commands |
| `/day/{date}/{condition}` | `/ai/days/{date}/{condition}` | 308 redirect |
| `/ai_event.php?pk=...&event=...` | `/ai/events/{id}?event=...` | 308 redirect |
| `/ai_event_people.php?pk=...&event=...` | `/ai/events/{id}/people?event=...` | 308 redirect to real-time YouTube dashboard event people/media page |
| `/ai_event_wall.php?pk=...&event=...` | `/ai/events/{id}/wall?event=...` | 308 redirect to real-time YouTube dashboard event video wall |
| `/ai_channel.php?...` | `/ai/aspects?...` | 308 redirect |
| `/ai_tag.php?...` | `/ai/aspects?...` | 308 redirect |
| `/ai_dashboard.php?...` | `/ai/aspects?...` | 308 redirect |
| `/rank.php?tagid=...` | `/tags/{tagId}/channels?...` | 308 redirect |
| `/rank/{tagId}/` | `/tags/{tagId}/channels?...` | 308 redirect |
| `/channel.php?u_id=...` | `/channels/{u_id}` | 308 redirect; also accepts legacy `channel=...` |
| `/channel_videos.php?u_id=...` | `/channels/{u_id}/videos?...` | 308 redirect |
| `/channel_comments.php?u_id=...` | `/channels/{u_id}/comments?...` | 308 redirect to real-time YouTube dashboard channel comment author ranking; queue/fetch refresh is owned by Laravel comment commands |
| `/channel_cloud.php?u_id=...` | `/channels/{u_id}/cloud?...` | 308 redirect to real-time YouTube dashboard channel cloud dashboard data source; cache generation runs through Laravel ingestion jobs |
| `/channel_line.php?u_id=...` | `/channels/{u_id}/trends?...` | 308 redirect to real-time YouTube dashboard `urt_log.thedata` channel trend page; `youtube:channels:stats` owns ongoing statistics/log refresh |
| `/channel_days.php?u_id=...` | `/channels/{u_id}/people?...` | 308 redirect |
| `/channel_date.php?u_id=...&date=YYYY-MM-DD` | `/channels/{u_id}/ai/days/YYYY-MM-DD?...` | 308 redirect |
| `/channel_prompt.php?u_id=...` | `/channels/{u_id}/prompt?...` | 308 redirect to AI prompt builder |
| `/ch/{u_id}/` | `/channels/{u_id}` | 308 redirect |
| `/ch/{u_id}/videos/` | `/channels/{u_id}/videos?...` | 308 redirect |
| `/ch/{u_id}/comments/` | `/channels/{u_id}/comments?...` | 308 redirect to real-time YouTube dashboard channel comment author ranking; queue/fetch refresh is owned by Laravel comment commands |
| `/ch/{u_id}/cloud/` | `/channels/{u_id}/cloud?...` | 308 redirect to real-time YouTube dashboard channel cloud dashboard data source; cache generation runs through Laravel ingestion jobs |
| `/ch/{u_id}/line/` | `/channels/{u_id}/trends?...` | 308 redirect to real-time YouTube dashboard `urt_log.thedata` channel trend page; `youtube:channels:stats` owns ongoing statistics/log refresh |
| `/ch/{u_id}/days/` | `/channels/{u_id}/people?...` | 308 redirect |
| `/ch/{u_id}/date/?date=YYYY-MM-DD` | `/channels/{u_id}/ai/days/YYYY-MM-DD?...` | 308 redirect |
| `/ch/{u_id}/ai/` | `/channels/{u_id}/ai?...` | 308 redirect to live cached GPT/AI overview |
| `/ch/{u_id}/prompt/?date=YYYY-MM-DD` | `/channels/{u_id}/prompt?date=YYYY-MM-DD` | 308 redirect to AI prompt builder |
| `/channel_gpt.php?u_id=...` | `/channels/{u_id}/ai?...` | 308 redirect to live cached GPT/AI overview; also accepts legacy `channel=...` |
| `/dev/check` | Local integration check | YouTube API and AI config probe page |
| `/ops/ingestion` | Scheduler registry dashboard | Real-time YouTube dashboard view of legacy cron to Laravel command mapping, including modern command availability, local one-shot form, and latest run history |
| `POST /ops/ingestion/run` | Scheduler one-shot runner | Rate-limited dry-runs due jobs in every environment; execute requests are accepted only in `local`/`testing` and return 403 in Production. Local/testing web runs store sanitized MariaDB-backed history; public Production web previews are not persisted. Legacy `ingestion-runs/*.json` records remain readable, while Production writes remain owned by reviewed scheduler/CLI commands behind env gates and allowlists. |
| `/ops/ingestion/runs/{runId}` | Scheduler run detail | Real-time YouTube dashboard run history viewer with request metadata, summary counts, and per-job action/exit status from MariaDB-backed history or the legacy JSON read fallback |
| `/ops/ingestion/{jobKey}` | Scheduler job detail | Real-time YouTube dashboard due/next-run preview, write target inventory, command availability, scheduling gates, and the reviewed preview command for every registry job. Manual-only cache/AI maintenance commands have no scheduled execute command and therefore cannot be implicitly allowlisted. |
| `/prompt/{script}.php` | Same legacy URL | 403 real-time YouTube dashboard guard for legacy AI prompt scripts; AI calls, prompt writeback, and `urt_ai_*` inserts are routed through Laravel AI ingestion commands |

Implemented clean URLs:

- `/tags`
- `/tags/{tagId}/channels`
- `/tags/days`
- `/tags/{tagId}/days`
- `/tags/compare`
- `/tags/trends`
- `/tags/{tagId}/trends`
- `/tags/comments`
- `/tags/{tagId}/comments`
- `/comments/authors/{authorKey}`
- `/tags/cloud`
- `/tags/{tagId}/cloud`
- `/tags/{tagId}/videos`
- `/tags/videos`
- `/tags/{tagId}/live/videos`
- `/tags/live/videos`
- `/videos/{videoId}`
- `/videos/{videoId}/analytics`
- `/keywords`
- `/keywords/{keyword}/live/trends`
- `/keywords/{keyword}/groups/trends`
- `/keywords/{keyword}/days`
- `/keywords/{keyword}/cloud`
- `/keywords/{keyword}/videos`
- `/groups`
- `/groups/{groupName}`
- `/groups/{groupName}/live`
- `/groups/{groupName}/ranking`
- `/groups/{groupName}/trends`
- `/mayor`
- `/mayor/cities/{city}`
- `/mayor/cities/{city}/people/{person}`
- `/mayor/cities/{city}/people/{person}/days/{date}`
- `/live/current`
- `/live/continuous`
- `/live/days/{date}`
- `/live/days`
- `/live/groups/{group}/hours`
- `/live/videos/{videoId}/trend`
- `/live/trends/daily`
- `/live/channels`
- `/live/hours`
- `/live/periods`
- `/live/tags`
- `/api/api_live_day.php`
- `/api/api_live_date.php`
- `/api/api_live_hour.php`
- `/api/api_live_tag_date.php`
- `/api/live_date.php`
- `/api/live_tvbs.php`
- `/api/video_live.php`
- `/api/csv_live_line.php`
- `/api/tags_list.php`
- `/api/tags_index.php`
- `/api/tags_all.php`
- `/api/video_tags.php`
- `/api/video_tags_title.php`
- `/api/channels_list.php`
- `/api/channel_videos.php`
- `/api/channels_videos.php`
- `/api/api_channel_log.php`
- `/api/channel_pred.php`
- `/api/api_tag.php`
- `/api/api_tag_log.php`
- `/api/tags_day.php`
- `/api/tags_video.php`
- `/api/tags_relation_date.php`
- `/api/tag_month.php`
- `/api/tag_period.php`
- `/api/tag_tags_days.php`
- `/api/cloud.php`
- `/api/cloud_tag_date.php`
- `/api/cloud_tag_date_noapi.php`
- `/api/group_view.php`
- `/api/ai_day.php`
- `/api/api_topic.php`
- `/api/api_event.php`
- `/api/api_comment.php`
- `/api/api_duration.php`
- `/api/api_get_photo.php`
- `/live/walls/{variant}`
- `/channels/{u_id}`
- `/channels/{u_id}/ai`
- `/channels/{u_id}/videos`
- `/channels/{u_id}/comments`
- `/channels/{u_id}/cloud`
- `/channels/{u_id}/ai/days`
- `/channels/{u_id}/ai/days/{date}`
- `/channels/{u_id}/people`
- `/channels/{u_id}/prompt`
- `/channels/{u_id}/trends`
- `/ops/ingestion`
- `/ops/ingestion/data-capture`
- `/ops/ingestion/report-processing`
- `POST /ops/ingestion/run`
- `/ops/ingestion/runs/{runId}`
- `/ops/ingestion/{jobKey}`
- `/ai/days`
- `/ai/days/prompt`
- `/ai/days/{date}`
- `/ai/hours`
- `/ai/periods`
- `/ai/days/{date}/{condition}`
- `/ai/days/{date}/prompt`
- `/ai/days/{date}/{condition}/prompt`
- `/ai/events/{id}`
- `/ai/events/{id}/people`
- `/ai/events/{id}/wall`
- `/ai/aspects`

## Navigation-Derived Surfaces

Source: `nav_index.php`, `nav_live.php`, `nav_channel.php`, `nav_tag.php`, `nav_group.php`, `nav_keyword.php`, `nav_view.php`, and `nav_media.php`.

| Legacy menu label | Legacy URL | Modern target | Notes |
| --- | --- | --- | --- |
| 關鍵字 | `/tags.php` | `/keywords` | Implemented from local `tags` table. |
| 頻道標籤列表 | `/` | `/tags` | Tag/category index. |
| 逐日標籤 | `/days.php` | `/tags/days`, `/tags/{tagId}/days` | Implemented as real-time YouTube dashboard `urt_show_tag_date` dashboard data source with scalar/list/wrapped payload parsing; cache generation runs through Laravel ingestion jobs, and high-volume tag pages can use `youtube:tag-videos:backfill` to page through all selected channel uploads before rebuilding `urt_show_tag_date`. |
| 逐日關聯標籤 | `/tag_days.php` | `/keywords/{keyword}/days` | Implemented as real-time YouTube dashboard `urt_show_video_tag_date` dashboard data source with scalar/list/wrapped `tags_json` parsing; when relation cache rows are absent, Laravel derives the same shape from `urt_video` + `tags`, and cache rebuilds run through ingestion jobs. |
| 標籤近期留言 | `/comments.php`, `/comments_recent.php` | `/tags/comments`, `/tags/{tagId}/comments` | Implemented as real-time YouTube dashboard recent comment video ranking plus author ranking from `urt_comment`/`authors_json`; supports map/list author JSON. Comment refresh runs through Laravel ingestion jobs. |
| 留言者留言分析 | `/author_comments_bak.php` | `/comments/authors/{authorKey}` | Implemented as a real-time YouTube dashboard author drilldown: fixture-backed parsing works for `urt_comment_author` + `urt_comment_rev` + `urt_comment`, but local comment author/revision tables currently have 0 rows. |
| 標籤文字雲 | `/cloud.php` | `/tags/cloud`, `/tags/{tagId}/cloud` | Implemented as real-time YouTube dashboard `urt_show_tag_cloud` dashboard data source with scalar/weighted/list/wrapped cache payload parsing and legacy differential weighting; cache rebuilds run through Laravel ingestion jobs. |
| 關鍵字文字雲 | `/tag_cloud.php` | `/keywords/{keyword}/cloud` | Implemented as real-time YouTube dashboard `urt_show_tag_cloud_tag` dashboard data source with scalar/weighted/list/wrapped cache payload parsing and legacy differential weighting; default period is seven days, cache misses fall back to derived `urt_video` + `tags` relation data, and reviewed manual rebuilds use the preview-first `reports:keyword-cloud:build` command. |
| 關鍵字影片 | `/tag_video.php` | `/keywords/{keyword}/videos` | Implemented as real-time YouTube dashboard `urt_show_video_tag_date` relation dashboard data source joined to `urt_video`; supports map/list/wrapped `videos_json` payloads. Cache misses fall back to real-time YouTube dashboard `urt_video` title/description matching; reviewed rebuilds use manual `reports:keyword-relations:build`. |
| 關鍵字直播線圖 | `/tag_live.php` | `/keywords/{keyword}/live/trends` | Implemented as real-time YouTube dashboard group comparison from `urt_show_live_tag_date` cache; reviewed cache generation uses manual `reports:live-tag-date:build`. |
| 關鍵字分群趨勢線圖 | `/tag_group.php` | `/keywords/{keyword}/groups/trends` | Implemented as real-time YouTube dashboard group comparison from `urt_show_tag_month.tags_result`; parses direct/wrapped/list-shaped period cache payloads plus `group/group_*.php`, applies legacy 7-day rolling metrics, and uses manual `reports:tag-month:build` for reviewed monthly cache rebuilds. |
| 多關鍵字趨勢比較 | `/tag.php` | `/tags/compare` | Implemented as real-time YouTube dashboard `urt_show_tag_date` JSON trend comparison for legacy `tags=...`; multi-`tagid` mayor links can sum existing single-tag cache rows, render keyword cloud/trend summaries, and derive requested keyword series from local `urt_video` / `urt_count` / `tags` on cache miss without triggering `api/cloud_tag_date.php` generation or writing DB. |
| 標籤趨勢線圖 | `/line.php` | `/tags/trends`, `/tags/{tagId}/trends` | Implemented as real-time YouTube dashboard `urt_show_tag_date` trend dashboard with seven-day moving metrics; cache generation runs through Laravel ingestion jobs. |
| 影片基本資料 / 留言分析 | `/video.php`, `/video_data_att.php` | `/videos/{videoId}`, `/videos/{videoId}/analytics` | Implemented as real-time YouTube dashboard metadata, duration, live log, stat history, and comment analytics. Stats/comment refresh runs through Laravel ingestion jobs. |
| 直播排行榜 | `/live.php?or=1,2,12,13,14,81` | `/live/current?or=1,2,12,13,14,81` | First full vertical slice. |
| 直播靜態輸出 | `/html/live_social.html`, `html/make_live.sh` | `/live/current?or=1,2,12,13,14,81`, `reports:live:static` preview | Legacy static URL redirects to the dynamic real-time dashboard report; scheduler command maps static HTML generation to the Laravel live dashboard route. |
| 每日主要事件 | `/ai_day.php` | `/ai/days` | Implemented as real-time YouTube dashboard daily topic summary from local `urt_ai_date` + `urt_channel_ai`; `all` requires 15-20 topics and other conditions require 8-12. Undersized/oversized or fragmented cache rows trigger a same-day provisional channel fallback check, with fallback capped at the condition maximum instead of the former hard 10-topic limit. The fallback is request-only and can show multi-video single-channel topics; it never replaces `urt_ai_date`, whose persisted topics still require at least two media sources. Parses list plus wrapped `events`/`topics`/`result`/`data` legacy AI JSON variants, including the same `標題`/`議題`/`事件` and English title aliases accepted by ingestion validation. |
| 每日 Prompt | `/ai_day_prompt.php` | `/ai/days/{date}/prompt`, `/ai/days/{date}/{condition}/prompt` | Implemented as AI prompt builder from local `urt_channel_ai`; preserves legacy condition/tag filters, uses shared `all` 15-20 / other 8-12 output bounds, parses wrapped AI JSON variants, and routes AI writeback through Laravel ingestion commands. |
| 今日每小時 | `/ai_hour.php` | `/ai/hours` | Implemented as real-time YouTube dashboard hourly AI summary from local `urt_ai_hour`; defaults to latest imported date for local reconstruction and parses list plus wrapped `events`/`topics` legacy AI JSON variants. |

| 期間主要事件 | `/ai_period.php` | `/ai/periods` | Implemented as real-time YouTube dashboard period table from `urt_ai_date.data_json`/`result_json`, including wrapped legacy AI JSON parsing; cache refresh runs through Laravel AI ingestion jobs. |
| 事件分析 | `/ai_event.php`, `/ai_event_people.php`, `/ai_event_wall.php` | `/ai/events/{id}`, `/ai/events/{id}/people`, `/ai/events/{id}/wall` | Implemented real-time YouTube dashboard summary, people/media, video wall output from `urt_ai_event`, and `urt_ai_period` match-chain history when period rows exist; `ai:event` refreshes `urt_ai_event` summary/people/media rows, `ai:period` refreshes adjacent-day event mapping, and `ai:days:refresh` automates daily/event/period/verify repair flows across one or more dates. |
| 立場分布表 | `/ai_channel.php`, `/ai_tag.php`, `/ai_dashboard.php` | `/ai/aspects` | Implemented from latest `urt_channel_ai` aspect JSON, with tag filters, condition shortcuts, and grouped or wrapped/flat aspect payload parsing. |
| 個人社論 | `/rank.php?tagid=1&not=2,9,10,12,13,33,36,81` | `/tags/1/channels?...` | Implemented with query compatibility. |
| 新聞集團 | `/html/group_chart.html`, `html/make_html.sh` | `/groups/media/ranking?days=7`, `reports:static:build` preview | Implemented as real-time YouTube dashboard group ranking from `urt_show_tag_date`; static group chart generation is mapped through the scheduler registry to dynamic Laravel routes. |
| 兩岸立場 | `/group_two.php` | `/groups/two/trends`, `/groups/two_all/trends` | Implemented as real-time YouTube dashboard Taiwan-vs-China position trend from `urt_show_tag_date`; default legacy route compares `tagid=9,48` vs `tagid=9,49`, and `all=1` preserves the expanded legacy group set with tag-date cache refresh routed through Laravel ingestion jobs. |
| Group membership | `/group_view.php`, `/group_people.php`, `/group_tag.php` | `/groups/{groupName}` | Implemented as live membership from `tag_group` or legacy configured `tags_*` groups; `api/group_view.php` exposes a real-time YouTube dashboard JSON shell and group refresh flows through Laravel ingestion jobs. |
| Group ranking | `/group_chart.php` | `/groups/{groupName}/ranking` | Implemented as real-time YouTube dashboard aggregate from `urt_show_tag_date`; tag-date cache refresh runs through Laravel ingestion jobs. |
| Group daily trend | `/group_line.php` | `/groups/{groupName}/trends` | Implemented as real-time YouTube dashboard rolling daily trend from `urt_show_tag_date`; cache generation runs through Laravel ingestion jobs. |
| Group live trend | `/group_live.php` | `/groups/{groupName}/live` | Implemented as real-time YouTube dashboard daily max plus seven-day rolling live trend from `urt_show_live_tag_date.tags_views` / `tags_video`; reviewed cache generation uses manual `reports:live-tag-date:build`. |
| 2026縣市長已提名／已表態人選 | `/mayor/html_*.html`, `/mayor/city.php`, `mayor/make_mayor.sh` | `/mayor/cities/{city}`, `reports:mayor:static` preview | Implemented as real-time YouTube dashboard support trend from `urt_show_tag_date` with a curated 22-county/city 2026 candidate list updated 2026-05-28; cache generation runs through Laravel ingestion jobs and static output is mapped to dynamic routes. |
| 現在正直播排行 | `/live.php` | `/live/current` | Current live streams. |
| 現在帶狀直播排行 | `/live_cont.php` | `/live/continuous` | Active streams older than the continuous-live `hours` threshold. |
| 單日直播排行 | `/live_day.php` | `/live/days/{date}` | Historical live daily ranking. |
| 直播趨勢 | `/live_day_line.php` | `/live/trends/daily` | Chart/report page. |
| 群組每小時直播人數 | `/lives_date.php` | `/live/groups/{group}/hours` | Implemented as real-time YouTube dashboard hourly matrix from `urt_show_live_tag_date.hour_result`; reviewed cache generation uses manual `reports:live-tag-date:build`. |
| 直播頻道排行 | `/live_channels.php` | `/live/channels` | Channel aggregate over date range or recent days. |
| 直播影片排行 | `/live_channel.php`, `/live_videos.php` | `/live/days/{date}`, `/live/periods` | Compatibility redirects to the video-ranking surfaces that use `urt_video_live_log` + `urt_show_video_live`; cache generation runs through Laravel ingestion jobs or polling. |
| 小時熱度 | `/live_hour.php` | `/live/hours` | Hourly heatmap by date from `urt_show_live_tag_date.hour_result` when cache exists, with raw live-log fallback; reviewed cache generation uses manual `reports:live-tag-date:build`. |
| 期間直播排行 | `/live_period.php` | `/live/periods` | Period/range video ranking backed by the same data as single-day live ranking. |
| 直播標籤 | `/live_tag.php` | `/live/tags` | Implemented as real-time dashboard report from `urt_show_live_tag_date` cache with direct/wrapped `tags_views` / `tags_video` parsing; reviewed cache regeneration uses manual `reports:live-tag-date:build`. |
| Live chart/API data | `/api/api_live_day.php`, `/api/api_live_date.php`, `/api/api_live_hour.php`, `/api/api_live_tag_date.php`, `/api/live_date.php`, `/api/live_tvbs.php`, `/api/video_live.php`, `/api/csv_live_line.php` | same legacy URLs | Implemented as real-time YouTube dashboard compatibility endpoints. Live date/hour request-time cache writes are intentionally replaced by read-only live-log derivation; live tag-date cache columns accept direct/wrapped payloads, and their misses are handled by explicit `reports:live-tag-date:build`. |
| Tag/channel JSON APIs | `/api/tags_list.php`, `/api/tags_index.php`, `/api/tags_all.php`, `/api/video_tags.php`, `/api/video_tags_title.php`, `/api/channels_list.php`, `/api/channel_videos.php`, `/api/channels_videos.php` | same legacy URLs | Implemented as real-time YouTube dashboard compatibility endpoints; `tags_all` accepts direct/wrapped/list-shaped metric payloads. Legacy writeback is replaced by `reports:keywords:cache --execute`, which provides an explicit one-shot local DB rebuild for the derived `urt_show_data.tags_all` row. |
| Channel report APIs | `/api/api_channel_log.php`, `/api/channel_pred.php` | same legacy URLs | Implemented as real-time YouTube dashboard `urt_log.thedata` expansion; reviewed prediction refresh uses manual `reports:channel-predictions:build`. |
| Tag chart/cache APIs | `/api/api_tag.php`, `/api/api_tag_log.php`, `/api/tags_day.php`, `/api/tags_video.php`, `/api/tags_relation_date.php`, `/api/tag_month.php`, `/api/tag_period.php`, `/api/tag_tags_days.php` | same legacy URLs | Implemented as live cache/API endpoints; tag cloud, relation-date, month/period, and tag-tags-days JSON accept direct or wrapped payloads. Manual `reports:keyword-relations:build`, `reports:tag-month:build`, and `reports:keyword-cloud:build` own the reviewed relation, month, and keyword-cloud rebuilds; these commands are intentionally unscheduled. |
| Cloud/group JSON APIs | `/api/cloud.php`, `/api/cloud_tag_date.php`, `/api/cloud_tag_date_noapi.php`, `/api/group_view.php` | same legacy URLs | Implemented as live cache/API endpoints with map/list/wrapped cloud payload parsing; `group_view` falls back to `tag_group` membership when `urt_show_group` is absent locally. |
| AI/event/comment APIs | `/api/ai_day.php`, `/api/api_topic.php`, `/api/api_event.php`, `/api/api_comment.php` | same legacy URLs | Implemented as real-time YouTube dashboard AI/comment endpoints; topic cache refresh and comment API logging run through Laravel ingestion jobs. |
| Misc media APIs | `/api/api_duration.php`, `/api/api_get_photo.php`, `maint/get_duration.php`, `maint/get_video_count.php` | same legacy URLs, `youtube:videos:duration` preview plus scheduled/local `--execute`, `youtube:videos:stats` preview plus scheduled/local `--execute`, manual `reports:photos:build` | Plain-text endpoints are real-time YouTube dashboard. The duration queue processor is previewed through `/ops/ingestion/youtube.videos.duration` and can execute `videos.list(contentDetails)` updates to `urt_video_duration`; explicit/scheduled `--enqueue-missing` can create queue rows from existing local `urt_video` rows to mirror `api/api_duration.php` queue insertion and support production backfill. The video statistics refresh queue is previewed through `/ops/ingestion/youtube.videos.stats` and supports capped scheduled/local `--execute` for `videos.list(statistics)`. Photo cache preview derives capped subjects from local `tags` or `--tags`; explicit `reports:photos:build --execute` uses the zh.wikipedia.org pageimages API, bounded retry/timeout, Wikimedia HTTPS URL validation, a lock, and per-tag failure isolation before idempotently writing `urt_show_photo`. It is intentionally unscheduled. |
| 同時四窗直播 | `/live4.php`, `/live5.php`, `/live_china.php` | `/live/walls/{variant}` | Implemented as real-time YouTube dashboard static live wall from legacy hard-coded stream IDs. |
| 頻道基本資料 | `/channel.php`, `/ch/{u_id}/` | `/channels/{u_id}` | Implemented with basic stats, tags, and limited channel AI excerpts, including wrapped daily AI payload parsing. |
| 頻道每日重點整理(AI) | `/channel_date.php`, `/ch/{u_id}/date/` | `/channels/{u_id}/ai/days`, `/channels/{u_id}/ai/days/{date}` | Implemented from `channel_date.php` using real-time YouTube dashboard local `urt_channel_ai`; preserves `date` and `type=week`, and parses list plus wrapped `events`/`topics` legacy AI JSON variants. |
| 頻道影片 | `/channel_videos.php`, `/ch/{u_id}/videos/` | `/channels/{u_id}/videos` | Implemented from local `urt_video` with optional comment summary fields. |
| 頻道留言 | `/channel_comments.php`, `/ch/{u_id}/comments/` | `/channels/{u_id}/comments` | Implemented as real-time YouTube dashboard author ranking over recent channel videos using `urt_video` and `urt_comment.authors_json`; supports map/list author JSON and JSON-derived source-video counts. Comment refresh runs through Laravel ingestion jobs. |
| 頻道文字雲 | `/channel_cloud.php`, `/ch/{u_id}/cloud/` | `/channels/{u_id}/cloud` | Implemented as real-time YouTube dashboard `urt_show_cloud` dashboard data source with scalar/weighted/list/wrapped cache payload parsing and differential weighting; cache rebuilds run through `reports:channel-cloud:build` from local `urt_video`/`tags`. |
| 頻道線圖 | `/channel_line.php`, `/ch/{u_id}/line/` | `/channels/{u_id}/trends` | Implemented as real-time YouTube dashboard `urt_log.thedata` trend page with moving/orig/each/videos modes; polling runs through Laravel ingestion jobs. |
| 頻道人物 | `/channel_days.php`, `/ch/{u_id}/days/` | `/channels/{u_id}/people` | Implemented from local `urt_channel_ai` `oneday` JSON by aggregating people over the latest imported period; parses list plus wrapped `events`/`topics` legacy AI JSON variants. |
| 頻道 Prompt | `/channel_prompt.php`, `/ch/{u_id}/prompt/` | `/channels/{u_id}/prompt` | Implemented as AI prompt builder from local `urt_video`; channel AI writeback runs through Laravel AI ingestion commands. |
| 頻道 GPT Prompt / AI 結果 | `/channel_gpt.php`, `/maint/get_channel_openai.php`, `/ch/{u_id}/ai/` | `/channels/{u_id}/ai` | Implemented as live cached `topic`/`people`/`aspect` output from local `urt_channel_ai`, with the legacy manual GPT prompt preview; AI generation runs through Laravel AI ingestion commands. |

## Include-Only Helpers

| Legacy helper | Modern usage | Notes |
| --- | --- | --- |
| `stopwords.php` | `App\Services\Legacy\LegacyStopwords` | Parsed from the legacy ground-truth path and shared by keyword list, tag cloud, channel cloud, daily tag relation, and live tag pages. There is no public route because the legacy file only populates a PHP array for include callers. |
| `nav_media.php` | Existing group/media links | Include-only menu that points at `/html/group_chart.html`, `/html/group_chart_30.html`, and `/html/group_line.html`; those static URLs already redirect to `/groups/media/ranking` or `/groups/media/trends`. |

Full parity backlog: `docs/legacy-inventory/feature-parity.md`.

## Public Pages Observed

- Public fetch attempts for `https://youtube.board.tw/`, `/live.php?...`, `/ai_day.php`, and `/tags.php` returned `403` from this development environment on 2026-05-24.
- Use legacy source files as primary behavior evidence until public pages can be observed through an approved browser session or another route.
