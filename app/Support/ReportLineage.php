<?php

namespace App\Support;

use Carbon\CarbonImmutable;
use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Throwable;

class ReportLineage
{
    private const RUN_DIRECTORY = 'ingestion-runs';

    /**
     * @var array<string, array<string, mixed>>
     */
    private const ROUTE_PROFILES = [
        'keywords.index' => [
            'title' => '關鍵字列表',
            'summary' => '本頁把外部關鍵字熱度、本機影片資料、關鍵字停用詞合併成可排序的關鍵字排行榜。',
            'jobs' => [
                [
                    'key' => 'reports.keywords.build',
                    'label' => '關鍵字同步',
                    'command' => 'reports:keywords:build --execute --hours=2 --limit=100',
                    'api_calls' => ['https://tag.analysis.tw/api/tag_json.php?hours={hours}'],
                    'reads' => [],
                    'writes' => ['tags'],
                    'summary' => '從新文易數同步近期關鍵字熱度，更新 tags 的熱度、最高時間與排除旗標。',
                ],
                [
                    'key' => 'reports.keywords.cache',
                    'label' => '關鍵字指標快取',
                    'command' => 'reports:keywords:cache --execute --days=31 --recent-days=7',
                    'api_calls' => [],
                    'reads' => ['tags', 'urt_video', 'urt_count'],
                    'writes' => ['urt_show_data.data_name=tags_all'],
                    'summary' => '不呼叫外部 API；從本機影片與頻道分類聚合影片數、觀看數與成長欄位。',
                ],
            ],
            'render' => [
                'controller' => 'App\Http\Controllers\Reports\KeywordListController',
                'service' => 'App\Services\Legacy\KeywordListReport',
                'reads' => ['tags', 'urt_show_data.data_name=tags_all'],
                'transforms' => [
                    '讀取 tags，排除 no_tag 與 stopwords。',
                    '依 hours_count、max_count、max_hours 計算 weight 與 weight_score。',
                    '解析 urt_show_data.tags_all JSON，合併 video、views、views_all。',
                    '依 sort 參數排序後輸出表格。',
                ],
            ],
            'fixed_sources' => [
                [
                    'label' => '內建 stopwords fallback',
                    'location' => 'App\Services\Legacy\LegacyStopwords::FALLBACK',
                    'status' => '寫死在程式碼；只有部署新版本才會變更。',
                ],
                [
                    'label' => 'Legacy stopwords reference',
                    'location' => 'config(legacy.ground_truth_path)/urtube/stopwords.php',
                    'status' => '如果本機參考檔存在會一起讀取；不是排程更新來源。',
                ],
                [
                    'label' => '分類篩選 tags_all categories',
                    'location' => 'TagsAllCacheBuilder::DEFAULT_CATEGORY_TAGS = 1,2,13,14',
                    'status' => '寫死在快取重建邏輯；用來限定參與聚合的頻道分類。',
                ],
            ],
            'sources' => [
                ['label' => 'tags', 'table' => 'tags', 'columns' => ['mtime', 'ctime']],
                ['label' => 'urt_show_data.tags_all', 'table' => 'urt_show_data', 'columns' => ['mtime', 'ctime'], 'where' => ['data_name' => 'tags_all']],
            ],
            'graph' => [
                ['id' => 'external', 'label' => '外部關鍵字 API', 'kind' => 'api'],
                ['id' => 'tags', 'label' => '關鍵字基礎表 tags', 'kind' => 'table'],
                ['id' => 'local_video', 'label' => '本機影片資料', 'kind' => 'table'],
                ['id' => 'tags_all', 'label' => 'tags_all 指標快取', 'kind' => 'cache'],
                ['id' => 'report', 'label' => '合併與排序服務', 'kind' => 'service'],
                ['id' => 'page', 'label' => '關鍵字列表頁', 'kind' => 'page'],
            ],
            'edges' => [
                ['from' => 'external', 'to' => 'tags', 'label' => 'sync', 'description' => 'reports:keywords:build 透過外部 API 同步近期關鍵字熱度並 upsert tags。'],
                ['from' => 'tags', 'to' => 'local_video', 'label' => 'select', 'description' => 'reports:keywords:cache 先從 tags 選出可計算的關鍵字集合。'],
                ['from' => 'local_video', 'to' => 'tags_all', 'label' => 'aggregate', 'description' => '掃描本機影片標題與描述，依關鍵字累計影片數與觀看數。'],
                ['from' => 'tags_all', 'to' => 'report', 'label' => 'merge + filter', 'description' => '頁面產生時把 tags_all 指標合併回 tags 排行，並套用固定 stopwords。'],
                ['from' => 'report', 'to' => 'page', 'label' => 'render', 'description' => 'KeywordListReport 回傳列資料，Blade 依排序與 limit 呈現表格。'],
            ],
        ],
    ];

