<?php

namespace App\Support;

use Carbon\CarbonImmutable;
use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Throwable;

class ReportLineage
{
    private const RUN_DIRECTORY = 'ingestion-runs';

    public function __construct(private readonly ReportLineageProfiles $profiles)
    {
    }

    /**
     * @return array<string, mixed>|null
     */
    public function forRequest(Request $request): ?array
    {
        $routeName = $request->route()?->getName();

        if (! is_string($routeName)) {
            return null;
        }

        $profile = $this->profiles->forRoute($routeName);

        return $profile === null ? null : $this->hydrate($profile);
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

        return collect($profile['graph'] ?? [])
            ->map(fn (array $node): array => $this->hydrateGraphNode($node, $profile, $jobs, $sources))
            ->values()
            ->all();
    }

    /**
     * @param array<string, mixed> $node
     * @param array<string, mixed> $profile
     * @param Collection<string, array<string, mixed>> $jobs
     * @param Collection<string, array<string, mixed>> $sources
     * @return array<string, mixed>
     */
    private function hydrateGraphNode(array $node, array $profile, Collection $jobs, Collection $sources): array
    {
        $node['title'] = (string) ($node['title'] ?? $node['label'] ?? '');
        $node['status'] = $this->nodeStatus($node, $jobs, $sources);
        $node['description'] = (string) ($node['description'] ?? '');
        $node['meta'] = $this->nodeMeta($node, $profile, $jobs, $sources);

        return $node;
    }

    /**
     * @param array<string, mixed> $node
     * @param Collection<string, array<string, mixed>> $jobs
     * @param Collection<string, array<string, mixed>> $sources
     */
    private function nodeStatus(array $node, Collection $jobs, Collection $sources): string
    {
        $status = $node['status'] ?? null;

        if (is_string($status)) {
            return $status;
        }

        if (! is_array($status)) {
            return '';
        }

        $type = (string) ($status['type'] ?? '');
        $label = (string) ($status['label'] ?? '');

        return match ($type) {
            'job' => ($label !== '' ? $label : '上次執行').'：'.$this->displayTime($jobs->get((string) ($status['job'] ?? ''))['latest_run_at'] ?? null),
            'source' => ($label !== '' ? $label : '最後更新').'：'.$this->displayTime($sources->get((string) ($status['source'] ?? ''))['latest_at'] ?? null),
            'sources' => ($label !== '' ? $label : '最後更新').'：'.$this->displayTime($this->latestOf(...$this->sourceLatestValues($status, $sources))),
            'fixed' => '固定規則：'.($label !== '' ? $label : '隨部署更新'),
            'realtime' => $label !== '' ? $label : '頁面請求時即時執行',
            'generated' => $label !== '' ? $label : '頁面請求時即時產生',
            default => '',
        };
    }

    /**
     * @param array<string, mixed> $status
     * @param Collection<string, array<string, mixed>> $sources
     * @return list<mixed>
     */
    private function sourceLatestValues(array $status, Collection $sources): array
    {
        return collect($status['sources'] ?? [])
            ->map(fn (mixed $source): mixed => $sources->get((string) $source)['latest_at'] ?? null)
            ->values()
            ->all();
    }

    /**
     * @param array<string, mixed> $node
     * @param array<string, mixed> $profile
     * @param Collection<string, array<string, mixed>> $jobs
     * @param Collection<string, array<string, mixed>> $sources
     * @return array<string, string>
     */
    private function nodeMeta(array $node, array $profile, Collection $jobs, Collection $sources): array
    {
        $meta = [];
        $jobKeys = collect($node['job_details'] ?? [])->map(fn (mixed $key): string => (string) $key)->filter()->values();
        $sourceLabels = collect($node['source_details'] ?? [])->map(fn (mixed $label): string => (string) $label)->filter()->values();

        foreach ($jobKeys as $jobKey) {
            $job = $jobs->get($jobKey);

            if (is_array($job)) {
                $this->mergeMeta($meta, $this->jobMeta($job), $jobKeys->count() > 1 ? (string) ($job['label'] ?? $jobKey) : null);
            }
        }

        foreach ($sourceLabels as $sourceLabel) {
            $source = $sources->get($sourceLabel);

            if (is_array($source)) {
                $this->mergeMeta($meta, $this->sourceMeta($source), $sourceLabels->count() > 1 ? $sourceLabel : null);
            }
        }

        if (($node['include_render'] ?? false) === true) {
            $this->mergeMeta($meta, $this->renderMeta($profile));
        }

        if (($node['include_fixed_sources'] ?? false) === true) {
            $this->mergeMeta($meta, [
                '固定/寫死規則' => $this->fixedSourcesText($profile),
            ]);
        }

        foreach ($node['meta'] ?? [] as $key => $value) {
            if (is_string($key)) {
                $meta[$key] = $this->stringifyMetaValue($value);
            }
        }

        return collect($meta)
            ->map(fn (mixed $value): string => trim($this->stringifyMetaValue($value)))
            ->filter(fn (string $value): bool => $value !== '')
            ->all();
    }

