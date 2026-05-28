# Legacy Route Inventory

## Apache Rewrites

Source: `/Users/sky/Documents/youtube-board-legacy/vh-board.conf`

| Legacy URL | Legacy target | Modern target |
| --- | --- | --- |
| `/ch/{channelId}/` | `/channel.php?u_id={channelId}` | `/channels/{channelId}` |
| `/ch/{channelId}/{section}/` | `/channel_{section}.php?u_id={channelId}` | `/channels/{channelId}/{section}` |
| `/ch/{channelId}/{section}/{query}` | `/channel_{section}.php?u_id={channelId}&{query}` | `/channels/{channelId}/{section}?{query}` |
| `/rank/{tagId}/` | `/rank.php?tagid={tagId}` | `/tags/{tagId}/channels` |
| `/day/{date}/{condition}` | `/ai_day.php?date={date}&condition={condition}` | `/ai/days/{date}/{condition}` |

## Initial Compatibility

Implemented now:

Compatibility coverage is guarded by `tests/Feature/LegacySurfaceInventoryTest.php`, which reads the local legacy snapshot and verifies that all top-level public PHP files are either routed or documented as include-only helpers, every `urtube/api/*.php` file has a read-only route, and every `redir` / `prompt` PHP file returns the Laravel read-only guard.

