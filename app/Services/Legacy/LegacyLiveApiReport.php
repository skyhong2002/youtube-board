<?php

namespace App\Services\Legacy;

use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use stdClass;

class LegacyLiveApiReport
{
    public function __construct(private readonly LegacyTagFilter $tagFilter)
    {
    }

    /**
     * @return array<string, mixed>
     */
    public function liveDay(Request $request): array
    {
        $videoId = trim((string) $request->query('videoId', 'V1p33hqPrUk')) ?: 'V1p33hqPrUk';
        $period = $this->singleOrRangePeriod($request, '2022-11-19');

        try {
            $query = DB::table('urt_video_live_log')
                ->select(['the_date', 'log_json'])
                ->where('videoId', $videoId);

            $this->applyPeriod($query, $period);

            $rows = $query->orderBy('the_date')->get();
            $result = [];

            foreach ($rows as $row) {
                $result[substr((string) $row->the_date, 0, 10)] = $this->decodeMap($row->log_json);
            }

            return [
                'result' => $result === [] ? new stdClass() : $result,
                'meta' => [
                    'available' => $rows->isNotEmpty(),
                    'source' => 'urt_video_live_log',
                    'videoId' => $videoId,
                    'period' => $period,
                    'read_only' => true,
                ],
            ];
        } catch (QueryException) {
            return $this->unavailable('urt_video_live_log', ['videoId' => $videoId, 'period' => $period]);
        }
    }

    /**
     * @return array<string, mixed>
     */
    public function liveDate(Request $request): array
    {
        $period = $this->singleOrRangePeriod($request, '2022-11-19');

        try {
            if (! $period['is_range']) {
                $cache = DB::table('urt_show_live_date')
                    ->where('the_date', $period['date'])
                    ->first();

                $cached = $this->decodeMap($cache->return_json ?? null);

                if (isset($cached['result']) && is_array($cached['result'])) {
                    $cached['meta'] = [
                        'available' => true,
                        'source' => 'urt_show_live_date.return_json',
                        'period' => $period,
                        'mtime' => $cache->mtime ?? null,
                        'read_only' => true,
                    ];

                    return $cached;
                }
            }

            $derived = $this->deriveLiveDate($period);

            return $derived + [
                'meta' => [
                    'available' => $derived['result']['video'] !== [],
                    'source' => 'urt_video_live_log derived read-only',
                    'period' => $period,
                    'read_only' => true,
                ],
            ];
        } catch (QueryException) {
            return $this->unavailable('urt_show_live_date/urt_video_live_log', ['period' => $period]);
        }
    }

    /**
     * @return array<string, mixed>
     */
    public function liveHour(Request $request): array
    {
        $period = $this->singleOrRangePeriod($request, '2022-11-19');

        try {
            $query = DB::table('urt_video_live_log')
                ->select(['videoId', 'the_date', 'log_json']);

            $this->applyPeriod($query, $period);

            $rows = $query->orderBy('the_date')->get();
            $hourly = [];

            foreach ($rows as $row) {
                $date = substr((string) $row->the_date, 0, 10);
                $videoId = (string) $row->videoId;

                foreach ($this->hourlyPeaks($row->log_json) as $hour => $views) {
                    $key = $date.' '.$hour;
                    $hourly[$key][$videoId] = max($hourly[$key][$videoId] ?? 0, $views);
                }
            }

            ksort($hourly);

            return [
                'result' => $hourly === [] ? new stdClass() : $hourly,
                'meta' => [
                    'available' => $rows->isNotEmpty(),
                    'source' => 'urt_video_live_log derived read-only',
                    'period' => $period,
                    'read_only' => true,
                ],
            ];
        } catch (QueryException) {
            return $this->unavailable('urt_video_live_log', ['period' => $period]);
        }
    }

