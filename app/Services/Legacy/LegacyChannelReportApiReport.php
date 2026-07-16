<?php

namespace App\Services\Legacy;

use Carbon\CarbonImmutable;
use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use stdClass;

class LegacyChannelReportApiReport
{
    /**
     * @return array<string, mixed>
     */
    public function channelLog(Request $request): array
    {
        $uId = max(1, (int) $request->query('u_id', 2));
        $limit = max(1, min(1095, (int) $request->query('limit', 365)));
        $series = $this->buildSeries($uId, $limit, monthsLimit: null);

        return [
            'result' => $series['result'] === [] ? new stdClass : $series['result'],
            'meta' => [
                'available' => $series['log_rows'] > 0,
                'source' => 'urt_log.thedata',
                'u_id' => $uId,
                'limit' => $limit,
                'log_rows' => $series['log_rows'],
                'channel' => $this->channel($uId),
                'realtime_dashboard' => true,
                'blocked_reason' => $series['log_rows'] === 0 ? 'local urt_log has no rows for this channel' : null,
            ],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function channelPrediction(Request $request): array
    {
        $uId = max(1, (int) $request->query('u_id', 2));
        $limit = max(1, min(365, (int) $request->query('limit', 60)));
        $prediction = $this->predictionForChannel($uId, $limit);

        return [
            'result' => $prediction['result'] === [] ? new stdClass : $prediction['result'],
            'summary' => $prediction['summary'],
            'meta' => [
                'available' => $prediction['valid_points'] > 0,
                'source' => 'urt_log.thedata',
                'u_id' => $uId,
                'limit' => $limit,
                'months_limit' => $prediction['months_limit'],
                'log_rows' => $prediction['log_rows'],
                'invalid_log_rows' => $prediction['invalid_log_rows'],
                'channel' => $this->channel($uId),
                'realtime_dashboard' => true,
                'writeback_skipped' => 'run reports:channel-predictions:build --execute for reviewed urt_count prediction writeback',
                'blocked_reason' => $prediction['valid_points'] === 0 ? 'local urt_log has no usable rows for this channel' : null,
            ],
        ];
    }

    /**
     * @return array{
     *     result: array<string, array{videos: int, orig: int, pred: int, moving: int}>,
     *     summary: array{views_pred_week: int, views_pred_month: int},
     *     log_rows: int,
     *     invalid_log_rows: int,
     *     valid_points: int,
     *     months_limit: int
     * }
     */
    public function predictionForChannel(int $uId, int $limit = 60, int $monthsLimit = 4): array
    {
        $uId = max(1, $uId);
        $limit = max(1, min(365, $limit));
        $monthsLimit = max(1, min(12, $monthsLimit));
        $series = $this->buildSeries($uId, $limit, $monthsLimit);

        return $series + [
            'summary' => $this->predictionSummary($series['result']),
            'months_limit' => $monthsLimit,
        ];
    }

    /**
     * @return array{
     *     result: array<string, array{videos: int, orig: int, pred: int, moving: int}>,
     *     log_rows: int,
     *     invalid_log_rows: int,
     *     valid_points: int
     * }
     */
    private function buildSeries(int $uId, int $limit, ?int $monthsLimit): array
    {
        try {
            $query = DB::table('urt_log')->where('u_id', $uId);

            if ($monthsLimit !== null) {
                $query->orderByDesc('pk')->limit($monthsLimit);
            } else {
                $query->orderBy('themonth');
            }

            $rows = $query->get();
        } catch (QueryException) {
            return ['result' => [], 'log_rows' => 0, 'invalid_log_rows' => 0, 'valid_points' => 0];
        }

        $dates = [];
        $invalidLogRows = 0;

        foreach ($rows as $row) {
            $raw = $row->thedata ?? null;
            $decoded = $this->decodeMap($raw);

            if ($decoded === [] && is_string($raw) && trim($raw) !== '' && trim($raw) !== 'null' && json_last_error() !== JSON_ERROR_NONE) {
                $invalidLogRows++;

                continue;
            }

            foreach ($decoded as $date => $value) {
                if (is_array($value) && preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) $date)) {
                    $dates[(string) $date] = [
                        'view' => isset($value['view']) || isset($value['total_views'])
                            ? (int) ($value['view'] ?? $value['total_views'])
                            : null,
                        'video' => isset($value['video']) || isset($value['videos'])
                            ? (int) ($value['video'] ?? $value['videos'])
                            : null,
                    ];
                }
            }
        }

        ksort($dates);
        $today = CarbonImmutable::now('Asia/Taipei')->startOfDay();
        $pred = $this->dailyPredictions($dates, $today, $limit);
        $moving = $this->movingAverage($pred, $today, $limit);
        $result = [];

        for ($i = $limit; $i >= 0; $i--) {
            $date = $today->subDays($i)->toDateString();
            $yesterday = $today->subDays($i + 1)->toDateString();
            $result[$date] = [
                'videos' => isset($dates[$date]['video'], $dates[$yesterday]['video'])
                    ? $dates[$date]['video'] - $dates[$yesterday]['video']
                    : 0,
                'orig' => isset($dates[$date]['view'], $dates[$yesterday]['view'])
                    ? $dates[$date]['view'] - $dates[$yesterday]['view']
                    : 0,
                'pred' => (int) ($pred[$date] ?? 0),
                'moving' => (int) ($moving[$date] ?? 0),
            ];
        }

        return [
            'result' => $result,
            'log_rows' => $rows->count(),
            'invalid_log_rows' => $invalidLogRows,
            'valid_points' => count($dates),
        ];
    }

