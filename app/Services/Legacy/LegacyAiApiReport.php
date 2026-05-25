<?php

namespace App\Services\Legacy;

use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use stdClass;

class LegacyAiApiReport
{
    /**
     * @return array<string, mixed>
     */
    public function aiDay(Request $request): array
    {
        $condition = $this->condition($request->query('condition'));

        try {
            $row = $this->dailyRow($request, $condition, latestWhenDateMissing: true);

            if (! $row) {
                return $this->emptyPayload('urt_ai_date', ['condition' => $condition]);
            }

            $channelId = $this->channelMap($row->channel_id ?? null);
            $channel = $this->channelAiRows($channelId, (string) $row->date_from, (string) $row->date_to, null);

            return [
                'result' => $this->decodeJson($row->result_json ?? null),
                'channel' => $channel,
                'channel_id' => $channelId,
                'time' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
                'date' => substr((string) $row->date_from, 0, 10),
                'from' => substr((string) $row->date_from, 0, 10),
                'to' => substr((string) $row->date_to, 0, 10),
                'meta' => [
                    'available' => true,
                    'source' => 'urt_ai_date + urt_channel_ai',
                    'pk' => (int) $row->pk,
                    'condition' => $row->condition_type ?: $condition,
                    'data_type' => $row->data_type ?? null,
                    'read_only' => true,
                ],
            ];
        } catch (QueryException) {
            return $this->emptyPayload('urt_ai_date + urt_channel_ai', ['condition' => $condition]);
        }
    }

    /**
     * @return array<string, mixed>
     */
    public function topic(Request $request): array
    {
        $condition = $this->condition($request->query('condition', 'all'));
        $dataType = $this->dataType($request->query('type', 'oneday'));

        try {
            $row = $this->dailyRow($request, $condition, latestWhenDateMissing: false);

            if (! $row) {
                return $this->emptyPayload('urt_ai_date topic', ['condition' => $condition, 'type' => $dataType]);
            }

            $cachedVideo = $this->decodeMap($row->video_json ?? null);
            $cachedTopic = $this->decodeMap($row->data_json ?? null);
            $raw = $this->decodeJson($row->result_json ?? null);
            $channelId = $this->channelMap($row->channel_id ?? null);
            $usedCache = $cachedVideo !== [] && $cachedTopic !== [] && (int) $request->query('force', 0) < 1;
            $topic = $usedCache ? $cachedTopic : $this->deriveTopicStats($raw);

            return [
                'result' => [
                    'video' => $usedCache ? $cachedVideo : new stdClass(),
                    'topic' => $topic === [] ? new stdClass() : $topic,
                    'channel_id' => $channelId,
                    'raw' => $raw,
                ],
                'response_time' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
                'cache_time' => $row->mtime ?? null,
                'pk' => (int) $row->pk,
                'meta' => [
                    'available' => true,
                    'source' => $usedCache ? 'urt_ai_date.data_json/video_json' : 'urt_ai_date.result_json derived read-only',
                    'condition' => $row->condition_type ?: $condition,
                    'type' => $dataType,
                    'read_only' => true,
                    'cache_writeback_skipped' => ! $usedCache,
                ],
            ];
        } catch (QueryException) {
            return $this->emptyPayload('urt_ai_date topic', ['condition' => $condition, 'type' => $dataType]);
        }
    }

