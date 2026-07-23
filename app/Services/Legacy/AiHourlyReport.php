<?php

namespace App\Services\Legacy;

use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class AiHourlyReport
{
    /**
     * @return array{
     *     available: bool,
     *     date: string|null,
     *     title: string,
     *     condition: string,
     *     limit: int,
     *     hours: list<array{hour: string, row_pk: int, date_from: string, topics: list<array<string, mixed>>}>,
     *     rows_count: int,
     *     generated_at: string
     * }
     */
    public function forRequest(Request $request): array
    {
        $condition = $this->condition($request->query('condition'));
        $limit = max(1, min(1000, (int) $request->query('limit', 1000)));

        try {
            $date = $this->date($request, $condition);

            if ($date === null) {
                return $this->empty(true, null, $condition, $limit);
            }

            $from = $date.' 00:00:00';
            $to = $date.' 23:59:59';

            $query = DB::table('urt_ai_hour')
                ->whereNull('del_flag')
                ->whereBetween('date_from', [$from, $to]);

            if ($condition === 'all') {
                $query->where(function ($inner): void {
                    $inner->whereNull('condition_type')->orWhere('condition_type', 'all');
                });
            } else {
                $query->where('condition_type', $condition);
            }

            if (is_string($request->query('type')) && $request->query('type') !== '') {
                $query->where('data_type', (string) $request->query('type'));
            }

            $latestRows = $query
                ->selectRaw('MAX(pk) as pk')
                ->groupBy('date_from', 'date_to', 'data_type');
            $rows = DB::table('urt_ai_hour as hour')
                ->joinSub($latestRows, 'latest', 'latest.pk', '=', 'hour.pk')
                ->select('hour.*')
                ->orderByDesc('hour.date_from')
                ->orderByDesc('hour.pk')
                ->limit(48)
                ->get();

            $hours = $rows
                ->map(function (object $row) use ($limit): array {
                    $topics = collect($this->decode($row->result_json ?? null))
                        ->take($limit)
                        ->map(fn (mixed $item): array => $this->topic($item))
                        ->filter(fn (array $item): bool => $item['event'] !== '')
                        ->values()
                        ->all();

                    return [
                        'hour' => substr((string) $row->date_from, 11, 2),
                        'row_pk' => (int) $row->pk,
                        'date_from' => (string) $row->date_from,
                        'topics' => $topics,
                    ];
                })
                ->filter(fn (array $hour): bool => $hour['topics'] !== [])
                ->values()
                ->all();

            return [
                'available' => true,
                'date' => $date,
                'title' => $this->title($date, $condition),
                'condition' => $condition,
                'limit' => $limit,
                'hours' => $hours,
                'rows_count' => collect($hours)->sum(fn (array $hour): int => count($hour['topics'])),
                'generated_at' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
            ];
        } catch (QueryException) {
            return $this->empty(false, null, $condition, $limit);
        }
    }

    private function condition(mixed $value): string
    {
        $condition = is_string($value) && $value !== '' ? $value : 'all';

        return preg_match('/^[a-zA-Z0-9_-]{1,40}$/', $condition) ? $condition : 'all';
    }

    private function isCalendarDate(string $value): bool
    {
        return preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $value, $parts) === 1
            && checkdate((int) $parts[2], (int) $parts[3], (int) $parts[1]);
    }

    private function date(Request $request, string $condition): ?string
    {
        $date = $request->query('date');

        if (is_string($date) && $this->isCalendarDate($date)) {
            return $date;
        }

        $query = DB::table('urt_ai_hour')->whereNull('del_flag');

        if ($condition === 'all') {
            $query->where(function ($inner): void {
                $inner->whereNull('condition_type')->orWhere('condition_type', 'all');
            });
        } else {
            $query->where('condition_type', $condition);
        }

        $latest = $query->max('date_from');

        return is_string($latest) && $latest !== '' ? substr($latest, 0, 10) : null;
    }

    /**
     * @return list<mixed>
     */
    private function decode(mixed $json): array
    {
        if (! is_string($json) || trim($json) === '') {
            return [];
        }

        $decoded = $this->decodeJsonPayload($json);

        if (! is_array($decoded)) {
            return [];
        }

        if (array_is_list($decoded)) {
            return $decoded;
        }

        foreach (['events', '事件', '事件列表', '主要事件', 'topics', '議題', '議題列表', 'result', 'results', 'data', 'items', 'hourly_events'] as $key) {
            if (isset($decoded[$key]) && is_array($decoded[$key])) {
                return array_is_list($decoded[$key]) ? $decoded[$key] : array_values($decoded[$key]);
            }
        }

        return array_values($decoded);
    }

    private function decodeJsonPayload(string $json): mixed
    {
        foreach ($this->jsonCandidates($json) as $candidate) {
            $decoded = json_decode($candidate, true);

            if (json_last_error() === JSON_ERROR_NONE) {
                return $decoded;
            }
        }

        return null;
    }

    /**
     * @return list<string>
     */
    private function jsonCandidates(string $json): array
    {
        $json = trim($json);
        $candidates = [$json];

        if (preg_match('/```(?:json)?\s*([\s\S]*?)\s*```/i', $json, $match) === 1) {
            $candidates[] = trim($match[1]);
        }

        $embedded = $this->firstJsonBlock($json);

        if ($embedded !== null) {
            $candidates[] = $embedded;
        }

        return collect($candidates)
            ->map(fn (string $candidate): string => trim($candidate))
            ->filter(fn (string $candidate): bool => $candidate !== '')
            ->unique()
            ->values()
            ->all();
    }

    private function firstJsonBlock(string $text): ?string
    {
        $length = strlen($text);

        for ($start = 0; $start < $length; $start++) {
            $opening = $text[$start];

            if ($opening !== '[' && $opening !== '{') {
                continue;
            }

            $stack = [];
            $inString = false;
            $escape = false;

            for ($index = $start; $index < $length; $index++) {
                $char = $text[$index];

                if ($inString) {
                    if ($escape) {
                        $escape = false;
                    } elseif ($char === '\\') {
                        $escape = true;
                    } elseif ($char === '"') {
                        $inString = false;
                    }

                    continue;
                }

                if ($char === '"') {
                    $inString = true;

                    continue;
                }

                if ($char === '[' || $char === '{') {
                    $stack[] = $char;

                    continue;
                }

                if ($char !== ']' && $char !== '}') {
                    continue;
                }

                $expected = $char === ']' ? '[' : '{';

                if (array_pop($stack) !== $expected) {
                    break;
                }

                if ($stack === []) {
                    return substr($text, $start, $index - $start + 1);
                }
            }
        }

        return null;
    }

    /**
     * @return array<string, mixed>
     */
    private function topic(mixed $item): array
    {
        $item = is_array($item) ? $item : [];
        $videoIds = $this->stringList($item, ['videoId', 'video_ids', 'videos']);

        return [
            'event' => $this->text($item, ['事件', '議題', '標題', 'event', 'topic', 'title']),
            'description' => $this->text($item, ['描述', '說明', 'description', 'content']),
            'category' => $this->text($item, ['分類', '類型', 'category', 'type']),
            'angle' => $this->text($item, ['角度', 'angle']),
            'camp' => $this->text($item, ['陣營', 'camp', 'stance']),
            'keywords' => $this->stringList($item, ['關鍵字', 'keywords']),
            'people' => $this->stringList($item, ['人物', 'people']),
            'places' => $this->stringList($item, ['地名', 'places']),
            'video_ids' => $videoIds,
            'video_count' => count($videoIds),
            'first_video_id' => $videoIds[0] ?? null,
        ];
    }

    /**
     * @param  list<string>  $keys
     */
    private function text(array $item, array $keys): string
    {
        foreach ($keys as $key) {
            if (isset($item[$key]) && is_scalar($item[$key])) {
                return trim((string) $item[$key]);
            }
        }

        return '';
    }

    /**
     * @param  list<string>  $keys
     * @return list<string>
     */
    private function stringList(array $item, array $keys): array
    {
        foreach ($keys as $key) {
            if (! isset($item[$key])) {
                continue;
            }

            if (is_array($item[$key])) {
                return collect($item[$key])
                    ->flatten()
                    ->filter(fn (mixed $value): bool => is_scalar($value) && trim((string) $value) !== '')
                    ->map(fn (mixed $value): string => trim((string) $value))
                    ->values()
                    ->all();
            }

            if (is_scalar($item[$key]) && trim((string) $item[$key]) !== '') {
                return [trim((string) $item[$key])];
            }
        }

        return [];
    }

    private function title(string $date, string $condition): string
    {
        return match ($condition) {
            'green' => '泛綠媒體在 '.$date.' 每小時主要報導',
            'blue' => '泛藍媒體在 '.$date.' 每小時主要報導',
            'neutral' => '較無偏媒體在 '.$date.' 每小時主要報導',
            'world' => $date.' 國際新聞每小時報導',
            'finance' => $date.' 財經新聞每小時報導',
            default => $date.' 當日分時事件整理',
        };
    }

    /**
     * @return array{available: bool, date: string|null, title: string, condition: string, limit: int, hours: list<array<string, mixed>>, rows_count: int, generated_at: string}
     */
    private function empty(bool $available, ?string $date, string $condition, int $limit): array
    {
        return [
            'available' => $available,
            'date' => $date,
            'title' => $date ? $this->title($date, $condition) : '當日分時事件整理',
            'condition' => $condition,
            'limit' => $limit,
            'hours' => [],
            'rows_count' => 0,
            'generated_at' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
        ];
    }
}