    /**
     * @return array<string, mixed>
     */
    public function liveTagDate(Request $request): array
    {
        $filters = $this->sortedTagFilters($request);
        $date = $this->boundedDate((string) $request->query('date', now('Asia/Taipei')->toDateString()), now('Asia/Taipei')->toDateString(), '2010-01-01');

        try {
            $query = DB::table('urt_show_live_tag_date')
                ->where('the_date', $date);

            foreach (['tagid' => 'tagid', 'or' => 'tag_or', 'not' => 'tag_not'] as $filterKey => $column) {
                $this->whereNullableEmptyString($query, $column, $filters[$filterKey.'_string']);
            }

            $row = $query->first();

            return [
                'result' => [
                    'views' => $this->decodeMap($row->tags_views ?? null),
                    'videos' => $this->decodeMap($row->tags_video ?? null),
                    'all' => $this->decodeMap($row->all_result ?? null),
                    'hour' => $this->decodeMap($row->hour_result ?? null),
                    'data' => $this->decodeMap($row->videos_result ?? null),
                ],
                'meta' => [
                    'available' => $row !== null,
                    'source' => 'urt_show_live_tag_date cache',
                    'date' => $date,
                    'filters' => $filters,
                    'counts' => [
                        'channels' => (int) ($row->count_channels ?? 0),
                        'videos' => (int) ($row->count_videos ?? 0),
                        'tags' => (int) ($row->count_tags ?? 0),
                        'total_views' => (int) ($row->total_views ?? 0),
                    ],
                    'mtime' => $row->mtime ?? null,
                    'read_only' => true,
                ],
            ];
        } catch (QueryException) {
            return $this->unavailable('urt_show_live_tag_date', ['date' => $date, 'filters' => $filters]);
        }
    }

    /**
     * @return array<string, mixed>
     */
    public function liveDateList(Request $request): array
    {
        $period = $this->singleOrRangePeriodWithDefault($request, '2022-11-19', $this->latestLogDate('urt_video_live_log') ?? now('Asia/Taipei')->toDateString());
        $filters = $this->tagFilter->filters($request);
        $limit = max(1, min(1000, (int) $request->query('limit', $filters['limit'])));

        try {
            $channels = $this->tagFilter->matchingChannelTags($filters)->keyBy('u_id');

            if ($channels->isEmpty()) {
                return $this->liveDateListPayload([], $period, true, 'urt_video_live_log');
            }

            $query = DB::table('urt_video_live_log')
                ->select(['videoId', 'u_id', 'the_date', 'max_current', 'log_json'])
                ->whereIn('u_id', $channels->keys()->all());

            $this->applyPeriod($query, $period);
            $logs = $query->get();
            $byVideo = [];

            foreach ($logs as $log) {
                $videoId = (string) $log->videoId;
                $maxCurrent = (int) ($log->max_current ?? 0);

                if (! isset($byVideo[$videoId]) || $maxCurrent > $byVideo[$videoId]['max_current']) {
                    $byVideo[$videoId] = [
                        'videoId' => $videoId,
                        'u_id' => (int) ($log->u_id ?? 0),
                        'the_date' => substr((string) $log->the_date, 0, 10),
                        'max_current' => $maxCurrent,
                        'live_log' => $this->decodeMap($log->log_json),
                    ];
                }
            }

            $rows = $this->mergeDisplayRows($byVideo);

            if ((int) $request->query('sorting', 0) > 0) {
                usort($rows, fn (array $a, array $b): int => ((int) ($b['max_current'] ?? 0)) <=> ((int) ($a['max_current'] ?? 0)));
            }

            return $this->liveDateListPayload(array_slice($rows, 0, $limit), $period, true, 'urt_video_live_log');
        } catch (QueryException) {
            return $this->liveDateListPayload([], $period, false, 'urt_video_live_log');
        }
    }

    /**
     * @return array<string, mixed>
     */
    public function liveTvbs(Request $request): array
    {
        $period = $this->singleOrRangePeriodWithDefault($request, '2022-11-19', $this->latestLogDate('urt_video_live_log_tvbs') ?? now('Asia/Taipei')->toDateString());

        try {
            $query = DB::table('urt_video_live_log_tvbs');
            $this->applyPeriod($query, $period);

            $rows = $query->get()
                ->mapWithKeys(fn (object $row): array => [(string) $row->videoId => (array) $row])
                ->all();

            return [
                'result' => $rows === [] ? new stdClass() : $rows,
                'time' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
                'date' => $period['date'],
                'count_videos' => count($rows),
                'meta' => [
                    'available' => $rows !== [],
                    'source' => 'urt_video_live_log_tvbs',
                    'period' => $period,
                    'read_only' => true,
                ],
            ];
        } catch (QueryException) {
            return [
                'result' => new stdClass(),
                'time' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
                'date' => $period['date'],
                'count_videos' => 0,
                'meta' => [
                    'available' => false,
                    'source' => 'urt_video_live_log_tvbs',
                    'period' => $period,
                    'read_only' => true,
                ],
            ];
        }
    }