    /**
     * @return array<string, mixed>
     */
    public function event(Request $request): array
    {
        $condition = $this->condition($request->query('condition', 'all'));

        try {
            $row = $this->dailyRow($request, $condition, latestWhenDateMissing: true);

            if (! $row) {
                return $this->emptyPayload('urt_ai_date event', ['condition' => $condition]);
            }

            $date = substr((string) $row->date_to, 0, 10);
            $event = trim((string) $request->query('event', '')) ?: $this->firstTopicTitle($row->result_json ?? null);
            $match = $event === '' ? [] : [$date => [$event]];
            $pk = [$date => (string) $row->pk];
            $periodRows = $this->periodRowsCount();
            $result = [
                'match' => $match === [] ? new stdClass() : $match,
                'pk' => $pk,
            ];

            if ($request->query->has('prefetch')) {
                $result['keyword'] = [
                    'date' => new stdClass(),
                    'meta' => new stdClass(),
                ];
            }

            return [
                'result' => $result,
                'meta' => [
                    'available' => $event !== '',
                    'source' => 'urt_ai_date'.($periodRows > 0 ? ' + urt_ai_period' : ''),
                    'pk' => (int) $row->pk,
                    'event' => $event,
                    'condition' => $row->condition_type ?: $condition,
                    'history_available' => $periodRows > 0,
                    'period_rows' => $periodRows,
                    'read_only' => true,
                    'blocked_reason' => $periodRows === 0 ? 'local urt_ai_period has no rows, so legacy multi-day event tracing is unavailable' : null,
                ],
            ];
        } catch (QueryException) {
            return $this->emptyPayload('urt_ai_date event', ['condition' => $condition]);
        }
    }

    /**
     * @return array<string, mixed>
     */
    public function comment(Request $request): array
    {
        $videoId = trim((string) $request->query('videoId', 'azzXesons8Q')) ?: 'azzXesons8Q';

        try {
            $row = DB::table('urt_comment')->where('videoId', $videoId)->first();

            return [
                'result' => $this->decodeJson($row->comments_json ?? null),
                'authors' => $this->decodeJson($row->authors_json ?? null),
                'latest_time' => $row->latest_time ?? null,
                'updated' => $row->mtime ?? null,
                'videoId' => $videoId,
                'meta' => [
                    'available' => $row !== null,
                    'source' => 'urt_comment',
                    'read_only' => true,
                    'log_write_skipped' => 'legacy urt_log_api insert is intentionally omitted',
                    'blocked_reason' => $row === null ? 'local urt_comment has no row for this video' : null,
                ],
            ];
        } catch (QueryException) {
            return $this->emptyPayload('urt_comment', ['videoId' => $videoId]);
        }
    }

    private function dailyRow(Request $request, string $condition, bool $latestWhenDateMissing): ?object
    {
        $pk = (int) $request->query('pk', 0);

        if ($pk > 0) {
            return DB::table('urt_ai_date')->where('pk', $pk)->first();
        }

        $date = $this->dateString($request->query('date'));

        if ($date === null && $latestWhenDateMissing) {
            $date = $this->latestDate($condition);
        }

        if ($date === null) {
            $date = now('Asia/Taipei')->toDateString();
        }

        $from = $this->dateString($request->query('from')) ?? $date;
        $to = $this->dateString($request->query('to')) ?? $date;
        $query = DB::table('urt_ai_date')
            ->whereNull('del_flag')
            ->where('date_from', $from.' 00:00:00')
            ->where('date_to', $to.' 23:59:59');

        if ($condition === 'all') {
            $query->where(function ($inner): void {
                $inner->whereNull('condition_type')->orWhere('condition_type', 'all');
            });
        } else {
            $query->where('condition_type', $condition);
        }

        return $query->orderByDesc('pk')->first();
    }