| Legacy URL | Modern URL | Status |
| --- | --- | --- |
| `/` | `/` | Read-only tag/category index |
| `/index.php?...` | `/?...` | 308 redirect to read-only tag/category index |
| `/tags` | `/tags` | Same tag/category index |
| `/tags.php?...` | `/keywords?...` | 308 redirect |
| `/days.php?tagid=...` | `/tags/{tagId}/days?...` | 308 redirect to read-only cache viewer; no cache generation |
| `/tag_days.php?tag=...` | `/keywords/{keyword}/days?...` | 308 redirect to read-only cache viewer; no cache generation |
| `/comments.php?tagid=...` | `/tags/{tagId}/comments?...` | 308 redirect to read-only recent comment videos + author ranking; no comment ingestion |
| `/comments_recent.php?tagid=...` | `/tags/{tagId}/comments?...` | 308 redirect to read-only recent comment videos + author ranking; no comment ingestion |
| `/author_comments_bak.php?author_id=...` | `/comments/authors/{authorId}?...` | 308 redirect to read-only author comment analysis; no comment ingestion |
| `/author_comments_bak.php?ChannelId=...` | `/comments/authors/{ChannelId}?lookup=ChannelId...` | 308 redirect to read-only author comment analysis; no comment ingestion |
| `/cloud.php?tagid=...` | `/tags/{tagId}/cloud?...` | 308 redirect to read-only tag cloud cache viewer; no cache generation |
| `/tag_cloud.php?tag=...` | `/keywords/{keyword}/cloud?...` | 308 redirect to read-only keyword cloud cache viewer; no cache generation |
| `/tag_video.php?tag=...` | `/keywords/{keyword}/videos?...` | 308 redirect to read-only keyword video cache viewer; no relation cache generation |
| `/tag_live.php?tag=...` | `/keywords/{keyword}/live/trends?...` | 308 redirect to read-only keyword live group trend; no cache generation |
| `/tag.php?tags=...` | `/tags/compare?...` | 308 redirect to read-only multi-keyword trend comparison; no cache generation |
| `/line.php?tagid=...` | `/tags/{tagId}/trends?...` | 308 redirect to read-only `urt_show_tag_date` trend viewer; no cache generation |
| `/tag_group.php?tag=...` | `/keywords/{keyword}/groups/trends?...` | 308 redirect to read-only keyword group trend from `urt_show_tag_month`; no `api/tag_period.php` generation and no `urt_log_tag` write |
| `/group_view.php?group=...` | `/groups/{groupName}?...` | 308 redirect to read-only group membership |
| `/group_people.php?group=...` | `/groups/{groupName}?...` | 308 redirect to read-only group membership |
| `/group_tag.php?group=...` | `/groups/{groupName}?...` | 308 redirect to read-only group membership |
| `/group_live.php?group=...` | `/groups/{groupName}/live?...` | 308 redirect to read-only group live trend from `urt_show_live_tag_date`; no `api_live_tag_date.php` generation |
| `/group_two.php` | `/groups/two/trends` | 308 redirect to read-only Taiwan-vs-China position trend; `all=1` maps to `/groups/two_all/trends` |
| `/group_chart.php?group=...` | `/groups/{groupName}/ranking?...` | 308 redirect to read-only group aggregate from `urt_show_tag_date`; no cache generation |
| `/group_line.php?group=...` | `/groups/{groupName}/trends?...` | 308 redirect to read-only group daily trend from `urt_show_tag_date`; no cache generation |
| `/mayor/city.php?city=...` | `/mayor/cities/{city}?...` | 308 redirect to read-only mayor candidate support report; no `api/cloud_tag_date.php` generation |
| `/mayor/{city}.php?...` | `/mayor/cities/{city}?...` | 308 redirect for legacy city config entrypoints such as `/mayor/taipei.php`; no cache generation |
| `/mayor/html_{city}.html?...` | `/mayor/cities/{city}?...` | 308 redirect to dynamic read-only mayor report; static HTML output is previewed by `reports:mayor:static` and not written |
| `/html/group_chart.html` | `/groups/media/ranking?days=7` | 308 redirect to dynamic read-only group ranking used by the legacy 7-day static output |
| `/html/group_chart_30.html` | `/groups/media/ranking?days=30` | 308 redirect to dynamic read-only group ranking used by `html/make_html.sh` |
| `/html/group_chart_all.html` | `/groups/media_all/ranking?days=30` | 308 redirect to dynamic read-only all-media group ranking used by `html/make_html.sh` |
| `/html/group_line.html` | `/groups/media/trends?days=30` | 308 redirect to dynamic read-only group trend used by `html/make_html.sh` |
| `/html/live_social.html?...` | `/live/current?or=1,2,12,13,14,81...` | 308 redirect to the dynamic read-only live social ranking used by `reports:live:static`; static HTML output is not written |
| `/videos.php?tagid=...` | `/tags/{tagId}/videos?...` | 308 redirect |
| `/live_videos.php?date=YYYY-MM-DD...` | `/live/days/YYYY-MM-DD?...` | 308 redirect to the legacy video-ranking surface; preserves `tagid`, `or`, `not`, `limit`, and other filters |
| `/live_videos.php?from=YYYY-MM-DD&to=YYYY-MM-DD...` | `/live/periods?...` | 308 redirect to the period video-ranking surface |
| `/video.php?videoId=...` | `/videos/{videoId}?...` | 308 redirect to read-only video metadata and live summary |
| `/video_data_att.php?videoId=...` | `/videos/{videoId}/analytics?...` | 308 redirect to read-only video/comment analytics |
| `/video_data.php?videoId=...` | `/videos/{videoId}/analytics?...` | 308 redirect for legacy stale link emitted by `video.php` |
| `/live.php?...` | `/live/current?...` | 308 redirect |
| `/live_index.php?...` | `/live/current?...` | 308 redirect |
| `/live_cont.php?...` | `/live/continuous?...` | 308 redirect |
| `/live_day.php?date=YYYY-MM-DD...` | `/live/days/YYYY-MM-DD?...` | 308 redirect |
| `/live_line.php?videoId=...` | `/live/videos/{videoId}/trend?...` | 308 redirect; defaults to legacy `oka2UDaeFZw` when `videoId` is omitted |
| `/live_day_line.php?...` | `/live/trends/daily?...` | 308 redirect |
| `/lives_date.php?group=...&date=...` | `/live/groups/{group}/hours?date=...` | 308 redirect to read-only group hourly matrix from `urt_show_live_tag_date.hour_result`; no cache generation |
| `/live_channels.php?...` | `/live/channels?...` | 308 redirect |
| `/live_channel.php?date=...` | `/live/days/{date}?...` | 308 redirect to read-only live video ranking |
| `/live_channel.php?from=...&to=...` | `/live/periods?...` | 308 redirect to read-only period live video ranking |
| `/live_hour.php?...` | `/live/hours?...` | 308 redirect to a read-only hourly heatmap; prefers `urt_show_live_tag_date.hour_result` cache and falls back to raw live logs without cache generation |
| `/live_period.php?...` | `/live/periods?...` | 308 redirect |
| `/live_tag.php?...` | `/live/tags?...` | 308 redirect |
| `/api/api_live_day.php?videoId=...` | same URL | Read-only JSON from `urt_video_live_log`; no writes |
| `/api/api_live_date.php?date=...` | same URL | Read-only JSON cache/derived response; no cache generation |
| `/api/api_live_hour.php?date=...` | same URL | Read-only hourly JSON derived from `urt_video_live_log` |
| `/api/api_live_tag_date.php?tagid=...&date=...` | same URL | Read-only JSON cache reader from `urt_show_live_tag_date` with direct/wrapped cache-column parsing; cache misses stay empty |
| `/api/live_date.php?tagid=...&date=...` | same URL | Read-only filtered live video JSON; no cache generation |
| `/api/live_tvbs.php?date=...` | same URL | Read-only TVBS live log JSON shell |
| `/api/video_live.php?videoId=...` | same URL | Read-only HTML snippet for current/max live viewers |
| `/api/csv_live_line.php?videoId=...` | same URL | Read-only CSV hourly live trend export |
| `/api/tags_list.php` | same URL | Read-only tag id/name JSON from `urt_tag` |
| `/api/tags_index.php` | same URL | Read-only keyword index from `tags` with computed weight |
| `/api/tags_all.php` | same URL | Read-only `urt_show_data.tags_all` cache reader with direct/wrapped/list-shaped metric payload parsing; empty cache returns unavailable metadata. Manual rebuild is `php artisan reports:keywords:cache --execute`, which writes only `urt_show_data.tags_all` from local DB. |
| `/api/video_tags.php?pk=...` | same URL | Read-only video keyword extraction; no `urt_show_video_tag` writeback |
| `/api/video_tags_title.php?videoId=...` | same URL | Read-only title keyword extraction; no `urt_show_video_tag_title` writeback |
| `/api/channels_list.php?tagid=...` | same URL | Read-only channel JSON using legacy tag filters |
| `/api/channel_videos.php?u_id=...` | same URL | Read-only recent videos for one channel |
| `/api/channels_videos.php?tagid=...` | same URL | Read-only recent videos for filtered channel set |
| `/api/api_channel_log.php?u_id=...` | same URL | Read-only channel daily trend expansion from `urt_log.thedata` |
| `/api/channel_pred.php?u_id=...` | same URL | Read-only channel prediction summary; no `urt_count` writeback |
| `/api/api_tag.php` | same URL | Legacy bare tag id/name map from `urt_tag` |
| `/api/api_tag_log.php?tag=...` | same URL | Read-only `urt_log_tag` aggregate; local dump currently empty |
| `/api/tags_day.php?tagid=...` | same URL | Read-only `urt_show_tag_cloud` cache reader with map/list/wrapped keyword-weight parsing |
| `/api/tags_video.php?tagid=...` | same URL | Read-only `urt_show_tag_cloud` cache reader with map/list/wrapped keyword-weight parsing |
| `/api/tags_relation_date.php?tag=...&date=...` | same URL | Read-only `urt_show_video_tag_date` cache reader with map/list/wrapped `tags_json` and `videos_json` payload parsing |
| `/api/tag_month.php?tag=...&month=...` | same URL | Read-only `urt_show_tag_month` cache reader with direct/wrapped date-metric payload parsing |
| `/api/tag_period.php?tag=...&days=...` | same URL | Read-only period merge from `urt_show_tag_month` with direct/wrapped date-metric payload parsing |
| `/api/tag_tags_days.php?tag=...&days=...` | same URL | Read-only `urt_show_tag_cloud_tag` cache reader with direct/wrapped `tags_result` and `videos_json` parsing |
| `/api/cloud.php?uid=...&days=...` | same URL | Read-only channel cloud cache reader from `urt_show_cloud` with map/list/wrapped payload parsing; no cache writeback |
| `/api/cloud_tag_date.php?tagid=...&date=...` | same URL | Read-only `urt_show_tag_date` cache reader with `type` support and map/list/wrapped payload parsing |
| `/api/cloud_tag_date_noapi.php?tagid=...&date=...` | same URL | Read-only legacy noapi tag-date cache shell with map/list/wrapped payload parsing |
| `/api/group_view.php?group=...&view=...` | same URL | Read-only `urt_show_group` cache reader, with `tag_group` membership shell fallback when the cache table is absent |
| `/api/ai_day.php?date=...&condition=...` | same URL | Read-only daily AI JSON from `urt_ai_date` + `urt_channel_ai` |
| `/api/api_topic.php?date=...&condition=...` | same URL | Read-only topic/video cache reader or derived topic shell from list or wrapped legacy AI JSON; no `urt_ai_date` cache writeback |
| `/api/api_event.php?pk=...&event=...` | same URL | Read-only event match shell plus `urt_ai_period.result_json` history expansion when period rows exist; `prefetch` keyword generation remains disabled |
| `/api/api_comment.php?videoId=...` | same URL | Read-only comment JSON; no `urt_log_api` insert |
| `/api/api_duration.php?videoId=...` | same URL | Read-only plain-text duration lookup; no `urt_video_duration` insert on miss |
| `/api/api_get_photo.php?tag=...` | same URL | Read-only plain-text photo cache lookup; no Wikipedia fetch or `urt_show_photo` insert on miss |
| `/redir/{script}.php` | same URL | 403 read-only guard for legacy writeback endpoints: add video/live, restore live, renew channel, mutate tags, and AI/channel AI writebacks |
| `/prompt/ai_hour_prompt.php?do=1...` | same URL | 403 read-only guard; blocks AI call and `urt_ai_hour` insert, use `ai:hourly` preview or `/ai/hours` |
| `/prompt/ai_cont_prompt.php?do=1...` | same URL | 403 read-only guard; blocks AI call and `urt_ai_period` insert, use `/ai/periods` |
| `/prompt/ai_event_prompt.php?do=1...` | same URL | 403 read-only guard; blocks AI call and `urt_ai_event` insert, use cached `/ai/events/{id}` pages |
| `/prompt/ai_period_prompt.php?...` | same URL | 403 read-only guard for raw legacy prompt output; use `/ai/periods` |
| `/live_rank.php?date=YYYY-MM-DD...` | `/live/days/YYYY-MM-DD?...` | 308 redirect |
| `/live_rank.php?from=...&to=...` | `/live/periods?...` | 308 redirect |
| `/live4.php?type=...` | `/live/walls/news?type=...` | 308 redirect |
| `/live5.php?...` | `/live/walls/alternate?...` | 308 redirect |
| `/live_china.php?...` | `/live/walls/china?...` | 308 redirect |
| `/ai_hour.php?...` | `/ai/hours?...` | 308 redirect |
| `/ai_period.php?from=...&to=...` | `/ai/periods?from=...&to=...` | 308 redirect to read-only period summary |
| `/ai_day.php?date=YYYY-MM-DD&condition=...` | `/ai/days/YYYY-MM-DD/{condition}?...` | 308 redirect |
| `/ai_day_prompt.php?date=YYYY-MM-DD&condition=...` | `/ai/days/YYYY-MM-DD/{condition}/prompt?...` | 308 redirect to read-only prompt preview; no `/redir/ai_day.php` writeback |
| `/day/{date}/{condition}` | `/ai/days/{date}/{condition}` | 308 redirect |
| `/ai_event.php?pk=...&event=...` | `/ai/events/{pk}?event=...` | 308 redirect |
| `/ai_event_people.php?pk=...&event=...` | `/ai/events/{pk}/people?event=...` | 308 redirect to read-only event people/media page |
| `/ai_event_wall.php?pk=...&event=...` | `/ai/events/{pk}/wall?event=...` | 308 redirect to read-only event video wall |
| `/ai_channel.php?...` | `/ai/aspects?...` | 308 redirect |
| `/ai_tag.php?...` | `/ai/aspects?...` | 308 redirect |
| `/ai_dashboard.php?...` | `/ai/aspects?...` | 308 redirect |
| `/rank.php?tagid=...` | `/tags/{tagId}/channels?...` | 308 redirect |
| `/rank/{tagId}/` | `/tags/{tagId}/channels?...` | 308 redirect |
| `/channel.php?u_id=...` | `/channels/{u_id}` | 308 redirect; also accepts legacy `channel=...` |
| `/channel_videos.php?u_id=...` | `/channels/{u_id}/videos?...` | 308 redirect |
| `/channel_comments.php?u_id=...` | `/channels/{u_id}/comments?...` | 308 redirect to read-only channel comment author ranking; no comment ingestion |
| `/channel_cloud.php?u_id=...` | `/channels/{u_id}/cloud?...` | 308 redirect to read-only channel cloud cache viewer; no cache generation |
| `/channel_line.php?u_id=...` | `/channels/{u_id}/trends?...` | 308 redirect to read-only `urt_log.thedata` channel trend page; no polling |
| `/channel_days.php?u_id=...` | `/channels/{u_id}/people?...` | 308 redirect |
| `/channel_date.php?u_id=...&date=YYYY-MM-DD` | `/channels/{u_id}/ai/days/YYYY-MM-DD?...` | 308 redirect |
| `/channel_prompt.php?u_id=...` | `/channels/{u_id}/prompt?...` | 308 redirect to read-only prompt preview |
| `/ch/{u_id}/` | `/channels/{u_id}` | 308 redirect |
| `/ch/{u_id}/videos/` | `/channels/{u_id}/videos?...` | 308 redirect |
| `/ch/{u_id}/comments/` | `/channels/{u_id}/comments?...` | 308 redirect to read-only channel comment author ranking; no comment ingestion |
| `/ch/{u_id}/cloud/` | `/channels/{u_id}/cloud?...` | 308 redirect to read-only channel cloud cache viewer; no cache generation |
| `/ch/{u_id}/line/` | `/channels/{u_id}/trends?...` | 308 redirect to read-only `urt_log.thedata` channel trend page; no polling |
| `/ch/{u_id}/days/` | `/channels/{u_id}/people?...` | 308 redirect |
| `/ch/{u_id}/date/?date=YYYY-MM-DD` | `/channels/{u_id}/ai/days/YYYY-MM-DD?...` | 308 redirect |
| `/ch/{u_id}/ai/` | `/channels/{u_id}/ai?...` | 308 redirect to read-only cached GPT/AI overview |
| `/ch/{u_id}/prompt/?date=YYYY-MM-DD` | `/channels/{u_id}/prompt?date=YYYY-MM-DD` | 308 redirect to read-only prompt preview |
| `/channel_gpt.php?u_id=...` | `/channels/{u_id}/ai?...` | 308 redirect to read-only cached GPT/AI overview; also accepts legacy `channel=...` |
| `/dev/check` | Local integration check | YouTube API and AI config probe page |
| `/ops/ingestion` | Scheduler registry dashboard | Read-only view of legacy cron to Laravel command mapping, including modern command availability, local one-shot form, and latest run history |
| `POST /ops/ingestion/run` | Scheduler one-shot runner | Executes or dry-runs due read-only preview jobs locally, temporarily enabling the runner only for that request; stores JSON history under Laravel local storage `ingestion-runs/*.json`. Scheduled CLI runs can write the same local history with `php artisan ingestion:run --record`; when enabled, Laravel scheduler calls `ingestion:run --execute --record`. |
| `/ops/ingestion/runs/{runId}` | Scheduler run detail | Read-only local run history viewer with request metadata, summary counts, and per-job action/exit status from `storage/app/private/ingestion-runs/*.json` |
| `/ops/ingestion/{jobKey}` | Scheduler job detail | Read-only due/next-run preview, write target inventory, and execution guardrail for one registry job; `youtube.channels.stats`, `youtube.channels.videos.general`, `youtube.channels.videos.live`, `youtube.channels.videos.live_group`, `youtube.tvbs.videos`, `youtube.live.poll`, `youtube.tvbs.live.poll`, `youtube.live.cleanup`, `youtube.videos.duration`, `youtube.videos.stats`, `youtube.comments.queue`, `youtube.comments.fetch`, `ai.daily`, `ai.hourly`, `reports.live.build`, `reports.live.clean`, `reports.live.static`, `reports.static.html`, `reports.mayor.static`, `reports.counts.build`, `reports.groups.build`, `reports.keywords.build`, `reports.people.build`, and `reports.schedule.build` show local preview commands |
| `/prompt/{script}.php` | Same legacy URL | 403 read-only guard for legacy AI prompt scripts; no AI call, no prompt writeback, no `urt_ai_*` insert |

