<?php

namespace App\Support;

use App\Services\Ingestion\IngestionRunHistory;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Throwable;

class ReportLineage
{
    public function __construct(
        private readonly ReportLineageProfiles $profiles,
        private readonly IngestionRunHistory $history,
        private readonly ReportSourceTimestampLookup $sourceTimestamps,
    ) {}

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
     * @param  array<string, mixed>  $profile
     * @return array<string, mixed>
     */
    private function hydrate(array $profile): array
    {
        $profile['sources'] = collect($profile['sources'] ?? [])
            ->map(fn (array $source): array => $source + [
                'latest_at' => $this->latestSourceTimestamp($source)?->format('Y-m-d H:i:s'),
            ])
            ->all();

        $sources = collect($profile['sources'] ?? [])->keyBy('label');

        $profile['jobs'] = collect($profile['jobs'] ?? [])
            ->map(fn (array $job): array => $this->hydrateJob($job, $sources))
            ->all();

        $profile['graph'] = $this->hydrateGraph($profile);

        return $profile;
    }

    /**
     * @param  Collection<string, array<string, mixed>>  $sources
     * @return array<string, mixed>
     */
    private function hydrateJob(array $job, Collection $sources): array
    {
        $history = $this->history->latestJobHistory((string) ($job['key'] ?? ''));
        $latestSourceAt = null;
        $latestSourceLabel = null;
        $latestSources = collect([
            $job['latest_source'] ?? null,
            ...($job['latest_sources'] ?? []),
        ])->filter(fn (mixed $source): bool => is_string($source) && $source !== '')->unique();

        foreach ($latestSources as $latestSource) {
            $timestamp = $this->parseTimestamp($sources->get($latestSource)['latest_at'] ?? null);

            if ($timestamp !== null && ($latestSourceAt === null || $timestamp->greaterThan($latestSourceAt))) {
                $latestSourceAt = $timestamp;
                $latestSourceLabel = $latestSource;
            }
        }

        return $job + [
            'latest_run_at' => $history['latest_success_at']?->format('Y-m-d H:i:s'),
            'latest_attempt_at' => $history['latest_attempt_at']?->format('Y-m-d H:i:s'),
            'latest_attempt_status' => $history['latest_attempt_status'],
            'latest_attempt_action' => $history['latest_attempt_action'],
            'latest_attempt_exit_code' => $history['latest_attempt_exit_code'],
            'latest_source_at' => $latestSourceAt?->format('Y-m-d H:i:s'),
            'latest_source_label' => $latestSourceLabel,
        ];
    }

    /**
     * @param  array<string, mixed>  $profile
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
     * @param  array<string, mixed>  $node
     * @param  array<string, mixed>  $profile
     * @param  Collection<string, array<string, mixed>>  $jobs
     * @param  Collection<string, array<string, mixed>>  $sources
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
     * @param  array<string, mixed>  $node
     * @param  Collection<string, array<string, mixed>>  $jobs
     * @param  Collection<string, array<string, mixed>>  $sources
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
            'job' => $this->jobStatus($jobs->get((string) ($status['job'] ?? '')), $label),
            'source' => ($label !== '' ? $label : '最後更新').'：'.$this->displayTime($sources->get((string) ($status['source'] ?? ''))['latest_at'] ?? null),
            'sources' => ($label !== '' ? $label : '最後更新').'：'.$this->displayTime($this->latestOf(...$this->sourceLatestValues($status, $sources))),
            'fixed' => '固定規則：'.($label !== '' ? $label : '隨部署更新'),
            'realtime' => $label !== '' ? $label : '頁面請求時即時執行',
            'generated' => $label !== '' ? $label : '頁面請求時即時產生',
            default => '',
        };
    }

    /**
     * @param  array<string, mixed>|null  $job
     */
    private function jobStatus(?array $job, string $label): string
    {
        if ($job === null) {
            return $label !== '' ? $label.'：尚無記錄' : '尚無執行記錄';
        }

        $attemptAt = $job['latest_attempt_at'] ?? null;

        if (is_string($attemptAt) && $attemptAt !== '') {
            $attemptStatus = (string) ($job['latest_attempt_status'] ?? 'failed');
            $defaultLabel = match ($attemptStatus) {
                'success' => '上次成功執行',
                'blocked' => '最近執行前置失敗',
                default => '最近執行失敗',
            };

            return ($label !== '' ? $label : $defaultLabel).'：'.$this->displayTime($attemptAt);
        }

        $sourceAt = $job['latest_source_at'] ?? null;

        if (is_string($sourceAt) && $sourceAt !== '') {
            return ($label !== '' ? $label : '資料最後更新').'：'.$this->displayTime($sourceAt);
        }

        return $label !== '' ? $label.'：尚無記錄' : '尚無執行記錄';
    }