    /**
     * @param array<string, string> $target
     * @param array<string, mixed> $source
     */
    private function mergeMeta(array &$target, array $source, ?string $prefix = null): void
    {
        foreach ($source as $key => $value) {
            if (! is_string($key)) {
                continue;
            }

            $target[$prefix !== null ? $prefix.' '.$key : $key] = $this->stringifyMetaValue($value);
        }
    }

    /**
     * @param array<string, mixed> $job
     * @return array<string, mixed>
     */
    private function jobMeta(array $job): array
    {
        $key = (string) ($job['key'] ?? '');
        $command = (string) ($job['command'] ?? '');
        $apiCalls = array_values(array_filter($job['api_calls'] ?? [], 'is_string'));
        $reads = array_values(array_filter($job['reads'] ?? [], 'is_string'));
        $writes = array_values(array_filter($job['writes'] ?? [], 'is_string'));

        return [
            'Scheduler job' => trim($key."\n".(string) ($job['scheduler'] ?? '')),
            '更新工作' => trim((string) ($job['label'] ?? $key)."\n".$command),
            '工作說明' => $job['summary'] ?? '',
            '呼叫 API' => $apiCalls === [] ? '不呼叫外部 API' : implode("\n", $apiCalls),
            '讀取' => $reads === [] ? '' : implode('、', $reads),
            '寫入' => $writes === [] ? '' : implode('、', $writes),
            '最近成功執行' => $job['latest_run_at'] ?? '尚無成功 execute 記錄',
        ];
    }

    /**
     * @param array<string, mixed> $source
     * @return array<string, mixed>
     */
    private function sourceMeta(array $source): array
    {
        return [
            '來源' => $this->sourceDescriptor($source),
            '最後更新' => $source['latest_at'] ?? '未記錄或欄位不存在',
        ];
    }

    /**
     * @param array<string, mixed> $source
     */
    private function sourceDescriptor(array $source): string
    {
        $parts = ['table: '.(string) ($source['table'] ?? '')];
        $where = is_array($source['where'] ?? null) ? $source['where'] : [];
        $columns = array_values(array_filter($source['columns'] ?? [], 'is_string'));

        if ($where !== []) {
            $parts[] = 'where: '.collect($where)
                ->map(fn (mixed $value, mixed $column): string => (string) $column.'='.(string) $value)
                ->implode(', ');
        }

        if ($columns !== []) {
            $parts[] = 'timestamp columns: '.implode(', ', $columns);
        }

        return implode("\n", $parts);
    }

    /**
     * @param array<string, mixed> $profile
     * @return array<string, mixed>
     */
    private function renderMeta(array $profile): array
    {
        $render = is_array($profile['render'] ?? null) ? $profile['render'] : [];

        return [
            'Controller' => $render['controller'] ?? '',
            'Report service' => $render['service'] ?? '',
            '頁面讀取' => implode('、', array_values(array_filter($render['reads'] ?? [], 'is_string'))),
            '處理步驟' => $this->numberedLines($render['transforms'] ?? []),
            '頁面 request' => $render['request'] ?? '頁面請求只讀本機 DB/cache，不呼叫外部 API。',
            '固定資料，不會由排程更新' => $this->fixedSourcesText($profile),
        ];
    }

    /**
     * @param list<mixed> $items
     */
    private function numberedLines(array $items): string
    {
        return collect($items)
            ->filter(fn (mixed $item): bool => is_string($item))
            ->values()
            ->map(fn (string $step, int $index): string => ($index + 1).'. '.$step)
            ->implode("\n");
    }

    /**
     * @param array<string, mixed> $profile
     */
    private function fixedSourcesText(array $profile): string
    {
        return collect($profile['fixed_sources'] ?? [])
            ->map(fn (array $source): string => trim(sprintf(
                "%s\n%s\n%s",
                (string) ($source['label'] ?? ''),
                (string) ($source['location'] ?? ''),
                (string) ($source['status'] ?? ''),
            )))
            ->filter()
            ->implode("\n\n");
    }

    private function stringifyMetaValue(mixed $value): string
    {
        if (is_array($value)) {
            if (array_is_list($value)) {
                return collect($value)
                    ->map(fn (mixed $item): string => $this->stringifyMetaValue($item))
                    ->filter()
                    ->implode("\n");
            }

            return collect($value)
                ->map(fn (mixed $item, mixed $key): string => (string) $key.': '.$this->stringifyMetaValue($item))
                ->filter(fn (string $line): bool => trim($line) !== '')
                ->implode("\n");
        }

        return is_scalar($value) || $value === null ? (string) $value : '';
    }

    private function displayTime(mixed $value): string
    {
        return is_string($value) && $value !== '' ? $value : '尚無記錄';
    }

    private function latestOf(mixed ...$values): ?string
    {
        return collect($values)
            ->filter(fn (mixed $value): bool => is_string($value) && $value !== '')
            ->sortDesc()
            ->first();
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