Planned clean URLs:

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
- `/tags/{tagId}/live/videos`
- `/videos/{videoId}`
- `/videos/{videoId}/analytics`
- `/keywords`
- `/keywords/{keyword}/live/trends`
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
- `/live/current`
- `/live/continuous`
- `/live/days/{date}`
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
- `/channels/{channelId}`
- `/channels/{channelId}/ai`
- `/channels/{channelId}/videos`
- `/channels/{channelId}/comments`
- `/channels/{channelId}/cloud`
- `/channels/{channelId}/ai/days`
- `/channels/{channelId}/ai/days/{date}`
- `/channels/{channelId}/people`
- `/channels/{channelId}/prompt`
- `/channels/{channelId}/trends`
- `/ops/ingestion`
- `POST /ops/ingestion/run`
- `/ops/ingestion/{jobKey}`
- `/ai/days`
- `/ai/days/{date}`
- `/ai/hours`
- `/ai/periods`
- `/ai/days/{date}/{condition}`
- `/ai/days/{date}/prompt`
- `/ai/days/{date}/{condition}/prompt`
- `/ai/events/{pk}`
- `/ai/events/{pk}/people`
- `/ai/events/{pk}/wall`
- `/ai/aspects`

## Navigation-Derived Surfaces

Source: `nav_index.php`, `nav_live.php`, `nav_channel.php`, `nav_tag.php`, `nav_group.php`, `nav_keyword.php`, `nav_view.php`, and `nav_media.php`.