    /**
     * @return array<string, mixed>|null
     */
    public function forRequest(Request $request): ?array
    {
        $routeName = $request->route()?->getName();

        if (! is_string($routeName) || ! isset(self::ROUTE_PROFILES[$routeName])) {
            return null;
        }

        return $this->hydrate(self::ROUTE_PROFILES[$routeName]);
    }

    /**
     * @param array<string, mixed> $profile
     * @return array<string, mixed>
     */
    private function hydrate(array $profile): array
    {
        $profile['sources'] = collect($profile['sources'] ?? [])
            ->map(fn (array $source): array => $source + [
                'latest_at' => $this->latestSourceTimestamp($source)?->format('Y-m-d H:i:s'),
            ])
            ->all();

        $profile['jobs'] = collect($profile['jobs'] ?? [])
            ->map(fn (array $job): array => $job + [
                'latest_run_at' => $this->latestSuccessfulJobRun((string) $job['key'])?->format('Y-m-d H:i:s'),
            ])
            ->all();
        $profile['graph'] = $this->hydrateGraph($profile);

        return $profile;
    }

    /**
     * @param array<string, mixed> $profile
     * @return list<array<string, mixed>>
     */
    private function hydrateGraph(array $profile): array
    {
        $jobs = collect($profile['jobs'] ?? [])->keyBy('key');
        $sources = collect($profile['sources'] ?? [])->keyBy('label');
        $build = $jobs->get('reports.keywords.build', []);
        $cache = $jobs->get('reports.keywords.cache', []);
        $tags = $sources->get('tags', []);
        $tagsAll = $sources->get('urt_show_data.tags_all', []);
        $fixedSources = collect($profile['fixed_sources'] ?? [])
            ->map(fn (array $source): string => sprintf(
                "%s\n%s\n%s",
                (string) ($source['label'] ?? ''),
                (string) ($source['location'] ?? ''),
                (string) ($source['status'] ?? ''),
            ))
            ->implode("\n\n");
        $transforms = collect($profile['render']['transforms'] ?? [])
            ->map(fn (string $step, int $index): string => ($index + 1).'. '.$step)
            ->implode("\n");

        return collect($profile['graph'] ?? [])
            ->map(function (array $node) use ($build, $cache, $tags, $tagsAll, $profile, $fixedSources, $transforms): array {
                return $node + match ($node['id'] ?? '') {
                    'external' => [
                        'title' => '外部 API',
                        'description' => '只在關鍵字同步工作執行時呼叫；頁面瀏覽本身不會即時打外部 API。',
                        'meta' => [
                            '更新工作' => ($build['label'] ?? '關鍵字同步')."\n".($build['command'] ?? 'reports:keywords:build --execute --hours=2 --limit=100'),
                            '工作說明' => $build['summary'] ?? '從新文易數同步近期關鍵字熱度。',
                            'API' => 'https://tag.analysis.tw/api/tag_json.php?hours={hours}',
                            '寫入' => implode('、', $build['writes'] ?? ['tags']),
                            '最近觸發' => $build['latest_run_at'] ?? '尚無成功 execute 記錄',
                        ],
                    ],
                    'tags' => [
                        'title' => '關鍵字基礎表',
                        'description' => '保存關鍵字熱度、最高出現時間與 no_tag 排除旗標，是排行與權重計算的主資料表。',
                        'meta' => [
                            '寫入工作' => "reports:keywords:build --execute --hours=2 --limit=100\nreports.keywords.build",
                            '頁面讀取' => 'KeywordListReport 直接讀取 tags，排除 no_tag 與 stopwords 後計算排行權重。',
                            '最後更新' => $tags['latest_at'] ?? '未記錄或欄位不存在',
                        ],
                    ],
                    'local_video' => [
                        'title' => '本機影片聚合來源',
                        'description' => '快取重建時從本機影片與頻道分類計算關鍵字影片數、觀看數與近期指標。',
                        'meta' => [
                            '更新工作' => ($cache['label'] ?? '關鍵字指標快取')."\n".($cache['command'] ?? 'reports:keywords:cache --execute --days=31 --recent-days=7'),
                            '工作說明' => $cache['summary'] ?? '從本機影片與頻道分類聚合指標。',
                            '讀取' => implode('、', $cache['reads'] ?? ['tags', 'urt_video', 'urt_count']),
                            '固定分類' => 'TagsAllCacheBuilder::DEFAULT_CATEGORY_TAGS = 1,2,13,14',
                            '最近觸發' => $cache['latest_run_at'] ?? '尚無成功 execute 記錄',
                        ],
                    ],
                    'tags_all' => [
                        'title' => '關鍵字指標快取',
                        'description' => '保存已聚合的影片數、近期觀看數與總觀看數，避免每次開頁都重新掃影片。',
                        'meta' => [
                            '寫入工作' => "reports:keywords:cache --execute --days=31 --recent-days=7\nreports.keywords.cache",
                            '讀取來源' => 'tags、urt_video、urt_count',
                            '寫入' => implode('、', $cache['writes'] ?? ['urt_show_data.data_name=tags_all']),
                            '最後更新' => $tagsAll['latest_at'] ?? '未記錄或欄位不存在',
                        ],
                    ],
                    'report' => [
                        'title' => '頁面資料服務',
                        'description' => '讀取 tags 與 tags_all，套用固定規則，合併欄位後依目前排序參數輸出 rows。',
                        'meta' => [
                            'Service' => $profile['render']['service'] ?? 'App\Services\Legacy\KeywordListReport',
                            '頁面讀取' => implode('、', $profile['render']['reads'] ?? ['tags', 'urt_show_data.data_name=tags_all']),
                            '處理步驟' => $transforms,
                            '固定資料，不會由排程更新' => $fixedSources,
                        ],
                    ],
                    'page' => [
                        'title' => '使用者頁面',
                        'description' => 'Blade 只負責呈現資料服務回傳的 rows、目前 filters、排序與操作連結。',
                        'meta' => [
                            'Route' => '/keywords',
                            'Controller' => $profile['render']['controller'] ?? 'App\Http\Controllers\Reports\KeywordListController',
                            'Report service' => $profile['render']['service'] ?? 'App\Services\Legacy\KeywordListReport',
                            '頁面產生' => $transforms,
                        ],
                    ],
                    default => [
                        'title' => (string) ($node['label'] ?? ''),
                        'description' => '',
                        'meta' => [],
                    ],
                };
            })
            ->values()
            ->all();
    }

