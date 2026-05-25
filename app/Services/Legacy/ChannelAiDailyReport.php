<?php

namespace App\Services\Legacy;

use Carbon\CarbonImmutable;
use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class ChannelAiDailyReport
{
    /**
     * @return array{available: bool, channel: array<string, mixed>|null, row: array<string, mixed>|null, title: string, date: string|null, topics: list<array<string, mixed>>, generated_at: string}
     */
    public function forChannel(Request $request, int $uId): array
    {
        $type = $this->type($request->query('type', 'oneday'));
        $date = $this->date($request);

        try {
            $channel = $this->channel($uId);
            $row = $this->row($uId, $type, $date);

            if (! $row) {
                return $this->empty(true, $channel, $date);
            }

            $dateFrom = substr((string) $row->date_from, 0, 10);
            $dateTo = substr((string) $row->date_to, 0, 10);

            return [
                'available' => true,
                'channel' => $channel,
                'row' => [
                    'pk' => (int) $row->pk,
                    'date_from' => (string) $row->date_from,
                    'date_to' => (string) $row->date_to,
                    'data_type' => (string) $row->data_type,
                ],
                'title' => ($channel['title'] ?? 'Channel').' '.$dateFrom.' 每日重點整理',
                'date' => $dateFrom,
                'topics' => $this->topics($row->result_json ?? null),
                'generated_at' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
            ];
        } catch (QueryException) {
            return $this->empty(false, null, $date);
        }
    }

    private function row(int $uId, string $type, ?string $date): ?object
    {
        $query = DB::table('urt_channel_ai')
            ->where('u_id', $uId)
            ->whereNull('del_flag');

        if ($type === 'week') {
            return $query->where('data_type', 'week')->orderByDesc('pk')->first();
        }

        if ($date === null) {
            $latest = (clone $query)
                ->whereIn('data_type', ['todate', 'oneday'])
                ->max('date_from');

            $date = is_string($latest) && $latest !== '' ? substr($latest, 0, 10) : null;
        }

        if ($date === null) {
            return null;
        }

        return $query
            ->whereIn('data_type', ['todate', 'oneday'])
            ->where('date_from', $date.' 00:00:00')
            ->orderByDesc('pk')
            ->first();
    }

    /**
     * @return array<string, mixed>|null
     */
    private function channel(int $uId): ?array
    {
        $row = DB::table('urt_channel')->where('u_id', $uId)->first();

        if (! $row) {
            return null;
        }

        return [
            'u_id' => (int) $row->u_id,
            'youtube_id' => $row->youtube_id ?? null,
            'title' => $row->title ?? 'Unknown channel',
            'thumbnail' => $row->thumbnails ?? null,
        ];
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function topics(mixed $json): array
    {
        return collect($this->decodeList($json))
            ->map(function (mixed $item): array {
                $item = is_array($item) ? $item : [];
                $videoIds = $this->stringList($item, ['videoId', 'video_ids', 'videos']);

                return [
                    'event' => $this->text($item, ['事件', '議題', 'topic', 'title']),
                    'description' => $this->text($item, ['描述', 'description']),
                    'category' => $this->text($item, ['分類', '類型', 'category']),
                    'angle' => $this->text($item, ['角度', 'angle']),
                    'camp' => $this->text($item, ['陣營', 'camp', 'stance']),
                    'keywords' => $this->stringList($item, ['關鍵字', 'keywords']),
                    'people' => $this->stringList($item, ['人物', 'people']),
                    'places' => $this->stringList($item, ['地名', 'places']),
                    'video_ids' => $videoIds,
                    'video_count' => count($videoIds),
                ];
            })
            ->filter(fn (array $topic): bool => $topic['event'] !== '')
            ->values()
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

        if (json_last_error() !== JSON_ERROR_NONE || ! is_array($decoded)) {
            return [];
        }

        return array_is_list($decoded) ? $decoded : array_values($decoded);
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

    private function date(Request $request): ?string
    {
        $date = $request->route('date') ?? $request->query('date');

        return is_string($date) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) ? $date : null;
    }

    private function type(mixed $value): string
    {
        return is_string($value) && $value === 'week' ? 'week' : 'oneday';
    }

    /**
     * @return array{available: bool, channel: array<string, mixed>|null, row: array<string, mixed>|null, title: string, date: string|null, topics: list<array<string, mixed>>, generated_at: string}
     */
    private function empty(bool $available, ?array $channel, ?string $date): array
    {
        return [
            'available' => $available,
            'channel' => $channel,
            'row' => null,
            'title' => ($channel['title'] ?? 'Channel').' 每日重點整理',
            'date' => $date,
            'topics' => [],
            'generated_at' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
        ];
    }
}