| Legacy menu label | Legacy URL | Modern target | Notes |
| --- | --- | --- | --- |
| 關鍵字 | `/tags.php` | `/keywords` | Implemented from local `tags` table. |
| 頻道標籤列表 | `/` | `/tags` | Tag/category index. |
| 逐日標籤 | `/days.php` | `/tags/days`, `/tags/{tagId}/days` | Implemented as read-only `urt_show_tag_date` cache viewer with scalar/list/wrapped payload parsing; local cache currently has 0 rows, so no legacy cache generation is triggered. |
| 逐日關聯標籤 | `/tag_days.php` | `/keywords/{keyword}/days` | Implemented as read-only `urt_show_video_tag_date` cache viewer with scalar/list/wrapped `tags_json` parsing; when relation cache rows are absent, Laravel derives the same shape from `urt_video` + `tags` without writing cache rows or triggering legacy generation. |
| 標籤近期留言 | `/comments.php`, `/comments_recent.php` | `/tags/comments`, `/tags/{tagId}/comments` | Implemented as read-only recent comment video ranking plus author ranking from `urt_comment`/`authors_json`; supports map/list author JSON. Local `urt_comment` has 0 rows, so production-like calls show unavailable and omit `/maint/get_comment.php`. |
| 留言者留言分析 | `/author_comments_bak.php` | `/comments/authors/{authorKey}` | Implemented as a read-only author drilldown: fixture-backed parsing works for `urt_comment_author` + `urt_comment_rev` + `urt_comment`, but local comment author/revision tables currently have 0 rows. |
| 標籤文字雲 | `/cloud.php` | `/tags/cloud`, `/tags/{tagId}/cloud` | Implemented as read-only `urt_show_tag_cloud` cache viewer with scalar/weighted/list/wrapped cache payload parsing and legacy differential weighting; local cache currently has 0 rows, so production-like calls show unavailable and do not trigger `api/tags_video.php`. |
| 關鍵字文字雲 | `/tag_cloud.php` | `/keywords/{keyword}/cloud` | Implemented as read-only `urt_show_tag_cloud_tag` cache viewer with scalar/weighted/list/wrapped cache payload parsing and legacy differential weighting; default period is seven days, cache misses fall back to derived `urt_video` + `tags` relation data, and no `api/tag_tags_days.php` write generation is triggered. |
| 關鍵字影片 | `/tag_video.php` | `/keywords/{keyword}/videos` | Implemented as read-only `urt_show_video_tag_date` relation cache viewer joined to `urt_video`; supports map/list/wrapped `videos_json` payloads. Cache misses fall back to read-only `urt_video` title/description matching and do not trigger `api/tags_relation_date.php`. |
| 關鍵字直播線圖 | `/tag_live.php` | `/keywords/{keyword}/live/trends` | Implemented as read-only group comparison from `urt_show_live_tag_date` cache; no legacy `api_live_tag_date.php` generation is triggered. |
| 關鍵字分群趨勢線圖 | `/tag_group.php` | `/keywords/{keyword}/groups/trends` | Implemented as read-only group comparison from `urt_show_tag_month.tags_result`; parses direct/wrapped/list-shaped period cache payloads plus `group/group_*.php`, applies legacy 7-day rolling metrics, and does not trigger `api/tag_period.php` / `api/tag_month.php` or write `urt_log_tag`. |
| 多關鍵字趨勢比較 | `/tag.php` | `/tags/compare` | Implemented as read-only `urt_show_tag_date` JSON trend comparison for legacy `tags=...`; local cache currently has 0 rows, so it does not trigger `api/cloud_tag_date.php` generation. |
| 標籤趨勢線圖 | `/line.php` | `/tags/trends`, `/tags/{tagId}/trends` | Implemented as read-only `urt_show_tag_date` trend viewer with seven-day moving metrics. Local cache currently has 0 rows, so production-like calls show unavailable state instead of calling legacy cache-generation APIs. |
| 影片基本資料 / 留言分析 | `/video.php`, `/video_data_att.php` | `/videos/{videoId}`, `/videos/{videoId}/analytics` | Implemented as read-only metadata, duration, live log, stat history, and comment analytics. Local `urt_video_log` and `urt_comment` currently have 0 rows, so analytics sections render unavailable and no legacy comment-fetch link is exposed. |
| 直播排行榜 | `/live.php?or=1,2,12,13,14,81` | `/live/current?or=1,2,12,13,14,81` | First full vertical slice. |
| 直播靜態輸出 | `/html/live_social.html`, `html/make_live.sh` | `/live/current?or=1,2,12,13,14,81`, `reports:live:static` preview | Legacy static URL redirects to the dynamic read-only report; scheduler command previews static HTML generation without writing `live_social.html`. |
| 每日主要事件 | `/ai_day.php` | `/ai/days` | Implemented as read-only daily topic summary from local `urt_ai_date` + `urt_channel_ai`; parses list plus wrapped `events`/`topics`/`result`/`data` legacy AI JSON variants. |
| 每日 Prompt | `/ai_day_prompt.php` | `/ai/days/{date}/prompt`, `/ai/days/{date}/{condition}/prompt` | Implemented as read-only prompt preview from local `urt_channel_ai`; preserves legacy condition/tag filters, parses wrapped AI JSON variants, and omits writeback. |
| 今日每小時 | `/ai_hour.php` | `/ai/hours` | Implemented as read-only hourly AI summary from local `urt_ai_hour`; defaults to latest imported date for local reconstruction and parses list plus wrapped `events`/`topics` legacy AI JSON variants. |

