<?php

namespace App\Services\Legacy;

use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class ChannelCloudReport
{
    public function __construct(private readonly LegacyStopwords $stopwords)
    {
    }

    /**
     * @return array<string, mixed>
     */
    public function forChannel(Request $request, int $uId): array
    {
        $days = $this->days($request);
        $longDays = $this->longDays($days);
        $limit = $this->limit($request);
        $channel = $this->channel($uId);
        $short = $this->cloudCache($uId, $days);
        $long = $this->cloudCache($uId, $longDays);
        $rows = $this->adjustedRows($short['words'], $long['words'], $days, $longDays, $limit);
        $title = ($channel['title'] ?? 'Channel '.$uId).' 在 '.$days.' 天的文字雲';

        return [
            'channel' => $channel,
            'u_id' => $uId,
            'title' => $title,
            'section_title' => '頻道文字雲',
            'legacy_file' => 'channel_cloud.php + api/cloud.php',
            'cache_table' => 'urt_show_cloud',
            'days' => $days,
            'long_days' => $longDays,
            'limit' => $limit,
            'rows' => $rows,
            'short_rows' => $this->rawRows($short['words'], $limit),
            'long_rows' => $this->rawRows($long['words'], $limit),
            'max_score' => collect($rows)->max('score') ?: 0.0,
            'short_cache' => $short,
            'long_cache' => $long,
            'data_available' => $rows !== [],
            'blocked_reason' => $rows === [] ? 'local channel cloud cache is missing or empty; legacy `api/cloud.php` generation is intentionally not run' : null,
            'dependencies' => collect(['urt_show_cloud', 'urt_video'])
                ->map(fn (string $table): array => $this->dependency($table, $uId))
                ->values()
                ->all(),
            'generated_at' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
        ];
    }

    /**
     * @return array<string, mixed>|null
     */
    private function channel(int $uId): ?array
    {
        try {
            $row = DB::table('urt_channel')->where('u_id', $uId)->first();
        } catch (QueryException) {
            return null;
        }

        if (! $row) {
            return null;
        }

        return [
            'u_id' => (int) $row->u_id,
            'title' => (string) ($row->title ?? 'Unknown channel'),
            'thumbnail' => $row->thumbnails ?? null,
        ];
    }

    /**
     * @return array{available: bool, source: string, row: object|null, mtime: mixed, words: array<string, float>}
     */
    private function cloudCache(int $uId, int $days): array
    {
        try {
            $row = DB::table('urt_show_cloud')
                ->where('u_id', $uId)
                ->where('days', $days)
                ->orderByDesc('pk')
                ->first();

            $words = $this->normalizeWords($this->decodeMap($row->keywords_json ?? null));

            return [
                'available' => $row !== null && $words !== [],
                'source' => 'urt_show_cloud.keywords_json',
                'row' => $row,
                'mtime' => $row->mtime ?? null,
                'words' => $words,
            ];
        } catch (QueryException) {
            return [
                'available' => false,
                'source' => 'urt_show_cloud.keywords_json',
                'row' => null,
                'mtime' => null,
                'words' => [],
            ];
        }
    }

    /**
     * @param array<string, float> $short
     * @param array<string, float> $long
     * @return list<array{word: string, score: float, short_score: float, long_score: float}>
     */
    private function adjustedRows(array $short, array $long, int $days, int $longDays, int $limit): array
    {
        $ratio = ($longDays + 1) / ($days + 1);
        $stopwords = $this->stopwords->lookup();
        $rows = [];

        foreach ($short as $word => $shortScore) {
            if (isset($stopwords[$word])) {
                continue;
            }

            $longScore = $long[$word] ?? 0.0;
            $score = $shortScore - ($longScore / $ratio);

            if ($score <= 0) {
                continue;
            }

            $rows[] = [
                'word' => $word,
                'score' => round($score, 3),
                'short_score' => round($shortScore, 3),
                'long_score' => round($longScore, 3),
            ];
        }

        usort($rows, fn (array $a, array $b): int => $b['score'] <=> $a['score']);

        return array_slice($rows, 0, $limit);
    }

    /**
     * @param array<string, float> $words
     * @return list<array{word: string, score: float}>
     */
    private function rawRows(array $words, int $limit): array
    {
        $stopwords = $this->stopwords->lookup();
        arsort($words);

        return collect($words)
            ->reject(fn (float $score, string $word): bool => isset($stopwords[$word]))
            ->take($limit)
            ->map(fn (float $score, string $word): array => [
                'word' => $word,
                'score' => round($score, 3),
            ])
            ->values()
            ->all();
    }

    /**
     * @param array<string, mixed> $decoded
     * @return array<string, float>
     */
    private function normalizeWords(array $decoded): array
    {
        $words = [];

        foreach ($decoded as $word => $value) {
            $word = trim((string) $word);

            if ($word === '' || ! is_numeric($value)) {
                continue;
            }

            $score = (float) $value;

            if ($score > 0) {
                $words[$word] = $score;
            }
        }

        arsort($words);

        return $words;
    }

    /**
     * @return array<string, mixed>
     */
    private function decodeMap(mixed $json): array
    {
        if (! is_string($json) || trim($json) === '' || trim($json) === 'null') {
            return [];
        }

        $decoded = json_decode($json, true);

        if (isset($decoded['result']) && is_array($decoded['result'])) {
            return $decoded['result'];
        }

        return is_array($decoded) ? $decoded : [];
    }

    private function days(Request $request): int
    {
        return max(1, min(365, (int) $request->query('days', 3)));
    }

    private function longDays(int $days): int
    {
        return match ($days) {
            1 => 3,
            3 => 7,
            7 => 30,
            30 => 90,
            90 => 365,
            default => min(365, $days * 3),
        };
    }

    private function limit(Request $request): int
    {
        return max(1, min(1000, (int) $request->query('limit', 200)));
    }

    /**
     * @return array{table: string, rows: int|null, status: string}
     */
    private function dependency(string $table, int $uId): array
    {
        try {
            $query = DB::table($table);

            if (in_array($table, ['urt_show_cloud', 'urt_video'], true)) {
                $query->where('u_id', $uId);
            }

            $rows = $query->count();

            return [
                'table' => $table,
                'rows' => $rows,
                'status' => $rows > 0 ? 'present' : 'empty',
            ];
        } catch (QueryException) {
            return [
                'table' => $table,
                'rows' => null,
                'status' => 'missing',
            ];
        }
    }
}
