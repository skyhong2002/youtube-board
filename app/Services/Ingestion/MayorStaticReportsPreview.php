<?php

namespace App\Services\Ingestion;

use App\Services\Legacy\MayorReport;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Http\Request;

class MayorStaticReportsPreview
{
    public function __construct(
        private readonly MayorReport $mayorReport,
        private readonly TagDateCacheBuilder $tagDateCacheBuilder,
    ) {}

    /**
     * @return array{
     *     mode: string,
     *     generated_at: string,
     *     source_path: string,
     *     source_status: string,
     *     targets: int,
     *     would_generate: int,
     *     rows: list<array<string, mixed>>,
     *     writes: list<string>
     * }
     */
    public function preview(
        ?string $city = null,
        int $limit = 20,
        ?CarbonInterface $now = null,
        int|string|null $offset = 0,
    ): array
    {
        $timezone = (string) config('ingestion.timezone', config('app.timezone', 'Asia/Taipei'));
        $now = $now === null
            ? CarbonImmutable::now($timezone)
            : CarbonImmutable::instance($now->toDateTimeImmutable())->setTimezone($timezone);
        $limit = max(1, min(200, $limit));
        $city = $city !== null ? strtolower(trim($city)) : null;
        $sourcePath = rtrim((string) config('legacy.ground_truth_path'), '/').'/urtube/mayor/make_mayor.sh';
        [$targets, $sourceStatus] = $this->targetsFromShell($sourcePath);

        if ($city !== null && $city !== '') {
            $targets = collect($targets)
                ->filter(fn (array $target): bool => $target['city'] === $city)
                ->values()
                ->all();
        }

        $targetCount = count($targets);
        [$effectiveOffset, $offsetMode] = $this->effectiveOffset($offset, $targetCount, $limit, $now);
        $selected = collect($targets)->slice($effectiveOffset, $limit);
        $wrapped = false;

        if ($selected->count() < min($limit, $targetCount) && $effectiveOffset > 0) {
            $wrapped = true;
            $selected = $selected->concat(collect($targets)->take(min($limit, $targetCount) - $selected->count()));
        }

        $rows = $selected
            ->map(fn (array $target): array => $this->withDynamicPreview($target))
            ->values()
            ->all();

        return [
            'mode' => 'ingestion-preview',
            'generated_at' => $now->format('Y-m-d H:i:s'),
            'source_path' => $sourcePath,
            'source_status' => $sourceStatus,
            'targets' => $targetCount,
            'would_generate' => $targetCount,
            'offset' => $effectiveOffset,
            'offset_mode' => $offsetMode,
            'next_offset' => $targetCount > 0 ? ($effectiveOffset + count($rows)) % $targetCount : 0,
            'batch_wrapped' => $wrapped,
            'source_truncated' => $targetCount > count($rows),
            'rows' => $rows,
            'writes' => [],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function execute(
        ?string $city = null,
        int $limit = 20,
        int $keywordLimit = 5000,
        ?CarbonInterface $now = null,
        int|string|null $offset = 0,
    ): array
    {
        $timezone = (string) config('ingestion.timezone', config('app.timezone', 'Asia/Taipei'));
        $now = $now === null
            ? CarbonImmutable::now($timezone)
            : CarbonImmutable::instance($now->toDateTimeImmutable())->setTimezone($timezone);

        $payload = $this->preview($city, $limit, $now, $offset);
        $targetReports = [];
        $targetKeywords = [];

        foreach ($payload['rows'] as $row) {
            $request = Request::create($row['modern_path'], 'GET', $row['query']);
            $targetReports[] = [$row, $this->mayorReport->report($request, $row['city'])];
        }

        foreach ($targetReports as [, $report]) {
            foreach ($report['city']['candidates'] ?? [] as $candidate) {
                $targetKeywords[] = $candidate;
                array_push($targetKeywords, ...($this->mayorReport->candidateKeywordAliases()[$candidate] ?? []));
            }
        }

        $targetKeywords = array_values(array_unique($targetKeywords));
        $cacheJobs = [];
        $seenCacheJobs = [];
        $written = 0;
        $failedCacheRows = 0;

        foreach ($targetReports as [, $report]) {
            $range = $report['range'];

            foreach ($this->dateRange($range['cache_from'], $range['to']) as $date) {
                foreach ([3, 4, 5, 6] as $tagId) {
                    $cacheKey = $tagId.'|'.$date;

                    if (isset($seenCacheJobs[$cacheKey])) {
                        continue;
                    }

                    $seenCacheJobs[$cacheKey] = true;
                    $result = $this->tagDateCacheBuilder->build(
                        tagIds: [$tagId],
                        date: $date,
                        keywordLimit: $keywordLimit,
                        onlyKeywords: $targetKeywords,
                        execute: true,
                        now: $now,
                    );
                    $written += (int) $result['writes'];
                    $failedCacheRows += (int) ($result['failed_rows'] ?? (($result['exit_code'] ?? 0) !== 0 ? 1 : 0));
                    $cacheJobs[] = $result;
                }
            }
        }

        $rows = collect($payload['rows'])
            ->map(fn (array $target): array => $this->withDynamicPreview($target))
            ->values()
            ->all();

        return array_merge($payload, [
            'mode' => 'execute',
            'rows' => $rows,
            'target_keywords' => $targetKeywords,
            'cache_jobs' => count($cacheJobs),
            'cache_writes' => $written,
            'failed_cache_rows' => $failedCacheRows,
            'failed_rows' => $failedCacheRows,
            'exit_code' => $failedCacheRows > 0 ? 1 : 0,
            'writes' => ['urt_show_tag_date'],
        ]);
    }

    /** @return array{0: int, 1: string} */
    private function effectiveOffset(
        int|string|null $offset,
        int $total,
        int $limit,
        CarbonImmutable $now,
    ): array {
        if ($total < 1) {
            return [0, 'explicit'];
        }

        if (is_string($offset) && strtolower(trim($offset)) === 'auto') {
            return [(intdiv($now->getTimestamp(), 3600) * $limit) % $total, 'auto'];
        }

        return [max(0, (int) $offset) % $total, 'explicit'];
    }

    /**
     * @return array{0: list<array<string, mixed>>, 1: string}
     */
    private function targetsFromShell(string $sourcePath): array
    {
        if (! is_readable($sourcePath)) {
            return [$this->fallbackTargets(), 'fallback: legacy mayor shell file is not readable from this runtime'];
        }

        $contents = file_get_contents($sourcePath);

        if (! is_string($contents)) {
            return [$this->fallbackTargets(), 'fallback: legacy mayor shell file could not be read'];
        }

        $targets = collect(preg_split('/\R/', $contents) ?: [])
            ->map(fn (string $line): string => trim($line))
            ->filter(fn (string $line): bool => $line !== '' && ! str_starts_with($line, '#'))
            ->map(fn (string $line): ?array => $this->parseShellLine($line))
            ->filter()
            ->values()
            ->all();

        if ($targets === []) {
            return [$this->fallbackTargets(), 'fallback: no active mayor static targets found'];
        }

        $mergedTargets = $this->mergeCurrentTargets($targets);
        $status = count($mergedTargets) === count($targets)
            ? 'parsed'
            : 'parsed+fallback: filled missing current mayor targets';

        return [$mergedTargets, $status];
    }

    /**
     * @return array<string, mixed>|null
     */
    private function parseShellLine(string $line): ?array
    {
        if (! preg_match('/^\/usr\/bin\/php\s+(?:-d\s+\S+\s+)?(?P<script>\/home\/urtube\/mayor\/city\.php)(?:\s+(?P<args>[^>]*?))?\s*>\s*(?P<output>\S+)$/', $line, $matches)) {
            return null;
        }

        $query = $this->parseArgs((string) ($matches['args'] ?? ''));
        $city = strtolower(trim((string) ($query['city'] ?? 'taipei'))) ?: 'taipei';
        unset($query['city']);
        $outputPath = (string) $matches['output'];

        return [
            'source_line' => $line,
            'legacy_script' => (string) $matches['script'],
            'legacy_dynamic_path' => '/mayor/city.php',
            'legacy_static_path' => '/mayor/'.basename($outputPath),
            'legacy_query' => $query + ['city' => $city],
            'city' => $city,
            'output_path' => $outputPath,
            'output_file' => basename($outputPath),
            'report_type' => 'mayor-city-support',
            'modern_path' => '/mayor/cities/'.$city,
            'query' => $query,
            'write_skipped' => 'mayor static HTML output is intentionally not written in planning mode',
        ];
    }

    /**
     * @param  array<string, mixed>  $target
     * @return array<string, mixed>
     */
    private function withDynamicPreview(array $target): array
    {
        $query = $target['query'];
        $request = Request::create($target['modern_path'], 'GET', $query);
        $report = $this->mayorReport->report($request, $target['city']);

        return $target + [
            'modern_url' => $target['modern_path'].$this->queryString($query),
            'legacy_url' => $target['legacy_dynamic_path'].$this->queryString($target['legacy_query']),
            'legacy_static_url' => $target['legacy_static_path'],
            'dynamic_report_available' => (bool) $report['available'],
            'dynamic_report_has_data' => (bool) $report['data_available'],
            'dynamic_rows' => count($report['series']),
            'cache_rows' => (int) $report['cache_rows'],
        ];
    }

    /**
     * @return array<string, string>
     */
    private function parseArgs(string $args): array
    {
        return collect(preg_split('/\s+/', trim($args)) ?: [])
            ->filter()
            ->mapWithKeys(function (string $arg): array {
                [$key, $value] = array_pad(explode('=', $arg, 2), 2, '');

                return $key !== '' ? [$key => $value] : [];
            })
            ->all();
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function fallbackTargets(): array
    {
        return collect($this->mayorReport->staticCityKeys())
            ->map(fn (string $city): string => "/usr/bin/php -d memory_limit=500M /home/urtube/mayor/city.php days=30 city={$city} > /home/urtube/mayor/html_{$city}.html")
            ->map(fn (string $line): ?array => $this->parseShellLine($line))
            ->filter()
            ->values()
            ->all();
    }

    /**
     * @param  list<array<string, mixed>>  $targets
     * @return list<array<string, mixed>>
     */
    private function mergeCurrentTargets(array $targets): array
    {
        $fallbackByCity = collect($this->fallbackTargets())->keyBy('city');
        $parsedByCity = collect($targets)->keyBy('city');
        $knownCities = collect($this->mayorReport->staticCityKeys());

        $merged = $knownCities
            ->map(fn (string $city): ?array => $parsedByCity->get($city) ?? $fallbackByCity->get($city))
            ->filter()
            ->values();

        $extraParsed = $parsedByCity
            ->reject(fn (array $target, string $city): bool => $knownCities->contains($city))
            ->values();

        return $merged->concat($extraParsed)->values()->all();
    }

    /**
     * @return list<string>
     */
    private function dateRange(string $from, string $to): array
    {
        $dates = [];
        $cursor = CarbonImmutable::parse($from, 'Asia/Taipei');
        $end = CarbonImmutable::parse($to, 'Asia/Taipei');

        while ($cursor <= $end && count($dates) < 400) {
            $dates[] = $cursor->toDateString();
            $cursor = $cursor->addDay();
        }

        return $dates;
    }

    /**
     * @param  array<string, string>  $query
     */
    private function queryString(array $query): string
    {
        if ($query === []) {
            return '';
        }

        return '?'.collect($query)
            ->map(fn (string $value, string $key): string => rawurlencode($key).'='.rawurlencode($value))
            ->implode('&');
    }
}
