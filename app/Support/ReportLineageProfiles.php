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
            'keywords.index' => self::keywordList(),
            'tags.days*' => self::tagDays(),
            'tags.cloud*' => self::tagCloud(),
            'keywords.cloud' => self::keywordCloud(),
            'live.current' => self::liveCurrent(),
            'ai.days.index' => self::aiDays(),
            'ai.days.date' => self::aiDays(),
            'ai.days.condition' => self::aiDays(),
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
    private static function aiDays(): array
    {
        return [
            'title' => 'AI 每日摘要',
            'summary' => '本頁讀取 AI daily cache 與 per-channel AI rows，合併成每日議題、媒體事件、關鍵字與代表影片。',
            'jobs' => [
                self::job(
                    key: 'ai.daily',
                    label: 'AI daily summary',
                    command: 'ai:daily --execute --channel-limit=3 --limit=1000',
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
                    'daily cache miss 且指定日期時，讀 urt_channel_ai 組成 fallback daily topics。',
                    '合併 channel_id、urt_channel_ai result_json 與 urt_count tags，計算媒體數、影片數、關鍵字、人物、陣營與角度統計。',
                    'Blade 呈現日期/condition 切換、議題卡、媒體事件與代表影片。',
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
                self::pageNode('ai_days_page', 'AI 每日摘要頁', '/ai/days/{date}/{condition}', 'Blade 呈現日期/condition 切換、議題卡、媒體事件、統計 chips 與代表影片。'),
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
     * @param list<string> $apiCalls
     * @param list<string> $reads
     * @param list<string> $writes
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
     * @param list<string> $columns
     * @param array<string, mixed> $where
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
     * @param array<string, mixed> $options
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
     * @param array<string, mixed> $options
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
     * @param array<string, mixed> $options
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
     * @param list<string> $sourceLabels
     * @param array<string, mixed> $options
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
     * @param array<string, mixed> $options
     * @return array<string, mixed>
     */
    private static function fixedNode(string $id, string $label, string $description, array $options = []): array
    {
        $options['include_fixed_sources'] = true;

        return self::node($id, $label, 'fixed', ['type' => 'fixed', 'label' => '隨部署更新'], $description, $options);
    }

    /**
     * @param array<string, mixed> $options
     * @return array<string, mixed>
     */
    private static function serviceNode(string $id, string $label, string $description, array $options = []): array
    {
        $options['include_render'] = true;

        return self::node($id, $label, 'service', ['type' => 'realtime', 'label' => '頁面請求時即時執行'], $description, $options);
    }

    /**
     * @param array<string, mixed> $options
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