    /**
     * @param array<string, mixed> $source
     */
    private function latestSourceTimestamp(array $source): ?CarbonImmutable
    {
        $table = (string) ($source['table'] ?? '');
        $columns = array_values(array_filter($source['columns'] ?? [], 'is_string'));

        if ($table === '' || $columns === []) {
            return null;
        }

        $latest = null;

        foreach ($columns as $column) {
            $value = $this->maxTimestampValue($table, $column, is_array($source['where'] ?? null) ? $source['where'] : []);
            $timestamp = $this->parseTimestamp($value);

            if ($timestamp !== null && ($latest === null || $timestamp->greaterThan($latest))) {
                $latest = $timestamp;
            }
        }

        return $latest;
    }

    /**
     * @param array<string, mixed> $where
     */
    private function maxTimestampValue(string $table, string $column, array $where = []): mixed
    {
        try {
            if (! Schema::hasTable($table) || ! Schema::hasColumn($table, $column)) {
                return null;
            }

            $query = DB::table($table)->whereNotNull($column);

            foreach ($where as $whereColumn => $value) {
                if (is_string($whereColumn) && Schema::hasColumn($table, $whereColumn)) {
                    $query->where($whereColumn, $value);
                }
            }

            return $query->max($column);
        } catch (QueryException) {
            return null;
        }
    }

