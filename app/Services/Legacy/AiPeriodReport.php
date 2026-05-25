<?php

namespace App\Services\Legacy;

use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

class AiPeriodReport
{
    /**
     * @return array<string, mixed>
     */
    public function forRequest(Request $request): array
    {
        $condition = $this->condition($request->query('condition'));
        $type = is_string($request->query('type')) && $request->query('type') !== '' ? (string) $request->query('type') : null;
        $range = $this->range($request);
        $limit = max(1, min(1000, (int) $request->query('limit', 1000)));

        try {
            $rows = $this->rows($range, $condition, $type, $limit);

            return [
                'available' => true,
                'title' => $this->title($range, $condition),
                'condition' => $condition,
                'type' => $type,
                'range' => $range,
                'topics' => $rows,
                'rows_count' => count($rows),
                'filters' => array_filter([
                    'condition' => $condition,
                    'type' => $type,
                    'from' => $range['from'],
                    'to' => $range['to'],
                    'limit' => $limit,
                ], fn (mixed $value): bool => $value !== null && $value !== ''),
                'generated_at' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
            ];
        } catch (QueryException) {
            return [
                'available' => false,
                'title' => $this->title($range, $condition),
                'condition' => $condition,
                'type' => $type,
                'range' => $range,
                'topics' => [],
                'rows_count' => 0,
                'filters' => [],
                'generated_at' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
            ];
        }
    }

    private function condition(mixed $value): string
    {
        $condition = is_string($value) && $value !== '' ? $value : 'all';

        return preg_match('/^[a-zA-Z0-9_-]{1,40}$/', $condition) ? $condition : 'all';
    }

    /**
     * @return array{from: string, to: string, dates: list<string>, month: string|null}
     */
    private function range(Request $request): array
    {
        $month = $request->query('month');

        if (is_string($month) && preg_match('/^\d{4}-\d{2}$/', $month)) {
            $cursor = Carbon::parse($month.'-01', 'Asia/Taipei');
            $from = $cursor->firstOfMonth()->toDateString();
            $to = Carbon::parse($month.'-01', 'Asia/Taipei')->lastOfMonth()->toDateString();

            return [
                'from' => $from,
                'to' => $to,
                'dates' => $this->dates($from, $to),
                'month' => $month,
            ];
        }

        $from = $this->dateString($request->query('from'), now('Asia/Taipei')->subDays(8)->toDateString());
        $to = $this->dateString($request->query('to'), now('Asia/Taipei')->subDay()->toDateString());

        if ($from > $to) {
            [$from, $to] = [$to, $from];
        }

        return [
            'from' => $from,
            'to' => $to,
            'dates' => $this->dates($from, $to),
            'month' => null,
        ];
    }