    public function videoLiveHtml(Request $request): string
    {
        $videoId = trim((string) $request->query('videoId', '_QbRXRnHMVY')) ?: '_QbRXRnHMVY';
        $date = $this->boundedDate((string) $request->query('date', now('Asia/Taipei')->toDateString()), now('Asia/Taipei')->toDateString(), '2022-11-19');

        try {
            $concurrentViewers = DB::table('urt_video_live')
                ->where('videoId', $videoId)
                ->value('concurrentViewers');
            $log = DB::table('urt_video_live_log')
                ->where('videoId', $videoId)
                ->where('the_date', $date)
                ->first();
            $logData = $this->decodeMap($log->log_json ?? null);
            $maxCurrent = (int) ($log->max_current ?? collect($logData)->map(fn (mixed $value): int => (int) $value)->max() ?? 0);
            $values = collect($logData)
                ->values()
                ->map(fn (mixed $value): int => (int) $value)
                ->slice(-24)
                ->implode(',');
        } catch (QueryException) {
            $concurrentViewers = 0;
            $maxCurrent = 0;
            $values = '';
        }

        return sprintf(
            "<head>\n<meta http-equiv=\"refresh\" content=\"300\">\n</head>\n<body>\n目前：%s 人，最高：%s 人\n<script type=\"text/javascript\">var myvalues = [%s];</script>\n<span class=\"stream\"></span>\n</body>\n",
            number_format((int) $concurrentViewers),
            number_format($maxCurrent),
            $values,
        );
    }

    public function liveLineCsv(Request $request): string
    {
        $videoId = trim((string) $request->query('videoId', 'quwqlazU-c8')) ?: 'quwqlazU-c8';
        $limit = max(1, min(1000, (int) $request->query('limit', 100)));
        $hours = [];
        $latestHour = '2022-11-01 00:00:00';

        try {
            $rows = DB::table('urt_video_live_log')
                ->select(['the_date', 'log_json'])
                ->where('videoId', $videoId)
                ->orderBy('the_date')
                ->get();

            foreach ($rows as $row) {
                $date = substr((string) $row->the_date, 0, 10);

                foreach ($this->decodeMap($row->log_json) as $time => $views) {
                    $timestamp = Carbon::parse($date.' '.$time.':00', 'Asia/Taipei');
                    $hour = $timestamp->format('Y-m-d H:00:00');
                    $hours[$hour] = max($hours[$hour] ?? 0, (int) $views);

                    if ($hour > $latestHour) {
                        $latestHour = $hour;
                    }
                }
            }
        } catch (QueryException) {
            $hours = [];
        }

        $handle = fopen('php://temp', 'r+');

        for ($i = 0; $i <= $limit; $i++) {
            $time = Carbon::parse($latestHour, 'Asia/Taipei')
                ->subHours($limit - $i)
                ->format('Y-m-d H:00:00');
            fputcsv($handle, [$time, $hours[$time] ?? null]);
        }

        rewind($handle);
        $csv = stream_get_contents($handle);
        fclose($handle);

        return (string) $csv;
    }

