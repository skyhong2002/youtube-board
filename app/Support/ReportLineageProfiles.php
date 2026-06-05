<?php

namespace App\Support;

use Illuminate\Support\Str;

class ReportLineageProfiles
{
    /**
     * @var array<string, array<string, mixed>>|null
     */
    private static ?array $profiles = null;

    /**
     * @return array<string, mixed>|null
     */
    public function forRoute(string $routeName): ?array
    {
        foreach (self::profiles() as $pattern => $profile) {
            if (Str::is($pattern, $routeName)) {
                return $profile;
            }
        }

        return null;
    }

    /**
     * @return array<string, array<string, mixed>>
     */
    private static function profiles(): array
    {
        return self::$profiles ??= [
            'tags.index' => self::tagIndex(),
            'keywords.index' => self::keywordList(),
            'tags.videos*' => self::tagVideos(),
            'tags.channels' => self::tagChannels(),
            'tags.comments*' => self::tagComments(),
            'tags.days*' => self::tagDays(),
            'tags.cloud*' => self::tagCloud(),
            'tags.live.videos*' => self::tagLiveVideos(),
            'tags.trends*' => self::tagTrends(),
            'tags.compare' => self::tagComparison(),
            'keywords.cloud' => self::keywordCloud(),
            'keywords.days' => self::keywordDays(),
            'keywords.videos' => self::keywordVideos(),
            'keywords.groups.trends' => self::keywordGroupTrend(),
            'keywords.live.trends' => self::keywordLiveTrend(),
            'live.current' => self::liveCurrent(),
            'live.days*' => self::liveDays(),
            'live.periods' => self::livePeriods(),
            'live.trends.daily' => self::liveDailyTrend(),
            'live.hours' => self::liveHours(),
            'live.channels' => self::liveChannels(),
            'live.continuous' => self::liveContinuous(),
            'live.tags' => self::liveTags(),
            'live.groups.hours' => self::liveGroupHours(),
            'live.videos.trend' => self::liveVideoTrend(),
            'live.wall' => self::liveWall(),
            'channels.show' => self::channelProfile(),
            'channels.videos' => self::channelVideos(),
            'channels.comments' => self::channelComments(),
            'channels.cloud' => self::channelCloud(),
            'channels.trends' => self::channelTrends(),
            'channels.people' => self::channelPeople(),
            'channels.ai' => self::channelAiOverview(),
            'channels.ai.days*' => self::channelAiDays(),
            'channels.prompt' => self::channelPrompt(),
            'videos.show' => self::videoDetail(),
            'videos.analytics' => self::videoDetail(),
            'comments.authors.show' => self::authorComments(),
            'groups.index' => self::groupDirectory(),
            'groups.show' => self::groupDirectory(),
            'groups.ranking' => self::groupMetrics(),
            'groups.trends' => self::groupMetrics(),
            'groups.live' => self::groupLive(),
            'mayor.index' => self::mayorReport(),
            'mayor.show' => self::mayorReport(),
            'ai.days.index' => self::aiDays(),
            'ai.days.date' => self::aiDays(),
            'ai.days.condition' => self::aiDays(),
            'ai.days.prompt*' => self::aiDailyPrompt(),
            'ai.days.condition.prompt' => self::aiDailyPrompt(),
            'ai.hours' => self::aiHours(),
            'ai.periods' => self::aiPeriods(),
            'ai.events.show' => self::aiEvent(),
            'ai.events.people' => self::aiEvent(),
            'ai.events.wall' => self::aiEvent(),
            'ai.aspects' => self::aiAspects(),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private static function homeDashboard(): array
    {
        return [
            'title' => '總覽',
            'summary' => '首頁把分類週觀看排行與關鍵字排行合併成入口儀表板；頁面請求只讀本機 DB/cache，不呼叫外部 API。',
            'jobs' => [
                self::job(
                    key: 'youtube.channels.stats',
                    label: '頻道統計輪詢',
                    command: 'youtube:channels:stats --execute --limit=25',
                    apiCalls: ['YouTube Data API channels.list(part=statistics)'],
                    reads: ['urt_channel'],
                    writes: ['urt_channel', 'urt_count', 'urt_log'],
                    summary: '更新頻道統計與 urt_count.tags，供首頁分類排行與 weekly views 使用。',
                    scheduler: 'config/ingestion.php job youtube.channels.stats；每 9 分鐘，scheduled-write gates 通過後執行。',
                ),
                self::job(
                    key: 'reports.counts.build',
                    label: '頻道週/月增量計算',
                    command: 'reports:counts:build --execute --limit=500',
                    apiCalls: [],
                    reads: ['urt_log', 'urt_count'],
                    writes: ['urt_count'],
                    summary: '不呼叫外部 API；從 urt_log 推導 urt_count.view_week 等首頁分類排序欄位。',
                    scheduler: 'config/ingestion.php job reports.counts.build；每日 6 次，scheduled-write gates 通過後執行。',
                ),
                self::job(
                    key: 'reports.keywords.cache',
                    label: '關鍵字指標快取',
                    command: 'reports:keywords:cache --execute --days=31 --recent-days=7',
                    apiCalls: [],
                    reads: ['tags', 'urt_video', 'urt_count'],
                    writes: ['urt_show_data.data_name=tags_all'],
                    summary: '不呼叫外部 API；把本機影片與 tags 聚合成首頁關鍵字觀看數與影片數快取。',
                    scheduler: 'config/ingestion.php job reports.keywords.cache；每日 6 次，scheduled-write gates 通過後執行。',
                ),
            ],
            'render' => [
                'controller' => 'App\Http\Controllers\Reports\HomeController',
                'service' => 'App\Services\Legacy\HomeTagIndexReport + KeywordListReport',
                'reads' => ['urt_count', 'urt_tag', 'tags', 'urt_show_data.data_name=tags_all'],
                'request' => '首頁 request 本身不呼叫 YouTube、tag.analysis 或 AI API；用固定 limit/min/sort 讀分類與關鍵字資料，即時計算入口摘要。',
                'transforms' => [
                    'HomeController 對 HomeTagIndexReport 套用 sort=total、limit=8、min=10。',
                    'HomeTagIndexReport 解析 urt_count.tags，依 urt_tag 名稱彙總分類頻道數、週觀看總量、平均與中位數。',
                    'KeywordListReport 讀 tags 與 tags_all cache，套用 stopwords 並取前 8 筆關鍵字。',
                    'Blade 把分類入口、關鍵字入口與主要報表入口組成首頁 dashboard。',
                ],
            ],
            'fixed_sources' => [
                self::fixedSource('首頁固定 limits', 'HomeController duplicate query: category limit=8/min=10, keyword limit=8', '寫死在 controller；只有部署新版本才會變更。'),
                self::fixedSource('分類 sort whitelist', 'HomeTagIndexReport::SORT_COLUMNS = num,total,ave,median', '可排序欄位寫死在程式碼；不會由排程更新。'),
                self::fixedSource('內建 stopwords fallback', 'App\Services\Legacy\LegacyStopwords::FALLBACK', '關鍵字列表會使用固定停用詞；隨部署更新。'),
            ],
            'sources' => [
                self::source('urt_count', 'urt_count', ['mtime', 'ctime']),
                self::source('urt_tag', 'urt_tag', ['mtime', 'ctime']),
                self::source('tags', 'tags', ['mtime', 'ctime']),
                self::source('urt_show_data.tags_all', 'urt_show_data', ['mtime', 'ctime'], ['data_name' => 'tags_all']),
            ],
            'graph' => [
                self::jobNode('home_channel_jobs', '頻道統計與增量', 'api', 'youtube.channels.stats', 'channels:stats 只在 ingestion job 執行時呼叫 YouTube；counts build 只讀本機 log。', [
                    'job_details' => ['reports.counts.build'],
                ]),
                self::combinedSourceNode('home_category_tables', 'urt_count + urt_tag', ['urt_count', 'urt_tag'], '首頁分類排行讀本機頻道 tag 與週觀看增量。', [
                    'job_details' => ['youtube.channels.stats', 'reports.counts.build'],
                ]),
                self::sourceNode('home_keyword_cache', 'tags + tags_all cache', 'cache', 'urt_show_data.tags_all', '首頁關鍵字排行讀 tags 與 tags_all 指標快取。', [
                    'source_details' => ['tags'],
                    'job_details' => ['reports.keywords.cache'],
                ]),
                self::serviceNode('home_report', 'HomeController dashboard merge', 'request 時取分類與關鍵字前 8 筆，計算摘要數字與入口連結。'),
                self::pageNode('home_page', '總覽頁', '/', 'Blade 呈現主要入口、熱門分類、熱門關鍵字與缺資料提示。'),
            ],
            'edges' => [
                self::edge('home_channel_jobs', 'home_category_tables', 'refresh counts', '頻道統計與增量工作更新分類排行來源。'),
                self::edge('home_category_tables', 'home_keyword_cache', 'parallel sources', '首頁同時讀分類來源與關鍵字快取，不在 request 寫 DB。'),
                self::edge('home_keyword_cache', 'home_report', 'top lists', 'HomeController 取固定筆數並合併為 dashboard payload。'),
                self::edge('home_report', 'home_page', 'render dashboard', 'Blade 產生首頁入口與摘要。'),
            ],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private static function tagIndex(): array
    {
        return [
            'title' => '所有分類列表',
            'summary' => '分類列表直接讀 urt_count 與 urt_tag，在 request 時彙總每個 tag 的頻道數、週觀看總量、平均與中位數。',
            'jobs' => [
                self::job(
                    key: 'youtube.channels.stats',
                    label: '頻道統計輪詢',
                    command: 'youtube:channels:stats --execute --limit=25',
                    apiCalls: ['YouTube Data API channels.list(part=statistics)'],
                    reads: ['urt_channel'],
                    writes: ['urt_channel', 'urt_count', 'urt_log'],
                    summary: '更新 urt_count.tags、頻道觀看與訂閱統計；只在 job 執行時呼叫 YouTube。',
                    scheduler: 'config/ingestion.php job youtube.channels.stats；每 9 分鐘，scheduled-write gates 通過後執行。',
                ),
                self::job(
                    key: 'reports.counts.build',
                    label: '頻道週/月增量計算',
                    command: 'reports:counts:build --execute --limit=500',
                    apiCalls: [],
                    reads: ['urt_log', 'urt_count'],
                    writes: ['urt_count'],
                    summary: '不呼叫外部 API；更新 urt_count.view_week 等分類排行欄位。',
                    scheduler: 'config/ingestion.php job reports.counts.build；每日 6 次，scheduled-write gates 通過後執行。',
                ),
            ],
            'render' => [
                'controller' => 'App\Http\Controllers\Reports\HomeController',
                'service' => 'App\Services\Legacy\HomeTagIndexReport',
                'reads' => ['urt_count', 'urt_tag'],
                'request' => '頁面 request 本身不呼叫 YouTube API；讀本機 urt_count/urt_tag，依 sort/min/limit 即時計算分類列表。',
                'transforms' => [
                    '解析 min、limit、sort query，sort 只允許 num/total/ave/median。',
                    '讀 urt_tag 作為 tag id 顯示名稱。',
                    '掃 urt_count.tags，把每個頻道 view_week 累加到各 tag。',
                    'request 時即時計算平均與中位數，排序後輸出表格與入口連結。',
                ],
            ],
            'fixed_sources' => [
                self::fixedSource('Tag index sort whitelist', 'HomeTagIndexReport::SORT_COLUMNS = num,total,ave,median', '可排序欄位寫死在程式碼；隨部署更新。'),
                self::fixedSource('Tag index defaults', 'min=10, limit<=1000, sort=num', 'query bounds 與預設值寫死在 service；不是排程更新來源。'),
            ],
            'sources' => [
                self::source('urt_count', 'urt_count', ['mtime', 'ctime']),
                self::source('urt_tag', 'urt_tag', ['mtime', 'ctime']),
            ],
            'graph' => [
                self::jobNode('tag_index_stats_job', 'YouTube channel stats', 'api', 'youtube.channels.stats', '更新本機頻道統計與 tag 來源；頁面瀏覽不呼叫 API。'),
                self::jobNode('tag_index_count_job', 'reports:counts:build', 'service', 'reports.counts.build', '從本機 urt_log 推導 view_week 等排行欄位。'),
                self::combinedSourceNode('tag_index_tables', 'urt_count + urt_tag', ['urt_count', 'urt_tag'], '分類列表所有數字與名稱都來自本機資料表。', [
                    'job_details' => ['youtube.channels.stats', 'reports.counts.build'],
                ]),
                self::serviceNode('tag_index_report', 'HomeTagIndexReport 聚合', 'request 時解析 tags 字串，計算 num/total/average/median 並排序。'),
                self::pageNode('tag_index_page', '所有分類列表頁', '/tags', 'Blade 呈現分類摘要、filter chips、分類表格與各報表入口。'),
            ],
            'edges' => [
                self::edge('tag_index_stats_job', 'tag_index_count_job', 'write logs', 'channels:stats 更新 urt_log 與 urt_count。'),
                self::edge('tag_index_count_job', 'tag_index_tables', 'derive weekly', 'counts build 更新 weekly/monthly delta 欄位。'),
                self::edge('tag_index_tables', 'tag_index_report', 'aggregate tags', 'HomeTagIndexReport 即時掃 urt_count.tags。'),
                self::edge('tag_index_report', 'tag_index_page', 'render list', 'Blade 輸出分類列表與連結。'),
            ],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private static function keywordList(): array
    {
        return [
            'title' => '關鍵字列表',
            'summary' => '本頁把外部關鍵字熱度、本機影片資料、關鍵字停用詞合併成可排序的關鍵字排行榜。',
            'jobs' => [
                self::job(
                    key: 'reports.keywords.build',
                    label: '關鍵字同步',
                    command: 'reports:keywords:build --execute --hours=2 --limit=100',
                    apiCalls: ['https://tag.analysis.tw/api/tag_json.php?hours={hours}'],
                    reads: [],
                    writes: ['tags'],
                    summary: '從新文易數同步近期關鍵字熱度，更新 tags 的熱度、最高時間與排除旗標。',
                    scheduler: 'config/ingestion.php job reports.keywords.build；每日 6 次，scheduled-write gates 通過後執行。',
                ),
                self::job(
                    key: 'reports.keywords.cache',
                    label: '關鍵字指標快取',
                    command: 'reports:keywords:cache --execute --days=31 --recent-days=7',
                    apiCalls: [],
                    reads: ['tags', 'urt_video', 'urt_count'],
                    writes: ['urt_show_data.data_name=tags_all'],
                    summary: '不呼叫外部 API；從本機影片與頻道分類聚合影片數、觀看數與成長欄位。',
                    scheduler: 'config/ingestion.php job reports.keywords.cache；每日 6 次，scheduled-write gates 通過後執行。',
                ),
            ],
            'render' => [
                'controller' => 'App\Http\Controllers\Reports\KeywordListController',
                'service' => 'App\Services\Legacy\KeywordListReport',
                'reads' => ['tags', 'urt_show_data.data_name=tags_all'],
                'request' => '頁面請求只讀 tags 與 urt_show_data.tags_all，不呼叫外部 API；排序與 limit 在 request 時即時計算。',
                'transforms' => [
                    '讀取 tags，排除 no_tag 與 stopwords。',
                    '依 hours_count、max_count、max_hours 計算 weight 與 weight_score。',
                    '解析 urt_show_data.tags_all JSON，合併 video、views、views_all。',
                    '依 sort 參數排序後輸出表格。',
                ],
            ],
            'fixed_sources' => [
                self::fixedSource('內建 stopwords fallback', 'App\Services\Legacy\LegacyStopwords::FALLBACK', '寫死在程式碼；只有部署新版本才會變更。'),
                self::fixedSource('Legacy stopwords reference', 'config(legacy.ground_truth_path)/urtube/stopwords.php', '如果本機參考檔存在會一起讀取；不是排程更新來源。'),
                self::fixedSource('分類篩選 tags_all categories', 'TagsAllCacheBuilder::DEFAULT_CATEGORY_TAGS = 1,2,13,14', '寫死在快取重建邏輯；用來限定參與聚合的頻道分類。'),
            ],
            'sources' => [
                self::source('tags', 'tags', ['mtime', 'ctime']),
                self::source('urt_show_data.tags_all', 'urt_show_data', ['mtime', 'ctime'], ['data_name' => 'tags_all']),
            ],
            'graph' => [
                self::jobNode('external', '外部關鍵字 API', 'api', 'reports.keywords.build', '只在關鍵字同步工作執行時呼叫；頁面瀏覽本身不會即時打外部 API。'),
                self::sourceNode('tags', '關鍵字基礎表 tags', 'table', 'tags', '保存關鍵字熱度、最高出現時間與 no_tag 排除旗標，是排行與權重計算的主資料表。', [
                    'job_details' => ['reports.keywords.build'],
                ]),
                self::jobNode('local_video', '本機影片資料', 'table', 'reports.keywords.cache', '快取重建時從本機影片與頻道分類計算關鍵字影片數、觀看數與近期指標。', [
                    'meta' => ['固定分類' => 'TagsAllCacheBuilder::DEFAULT_CATEGORY_TAGS = 1,2,13,14'],
                ]),
                self::sourceNode('tags_all', 'tags_all 指標快取', 'cache', 'urt_show_data.tags_all', '保存已聚合的影片數、近期觀看數與總觀看數，避免每次開頁都重新掃影片。', [
                    'job_details' => ['reports.keywords.cache'],
                ]),
                self::serviceNode('report', '合併與排序服務', '讀取 tags 與 tags_all，套用固定規則，合併欄位後依目前排序參數輸出 rows。'),
                self::pageNode('page', '關鍵字列表頁', '/keywords', 'Blade 只負責呈現資料服務回傳的 rows、目前 filters、排序與操作連結。'),
            ],
            'edges' => [
                self::edge('external', 'tags', 'sync', 'reports:keywords:build 透過外部 API 同步近期關鍵字熱度並 upsert tags。'),
                self::edge('tags', 'local_video', 'select', 'reports:keywords:cache 先從 tags 選出可計算的關鍵字集合。'),
                self::edge('local_video', 'tags_all', 'aggregate', '掃描本機影片標題與描述，依關鍵字累計影片數與觀看數。'),
                self::edge('tags_all', 'report', 'merge + filter', '頁面產生時把 tags_all 指標合併回 tags 排行，並套用固定 stopwords。'),
                self::edge('report', 'page', 'render', 'KeywordListReport 回傳列資料，Blade 依排序與 limit 呈現表格。'),
            ],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private static function tagVideos(): array
    {
        return [
            'title' => '標籤影片排行',
            'summary' => '本頁依 tag 篩選本機頻道集合，直接讀取近期 urt_video rows，依觀看、留言、喜歡或發布時間即時計算影片排行。',
            'jobs' => [
                self::job(
                    key: 'youtube.channels.videos.general',
                    label: '一般頻道 uploads 擷取',
                    command: 'youtube:channels:videos --execute --limit=5 --max-results=3',
                    apiCalls: ['YouTube Data API playlistItems.list(part=snippet)'],
                    reads: ['urt_channel', 'urt_count', 'urt_video_schedule'],
                    writes: ['urt_video', 'urt_video_schedule', 'urt_video_live', 'urt_channel.vtime'],
                    summary: '從本機頻道 queue 抓 uploads playlist，idempotently upsert 影片、排程與 live/upcoming rows。',
                    scheduler: 'config/ingestion.php job youtube.channels.videos.general；每 5 分鐘，scheduled-write gates 通過後執行 capped command。',
                ),
                self::job(
                    key: 'youtube.tag_videos.backfill',
                    label: '指定 tag 影片回填',
                    command: 'youtube:tag-videos:backfill --execute --tagid={tagid} --days=2',
                    apiCalls: ['YouTube Data API playlistItems.list(part=snippet)'],
                    reads: ['urt_count.tags selected channels'],
                    writes: ['urt_video', 'urt_video_schedule', 'urt_video_live', 'urt_show_tag_date'],
                    summary: '高流量 tag 可分頁抓 selected channels uploads，補齊本機 urt_video；頁面本身只讀 DB。',
                    scheduler: 'config/ingestion.php job youtube.tag_videos.backfill；每日 8 次，需在 scheduled-write allowlist 中。',
                ),
                self::job(
                    key: 'youtube.videos.stats',
                    label: '影片統計輪詢',
                    command: 'youtube:videos:stats --execute --limit=25',
                    apiCalls: ['YouTube Data API videos.list(part=statistics)'],
                    reads: ['urt_video_schedule', 'urt_video'],
                    writes: ['urt_video', 'urt_video_schedule', 'urt_video_log', 'urt_video_log_history'],
                    summary: '更新 viewCount、likeCount、commentCount；排序欄位使用這些本機統計值。',
                    scheduler: 'config/ingestion.php job youtube.videos.stats；00-17 點每 7 分鐘。',
                ),
            ],
            'render' => [
                'controller' => 'App\Http\Controllers\Reports\TagVideosController',
                'service' => 'App\Services\Legacy\TagVideosReport',
                'reads' => ['urt_count', 'urt_tag', 'urt_video'],
                'request' => '頁面 request 本身不呼叫 YouTube API；只用 tag filters 找頻道，再讀本機 urt_video 並依目前 query sort/min/hours 即時計算排行。',
                'transforms' => [
                    'route tagId 會併入 tagid；query string 的 or/not/limit/min/hours/column 會在 request 時套用。',
                    'LegacyTagFilter 從 urt_count.tags 找符合條件的頻道，urt_tag 提供 tag 顯示名稱。',
                    'urt_video 依 publishedAt freshness、viewCount min 與 sort whitelist 查詢。',
                    '每列即時計算留言比 commentCount / viewCount * 1000。',
                    'Blade 顯示影片縮圖、頻道、標籤 chips 與 YouTube 連結。',
                ],
            ],
            'fixed_sources' => [
                self::fixedSource('Tag video sort whitelist', 'TagVideosReport::SORT_COLUMNS = viewCount, likeCount, commentCount, publishedAt', '可排序欄位寫死在程式碼；只有部署新版本才會變更。'),
                self::fixedSource('Tag video default filters', 'hours=24, min=1000, limit from LegacyTagFilter', '預設條件由程式碼決定；不是排程更新來源。'),
                self::fixedSource('Legacy visible tag ids', 'App\Services\Legacy\LegacyTagFilter::visibleTags', '可見分類 id 清單寫在程式碼中；只有部署新版本才會變更。'),
            ],
            'sources' => [
                self::source('urt_video', 'urt_video', ['mtime', 'publishedAt']),
                self::source('urt_count', 'urt_count', ['mtime', 'ctime']),
                self::source('urt_tag', 'urt_tag', ['mtime', 'ctime']),
            ],
            'graph' => [
                self::fixedNode('tag_video_filters', 'tag filters / sort rules', 'tagid/or/not/hours/min/column 都在頁面 request 時套用；sort 欄位與預設值隨部署更新。'),
                self::jobNode('video_discovery', 'uploads discovery / tag backfill', 'api', 'youtube.channels.videos.general', '一般 discovery 與 tag backfill 只在 ingestion job 執行時呼叫 YouTube playlistItems；頁面瀏覽不呼叫 API。', [
                    'job_details' => ['youtube.tag_videos.backfill'],
                ]),
                self::jobNode('video_stats', '影片統計輪詢', 'api', 'youtube.videos.stats', '更新本機 viewCount、likeCount、commentCount，供排行排序與留言比使用。'),
                self::combinedSourceNode('tag_video_tables', 'urt_video + channel tags', ['urt_video', 'urt_count', 'urt_tag'], '本頁所有顯示資料都來自本機影片、頻道 tag 與 tag 名稱表。', [
                    'job_details' => ['youtube.channels.videos.general', 'youtube.tag_videos.backfill', 'youtube.videos.stats'],
                ]),
                self::serviceNode('tag_video_report', 'TagVideosReport 即時排行', '依 route/query 篩選頻道與近期影片，排序後產生 rows；不寫 DB。'),
                self::pageNode('tag_video_page', '標籤影片頁', '/tags/{tagId}/videos', 'Blade 呈現時間範圍切換、filter chips、影片排行表與 ingestion portal fallback。'),
            ],
            'edges' => [
                self::edge('tag_video_filters', 'video_discovery', 'select channels', 'tag filters 決定需要補影片的頻道集合。'),
                self::edge('video_discovery', 'video_stats', 'upsert videos', 'uploads discovery/backfill 先補齊 urt_video 與排程/live rows。'),
                self::edge('video_stats', 'tag_video_tables', 'refresh stats', 'videos:stats 更新本機影片統計欄位。'),
                self::edge('tag_video_tables', 'tag_video_report', 'query + sort', '頁面 request 讀本機表，套用 hours/min/sort。'),
                self::edge('tag_video_report', 'tag_video_page', 'render ranking', 'Blade 輸出影片排行與標籤 chips。'),
            ],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private static function tagChannels(): array
    {
        return [
            'title' => '標籤頻道排行',
            'summary' => '本頁依 tag filters 直接讀取 urt_count 與 urt_channel，顯示頻道規模、週/月增量與預估欄位排行。',
            'jobs' => [
                self::job(
                    key: 'youtube.channels.stats',
                    label: '頻道統計輪詢',
                    command: 'youtube:channels:stats --execute --limit=25',
                    apiCalls: ['YouTube Data API channels.list(part=statistics)'],
                    reads: ['urt_channel'],
                    writes: ['urt_channel', 'urt_count', 'urt_log'],
                    summary: '更新頻道觀看、訂閱、影片數與 urt_count 基礎統計；只在 job 執行時呼叫 YouTube。',
                    scheduler: 'config/ingestion.php job youtube.channels.stats；每 9 分鐘，scheduled-write gates 通過後執行。',
                ),
                self::job(
                    key: 'reports.counts.build',
                    label: '頻道週/月增量計算',
                    command: 'reports:counts:build --execute --limit=500',
                    apiCalls: [],
                    reads: ['urt_log', 'urt_count'],
                    writes: ['urt_count'],
                    summary: '不呼叫外部 API；從 urt_log 推導週/月 view/sub/video 增量與預估欄位。',
                    scheduler: 'config/ingestion.php job reports.counts.build；每日 6 次，scheduled-write gates 通過後執行。',
                ),
            ],
            'render' => [
                'controller' => 'App\Http\Controllers\Reports\TagChannelRankingController',
                'service' => 'App\Services\Legacy\TagChannelRankingReport',
                'reads' => ['urt_count', 'urt_channel', 'urt_tag'],
                'request' => '頁面 request 本身不呼叫 YouTube API；只讀本機 urt_count/urt_channel/urt_tag，依目前 tag filters、min 與 sort column 即時計算排行。',
                'transforms' => [
                    'route tagId 會併入 tagid；or/not/min/limit/column 由 query string 決定。',
                    'join urt_count 與 urt_channel，排除 flag_del >= 1 的頻道。',
                    'tagid/or/not 轉成 urt_count.tags LIKE / NOT LIKE 條件。',
                    'or filter 存在時 min 套用 viewCount，否則 min 套用 subscriberCount。',
                    '依安全 sort whitelist 排序並輸出頻道 tag chips。',
                ],
            ],
            'fixed_sources' => [
                self::fixedSource('Channel ranking sort whitelist', 'TagChannelRankingReport::SORT_COLUMNS', '可排序欄位寫死在程式碼；只有部署新版本才會變更。'),
                self::fixedSource('Deleted channel filter', 'urt_channel.flag_del IS NULL OR < 1', '固定 SQL 條件；不會由排程改寫。'),
                self::fixedSource('OR filter min column rule', 'or 非空時 min=viewCount，否則 min=subscriberCount', '寫死在報表服務；隨部署更新。'),
            ],
            'sources' => [
                self::source('urt_count', 'urt_count', ['mtime', 'ctime']),
                self::source('urt_channel', 'urt_channel', ['mtime', 'ctime', 'stime', 'vtime']),
                self::source('urt_tag', 'urt_tag', ['mtime', 'ctime']),
            ],
            'graph' => [
                self::fixedNode('tag_channel_filters', 'tag filters / ranking rules', 'tagid/or/not/min/column 與刪除頻道排除條件都在 request 時套用。'),
                self::jobNode('channel_stats_job', 'YouTube channel stats', 'api', 'youtube.channels.stats', '只在 ingestion job 執行時呼叫 YouTube channels.list；頁面 request 不呼叫 API。'),
                self::jobNode('count_delta_job', 'reports:counts:build', 'service', 'reports.counts.build', '用本機 urt_log 推導週/月增量與預估欄位，不呼叫外部 API。'),
                self::combinedSourceNode('tag_channel_tables', 'urt_count + urt_channel', ['urt_count', 'urt_channel', 'urt_tag'], '頻道排行、tag chips 與頻道連結全部來自本機資料表。', [
                    'job_details' => ['youtube.channels.stats', 'reports.counts.build'],
                ]),
                self::serviceNode('tag_channel_report', 'TagChannelRankingReport 排序', '依 tag filters 與 sort whitelist 查詢本機表，request 時即時計算 pred_gap。'),
                self::pageNode('tag_channel_page', '標籤頻道排行頁', '/tags/{tagId}/channels', 'Blade 呈現頻道頭像、名稱、觀看/訂閱/週月增量、預估與 tag chips。'),
            ],
            'edges' => [
                self::edge('tag_channel_filters', 'channel_stats_job', 'refresh scope', 'tag filters 影響頁面排行範圍；channel stats job 維護本機頻道統計來源。'),
                self::edge('channel_stats_job', 'count_delta_job', 'write log', 'channels:stats 更新 urt_channel、urt_count 與 urt_log。'),
                self::edge('count_delta_job', 'tag_channel_tables', 'derive deltas', 'reports:counts:build 更新 urt_count 週/月與預估欄位。'),
                self::edge('tag_channel_tables', 'tag_channel_report', 'sort rows', '報表服務 join 本機表後依 sort column 排序。'),
                self::edge('tag_channel_report', 'tag_channel_page', 'render ranking', 'Blade 輸出頻道排行榜。'),
            ],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private static function tagComments(): array
    {
        return [
            'title' => '標籤留言排行',
            'summary' => '本頁用 tag filters 找近期影片留言快取，從 urt_comment 與 urt_video 即時計算影片留言表與留言者排行。',
            'jobs' => [
                self::job(
                    key: 'youtube.comments.queue',
                    label: '留言擷取佇列',
                    command: 'youtube:comments:queue --or=1,2,3,4,5,6,13,14,81 --hours=72 --min=500 --execute --limit=5',
                    apiCalls: [],
                    reads: ['urt_count', 'urt_video', 'urt_comment_queue'],
                    writes: ['urt_comment_queue'],
                    summary: '不呼叫外部 API；依 tag、hours、min 條件把候選影片放入本機留言擷取 queue。',
                    scheduler: 'config/ingestion.php job youtube.comments.queue；04、10、16 點第 23 分。',
                ),
                self::job(
                    key: 'youtube.comments.fetch',
                    label: '留言擷取',
                    command: 'youtube:comments:fetch --execute --limit=5 --max-pages=1',
                    apiCalls: ['YouTube Data API commentThreads.list'],
                    reads: ['urt_comment_queue', 'urt_comment'],
                    writes: ['urt_comment', 'urt_comment_author', 'urt_comment_rev', 'urt_comment_queue_done'],
                    summary: '從 queue 抓取留言與回覆，解析 authors_json / comments_json 並更新本機留言表。',
                    scheduler: 'config/ingestion.php job youtube.comments.fetch；每小時第 5 分，scheduled-write gates 通過後執行。',
                ),
            ],
            'render' => [
                'controller' => 'App\Http\Controllers\Reports\TagDataGapController::comments',
                'service' => 'App\Services\Legacy\TagCommentsReport',
                'reads' => ['urt_count', 'urt_tag', 'urt_comment', 'urt_video', 'urt_comment_author'],
                'request' => '頁面 request 本身不呼叫 YouTube API；只讀本機 comment/video/tag rows，並從 authors_json 即時計算留言者排行。',
                'transforms' => [
                    'route tagId 併入 tagid，query 支援 or/not/limit/min/hours/show。',
                    'LegacyTagFilter 從 urt_count.tags 找符合條件的頻道。',
                    '依頻道集合讀 urt_comment 最新 rows，再批次讀對應 urt_video 顯示資料。',
                    '從 urt_comment.authors_json 聚合留言者次數排行。',
                    'Data unavailable panel 會列出本機 comment 相關 dependency table 狀態。',
                ],
            ],
            'fixed_sources' => [
                self::fixedSource('Comment page defaults', 'TagCommentsReport filters: hours=24, min=1000, limit=25, show=0', '預設篩選值寫死在程式碼；不是排程更新來源。'),
                self::fixedSource('Legacy comment payload shape', 'urt_comment.authors_json map/list parser', 'JSON 解析相容規則隨部署更新。'),
                self::fixedSource('Legacy visible tag ids', 'App\Services\Legacy\LegacyTagFilter::visibleTags', '可見分類 id 清單寫在程式碼中；只有部署新版本才會變更。'),
            ],
            'sources' => [
                self::source('urt_comment', 'urt_comment', ['mtime', 'ctime', 'latest_time']),
                self::source('urt_comment_author', 'urt_comment_author', ['mtime', 'ctime']),
                self::source('urt_comment_rev', 'urt_comment_rev', ['mtime', 'ctime']),
                self::source('urt_video', 'urt_video', ['mtime', 'publishedAt']),
                self::source('urt_count', 'urt_count', ['mtime', 'ctime']),
                self::source('urt_tag', 'urt_tag', ['mtime', 'ctime']),
                self::source('urt_comment_queue', 'urt_comment_queue', ['mtime', 'ctime', 'stime', 'ftime']),
            ],
            'graph' => [
                self::fixedNode('tag_comment_filters', 'tag/comment filters', 'tagid/or/not/hours/min/limit/show 都在頁面 request 或 queue job 中套用；預設值隨部署更新。'),
                self::jobNode('comment_queue_job', 'youtube:comments:queue', 'service', 'youtube.comments.queue', '從本機影片與頻道 tag 找候選影片寫入 queue；不呼叫外部 API。'),
                self::jobNode('comment_fetch_job', 'youtube:comments:fetch', 'api', 'youtube.comments.fetch', '只有 fetch job 會呼叫 YouTube commentThreads.list；頁面 request 不呼叫 API。'),
                self::combinedSourceNode('comment_tables', 'urt_comment + urt_video', ['urt_comment', 'urt_comment_author', 'urt_comment_rev', 'urt_video', 'urt_count', 'urt_tag'], '留言摘要、作者 JSON、影片顯示資料與 tag filters 都來自本機 DB。', [
                    'job_details' => ['youtube.comments.queue', 'youtube.comments.fetch'],
                ]),
                self::serviceNode('tag_comments_report', 'TagCommentsReport 聚合', 'request 時合併 comment rows 與影片資料，並從 authors_json 聚合留言者排行；不寫 DB。'),
                self::pageNode('tag_comments_page', '標籤留言頁', '/tags/{tagId}/comments', 'Blade 呈現近期留言影片、留言者排行與 dependency 狀態。'),
            ],
            'edges' => [
                self::edge('tag_comment_filters', 'comment_queue_job', 'queue candidates', 'queue job 使用同類 tag/hours/min 條件挑選候選影片。'),
                self::edge('comment_queue_job', 'comment_fetch_job', 'drain queue', 'fetch job 從 urt_comment_queue 消化待抓影片。'),
                self::edge('comment_fetch_job', 'comment_tables', 'write comments', 'commentThreads.list 回應被解析後寫入 comment/author/revision tables。'),
                self::edge('comment_tables', 'tag_comments_report', 'aggregate authors', '頁面服務讀本機留言與影片資料並聚合作者。'),
                self::edge('tag_comments_report', 'tag_comments_page', 'render comments', 'Blade 輸出留言影片表與作者排行。'),
            ],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private static function tagDays(): array
    {
        return [
            'title' => '逐日標籤',
            'summary' => '本頁把頻道 tag 篩選、逐日 cache、必要時的本機影片推導結果合併成每日關聯標籤排行。',
            'jobs' => [
                self::job(
                    key: 'youtube.tag_videos.backfill',
                    label: '指定 tag 影片回填',
                    command: 'youtube:tag-videos:backfill --execute --tagid={tagid} --days=2',
                    apiCalls: ['YouTube Data API playlistItems.list(part=snippet)'],
                    reads: ['urt_count.tags selected channels'],
                    writes: ['urt_video', 'urt_video_schedule', 'urt_video_live', 'urt_show_tag_date'],
                    summary: '針對高流量頻道 tag 分頁爬取 uploads playlist，補齊本機影片資料並可重建逐日 tag cache。',
                    scheduler: 'config/ingestion.php job youtube.tag_videos.backfill；每日 8 次，需在 scheduled-write allowlist 中。',
                ),
                self::job(
                    key: 'reports.tag_date.build',
                    label: '逐日 tag cache 重建',
                    command: 'reports:tag-date:build --execute --tagid={tagid} --days=30 --keyword-limit=5000',
                    apiCalls: [],
                    reads: ['urt_video', 'urt_count', 'tags'],
                    writes: ['urt_show_tag_date'],
                    summary: '不呼叫外部 API；從本機影片、頻道 tag 與關鍵字表重建 urt_show_tag_date。',
                    scheduler: 'config/ingestion.php job reports.tag_date.build；每日 6 次，scheduled-write gates 通過後執行。',
                ),
                self::job(
                    key: 'reports.people.build',
                    label: '人物 tag cache 重建',
                    command: 'reports:people:build --execute --tagid=13 --days=37 --keyword-limit=5000',
                    apiCalls: [],
                    reads: ['tag_group', 'urt_video', 'urt_count', 'tags'],
                    writes: ['urt_show_tag_date'],
                    summary: '針對人物群組挑選候選關鍵字，重建人物相關逐日 tag cache。',
                    scheduler: 'config/ingestion.php job reports.people.build；每日 6 次，scheduled-write gates 通過後執行。',
                ),
            ],
            'render' => [
                'controller' => 'App\Http\Controllers\Reports\TagDailyRelationController',
                'service' => 'App\Services\Legacy\TagDailyRelationReport',
                'reads' => ['urt_tag', 'urt_show_tag_date', 'urt_video', 'urt_count', 'tags'],
                'request' => '頁面請求優先讀 urt_show_tag_date；cache miss 時用本機 urt_video/urt_count/tags 即時計算 fallback，不呼叫外部 API，也不寫 DB。',
                'transforms' => [
                    '從 route tagId 與 query string 解析 tagid、or、not、days、from、to、type、diff。',
                    '先查 urt_show_tag_date，依 tagid/tag_or/tag_not/the_date 讀取 cache rows。',
                    '解析 tags_result、tags_video 或 tags_views JSON，套用 stopwords 並組成每日排行。',
                    'cache miss 時用 TagDateCacheBuilder 從 urt_video、urt_count、tags 即時計算 fallback。',
                    'Blade 顯示逐日標籤矩陣與每日總量。',
                ],
            ],
            'fixed_sources' => [
                self::fixedSource('Legacy visible tag ids', 'App\Services\Legacy\LegacyTagFilter::visibleTags', '可見分類 id 清單寫在程式碼中；只有部署新版本才會變更。'),
                self::fixedSource('內建 stopwords fallback', 'App\Services\Legacy\LegacyStopwords::FALLBACK', '逐日排行解析後會排除這些固定停用詞。'),
                self::fixedSource('TagDate keyword scan default', 'reports:tag-date:build --keyword-limit=5000', '預設掃描本機前 5000 個關鍵字；不是頁面瀏覽時動態決定。'),
            ],
            'sources' => [
                self::source('urt_show_tag_date', 'urt_show_tag_date', ['mtime', 'ctime', 'the_date']),
                self::source('urt_video', 'urt_video', ['mtime', 'publishedAt']),
                self::source('urt_count', 'urt_count', ['mtime', 'ctime']),
                self::source('tags', 'tags', ['mtime', 'ctime']),
            ],
            'graph' => [
                self::fixedNode('tag_filter', 'tag 篩選條件', 'route tagId 會併入 tagid；query string 的 or/not/days/from/to/type/diff 決定 cache 查詢與呈現方式。'),
                self::jobNode('youtube_uploads', 'YouTube uploads 回填', 'api', 'youtube.tag_videos.backfill', '高流量 tag 頁可先分頁抓 selected channels 的 uploads，再重建逐日 cache。'),
                self::combinedSourceNode('raw_tag_inputs', '本機影片與頻道 tag', ['urt_video', 'urt_count', 'tags'], 'TagDateCacheBuilder 會用 urt_count 選頻道、掃 urt_video 文字，並用 tags 作為可匹配關鍵字集合。'),
                self::sourceNode('tag_date_cache', 'urt_show_tag_date cache', 'cache', 'urt_show_tag_date', 'urt_show_tag_date 保存每天的 tags_result、tags_video、tags_views 與每日總量，是本頁優先讀取的 materialized view。', [
                    'job_details' => ['reports.tag_date.build', 'reports.people.build'],
                ]),
                self::serviceNode('tag_daily_report', '逐日排行服務', '先讀 cache；cache miss 時改由本機資料即時計算 fallback，不會在頁面請求中寫入 DB。'),
                self::pageNode('tag_days_page', '逐日標籤頁', '/tags/{tagId}/days', 'Blade 顯示天數切換、類型切換、filter chips、逐日排行矩陣與每日總量表。'),
            ],
            'edges' => [
                self::edge('tag_filter', 'youtube_uploads', 'select channels', 'tagid/or/not 會決定需要回填或重建 cache 的頻道集合。'),
                self::edge('youtube_uploads', 'raw_tag_inputs', 'crawl uploads', 'youtube:tag-videos:backfill 分頁抓 uploads playlist，寫入本機影片表。'),
                self::edge('raw_tag_inputs', 'tag_date_cache', 'build cache', 'TagDateCacheBuilder 從本機影片、頻道 tag、關鍵字建立逐日 cache。'),
                self::edge('tag_date_cache', 'tag_daily_report', 'decode JSON', 'TagDailyRelationReport 解析 cache JSON 欄位並套用 diff/type/stopwords。'),
                self::edge('tag_daily_report', 'tag_days_page', 'render matrix', 'Blade 呈現逐日排行矩陣與每日總量。'),
            ],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private static function tagCloud(): array
    {
        return [
            'title' => '標籤文字雲',
            'summary' => '本頁讀取 tag cloud cache，並用短天期與長天期權重差分產生標籤文字雲與排行。',
            'jobs' => [
                self::job(
                    key: 'reports.tag_cloud.build',
                    label: '標籤文字雲 cache 重建',
                    command: 'reports:tag-cloud:build --execute --days=1,3,7,30,90 --tagid=1,2,3,4,5,6,13,14,81 --keyword-limit=5000',
                    apiCalls: [],
                    reads: ['urt_video', 'urt_count', 'tags'],
                    writes: ['urt_show_tag_cloud'],
                    summary: '不呼叫外部 API；從本機影片、頻道 tag 與關鍵字表重建 urt_show_tag_cloud。',
                    scheduler: 'config/ingestion.php job reports.tag_cloud.build；每日 6 次，scheduled-write gates 通過後執行。',
                ),
                self::job(
                    key: 'youtube.tag_videos.backfill',
                    label: '上游影片回填',
                    command: 'youtube:tag-videos:backfill --execute --tagid={tagid} --days=2',
                    apiCalls: ['YouTube Data API playlistItems.list(part=snippet)'],
                    reads: ['urt_count.tags selected channels'],
                    writes: ['urt_video', 'urt_video_schedule', 'urt_video_live', 'urt_show_tag_date'],
                    summary: '只在 ingestion job 執行時呼叫 YouTube；補齊 urt_video 後，tag cloud cache builder 才有本機來源可聚合。',
                    scheduler: 'config/ingestion.php job youtube.tag_videos.backfill；每日 8 次，需在 scheduled-write allowlist 中。',
                ),
            ],
            'render' => [
                'controller' => 'App\Http\Controllers\Reports\TagDataGapController::cloud',
                'service' => 'App\Services\Legacy\TagCloudReport::forTagFilters',
                'reads' => ['urt_show_tag_cloud', 'urt_video', 'urt_count', 'tags', 'urt_tag'],
                'request' => '頁面 request 本身不呼叫 YouTube 或外部 API；有 cache 時只讀 urt_show_tag_cloud，並在 request 時即時計算短長天期差分。',
                'transforms' => [
                    '解析 tagid/or/not/days/limit，route tagId 會併入 tagid。',
                    '依 days 讀短天期 urt_show_tag_cloud，再用 longDays 讀長天期 cache。',
                    '若沒有指定 days 且短天期沒有結果，依序 fallback 到 7 天與 30 天 cache。',
                    '套用 stopwords 後計算 short - normalized long 的差分權重。',
                    'Blade 呈現 D3 word cloud、差分排行與原始短長天期資料。',
                ],
            ],
            'fixed_sources' => [
                self::fixedSource('Legacy visible tag ids', 'App\Services\Legacy\LegacyTagFilter::visibleTags', '可見分類 id 清單寫在程式碼中；只有部署新版本才會變更。'),
                self::fixedSource('內建 stopwords fallback', 'App\Services\Legacy\LegacyStopwords::FALLBACK', '文字雲排行解析後會排除這些固定停用詞。'),
                self::fixedSource('TagCloud keyword scan default', 'reports:tag-cloud:build --keyword-limit=5000', '預設掃描本機前 5000 個關鍵字；不是頁面瀏覽時動態決定。'),
            ],
            'sources' => [
                self::source('urt_show_tag_cloud', 'urt_show_tag_cloud', ['mtime', 'ctime']),
                self::source('urt_video', 'urt_video', ['mtime', 'publishedAt']),
                self::source('urt_count', 'urt_count', ['mtime', 'ctime']),
                self::source('tags', 'tags', ['mtime', 'ctime']),
                self::source('urt_tag', 'urt_tag', ['mtime', 'ctime']),
            ],
            'graph' => [
                self::fixedNode('tag_cloud_filters', 'tag 篩選與 stopwords', 'tagid/or/not 決定頻道集合；stopwords 與可見 tag 規則隨部署更新，不會由排程改寫。'),
                self::combinedSourceNode('tag_cloud_inputs', 'urt_video / urt_count / tags', ['urt_video', 'urt_count', 'tags'], 'TagCloudCacheBuilder 從本機影片文字、頻道 tag 與關鍵字表建立文字雲來源。', [
                    'job_details' => ['youtube.tag_videos.backfill'],
                ]),
                self::jobNode('tag_cloud_job', 'reports:tag-cloud:build', 'service', 'reports.tag_cloud.build', '排程或手動 execute 會重建 urt_show_tag_cloud；不會在頁面 request 內寫 cache。'),
                self::sourceNode('tag_cloud_cache', 'urt_show_tag_cloud cache', 'cache', 'urt_show_tag_cloud', '保存 tagid/or/not/days 對應的 tags_result 與影片/頻道/關鍵字總量。', [
                    'job_details' => ['reports.tag_cloud.build'],
                ]),
                self::serviceNode('tag_cloud_report', 'TagCloudReport 差分計算', '讀取短天期與長天期 cache，套用 stopwords 後於 request 時即時計算差分分數。'),
                self::pageNode('tag_cloud_page', '標籤文字雲頁', '/tags/{tagId}/cloud 或 /tags/cloud', 'Blade 呈現 D3 word cloud、差分排行、原始短長天期表格與缺資料提示。'),
            ],
            'edges' => [
                self::edge('tag_cloud_filters', 'tag_cloud_inputs', 'select channels', 'tag filter 決定 cache builder 掃描哪些頻道影片。'),
                self::edge('tag_cloud_inputs', 'tag_cloud_job', 'aggregate input', 'reports:tag-cloud:build 讀本機資料，不呼叫外部 API。'),
                self::edge('tag_cloud_job', 'tag_cloud_cache', 'write cache', 'execute mode upsert urt_show_tag_cloud rows。'),
                self::edge('tag_cloud_cache', 'tag_cloud_report', 'read periods', '頁面讀短天期與長天期 cache row。'),
                self::edge('tag_cloud_report', 'tag_cloud_page', 'render cloud', 'request 時即時計算差分權重並輸出 D3 payload。'),
            ],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private static function tagLiveVideos(): array
    {
        return [
            'title' => '標籤直播影片排行',
            'summary' => '本頁依 tag filters 讀本機直播每日 log 與直播顯示 cache，計算單日或期間直播影片的最高同時觀看排行。',
            'jobs' => [
                self::job(
                    key: 'youtube.live.poll',
                    label: '直播狀態輪詢',
                    command: 'youtube:live:poll --execute --limit=50',
                    apiCalls: ['YouTube Data API videos.list(part=liveStreamingDetails)'],
                    reads: ['urt_video_live'],
                    writes: ['urt_video_live', 'urt_video_live_log'],
                    summary: '更新直播 concurrent viewers 與每日 log_json/max_current；只在 job 執行時呼叫 YouTube。',
                    scheduler: 'config/ingestion.php job youtube.live.poll；每分鐘，scheduled-write gates 通過後執行。',
                ),
                self::job(
                    key: 'reports.live.build',
                    label: '直播顯示 cache 補齊',
                    command: 'reports:live:build --execute --hours=24 --limit=100',
                    apiCalls: [],
                    reads: ['urt_video_live', 'urt_video'],
                    writes: ['urt_show_video_live'],
                    summary: '不呼叫外部 API；用本機 live/video rows 補齊直播標題、縮圖與頻道顯示 cache。',
                    scheduler: 'config/ingestion.php job reports.live.build；依時段每 9 或 19 分鐘。',
                ),
            ],
            'render' => [
                'controller' => 'App\Http\Controllers\Reports\TagLiveVideosController',
                'service' => 'App\Services\Legacy\TagLiveVideosReport',
                'reads' => ['urt_video_live_log', 'urt_show_video_live', 'urt_count', 'urt_tag'],
                'request' => '頁面 request 本身不呼叫 YouTube API；只讀本機 live log/display cache/tag rows，依日期、tag filters 與 limit 即時計算排行。',
                'transforms' => [
                    'route tagId 併入 tagid，query 支援 date/from/to/or/not/limit。',
                    'LegacyTagFilter 從 urt_count.tags 選出符合條件頻道。',
                    '讀 urt_video_live_log 的 max_current，單日或區間依最高觀看排序。',
                    '用 urt_show_video_live 補縮圖、標題與頻道，並解析 log_json 最後 24 筆趨勢。',
                ],
            ],
            'fixed_sources' => [
                self::fixedSource('Live date lower bound', 'TagLiveVideosReport::boundedDate min 2022-11-19', '固定日期下限寫死在 service；隨部署更新。'),
                self::fixedSource('Trend sample limit', 'TagLiveVideosReport::trendValues()->slice(-24)', '趨勢最多顯示最後 24 筆 sample；不會由排程更新。'),
                self::fixedSource('Legacy visible tag ids', 'App\Services\Legacy\LegacyTagFilter::visibleTags', '可見 tag id 清單寫在程式碼；隨部署更新。'),
            ],
            'sources' => [
                self::source('urt_video_live_log', 'urt_video_live_log', ['mtime', 'ctime', 'the_date']),
                self::source('urt_show_video_live', 'urt_show_video_live', ['mtime', 'ctime', 'publishedAt']),
                self::source('urt_count', 'urt_count', ['mtime', 'ctime']),
                self::source('urt_tag', 'urt_tag', ['mtime', 'ctime']),
            ],
            'graph' => [
                self::fixedNode('tag_live_filters', 'date / tag filters', 'date/from/to/tagid/or/not/limit 都在 request 時套用；日期下限與趨勢長度隨部署更新。'),
                self::jobNode('tag_live_poll_job', 'YouTube live polling', 'api', 'youtube.live.poll', '只有 ingestion job 會呼叫 YouTube liveStreamingDetails；頁面 request 不呼叫 API。'),
                self::combinedSourceNode('tag_live_tables', 'live log + tag tables', ['urt_video_live_log', 'urt_count', 'urt_tag'], '直播最高觀看、頻道 tag 與 tag 名稱都來自本機 DB。', [
                    'job_details' => ['youtube.live.poll'],
                ]),
                self::sourceNode('tag_live_display_cache', 'urt_show_video_live display cache', 'cache', 'urt_show_video_live', '補齊直播排行需要的縮圖、標題、頻道與發布時間。', [
                    'job_details' => ['reports.live.build'],
                ]),
                self::serviceNode('tag_live_report', 'TagLiveVideosReport 排行', 'request 時合併 live log、display cache 與 tag chips，依 max_current 排序。'),
                self::pageNode('tag_live_page', '標籤直播影片頁', '/tags/{tagId}/live/videos', 'Blade 呈現日期/區間切換、直播影片排行與趨勢文字。'),
            ],
            'edges' => [
                self::edge('tag_live_filters', 'tag_live_poll_job', 'poll scope', '固定 active live 來源與 tag/date filters 決定觀察範圍。'),
                self::edge('tag_live_poll_job', 'tag_live_tables', 'write log', 'youtube:live:poll 更新每日 live log。'),
                self::edge('tag_live_tables', 'tag_live_display_cache', 'display lookup', 'reports:live:build 補齊 display cache。'),
                self::edge('tag_live_display_cache', 'tag_live_report', 'merge display', '報表服務合併 log 與 display cache。'),
                self::edge('tag_live_report', 'tag_live_page', 'render ranking', 'Blade 輸出直播影片排行。'),
            ],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private static function tagTrends(): array
    {
        return [
            'title' => '標籤趨勢折線圖',
            'summary' => '本頁直接讀 urt_show_tag_date cache，依 tag filters 與日期範圍即時計算七日 rolling 的觀看數、影片數或每影片觀看趨勢。',
            'jobs' => [
                self::job(
                    key: 'reports.tag_date.build',
                    label: '逐日 tag cache 重建',
                    command: 'reports:tag-date:build --tagid=1 --days=30 --execute',
                    apiCalls: [],
                    reads: ['urt_video', 'urt_count', 'tags'],
                    writes: ['urt_show_tag_date'],
                    summary: '不呼叫外部 API；從本機影片、頻道 tag 與關鍵字表重建逐日 tag cache。',
                    scheduler: 'config/ingestion.php job reports.tag_date.build；每日 6 次，scheduled-write gates 通過後執行。',
                ),
                self::job(
                    key: 'youtube.tag_videos.backfill',
                    label: '上游 tag 影片回填',
                    command: 'youtube:tag-videos:backfill --execute --tagid={tagid} --days=2',
                    apiCalls: ['YouTube Data API playlistItems.list(part=snippet)'],
                    reads: ['urt_count.tags selected channels'],
                    writes: ['urt_video', 'urt_video_schedule', 'urt_video_live', 'urt_show_tag_date'],
                    summary: '高流量 tag 可先分頁抓 uploads，補齊 urt_video 後重建 urt_show_tag_date。',
                    scheduler: 'config/ingestion.php job youtube.tag_videos.backfill；每日 8 次，需在 scheduled-write allowlist 中。',
                ),
            ],
            'render' => [
                'controller' => 'App\Http\Controllers\Reports\TagTrendController',
                'service' => 'App\Services\Legacy\TagTrendReport',
                'reads' => ['urt_show_tag_date', 'urt_tag'],
                'request' => '頁面 request 本身不呼叫 YouTube API；只讀本機 urt_show_tag_date/urt_tag，依 type/date/tag filters 即時計算 rolling series。',
                'transforms' => [
                    '解析 tagid/or/not、type、days/from/to/today，type 只允許 count_videos/total_views/average。',
                    '讀取含 cache_from 的 urt_show_tag_date rows，確保七日 rolling 有足夠前置資料。',
                    '對每個日期累加當日與前 6 日 total_views/count_videos，計算 rolling value。',
                    'Blade 用 series 產生 SVG 折線圖與期間摘要。',
                ],
            ],
            'fixed_sources' => [
                self::fixedSource('Tag trend metrics', 'TagTrendReport::types count_videos,total_views,average', '可選指標寫死在 service；隨部署更新。'),
                self::fixedSource('7-day rolling rule', 'TagTrendReport::cache offsets 0..6', '七日 rolling 規則固定；不是排程更新來源。'),
                self::fixedSource('Range bounds', 'days<=366, today<=3650, series<=367 dates', 'query bounds 寫死在程式碼。'),
            ],
            'sources' => [
                self::source('urt_show_tag_date', 'urt_show_tag_date', ['mtime', 'ctime', 'the_date']),
                self::source('urt_tag', 'urt_tag', ['mtime', 'ctime']),
            ],
            'graph' => [
                self::jobNode('tag_trend_cache_job', 'reports:tag-date:build', 'service', 'reports.tag_date.build', '重建 urt_show_tag_date；不在頁面 request 寫 cache。', [
                    'job_details' => ['youtube.tag_videos.backfill'],
                ]),
                self::sourceNode('tag_trend_cache', 'urt_show_tag_date cache', 'cache', 'urt_show_tag_date', '保存每日影片數、觀看數與關鍵字 JSON；本頁使用 total_views/count_videos rolling series。'),
                self::fixedNode('tag_trend_rules', 'type/date rolling rules', 'type whitelist、日期範圍與七日 rolling 規則都寫在報表服務。'),
                self::serviceNode('tag_trend_report', 'TagTrendReport rolling series', 'request 時從 cache 聚合 rolling values，不呼叫外部 API、不寫 DB。'),
                self::pageNode('tag_trend_page', '標籤趨勢頁', '/tags/{tagId}/trends', 'Blade 呈現切換 controls、SVG 折線圖與 cache row 狀態。'),
            ],
            'edges' => [
                self::edge('tag_trend_cache_job', 'tag_trend_cache', 'write cache', 'reports:tag-date:build/upstream backfill 維護逐日 cache。'),
                self::edge('tag_trend_cache', 'tag_trend_rules', 'select range', 'request filters 決定 cache lookup 與 metric。'),
                self::edge('tag_trend_rules', 'tag_trend_report', 'rolling aggregate', 'TagTrendReport 即時計算七日 rolling series。'),
                self::edge('tag_trend_report', 'tag_trend_page', 'render chart', 'Blade 輸出趨勢圖。'),
            ],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private static function tagComparison(): array
    {
        return [
            'title' => '多關鍵字趨勢比較',
            'summary' => '本頁讀 urt_show_tag_date cache，對同一 tag 篩選下的多個關鍵字做七日 rolling 趨勢比較。',
            'jobs' => [
                self::job(
                    key: 'reports.tag_date.build',
                    label: '逐日 tag cache 重建',
                    command: 'reports:tag-date:build --tagid=1 --days=30 --execute',
                    apiCalls: [],
                    reads: ['urt_video', 'urt_count', 'tags'],
                    writes: ['urt_show_tag_date'],
                    summary: '不呼叫外部 API；重建 tags_video/tags_views/tags_result JSON，供多關鍵字比較使用。',
                    scheduler: 'config/ingestion.php job reports.tag_date.build；每日 6 次，scheduled-write gates 通過後執行。',
                ),
            ],
            'render' => [
                'controller' => 'App\Http\Controllers\Reports\TagComparisonController',
                'service' => 'App\Services\Legacy\TagComparisonReport',
                'reads' => ['urt_show_tag_date', 'urt_tag'],
                'request' => '頁面 request 本身不呼叫外部 API；只讀 urt_show_tag_date，依 tags/type/date filters 即時計算 comparison series。',
                'transforms' => [
                    '沒有 tag filters 時預設 tagid=1；keywords 預設為固定 DEFAULT_TAGS。',
                    'type 只允許 tags_video/tags_views/tags_result，日期最多 90 天。',
                    '先找 exact filter cache；多 tagid 且無 or/not 時可 fallback 聚合 singleton tag rows。',
                    '每個 keyword 取當日與前 6 日值加總，產生多線圖 series。',
                ],
            ],
            'fixed_sources' => [
                self::fixedSource('Default compared keywords', 'TagComparisonReport::DEFAULT_TAGS = 蔡英文,柯文哲,侯友宜,陳時中', '預設比較關鍵字寫死在程式碼；隨部署更新。'),
                self::fixedSource('Comparison metrics', 'TagComparisonReport::types tags_video,tags_views,tags_result', '可選指標固定；不會由排程更新。'),
                self::fixedSource('Comparison bounds', 'keywords<=12, days<=90', 'query bounds 寫死在 service。'),
            ],
            'sources' => [
                self::source('urt_show_tag_date', 'urt_show_tag_date', ['mtime', 'ctime', 'the_date']),
                self::source('urt_tag', 'urt_tag', ['mtime', 'ctime']),
            ],
            'graph' => [
                self::jobNode('tag_compare_cache_job', 'reports:tag-date:build', 'service', 'reports.tag_date.build', '維護多關鍵字比較需要的逐日 JSON cache。'),
                self::sourceNode('tag_compare_cache', 'urt_show_tag_date cache', 'cache', 'urt_show_tag_date', '保存 tags_video/tags_views/tags_result JSON，讓頁面只需讀本機 cache。'),
                self::fixedNode('tag_compare_rules', 'keywords / metric rules', 'DEFAULT_TAGS、type aliases、最多 12 個 keyword 與七日 rolling 規則隨部署更新。'),
                self::serviceNode('tag_compare_report', 'TagComparisonReport comparison series', 'request 時解析 JSON、必要時聚合 singleton rows，計算每個 keyword 的 rolling values。'),
                self::pageNode('tag_compare_page', '多關鍵字趨勢比較頁', '/tags/compare', 'Blade 呈現多線圖、legend 與 filter controls。'),
            ],
            'edges' => [
                self::edge('tag_compare_cache_job', 'tag_compare_cache', 'write cache', 'reports:tag-date:build 更新逐日 cache。'),
                self::edge('tag_compare_cache', 'tag_compare_rules', 'decode JSON', 'request filters 決定讀哪個 JSON 欄位與哪些 keywords。'),
                self::edge('tag_compare_rules', 'tag_compare_report', 'rolling compare', 'TagComparisonReport 即時計算 comparison series。'),
                self::edge('tag_compare_report', 'tag_compare_page', 'render lines', 'Blade 輸出趨勢比較圖。'),
            ],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private static function keywordCloud(): array
    {
        return [
            'title' => '關鍵字文字雲',
            'summary' => '本頁優先讀取 legacy keyword relation cloud cache；缺 cache 時用本機影片與 tags 在 request 時推導文字雲，不寫 DB。',
            'jobs' => [
                self::job(
                    key: 'legacy.keyword_cloud.cache',
                    label: 'Legacy keyword cloud cache',
                    command: 'approved legacy snapshot or DB export -> urt_show_tag_cloud_tag',
                    apiCalls: [],
                    reads: ['approved legacy snapshot/export', 'urt_show_video_tag', 'urt_video_log_history'],
                    writes: ['urt_show_tag_cloud_tag'],
                    summary: '目前 Laravel scheduler 不會產生 urt_show_tag_cloud_tag；既有資料來自 approved legacy cache/export，缺資料時頁面改用本機 fallback。',
                    scheduler: '不會由目前 Laravel 排程更新；若要常態更新，需新增 reviewed Laravel command/job。',
                ),
                self::job(
                    key: 'reports.keywords.build',
                    label: '關鍵字同步',
                    command: 'reports:keywords:build --execute --hours=2 --limit=100',
                    apiCalls: ['https://tag.analysis.tw/api/tag_json.php?hours={hours}'],
                    reads: [],
                    writes: ['tags'],
                    summary: 'fallback 需要 tags 作為可掃描關鍵字集合；同步工作只在 ingestion 執行時呼叫外部 API。',
                    scheduler: 'config/ingestion.php job reports.keywords.build；每日 6 次，scheduled-write gates 通過後執行。',
                ),
            ],
            'render' => [
                'controller' => 'App\Http\Controllers\Reports\TagDataGapController::keywordCloud',
                'service' => 'App\Services\Legacy\TagCloudReport::forKeyword',
                'reads' => ['urt_show_tag_cloud_tag', 'urt_show_video_tag', 'urt_video_log_history', 'urt_video', 'urt_count', 'tags'],
                'request' => '頁面 request 本身不呼叫 YouTube、tag.analysis 或 AI API；cache miss 時用 urt_video + tags 即時計算 fallback，不寫 DB。',
                'transforms' => [
                    '解析 keyword、tagid/or/not、days 與 limit。',
                    '優先讀取 urt_show_tag_cloud_tag 的短天期與長天期 cache。',
                    'cache miss 時用 KeywordRelationFallback 掃 urt_video title/description 與 tags 推導文字雲。',
                    '套用 stopwords 後計算 short - normalized long 的差分權重。',
                    'Blade 呈現 D3 word cloud、差分排行與原始短長天期資料。',
                ],
            ],
            'fixed_sources' => [
                self::fixedSource('Keyword fallback scan limits', 'KeywordRelationFallback::KEYWORD_LIMIT=5000, VIDEO_LIMIT=10000', '寫死在程式碼；只有部署新版本才會變更。'),
                self::fixedSource('內建 stopwords fallback', 'App\Services\Legacy\LegacyStopwords::FALLBACK', '文字雲排行解析後會排除這些固定停用詞。'),
                self::fixedSource('Legacy keyword cloud cache', 'urt_show_tag_cloud_tag', '目前沒有 Laravel 排程 job 會重建；不是 scheduler 更新來源。'),
            ],
            'sources' => [
                self::source('urt_show_tag_cloud_tag', 'urt_show_tag_cloud_tag', ['mtime', 'ctime']),
                self::source('urt_show_video_tag', 'urt_show_video_tag', ['mtime', 'ctime', 'the_date']),
                self::source('urt_video_log_history', 'urt_video_log_history', ['mtime', 'ctime', 'the_date']),
                self::source('urt_video', 'urt_video', ['mtime', 'publishedAt']),
                self::source('urt_count', 'urt_count', ['mtime', 'ctime']),
                self::source('tags', 'tags', ['mtime', 'ctime']),
            ],
            'graph' => [
                self::fixedNode('keyword_cloud_rules', 'keyword filters / fixed limits', 'keyword、tagid/or/not 與 fallback 掃描上限由 route/query 與程式碼規則決定。'),
                self::sourceNode('keyword_cloud_cache', 'urt_show_tag_cloud_tag cache', 'cache', 'urt_show_tag_cloud_tag', '保存 legacy keyword relation 文字雲 cache；目前不由 Laravel scheduler 常態重建。', [
                    'job_details' => ['legacy.keyword_cloud.cache'],
                ]),
                self::combinedSourceNode('keyword_cloud_fallback', 'urt_video + tags fallback', ['urt_video', 'urt_count', 'tags'], 'cache miss 時即時掃本機影片標題/描述與關鍵字集合推導文字雲。', [
                    'job_details' => ['reports.keywords.build'],
                ]),
                self::serviceNode('keyword_cloud_report', 'KeywordRelationFallback + TagCloudReport', '優先讀 cache；缺 cache 時在 request 內計算 fallback，套用 stopwords 與差分排序。'),
                self::pageNode('keyword_cloud_page', '關鍵字文字雲頁', '/keywords/{keyword}/cloud', 'Blade 呈現 D3 word cloud、差分排行、原始短長天期表格與缺資料提示。'),
            ],
            'edges' => [
                self::edge('keyword_cloud_rules', 'keyword_cloud_cache', 'select cache', 'keyword 與 tag filters 決定要讀哪一組 legacy cache row。'),
                self::edge('keyword_cloud_cache', 'keyword_cloud_fallback', 'cache miss', '若 cache 不存在或沒有 words，改由本機 urt_video + tags 推導。'),
                self::edge('keyword_cloud_fallback', 'keyword_cloud_report', 'score words', 'TagCloudReport 套用 stopwords 並計算短長天期差分。'),
                self::edge('keyword_cloud_report', 'keyword_cloud_page', 'render cloud', 'request 時即時計算 D3 payload 與排行表。'),
            ],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private static function keywordDays(): array
    {
        return [
            'title' => '關鍵字逐日排行',
            'summary' => '本頁優先讀取 keyword relation daily cache；缺 cache 時用本機影片標題/描述與 tags 在 request 時推導逐日關聯關鍵字。',
            'jobs' => [
                self::job(
                    key: 'legacy.keyword_relation.cache',
                    label: 'Legacy keyword relation cache',
                    command: 'approved legacy snapshot or DB export -> urt_show_video_tag_date',
                    apiCalls: [],
                    reads: ['approved legacy snapshot/export', 'urt_show_video_tag', 'urt_video_log_history'],
                    writes: ['urt_show_video_tag_date'],
                    summary: '目前 Laravel scheduler 不會常態產生 urt_show_video_tag_date；既有 rows 來自 approved legacy cache/export，缺資料時頁面用本機 fallback。',
                    scheduler: '不會由目前 Laravel 排程更新；若要常態更新，需新增 reviewed Laravel command/job。',
                ),
                self::job(
                    key: 'reports.keywords.build',
                    label: '關鍵字同步',
                    command: 'reports:keywords:build --execute --hours=2 --limit=100',
                    apiCalls: ['https://tag.analysis.tw/api/tag_json.php?hours={hours}'],
                    reads: [],
                    writes: ['tags'],
                    summary: 'fallback 需要 tags 作為可掃描關鍵字集合；同步工作只在 ingestion 執行時呼叫外部 API。',
                    scheduler: 'config/ingestion.php job reports.keywords.build；每日 6 次，scheduled-write gates 通過後執行。',
                ),
                self::job(
                    key: 'youtube.channels.videos.general',
                    label: '上游影片擷取',
                    command: 'youtube:channels:videos --execute --limit=5 --max-results=3',
                    apiCalls: ['YouTube Data API playlistItems.list(part=snippet)'],
                    reads: ['urt_channel', 'urt_count', 'urt_video_schedule'],
                    writes: ['urt_video', 'urt_video_schedule', 'urt_video_live', 'urt_channel.vtime'],
                    summary: '補齊 fallback 需要的本機 urt_video title/description；頁面 request 不呼叫 YouTube。',
                    scheduler: 'config/ingestion.php job youtube.channels.videos.general；每 5 分鐘。',
                ),
            ],
            'render' => [
                'controller' => 'App\Http\Controllers\Reports\TagDailyRelationController::keyword',
                'service' => 'App\Services\Legacy\TagDailyRelationReport::forKeyword',
                'reads' => ['urt_show_video_tag_date', 'urt_video', 'tags'],
                'request' => '頁面 request 本身不呼叫 YouTube、tag.analysis 或 AI API；優先讀 urt_show_video_tag_date，cache miss 時用 urt_video + tags 即時計算 fallback，不寫 DB。',
                'transforms' => [
                    '從 route keyword 與 query 解析 type、days/from/to/today、diff。',
                    '優先依 tag=keyword 與日期範圍讀 urt_show_video_tag_date.tags_json。',
                    'cache miss 時由 KeywordRelationFallback 掃 urt_video title/description 與 tags 關鍵字集合。',
                    '套用 stopwords，依 diff 選項計算每日排行矩陣。',
                    'Blade 顯示逐日關聯關鍵字與每日 cache metrics。',
                ],
            ],
            'fixed_sources' => [
                self::fixedSource('Keyword relation cache status', 'urt_show_video_tag_date', '目前沒有 Laravel 排程 job 會常態重建；不是 scheduler 更新來源。'),
                self::fixedSource('Keyword fallback scan limits', 'KeywordRelationFallback::KEYWORD_LIMIT=5000, VIDEO_LIMIT=10000', '寫死在程式碼；只有部署新版本才會變更。'),
                self::fixedSource('內建 stopwords fallback', 'App\Services\Legacy\LegacyStopwords::FALLBACK', '逐日排行解析後會排除這些固定停用詞。'),
            ],
            'sources' => [
                self::source('urt_show_video_tag_date', 'urt_show_video_tag_date', ['mtime', 'ctime', 'the_date']),
                self::source('urt_video', 'urt_video', ['mtime', 'publishedAt']),
                self::source('tags', 'tags', ['mtime', 'ctime']),
            ],
            'graph' => [
                self::fixedNode('keyword_day_rules', 'keyword / range rules', 'keyword、日期範圍、type、diff 與 fallback scan limits 都在 request 時套用或隨部署更新。'),
                self::sourceNode('keyword_relation_cache', 'urt_show_video_tag_date cache', 'cache', 'urt_show_video_tag_date', '保存 legacy keyword relation daily tags_json/videos_json；目前不由 Laravel scheduler 常態重建。', [
                    'job_details' => ['legacy.keyword_relation.cache'],
                ]),
                self::combinedSourceNode('keyword_day_fallback', 'urt_video + tags fallback', ['urt_video', 'tags'], 'cache miss 時即時掃本機影片文字與 tags 關鍵字集合推導 daily relation。', [
                    'job_details' => ['reports.keywords.build', 'youtube.channels.videos.general'],
                ]),
                self::serviceNode('keyword_day_report', 'TagDailyRelationReport keyword mode', '優先讀 cache；缺 cache 時即時計算 fallback，套用 stopwords/diff 後產生每日矩陣。'),
                self::pageNode('keyword_day_page', '關鍵字逐日頁', '/keywords/{keyword}/days', 'Blade 呈現日期切換、filter chips、逐日排行矩陣、cache rows 與每日 metrics。'),
            ],
            'edges' => [
                self::edge('keyword_day_rules', 'keyword_relation_cache', 'select cache', 'keyword 與 date range 決定要讀哪些 daily relation rows。'),
                self::edge('keyword_relation_cache', 'keyword_day_fallback', 'cache miss', '若 urt_show_video_tag_date 沒有可用 rows，改用本機影片與 tags 推導。'),
                self::edge('keyword_day_fallback', 'keyword_day_report', 'rank keywords', 'TagDailyRelationReport 解析或推導 tags_json，套用 stopwords/diff。'),
                self::edge('keyword_day_report', 'keyword_day_page', 'render matrix', 'request 時即時計算矩陣後輸出頁面。'),
            ],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private static function keywordVideos(): array
    {
        return [
            'title' => '關鍵字影片排行',
            'summary' => '本頁從 keyword-video relation cache 取 videoId 清單後 join urt_video；缺 cache 時直接用本機影片標題/描述做即時 fallback。',
            'jobs' => [
                self::job(
                    key: 'legacy.keyword_relation.cache',
                    label: 'Legacy keyword-video relation cache',
                    command: 'approved legacy snapshot or DB export -> urt_show_video_tag_date',
                    apiCalls: [],
                    reads: ['approved legacy snapshot/export', 'urt_show_video_tag', 'urt_video_log_history'],
                    writes: ['urt_show_video_tag_date'],
                    summary: '目前 Laravel scheduler 不會常態產生 urt_show_video_tag_date videos_json；既有 rows 來自 approved legacy cache/export。',
                    scheduler: '不會由目前 Laravel 排程更新；若要常態更新，需新增 reviewed Laravel command/job。',
                ),
                self::job(
                    key: 'youtube.channels.videos.general',
                    label: '上游影片擷取',
                    command: 'youtube:channels:videos --execute --limit=5 --max-results=3',
                    apiCalls: ['YouTube Data API playlistItems.list(part=snippet)'],
                    reads: ['urt_channel', 'urt_count', 'urt_video_schedule'],
                    writes: ['urt_video', 'urt_video_schedule', 'urt_video_live', 'urt_channel.vtime'],
                    summary: '補齊本機 urt_video metadata，供 relation cache join 與 title/description fallback 使用。',
                    scheduler: 'config/ingestion.php job youtube.channels.videos.general；每 5 分鐘。',
                ),
                self::job(
                    key: 'youtube.videos.stats',
                    label: '影片統計輪詢',
                    command: 'youtube:videos:stats --execute --limit=25',
                    apiCalls: ['YouTube Data API videos.list(part=statistics)'],
                    reads: ['urt_video_schedule', 'urt_video'],
                    writes: ['urt_video', 'urt_video_schedule', 'urt_video_log', 'urt_video_log_history'],
                    summary: '更新本機 viewCount/likeCount/commentCount；頁面依目前 viewCount 排序。',
                    scheduler: 'config/ingestion.php job youtube.videos.stats；00-17 點每 7 分鐘。',
                ),
            ],
            'render' => [
                'controller' => 'App\Http\Controllers\Reports\TagDataGapController::keywordVideos',
                'service' => 'App\Services\Legacy\KeywordVideosReport',
                'reads' => ['urt_show_video_tag_date', 'urt_video'],
                'request' => '頁面 request 本身不呼叫 YouTube API；優先讀 urt_show_video_tag_date.videos_json，再 join 本機 urt_video；cache miss 時用 urt_video title/description 即時計算 fallback，不寫 DB。',
                'transforms' => [
                    '解析 keyword、days、hours、limit。',
                    '依 tag=keyword 與最近日期讀 urt_show_video_tag_date，展開 videos_json 中的 videoId。',
                    '用 videoId 清單 join urt_video，依 viewCount 排序。',
                    '若 cache 或 join 結果為空，用 KeywordRelationFallback::videoIds 搜尋 urt_video title/description。',
                    'Blade 顯示影片排行、cache rows、source 與 dependency 狀態。',
                ],
            ],
            'fixed_sources' => [
                self::fixedSource('Keyword-video cache status', 'urt_show_video_tag_date.videos_json', '目前沒有 Laravel 排程 job 會常態重建；不是 scheduler 更新來源。'),
                self::fixedSource('Keyword video bounds', 'KeywordVideosReport: days<=90, hours<=8760, limit<=1000', 'query bounds 寫死在程式碼；隨部署更新。'),
                self::fixedSource('Fallback text match', 'KeywordRelationFallback::videoIds title/description LIKE keyword', 'fallback 是 request 時本機 DB 搜尋，不會由排程更新。'),
            ],
            'sources' => [
                self::source('urt_show_video_tag_date', 'urt_show_video_tag_date', ['mtime', 'ctime', 'the_date']),
                self::source('urt_video', 'urt_video', ['mtime', 'publishedAt']),
            ],
            'graph' => [
                self::fixedNode('keyword_video_rules', 'keyword / period rules', 'keyword、days、hours、limit 與 fallback LIKE 規則都在 request 時套用；query bounds 隨部署更新。'),
                self::sourceNode('keyword_video_cache', 'urt_show_video_tag_date videos_json', 'cache', 'urt_show_video_tag_date', '保存 keyword/date 對應 videoId 清單；目前不由 Laravel scheduler 常態重建。', [
                    'job_details' => ['legacy.keyword_relation.cache'],
                ]),
                self::sourceNode('keyword_video_table', 'urt_video metadata', 'table', 'urt_video', '保存影片標題、頻道、縮圖與統計；cache join 與 fallback 都讀這張表。', [
                    'job_details' => ['youtube.channels.videos.general', 'youtube.videos.stats'],
                ]),
                self::serviceNode('keyword_video_report', 'KeywordVideosReport join + fallback', '優先 join cache video IDs；缺資料時即時搜尋 urt_video title/description，排序後輸出 rows。'),
                self::pageNode('keyword_video_page', '關鍵字影片頁', '/keywords/{keyword}/videos', 'Blade 呈現時間範圍、cache rows、source、影片排行與 dependency 狀態。'),
            ],
            'edges' => [
                self::edge('keyword_video_rules', 'keyword_video_cache', 'select videos_json', 'keyword 與日期範圍決定要讀哪些 relation cache rows。'),
                self::edge('keyword_video_cache', 'keyword_video_table', 'join videoId', '從 videos_json 展開 videoId 後讀取 urt_video metadata。'),
                self::edge('keyword_video_table', 'keyword_video_report', 'sort/fallback', 'KeywordVideosReport 依 viewCount 排序，必要時用 title/description fallback。'),
                self::edge('keyword_video_report', 'keyword_video_page', 'render ranking', 'Blade 輸出關鍵字影片排行榜。'),
            ],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private static function keywordGroupTrend(): array
    {
        return [
            'title' => '關鍵字群組趨勢',
            'summary' => '本頁把固定群組定義與 keyword/tag cache 結合，依群組維度比較指定關鍵字的七日 rolling 影片數、觀看數或每影片觀看。',
            'jobs' => [
                self::job(
                    key: 'reports.tag_date.build',
                    label: '逐日 tag cache 重建',
                    command: 'reports:tag-date:build --tagid=1 --days=30 --execute',
                    apiCalls: [],
                    reads: ['urt_video', 'urt_count', 'tags'],
                    writes: ['urt_show_tag_date'],
                    summary: '不呼叫外部 API；daily fallback 直接讀 urt_show_tag_date 中指定 keyword 的 JSON 值。',
                    scheduler: 'config/ingestion.php job reports.tag_date.build；每日 6 次，scheduled-write gates 通過後執行。',
                ),
                self::job(
                    key: 'legacy.keyword_group_month.cache',
                    label: 'Legacy keyword group monthly cache',
                    command: 'approved legacy snapshot/export -> urt_show_tag_month',
                    apiCalls: [],
                    reads: ['approved legacy snapshot/export'],
                    writes: ['urt_show_tag_month'],
                    summary: 'Laravel scheduler 目前不常態重建 urt_show_tag_month；若月快取缺資料，頁面 fallback 到 urt_show_tag_date。',
                    scheduler: '不會由目前 Laravel 排程更新；若要常態更新，需新增 reviewed Laravel command/job。',
                ),
            ],
            'render' => [
                'controller' => 'App\Http\Controllers\Reports\KeywordGroupTrendController',
                'service' => 'App\Services\Legacy\KeywordGroupTrendReport',
                'reads' => ['urt_show_tag_month', 'urt_show_tag_date'],
                'request' => '頁面 request 本身不呼叫外部 API；優先讀 urt_show_tag_month，有需要時 fallback 到 urt_show_tag_date，即時計算 rolling group series。',
                'transforms' => [
                    '從 route keyword 與 query group/view/type/days/from/to/today 解析範圍。',
                    'LegacyKeywordGroupDefinitions 提供固定群組與 tagid/or/not filter strings。',
                    '若 urt_show_tag_month 可用，解析 tags_result 內的 daily map；否則讀 urt_show_tag_date 的 keyword 值。',
                    '每個群組對每個日期累加前 6 日，產生 total_views/count_videos/views_video series。',
                ],
            ],
            'fixed_sources' => [
                self::fixedSource('Keyword group definitions', 'App\Services\Legacy\LegacyKeywordGroupDefinitions', '群組名稱、tag filter 與 labels 寫在程式碼；隨部署更新。'),
                self::fixedSource('Keyword group metrics', 'KeywordGroupTrendReport::type total_views,count_videos,views_video', '可選指標與 aliases 固定；不會由排程更新。'),
                self::fixedSource('Monthly cache status', 'urt_show_tag_month', '目前不由 Laravel scheduler 常態重建；缺資料時讀 daily cache。'),
            ],
            'sources' => [
                self::source('urt_show_tag_month', 'urt_show_tag_month', ['mtime', 'ctime', 'the_month']),
                self::source('urt_show_tag_date', 'urt_show_tag_date', ['mtime', 'ctime', 'the_date']),
            ],
            'graph' => [
                self::fixedNode('keyword_group_defs', 'fixed group definitions', 'group/view options 與 tag filter strings 寫在 LegacyKeywordGroupDefinitions；只有部署會變更。'),
                self::combinedSourceNode('keyword_group_caches', 'monthly/daily keyword caches', ['urt_show_tag_month', 'urt_show_tag_date'], '優先讀月快取，缺資料時 fallback 到逐日 cache。', [
                    'job_details' => ['legacy.keyword_group_month.cache', 'reports.tag_date.build'],
                ]),
                self::serviceNode('keyword_group_report', 'KeywordGroupTrendReport rolling group series', 'request 時解析 keyword 值，依固定群組計算七日 rolling series。'),
                self::pageNode('keyword_group_page', '關鍵字群組趨勢頁', '/keywords/{keyword}/groups/trends', 'Blade 呈現群組 selector、metric 切換、SVG 折線圖與 cache row 狀態。'),
            ],
            'edges' => [
                self::edge('keyword_group_defs', 'keyword_group_caches', 'select filters', '固定 group filters 決定 cache lookup。'),
                self::edge('keyword_group_caches', 'keyword_group_report', 'decode keyword', '報表服務從 cache JSON 抽指定 keyword 的 daily value。'),
                self::edge('keyword_group_report', 'keyword_group_page', 'render chart', 'Blade 輸出群組趨勢圖。'),
            ],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private static function keywordLiveTrend(): array
    {
        return [
            'title' => '關鍵字直播趨勢',
            'summary' => '本頁讀 legacy live tag-date cache，對固定直播群組比較指定關鍵字在每日小時資料中的最高直播觀看或影片數。',
            'jobs' => [
                self::job(
                    key: 'legacy.live_tag_date.cache',
                    label: 'Legacy live tag-date cache',
                    command: 'approved legacy snapshot/export -> urt_show_live_tag_date',
                    apiCalls: [],
                    reads: ['approved legacy snapshot/export', 'urt_video_live_log', 'urt_count'],
                    writes: ['urt_show_live_tag_date'],
                    summary: '目前 Laravel scheduler 不常態重建 tags_views/tags_video live keyword cache；頁面只讀既有 cache。',
                    scheduler: '不會由目前 Laravel 排程常態重建；reports:live:clean 只清理 invalid cache rows。',
                ),
                self::job(
                    key: 'youtube.live.poll',
                    label: '直播狀態輪詢',
                    command: 'youtube:live:poll --execute --limit=50',
                    apiCalls: ['YouTube Data API videos.list(part=liveStreamingDetails)'],
                    reads: ['urt_video_live'],
                    writes: ['urt_video_live', 'urt_video_live_log'],
                    summary: '更新 live log 上游；但本頁使用的 keyword live tag-date cache 目前不是 scheduler 常態重建目標。',
                    scheduler: 'config/ingestion.php job youtube.live.poll；每分鐘，scheduled-write gates 通過後執行。',
                ),
            ],
            'render' => [
                'controller' => 'App\Http\Controllers\Reports\KeywordLiveTrendController',
                'service' => 'App\Services\Legacy\KeywordLiveTrendReport',
                'reads' => ['urt_show_live_tag_date'],
                'request' => '頁面 request 本身不呼叫 YouTube API；讀 urt_show_live_tag_date.tags_views/tags_video，依群組與 keyword 即時計算 rolling series。',
                'transforms' => [
                    '從 route keyword 與 query group/view/type/days/from/to/today 解析範圍。',
                    'LegacyLiveGroupDefinitions 提供固定直播群組 filter strings。',
                    '讀每個群組的 urt_show_live_tag_date rows，解析 tags_views 或 tags_video JSON。',
                    '每個日期累加前 6 日，對 keyword 的每小時值取每日 max 後加總。',
                ],
            ],
            'fixed_sources' => [
                self::fixedSource('Live group definitions', 'App\Services\Legacy\LegacyLiveGroupDefinitions', '直播群組與 filter strings 寫在程式碼；隨部署更新。'),
                self::fixedSource('Live keyword metric rule', 'KeywordLiveTrendReport::type views/videos', 'type aliases 與每日 max-hour 取值規則寫死在 service。'),
                self::fixedSource('Live keyword cache status', 'urt_show_live_tag_date.tags_views/tags_video', '目前不由 Laravel scheduler 常態重建；不是頁面 request 產生。'),
            ],
            'sources' => [
                self::source('urt_show_live_tag_date', 'urt_show_live_tag_date', ['mtime', 'ctime', 'the_date']),
            ],
            'graph' => [
                self::fixedNode('keyword_live_defs', 'fixed live groups / metric rules', 'group filters、views/videos type 與七日 rolling max-hour 規則寫在程式碼。'),
                self::sourceNode('keyword_live_cache', 'urt_show_live_tag_date cache', 'cache', 'urt_show_live_tag_date', '保存 keyword live tags_views/tags_video hour maps；目前主要來自 legacy cache/export。', [
                    'job_details' => ['legacy.live_tag_date.cache', 'youtube.live.poll'],
                ]),
                self::serviceNode('keyword_live_report', 'KeywordLiveTrendReport rolling series', 'request 時解析指定 keyword 的 hourly map，取每日最大值並計算 rolling group series。'),
                self::pageNode('keyword_live_page', '關鍵字直播趨勢頁', '/keywords/{keyword}/live/trends', 'Blade 呈現直播群組 selector、metric 切換與趨勢圖。'),
            ],
            'edges' => [
                self::edge('keyword_live_defs', 'keyword_live_cache', 'select group cache', '固定 group filters 決定讀取哪組 live tag-date cache。'),
                self::edge('keyword_live_cache', 'keyword_live_report', 'max hourly value', '報表服務抽 keyword hour map，取每日 max 後 rolling 加總。'),
                self::edge('keyword_live_report', 'keyword_live_page', 'render chart', 'Blade 輸出關鍵字直播趨勢圖。'),
            ],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private static function liveCurrent(): array
    {
        return [
            'title' => '目前直播排行',
            'summary' => '本頁讀取本機 live polling rows、display cache 與今日趨勢 log，依目前觀看人數排序，不在頁面 request 呼叫 YouTube。',
            'jobs' => [
                self::job(
                    key: 'youtube.live.poll',
                    label: '直播狀態輪詢',
                    command: 'youtube:live:poll --execute --limit=50',
                    apiCalls: ['YouTube Data API videos.list(part=liveStreamingDetails)'],
                    reads: ['urt_video_live'],
                    writes: ['urt_video_live', 'urt_video_live_log'],
                    summary: '從本機 active live rows 選出需更新的 videoId，呼叫 YouTube liveStreamingDetails 後更新 viewers、ended 狀態與今日 log。',
                    scheduler: 'config/ingestion.php job youtube.live.poll；每分鐘，scheduled-write gates 通過後執行。',
                ),
                self::job(
                    key: 'reports.live.build',
                    label: '直播顯示 cache 補齊',
                    command: 'reports:live:build --execute --hours=24 --limit=100',
                    apiCalls: [],
                    reads: ['urt_video_live', 'urt_video'],
                    writes: ['urt_show_video_live'],
                    summary: '不呼叫外部 API；從本機 live rows 與影片 metadata 補齊直播列表顯示 cache。',
                    scheduler: 'config/ingestion.php job reports.live.build；依時段每 9 或 19 分鐘。',
                ),
                self::job(
                    key: 'reports.live.show',
                    label: '直播 dashboard snapshot',
                    command: 'reports:live:show',
                    apiCalls: [],
                    reads: ['urt_video_live', 'urt_show_video_live', 'urt_video_live_log'],
                    writes: [],
                    summary: '不呼叫外部 API；讀本機 live/cache rows 產生 snapshot，可用於 scheduler smoke check。',
                    scheduler: 'config/ingestion.php job reports.live.show；每 7 分鐘。',
                ),
            ],
            'render' => [
                'controller' => 'App\Http\Controllers\Reports\LiveCurrentController',
                'service' => 'App\Services\Legacy\LiveCurrentReport',
                'reads' => ['urt_video_live', 'urt_show_video_live', 'urt_video_live_log', 'urt_count', 'urt_tag'],
                'request' => '頁面 request 本身不呼叫 YouTube API；只讀本機 live/cache/log rows，依目前 query filters 即時計算排序與 tag 顯示。',
                'transforms' => [
                    '解析 tagid/or/not、hours 與 limit filters。',
                    '用 LegacyTagFilter 選出符合 tag 條件的頻道。',
                    '從 urt_video_live 選 actualEndTime 為 NULL、concurrentViewers > 0、mtime 一小時內的直播。',
                    '合併 urt_show_video_live 顯示 cache 與 urt_video_live_log 今日趨勢。',
                    '濾掉今日最高為 0 的 rows，依 concurrentViewers 排序輸出表格。',
                ],
            ],
            'fixed_sources' => [
                self::fixedSource('Live freshness window', 'LiveCurrentReport::liveRows latestTime = now()->subHour()', '一小時內 mtime 才列入目前直播；隨部署更新，不由排程修改。'),
                self::fixedSource('Live row filters', 'actualEndTime IS NULL, concurrentViewers > 0', '固定 SQL 條件；只有部署新版本才會變更。'),
                self::fixedSource('Legacy visible tag ids', 'App\Services\Legacy\LegacyTagFilter::visibleTags', '可見分類 id 清單寫在程式碼中；只有部署新版本才會變更。'),
            ],
            'sources' => [
                self::source('urt_video_live', 'urt_video_live', ['mtime', 'publishedAt', 'actualStartTime']),
                self::source('urt_show_video_live', 'urt_show_video_live', ['mtime', 'ctime', 'publishedAt']),
                self::source('urt_video_live_log', 'urt_video_live_log', ['mtime', 'ctime', 'the_date']),
                self::source('urt_count', 'urt_count', ['mtime', 'ctime']),
                self::source('urt_tag', 'urt_tag', ['mtime', 'ctime']),
            ],
            'graph' => [
                self::fixedNode('live_filters', '直播篩選規則', 'tag filters、hours、mtime freshness 與 ended/current viewers 條件都是頁面 request 時套用的固定規則。'),
                self::jobNode('live_poll_job', 'YouTube live polling', 'api', 'youtube.live.poll', '只有 ingestion job 會呼叫 YouTube videos.list(liveStreamingDetails)；頁面 request 不呼叫 API。'),
                self::combinedSourceNode('live_tables', 'urt_video_live + live log', ['urt_video_live', 'urt_video_live_log', 'urt_count', 'urt_tag'], '直播狀態、今日趨勢與頻道 tag 都來自本機 DB。'),
                self::sourceNode('live_display_cache', 'urt_show_video_live display cache', 'cache', 'urt_show_video_live', '保存直播列表需要的縮圖、頻道與標題顯示資料。', [
                    'job_details' => ['reports.live.build', 'reports.live.show'],
                ]),
                self::serviceNode('live_current_report', 'LiveCurrentReport 排序與合併', '在 request 時合併 live row、display cache、今日 log 與 tag 名稱，產生目前直播排行。'),
                self::pageNode('live_current_page', '目前直播排行頁', '/live/current', 'Blade 呈現目前直播表格、趨勢摘要、頻道與 YouTube 連結。'),
            ],
            'edges' => [
                self::edge('live_filters', 'live_poll_job', 'poll candidates', '固定 freshness 與 active 條件也決定輪詢候選。'),
                self::edge('live_poll_job', 'live_tables', 'update viewers', 'youtube:live:poll 更新 urt_video_live 與 urt_video_live_log。'),
                self::edge('live_tables', 'live_display_cache', 'display cache', 'reports:live:build 從本機 live/video rows 補 urt_show_video_live。'),
                self::edge('live_display_cache', 'live_current_report', 'merge display', '頁面服務合併 display cache、live row 與 today log。'),
                self::edge('live_current_report', 'live_current_page', 'render ranking', '依 concurrentViewers 排序後輸出表格。'),
            ],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private static function liveDays(): array
    {
        return [
            'title' => '單日直播排行',
            'summary' => '本頁讀取 live polling log 與直播顯示 cache，依單日或期間最高同時觀看人數即時計算直播排行。',
            'jobs' => [
                self::job(
                    key: 'youtube.live.poll',
                    label: '直播狀態輪詢',
                    command: 'youtube:live:poll --execute --limit=50',
                    apiCalls: ['YouTube Data API videos.list(part=liveStreamingDetails)'],
                    reads: ['urt_video_live'],
                    writes: ['urt_video_live', 'urt_video_live_log'],
                    summary: '從本機 active live rows 選出需更新的 videoId，呼叫 YouTube 後更新 viewers 與每日 live log。',
                    scheduler: 'config/ingestion.php job youtube.live.poll；每分鐘，scheduled-write gates 通過後執行。',
                ),
                self::job(
                    key: 'reports.live.build',
                    label: '直播顯示 cache 補齊',
                    command: 'reports:live:build --execute --hours=24 --limit=100',
                    apiCalls: [],
                    reads: ['urt_video_live', 'urt_video'],
                    writes: ['urt_show_video_live'],
                    summary: '不呼叫外部 API；從本機 live rows 與影片 metadata 補齊縮圖、標題、頻道等顯示 cache。',
                    scheduler: 'config/ingestion.php job reports.live.build；依時段每 9 或 19 分鐘。',
                ),
            ],
            'render' => [
                'controller' => 'App\Http\Controllers\Reports\LiveDayController',
                'service' => 'App\Services\Legacy\LiveDayReport',
                'reads' => ['urt_video_live_log', 'urt_show_video_live', 'urt_count', 'urt_tag'],
                'request' => '頁面 request 本身不呼叫 YouTube API；只讀本機 live log/display cache/tag rows，依 date/from/to/tag filters 即時計算排行。',
                'transforms' => [
                    '從 path date 或 query date/from/to 解析單日或期間，日期下限固定為 2022-11-19。',
                    'LegacyTagFilter 從 urt_count.tags 找符合 tag filters 的頻道。',
                    '讀 urt_video_live_log，對同一 videoId 取區間內 max_current 最高值。',
                    '用 urt_show_video_live 補縮圖、標題、頻道與發布時間。',
                    '解析 log_json 後取最後 24 個 trend samples 顯示趨勢線文字。',
                ],
            ],
            'fixed_sources' => [
                self::fixedSource('Live date lower bound', 'LiveDayReport::boundedDate min 2022-11-19', '固定日期下限寫死在程式碼；隨部署更新。'),
                self::fixedSource('Trend sample limit', 'LiveDayReport::trendValues()->slice(-24)', '趨勢線最多顯示最後 24 筆 sample；不是排程更新來源。'),
                self::fixedSource('Legacy visible tag ids', 'App\Services\Legacy\LegacyTagFilter::visibleTags', '可見分類 id 清單寫在程式碼中；只有部署新版本才會變更。'),
            ],
            'sources' => [
                self::source('urt_video_live_log', 'urt_video_live_log', ['mtime', 'ctime', 'the_date']),
                self::source('urt_show_video_live', 'urt_show_video_live', ['mtime', 'ctime', 'publishedAt']),
                self::source('urt_count', 'urt_count', ['mtime', 'ctime']),
                self::source('urt_tag', 'urt_tag', ['mtime', 'ctime']),
            ],
            'graph' => [
                self::fixedNode('live_day_filters', 'date / tag filters', 'date/from/to/tagid/or/not/limit 都在 request 時套用；日期下限與 trend sample limit 隨部署更新。'),
                self::jobNode('live_poll_day_job', 'YouTube live polling', 'api', 'youtube.live.poll', '只有 ingestion job 會呼叫 YouTube videos.list(liveStreamingDetails)；頁面 request 不呼叫 API。'),
                self::combinedSourceNode('live_day_logs', 'urt_video_live_log + tag tables', ['urt_video_live_log', 'urt_count', 'urt_tag'], '每日最高人數、趨勢 JSON 與 tag filters 來自本機 DB。', [
                    'job_details' => ['youtube.live.poll'],
                ]),
                self::sourceNode('live_day_display_cache', 'urt_show_video_live display cache', 'cache', 'urt_show_video_live', '補齊直播排行需要的縮圖、標題、頻道與發布時間。', [
                    'job_details' => ['reports.live.build'],
                ]),
                self::serviceNode('live_day_report', 'LiveDayReport 期間排行', 'request 時聚合同一 videoId 的 max_current，合併 display cache 與 tag chips。'),
                self::pageNode('live_day_page', '單日直播排行頁', '/live/days/{date}', 'Blade 呈現日期導覽、filter chips、直播排行與趨勢線文字。'),
            ],
            'edges' => [
                self::edge('live_day_filters', 'live_poll_day_job', 'poll scope', 'active live rows 與日期/tag filters 共同決定需要觀察的資料範圍。'),
                self::edge('live_poll_day_job', 'live_day_logs', 'write log', 'youtube:live:poll 更新 urt_video_live_log。'),
                self::edge('live_day_logs', 'live_day_display_cache', 'display lookup', 'reports:live:build 補齊 live display cache。'),
                self::edge('live_day_display_cache', 'live_day_report', 'merge display', 'LiveDayReport 合併 log 與 display cache。'),
                self::edge('live_day_report', 'live_day_page', 'render ranking', '依 max_current 排序後輸出單日/期間直播排行。'),
            ],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private static function liveDailyTrend(): array
    {
        return [
            'title' => '直播每日趨勢',
            'summary' => '本頁用直播 log 與頻道 tag 即時計算固定群組的每日直播趨勢、七日 rolling 線圖與期間合計。',
            'jobs' => [
                self::job(
                    key: 'youtube.live.poll',
                    label: '直播狀態輪詢',
                    command: 'youtube:live:poll --execute --limit=50',
                    apiCalls: ['YouTube Data API videos.list(part=liveStreamingDetails)'],
                    reads: ['urt_video_live'],
                    writes: ['urt_video_live', 'urt_video_live_log'],
                    summary: '更新每日 live log 的 max_current 與 log_json，是本頁趨勢聚合的主要來源。',
                    scheduler: 'config/ingestion.php job youtube.live.poll；每分鐘，scheduled-write gates 通過後執行。',
                ),
                self::job(
                    key: 'youtube.channels.stats',
                    label: '頻道 tag/統計來源',
                    command: 'youtube:channels:stats --execute --limit=25',
                    apiCalls: ['YouTube Data API channels.list(part=statistics)'],
                    reads: ['urt_channel'],
                    writes: ['urt_channel', 'urt_count', 'urt_log'],
                    summary: '更新 urt_count 基礎資料；本頁用 urt_count.tags 將 live log 分到固定群組。',
                    scheduler: 'config/ingestion.php job youtube.channels.stats；每 9 分鐘。',
                ),
            ],
            'render' => [
                'controller' => 'App\Http\Controllers\Reports\LiveDailyTrendController',
                'service' => 'App\Services\Legacy\LiveDailyTrendReport',
                'reads' => ['urt_video_live_log', 'urt_count', 'urt_tag'],
                'request' => '頁面 request 本身不呼叫 YouTube API；讀本機 live log 與頻道 tag，在 request 時即時計算 group series、rolling values 與 summary rows。',
                'transforms' => [
                    'group 與 type 只允許 LiveDailyTrendReport::GROUPS / TYPES 內的固定值。',
                    '日期預設以 urt_video_live_log 最新 the_date 或今天為 to，範圍下限固定 2022-11-19。',
                    'join urt_video_live_log 與 urt_count，依頻道 tags 將 max_current 歸入固定群組 tag ids。',
                    '線圖 values 使用 7-day rolling total / 7 產生每日平均。',
                    '期間合計即時計算影片數、觀看數與每部觀看。',
                ],
            ],
            'fixed_sources' => [
                self::fixedSource('Live trend groups', 'LiveDailyTrendReport::GROUPS', 'party/news/main/media/china 與 tag id 清單寫死在程式碼；隨部署更新。'),
                self::fixedSource('Live trend metrics', 'LiveDailyTrendReport::TYPES total_views/count_videos', '可選指標寫死在程式碼；不會由排程更新。'),
                self::fixedSource('7-day rolling rule', 'LiveDailyTrendReport::rollingValue offsets 0..6 / 7', 'rolling 計算規則固定在報表服務；隨部署更新。'),
            ],
            'sources' => [
                self::source('urt_video_live_log', 'urt_video_live_log', ['mtime', 'ctime', 'the_date']),
                self::source('urt_count', 'urt_count', ['mtime', 'ctime']),
                self::source('urt_tag', 'urt_tag', ['mtime', 'ctime']),
            ],
            'graph' => [
                self::jobNode('live_trend_poll_job', 'YouTube live polling', 'api', 'youtube.live.poll', '只有 ingestion job 會呼叫 YouTube videos.list(liveStreamingDetails)；頁面 request 不呼叫 API。'),
                self::combinedSourceNode('live_trend_tables', 'live log + channel tags', ['urt_video_live_log', 'urt_count', 'urt_tag'], 'live max_current、頻道 tag 與 tag 名稱是趨勢計算的本機來源。', [
                    'job_details' => ['youtube.live.poll', 'youtube.channels.stats'],
                ]),
                self::fixedNode('live_trend_groups', 'fixed groups / metrics', 'GROUPS、TYPES、日期下限與 7-day rolling 規則都寫在程式碼，只有部署才會變更。'),
                self::serviceNode('live_daily_trend_report', 'LiveDailyTrendReport rolling series', 'request 時依固定 group tag ids 聚合 live log，計算 rolling series 與期間合計。'),
                self::pageNode('live_daily_trend_page', '直播每日趨勢頁', '/live/trends/daily', 'Blade 呈現日期/群組/指標切換、SVG 折線圖、legend 與期間合計表。'),
            ],
            'edges' => [
                self::edge('live_trend_poll_job', 'live_trend_tables', 'write log', 'youtube:live:poll 更新每日 live log。'),
                self::edge('live_trend_tables', 'live_trend_groups', 'apply tag sets', '固定 group tag ids 決定每筆 live log 歸屬。'),
                self::edge('live_trend_groups', 'live_daily_trend_report', 'aggregate rolling', '報表服務用本機 log/tag 即時計算 rolling series。'),
                self::edge('live_daily_trend_report', 'live_daily_trend_page', 'render chart', 'Blade 輸出 SVG 折線圖與期間合計。'),
            ],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private static function liveHours(): array
    {
        return [
            'title' => '直播小時熱度',
            'summary' => '本頁優先讀 urt_show_live_tag_date.hour_result cache；缺 cache 時用本機 live log 的 log_json 即時計算每小時熱度矩陣。',
            'jobs' => [
                self::job(
                    key: 'legacy.live_tag_date.cache',
                    label: 'Legacy live tag-date/hour cache',
                    command: 'approved legacy snapshot/export -> urt_show_live_tag_date',
                    apiCalls: [],
                    reads: ['approved legacy snapshot/export', 'urt_video_live_log', 'urt_count'],
                    writes: ['urt_show_live_tag_date'],
                    summary: 'hour_result cache 目前主要來自 approved legacy cache/export；頁面可 fallback 到 live log 即時計算。',
                    scheduler: '不會由目前 Laravel 排程常態重建；reports:live:clean 只清理 invalid cache rows。',
                ),
                self::job(
                    key: 'youtube.live.poll',
                    label: '直播狀態輪詢',
                    command: 'youtube:live:poll --execute --limit=50',
                    apiCalls: ['YouTube Data API videos.list(part=liveStreamingDetails)'],
                    reads: ['urt_video_live'],
                    writes: ['urt_video_live', 'urt_video_live_log'],
                    summary: '更新 fallback 所需的 live log_json；只在 job 執行時呼叫 YouTube。',
                    scheduler: 'config/ingestion.php job youtube.live.poll；每分鐘，scheduled-write gates 通過後執行。',
                ),
                self::job(
                    key: 'reports.live.clean',
                    label: 'live tag cache 清理',
                    command: 'reports:live:clean --execute --limit=500',
                    apiCalls: [],
                    reads: ['urt_show_live_tag_date'],
                    writes: ['urt_show_live_tag_date delete'],
                    summary: '不呼叫外部 API；只刪除判定 invalid 的 live tag-date cache rows，不重建 hour_result。',
                    scheduler: 'config/ingestion.php job reports.live.clean；03:33、13:33、23:33。',
                ),
            ],
            'render' => [
                'controller' => 'App\Http\Controllers\Reports\LiveHoursController',
                'service' => 'App\Services\Legacy\LiveHoursReport',
                'reads' => ['urt_show_live_tag_date', 'urt_video_live_log', 'urt_count', 'urt_tag'],
                'request' => '頁面 request 本身不呼叫 YouTube API；有 hour_result cache 時只讀 cache，否則讀本機 urt_video_live_log.log_json 即時計算小時矩陣，不寫 DB。',
                'transforms' => [
                    '解析 tagid/or/not、days/from/to/today，日期下限固定為 2022-11-19。',
                    '先用排序後的 tag filter key 精準讀 urt_show_live_tag_date.hour_result。',
                    'cache 沒有小時資料時，LegacyTagFilter 選出頻道，再掃 urt_video_live_log.log_json。',
                    '每支影片每小時只取該小時 peak，依日期/小時累計 views 與 videos。',
                    'Blade 呈現可橫向捲動的小時熱度矩陣與日期合計列。',
                ],
            ],
            'fixed_sources' => [
                self::fixedSource('Live-hour cache status', 'urt_show_live_tag_date.hour_result', '目前不由 Laravel 排程常態重建；reports:live:clean 只會清理 invalid rows。'),
                self::fixedSource('Live-hour filter key rule', 'LiveHoursReport::sortedTagFilters + nullable empty string match', 'tagid/or/not 會排序成 cache key；規則寫死在程式碼。'),
                self::fixedSource('Live-hour bucket rule', '24 fixed hour buckets 00..23', '小時矩陣 bucket 固定；隨部署更新，不會由排程更新。'),
            ],
            'sources' => [
                self::source('urt_show_live_tag_date', 'urt_show_live_tag_date', ['mtime', 'ctime', 'the_date']),
                self::source('urt_video_live_log', 'urt_video_live_log', ['mtime', 'ctime', 'the_date']),
                self::source('urt_count', 'urt_count', ['mtime', 'ctime']),
                self::source('urt_tag', 'urt_tag', ['mtime', 'ctime']),
            ],
            'graph' => [
                self::fixedNode('live_hour_rules', 'hour cache / fallback rules', 'tag filter key、日期下限、24 小時 bucket 與 cache fallback 規則都寫在程式碼。'),
                self::sourceNode('live_hour_cache', 'urt_show_live_tag_date.hour_result cache', 'cache', 'urt_show_live_tag_date', '保存 date/tag filter 對應的小時 views/count；目前不由 Laravel scheduler 常態重建。', [
                    'job_details' => ['legacy.live_tag_date.cache', 'reports.live.clean'],
                ]),
                self::combinedSourceNode('live_hour_fallback', 'urt_video_live_log fallback', ['urt_video_live_log', 'urt_count', 'urt_tag'], 'cache miss 時從本機 live log_json 與 channel tags 即時計算每小時矩陣。', [
                    'job_details' => ['youtube.live.poll'],
                ]),
                self::serviceNode('live_hours_report', 'LiveHoursReport heatmap aggregate', '優先讀 hour_result cache；缺 cache 時即時計算 hourly peaks、totals 與矩陣。'),
                self::pageNode('live_hours_page', '直播小時熱度頁', '/live/hours', 'Blade 呈現日期範圍切換、filter chips、可橫向捲動的小時熱度表。'),
            ],
            'edges' => [
                self::edge('live_hour_rules', 'live_hour_cache', 'select hour_result', '排序後 tag filters 與日期範圍決定 cache lookup。'),
                self::edge('live_hour_cache', 'live_hour_fallback', 'cache miss', 'cache 無資料或 hour_result 為空時改掃 live log_json。'),
                self::edge('live_hour_fallback', 'live_hours_report', 'hourly peaks', 'LiveHoursReport 每支影片每小時取 peak 後累計。'),
                self::edge('live_hours_report', 'live_hours_page', 'render heatmap', 'Blade 輸出小時熱度矩陣與合計列。'),
            ],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private static function livePeriods(): array
    {
        $profile = self::liveDays();
        $profile['title'] = '期間直播排行';
        $profile['summary'] = '本頁和單日直播排行使用同一個 LiveDayReport；差異是 controller 預設以期間模式呈現 from/to 範圍。';
        $profile['render']['controller'] = 'App\Http\Controllers\Reports\LivePeriodController';
        $profile['render']['request'] = '頁面 request 本身不呼叫 YouTube API；只讀本機 live log/display cache/tag rows，依 from/to/tag filters 即時計算期間排行。';

        foreach ($profile['graph'] as &$node) {
            if (($node['id'] ?? null) === 'live_day_page') {
                $node['label'] = '期間直播排行頁';
                $node['meta']['Route'] = '/live/periods';
                $node['description'] = 'Blade 以 period mode 呈現日期範圍、filter chips、直播排行與趨勢線文字。';
            }
        }

        return $profile;
    }

    /**
     * @return array<string, mixed>
     */
    private static function liveChannels(): array
    {
        return [
            'title' => '直播頻道排行',
            'summary' => '本頁依日期或期間讀 live log，按頻道聚合直播總觀看、直播次數與最高觀看影片。',
            'jobs' => [
                self::job(
                    key: 'youtube.live.poll',
                    label: '直播狀態輪詢',
                    command: 'youtube:live:poll --execute --limit=50',
                    apiCalls: ['YouTube Data API videos.list(part=liveStreamingDetails)'],
                    reads: ['urt_video_live'],
                    writes: ['urt_video_live', 'urt_video_live_log'],
                    summary: '更新每日 live log，是頻道直播排行的主要來源。',
                    scheduler: 'config/ingestion.php job youtube.live.poll；每分鐘，scheduled-write gates 通過後執行。',
                ),
                self::job(
                    key: 'reports.live.build',
                    label: '直播顯示 cache 補齊',
                    command: 'reports:live:build --execute --hours=24 --limit=100',
                    apiCalls: [],
                    reads: ['urt_video_live', 'urt_video'],
                    writes: ['urt_show_video_live'],
                    summary: '不呼叫外部 API；補齊最高觀看影片的顯示資料。',
                    scheduler: 'config/ingestion.php job reports.live.build；依時段每 9 或 19 分鐘。',
                ),
            ],
            'render' => [
                'controller' => 'App\Http\Controllers\Reports\LiveChannelsController',
                'service' => 'App\Services\Legacy\LiveChannelsReport',
                'reads' => ['urt_video_live_log', 'urt_show_video_live', 'urt_channel', 'urt_count', 'urt_tag'],
                'request' => '頁面 request 本身不呼叫 YouTube API；讀本機 live log、channel、tag 與 display cache，即時計算頻道排行。',
                'transforms' => [
                    '從 date/from/to/days 與 tag filters 決定期間，預設使用最新 live log date。',
                    'LegacyTagFilter 從 urt_count.tags 選出符合條件頻道。',
                    '依 u_id 聚合 urt_video_live_log.max_current，計算 total_current/live_count/max_current。',
                    'join urt_channel 與 urt_show_video_live 顯示頻道與最高觀看影片。',
                ],
            ],
            'fixed_sources' => [
                self::fixedSource('Live channels date lower bound', 'LiveChannelsReport::boundedDate min 2022-11-19', '固定日期下限寫死在 service；隨部署更新。'),
                self::fixedSource('Live channel default range', 'days=7, default to latest urt_video_live_log.the_date', '預設期間由 service 決定；不是排程更新來源。'),
                self::fixedSource('Legacy visible tag ids', 'App\Services\Legacy\LegacyTagFilter::visibleTags', '可見 tag id 清單寫在程式碼；隨部署更新。'),
            ],
            'sources' => [
                self::source('urt_video_live_log', 'urt_video_live_log', ['mtime', 'ctime', 'the_date']),
                self::source('urt_show_video_live', 'urt_show_video_live', ['mtime', 'ctime', 'publishedAt']),
                self::source('urt_channel', 'urt_channel', ['mtime', 'ctime', 'stime', 'vtime']),
                self::source('urt_count', 'urt_count', ['mtime', 'ctime']),
                self::source('urt_tag', 'urt_tag', ['mtime', 'ctime']),
            ],
            'graph' => [
                self::jobNode('live_channels_poll_job', 'YouTube live polling', 'api', 'youtube.live.poll', '只有 ingestion job 會呼叫 YouTube；頁面 request 不呼叫 API。'),
                self::combinedSourceNode('live_channels_tables', 'live log + channel/tag tables', ['urt_video_live_log', 'urt_channel', 'urt_count', 'urt_tag'], '頻道聚合、tag chips 與頻道 metadata 都來自本機 DB。', [
                    'job_details' => ['youtube.live.poll'],
                ]),
                self::sourceNode('live_channels_display', 'urt_show_video_live display cache', 'cache', 'urt_show_video_live', '補最高觀看影片的標題與縮圖。', [
                    'job_details' => ['reports.live.build'],
                ]),
                self::serviceNode('live_channels_report', 'LiveChannelsReport group by channel', 'request 時依 u_id 聚合 live log，排序後輸出頻道排行。'),
                self::pageNode('live_channels_page', '直播頻道排行頁', '/live/channels', 'Blade 呈現日期/期間切換、tag filters、頻道排行與最高觀看影片。'),
            ],
            'edges' => [
                self::edge('live_channels_poll_job', 'live_channels_tables', 'write log', 'live poll 寫入每日 live log。'),
                self::edge('live_channels_tables', 'live_channels_display', 'display lookup', 'reports:live:build 補齊顯示 cache。'),
                self::edge('live_channels_display', 'live_channels_report', 'aggregate channel', '報表服務依頻道聚合期間 live log。'),
                self::edge('live_channels_report', 'live_channels_page', 'render ranking', 'Blade 輸出直播頻道排行。'),
            ],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private static function liveContinuous(): array
    {
        return [
            'title' => '持續直播排行',
            'summary' => '本頁讀目前 active live rows，找已連續開播超過指定小時的直播，並合併近期期 daily log 計算今日峰值、週平均與週峰值。',
            'jobs' => [
                self::job(
                    key: 'youtube.live.poll',
                    label: '直播狀態輪詢',
                    command: 'youtube:live:poll --execute --limit=50',
                    apiCalls: ['YouTube Data API videos.list(part=liveStreamingDetails)'],
                    reads: ['urt_video_live'],
                    writes: ['urt_video_live', 'urt_video_live_log'],
                    summary: '更新 active live rows 與每日 log，是本頁目前觀看與峰值來源。',
                    scheduler: 'config/ingestion.php job youtube.live.poll；每分鐘，scheduled-write gates 通過後執行。',
                ),
                self::job(
                    key: 'reports.live.build',
                    label: '直播顯示 cache 補齊',
                    command: 'reports:live:build --execute --hours=24 --limit=100',
                    apiCalls: [],
                    reads: ['urt_video_live', 'urt_video'],
                    writes: ['urt_show_video_live'],
                    summary: '不呼叫外部 API；補齊連續直播列表的標題、縮圖與頻道顯示資料。',
                    scheduler: 'config/ingestion.php job reports.live.build；依時段每 9 或 19 分鐘。',
                ),
            ],
            'render' => [
                'controller' => 'App\Http\Controllers\Reports\LiveContinuousController',
                'service' => 'App\Services\Legacy\LiveContinuousReport',
                'reads' => ['urt_video_live', 'urt_video_live_log', 'urt_show_video_live', 'urt_channel', 'urt_count', 'urt_tag'],
                'request' => '頁面 request 本身不呼叫 YouTube API；只讀本機 active live rows、log 與 display cache，即時計算連續直播排行。',
                'transforms' => [
                    'filters 支援 tagid/or/not/limit/hours；hours 介於 1 到 168。',
                    'urt_video_live 只取未結束、concurrentViewers>0、mtime 一小時內，且 actualStartTime 早於 cutoff 的直播。',
                    '讀指定期間 live log，計算 today_peak、weekly_average、weekly_peak。',
                    '合併 urt_channel、urt_show_video_live 與 tag chips，依 current_viewers 排序。',
                ],
            ],
            'fixed_sources' => [
                self::fixedSource('Continuous live freshness', 'LiveContinuousReport::freshSince now()->subHour()', '一小時內更新才視為 active；隨部署更新。'),
                self::fixedSource('Continuous hours bounds', 'hours default 24, max 168', '連續開播門檻與 query bounds 寫在 service。'),
                self::fixedSource('Active live filters', 'actualEndTime IS NULL, concurrentViewers > 0', '固定 SQL 條件；不會由排程更新。'),
            ],
            'sources' => [
                self::source('urt_video_live', 'urt_video_live', ['mtime', 'publishedAt', 'actualStartTime']),
                self::source('urt_video_live_log', 'urt_video_live_log', ['mtime', 'ctime', 'the_date']),
                self::source('urt_show_video_live', 'urt_show_video_live', ['mtime', 'ctime', 'publishedAt']),
                self::source('urt_channel', 'urt_channel', ['mtime', 'ctime']),
                self::source('urt_count', 'urt_count', ['mtime', 'ctime']),
            ],
            'graph' => [
                self::jobNode('live_cont_poll_job', 'YouTube live polling', 'api', 'youtube.live.poll', '只在 poll job 呼叫 YouTube；頁面 request 不呼叫 API。'),
                self::combinedSourceNode('live_cont_tables', 'active live + live log', ['urt_video_live', 'urt_video_live_log', 'urt_channel', 'urt_count'], '目前觀看、連續開播條件與週峰值都來自本機表。'),
                self::sourceNode('live_cont_display', 'urt_show_video_live display cache', 'cache', 'urt_show_video_live', '補齊直播標題、縮圖與頻道顯示。', [
                    'job_details' => ['reports.live.build'],
                ]),
                self::serviceNode('live_cont_report', 'LiveContinuousReport active filter', 'request 時套用 active/freshness/continuous cutoff，合併週統計後排序。'),
                self::pageNode('live_cont_page', '持續直播排行頁', '/live/continuous', 'Blade 呈現持續直播表格、目前觀看、今日峰值、週平均與週峰值。'),
            ],
            'edges' => [
                self::edge('live_cont_poll_job', 'live_cont_tables', 'refresh viewers', 'live poll 更新 active live 與 log。'),
                self::edge('live_cont_tables', 'live_cont_display', 'display cache', 'reports:live:build 補顯示 cache。'),
                self::edge('live_cont_display', 'live_cont_report', 'active sort', 'LiveContinuousReport 即時篩選並排序。'),
                self::edge('live_cont_report', 'live_cont_page', 'render ranking', 'Blade 輸出持續直播排行。'),
            ],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private static function liveTags(): array
    {
        return [
            'title' => '直播標籤熱度',
            'summary' => '本頁讀 urt_show_live_tag_date cache，依 tag filters、日期範圍與 type 即時計算每日直播關鍵字矩陣。',
            'jobs' => [
                self::job(
                    key: 'legacy.live_tag_date.cache',
                    label: 'Legacy live tag-date cache',
                    command: 'approved legacy snapshot/export -> urt_show_live_tag_date',
                    apiCalls: [],
                    reads: ['approved legacy snapshot/export', 'urt_video_live_log', 'urt_count'],
                    writes: ['urt_show_live_tag_date'],
                    summary: '目前 Laravel scheduler 不常態重建 tags_result/tags_video/tags_views live cache；頁面只讀既有 cache。',
                    scheduler: '不會由目前 Laravel 排程常態重建；reports:live:clean 只清理 invalid cache rows。',
                ),
                self::job(
                    key: 'reports.live.clean',
                    label: 'live tag cache 清理',
                    command: 'reports:live:clean --execute --limit=500',
                    apiCalls: [],
                    reads: ['urt_show_live_tag_date'],
                    writes: ['urt_show_live_tag_date delete'],
                    summary: '不呼叫外部 API；只清理 invalid cache rows，不重建 live tag cache。',
                    scheduler: 'config/ingestion.php job reports.live.clean；03:33、13:33、23:33。',
                ),
            ],
            'render' => [
                'controller' => 'App\Http\Controllers\Reports\LiveTagController',
                'service' => 'App\Services\Legacy\LiveTagReport',
                'reads' => ['urt_show_live_tag_date', 'urt_tag'],
                'request' => '頁面 request 本身不呼叫外部 API；讀 live tag-date cache，套用 stopwords 後即時計算每日關鍵字 rows 與 totals。',
                'transforms' => [
                    '解析 tagid/or/not、days/from/to/today、type、limit，filter strings 會排序成 cache key。',
                    '依 latest cache date 決定預設日期區間。',
                    '讀 urt_show_live_tag_date.tags_views 或 tags_video，對每個 keyword 取每日 max hour value。',
                    '套用 stopwords 並計算 total/score，輸出矩陣與每日 totals。',
                ],
            ],
            'fixed_sources' => [
                self::fixedSource('Live tag types', 'LiveTagReport::TYPES tags_result,tags_video,tags_views', '可選指標固定在 service；隨部署更新。'),
                self::fixedSource('Live tag cache status', 'urt_show_live_tag_date', '目前不由 Laravel scheduler 常態重建；reports:live:clean 只清理。'),
                self::fixedSource('內建 stopwords fallback', 'App\Services\Legacy\LegacyStopwords::FALLBACK', '直播標籤排行會排除固定停用詞；隨部署更新。'),
            ],
            'sources' => [
                self::source('urt_show_live_tag_date', 'urt_show_live_tag_date', ['mtime', 'ctime', 'the_date']),
                self::source('urt_tag', 'urt_tag', ['mtime', 'ctime']),
            ],
            'graph' => [
                self::sourceNode('live_tag_cache', 'urt_show_live_tag_date cache', 'cache', 'urt_show_live_tag_date', '保存直播 tag/date/hour 的關鍵字 JSON 與 totals；目前主要來自 legacy cache/export。', [
                    'job_details' => ['legacy.live_tag_date.cache', 'reports.live.clean'],
                ]),
                self::fixedNode('live_tag_rules', 'type / stopwords / cache key rules', 'type whitelist、排序後 filter key、stopwords 與 days limit 寫在程式碼。'),
                self::serviceNode('live_tag_report', 'LiveTagReport keyword matrix', 'request 時解析 cache JSON，對 keyword 每日取 max hour value 並排序。'),
                self::pageNode('live_tag_page', '直播標籤熱度頁', '/live/tags', 'Blade 呈現日期範圍、type 切換、每日關鍵字矩陣與 totals。'),
            ],
            'edges' => [
                self::edge('live_tag_cache', 'live_tag_rules', 'decode cache', 'request filters 決定讀哪些 cache rows 與 JSON 欄位。'),
                self::edge('live_tag_rules', 'live_tag_report', 'score keywords', 'LiveTagReport 套用 stopwords 並計算 score/total。'),
                self::edge('live_tag_report', 'live_tag_page', 'render matrix', 'Blade 輸出直播標籤熱度矩陣。'),
            ],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private static function liveGroupHours(): array
    {
        return [
            'title' => '直播群組小時熱度',
            'summary' => '本頁依固定直播群組 definitions 讀 urt_show_live_tag_date.hour_result，產生指定日期 00-23 點的群組比較矩陣。',
            'jobs' => [
                self::job(
                    key: 'legacy.live_tag_date.cache',
                    label: 'Legacy live hour cache',
                    command: 'approved legacy snapshot/export -> urt_show_live_tag_date.hour_result',
                    apiCalls: [],
                    reads: ['approved legacy snapshot/export', 'urt_video_live_log', 'urt_count'],
                    writes: ['urt_show_live_tag_date'],
                    summary: 'hour_result 目前不由 Laravel scheduler 常態重建；頁面只讀既有 cache。',
                    scheduler: '不會由目前 Laravel 排程常態重建；reports:live:clean 只清理 invalid cache rows。',
                ),
            ],
            'render' => [
                'controller' => 'App\Http\Controllers\Reports\LiveGroupHoursController',
                'service' => 'App\Services\Legacy\LiveGroupHoursReport',
                'reads' => ['urt_show_live_tag_date'],
                'request' => '頁面 request 本身不呼叫外部 API；讀固定群組對應的 hour_result cache，即時計算 24 小時矩陣。',
                'transforms' => [
                    'route group 或 query group 決定 LegacyLiveGroupDefinitions 中的固定群組。',
                    '未指定 date 時，對群組每個 filter 查最新 urt_show_live_tag_date.the_date。',
                    '每個群組讀同一日期最新 cache row，解析 hour_result JSON。',
                    '固定 00..23 小時輸出 views/count cells。',
                ],
            ],
            'fixed_sources' => [
                self::fixedSource('Live group definitions', 'App\Services\Legacy\LegacyLiveGroupDefinitions', '群組與 tag filter strings 寫在程式碼；隨部署更新。'),
                self::fixedSource('Hour buckets', 'LiveGroupHoursReport range(0, 23)', '24 小時 bucket 固定；不是排程更新來源。'),
                self::fixedSource('Hour cache status', 'urt_show_live_tag_date.hour_result', '目前不由 Laravel scheduler 常態重建。'),
            ],
            'sources' => [
                self::source('urt_show_live_tag_date', 'urt_show_live_tag_date', ['mtime', 'ctime', 'the_date']),
            ],
            'graph' => [
                self::fixedNode('live_group_hour_defs', 'fixed group / hour rules', 'group definitions 與 00-23 小時 bucket 寫在程式碼。'),
                self::sourceNode('live_group_hour_cache', 'urt_show_live_tag_date.hour_result', 'cache', 'urt_show_live_tag_date', '保存各固定 tag filter 在每日期的 hour_result views/count。', [
                    'job_details' => ['legacy.live_tag_date.cache'],
                ]),
                self::serviceNode('live_group_hour_report', 'LiveGroupHoursReport hour matrix', 'request 時讀每個 group 最新或指定日期 cache row，解析 hour_result。'),
                self::pageNode('live_group_hour_page', '直播群組小時熱度頁', '/live/groups/{group}/hours', 'Blade 呈現 group selector、日期與 24 小時矩陣。'),
            ],
            'edges' => [
                self::edge('live_group_hour_defs', 'live_group_hour_cache', 'select filters', '固定 group filters 決定讀哪些 cache rows。'),
                self::edge('live_group_hour_cache', 'live_group_hour_report', 'decode hours', '報表服務解析 hour_result JSON。'),
                self::edge('live_group_hour_report', 'live_group_hour_page', 'render heatmap', 'Blade 輸出群組小時矩陣。'),
            ],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private static function liveVideoTrend(): array
    {
        return [
            'title' => '單支直播趨勢',
            'summary' => '本頁讀指定 videoId 的 live/display rows 與 live log_json，產生小時與每日最高同時觀看趨勢。',
            'jobs' => [
                self::job(
                    key: 'youtube.live.poll',
                    label: '直播狀態輪詢',
                    command: 'youtube:live:poll --execute --limit=50',
                    apiCalls: ['YouTube Data API videos.list(part=liveStreamingDetails)'],
                    reads: ['urt_video_live'],
                    writes: ['urt_video_live', 'urt_video_live_log'],
                    summary: '更新指定直播的目前狀態與 log_json；只在 job 執行時呼叫 YouTube。',
                    scheduler: 'config/ingestion.php job youtube.live.poll；每分鐘，scheduled-write gates 通過後執行。',
                ),
                self::job(
                    key: 'reports.live.build',
                    label: '直播顯示 cache 補齊',
                    command: 'reports:live:build --execute --hours=24 --limit=100',
                    apiCalls: [],
                    reads: ['urt_video_live', 'urt_video'],
                    writes: ['urt_show_video_live'],
                    summary: '不呼叫外部 API；補齊指定直播的 title/thumbnail/channel display cache。',
                    scheduler: 'config/ingestion.php job reports.live.build；依時段每 9 或 19 分鐘。',
                ),
            ],
            'render' => [
                'controller' => 'App\Http\Controllers\Reports\LiveVideoTrendController',
                'service' => 'App\Services\Legacy\LiveVideoTrendReport',
                'reads' => ['urt_show_video_live', 'urt_video_live', 'urt_video_live_log'],
                'request' => '頁面 request 本身不呼叫 YouTube API；讀指定 videoId 的本機 display/live/log rows，解析 log_json 產生趨勢。',
                'transforms' => [
                    'route videoId 決定 lookup；limit 限制輸出 series 長度。',
                    '讀 urt_show_video_live 與 urt_video_live 補影片 metadata、目前觀看與結束狀態。',
                    '掃 urt_video_live_log.log_json，把每小時與每日 peak 整理成 series。',
                    '若 display/live/log 都沒有資料，回傳可用但空的狀態。',
                ],
            ],
            'fixed_sources' => [
                self::fixedSource('Live video trend limit', 'LiveVideoTrendReport limit<=200, default=50', '輸出長度 bounds 寫死在 service；隨部署更新。'),
                self::fixedSource('Hourly aggregation rule', 'max value per YYYY-mm-dd HH:00 from log_json', '小時聚合規則固定；不是排程更新來源。'),
            ],
            'sources' => [
                self::source('urt_show_video_live', 'urt_show_video_live', ['mtime', 'ctime', 'publishedAt']),
                self::source('urt_video_live', 'urt_video_live', ['mtime', 'publishedAt', 'actualStartTime', 'actualEndTime']),
                self::source('urt_video_live_log', 'urt_video_live_log', ['mtime', 'ctime', 'the_date']),
            ],
            'graph' => [
                self::jobNode('live_video_poll_job', 'YouTube live polling', 'api', 'youtube.live.poll', '只有 poll job 呼叫 YouTube；頁面 request 不呼叫 API。'),
                self::combinedSourceNode('live_video_tables', 'live display/state/log rows', ['urt_show_video_live', 'urt_video_live', 'urt_video_live_log'], '指定 videoId 的 metadata、目前狀態與趨勢 log 都來自本機 DB。', [
                    'job_details' => ['youtube.live.poll', 'reports.live.build'],
                ]),
                self::serviceNode('live_video_report', 'LiveVideoTrendReport log_json parser', 'request 時解析 log_json，產生 hourly/daily peak series。'),
                self::pageNode('live_video_page', '單支直播趨勢頁', '/live/videos/{videoId}/trend', 'Blade 呈現影片資訊、小時趨勢與每日趨勢。'),
            ],
            'edges' => [
                self::edge('live_video_poll_job', 'live_video_tables', 'refresh log', 'live poll/build 更新本機 live rows 與 display cache。'),
                self::edge('live_video_tables', 'live_video_report', 'parse log_json', '報表服務解析指定 videoId 的 live log。'),
                self::edge('live_video_report', 'live_video_page', 'render chart', 'Blade 輸出趨勢圖與影片資訊。'),
            ],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private static function liveWall(): array
    {
        return [
            'title' => '四窗直播牆',
            'summary' => '本頁是固定 videoId 清單的直播牆，頁面 request 不讀本機 DB、不呼叫外部 API；YouTube iframe 由瀏覽器端載入。',
            'jobs' => [],
            'render' => [
                'controller' => 'App\Http\Controllers\Reports\LiveWallController',
                'service' => 'App\Services\Legacy\LiveWallReport',
                'reads' => [],
                'request' => 'Laravel request 本身不呼叫 YouTube API、也不讀 DB；只根據 variant/type 從程式碼中的固定清單產生 iframe videoId。',
                'transforms' => [
                    'route variant 決定 news/alternate/china 等固定清單。',
                    'query type 限制在 1..7，選擇 news variant 的固定四窗群組。',
                    'Blade 輸出 iframe embed URLs；實際影音載入由使用者瀏覽器向 YouTube 發出。',
                ],
            ],
            'fixed_sources' => [
                self::fixedSource('Live wall video IDs', 'App\Services\Legacy\LiveWallReport::legacyLive4Streams + match variant arrays', '全部 videoId 與 labels 寫死在程式碼；只有部署新版本才會變更。'),
                self::fixedSource('Live wall type tabs', 'LiveWallReport $tabs 1..7', 'tab 名稱與 type bounds 寫死；不會由排程更新。'),
            ],
            'sources' => [],
            'graph' => [
                self::fixedNode('live_wall_rules', 'fixed videoId lists', 'variant/type 對應的 videoId 清單與 labels 都隨部署更新，不由排程更新。'),
                self::serviceNode('live_wall_report', 'LiveWallReport select streams', 'request 時只選固定清單並產生 streams array；不讀 DB、不呼叫 API。'),
                self::pageNode('live_wall_page', '四窗直播牆頁', '/live/walls/{variant}', 'Blade 輸出四窗 iframe；影音請求由瀏覽器直接對 YouTube embed 發出。'),
            ],
            'edges' => [
                self::edge('live_wall_rules', 'live_wall_report', 'select variant', 'variant/type 決定固定 streams。'),
                self::edge('live_wall_report', 'live_wall_page', 'render iframes', 'Blade 產生 YouTube embed iframe。'),
            ],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private static function channelProfile(): array
    {
        return [
            'title' => '頻道總覽',
            'summary' => '本頁讀頻道 metadata、頻道統計、tag、趨勢與 AI cache，組成單一頻道首頁；頁面 request 不呼叫外部 API。',
            'jobs' => [
                self::job(
                    key: 'youtube.channels.stats',
                    label: '頻道統計輪詢',
                    command: 'youtube:channels:stats --execute --limit=25',
                    apiCalls: ['YouTube Data API channels.list(part=statistics)'],
                    reads: ['urt_channel'],
                    writes: ['urt_channel', 'urt_count', 'urt_log'],
                    summary: '更新頻道基本統計、tag/count rows 與趨勢 log。',
                    scheduler: 'config/ingestion.php job youtube.channels.stats；每 9 分鐘，scheduled-write gates 通過後執行。',
                ),
                self::job(
                    key: 'reports.counts.build',
                    label: '頻道週/月增量計算',
                    command: 'reports:counts:build --execute --limit=500',
                    apiCalls: [],
                    reads: ['urt_log', 'urt_count'],
                    writes: ['urt_count'],
                    summary: '不呼叫外部 API；更新週/月增量與預估欄位。',
                    scheduler: 'config/ingestion.php job reports.counts.build；每日 6 次，scheduled-write gates 通過後執行。',
                ),
                self::job(
                    key: 'ai.daily',
                    label: '頻道 AI 摘要',
                    command: 'ai:daily --execute --channel-limit=39 --channel-batch-size=12 --ai-call-limit=45 --channel-video-limit=120 --limit=1000',
                    apiCalls: ['OpenCode-compatible chat completions (OPENAI_BASE_URL / OPENAI_MODEL)'],
                    reads: ['urt_video', 'urt_channel_ai', 'urt_count'],
                    writes: ['urt_channel_ai', 'urt_ai_date'],
                    summary: '產生 urt_channel_ai/urt_ai_date；只在 job 執行時呼叫 AI API。',
                    scheduler: 'config/ingestion.php job ai.daily；每日 16:15，scheduled-write gates 通過後執行。',
                ),
            ],
            'render' => [
                'controller' => 'App\Http\Controllers\Reports\ChannelProfileController',
                'service' => 'App\Services\Legacy\ChannelProfileReport',
                'reads' => ['urt_channel', 'urt_count', 'urt_tag', 'urt_log', 'urt_channel_ai', 'urt_video'],
                'request' => '頁面 request 本身不呼叫 YouTube 或 AI API；只讀本機 channel/count/log/AI/video rows，解析 AI JSON 並計算衍生欄位。',
                'transforms' => [
                    '依 u_id 讀 urt_channel 與 urt_count，組出頻道 metadata、tag chips 與成長欄位。',
                    '檢查 urt_log 是否有趨勢資料，供頻道折線入口狀態使用。',
                    '讀 urt_channel_ai 最新 daily/topic/people/aspect rows，解析 result_json。',
                    'oneday AI row 會即時查 urt_video 計算該期間影片數。',
                ],
            ],
            'fixed_sources' => [
                self::fixedSource('AI JSON compatibility keys', 'ChannelProfileReport topic/person/aspect normalizers', 'JSON 欄位相容規則寫在程式碼；隨部署更新。'),
                self::fixedSource('Growth formulas', 'ChannelProfileReport::countRow growth_percent/tv_rating_base', '衍生計算公式固定在 service。'),
            ],
            'sources' => [
                self::source('urt_channel', 'urt_channel', ['mtime', 'ctime', 'stime', 'vtime']),
                self::source('urt_count', 'urt_count', ['mtime', 'ctime']),
                self::source('urt_tag', 'urt_tag', ['mtime', 'ctime']),
                self::source('urt_log', 'urt_log', ['mtime', 'ctime', 'thedate']),
                self::source('urt_channel_ai', 'urt_channel_ai', ['mtime', 'ctime', 'date_to', 'date_from']),
                self::source('urt_video', 'urt_video', ['mtime', 'publishedAt']),
            ],
            'graph' => [
                self::jobNode('channel_profile_stats_job', 'channel stats / deltas', 'api', 'youtube.channels.stats', '更新頻道統計與 log；頁面瀏覽不呼叫 API。', [
                    'job_details' => ['reports.counts.build'],
                ]),
                self::jobNode('channel_profile_ai_job', 'ai:daily channel rows', 'api', 'ai.daily', '只有 AI job 會呼叫模型 API；頁面只讀 AI cache。'),
                self::combinedSourceNode('channel_profile_tables', 'channel/count/log/AI tables', ['urt_channel', 'urt_count', 'urt_log', 'urt_channel_ai', 'urt_video'], '頻道總覽、趨勢狀態與 AI 區塊都來自本機資料表。'),
                self::serviceNode('channel_profile_report', 'ChannelProfileReport merge', 'request 時合併頻道統計、tags、trend availability 與 AI JSON。'),
                self::pageNode('channel_profile_page', '頻道總覽頁', '/channels/{u_id}', 'Blade 呈現頻道基本資料、統計、tag、趨勢與 AI 摘要入口。'),
            ],
            'edges' => [
                self::edge('channel_profile_stats_job', 'channel_profile_ai_job', 'parallel refresh', '統計與 AI jobs 各自維護本機表。'),
                self::edge('channel_profile_ai_job', 'channel_profile_tables', 'write/read cache', '頁面只讀既有 rows，不在 request 觸發外部 API。'),
                self::edge('channel_profile_tables', 'channel_profile_report', 'merge fields', 'ChannelProfileReport 解析並計算衍生欄位。'),
                self::edge('channel_profile_report', 'channel_profile_page', 'render overview', 'Blade 輸出頻道總覽。'),
            ],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private static function channelVideos(): array
    {
        return [
            'title' => '頻道影片排行',
            'summary' => '本頁讀單一頻道近期 urt_video rows，合併 urt_comment 摘要，即時計算觀看、互動與留言作者欄位。',
            'jobs' => [
                self::job(
                    key: 'youtube.channels.videos.general',
                    label: '頻道 uploads 擷取',
                    command: 'youtube:channels:videos --execute --limit=5 --max-results=3',
                    apiCalls: ['YouTube Data API playlistItems.list(part=snippet)'],
                    reads: ['urt_channel', 'urt_count', 'urt_video_schedule'],
                    writes: ['urt_video', 'urt_video_schedule', 'urt_video_live', 'urt_channel.vtime'],
                    summary: '抓 uploads playlist 並 upsert urt_video；只在 ingestion job 執行時呼叫 YouTube。',
                    scheduler: 'config/ingestion.php job youtube.channels.videos.general；每 5 分鐘。',
                ),
                self::job(
                    key: 'youtube.videos.stats',
                    label: '影片統計輪詢',
                    command: 'youtube:videos:stats --execute --limit=25',
                    apiCalls: ['YouTube Data API videos.list(part=statistics)'],
                    reads: ['urt_video_schedule', 'urt_video'],
                    writes: ['urt_video', 'urt_video_schedule', 'urt_video_log', 'urt_video_log_history'],
                    summary: '更新 view/like/comment 統計，供排序與互動欄位使用。',
                    scheduler: 'config/ingestion.php job youtube.videos.stats；00-17 點每 7 分鐘。',
                ),
                self::job(
                    key: 'youtube.comments.fetch',
                    label: '留言擷取',
                    command: 'youtube:comments:fetch --execute --limit=5 --max-pages=1',
                    apiCalls: ['YouTube Data API commentThreads.list'],
                    reads: ['urt_comment_queue', 'urt_comment'],
                    writes: ['urt_comment', 'urt_comment_author', 'urt_comment_rev', 'urt_comment_queue_done'],
                    summary: '補 urt_comment 摘要；頁面本身不會抓留言 API。',
                    scheduler: 'config/ingestion.php job youtube.comments.fetch；每小時第 5 分。',
                ),
            ],
            'render' => [
                'controller' => 'App\Http\Controllers\Reports\ChannelVideosController',
                'service' => 'App\Services\Legacy\ChannelVideosReport',
                'reads' => ['urt_channel', 'urt_video', 'urt_comment'],
                'request' => '頁面 request 本身不呼叫 YouTube API；只讀本機 urt_video/urt_comment，依 hours/min/limit/column 即時計算排行。',
                'transforms' => [
                    '依 u_id 讀 urt_channel；找不到 channel 時回傳空頁。',
                    'hours/min/limit 與 sort column query 在 request 時套用。',
                    '讀 urt_video.publishedAt 範圍與 viewCount min，依 whitelist column 排序。',
                    '批次讀 urt_comment 補作者數、回覆數、留言 likes，並計算 like_ratio。',
                ],
            ],
            'fixed_sources' => [
                self::fixedSource('Channel video sort whitelist', 'ChannelVideosReport::SORT_COLUMNS viewCount,likeCount,commentCount,publishedAt', '排序欄位寫死；隨部署更新。'),
                self::fixedSource('Channel video bounds', 'limit<=1000, hours<=8760, min>=0', 'query bounds 寫死在 service。'),
            ],
            'sources' => [
                self::source('urt_channel', 'urt_channel', ['mtime', 'ctime', 'vtime']),
                self::source('urt_video', 'urt_video', ['mtime', 'publishedAt']),
                self::source('urt_comment', 'urt_comment', ['mtime', 'ctime', 'latest_time']),
            ],
            'graph' => [
                self::jobNode('channel_video_discovery', 'uploads discovery', 'api', 'youtube.channels.videos.general', '更新本機影片表；頁面 request 不呼叫 YouTube。'),
                self::jobNode('channel_video_stats', 'video stats/comments', 'api', 'youtube.videos.stats', '更新影片統計與留言 cache。', [
                    'job_details' => ['youtube.comments.fetch'],
                ]),
                self::combinedSourceNode('channel_video_tables', 'urt_video + urt_comment', ['urt_channel', 'urt_video', 'urt_comment'], '頻道影片排行與留言摘要全部來自本機表。'),
                self::serviceNode('channel_video_report', 'ChannelVideosReport sort + merge', 'request 時篩選影片、排序並合併留言摘要。'),
                self::pageNode('channel_video_page', '頻道影片頁', '/channels/{u_id}/videos', 'Blade 呈現影片排行、互動欄位與 YouTube 連結。'),
            ],
            'edges' => [
                self::edge('channel_video_discovery', 'channel_video_stats', 'upsert videos', 'discovery 補影片，stats/comments jobs 補統計與留言摘要。'),
                self::edge('channel_video_stats', 'channel_video_tables', 'refresh rows', '本機表保存頁面所需資料。'),
                self::edge('channel_video_tables', 'channel_video_report', 'filter + sort', 'ChannelVideosReport 即時查詢與排序。'),
                self::edge('channel_video_report', 'channel_video_page', 'render videos', 'Blade 輸出頻道影片排行。'),
            ],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private static function channelComments(): array
    {
        return [
            'title' => '頻道留言排行',
            'summary' => '本頁從單一頻道近期影片找 urt_comment.authors_json，聚合留言者排行與影片留言摘要。',
            'jobs' => [
                self::job(
                    key: 'youtube.comments.queue',
                    label: '留言擷取佇列',
                    command: 'youtube:comments:queue --or=1,2,3,4,5,6,13,14,81 --hours=72 --min=500 --execute --limit=5',
                    apiCalls: [],
                    reads: ['urt_count', 'urt_video', 'urt_comment_queue'],
                    writes: ['urt_comment_queue'],
                    summary: '不呼叫外部 API；從本機影片挑候選寫入 queue。',
                    scheduler: 'config/ingestion.php job youtube.comments.queue；04、10、16 點第 23 分。',
                ),
                self::job(
                    key: 'youtube.comments.fetch',
                    label: '留言擷取',
                    command: 'youtube:comments:fetch --execute --limit=5 --max-pages=1',
                    apiCalls: ['YouTube Data API commentThreads.list'],
                    reads: ['urt_comment_queue', 'urt_comment'],
                    writes: ['urt_comment', 'urt_comment_author', 'urt_comment_rev', 'urt_comment_queue_done'],
                    summary: '從 queue 抓留言並更新 authors_json/comments_json。',
                    scheduler: 'config/ingestion.php job youtube.comments.fetch；每小時第 5 分。',
                ),
            ],
            'render' => [
                'controller' => 'App\Http\Controllers\Reports\ChannelDataGapController::comments',
                'service' => 'App\Services\Legacy\ChannelCommentsReport',
                'reads' => ['urt_channel', 'urt_video', 'urt_comment', 'urt_comment_author'],
                'request' => '頁面 request 本身不呼叫 YouTube API；讀本機影片與留言 JSON，即時計算留言者排行。',
                'transforms' => [
                    'hours/min/limit 在 request 時套用，先讀單一頻道近期影片。',
                    '批次讀對應 urt_comment rows，從 authors_json 聚合留言者次數。',
                    '生成影片留言摘要與 dependency 狀態；不寫 DB。',
                ],
            ],
            'fixed_sources' => [
                self::fixedSource('Channel comments defaults', 'ChannelCommentsReport filters: hours=24,min=1000,limit=1000', '預設與 bounds 寫死在 service；隨部署更新。'),
                self::fixedSource('Comment JSON parser', 'ChannelCommentsReport::decodeMap authors_json', 'authors_json 相容解析規則隨部署更新。'),
            ],
            'sources' => [
                self::source('urt_channel', 'urt_channel', ['mtime', 'ctime']),
                self::source('urt_video', 'urt_video', ['mtime', 'publishedAt']),
                self::source('urt_comment', 'urt_comment', ['mtime', 'ctime', 'latest_time']),
                self::source('urt_comment_author', 'urt_comment_author', ['mtime', 'ctime']),
            ],
            'graph' => [
                self::jobNode('channel_comment_queue', 'comments queue', 'service', 'youtube.comments.queue', '用本機影片挑選候選留言抓取 queue；不呼叫外部 API。'),
                self::jobNode('channel_comment_fetch', 'comments fetch', 'api', 'youtube.comments.fetch', '只有 fetch job 呼叫 YouTube commentThreads；頁面 request 不呼叫 API。'),
                self::combinedSourceNode('channel_comment_tables', 'urt_video + urt_comment', ['urt_channel', 'urt_video', 'urt_comment', 'urt_comment_author'], '影片列表、留言 JSON 與作者摘要都來自本機 DB。'),
                self::serviceNode('channel_comment_report', 'ChannelCommentsReport aggregate authors', 'request 時解析 authors_json 並聚合留言者排行。'),
                self::pageNode('channel_comment_page', '頻道留言頁', '/channels/{u_id}/comments', 'Blade 呈現影片留言摘要、作者排行與 dependency 狀態。'),
            ],
            'edges' => [
                self::edge('channel_comment_queue', 'channel_comment_fetch', 'drain queue', 'queue/fetch jobs 維護留言資料。'),
                self::edge('channel_comment_fetch', 'channel_comment_tables', 'write comments', '留言 API 結果寫入本機表。'),
                self::edge('channel_comment_tables', 'channel_comment_report', 'aggregate authors', '報表服務解析 JSON 並聚合。'),
                self::edge('channel_comment_report', 'channel_comment_page', 'render comments', 'Blade 輸出留言排行。'),
            ],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private static function channelCloud(): array
    {
        return [
            'title' => '頻道文字雲',
            'summary' => '本頁讀單一頻道的 Laravel 文字雲 cache，使用短天期與長天期差分產生文字雲；缺 cache 時由 ingestion job 重建。',
            'jobs' => [
                self::job(
                    key: 'reports.channel_cloud.build',
                    label: '頻道文字雲 cache 重建',
                    command: 'reports:channel-cloud:build --execute --u_id={u_id} --days=1,3,7,30,90 --keyword-limit=5000',
                    apiCalls: [],
                    reads: ['urt_video', 'tags'],
                    writes: ['urt_show_cloud'],
                    summary: '不呼叫外部 API；從本機頻道影片與關鍵字表重建 urt_show_cloud。',
                    scheduler: 'config/ingestion.php job reports.channel_cloud.build；每日 6 次，scheduled-write gates 通過後執行。',
                ),
                self::job(
                    key: 'youtube.channels.videos.general',
                    label: '上游影片擷取',
                    command: 'youtube:channels:videos --execute --limit=5 --max-results=3',
                    apiCalls: ['YouTube Data API playlistItems.list(part=snippet)'],
                    reads: ['urt_channel', 'urt_count', 'urt_video_schedule'],
                    writes: ['urt_video', 'urt_video_schedule', 'urt_video_live', 'urt_channel.vtime'],
                    summary: '補齊 urt_video 上游；channel cloud builder 再用本機影片重建 urt_show_cloud。',
                    scheduler: 'config/ingestion.php job youtube.channels.videos.general；每 5 分鐘。',
                ),
            ],
            'render' => [
                'controller' => 'App\Http\Controllers\Reports\ChannelDataGapController::cloud',
                'service' => 'ChannelCloudReport',
                'reads' => ['urt_show_cloud', 'urt_channel', 'urt_video', 'tags'],
                'request' => '頁面 request 本身不呼叫外部 API；讀 urt_show_cloud.keywords_json，套用 stopwords 與短長天期差分後呈現。',
                'transforms' => [
                    'days/limit bounds 在 request 時套用，longDays 由固定 mapping 決定。',
                    '分別讀短天期與長天期 urt_show_cloud cache rows。',
                    '解析 keywords_json，套用 stopwords，計算 short - long/ratio 的差分分數。',
                    '沒有 cache 時回傳 blocked_reason；頁面 request 不重建 cache、不寫 DB。',
                ],
            ],
            'fixed_sources' => [
                self::fixedSource('Channel cloud longDays mapping', 'ChannelCloudReport::longDays 1=>3,3=>7,7=>30,30=>90,90=>365', '長天期 mapping 寫死在 service。'),
                self::fixedSource('ChannelCloud keyword scan default', 'reports:channel-cloud:build --keyword-limit=5000', '預設掃描本機前 5000 個關鍵字；不是頁面瀏覽時動態決定。'),
                self::fixedSource('內建 stopwords fallback', 'shared stopword list', '文字雲會排除固定停用詞；隨部署更新。'),
            ],
            'sources' => [
                self::source('urt_show_cloud', 'urt_show_cloud', ['mtime', 'ctime']),
                self::source('urt_channel', 'urt_channel', ['mtime', 'ctime']),
                self::source('urt_video', 'urt_video', ['mtime', 'publishedAt']),
                self::source('tags', 'tags', ['mtime', 'ctime']),
            ],
            'graph' => [
                self::combinedSourceNode('channel_cloud_inputs', '本機頻道影片 / tags', ['urt_video', 'tags'], 'ChannelCloudCacheBuilder 從單一頻道影片文字與關鍵字表建立文字雲來源。', [
                    'job_details' => ['youtube.channels.videos.general'],
                ]),
                self::jobNode('channel_cloud_job', 'reports:channel-cloud:build', 'service', 'reports.channel_cloud.build', '排程或手動 execute 會重建 urt_show_cloud；不會在頁面 request 內寫 cache。'),
                self::sourceNode('channel_cloud_cache', 'urt_show_cloud cache', 'cache', 'urt_show_cloud', '保存頻道文字雲 keywords_json 與更新時間。', [
                    'job_details' => ['reports.channel_cloud.build'],
                ]),
                self::fixedNode('channel_cloud_rules', 'days / longDays / stopwords', 'days bounds、longDays mapping、stopwords 與 cache-only fallback 都在程式碼中。'),
                self::serviceNode('channel_cloud_report', 'ChannelCloudReport diff scoring', 'request 時讀短長天期 cache，計算差分 rows 與 D3 payload。'),
                self::pageNode('channel_cloud_page', '頻道文字雲頁', '/channels/{u_id}/cloud', 'Blade 呈現 D3 word cloud、排行與 dependency 狀態。'),
            ],
            'edges' => [
                self::edge('channel_cloud_inputs', 'channel_cloud_job', 'aggregate input', 'reports:channel-cloud:build 讀本機資料，不呼叫外部 API。'),
                self::edge('channel_cloud_job', 'channel_cloud_cache', 'write cache', 'execute mode upsert urt_show_cloud rows。'),
                self::edge('channel_cloud_cache', 'channel_cloud_rules', 'read periods', 'request 決定短長天期 cache lookup。'),
                self::edge('channel_cloud_rules', 'channel_cloud_report', 'diff score', '報表服務套用 stopwords 並計算差分。'),
                self::edge('channel_cloud_report', 'channel_cloud_page', 'render cloud', 'Blade 輸出文字雲。'),
            ],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private static function channelTrends(): array
    {
        return [
            'title' => '頻道趨勢折線圖',
            'summary' => '本頁讀取本機 urt_log 趨勢紀錄，產生頻道觀看、估計、移動曲線或影片數趨勢。',
            'jobs' => [
                self::job(
                    key: 'youtube.channels.stats',
                    label: '頻道統計輪詢',
                    command: 'youtube:channels:stats --execute --limit=25',
                    apiCalls: ['YouTube Data API channels.list(part=statistics)'],
                    reads: ['urt_channel'],
                    writes: ['urt_channel', 'urt_count', 'urt_log'],
                    summary: '更新 urt_log.thedata，是頻道折線圖的資料來源。',
                    scheduler: 'config/ingestion.php job youtube.channels.stats；每 9 分鐘，scheduled-write gates 通過後執行。',
                ),
                self::job(
                    key: 'reports.counts.build',
                    label: '頻道週/月增量計算',
                    command: 'reports:counts:build --execute --limit=500',
                    apiCalls: [],
                    reads: ['urt_log', 'urt_count'],
                    writes: ['urt_count'],
                    summary: '不呼叫外部 API；與頻道統計共同維護 count/log 衍生欄位。',
                    scheduler: 'config/ingestion.php job reports.counts.build；每日 6 次。',
                ),
            ],
            'render' => [
                'controller' => 'App\Http\Controllers\Reports\ChannelDataGapController::trends',
                'service' => 'ChannelTrendsReport + channel log adapter',
                'reads' => ['urt_log', 'urt_channel'],
                'request' => '頁面 request 本身不呼叫 YouTube API；建立本機 API-shaped request 讀 urt_log，依 mode 即時計算 rows。',
                'transforms' => [
                    'limit bound 1..1095，orig/each/videos query 決定 mode。',
                    'ChannelTrendsReport 透過本機 channel log adapter 取得 urt_log payload。',
                    '把 result 依 mode 映射為 value/orig/pred/moving/videos rows。',
                ],
            ],
            'fixed_sources' => [
                self::fixedSource('Channel trend modes', 'ChannelTrendsReport::mode orig,pred,moving,videos', 'mode 與 label 寫死在 service；隨部署更新。'),
                self::fixedSource('Channel trend limit', 'limit<=1095, default=300', 'query bounds 固定。'),
            ],
            'sources' => [
                self::source('urt_log', 'urt_log', ['mtime', 'ctime', 'thedate']),
                self::source('urt_channel', 'urt_channel', ['mtime', 'ctime']),
            ],
            'graph' => [
                self::jobNode('channel_trend_stats_job', 'channel stats logs', 'api', 'youtube.channels.stats', '更新 urt_log；頁面 request 不呼叫 API。'),
                self::sourceNode('channel_trend_log', 'urt_log', 'table', 'urt_log', '保存頻道歷史統計 JSON，是折線圖的主要來源。', [
                    'job_details' => ['youtube.channels.stats', 'reports.counts.build'],
                ]),
                self::serviceNode('channel_trend_report', 'ChannelTrendsReport + log adapter', 'request 時把本機 log payload 轉成 chart rows。'),
                self::pageNode('channel_trend_page', '頻道趨勢頁', '/channels/{u_id}/trends', 'Blade 呈現 mode 切換、折線圖與 dependency 狀態。'),
            ],
            'edges' => [
                self::edge('channel_trend_stats_job', 'channel_trend_log', 'write log', 'channels:stats 維護歷史 log。'),
                self::edge('channel_trend_log', 'channel_trend_report', 'adapt API payload', '報表服務讀本機 API payload 並轉 chart rows。'),
                self::edge('channel_trend_report', 'channel_trend_page', 'render chart', 'Blade 輸出頻道趨勢圖。'),
            ],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private static function channelPeople(): array
    {
        return [
            'title' => '頻道人物排行',
            'summary' => '本頁讀單一頻道近 N 天 oneday AI rows，從 result_json 中的人物欄位聚合人物排行與每日矩陣。',
            'jobs' => [
                self::job(
                    key: 'ai.daily',
                    label: '頻道 AI 摘要',
                    command: 'ai:daily --execute --channel-limit=39 --channel-batch-size=12 --ai-call-limit=45 --channel-video-limit=120 --limit=1000',
                    apiCalls: ['OpenCode-compatible chat completions (OPENAI_BASE_URL / OPENAI_MODEL)'],
                    reads: ['urt_video', 'urt_channel_ai', 'urt_count'],
                    writes: ['urt_channel_ai', 'urt_ai_date'],
                    summary: '產生 urt_channel_ai oneday rows；只在 job 執行時呼叫 AI API。',
                    scheduler: 'config/ingestion.php job ai.daily；每日 16:15，scheduled-write gates 通過後執行。',
                ),
            ],
            'render' => [
                'controller' => 'App\Http\Controllers\Reports\ChannelPeopleController',
                'service' => 'App\Services\Legacy\ChannelPeopleReport',
                'reads' => ['urt_channel', 'urt_channel_ai'],
                'request' => '頁面 request 本身不呼叫 AI API；讀 urt_channel_ai oneday rows，解析 result_json 並即時聚合人物排行。',
                'transforms' => [
                    'days bound 1..90，limit bound 1..30。',
                    '取該頻道 oneday AI 最新 date_from 作為 to，回推 days 範圍。',
                    '解析 result_json 中的 人物/people 與 videoId 欄位，排除固定 EXCLUDED_PEOPLE。',
                    '依 topics/videos 排序人物，產生每日矩陣。',
                ],
            ],
            'fixed_sources' => [
                self::fixedSource('Excluded people list', 'ChannelPeopleReport::EXCLUDED_PEOPLE', '排除名單寫死在程式碼；隨部署更新。'),
                self::fixedSource('AI JSON compatibility keys', 'ChannelPeopleReport::decodeList/stringList', 'AI JSON 解析相容規則寫在 service。'),
                self::fixedSource('Channel people bounds', 'days<=90, limit<=30', 'query bounds 固定。'),
            ],
            'sources' => [
                self::source('urt_channel', 'urt_channel', ['mtime', 'ctime']),
                self::source('urt_channel_ai', 'urt_channel_ai', ['mtime', 'ctime', 'date_from', 'date_to']),
            ],
            'graph' => [
                self::jobNode('channel_people_ai_job', 'ai:daily channel AI', 'api', 'ai.daily', '只有 AI job 呼叫模型 API；頁面只讀 AI cache。'),
                self::sourceNode('channel_people_ai', 'urt_channel_ai oneday rows', 'table', 'urt_channel_ai', '保存單頻道每日 AI result_json，是人物排行來源。'),
                self::fixedNode('channel_people_rules', 'excluded people / parse rules', '排除人物名單、日期/limit bounds 與 JSON keys 隨部署更新。'),
                self::serviceNode('channel_people_report', 'ChannelPeopleReport aggregate people', 'request 時解析 AI JSON，聚合人物 topics/videos 與日期矩陣。'),
                self::pageNode('channel_people_page', '頻道人物排行頁', '/channels/{u_id}/people', 'Blade 呈現人物排行與每日矩陣。'),
            ],
            'edges' => [
                self::edge('channel_people_ai_job', 'channel_people_ai', 'write AI rows', 'ai:daily 寫入 urt_channel_ai。'),
                self::edge('channel_people_ai', 'channel_people_rules', 'decode JSON', 'request 依固定規則解析 AI JSON。'),
                self::edge('channel_people_rules', 'channel_people_report', 'aggregate people', '報表服務即時計算人物排行。'),
                self::edge('channel_people_report', 'channel_people_page', 'render matrix', 'Blade 輸出人物矩陣。'),
            ],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private static function channelAiOverview(): array
    {
        return [
            'title' => '頻道 AI 總覽',
            'summary' => '本頁讀單一頻道 topic/people/aspect AI rows，解析 result_json 並呈現 prompt 與最近 AI 區塊。',
            'jobs' => [
                self::job(
                    key: 'ai.daily',
                    label: '頻道 AI 摘要',
                    command: 'ai:daily --execute --channel-limit=39 --channel-batch-size=12 --ai-call-limit=45 --channel-video-limit=120 --limit=1000',
                    apiCalls: ['OpenCode-compatible chat completions (OPENAI_BASE_URL / OPENAI_MODEL)'],
                    reads: ['urt_video', 'urt_channel_ai', 'urt_count'],
                    writes: ['urt_channel_ai', 'urt_ai_date'],
                    summary: '產生 urt_channel_ai；只在 job 執行時呼叫 AI API。',
                    scheduler: 'config/ingestion.php job ai.daily；每日 16:15，scheduled-write gates 通過後執行。',
                ),
            ],
            'render' => [
                'controller' => 'App\Http\Controllers\Reports\ChannelAiOverviewController',
                'service' => 'App\Services\Legacy\ChannelAiOverviewReport',
                'reads' => ['urt_channel', 'urt_channel_ai'],
                'request' => '頁面 request 本身不呼叫 AI API；只讀 urt_channel_ai topic/people/aspect 最新 rows，解析 JSON 後呈現。',
                'transforms' => [
                    '依 u_id 讀 urt_channel metadata。',
                    '產生固定 prompt preview，不送出模型請求。',
                    '分別讀 data_type=topic/people/aspect 且 result_json 長度足夠的最新 row。',
                    '套用 JSON compatibility normalizers 產生事件、人物與立場區塊。',
                ],
            ],
            'fixed_sources' => [
                self::fixedSource('Channel AI prompt text', 'ChannelAiOverviewReport::prompt', 'prompt preview 文案寫死在 service；隨部署更新。'),
                self::fixedSource('AI JSON compatibility keys', 'ChannelAiOverviewReport normalizers', 'JSON 欄位相容規則固定在程式碼。'),
            ],
            'sources' => [
                self::source('urt_channel', 'urt_channel', ['mtime', 'ctime']),
                self::source('urt_channel_ai', 'urt_channel_ai', ['mtime', 'ctime', 'date_from', 'date_to']),
            ],
            'graph' => [
                self::jobNode('channel_ai_overview_job', 'ai:daily / channel AI', 'api', 'ai.daily', '只有 AI job 呼叫模型 API；頁面 request 不呼叫。'),
                self::sourceNode('channel_ai_rows', 'urt_channel_ai latest rows', 'table', 'urt_channel_ai', '保存 topic/people/aspect AI result_json。'),
                self::fixedNode('channel_ai_parse_rules', 'prompt / JSON parse rules', 'prompt 文案與 JSON key 相容規則隨部署更新。'),
                self::serviceNode('channel_ai_overview_report', 'ChannelAiOverviewReport sections', 'request 時讀最新 AI rows，解析 topic/people/aspect sections。'),
                self::pageNode('channel_ai_overview_page', '頻道 AI 總覽頁', '/channels/{u_id}/ai', 'Blade 呈現 prompt preview 與 AI 區塊。'),
            ],
            'edges' => [
                self::edge('channel_ai_overview_job', 'channel_ai_rows', 'write AI cache', 'AI job 寫入 urt_channel_ai。'),
                self::edge('channel_ai_rows', 'channel_ai_parse_rules', 'decode JSON', '頁面依固定 normalizers 解析 result_json。'),
                self::edge('channel_ai_parse_rules', 'channel_ai_overview_report', 'build sections', '報表服務組出 AI sections。'),
                self::edge('channel_ai_overview_report', 'channel_ai_overview_page', 'render AI', 'Blade 輸出頻道 AI 總覽。'),
            ],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private static function channelAiDays(): array
    {
        return [
            'title' => '頻道每日 AI',
            'summary' => '本頁讀單一頻道 oneday/todate/week AI row，解析 result_json 為每日議題列表。',
            'jobs' => [
                self::job(
                    key: 'ai.daily',
                    label: '頻道 AI 摘要',
                    command: 'ai:daily --execute --channel-limit=39 --channel-batch-size=12 --ai-call-limit=45 --channel-video-limit=120 --limit=1000',
                    apiCalls: ['OpenCode-compatible chat completions (OPENAI_BASE_URL / OPENAI_MODEL)'],
                    reads: ['urt_video', 'urt_channel_ai', 'urt_count'],
                    writes: ['urt_channel_ai', 'urt_ai_date'],
                    summary: '產生頻道 daily/week AI rows；只在 job 執行時呼叫 AI API。',
                    scheduler: 'config/ingestion.php job ai.daily；每日 16:15，scheduled-write gates 通過後執行。',
                ),
            ],
            'render' => [
                'controller' => 'App\Http\Controllers\Reports\ChannelAiDailyController',
                'service' => 'App\Services\Legacy\ChannelAiDailyReport',
                'reads' => ['urt_channel', 'urt_channel_ai'],
                'request' => '頁面 request 本身不呼叫 AI API；讀 urt_channel_ai 指定日期或最新 row，解析 result_json。',
                'transforms' => [
                    'type=week 時讀最新 week row；否則讀指定 date 或最新 oneday/todate date_from。',
                    '解析 events/topics/result/data JSON list。',
                    '抽事件、描述、分類、角度、陣營、關鍵字、人物、地名與 videoId。',
                ],
            ],
            'fixed_sources' => [
                self::fixedSource('Channel AI day type rule', 'ChannelAiDailyReport::type week or oneday', 'type whitelist 寫死在 service。'),
                self::fixedSource('AI topic JSON keys', 'ChannelAiDailyReport::topics', 'JSON 欄位相容規則隨部署更新。'),
            ],
            'sources' => [
                self::source('urt_channel', 'urt_channel', ['mtime', 'ctime']),
                self::source('urt_channel_ai', 'urt_channel_ai', ['mtime', 'ctime', 'date_from', 'date_to']),
            ],
            'graph' => [
                self::jobNode('channel_ai_day_job', 'ai:daily channel rows', 'api', 'ai.daily', '只有 AI job 呼叫模型 API；頁面只讀 cache。'),
                self::sourceNode('channel_ai_day_rows', 'urt_channel_ai daily rows', 'table', 'urt_channel_ai', '保存 oneday/todate/week result_json。'),
                self::serviceNode('channel_ai_day_report', 'ChannelAiDailyReport topics parser', 'request 時選日期/type row 並解析 topics。'),
                self::pageNode('channel_ai_day_page', '頻道每日 AI 頁', '/channels/{u_id}/ai/days/{date}', 'Blade 呈現每日重點整理與 topic cards。'),
            ],
            'edges' => [
                self::edge('channel_ai_day_job', 'channel_ai_day_rows', 'write AI rows', 'ai:daily 寫入 urt_channel_ai。'),
                self::edge('channel_ai_day_rows', 'channel_ai_day_report', 'decode topics', '報表服務解析 result_json。'),
                self::edge('channel_ai_day_report', 'channel_ai_day_page', 'render topics', 'Blade 輸出每日 AI topics。'),
            ],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private static function channelPrompt(): array
    {
        return [
            'title' => '頻道 AI Prompt Preview',
            'summary' => '本頁讀單一頻道指定日期的影片清單，在 request 時組出 AI prompt preview；不呼叫 AI API、不寫 DB。',
            'jobs' => [
                self::job(
                    key: 'youtube.channels.videos.general',
                    label: '頻道 uploads 擷取',
                    command: 'youtube:channels:videos --execute --limit=5 --max-results=3',
                    apiCalls: ['YouTube Data API playlistItems.list(part=snippet)'],
                    reads: ['urt_channel', 'urt_count', 'urt_video_schedule'],
                    writes: ['urt_video', 'urt_video_schedule', 'urt_video_live', 'urt_channel.vtime'],
                    summary: '補齊 prompt preview 需要的影片標題與統計；只在 job 執行時呼叫 YouTube。',
                    scheduler: 'config/ingestion.php job youtube.channels.videos.general；每 5 分鐘。',
                ),
                self::job(
                    key: 'youtube.videos.stats',
                    label: '影片統計輪詢',
                    command: 'youtube:videos:stats --execute --limit=25',
                    apiCalls: ['YouTube Data API videos.list(part=statistics)'],
                    reads: ['urt_video_schedule', 'urt_video'],
                    writes: ['urt_video', 'urt_video_schedule', 'urt_video_log', 'urt_video_log_history'],
                    summary: '更新 prompt preview 中的觀看、喜歡與留言統計。',
                    scheduler: 'config/ingestion.php job youtube.videos.stats；00-17 點每 7 分鐘。',
                ),
            ],
            'render' => [
                'controller' => 'App\Http\Controllers\Reports\ChannelPromptController',
                'service' => 'App\Services\Legacy\ChannelPromptReport',
                'reads' => ['urt_channel', 'urt_video'],
                'request' => '頁面 request 本身不呼叫 AI API；只讀本機影片 rows 並即時組 prompt 字串。',
                'transforms' => [
                    'date/from/to 決定影片 publishedAt 範圍，預設使用該頻道最新影片日期。',
                    '讀 urt_video，依 viewCount desc 取 limit<=1000。',
                    '依影片數即時計算 prompt min/max bounds。',
                    '把 videoId、日期、標題與觀看數組成繁中 JSON prompt preview。',
                ],
            ],
            'fixed_sources' => [
                self::fixedSource('Channel prompt template', 'ChannelPromptReport::prompt', 'prompt 文案與輸出格式寫死在程式碼；隨部署更新。'),
                self::fixedSource('Prompt bounds formula', 'ChannelPromptReport::promptBounds', '事件數 min/max 公式固定；不是排程更新來源。'),
            ],
            'sources' => [
                self::source('urt_channel', 'urt_channel', ['mtime', 'ctime']),
                self::source('urt_video', 'urt_video', ['mtime', 'publishedAt']),
            ],
            'graph' => [
                self::jobNode('channel_prompt_video_job', 'uploads/stats jobs', 'api', 'youtube.channels.videos.general', '上游 jobs 維護本機影片表；頁面 request 不呼叫外部 API。', [
                    'job_details' => ['youtube.videos.stats'],
                ]),
                self::sourceNode('channel_prompt_videos', 'urt_video rows', 'table', 'urt_video', '保存 prompt preview 使用的影片標題、發布時間與統計。'),
                self::fixedNode('channel_prompt_template', 'prompt template / bounds', 'prompt 文案、日期 fallback 與 bounds 公式都寫在 service。'),
                self::serviceNode('channel_prompt_report', 'ChannelPromptReport prompt builder', 'request 時讀影片清單並組 prompt 字串，不寫 DB。'),
                self::pageNode('channel_prompt_page', '頻道 Prompt 預覽頁', '/channels/{u_id}/prompt', 'Blade 呈現影片清單與 prompt preview。'),
            ],
            'edges' => [
                self::edge('channel_prompt_video_job', 'channel_prompt_videos', 'refresh videos', 'discovery/stats jobs 維護 urt_video。'),
                self::edge('channel_prompt_videos', 'channel_prompt_template', 'select period', 'request 日期範圍決定影片清單。'),
                self::edge('channel_prompt_template', 'channel_prompt_report', 'build prompt', '報表服務即時組 prompt。'),
                self::edge('channel_prompt_report', 'channel_prompt_page', 'render preview', 'Blade 輸出 prompt preview。'),
            ],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private static function videoDetail(): array
    {
        return [
            'title' => '影片詳情與分析',
            'summary' => '影片頁與分析頁讀指定 videoId 的影片 metadata、duration、影片統計 log、live log 與留言 JSON，request 時解析成多個趨勢與留言區塊。',
            'jobs' => [
                self::job(
                    key: 'youtube.channels.videos.general',
                    label: '影片 metadata 擷取',
                    command: 'youtube:channels:videos --execute --limit=5 --max-results=3',
                    apiCalls: ['YouTube Data API playlistItems.list(part=snippet)'],
                    reads: ['urt_channel', 'urt_count', 'urt_video_schedule'],
                    writes: ['urt_video', 'urt_video_schedule', 'urt_video_live', 'urt_channel.vtime'],
                    summary: '補齊 urt_video metadata。',
                    scheduler: 'config/ingestion.php job youtube.channels.videos.general；每 5 分鐘。',
                ),
                self::job(
                    key: 'youtube.videos.stats',
                    label: '影片統計輪詢',
                    command: 'youtube:videos:stats --execute --limit=25',
                    apiCalls: ['YouTube Data API videos.list(part=statistics)'],
                    reads: ['urt_video_schedule', 'urt_video'],
                    writes: ['urt_video', 'urt_video_schedule', 'urt_video_log', 'urt_video_log_history'],
                    summary: '更新影片統計與歷史 log。',
                    scheduler: 'config/ingestion.php job youtube.videos.stats；00-17 點每 7 分鐘。',
                ),
                self::job(
                    key: 'youtube.videos.duration',
                    label: '影片長度輪詢',
                    command: 'youtube:videos:duration --execute --limit=25 --enqueue-missing',
                    apiCalls: ['YouTube Data API videos.list(part=contentDetails)'],
                    reads: ['urt_video_duration', 'urt_video'],
                    writes: ['urt_video_duration'],
                    summary: '更新 duration/caption rows，供影片詳情顯示。',
                    scheduler: 'config/ingestion.php job youtube.videos.duration；每 23 分鐘。',
                ),
            ],
            'render' => [
                'controller' => 'App\Http\Controllers\Reports\VideoDetailController',
                'service' => 'App\Services\Legacy\VideoDetailReport',
                'reads' => ['urt_video', 'urt_video_duration', 'urt_video_live_log', 'urt_video_log', 'urt_comment'],
                'request' => '頁面 request 本身不呼叫 YouTube API；讀指定 videoId 的本機表，解析 log_json/thedata/comments_json/authors_json 後即時計算趨勢與留言排行。',
                'transforms' => [
                    'limit bound 1..200，控制 live/history/comment series 長度。',
                    '讀 urt_video 與 urt_video_duration 組 metadata 與 duration label。',
                    '解析 urt_video_live_log.log_json 產生 live hourly/daily series。',
                    '解析 urt_video_log.thedata 產生 view/like/comment history。',
                    '解析 urt_comment.comments_json/authors_json 聚合留言時序、作者排行與熱門留言。',
                ],
            ],
            'fixed_sources' => [
                self::fixedSource('Video detail limit', 'VideoDetailReport limit<=200, default=50', 'query bounds 固定。'),
                self::fixedSource('Duration formatter', 'VideoDetailReport::durationLabel', '秒數格式化規則寫死在 service。'),
                self::fixedSource('Comment JSON parser', 'VideoDetailReport::commentSummary', '留言 JSON 相容解析規則隨部署更新。'),
            ],
            'sources' => [
                self::source('urt_video', 'urt_video', ['mtime', 'publishedAt']),
                self::source('urt_video_duration', 'urt_video_duration', ['mtime', 'ctime']),
                self::source('urt_video_live_log', 'urt_video_live_log', ['mtime', 'ctime', 'the_date']),
                self::source('urt_video_log', 'urt_video_log', ['mtime', 'ctime', 'themonth']),
                self::source('urt_comment', 'urt_comment', ['mtime', 'ctime', 'latest_time']),
            ],
            'graph' => [
                self::jobNode('video_detail_metadata_job', 'video metadata/stats/duration', 'api', 'youtube.channels.videos.general', '相關 jobs 維護本機影片 metadata、stats、duration；頁面 request 不呼叫 API。', [
                    'job_details' => ['youtube.videos.stats', 'youtube.videos.duration'],
                ]),
                self::combinedSourceNode('video_detail_tables', 'video/log/comment tables', ['urt_video', 'urt_video_duration', 'urt_video_live_log', 'urt_video_log', 'urt_comment'], '影片詳情、趨勢與留言分析都來自指定 videoId 的本機 rows。'),
                self::serviceNode('video_detail_report', 'VideoDetailReport parsers', 'request 時解析 live log、video log 與 comment JSON，產生 chart/comment payload。'),
                self::pageNode('video_detail_page', '影片詳情/分析頁', '/videos/{videoId} / /videos/{videoId}/analytics', 'Blade 呈現影片 metadata、統計趨勢、直播趨勢與留言分析。'),
            ],
            'edges' => [
                self::edge('video_detail_metadata_job', 'video_detail_tables', 'refresh local rows', '上游 jobs 寫入影片與 log/comment 相關表。'),
                self::edge('video_detail_tables', 'video_detail_report', 'parse series', '報表服務解析 JSON/log 欄位並計算 series。'),
                self::edge('video_detail_report', 'video_detail_page', 'render detail', 'Blade 輸出影片詳情與分析。'),
            ],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private static function authorComments(): array
    {
        return [
            'title' => '留言者分析',
            'summary' => '本頁依留言者 author key 讀 urt_comment_author 與 revision index，回查相關影片留言 JSON，聚合留言時間、頻道與 tag 分布。',
            'jobs' => [
                self::job(
                    key: 'youtube.comments.fetch',
                    label: '留言擷取',
                    command: 'youtube:comments:fetch --execute --limit=5 --max-pages=1',
                    apiCalls: ['YouTube Data API commentThreads.list'],
                    reads: ['urt_comment_queue', 'urt_comment'],
                    writes: ['urt_comment', 'urt_comment_author', 'urt_comment_rev', 'urt_comment_queue_done'],
                    summary: '更新作者、revision index 與留言 JSON，是本頁主要來源。',
                    scheduler: 'config/ingestion.php job youtube.comments.fetch；每小時第 5 分。',
                ),
            ],
            'render' => [
                'controller' => 'App\Http\Controllers\Reports\AuthorCommentsController',
                'service' => 'App\Services\Legacy\AuthorCommentsReport',
                'reads' => ['urt_comment_author', 'urt_comment_rev', 'urt_comment', 'urt_channel', 'urt_count', 'urt_tag'],
                'request' => '頁面 request 本身不呼叫 YouTube API；讀本機 author/revision/comment rows，解析 comments_json 即時計算留言分析。',
                'transforms' => [
                    'authorKey 依 lookup query 或數字型態決定用 author_id 或 ChannelId 查找。',
                    '從 urt_comment_rev.index_json 展開該作者出現過的 videoId。',
                    '讀這些 videoId 的 urt_comment.comments_json，匹配 authorChannelId。',
                    '聚合 24 小時分布、頻道分布、指定 tag 分布與最新留言列表。',
                ],
            ],
            'fixed_sources' => [
                self::fixedSource('Author tag display set', 'AuthorCommentsReport::TAGS_TO_SHOW = 3,4,5,6,48,49', '留言者 tag 分布顯示清單寫死；隨部署更新。'),
                self::fixedSource('Lookup mode rule', 'ctype_digit(authorKey) ? author_id : ChannelId', 'lookup fallback 規則固定在 service。'),
                self::fixedSource('Author comments bounds', 'limit<=1000, hours<=8760', 'query bounds 寫死在 service；hours 目前只顯示於 filters。'),
            ],
            'sources' => [
                self::source('urt_comment_author', 'urt_comment_author', ['mtime', 'ctime']),
                self::source('urt_comment_rev', 'urt_comment_rev', ['mtime', 'ctime']),
                self::source('urt_comment', 'urt_comment', ['mtime', 'ctime', 'latest_time']),
                self::source('urt_channel', 'urt_channel', ['mtime', 'ctime']),
                self::source('urt_count', 'urt_count', ['mtime', 'ctime']),
                self::source('urt_tag', 'urt_tag', ['mtime', 'ctime']),
            ],
            'graph' => [
                self::jobNode('author_comments_fetch_job', 'comments fetch', 'api', 'youtube.comments.fetch', '只有 fetch job 呼叫 YouTube comments API；頁面 request 不呼叫。'),
                self::combinedSourceNode('author_comment_tables', 'author/revision/comment tables', ['urt_comment_author', 'urt_comment_rev', 'urt_comment', 'urt_channel', 'urt_count', 'urt_tag'], '留言者身份、video index、留言內容與頻道/tag 分布都來自本機表。'),
                self::fixedNode('author_comment_rules', 'lookup / tag display rules', 'lookup fallback 與 tag display 清單寫在程式碼。'),
                self::serviceNode('author_comment_report', 'AuthorCommentsReport analyzer', 'request 時解析 comments_json，聚合時間、頻道與 tag 分布。'),
                self::pageNode('author_comment_page', '留言者分析頁', '/comments/authors/{authorKey}', 'Blade 呈現留言者摘要、24 小時分布、頻道/tag 分布與留言列表。'),
            ],
            'edges' => [
                self::edge('author_comments_fetch_job', 'author_comment_tables', 'write comments', 'fetch job 維護 author/revision/comment rows。'),
                self::edge('author_comment_tables', 'author_comment_rules', 'lookup author', 'request key 與固定規則決定作者 lookup。'),
                self::edge('author_comment_rules', 'author_comment_report', 'analyze comments', '報表服務解析留言 JSON 並聚合。'),
                self::edge('author_comment_report', 'author_comment_page', 'render analysis', 'Blade 輸出留言者分析。'),
            ],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private static function groupDirectory(): array
    {
        return [
            'title' => '群組目錄',
            'summary' => '群組首頁與群組明細讀 tag_group；若本機資料缺少，會使用程式碼內建 legacy group fallback，不呼叫外部 API。',
            'jobs' => [
                self::job(
                    key: 'reports.groups.build',
                    label: '群組同步',
                    command: 'reports:groups:build --execute --hours=22 --limit=100',
                    apiCalls: ['https://tag.analysis.tw/api/group.php?hours={hours}'],
                    reads: [],
                    writes: ['tag_group'],
                    summary: '從新文易數 group API 同步 tag_group；只在 job 執行時呼叫外部 API。',
                    scheduler: 'config/ingestion.php job reports.groups.build；每日 6 次，scheduled-write gates 通過後執行。',
                ),
            ],
            'render' => [
                'controller' => 'App\Http\Controllers\Reports\GroupDirectoryController',
                'service' => 'App\Services\Legacy\GroupDirectoryReport',
                'reads' => ['tag_group'],
                'request' => '頁面 request 本身不呼叫外部 API；讀本機 tag_group，缺資料時使用內建 fallback group 清單。',
                'transforms' => [
                    'groups.index 依 group_name 聚合 tag_count 與 latest_time。',
                    'groups.show 依 groupName 讀 tag_group tags；若沒有 rows，使用 configuredGroups fallback。',
                    '固定 fallback 只提供少數 legacy group seed，不會寫入 DB。',
                ],
            ],
            'fixed_sources' => [
                self::fixedSource('Configured legacy groups fallback', 'GroupDirectoryReport::configuredGroups', 'fallback group/tag 清單寫死在程式碼；只有部署會變更。'),
                self::fixedSource('Deleted group filter', 'tag_group.del_flag IS NULL OR < 1', '固定 SQL 條件；不會由排程改寫。'),
            ],
            'sources' => [
                self::source('tag_group', 'tag_group', ['mtime', 'ctime', 'latest_time']),
            ],
            'graph' => [
                self::jobNode('group_sync_job', 'reports:groups:build', 'api', 'reports.groups.build', '同步 tag_group 時才呼叫 tag.analysis.tw；頁面 request 不呼叫外部 API。'),
                self::sourceNode('group_table', 'tag_group', 'table', 'tag_group', '保存 group_name、tag、latest_time 與 del_flag，是群組目錄主要資料表。'),
                self::fixedNode('group_fallbacks', 'configured group fallback', 'tag_group 缺資料時使用程式碼內建 fallback groups，不寫 DB。'),
                self::serviceNode('group_directory_report', 'GroupDirectoryReport listing', 'request 時聚合 group rows 或 fallback，產生目錄/明細 payload。'),
                self::pageNode('group_directory_page', '群組目錄/明細頁', '/groups / /groups/{groupName}', 'Blade 呈現群組列表或單一群組 tags 與報表入口。'),
            ],
            'edges' => [
                self::edge('group_sync_job', 'group_table', 'upsert groups', 'groups build 更新 tag_group。'),
                self::edge('group_table', 'group_fallbacks', 'fallback if empty', '缺資料時改用程式碼 fallback。'),
                self::edge('group_fallbacks', 'group_directory_report', 'build rows', '報表服務組出 groups/tags rows。'),
                self::edge('group_directory_report', 'group_directory_page', 'render directory', 'Blade 輸出群組頁面。'),
            ],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private static function groupMetrics(): array
    {
        return [
            'title' => '群組排行與趨勢',
            'summary' => '群組排行與趨勢使用固定 live group definitions 讀 urt_show_tag_date cache，計算各群組區間排名或七日 rolling 趨勢。',
            'jobs' => [
                self::job(
                    key: 'reports.tag_date.build',
                    label: '逐日 tag cache 重建',
                    command: 'reports:tag-date:build --tagid=1 --days=30 --execute',
                    apiCalls: [],
                    reads: ['urt_video', 'urt_count', 'tags'],
                    writes: ['urt_show_tag_date'],
                    summary: '不呼叫外部 API；重建群組指標使用的 total_views/count_videos cache。',
                    scheduler: 'config/ingestion.php job reports.tag_date.build；每日 6 次。',
                ),
                self::job(
                    key: 'reports.static.html',
                    label: 'Legacy static group report preview',
                    command: 'reports:static:build',
                    apiCalls: [],
                    reads: ['urt_show_tag_date'],
                    writes: [],
                    summary: '不呼叫外部 API；現代 Laravel route 動態產生頁面，static build 只作 preview/對照。',
                    scheduler: 'config/ingestion.php job reports.static.html；每日 08:13。',
                ),
            ],
            'render' => [
                'controller' => 'App\Http\Controllers\Reports\GroupMetricController',
                'service' => 'App\Services\Legacy\GroupMetricReport',
                'reads' => ['urt_show_tag_date'],
                'request' => '頁面 request 本身不呼叫外部 API；讀本機 urt_show_tag_date，依固定 group filters 即時計算 ranking 或 trend。',
                'transforms' => [
                    'route groupName 或 query group 選 LegacyLiveGroupDefinitions 中的固定群組。',
                    'ranking 讀 from..to cache，計算 views_sum/median、videos_sum/median。',
                    'trend 讀 cache_from..to cache，對每日期累加前 6 日 total_views 或 count_videos。',
                    'dates/from/to/days/today/type query 只影響 request-time 查詢與計算。',
                ],
            ],
            'fixed_sources' => [
                self::fixedSource('Live group definitions', 'App\Services\Legacy\LegacyLiveGroupDefinitions', '群組、tag_para 與 filter strings 寫在程式碼；隨部署更新。'),
                self::fixedSource('Group metric types', 'GroupMetricReport::types total_views,count_videos', '指標與 aliases 固定在 service。'),
                self::fixedSource('Rolling rule', 'GroupMetricReport trend offsets 0..6', '七日 rolling 規則固定；不會由排程更新。'),
            ],
            'sources' => [
                self::source('urt_show_tag_date', 'urt_show_tag_date', ['mtime', 'ctime', 'the_date']),
            ],
            'graph' => [
                self::jobNode('group_metric_cache_job', 'reports:tag-date:build', 'service', 'reports.tag_date.build', '維護 urt_show_tag_date cache；頁面 request 不寫 cache。'),
                self::sourceNode('group_metric_cache', 'urt_show_tag_date cache', 'cache', 'urt_show_tag_date', '保存固定 tag filter 對應的每日 total_views/count_videos。'),
                self::fixedNode('group_metric_defs', 'fixed group / metric rules', '群組 definitions、metric whitelist 與 rolling 規則隨部署更新。'),
                self::serviceNode('group_metric_report', 'GroupMetricReport ranking/trend', 'request 時讀 cache，計算 ranking 或 trend series。'),
                self::pageNode('group_metric_page', '群組排行/趨勢頁', '/groups/{groupName}/ranking / /groups/{groupName}/trends', 'Blade 呈現 ranking table 或 trend chart。'),
            ],
            'edges' => [
                self::edge('group_metric_cache_job', 'group_metric_cache', 'write cache', 'tag-date build 維護逐日 cache。'),
                self::edge('group_metric_cache', 'group_metric_defs', 'select filters', '固定 group filters 決定讀取哪組 cache。'),
                self::edge('group_metric_defs', 'group_metric_report', 'aggregate metrics', '報表服務即時計算排名或趨勢。'),
                self::edge('group_metric_report', 'group_metric_page', 'render report', 'Blade 輸出群組報表。'),
            ],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private static function groupLive(): array
    {
        return [
            'title' => '群組直播趨勢',
            'summary' => '本頁把固定 tag set 或 tag_group 清單與直播群組 definitions 結合，讀 urt_show_live_tag_date cache，比較關鍵字在直播中的七日 rolling 表現。',
            'jobs' => [
                self::job(
                    key: 'legacy.live_tag_date.cache',
                    label: 'Legacy live tag-date cache',
                    command: 'approved legacy snapshot/export -> urt_show_live_tag_date',
                    apiCalls: [],
                    reads: ['approved legacy snapshot/export', 'urt_video_live_log', 'urt_count'],
                    writes: ['urt_show_live_tag_date'],
                    summary: '目前 Laravel scheduler 不常態重建 live keyword cache；頁面只讀既有 cache。',
                    scheduler: '不會由目前 Laravel 排程常態重建；reports:live:clean 只清理 invalid cache rows。',
                ),
                self::job(
                    key: 'reports.groups.build',
                    label: '群組同步',
                    command: 'reports:groups:build --execute --hours=22 --limit=100',
                    apiCalls: ['https://tag.analysis.tw/api/group.php?hours={hours}'],
                    reads: [],
                    writes: ['tag_group'],
                    summary: '非 tags_ legacy set 可從 tag_group 讀 tag 清單；同步時才呼叫外部 group API。',
                    scheduler: 'config/ingestion.php job reports.groups.build；每日 6 次。',
                ),
            ],
            'render' => [
                'controller' => 'App\Http\Controllers\Reports\GroupLiveController',
                'service' => 'App\Services\Legacy\GroupLiveReport',
                'reads' => ['urt_show_live_tag_date', 'tag_group'],
                'request' => '頁面 request 本身不呼叫 YouTube 或 tag.analysis API；讀固定/fallback tag set、tag_group 與 live tag-date cache，即時計算 group live series。',
                'transforms' => [
                    'groupName 以 tags_ 開頭時讀 legacy group file 或內建 fallback；否則讀 tag_group tags。',
                    'view query 決定 LegacyKeywordGroupDefinitions 中的比較群組。',
                    '讀 urt_show_live_tag_date.tags_views 或 tags_video，對每個 tag 取每日 hourly max。',
                    '每個日期累加前 6 日，依 latest 排序 tag series。',
                ],
            ],
            'fixed_sources' => [
                self::fixedSource('Legacy tag set fallback', 'GroupLiveReport::tagSetFromLegacyFile fallback tags_president2024/tags_straits', 'fallback tag set 寫死；隨部署更新。'),
                self::fixedSource('Comparison definitions', 'App\Services\Legacy\LegacyKeywordGroupDefinitions', '比較群組 definitions 寫在程式碼。'),
                self::fixedSource('Live cache status', 'urt_show_live_tag_date.tags_views/tags_video', '目前不由 Laravel scheduler 常態重建。'),
            ],
            'sources' => [
                self::source('urt_show_live_tag_date', 'urt_show_live_tag_date', ['mtime', 'ctime', 'the_date']),
                self::source('tag_group', 'tag_group', ['mtime', 'ctime', 'latest_time']),
            ],
            'graph' => [
                self::fixedNode('group_live_defs', 'tag set / comparison definitions', 'legacy tag sets、fallback tags 與 comparison groups 隨部署更新。'),
                self::combinedSourceNode('group_live_sources', 'live cache + tag_group', ['urt_show_live_tag_date', 'tag_group'], 'tag 清單與直播 keyword cache 來自本機資料或固定 fallback。', [
                    'job_details' => ['legacy.live_tag_date.cache', 'reports.groups.build'],
                ]),
                self::serviceNode('group_live_report', 'GroupLiveReport rolling live series', 'request 時解析 hourly keyword maps，計算七日 rolling group/tag series。'),
                self::pageNode('group_live_page', '群組直播頁', '/groups/{groupName}/live', 'Blade 呈現群組直播比較圖與 tag series。'),
            ],
            'edges' => [
                self::edge('group_live_defs', 'group_live_sources', 'select tags/groups', '固定 definitions 與 tag_group 決定查詢範圍。'),
                self::edge('group_live_sources', 'group_live_report', 'rolling live aggregate', '報表服務解析 live cache 並計算 rolling values。'),
                self::edge('group_live_report', 'group_live_page', 'render live trends', 'Blade 輸出群組直播圖。'),
            ],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private static function mayorReport(): array
    {
        return [
            'title' => '縣市首長候選人支持度',
            'summary' => '本頁讀固定縣市候選人/加權規則與 urt_show_tag_date cache，計算候選人在地方政治 tag 中的 rolling 支持度百分比。',
            'jobs' => [
                self::job(
                    key: 'reports.mayor.static',
                    label: 'Mayor cache rebuild preview/execute',
                    command: 'reports:mayor:static --execute --limit=5 --keyword-limit=5000',
                    apiCalls: [],
                    reads: ['urt_video', 'urt_count', 'tags'],
                    writes: ['urt_show_tag_date'],
                    summary: '不呼叫外部 API；用本機資料重建 mayor 需要的 urt_show_tag_date rows，動態 Laravel route 取代靜態 HTML。',
                    scheduler: 'config/ingestion.php job reports.mayor.static；每 5 小時第 13 分 ingestion preview；scheduled execute 需 gates/allowlist。',
                ),
                self::job(
                    key: 'reports.tag_date.build',
                    label: '逐日 tag cache 重建',
                    command: 'reports:tag-date:build --tagid=1 --days=30 --execute',
                    apiCalls: [],
                    reads: ['urt_video', 'urt_count', 'tags'],
                    writes: ['urt_show_tag_date'],
                    summary: '不呼叫外部 API；也會更新本頁讀取的 tagid 3/4/5/6 逐日 cache。',
                    scheduler: 'config/ingestion.php job reports.tag_date.build；每日 6 次。',
                ),
            ],
            'render' => [
                'controller' => 'App\Http\Controllers\Reports\MayorReportController',
                'service' => 'App\Services\Legacy\MayorReport',
                'reads' => ['urt_show_tag_date'],
                'request' => '頁面 request 本身不呼叫外部 API；讀本機 urt_show_tag_date，套用固定城市/候選人 factors 即時計算 support series。',
                'transforms' => [
                    'city route/query 經 normalizeCity 後選 fallbackCities 或 legacy mayor php config。',
                    '只讀 tagid 3/4/5/6 且 tag_or/tag_not 空的 urt_show_tag_date rows。',
                    '每個候選人依城市 factors 加權，每日使用雙層七日 rolling 計算 raw score。',
                    'raw score 取正值後正規化為百分比；若 views 無資料會 fallback 到 tags_video。',
                ],
            ],
            'fixed_sources' => [
                self::fixedSource('Mayor city/candidate fallback', 'MayorReport::fallbackCities', '候選人與 factor templates 是 curated 固定資料；目前標示更新日 2026-05-28，只有部署會變更。'),
                self::fixedSource('Mayor tag ids', 'MayorReport::tagIds = 3,4,5,6', '參與計算的 tag ids 寫死在 service。'),
                self::fixedSource('Mayor factor templates', 'MayorReport::factorTemplate green/blue/white/other', '加權矩陣固定；不會由排程更新。'),
            ],
            'sources' => [
                self::source('urt_show_tag_date', 'urt_show_tag_date', ['mtime', 'ctime', 'the_date']),
            ],
            'graph' => [
                self::fixedNode('mayor_rules', 'city candidates / factors', '城市候選人、tag ids 與加權矩陣為程式碼固定規則，隨部署更新。'),
                self::jobNode('mayor_cache_job', 'reports:mayor:static / tag-date build', 'service', 'reports.mayor.static', '用本機影片與 tags 重建 mayor 所需逐日 cache；不在頁面 request 執行。', [
                    'job_details' => ['reports.tag_date.build'],
                ]),
                self::sourceNode('mayor_tag_cache', 'urt_show_tag_date cache', 'cache', 'urt_show_tag_date', '保存候選人 keyword 在政治 tag 中的 daily weights。'),
                self::serviceNode('mayor_report', 'MayorReport weighted rolling support', 'request 時套用固定 factors 與 rolling 規則，計算百分比 series。'),
                self::pageNode('mayor_page', '市長/縣市首長報表頁', '/mayor / /mayor/cities/{city}', 'Blade 呈現縣市切換、候選人支持度趨勢與 cache 狀態。'),
            ],
            'edges' => [
                self::edge('mayor_rules', 'mayor_cache_job', 'select tag ids', '固定候選人與 tag ids 決定 cache 需求。'),
                self::edge('mayor_cache_job', 'mayor_tag_cache', 'write cache', 'mayor/static 或 tag-date build 維護 cache。'),
                self::edge('mayor_tag_cache', 'mayor_report', 'weighted rolling', '報表服務讀 cache 並套用 factors。'),
                self::edge('mayor_report', 'mayor_page', 'render support', 'Blade 輸出候選人支持度圖。'),
            ],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private static function aiHours(): array
    {
        return [
            'title' => 'AI 每小時摘要',
            'summary' => '本頁讀 urt_ai_hour cache，依 date、condition、type 顯示每小時事件；頁面 request 不呼叫 AI API。',
            'jobs' => [
                self::job(
                    key: 'ai.hourly',
                    label: 'AI hourly summary',
                    command: 'ai:hourly --execute --limit=20',
                    apiCalls: ['OpenCode-compatible chat completions (OPENAI_BASE_URL / OPENAI_MODEL)'],
                    reads: ['urt_video', 'urt_count'],
                    writes: ['urt_ai_hour'],
                    summary: '產生每小時事件摘要；只在 job 執行時呼叫 AI API。',
                    scheduler: 'config/ingestion.php job ai.hourly；每小時第 10 分，scheduled-write gates 通過後執行。',
                ),
            ],
            'render' => [
                'controller' => 'App\Http\Controllers\Reports\AiHourlyController',
                'service' => 'App\Services\Legacy\AiHourlyReport',
                'reads' => ['urt_ai_hour'],
                'request' => '頁面 request 本身不呼叫 AI API；讀 urt_ai_hour.result_json，依 date/condition/type/limit 即時解析 topics。',
                'transforms' => [
                    'condition 只允許安全字元，預設 all；未指定 date 時使用該 condition 最新 date_from。',
                    '依 date_from 範圍、condition_type 與 data_type 查 urt_ai_hour。',
                    '每個 hour row 解析 result_json events/topics/result/data list，取 limit topics。',
                    'Blade 顯示每小時主要事件、關鍵字、人物與代表影片。',
                ],
            ],
            'fixed_sources' => [
                self::fixedSource('AI hourly condition labels', 'AiHourlyReport::title condition map', 'condition 標題 mapping 寫死在 service。'),
                self::fixedSource('AI JSON compatibility keys', 'AiHourlyReport::decode/topic', 'JSON 欄位相容規則隨部署更新。'),
                self::fixedSource('AI provider/model env', 'OPENAI_BASE_URL / OPENAI_MODEL', 'runtime env 控制上游模型；secret 不寫入 git 或頁面。'),
            ],
            'sources' => [
                self::source('urt_ai_hour', 'urt_ai_hour', ['mtime', 'ctime', 'date_from', 'date_to']),
            ],
            'graph' => [
                self::jobNode('ai_hourly_job', 'ai:hourly generation', 'api', 'ai.hourly', '只有 ai:hourly job 呼叫模型 API；頁面 request 不呼叫。'),
                self::sourceNode('ai_hourly_cache', 'urt_ai_hour cache', 'cache', 'urt_ai_hour', '保存每小時 AI result_json 與 condition/data_type metadata。'),
                self::serviceNode('ai_hourly_report', 'AiHourlyReport topics parser', 'request 時依 condition/date 查 cache 並解析 topics。'),
                self::pageNode('ai_hourly_page', 'AI 每小時摘要頁', '/ai/hours', 'Blade 呈現分時事件列表與摘要。'),
            ],
            'edges' => [
                self::edge('ai_hourly_job', 'ai_hourly_cache', 'write AI rows', 'ai:hourly 寫入 urt_ai_hour。'),
                self::edge('ai_hourly_cache', 'ai_hourly_report', 'decode JSON', '報表服務解析 result_json。'),
                self::edge('ai_hourly_report', 'ai_hourly_page', 'render hours', 'Blade 輸出每小時摘要。'),
            ],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private static function aiPeriods(): array
    {
        return [
            'title' => 'AI 期間摘要',
            'summary' => '本頁讀 urt_ai_date daily cache，把指定期間內每日事件展平成期間事件列表；頁面 request 不呼叫 AI API。',
            'jobs' => [
                self::job(
                    key: 'ai.daily',
                    label: 'AI daily summary',
                    command: 'ai:daily --execute --channel-limit=39 --channel-batch-size=12 --ai-call-limit=45 --channel-video-limit=120 --limit=1000',
                    apiCalls: ['OpenCode-compatible chat completions (OPENAI_BASE_URL / OPENAI_MODEL)'],
                    reads: ['urt_video', 'urt_channel_ai', 'urt_count'],
                    writes: ['urt_channel_ai', 'urt_ai_date'],
                    summary: '產生日摘要與 data_json 統計；只在 job 執行時呼叫 AI API。',
                    scheduler: 'config/ingestion.php job ai.daily；每日 16:15。',
                ),
            ],
            'render' => [
                'controller' => 'App\Http\Controllers\Reports\AiPeriodController',
                'service' => 'App\Services\Legacy\AiPeriodReport',
                'reads' => ['urt_ai_date'],
                'request' => '頁面 request 本身不呼叫 AI API；讀 urt_ai_date，依 month/from/to/condition/type/limit 即時計算期間 topics。',
                'transforms' => [
                    'month query 可指定整月；否則使用 from/to，最多輸出 62 天日期序列。',
                    '依 condition_type/data_type 查每日 urt_ai_date rows，每日只取最新 pk。',
                    '優先解析 data_json 的統計物件；沒有 data_json 時從 result_json 事件列表推導 media/video counts。',
                    '依 limit 展平為期間 topics。',
                ],
            ],
            'fixed_sources' => [
                self::fixedSource('AI period date bounds', 'AiPeriodReport::dates max 62 days', '日期序列上限寫死在 service。'),
                self::fixedSource('AI period condition labels', 'AiPeriodReport::title condition map', 'condition 標題 mapping 隨部署更新。'),
                self::fixedSource('AI JSON compatibility keys', 'AiPeriodReport::topicsForRow', 'data_json/result_json 解析相容規則固定在程式碼。'),
            ],
            'sources' => [
                self::source('urt_ai_date', 'urt_ai_date', ['mtime', 'ctime', 'date_from', 'date_to']),
            ],
            'graph' => [
                self::jobNode('ai_period_daily_job', 'ai:daily generation', 'api', 'ai.daily', '只有 ai:daily job 呼叫模型 API；頁面 request 不呼叫。'),
                self::sourceNode('ai_period_cache', 'urt_ai_date cache', 'cache', 'urt_ai_date', '保存每日 AI result_json/data_json，是期間列表來源。'),
                self::serviceNode('ai_period_report', 'AiPeriodReport period flattener', 'request 時查日期範圍、解碼每日 row 並展平成 topics。'),
                self::pageNode('ai_period_page', 'AI 期間摘要頁', '/ai/periods', 'Blade 呈現期間事件、媒體數、影片數、人物與關鍵字摘要。'),
            ],
            'edges' => [
                self::edge('ai_period_daily_job', 'ai_period_cache', 'write daily rows', 'ai:daily 寫入 urt_ai_date。'),
                self::edge('ai_period_cache', 'ai_period_report', 'flatten topics', '報表服務解析期間 rows。'),
                self::edge('ai_period_report', 'ai_period_page', 'render period', 'Blade 輸出期間摘要。'),
            ],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private static function aiEvent(): array
    {
        return [
            'title' => 'AI 事件分析',
            'summary' => '事件 show/people/wall 頁讀 urt_ai_date、urt_ai_event 與 urt_ai_period，解析事件摘要、人物/媒體立場與跨日歷史鏈。',
            'jobs' => [
                self::job(
                    key: 'ai.daily',
                    label: 'AI daily/event inputs',
                    command: 'ai:daily --execute --channel-limit=39 --channel-batch-size=12 --ai-call-limit=45 --channel-video-limit=120 --limit=1000',
                    apiCalls: ['OpenCode-compatible chat completions (OPENAI_BASE_URL / OPENAI_MODEL)'],
                    reads: ['urt_video', 'urt_channel_ai', 'urt_count'],
                    writes: ['urt_channel_ai', 'urt_ai_date'],
                    summary: '產生 daily AI rows；事件頁會以 urt_ai_date pk 作為 aipk 來源。',
                    scheduler: 'config/ingestion.php job ai.daily；每日 16:15。',
                ),
                self::job(
                    key: 'ai.period',
                    label: 'AI period event matching',
                    command: 'ai:period --execute --from=YYYY-MM-DD --to=YYYY-MM-DD --condition=all',
                    apiCalls: ['OpenCode-compatible chat completions (OPENAI_BASE_URL / OPENAI_MODEL)'],
                    reads: ['urt_ai_date', 'urt_channel_ai'],
                    writes: ['urt_ai_period'],
                    summary: '比較相鄰兩天可顯示 daily topics，將同一條事件線的不同日標題寫入 urt_ai_period。',
                    scheduler: 'config/ingestion.php job ai.period；目前 planned/manual，未設定 scheduled execute command。',
                ),
                self::job(
                    key: 'ai.event',
                    label: 'AI event summary/people/media',
                    command: 'ai:event --execute --date=YYYY-MM-DD --condition=all',
                    apiCalls: ['OpenCode-compatible chat completions (OPENAI_BASE_URL / OPENAI_MODEL)'],
                    reads: ['urt_ai_date', 'urt_channel_ai'],
                    writes: ['urt_ai_event'],
                    summary: '針對 daily topic 產生 summary、people、media 三種 event cache；頁面 request 本身不呼叫 AI。',
                    scheduler: 'config/ingestion.php job ai.event；目前 planned/manual，未設定 scheduled execute command。',
                ),
            ],
            'render' => [
                'controller' => 'App\Http\Controllers\Reports\AiEventController',
                'service' => 'App\Services\Legacy\AiEventReport',
                'reads' => ['urt_ai_date', 'urt_ai_event', 'urt_ai_period'],
                'request' => '頁面 request 本身不呼叫 AI API；讀本機 AI daily/event/period rows，解析 result_json 與 data_json 即時計算事件 views。',
                'transforms' => [
                    'id 可能是 urt_ai_event pk 或 urt_ai_date pk；event query 可指定 event_name。',
                    '讀 prompt_type=summary/people/media 的最新 urt_ai_event rows。',
                    'summary 頁解析 facts/opinions；people 頁解析 supporting/opposing/other；wall 頁由事件 evidence/person videos 去重。',
                    'periodHistory 讀 urt_ai_period，嘗試追前 60 天的事件鏈；相鄰日 mapping 可由 ai:period 產生。',
                ],
            ],
            'fixed_sources' => [
                self::fixedSource('AI event modes', 'AiEventReport mode show/people/wall', 'mode whitelist 寫死在 controller/service。'),
                self::fixedSource('AI event JSON keys', 'AiEventReport summaryEvents/people/media', '事件、人物、媒體 JSON 欄位相容規則隨部署更新。'),
                self::fixedSource('Period history bound', 'AiEventReport::periodHistory offset < 60', '跨日追蹤最多 60 天；固定在程式碼。'),
            ],
            'sources' => [
                self::source('urt_ai_date', 'urt_ai_date', ['mtime', 'ctime', 'date_from', 'date_to']),
                self::source('urt_ai_event', 'urt_ai_event', ['mtime', 'ctime', 'date_from', 'date_to']),
                self::source('urt_ai_period', 'urt_ai_period', ['mtime', 'ctime', 'date_from', 'date_to']),
            ],
            'graph' => [
                self::jobNode('ai_event_daily_job', 'ai:daily source rows', 'api', 'ai.daily', '產生 daily source rows；頁面 request 不呼叫模型 API。'),
                self::jobNode('ai_event_period_job', 'ai:period matching', 'api', 'ai.period', '比較相鄰兩天 daily topics，寫入 urt_ai_period 事件鏈。'),
                self::jobNode('ai_event_job', 'ai:event event rows', 'api', 'ai.event', '產生 summary/people/media event rows；頁面 request 不呼叫模型 API。'),
                self::sourceNode('ai_event_cache', 'urt_ai_event / period cache', 'cache', 'urt_ai_event', '保存事件 summary/people/media AI JSON 與 period mapping。', [
                    'source_details' => ['urt_ai_period', 'urt_ai_date'],
                    'job_details' => ['ai.period', 'ai.event'],
                ]),
                self::fixedNode('ai_event_rules', 'mode / JSON / history rules', 'mode、JSON keys 與最多 60 天 period history 追蹤規則固定在 service。'),
                self::serviceNode('ai_event_report', 'AiEventReport event resolver', 'request 時解析事件 row、人物/媒體 JSON、wall videos 與歷史鏈。'),
                self::pageNode('ai_event_page', 'AI 事件頁', '/ai/events/{id}', 'Blade 呈現事件摘要、人物頁或 wall 頁。'),
            ],
            'edges' => [
                self::edge('ai_event_daily_job', 'ai_event_period_job', 'daily topics', 'ai:period 以 daily rows 與 fallback topics 作為相鄰日 matching 輸入。'),
                self::edge('ai_event_period_job', 'ai_event_cache', 'period chain', 'ai:period 將相鄰日事件鏈寫入 urt_ai_period。'),
                self::edge('ai_event_daily_job', 'ai_event_job', 'daily topics', 'ai:event 以 daily rows 與 fallback topics 作為 event summary/people/media prompt 輸入。'),
                self::edge('ai_event_job', 'ai_event_cache', 'event rows', 'ai:event 將事件 summary/people/media 寫入 urt_ai_event。'),
                self::edge('ai_event_cache', 'ai_event_rules', 'decode mode', 'request mode 決定解析哪種事件 payload。'),
                self::edge('ai_event_rules', 'ai_event_report', 'resolve event', '報表服務解析 event/people/media/history。'),
                self::edge('ai_event_report', 'ai_event_page', 'render event', 'Blade 輸出 AI 事件頁。'),
            ],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private static function aiAspects(): array
    {
        return [
            'title' => 'AI 立場分布',
            'summary' => '本頁依 tag/condition filters 選頻道，讀每個頻道最新 aspect AI row，解析政治與兩岸角度分數並排序。',
            'jobs' => [
                self::job(
                    key: 'ai.daily',
                    label: '頻道 aspect AI',
                    command: 'ai:daily --execute --channel-limit=39 --channel-batch-size=12 --ai-call-limit=45 --channel-video-limit=120 --limit=1000',
                    apiCalls: ['OpenCode-compatible chat completions (OPENAI_BASE_URL / OPENAI_MODEL)'],
                    reads: ['urt_video', 'urt_channel_ai', 'urt_count'],
                    writes: ['urt_channel_ai', 'urt_ai_date'],
                    summary: '產生頻道 AI rows；aspect row 由受控 AI workflow 寫入 urt_channel_ai。',
                    scheduler: 'config/ingestion.php job ai.daily；每日 16:15。',
                ),
                self::job(
                    key: 'youtube.channels.stats',
                    label: '頻道 tag/統計來源',
                    command: 'youtube:channels:stats --execute --limit=25',
                    apiCalls: ['YouTube Data API channels.list(part=statistics)'],
                    reads: ['urt_channel'],
                    writes: ['urt_channel', 'urt_count', 'urt_log'],
                    summary: '更新 urt_count.tags，供 condition/tag filters 選頻道。',
                    scheduler: 'config/ingestion.php job youtube.channels.stats；每 9 分鐘。',
                ),
            ],
            'render' => [
                'controller' => 'App\Http\Controllers\Reports\AiAspectController',
                'service' => 'App\Services\Legacy\AiAspectReport',
                'reads' => ['urt_channel_ai', 'urt_channel', 'urt_count', 'urt_tag'],
                'request' => '頁面 request 本身不呼叫 AI API；讀最新 aspect rows，依 tag/condition filters 解析與排序。',
                'transforms' => [
                    'condition blue/green/neutral/finance/world 會轉成固定 tag filters。',
                    '依 filters 取得 urt_count.u_id/tags，找每個 u_id 最新 data_type=aspect row。',
                    'join urt_channel，排除 flag_del>=1。',
                    '解析 result_json 的政治/兩岸群組，計算 balance 排序。',
                ],
            ],
            'fixed_sources' => [
                self::fixedSource('AI aspect conditions', 'AiAspectReport::filters condition map', 'condition 對應 tag filters 寫死在 service。'),
                self::fixedSource('AI aspect dimensions', 'AiAspectReport values 台灣/泛綠/泛白/泛藍/泛紅/中國', '立場維度固定；隨部署更新。'),
                self::fixedSource('AI aspect balance formula', 'green + white - blue - red + Taiwan - China', '排序公式固定在 service。'),
            ],
            'sources' => [
                self::source('urt_channel_ai', 'urt_channel_ai', ['mtime', 'ctime', 'date_from', 'date_to']),
                self::source('urt_channel', 'urt_channel', ['mtime', 'ctime']),
                self::source('urt_count', 'urt_count', ['mtime', 'ctime']),
                self::source('urt_tag', 'urt_tag', ['mtime', 'ctime']),
            ],
            'graph' => [
                self::jobNode('ai_aspect_job', 'AI/channel tag jobs', 'api', 'ai.daily', 'AI job 維護 aspect rows；channels:stats 維護 tag filters。', [
                    'job_details' => ['youtube.channels.stats'],
                ]),
                self::combinedSourceNode('ai_aspect_tables', 'aspect AI + channel tags', ['urt_channel_ai', 'urt_channel', 'urt_count', 'urt_tag'], '立場分數與頻道 tag/filter 來源都在本機表。'),
                self::fixedNode('ai_aspect_rules', 'condition / dimension / balance rules', 'condition mapping、維度與 balance formula 寫在程式碼。'),
                self::serviceNode('ai_aspect_report', 'AiAspectReport aspect parser', 'request 時解析最新 aspect JSON，計算 balance 並排序。'),
                self::pageNode('ai_aspect_page', 'AI 立場分布頁', '/ai/aspects', 'Blade 呈現頻道立場分布表。'),
            ],
            'edges' => [
                self::edge('ai_aspect_job', 'ai_aspect_tables', 'refresh rows', 'AI 與 channel jobs 維護本機來源。'),
                self::edge('ai_aspect_tables', 'ai_aspect_rules', 'filter channels', 'request filters 決定頻道集合與解析維度。'),
                self::edge('ai_aspect_rules', 'ai_aspect_report', 'score balance', '報表服務解析 JSON 並計算 balance。'),
                self::edge('ai_aspect_report', 'ai_aspect_page', 'render table', 'Blade 輸出立場表。'),
            ],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private static function aiDailyPrompt(): array
    {
        return [
            'title' => 'AI Daily Prompt Preview',
            'summary' => '本頁讀 urt_channel_ai 每日頻道事件 cache，依 condition/tag filters 組出 daily 合併 prompt preview；不呼叫 AI API。',
            'jobs' => [
                self::job(
                    key: 'ai.daily',
                    label: 'AI daily source rows',
                    command: 'ai:daily --execute --channel-limit=39 --channel-batch-size=12 --ai-call-limit=45 --channel-video-limit=120 --limit=1000',
                    apiCalls: ['OpenCode-compatible chat completions (OPENAI_BASE_URL / OPENAI_MODEL)'],
                    reads: ['urt_video', 'urt_channel_ai', 'urt_count'],
                    writes: ['urt_channel_ai', 'urt_ai_date'],
                    summary: '產生 prompt preview 讀取的 urt_channel_ai source rows；只在 job 執行時呼叫 AI API。',
                    scheduler: 'config/ingestion.php job ai.daily；每日 16:15。',
                ),
                self::job(
                    key: 'youtube.channels.stats',
                    label: '頻道 tag/統計來源',
                    command: 'youtube:channels:stats --execute --limit=25',
                    apiCalls: ['YouTube Data API channels.list(part=statistics)'],
                    reads: ['urt_channel'],
                    writes: ['urt_channel', 'urt_count', 'urt_log'],
                    summary: '更新 urt_count.tags，供 condition/tag filters 選頻道。',
                    scheduler: 'config/ingestion.php job youtube.channels.stats；每 9 分鐘。',
                ),
            ],
            'render' => [
                'controller' => 'App\Http\Controllers\Reports\AiDailyPromptController',
                'service' => 'App\Services\Legacy\AiDailyPromptReport',
                'reads' => ['urt_channel_ai', 'urt_channel', 'urt_count', 'urt_tag'],
                'request' => '頁面 request 本身不呼叫 AI API；讀本機 channel AI rows，依 condition/tag filters 即時組 prompt 字串。',
                'transforms' => [
                    'condition route/query 轉為固定 tag filters；all 預設排除 finance/world tags。',
                    '未指定 date 時使用符合條件的 urt_channel_ai 最新 date_from。',
                    '依 date_from/date_to/data_type 查每個頻道 AI events，解析 result_json。',
                    '依 promptBounds(all=8-10, others=5-8) 組出 legacy-style 合併 prompt preview。',
                ],
            ],
            'fixed_sources' => [
                self::fixedSource('AI daily prompt template', 'AiDailyPromptReport::prompt', 'prompt 文案與 JSON 輸出格式寫死；隨部署更新。'),
                self::fixedSource('Condition filter map', 'AiDailyPromptReport::conditionFilters', 'condition 到 tag filters 的 mapping 固定。'),
                self::fixedSource('Prompt bounds', 'all=8..10, other=5..8', 'prompt 事件數 bounds 寫死在 service。'),
            ],
            'sources' => [
                self::source('urt_channel_ai', 'urt_channel_ai', ['mtime', 'ctime', 'date_from', 'date_to']),
                self::source('urt_channel', 'urt_channel', ['mtime', 'ctime']),
                self::source('urt_count', 'urt_count', ['mtime', 'ctime']),
                self::source('urt_tag', 'urt_tag', ['mtime', 'ctime']),
            ],
            'graph' => [
                self::jobNode('ai_prompt_source_job', 'AI/channel source jobs', 'api', 'ai.daily', 'AI job 產生 source rows；channel stats 維護 tag filters。', [
                    'job_details' => ['youtube.channels.stats'],
                ]),
                self::combinedSourceNode('ai_prompt_sources', 'channel AI + tag tables', ['urt_channel_ai', 'urt_channel', 'urt_count', 'urt_tag'], 'prompt preview 來源全在本機資料表。'),
                self::fixedNode('ai_prompt_rules', 'condition / prompt rules', 'condition filters、data_type whitelist 與 prompt template/bounds 隨部署更新。'),
                self::serviceNode('ai_prompt_report', 'AiDailyPromptReport prompt builder', 'request 時讀 source events 並組 prompt 字串；不寫 DB、不呼叫 AI API。'),
                self::pageNode('ai_prompt_page', 'AI Daily Prompt 預覽頁', '/ai/days/{date}/{condition}/prompt', 'Blade 呈現媒體事件、缺事件媒體與 prompt preview。'),
            ],
            'edges' => [
                self::edge('ai_prompt_source_job', 'ai_prompt_sources', 'refresh sources', '上游 jobs 維護 channel AI 與 tag filters。'),
                self::edge('ai_prompt_sources', 'ai_prompt_rules', 'filter rows', 'request condition/date/type 決定讀哪些 AI rows。'),
                self::edge('ai_prompt_rules', 'ai_prompt_report', 'build prompt', '報表服務即時組 prompt preview。'),
                self::edge('ai_prompt_report', 'ai_prompt_page', 'render prompt', 'Blade 輸出 prompt 預覽。'),
            ],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private static function aiDays(): array
    {
        return [
            'title' => 'AI 每日摘要',
            'summary' => '本頁讀取 AI daily cache 與 per-channel AI rows，合併成每日議題、媒體事件、關鍵字與代表影片。',
            'jobs' => [
                self::job(
                    key: 'ai.daily',
                    label: 'AI daily summary',
                    command: 'ai:daily --execute --channel-limit=39 --channel-batch-size=12 --ai-call-limit=45 --channel-video-limit=120 --limit=1000',
                    apiCalls: ['OpenCode-compatible chat completions (OPENAI_BASE_URL / OPENAI_MODEL)'],
                    reads: ['urt_video', 'urt_channel_ai', 'urt_count'],
                    writes: ['urt_channel_ai', 'urt_ai_date'],
                    summary: '先為設定頻道產生 channel AI，再依 condition 合併媒體事件並寫入 urt_ai_date；只在 job 執行時呼叫 AI API。',
                    scheduler: 'config/ingestion.php job ai.daily；每日 16:15，scheduled-write gates 通過後使用 capped execute command。',
                ),
            ],
            'render' => [
                'controller' => 'App\Http\Controllers\Reports\AiDailyController',
                'service' => 'App\Services\Legacy\AiDailyReport',
                'reads' => ['urt_ai_date', 'urt_channel_ai', 'urt_count', 'urt_channel (optional)'],
                'request' => '頁面 request 本身不呼叫 AI API；優先讀 urt_ai_date，缺 daily summary 時用既有 urt_channel_ai rows 即時計算 fallback，不寫 DB。',
                'transforms' => [
                    '從 route/query 解析 date、condition、pk 與 type。',
                    '優先依 date_from/date_to/condition_type/data_type 讀 urt_ai_date。',
                    'daily cache miss 或 summary 過度碎片化時，讀 urt_channel_ai 組成跨媒體或多影片 fallback daily topics。',
                    '合併 channel_id、urt_channel_ai result_json 與 urt_count tags，計算媒體數、影片數、關鍵字、人物、陣營與角度統計。',
                    'Blade 呈現日期/condition 切換、legacy-style 媒體事件清單、統計框與代表影片。',
                ],
            ],
            'fixed_sources' => [
                self::fixedSource('AI condition rules', 'AiDailyReport::channelMatchesCondition all/green/blue/neutral/finance/world', 'condition 對應 tag id 的規則寫在程式碼；隨部署更新。'),
                self::fixedSource('AI channel allowlist', 'AiDailyPreview::channelAiUids()', 'channel AI 產生範圍由程式碼設定；不是頁面 request 或排程資料表動態改寫。'),
                self::fixedSource('AI provider/model env', 'OPENAI_BASE_URL / OPENAI_MODEL', 'runtime env 控制上游模型；不要寫入 git 或頁面輸出 secret。'),
            ],
            'sources' => [
                self::source('urt_ai_date', 'urt_ai_date', ['mtime', 'ctime', 'date_to', 'date_from']),
                self::source('urt_channel_ai', 'urt_channel_ai', ['mtime', 'ctime', 'date_to', 'date_from']),
                self::source('urt_count', 'urt_count', ['mtime', 'ctime']),
                self::source('urt_video', 'urt_video', ['mtime', 'publishedAt']),
            ],
            'graph' => [
                self::fixedNode('ai_condition_rules', 'AI condition / channel rules', 'condition tag 對應、AI channel allowlist 與 provider/model env 是部署/runtime 規則，不是頁面 request 即時更新。'),
                self::jobNode('ai_daily_job', 'ai:daily generation', 'api', 'ai.daily', '只有 ai:daily job 會呼叫 OpenCode-compatible chat completions；頁面 request 不呼叫 AI API。'),
                self::combinedSourceNode('ai_daily_tables', 'urt_ai_date + urt_channel_ai', ['urt_ai_date', 'urt_channel_ai', 'urt_count'], '每日 summary cache、per-channel AI rows 與頻道 tag 是頁面主要資料來源。'),
                self::serviceNode('ai_daily_report', 'AiDailyReport 合併統計', '在 request 時解析 AI JSON，合併媒體事件與 channel rows，計算關鍵字、人物、陣營與代表影片。'),
                self::pageNode('ai_days_page', 'AI 每日摘要頁', '/ai/days/{date}/{condition}', 'Blade 呈現日期/condition 切換、媒體事件清單、統計框與代表影片。'),
            ],
            'edges' => [
                self::edge('ai_condition_rules', 'ai_daily_job', 'condition prompts', '固定 condition 與 channel allowlist 決定 ai:daily 產生哪些 summary。'),
                self::edge('ai_daily_job', 'ai_daily_tables', 'write AI rows', 'ai:daily 寫入 urt_channel_ai 與 urt_ai_date。'),
                self::edge('ai_daily_tables', 'ai_daily_report', 'decode JSON', '頁面服務讀取並解析 AI JSON cache；cache miss 可用 channel AI fallback。'),
                self::edge('ai_daily_report', 'ai_days_page', 'render topics', 'request 時即時計算統計與代表影片後輸出議題卡。'),
            ],
        ];
    }

    /**
     * @param  list<string>  $apiCalls
     * @param  list<string>  $reads
     * @param  list<string>  $writes
     * @return array<string, mixed>
     */
    private static function job(string $key, string $label, string $command, array $apiCalls, array $reads, array $writes, string $summary, string $scheduler): array
    {
        return [
            'key' => $key,
            'label' => $label,
            'command' => $command,
            'api_calls' => $apiCalls,
            'reads' => $reads,
            'writes' => $writes,
            'summary' => $summary,
            'scheduler' => $scheduler,
        ];
    }

    /**
     * @param  list<string>  $columns
     * @param  array<string, mixed>  $where
     * @return array<string, mixed>
     */
    private static function source(string $label, string $table, array $columns, array $where = []): array
    {
        return [
            'label' => $label,
            'table' => $table,
            'columns' => $columns,
            'where' => $where,
        ];
    }

    /**
     * @return array<string, string>
     */
    private static function fixedSource(string $label, string $location, string $status): array
    {
        return [
            'label' => $label,
            'location' => $location,
            'status' => $status,
        ];
    }

    /**
     * @param  array<string, mixed>  $options
     * @return array<string, mixed>
     */
    private static function node(string $id, string $label, string $kind, array $status, string $description, array $options = []): array
    {
        return array_merge([
            'id' => $id,
            'label' => $label,
            'kind' => $kind,
            'status' => $status,
            'description' => $description,
        ], $options);
    }

    /**
     * @param  array<string, mixed>  $options
     * @return array<string, mixed>
     */
    private static function jobNode(string $id, string $label, string $kind, string $jobKey, string $description, array $options = []): array
    {
        $options['job_details'] = array_values(array_unique([
            $jobKey,
            ...($options['job_details'] ?? []),
        ]));

        return self::node($id, $label, $kind, ['type' => 'job', 'job' => $jobKey], $description, $options);
    }

    /**
     * @param  array<string, mixed>  $options
     * @return array<string, mixed>
     */
    private static function sourceNode(string $id, string $label, string $kind, string $sourceLabel, string $description, array $options = []): array
    {
        $options['source_details'] = array_values(array_unique([
            $sourceLabel,
            ...($options['source_details'] ?? []),
        ]));

        return self::node($id, $label, $kind, ['type' => 'source', 'source' => $sourceLabel], $description, $options);
    }

    /**
     * @param  list<string>  $sourceLabels
     * @param  array<string, mixed>  $options
     * @return array<string, mixed>
     */
    private static function combinedSourceNode(string $id, string $label, array $sourceLabels, string $description, array $options = []): array
    {
        $options['source_details'] = array_values(array_unique([
            ...$sourceLabels,
            ...($options['source_details'] ?? []),
        ]));

        return self::node($id, $label, 'table', ['type' => 'sources', 'sources' => $sourceLabels], $description, $options);
    }

    /**
     * @param  array<string, mixed>  $options
     * @return array<string, mixed>
     */
    private static function fixedNode(string $id, string $label, string $description, array $options = []): array
    {
        $options['include_fixed_sources'] = true;

        return self::node($id, $label, 'fixed', ['type' => 'fixed', 'label' => '隨部署更新'], $description, $options);
    }

    /**
     * @param  array<string, mixed>  $options
     * @return array<string, mixed>
     */
    private static function serviceNode(string $id, string $label, string $description, array $options = []): array
    {
        $options['include_render'] = true;

        return self::node($id, $label, 'service', ['type' => 'realtime', 'label' => '頁面請求時即時執行'], $description, $options);
    }

    /**
     * @param  array<string, mixed>  $options
     * @return array<string, mixed>
     */
    private static function pageNode(string $id, string $label, string $route, string $description, array $options = []): array
    {
        $options['include_render'] = true;
        $options['meta'] = array_merge(['Route' => $route], $options['meta'] ?? []);

        return self::node($id, $label, 'page', ['type' => 'generated', 'label' => '頁面請求時即時產生'], $description, $options);
    }

    /**
     * @return array<string, string>
     */
    private static function edge(string $from, string $to, string $label, string $description): array
    {
        return [
            'from' => $from,
            'to' => $to,
            'label' => $label,
            'description' => $description,
        ];
    }
}
