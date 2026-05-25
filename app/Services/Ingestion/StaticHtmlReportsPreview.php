<?php

namespace App\Services\Ingestion;

use App\Services\Legacy\GroupMetricReport;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Http\Request;

class StaticHtmlReportsPreview
{
    public function __construct(private readonly GroupMetricReport $groupMetricReport)
    {
    }

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
    public function preview(int $limit = 20, ?CarbonInterface $now = null): array
    {
        $timezone = (string) config('ingestion.timezone', config('app.timezone', 'Asia/Taipei'));
        $now = $now === null
            ? CarbonImmutable::now($timezone)
            : CarbonImmutable::instance($now->toDateTimeImmutable())->setTimezone($timezone);
        $limit = max(1, min(200, $limit));
        $sourcePath = rtrim((string) config('legacy.ground_truth_path'), '/').'/urtube/html/make_html.sh';
        [$targets, $sourceStatus] = $this->targetsFromShell($sourcePath);

        $rows = collect($targets)
            ->map(fn (array $target): array => $this->withDynamicPreview($target))
            ->take($limit)
            ->values()
            ->all();

        return [
            'mode' => 'read-only-preview',
            'generated_at' => $now->format('Y-m-d H:i:s'),
            'source_path' => $sourcePath,
            'source_status' => $sourceStatus,
            'targets' => count($targets),
            'would_generate' => count($targets),
            'rows' => $rows,
            'writes' => [],
        ];
    }

    /**
     * @return array{0: list<array<string, mixed>>, 1: string}
     */
    private function targetsFromShell(string $sourcePath): array
    {
        if (! is_readable($sourcePath)) {
            return [$this->fallbackTargets(), 'fallback: legacy shell file is not readable from this runtime'];
        }

        $contents = file_get_contents($sourcePath);

        if (! is_string($contents)) {
            return [$this->fallbackTargets(), 'fallback: legacy shell file could not be read'];
        }

        $targets = collect(preg_split('/\R/', $contents) ?: [])
            ->map(fn (string $line): string => trim($line))
            ->filter(fn (string $line): bool => $line !== '' && ! str_starts_with($line, '#'))
            ->map(fn (string $line): ?array => $this->parseShellLine($line))
            ->filter()
            ->values()
            ->all();

        if ($targets === []) {
            return [$this->fallbackTargets(), 'fallback: no active group static targets found'];
        }

        return [$targets, 'parsed'];
    }

    /**
     * @return array<string, mixed>|null
     */
    private function parseShellLine(string $line): ?array
    {
        if (! preg_match('/^\/usr\/bin\/php\s+(?:-d\s+\S+\s+)?(?P<script>\/home\/urtube\/[^\s>]+)(?:\s+(?P<args>[^>]*?))?\s*>\s*(?P<output>\S+)$/', $line, $matches)) {
            return null;
        }

        $script = (string) $matches['script'];
        $scriptName = basename($script);
        $query = $this->parseArgs((string) ($matches['args'] ?? ''));
        $group = trim((string) ($query['group'] ?? 'media')) ?: 'media';
        unset($query['group']);
        $outputPath = (string) $matches['output'];

        $target = [
            'source_line' => $line,
            'legacy_script' => $script,
            'legacy_path' => '/'.$scriptName,
            'legacy_query' => $query + ($group !== 'media' ? ['group' => $group] : []),
            'group' => $group,
            'output_path' => $outputPath,
            'output_file' => basename($outputPath),
            'write_skipped' => 'static HTML output is intentionally not written in read-only mode',
        ];

        if ($scriptName === 'group_chart.php') {
            return $target + [
                'report_type' => 'group-ranking',
                'modern_path' => '/groups/'.$group.'/ranking',
                'query' => $query,
            ];
        }

        if ($scriptName === 'group_line.php') {
            return $target + [
                'report_type' => 'group-trend',
                'modern_path' => '/groups/'.$group.'/trends',
                'query' => $query,
            ];
        }

        if ($scriptName === 'group_people.php') {
            return $target + [
                'report_type' => 'group-membership',
                'modern_path' => '/groups/'.$group,
                'query' => $query,
            ];
        }

        return null;
    }

    /**
     * @param  array<string, mixed>  $target
     * @return array<string, mixed>
     */
    private function withDynamicPreview(array $target): array
    {
        $query = $target['query'];
        $request = Request::create($target['modern_path'], 'GET', $query + ['group' => $target['group']]);
        $available = true;
        $dynamicRows = 0;
        $cacheRows = null;

        if ($target['report_type'] === 'group-ranking') {
            $report = $this->groupMetricReport->ranking($request);
            $available = (bool) $report['available'];
            $dynamicRows = count($report['rows']);
            $cacheRows = (int) $report['cache_rows'];
        } elseif ($target['report_type'] === 'group-trend') {
            $report = $this->groupMetricReport->trend($request);
            $available = (bool) $report['available'];
            $dynamicRows = count($report['series']);
            $cacheRows = (int) $report['cache_rows'];
        }

        return $target + [
            'modern_url' => $target['modern_path'].$this->queryString($query),
            'legacy_url' => $target['legacy_path'].$this->queryString($target['legacy_query']),
            'dynamic_report_available' => $available,
            'dynamic_rows' => $dynamicRows,
            'cache_rows' => $cacheRows,
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
        return collect([
            '/usr/bin/php -d memory_limit=500M /home/urtube/group_chart.php days=30 > /home/urtube/html/group_chart_30.html',
            '/usr/bin/php -d memory_limit=500M /home/urtube/group_chart.php days=30 group=media_all > /home/urtube/html/group_chart_all.html',
            '/usr/bin/php -d memory_limit=500M /home/urtube/group_line.php days=30 > /home/urtube/html/group_line.html',
            '/usr/bin/php -d memory_limit=500M /home/urtube/group_chart.php days=7 > /home/urtube/html/group_chart.html',
        ])
            ->map(fn (string $line): ?array => $this->parseShellLine($line))
            ->filter()
            ->values()
            ->all();
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