    private function latestSuccessfulJobRun(string $jobKey): ?CarbonImmutable
    {
        try {
            $files = collect(Storage::disk('local')->files(self::RUN_DIRECTORY))
                ->filter(fn (string $path): bool => str_ends_with($path, '.json'))
                ->sortDesc()
                ->values();
        } catch (Throwable) {
            return null;
        }

        foreach ($files as $path) {
            $record = $this->readRunRecord($path);

            if ($record === null || ! $this->isExecuteRecord($record)) {
                continue;
            }

            foreach ($record['result']['jobs'] ?? [] as $job) {
                if (! is_array($job) || ($job['key'] ?? null) !== $jobKey || ! $this->jobSucceeded($job)) {
                    continue;
                }

                return $this->recordTimestamp($record);
            }
        }

        return null;
    }

    /**
     * @return array<string, mixed>|null
     */
    private function readRunRecord(string $path): ?array
    {
        try {
            $payload = json_decode((string) Storage::disk('local')->get($path), true);

            return is_array($payload) ? $payload : null;
        } catch (Throwable) {
            return null;
        }
    }

    /**
     * @param array<string, mixed> $record
     */
    private function isExecuteRecord(array $record): bool
    {
        return ($record['request']['source'] ?? null) === 'artisan'
            && ($record['request']['mode'] ?? null) === 'execute'
            && ($record['result']['mode'] ?? null) === 'execute';
    }

    /**
     * @param array<string, mixed> $job
     */
    private function jobSucceeded(array $job): bool
    {
        return ($job['executed'] ?? false) === true
            && ($job['failed'] ?? false) !== true
            && ((int) ($job['exit_code'] ?? 0)) === 0;
    }

    /**
     * @param array<string, mixed> $record
     */
    private function recordTimestamp(array $record): ?CarbonImmutable
    {
        $timestamp = $this->parseTimestamp($record['created_at'] ?? null);

        if ($timestamp !== null) {
            return $timestamp;
        }

        $id = $record['id'] ?? null;

        if (! is_string($id) || ! preg_match('/^(\d{8})-(\d{6})-/', $id, $matches)) {
            return null;
        }

        $parsed = CarbonImmutable::createFromFormat('Ymd His', $matches[1].' '.$matches[2], $this->timezone());

        return $parsed instanceof CarbonImmutable ? $parsed : null;
    }

    private function parseTimestamp(mixed $value): ?CarbonImmutable
    {
        if ($value === null) {
            return null;
        }

        $text = trim((string) $value);

        if ($text === '' || $text === '0000-00-00' || $text === '0000-00-00 00:00:00') {
            return null;
        }

        try {
            return CarbonImmutable::parse($text, $this->timezone())->setTimezone($this->timezone());
        } catch (Throwable) {
            return null;
        }
    }

    private function timezone(): string
    {
        return (string) config('ingestion.timezone', config('app.timezone', 'Asia/Taipei'));
    }
}