    /**
     * @param  array<string, mixed>  $status
     * @param  Collection<string, array<string, mixed>>  $sources
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
     * @param  array<string, mixed>  $node
     * @param  array<string, mixed>  $profile
     * @param  Collection<string, array<string, mixed>>  $jobs
     * @param  Collection<string, array<string, mixed>>  $sources
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
     * @param  array<string, string>  $target
     * @param  array<string, mixed>  $source
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
     * @param  array<string, mixed>  $job
     * @return array<string, mixed>
     */
    private function jobMeta(array $job): array
    {
        $key = (string) ($job['key'] ?? '');
        $command = (string) ($job['command'] ?? '');
        $apiCalls = array_values(array_filter($job['api_calls'] ?? [], 'is_string'));
        $reads = array_values(array_filter($job['reads'] ?? [], 'is_string'));
        $writes = array_values(array_filter($job['writes'] ?? [], 'is_string'));

        $meta = [
            'Scheduler job' => trim($key."\n".(string) ($job['scheduler'] ?? '')),
            '更新工作' => trim((string) ($job['label'] ?? $key)."\n".$command),
            '工作說明' => $job['summary'] ?? '',
            '呼叫 API' => $apiCalls === [] ? '不呼叫外部 API' : implode("\n", $apiCalls),
            '讀取' => $reads === [] ? '' : implode('、', $reads),
            '寫入' => $writes === [] ? '' : implode('、', $writes),
            '最近執行嘗試' => is_string($job['latest_attempt_at'] ?? null)
                ? $job['latest_attempt_at'].'（'.match ($job['latest_attempt_status'] ?? null) {
                    'success' => '成功',
                    'blocked' => '執行前置失敗',
                    default => '執行失敗',
                }.'）'
                : '尚無 execute 嘗試記錄',
            '最近成功執行' => $job['latest_run_at'] ?? '尚無成功 execute 記錄',
            '最近執行 action' => $job['latest_attempt_action'] ?? '',
            '最近執行 exit code' => $job['latest_attempt_exit_code'] ?? '',
        ];

        if (is_string($job['latest_source_at'] ?? null) && $job['latest_source_at'] !== '') {
            $meta['資料最後更新'] = $job['latest_source_at'];
            $meta['資料更新來源'] = $job['latest_source_label'].' 最新 cache timestamp（資料更新時間，不代表 execute 完整成功）';
        }

        return $meta;
    }

    /**
     * @param  array<string, mixed>  $source
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
     * @param  array<string, mixed>  $source
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
     * @param  array<string, mixed>  $profile
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
     * @param  list<mixed>  $items
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
     * @param  array<string, mixed>  $profile
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
        if (! is_string($value) || trim($value) === '') {
            return '尚無記錄';
        }

        $timestamp = $this->parseTimestamp($value);

        if ($timestamp === null) {
            return $value;
        }

        return $this->relativeTime($timestamp);
    }

    private function relativeTime(CarbonImmutable $timestamp): string
    {
        $now = CarbonImmutable::now($this->timezone());
        $secondsAgo = $now->getTimestamp() - $timestamp->getTimestamp();

        if ($secondsAgo < 0) {
            return abs($secondsAgo) < 60 ? '剛剛' : $timestamp->format('Y-m-d');
        }

        if ($secondsAgo < 60) {
            return '剛剛';
        }

        if ($secondsAgo < 3600) {
            return max(1, intdiv($secondsAgo, 60)).' 分鐘前';
        }

        if ($secondsAgo < 86400) {
            return max(1, intdiv($secondsAgo, 3600)).' 小時前';
        }

        if ($timestamp->isSameDay($now->subDay())) {
            return '昨天 '.$timestamp->format('H:i');
        }

        if ($secondsAgo < 2592000) {
            return max(1, intdiv($secondsAgo, 86400)).' 天前';
        }

        return $timestamp->format('Y-m-d');
    }

    private function latestOf(mixed ...$values): ?string
    {
        return collect($values)
            ->filter(fn (mixed $value): bool => is_string($value) && $value !== '')
            ->sortDesc()
            ->first();
    }

    /**
     * @param  array<string, mixed>  $source
     */
    private function latestSourceTimestamp(array $source): ?CarbonImmutable
    {
        $table = (string) ($source['table'] ?? '');
        $columns = array_values(array_filter($source['columns'] ?? [], 'is_string'));

        if ($table === '' || $columns === []) {
            return null;
        }

        return $this->sourceTimestamps->latest(
            $table,
            $columns,
            is_array($source['where'] ?? null) ? $source['where'] : [],
        );
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