    /**
     * @param  array<string, array{view: int|null, video: int|null}>  $dates
     * @return array<string, int>
     */
    private function dailyPredictions(array $dates, CarbonImmutable $today, int $limit): array
    {
        $pred = [];
        $weekSum = [];
        $weekCount = [];
        $weekData = [];

        for ($i = $limit + 30; $i >= 0; $i--) {
            $date = $today->subDays($i)->toDateString();
            $yesterday = $today->subDays($i + 1)->toDateString();
            $twoDaysBack = $today->subDays($i + 2)->toDateString();
            $value = ($dates[$date]['view'] ?? 0) - ($dates[$yesterday]['view'] ?? 0);
            $bad = $value < 0
                || $value > 10_000_000
                || ($dates[$yesterday]['view'] ?? 0) === 0
                || ($dates[$yesterday]['view'] ?? 0) === ($dates[$twoDaysBack]['view'] ?? 0)
                || ($dates[$twoDaysBack]['view'] ?? 0) === 0;

            if (! $bad) {
                $pred[$date] = $value;
            }
        }

        for ($i = $limit + 30; $i >= 0; $i--) {
            $day = $today->subDays($i);
            $date = $day->toDateString();

            if (($pred[$date] ?? 0) <= 0) {
                continue;
            }

            $week = $day->format('W');
            $weekday = (int) $day->format('w');
            $weekSum[$week] = ($weekSum[$week] ?? 0) + $pred[$date];
            $weekCount[$week] = ($weekCount[$week] ?? 0) + 1;
            $weekData[$week][$weekday] = $pred[$date];
        }

        $medianRatio = $this->weekdayMedianRatios($weekSum, $weekCount, $weekData, $today);

        if (array_sum($medianRatio) <= 0) {
            return $pred;
        }

        for ($i = $limit + 14; $i >= 0; $i--) {
            $day = $today->subDays($i);
            $date = $day->toDateString();

            if (($pred[$date] ?? 0) > 0) {
                continue;
            }

            $week = $day->format('W');
            $weekday = (int) $day->format('w');
            $knownDays = $weekData[$week] ?? [];
            $knownMedian = collect(array_keys($knownDays))->sum(fn (int|string $key): float => $medianRatio[(int) $key] ?? 0.0);
            $knownSum = array_sum($knownDays);
            $pred[$date] = $knownMedian > 0
                ? (int) ($knownSum / $knownMedian * ($medianRatio[$weekday] ?? 0.0))
                : 0;
        }

        return $pred;
    }

    /**
     * @param  array<string, int|float>  $weekSum
     * @param  array<string, int>  $weekCount
     * @param  array<string, array<int, int>>  $weekData
     * @return array<int, float>
     */
    private function weekdayMedianRatios(array $weekSum, array $weekCount, array $weekData, CarbonImmutable $today): array
    {
        $series = array_fill(0, 7, []);

        for ($i = 1; $i <= 12; $i++) {
            $week = $today->subWeeks($i)->format('W');

            if (($weekCount[$week] ?? 0) !== 7 || ($weekSum[$week] ?? 0) <= 0) {
                continue;
            }

            for ($weekday = 0; $weekday <= 6; $weekday++) {
                $series[$weekday][] = (float) sprintf(
                    '%.4f',
                    ($weekData[$week][$weekday] ?? 0) / $weekSum[$week],
                );
            }
        }

        $ratios = [];

        for ($weekday = 0; $weekday <= 6; $weekday++) {
            $ratios[$weekday] = $this->median($series[$weekday]);
        }

        $sum = array_sum($ratios);

        if ($sum <= 0) {
            return array_fill(0, 7, 0.0);
        }

        return collect($ratios)
            ->map(fn (float $ratio): float => $ratio / $sum)
            ->all();
    }

    /**
     * @param  list<int|float>  $values
     */
    private function median(array $values): float
    {
        $values = array_values($values);
        sort($values);
        $count = count($values);

        if ($count === 0) {
            return 0.0;
        }

        $middle = intdiv($count - 1, 2);

        if ($count % 2 === 1) {
            return (float) $values[$middle];
        }

        return ((float) $values[$middle] + (float) $values[$middle + 1]) / 2;
    }

    /**
     * @param  array<string, int>  $pred
     * @return array<string, int>
     */
    private function movingAverage(array $pred, CarbonImmutable $today, int $limit): array
    {
        $moving = [];

        for ($i = $limit + 14; $i >= 0; $i--) {
            $date = $today->subDays($i)->toDateString();
            $total = 0;

            for ($j = 0; $j <= 6; $j++) {
                $total += (int) ($pred[$today->subDays($i + $j)->toDateString()] ?? 0);
            }

            $moving[$date] = (int) ceil($total / 7);
        }

        return $moving;
    }

    /**
     * @param  array<string, array{videos: int, orig: int, pred: int, moving: int}>  $result
     * @return array{views_pred_week: int, views_pred_month: int}
     */
    private function predictionSummary(array $result): array
    {
        $rows = array_reverse(array_values($result));

        return [
            'views_pred_week' => collect(array_slice($rows, 0, 7))->sum('pred'),
            'views_pred_month' => collect(array_slice($rows, 0, 29))->sum('pred'),
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
            'title' => $row->title ?? null,
            'youtube_id' => $row->youtube_id ?? null,
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
}
