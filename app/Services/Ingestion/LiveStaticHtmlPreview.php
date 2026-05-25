<?php

namespace App\Services\Ingestion;

use App\Services\Legacy\LiveCurrentReport;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Http\Request;

class LiveStaticHtmlPreview
{
    public function __construct(private readonly LiveCurrentReport $liveCurrentReport)
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
        $sourcePath = rtrim((string) config('legacy.ground_truth_path'), '/').'/urtube/html/make_live.sh';
        [$targets, $sourceStatus] = $this->targetsFromShell($sourcePath);

        $rows = collect($targets)
            ->map(function (array $target): array {
                $request = Request::create($target['modern_path'], 'GET', $target['query']);
                $report = $this->liveCurrentReport->forRequest($request);

                return $target + [
                    'modern_url' => $target['modern_path'].$this->queryString($target['query']),
                    'legacy_url' => $target['legacy_path'].$this->queryString($target['query']),
                    'dynamic_report_available' => (bool) $report['available'],
                    'dynamic_rows' => count($report['rows']),
                ];
            })
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
            return [$this->fallbackTargets(), 'fallback: no active live static targets found'];
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

        if ($scriptName !== 'live.php') {
            return null;
        }

        $query = $this->parseArgs((string) ($matches['args'] ?? ''));
        $outputPath = (string) $matches['output'];

        return [
            'source_line' => $line,
            'legacy_script' => $script,
            'legacy_path' => '/'.$scriptName,
            'modern_path' => '/live/current',
            'query' => $query,
            'output_path' => $outputPath,
            'output_file' => basename($outputPath),
            'write_skipped' => 'static HTML output is intentionally not written in read-only mode',
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
        $line = '/usr/bin/php -d memory_limit=500M /home/urtube/live.php or=1,2,12,13,14,81 > /home/urtube/html/live_social.html';

        return [
            $this->parseShellLine($line),
        ];
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