    private function latestDate(string $condition): ?string
    {
        $query = DB::table('urt_ai_date')
            ->whereNull('del_flag')
            ->whereIn('data_type', ['todate', 'oneday']);

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
     * @return array<int, string>
     */
    private function channelMap(mixed $json): array
    {
        return collect($this->decodeMap($json))
            ->filter(fn (mixed $title, mixed $uId): bool => is_numeric($uId) && is_scalar($title))
            ->mapWithKeys(fn (mixed $title, mixed $uId): array => [(int) $uId => (string) $title])
            ->all();
    }

    /**
     * @param array<int, string> $channelId
     * @return array<int, mixed>
     */
    private function channelAiRows(array $channelId, string $dateFrom, string $dateTo, ?string $dataType): array
    {
        if ($channelId === []) {
            return [];
        }

        $query = DB::table('urt_channel_ai')
            ->whereIn('u_id', array_keys($channelId))
            ->where('date_from', $dateFrom)
            ->where('date_to', $dateTo)
            ->whereNull('del_flag')
            ->orderByDesc('pk');

        if ($dataType !== null) {
            $query->where('data_type', $dataType);
        }

        return $query->get(['u_id', 'result_json'])
            ->unique('u_id')
            ->mapWithKeys(fn (object $row): array => [(int) $row->u_id => $this->decodeJson($row->result_json ?? null)])
            ->all();
    }

    /**
     * @param mixed $raw
     * @return array<string, array<string, mixed>>
     */
    private function deriveTopicStats(mixed $raw): array
    {
        if (! is_array($raw)) {
            return [];
        }

        return collect($raw)
            ->mapWithKeys(function (mixed $topic): array {
                $topic = is_array($topic) ? $topic : [];
                $title = $this->text($topic, ['標題', 'title', 'topic']);
                $mediaEvents = $topic['媒體事件'] ?? $topic['media_events'] ?? [];
                $mediaCount = is_array($mediaEvents) ? count($mediaEvents) : 0;
                $eventCount = collect(is_array($mediaEvents) ? $mediaEvents : [])
                    ->sum(fn (mixed $events): int => is_array($events) ? count($events) : 0);

                return $title === '' ? [] : [$title => [
                    '媒體數' => $mediaCount,
                    '影片數' => $eventCount,
                    'videos' => new stdClass(),
                    '關鍵字' => new stdClass(),
                    '關鍵字次數' => new stdClass(),
                    '人物' => new stdClass(),
                    '標籤' => new stdClass(),
                ]];
            })
            ->all();
    }

    private function firstTopicTitle(mixed $json): string
    {
        $raw = $this->decodeJson($json);
        $first = is_array($raw) ? reset($raw) : null;

        return is_array($first) ? $this->text($first, ['標題', 'title', 'topic']) : '';
    }

    private function periodRowsCount(): int
    {
        try {
            return DB::table('urt_ai_period')->count();
        } catch (QueryException) {
            return 0;
        }
    }

    private function condition(mixed $value): string
    {
        $condition = is_string($value) && $value !== '' ? $value : 'all';

        return preg_match('/^[a-zA-Z0-9_-]{1,40}$/', $condition) ? $condition : 'all';
    }

    private function dataType(mixed $value): string
    {
        $type = is_string($value) && $value !== '' ? $value : 'oneday';

        return preg_match('/^[a-zA-Z0-9_-]{1,40}$/', $type) ? $type : 'oneday';
    }

    private function dateString(mixed $value): ?string
    {
        return is_string($value) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $value) ? $value : null;
    }

    /**
     * @param list<string> $keys
     */
    private function text(array $row, array $keys): string
    {
        foreach ($keys as $key) {
            if (isset($row[$key]) && is_scalar($row[$key])) {
                return trim((string) $row[$key]);
            }
        }

        return '';
    }

    private function decodeJson(mixed $json): mixed
    {
        if (! is_string($json) || trim($json) === '' || trim($json) === 'null') {
            return new stdClass();
        }

        $decoded = json_decode($json, true);

        return is_array($decoded) ? $decoded : new stdClass();
    }

    /**
     * @return array<string, mixed>
     */
    private function decodeMap(mixed $json): array
    {
        $decoded = $this->decodeJson($json);

        return is_array($decoded) ? $decoded : [];
    }

    /**
     * @param array<string, mixed> $meta
     * @return array<string, mixed>
     */
    private function emptyPayload(string $source, array $meta = []): array
    {
        return [
            'result' => new stdClass(),
            'meta' => $meta + [
                'available' => false,
                'source' => $source,
                'read_only' => true,
            ],
        ];
    }
}