    /**
     * @param array{date: string, from: string|null, to: string|null, is_range: bool} $period
     * @return array{result: array{tag: array{max: array<int, int>, count: array<int, int>}, video: list<array<string, mixed>>, hour: array<string, array<string, int>>}}
     */
    private function deriveLiveDate(array $period): array
    {
        $query = DB::table('urt_video_live_log')
            ->select(['videoId', 'u_id', 'the_date', 'max_current', 'log_json']);

        $this->applyPeriod($query, $period);

        $logs = $query->get();
        $byVideo = [];
        $hour = [];

        foreach ($logs as $log) {
            $videoId = (string) $log->videoId;
            $maxCurrent = (int) ($log->max_current ?? 0);
            $date = substr((string) $log->the_date, 0, 10);

            foreach ($this->hourlyPeaks($log->log_json) as $hourKey => $views) {
                $hour[$hourKey][$videoId] = max($hour[$hourKey][$videoId] ?? 0, $views);
            }

            if (! isset($byVideo[$videoId]) || $maxCurrent > $byVideo[$videoId]['max_current']) {
                $byVideo[$videoId] = [
                    'videoId' => $videoId,
                    'u_id' => (int) ($log->u_id ?? 0),
                    'the_date' => $date,
                    'max_current' => $maxCurrent,
                    'log_json' => $log->log_json,
                ];
            }
        }

        ksort($hour);

        $videoIds = array_keys($byVideo);
        $displayRows = $videoIds === []
            ? collect()
            : DB::table('urt_show_video_live')->whereIn('videoId', $videoIds)->get()->keyBy('videoId');
        $countRows = DB::table('urt_count')->select(['u_id', 'tags'])->get()->keyBy('u_id');

        $tagMax = [];
        $tagCount = [];
        $videos = [];

        foreach ($byVideo as $videoId => $video) {
            $display = $displayRows->get($videoId);
            $displayArray = $display ? (array) $display : [
                'videoId' => $videoId,
                'u_id' => $video['u_id'],
                'title' => $videoId,
                'max_current' => $video['max_current'],
            ];
            $displayArray['max_current'] = $video['max_current'];
            $videos[] = $displayArray;

            $countRow = $countRows->get($video['u_id']);

            foreach ($this->extractTagIds((string) ($countRow->tags ?? '')) as $tagId) {
                $tagMax[$tagId] = ($tagMax[$tagId] ?? 0) + $video['max_current'];
                $tagCount[$tagId] = ($tagCount[$tagId] ?? 0) + 1;
            }
        }

        usort($videos, fn (array $a, array $b): int => ((int) ($b['max_current'] ?? 0)) <=> ((int) ($a['max_current'] ?? 0)));
        ksort($tagMax);
        ksort($tagCount);

        return [
            'result' => [
                'tag' => [
                    'max' => $tagMax,
                    'count' => $tagCount,
                ],
                'video' => $videos,
                'hour' => $hour,
            ],
        ];
    }

    /**
     * @return array{date: string, from: string|null, to: string|null, is_range: bool}
     */
    private function singleOrRangePeriod(Request $request, string $minDate): array
    {
        $today = now('Asia/Taipei')->toDateString();

        if ($request->filled('from')) {
            $from = $this->boundedDate((string) $request->query('from'), $today, $minDate);
            $to = $this->boundedDate((string) $request->query('to', $today), $today, $minDate);

            if ($from > $to) {
                [$from, $to] = [$to, $from];
            }

            return [
                'date' => $to,
                'from' => $from,
                'to' => $to,
                'is_range' => true,
            ];
        }

        $date = $this->boundedDate((string) $request->query('date', $today), $today, $minDate);

        return [
            'date' => $date,
            'from' => null,
            'to' => null,
            'is_range' => false,
        ];
    }

    /**
     * @return array{date: string, from: string|null, to: string|null, is_range: bool}
     */
    private function singleOrRangePeriodWithDefault(Request $request, string $minDate, string $defaultDate): array
    {
        if ($request->filled('from')) {
            return $this->singleOrRangePeriod($request, $minDate);
        }

        $fallback = $this->boundedDate($defaultDate, now('Asia/Taipei')->toDateString(), $minDate);
        $date = $this->boundedDate((string) $request->query('date', $fallback), now('Asia/Taipei')->toDateString(), $minDate);

        return [
            'date' => $date,
            'from' => null,
            'to' => null,
            'is_range' => false,
        ];
    }

    private function boundedDate(string $date, string $fallback, string $minDate): string
    {
        if (! preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
            return $fallback;
        }

        if ($date < $minDate) {
            return $minDate;
        }

        if ($date > $fallback) {
            return $fallback;
        }

        return $date;
    }

    /**
     * @param \Illuminate\Database\Query\Builder $query
     * @param array{date: string, from: string|null, to: string|null, is_range: bool} $period
     */
    private function applyPeriod($query, array $period): void
    {
        if ($period['is_range']) {
            $query->whereBetween('the_date', [$period['from'], $period['to']]);

            return;
        }

        $query->where('the_date', $period['date']);
    }

