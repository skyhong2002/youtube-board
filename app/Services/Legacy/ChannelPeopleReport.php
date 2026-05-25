<?php

namespace App\Services\Legacy;

use Carbon\CarbonImmutable;
use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class ChannelPeopleReport
{
    private const EXCLUDED_PEOPLE = [
        '王淑麗', '郭正亮', '蔡正元', '葉思敏', '丁士芬', '孫大千', '黃征輝', '栗正傑', '黃暐瀚', '尚毅夫',
        '黃益中', '吳靜怡', '康仁俊', '于北辰', '謝寒冰', '吳德榮', '張雅琴', '劉寶傑', '徐俊相', '鄭明典',
        '葉俞璘', '賴家瑩', '鄭凱銘', '未知', '農民', '無特殊人物', '無', '不明', '交通部官員', '警方', '居民',
    ];

    /**
     * @return array{available: bool, channel: array<string, mixed>|null, title: string, period: array{from: string|null, to: string|null, days: int}, people: list<array<string, mixed>>, dates: list<string>, matrix: list<array<string, mixed>>, generated_at: string}
     */
    public function forChannel(Request $request, int $uId): array
    {
        $days = max(1, min(90, (int) $request->query('days', 28)));
        $limit = max(1, min(30, (int) $request->query('limit', 10)));

        try {
            $channel = $this->channel($uId);
            $latest = DB::table('urt_channel_ai')
                ->where('u_id', $uId)
                ->where('data_type', 'oneday')
                ->whereNull('del_flag')
                ->max('date_from');

            if (! is_string($latest) || $latest === '') {
                return $this->empty(true, $channel, $days);
            }

            $to = CarbonImmutable::parse($latest, 'Asia/Taipei')->startOfDay();
            $from = $to->subDays($days - 1);
            $rows = DB::table('urt_channel_ai')
                ->where('u_id', $uId)
                ->where('data_type', 'oneday')
                ->whereNull('del_flag')
                ->where('date_from', '>=', $from->format('Y-m-d 00:00:00'))
                ->where('date_from', '<=', $to->format('Y-m-d 23:59:59'))
                ->orderBy('date_from')
                ->get(['date_from', 'result_json']);

            $aggregates = $this->aggregate($rows);
            $people = collect($aggregates)
                ->sortByDesc(fn (array $row): int => $row['topics'] * 1000000 + $row['videos'])
                ->take($limit)
                ->values()
                ->all();
            $dates = $this->dates($from, $to);

            return [
                'available' => true,
                'channel' => $channel,
                'title' => ($channel['title'] ?? 'Channel').' 最近 '.$days.' 天人物排行',
                'period' => ['from' => $from->toDateString(), 'to' => $to->toDateString(), 'days' => $days],
                'people' => $people,
                'dates' => $dates,
                'matrix' => $this->matrix($dates, $people, $aggregates),
                'generated_at' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
            ];
        } catch (QueryException) {
            return $this->empty(false, null, $days);
        }
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
            'title' => $row->title ?? 'Unknown channel',
            'thumbnail' => $row->thumbnails ?? null,
        ];
    }

    /**
     * @return array<string, array{name: string, videos: int, topics: int, dates: array<string, array{videos: int, topics: int}>}>
     */
    private function aggregate(iterable $rows): array
    {
        $people = [];

        foreach ($rows as $row) {
            $date = substr((string) $row->date_from, 0, 10);

            foreach ($this->decodeList($row->result_json ?? null) as $topic) {
                $topic = is_array($topic) ? $topic : [];
                $videoCount = max(1, count($this->stringList($topic, ['videoId', 'video_ids', 'videos'])));

                foreach ($this->stringList($topic, ['人物', 'people']) as $person) {
                    if (in_array($person, self::EXCLUDED_PEOPLE, true)) {
                        continue;
                    }

                    $people[$person] ??= [
                        'name' => $person,
                        'videos' => 0,
                        'topics' => 0,
                        'dates' => [],
                    ];
                    $people[$person]['videos'] += $videoCount;
                    $people[$person]['topics']++;
                    $people[$person]['dates'][$date] ??= ['videos' => 0, 'topics' => 0];
                    $people[$person]['dates'][$date]['videos'] += $videoCount;
                    $people[$person]['dates'][$date]['topics']++;
                }
            }
        }

        return $people;
    }

    /**
     * @return list<string>
     */
    private function dates(CarbonImmutable $from, CarbonImmutable $to): array
    {
        $dates = [];

        for ($date = $to; $date >= $from; $date = $date->subDay()) {
            $dates[] = $date->toDateString();
        }

        return $dates;
    }

    /**
     * @param  list<string>  $dates
     * @param  list<array<string, mixed>>  $people
     * @param  array<string, array<string, mixed>>  $aggregates
     * @return list<array<string, mixed>>
     */
    private function matrix(array $dates, array $people, array $aggregates): array
    {
        return collect($dates)
            ->map(fn (string $date): array => [
                'date' => $date,
                'cells' => collect($people)
                    ->mapWithKeys(function (array $person) use ($date, $aggregates): array {
                        $name = $person['name'];

                        return [$name => $aggregates[$name]['dates'][$date]['videos'] ?? 0];
                    })
                    ->all(),
            ])
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

    /**
     * @return array{available: bool, channel: array<string, mixed>|null, title: string, period: array{from: string|null, to: string|null, days: int}, people: list<array<string, mixed>>, dates: list<string>, matrix: list<array<string, mixed>>, generated_at: string}
     */
    private function empty(bool $available, ?array $channel, int $days): array
    {
        return [
            'available' => $available,
            'channel' => $channel,
            'title' => ($channel['title'] ?? 'Channel').' 最近 '.$days.' 天人物排行',
            'period' => ['from' => null, 'to' => null, 'days' => $days],
            'people' => [],
            'dates' => [],
            'matrix' => [],
            'generated_at' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
        ];
    }
}