## Include-Only Helpers

| Legacy helper | Modern usage | Notes |
| --- | --- | --- |
| `stopwords.php` | `App\Services\Legacy\LegacyStopwords` | Parsed read-only from the legacy ground-truth path and shared by keyword list, tag cloud, channel cloud, daily tag relation, and live tag pages. There is no public route because the legacy file only populates a PHP array for include callers. |
| `nav_media.php` | Existing group/media links | Include-only menu that points at `/html/group_chart.html`, `/html/group_chart_30.html`, and `/html/group_line.html`; those static URLs already redirect to `/groups/media/ranking` or `/groups/media/trends`. |
| 期間主要事件 | `/ai_period.php` | `/ai/periods` | Implemented as read-only period table from `urt_ai_date.data_json`/`result_json`, including wrapped legacy AI JSON parsing; no legacy `api/api_topic.php` cache writeback. |
| 事件分析 | `/ai_event.php`, `/ai_event_people.php`, `/ai_event_wall.php` | `/ai/events/{pk}`, `/ai/events/{pk}/people`, `/ai/events/{pk}/wall` | Implemented read-only summary, people/media, video wall output from `urt_ai_event`, and `urt_ai_period` match-chain history when period rows exist; no `api_topic.php` prefetch/generation is triggered. |
| 立場分布表 | `/ai_channel.php`, `/ai_tag.php`, `/ai_dashboard.php` | `/ai/aspects` | Implemented from latest `urt_channel_ai` aspect JSON, with tag filters, condition shortcuts, and grouped or wrapped/flat aspect payload parsing. |
| 個人社論 | `/rank.php?tagid=1&not=2,9,10,12,13,33,36,81` | `/tags/1/channels?...` | Implemented with query compatibility. |
| 新聞集團 | `/html/group_chart.html`, `html/make_html.sh` | `/groups/media/ranking?days=7`, `reports:static:build` preview | Implemented as read-only group ranking from `urt_show_tag_date`; static group chart generation is previewed through the scheduler registry without writing HTML. |
| 兩岸立場 | `/group_two.php` | `/groups/two/trends`, `/groups/two_all/trends` | Implemented as read-only Taiwan-vs-China position trend from `urt_show_tag_date`; default legacy route compares `tagid=9,48` vs `tagid=9,49`, and `all=1` preserves the expanded legacy group set without triggering `api/cloud_tag_date.php`. |
| Group membership | `/group_view.php`, `/group_people.php`, `/group_tag.php` | `/groups/{groupName}` | Implemented as read-only membership from `tag_group` or legacy configured `tags_*` groups; `api/group_view.php` exposes a read-only JSON shell without cache generation. |
| Group ranking | `/group_chart.php` | `/groups/{groupName}/ranking` | Implemented as read-only aggregate from `urt_show_tag_date`; no `api/cloud_tag_date.php` generation is triggered. |
| Group daily trend | `/group_line.php` | `/groups/{groupName}/trends` | Implemented as read-only rolling daily trend from `urt_show_tag_date`; no cache generation is triggered. |
| Group live trend | `/group_live.php` | `/groups/{groupName}/live` | Implemented as read-only daily max plus seven-day rolling live trend from `urt_show_live_tag_date.tags_views` / `tags_video`; no `api_live_tag_date.php` generation is triggered. |
| 2026縣市長已提名／已表態人選 | `/mayor/html_*.html`, `/mayor/city.php`, `mayor/make_mayor.sh` | `/mayor/cities/{city}`, `reports:mayor:static` preview | Implemented as read-only support trend from `urt_show_tag_date` with a curated 22-county/city 2026 candidate list updated 2026-05-28; no `api/cloud_tag_date.php` generation and no static HTML writes. |
| 現在正直播排行 | `/live.php` | `/live/current` | Current live streams. |
| 現在帶狀直播排行 | `/live_cont.php` | `/live/continuous` | Active streams older than the continuous-live `hours` threshold. |
| 單日直播排行 | `/live_day.php` | `/live/days/{date}` | Historical live daily ranking. |
| 直播趨勢 | `/live_day_line.php` | `/live/trends/daily` | Chart/report page. |
| 群組每小時直播人數 | `/lives_date.php` | `/live/groups/{group}/hours` | Implemented as read-only hourly matrix from `urt_show_live_tag_date.hour_result`; no legacy cache generation is triggered. |
| 直播頻道排行 | `/live_channels.php` | `/live/channels` | Channel aggregate over date range or recent days. |
| 直播影片排行 | `/live_channel.php`, `/live_videos.php` | `/live/days/{date}`, `/live/periods` | Compatibility redirects to the video-ranking surfaces that use `urt_video_live_log` + `urt_show_video_live`; no cache generation or polling. |
| 小時熱度 | `/live_hour.php` | `/live/hours` | Hourly heatmap by date from `urt_show_live_tag_date.hour_result` when cache exists, with raw live-log fallback; no legacy cache generation is triggered. |
| 期間直播排行 | `/live_period.php` | `/live/periods` | Period/range video ranking backed by the same data as single-day live ranking. |
| 直播標籤 | `/live_tag.php` | `/live/tags` | Implemented as read-only report from legacy `urt_show_live_tag_date` cache with direct/wrapped `tags_views` / `tags_video` parsing; no API/cache regeneration is triggered. |
| Live chart/API data | `/api/api_live_day.php`, `/api/api_live_date.php`, `/api/api_live_hour.php`, `/api/api_live_tag_date.php`, `/api/live_date.php`, `/api/live_tvbs.php`, `/api/video_live.php`, `/api/csv_live_line.php` | same legacy URLs | Implemented as read-only compatibility endpoints; live tag-date cache columns accept direct/wrapped payloads, and cache misses do not insert or schedule background generation. |
| Tag/channel JSON APIs | `/api/tags_list.php`, `/api/tags_index.php`, `/api/tags_all.php`, `/api/video_tags.php`, `/api/video_tags_title.php`, `/api/channels_list.php`, `/api/channel_videos.php`, `/api/channels_videos.php` | same legacy URLs | Implemented as read-only compatibility endpoints; `tags_all` accepts direct/wrapped/list-shaped metric payloads. Automatic legacy writeback is omitted, but `reports:keywords:cache --execute` provides an explicit one-shot local DB rebuild for the derived `urt_show_data.tags_all` row. |
| Channel report APIs | `/api/api_channel_log.php`, `/api/channel_pred.php` | same legacy URLs | Implemented as read-only `urt_log.thedata` expansion; local `urt_log` currently has 0 rows and prediction writeback is omitted. |
| Tag chart/cache APIs | `/api/api_tag.php`, `/api/api_tag_log.php`, `/api/tags_day.php`, `/api/tags_video.php`, `/api/tags_relation_date.php`, `/api/tag_month.php`, `/api/tag_period.php`, `/api/tag_tags_days.php` | same legacy URLs | Implemented as read-only cache/API endpoints; tag cloud, relation-date, month/period, and tag-tags-days JSON accept direct or wrapped payloads, tag cloud pages now consume `tags_video` / `tag_tags_days` cache output without writes, and API cache misses return unavailable metadata rather than triggering background generation. |
| Cloud/group JSON APIs | `/api/cloud.php`, `/api/cloud_tag_date.php`, `/api/cloud_tag_date_noapi.php`, `/api/group_view.php` | same legacy URLs | Implemented as read-only cache/API endpoints with map/list/wrapped cloud payload parsing; `group_view` falls back to `tag_group` membership when `urt_show_group` is absent locally. |
| AI/event/comment APIs | `/api/ai_day.php`, `/api/api_topic.php`, `/api/api_event.php`, `/api/api_comment.php` | same legacy URLs | Implemented as read-only AI/comment endpoints; topic cache writeback and comment API logging are intentionally omitted. |
| Misc media APIs | `/api/api_duration.php`, `/api/api_get_photo.php`, `maint/get_duration.php`, `maint/get_video_count.php` | same legacy URLs, `youtube:videos:duration` preview plus scheduled/local `--execute`, `youtube:videos:stats` preview plus scheduled/local `--execute` | Plain-text endpoints are read-only; Wikipedia photo fetching remains omitted. The duration queue processor is previewed through `/ops/ingestion/youtube.videos.duration` and can execute `videos.list(contentDetails)` updates to `urt_video_duration`; explicit/scheduled `--enqueue-missing` can create queue rows from existing local `urt_video` rows to mirror `api/api_duration.php` queue insertion and support production backfill. The video statistics refresh queue is previewed through `/ops/ingestion/youtube.videos.stats` and supports capped scheduled/local `--execute` for `videos.list(statistics)` updates. |
| 同時四窗直播 | `/live4.php`, `/live5.php`, `/live_china.php` | `/live/walls/{variant}` | Implemented as read-only static live wall from legacy hard-coded stream IDs. |
| 頻道基本資料 | `/channel.php`, `/ch/{u_id}/` | `/channels/{u_id}` | Implemented with basic stats, tags, and limited channel AI excerpts, including wrapped daily AI payload parsing. |
| 頻道每日重點整理(AI) | `/channel_date.php`, `/ch/{u_id}/date/` | `/channels/{u_id}/ai/days`, `/channels/{u_id}/ai/days/{date}` | Implemented from `channel_date.php` using read-only local `urt_channel_ai`; preserves `date` and `type=week`, and parses list plus wrapped `events`/`topics` legacy AI JSON variants. |
| 頻道影片 | `/channel_videos.php`, `/ch/{u_id}/videos/` | `/channels/{u_id}/videos` | Implemented from local `urt_video` with optional comment summary fields. |
| 頻道留言 | `/channel_comments.php`, `/ch/{u_id}/comments/` | `/channels/{u_id}/comments` | Implemented as read-only author ranking over recent channel videos using `urt_video` and `urt_comment.authors_json`; supports map/list author JSON and JSON-derived source-video counts. Local `urt_comment` has 0 rows, so production-like calls show unavailable and do not trigger ingestion. |
| 頻道文字雲 | `/channel_cloud.php`, `/ch/{u_id}/cloud/` | `/channels/{u_id}/cloud` | Implemented as read-only `urt_show_cloud` cache viewer with scalar/weighted/list/wrapped cache payload parsing and legacy differential weighting; local cache currently has 0 rows, so production-like calls show unavailable and do not trigger `api/cloud.php`. |
| 頻道線圖 | `/channel_line.php`, `/ch/{u_id}/line/` | `/channels/{u_id}/trends` | Implemented as read-only `urt_log.thedata` trend page with moving/orig/each/videos modes; local `urt_log` has 0 rows, so production-like calls show unavailable and do not trigger polling. |
| 頻道人物 | `/channel_days.php`, `/ch/{u_id}/days/` | `/channels/{u_id}/people` | Implemented from local `urt_channel_ai` `oneday` JSON by aggregating people over the latest imported period; parses list plus wrapped `events`/`topics` legacy AI JSON variants. |
| 頻道 Prompt | `/channel_prompt.php`, `/ch/{u_id}/prompt/` | `/channels/{u_id}/prompt` | Implemented as read-only prompt preview from local `urt_video`; no legacy `/redir/channel_ai.php` writeback. |
| 頻道 GPT Prompt / AI 結果 | `/channel_gpt.php`, `/maint/get_channel_openai.php`, `/ch/{u_id}/ai/` | `/channels/{u_id}/ai` | Implemented as read-only cached `topic`/`people`/`aspect` output from local `urt_channel_ai`, with the legacy manual GPT prompt preview and no `/redir/channel_gpt.php` writeback or AI generation. |

Full parity backlog: `docs/legacy-inventory/feature-parity.md`.

## Public Pages Observed

- Public fetch attempts for `https://youtube.board.tw/`, `/live.php?...`, `/ai_day.php`, and `/tags.php` returned `403` from this development environment on 2026-05-24.
- Use legacy source files as primary behavior evidence until public pages can be observed through an approved browser session or another route.