    private function dateString(mixed $value, string $fallback): string
    {
        return is_string($value) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $value) ? $value : $fallback;
    }

    /**
     * @return list<string>
     */
    private function dates(string $from, string $to): array
    {
        $dates = [];
        $cursor = Carbon::parse($from, 'Asia/Taipei');
        $end = Carbon::parse($to, 'Asia/Taipei');

        while ($cursor <= $end && count($dates) < 62) {
            $dates[] = $cursor->toDateString();
            $cursor->addDay();
        }

        return $dates;
    }

    /**
     * @param array{from: string, to: string} $range
     * @return list<array<string, mixed>>
     */
    private function rows(array $range, string $condition, ?string $type, int $limit): array
    {
        $query = DB::table('urt_ai_date')
            ->whereNull('del_flag')
            ->whereBetween('date_from', [$range['from'].' 00:00:00', $range['to'].' 00:00:00']);

        if ($condition === 'all') {
            $query->where(function ($inner): void {
                $inner->whereNull('condition_type')->orWhere('condition_type', 'all');
            });
        } else {
            $query->where('condition_type', $condition);
        }

        if ($type !== null) {
            $query->where('data_type', $type);
        }

        $dailyRows = $query
            ->orderByDesc('date_from')
            ->orderByDesc('pk')
            ->get();

        $seenDates = [];
        $topics = [];

        foreach ($dailyRows as $row) {
            $date = substr((string) $row->date_from, 0, 10);

            if (isset($seenDates[$date])) {
                continue;
            }

            $seenDates[$date] = true;

            foreach ($this->topicsForRow($row) as $topic) {
                $topics[] = ['date' => $date, 'row_pk' => (int) $row->pk] + $topic;

                if (count($topics) >= $limit) {
                    break 2;
                }
            }
        }

        return $topics;
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function topicsForRow(object $row): array
    {
        $rawTopics = $this->decodeList($row->result_json ?? null);
        $cached = $this->decodeObject($row->data_json ?? null);

        if ($cached !== []) {
            return collect($cached)
                ->map(fn (mixed $stats, string $title): array => $this->topicFromStats($title, is_array($stats) ? $stats : []))
                ->values()
                ->all();
        }

        return collect($rawTopics)
            ->map(function (mixed $topic): array {
                $topic = is_array($topic) ? $topic : [];
                $mediaEvents = $topic['媒體事件'] ?? $topic['media_events'] ?? $topic['mediaEvents'] ?? [];
                $mediaCount = is_array($mediaEvents) ? count($mediaEvents) : 0;
                $eventCount = collect(is_array($mediaEvents) ? $mediaEvents : [])
                    ->map(fn (mixed $events): int => is_array($events) ? count($events) : 0)
                    ->sum();

                return [
                    'event' => $this->text($topic, ['標題', '議題', 'title', 'topic']),
                    'media_count' => $mediaCount,
                    'video_count' => $eventCount,
                    'keyword_count' => 0,
                    'top_person' => '',
                    'top_person_count' => 0,
                    'top_keyword' => '',
                    'top_keyword_count' => 0,
                ];
            })
            ->filter(fn (array $topic): bool => $topic['event'] !== '')
            ->values()
            ->all();
    }

    /**
     * @param array<string, mixed> $stats
     * @return array<string, mixed>
     */
    private function topicFromStats(string $title, array $stats): array
    {
        $people = $this->numericMap($stats['人物'] ?? []);
        unset($people['無']);
        $keywords = $this->numericMap($stats['關鍵字'] ?? []);

        foreach (array_keys($people) as $person) {
            unset($keywords[$person]);
        }

        arsort($people);
        arsort($keywords);

        $keywordCounts = $this->numericMap($stats['關鍵字次數'] ?? []);

        return [
            'event' => $title,
            'media_count' => (int) ($stats['媒體數'] ?? 0),
            'video_count' => (int) ($stats['影片數'] ?? 0),
            'keyword_count' => (int) array_sum($keywordCounts),
            'top_person' => (string) (array_key_first($people) ?? ''),
            'top_person_count' => (int) (current($people) ?: 0),
            'top_keyword' => (string) (array_key_first($keywords) ?? ''),
            'top_keyword_count' => (int) (current($keywords) ?: 0),
        ];
    }

    /**
     * @return array<string, int>
     */
    private function numericMap(mixed $value): array
    {
        if (! is_array($value)) {
            return [];
        }

        return collect($value)
            ->filter(fn (mixed $count, mixed $key): bool => is_string($key) && is_numeric($count))
            ->map(fn (mixed $count): int => (int) $count)
            ->all();
    }

    /**
     * @return list<mixed>
     */
    private function decodeList(mixed $json): array
    {
        if (! is_string($json) || trim($json) === '') {
            return [];
        }

        $decoded = json_decode($json, true);

        if (! is_array($decoded)) {
            return [];
        }

        foreach (['events', '事件', 'topics', '議題', 'result', 'data'] as $key) {
            if (! array_is_list($decoded) && isset($decoded[$key]) && is_array($decoded[$key])) {
                $decoded = $decoded[$key];
                break;
            }
        }

        return array_is_list($decoded) ? $decoded : array_values($decoded);
    }

    /**
     * @return array<string, mixed>
     */
    private function decodeObject(mixed $json): array
    {
        if (! is_string($json) || trim($json) === '') {
            return [];
        }

        $decoded = json_decode($json, true);

        if (! is_array($decoded) || array_is_list($decoded)) {
            return [];
        }

        return $decoded;
    }

    /**
     * @param list<string> $keys
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
     * @param array{from: string, to: string, month: string|null} $range
     */
    private function title(array $range, string $condition): string
    {
        if ($range['month'] !== null) {
            return Carbon::parse($range['month'].'-01', 'Asia/Taipei')->format('Y年m月 的所有事件');
        }

        return match ($condition) {
            'green' => '泛綠媒體在 '.$range['from'].' - '.$range['to'].' 主要報導',
            'blue' => '泛藍媒體在 '.$range['from'].' - '.$range['to'].' 主要報導',
            'neutral' => '較無偏媒體在 '.$range['from'].' - '.$range['to'].' 主要報導',
            'world' => $range['from'].' - '.$range['to'].' 國際新聞報導',
            'finance' => $range['from'].' - '.$range['to'].' 財經新聞報導',
            default => $range['from'].' - '.$range['to'].' 主要事件與各媒體報導',
        };
    }
}
