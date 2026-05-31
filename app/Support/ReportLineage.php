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
                ['id' => 'external', 'label' => 'tag.analysis.tw API', 'kind' => 'api'],
                ['id' => 'tags', 'label' => 'tags', 'kind' => 'table'],
                ['id' => 'local_video', 'label' => 'tags + urt_video + urt_count', 'kind' => 'table'],
                ['id' => 'tags_all', 'label' => 'urt_show_data.tags_all', 'kind' => 'cache'],
                ['id' => 'report', 'label' => 'KeywordListReport + 固定規則', 'kind' => 'service'],
                ['id' => 'page', 'label' => '/keywords table', 'kind' => 'page'],
            ],
            'edges' => [
                ['from' => 'external', 'to' => 'tags', 'label' => 'sync'],
                ['from' => 'tags', 'to' => 'local_video', 'label' => 'select'],
                ['from' => 'local_video', 'to' => 'tags_all', 'label' => 'aggregate'],
                ['from' => 'tags_all', 'to' => 'report', 'label' => 'merge + filter'],
                ['from' => 'report', 'to' => 'page', 'label' => 'render'],
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

        return $profile;
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