    private function latestLogDate(string $table): ?string
    {
        try {
            $date = DB::table($table)->max('the_date');
        } catch (QueryException) {
            return null;
        }

        return is_string($date) ? substr($date, 0, 10) : null;
    }

    /**
     * @param array<string, array<string, mixed>> $byVideo
     * @return list<array<string, mixed>>
     */
    private function mergeDisplayRows(array $byVideo): array
    {
        $videoIds = array_keys($byVideo);
        $displayRows = $videoIds === []
            ? collect()
            : DB::table('urt_show_video_live')->whereIn('videoId', $videoIds)->get()->keyBy('videoId');

        return collect($byVideo)
            ->map(function (array $row, string $videoId) use ($displayRows): array {
                $display = $displayRows->get($videoId);
                $displayArray = $display ? (array) $display : [
                    'videoId' => $videoId,
                    'u_id' => $row['u_id'],
                    'title' => $videoId,
                ];

                $displayArray['max_current'] = $row['max_current'];
                $displayArray['live_log'] = $row['live_log'];
                $displayArray['the_date'] = $row['the_date'];

                return $displayArray;
            })
            ->values()
            ->all();
    }

    /**
     * @param list<array<string, mixed>> $rows
     * @param array{date: string, from: string|null, to: string|null, is_range: bool} $period
     * @return array<string, mixed>
     */
    private function liveDateListPayload(array $rows, array $period, bool $available, string $source): array
    {
        return [
            'result' => $rows,
            'time' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
            'date' => $period['date'],
            'from' => $period['from'],
            'to' => $period['to'],
            'count_videos' => count($rows),
            'meta' => [
                'available' => $available && $rows !== [],
                'source' => $source,
                'period' => $period,
                'read_only' => true,
            ],
        ];
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

        return is_array($decoded) ? $decoded : [];
    }

    /**
     * @return array<string, int>
     */
    private function hourlyPeaks(mixed $json): array
    {
        $decoded = $this->decodeMap($json);
        $hours = [];

        foreach ($decoded as $time => $views) {
            $hour = substr((string) $time, 0, 2);

            if (! preg_match('/^\d{2}$/', $hour)) {
                continue;
            }

            $hours[$hour] = max($hours[$hour] ?? 0, (int) $views);
        }

        return $hours;
    }

    /**
     * @return list<int>
     */
    private function extractTagIds(string $tags): array
    {
        preg_match_all('/\[(\d+)\]/', $tags, $matches);

        return collect($matches[1] ?? [])
            ->map(fn (string $tagId): int => (int) $tagId)
            ->filter(fn (int $tagId): bool => $tagId > 0)
            ->unique()
            ->values()
            ->all();
    }

    /**
     * @return array{tagid: list<int>, or: list<int>, not: list<int>, tagid_string: string, or_string: string, not_string: string}
     */
    private function sortedTagFilters(Request $request): array
    {
        $tagid = $this->sortedIntegers($request->query('tagid'));
        $or = $this->sortedIntegers($request->query('or'));
        $not = $this->sortedIntegers($request->query('not'));

        return [
            'tagid' => $tagid,
            'or' => $or,
            'not' => $not,
            'tagid_string' => implode(',', $tagid),
            'or_string' => implode(',', $or),
            'not_string' => implode(',', $not),
        ];
    }

    /**
     * @return list<int>
     */
    private function sortedIntegers(mixed $value): array
    {
        if (is_array($value)) {
            $items = $value;
        } else {
            $items = explode(',', (string) $value);
        }

        $integers = collect($items)
            ->map(fn (mixed $item): int => (int) trim((string) $item))
            ->filter(fn (int $item): bool => $item > 0)
            ->unique()
            ->values()
            ->all();

        sort($integers);

        return $integers;
    }

    /**
     * @param \Illuminate\Database\Query\Builder $query
     */
    private function whereNullableEmptyString($query, string $column, string $value): void
    {
        if ($value !== '') {
            $query->where($column, $value);

            return;
        }

        $query->where(function ($query) use ($column): void {
            $query->where($column, '')
                ->orWhereNull($column);
        });
    }

    /**
     * @param array<string, mixed> $meta
     * @return array<string, mixed>
     */
    private function unavailable(string $source, array $meta = []): array
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
