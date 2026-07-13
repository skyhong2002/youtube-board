<?php

namespace App\Services\Ingestion;

use App\Support\SensitiveTextRedactor;
use Carbon\CarbonImmutable;
use Closure;
use Illuminate\Support\Facades\Log;
use Throwable;

class AiDaysRefreshIngestion
{
    public function __construct(
        private readonly AiDailyPreview $dailyPreview,
        private readonly AiDailyIngestion $dailyIngestion,
        private readonly AiEventIngestion $eventIngestion,
        private readonly AiPeriodIngestion $periodIngestion,
    ) {}

    /**
     * @return array<string, mixed>
     */
    public function preview(
        ?string $from = null,
        ?string $to = null,
        string $condition = 'all',
        int $dailyLimit = 1000,
        int $eventLimit = 100,
        int $periodLimit = 20,
        string $promptTypes = 'summary,people,media',
        bool $skipDaily = false,
        bool $skipEvents = false,
        bool $skipPeriod = false,
    ): array {
        $timezone = (string) config('ingestion.timezone', config('app.timezone', 'Asia/Taipei'));
        $now = CarbonImmutable::now($timezone);
        $dates = $this->dates($from, $to, $now);
        $condition = $this->condition($condition);
        $jobs = [];

        foreach ($dates as $date) {
            if (! $skipDaily) {
                $jobs[] = $this->job(
                    type: 'daily',
                    date: $date,
                    result: $this->dailyPreview->preview(
                        date: $date,
                        condition: $condition,
                        dataType: 'oneday',
                        limit: $dailyLimit,
                        now: $now,
                    ),
                );
            }

            if (! $skipEvents) {
                $jobs[] = $this->job(
                    type: 'event-preview',
                    date: $date,
                    result: $this->eventIngestion->preview(
                        date: $date,
                        condition: $condition,
                        promptTypes: $promptTypes,
                        limit: $eventLimit,
                        missingOnly: true,
                    ),
                );
            }
        }

        if (! $skipPeriod) {
            foreach ($this->adjacentPairs($dates) as $pair) {
                $jobs[] = $this->job(
                    type: 'period',
                    date: $pair['to'],
                    result: $this->periodIngestion->preview(
                        from: $pair['from'],
                        to: $pair['to'],
                        condition: $condition,
                        limit: $periodLimit,
                    ),
                );
            }
        }

        return $this->result(
            mode: 'ingestion-preview',
            condition: $condition,
            dates: $dates,
            jobs: $jobs,
            generatedAt: $now,
            writes: [],
        ) + [
            'api_call_skipped' => 'AI chat completions are intentionally skipped in planning mode',
            'writes_skipped' => [
                'ai:daily aggregate refresh',
                'ai:event missing summary/people/media rows',
                'ai:period adjacent-day event matching',
            ],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function execute(
        ?string $from = null,
        ?string $to = null,
        string $condition = 'all',
        int $dailyLimit = 1000,
        int $dailyChannelLimit = 0,
        int $dailyChannelOffset = 0,
        int $dailyChannelBatchSize = 0,
        int $dailyAiCallLimit = 2,
        int $dailyChannelVideoLimit = 120,
        int $eventLimit = 100,
        int $eventAiCallLimit = 60,
        int $periodLimit = 20,
        int $periodAiCallLimit = 1,
        string $promptTypes = 'summary,people,media',
        string $userToken = 'CLI',
        int $maxEventPasses = 2,
        bool $skipDaily = false,
        bool $skipEvents = false,
        bool $skipPeriod = false,
    ): array {
        $timezone = (string) config('ingestion.timezone', config('app.timezone', 'Asia/Taipei'));
        $now = CarbonImmutable::now($timezone);
        $dates = $this->dates($from, $to, $now);
        $condition = $this->condition($condition);
        $promptTypes = $this->promptTypes($promptTypes);
        $jobs = [];
        $eventCallsRemaining = max(0, $eventAiCallLimit);

        foreach ($dates as $date) {
            if ($skipDaily) {
                $jobs[] = $this->skippedJob('daily', $date, 'skip_daily_requested');
            } else {
                $dailyResult = $this->safeResult(
                    type: 'daily',
                    date: $date,
                    callback: fn (): array => $this->dailyIngestion->execute(
                        date: $date,
                        condition: $condition,
                        dataType: 'oneday',
                        limit: $dailyLimit,
                        channelLimit: $dailyChannelLimit,
                        channelOffset: $dailyChannelOffset,
                        channelBatchSize: $dailyChannelBatchSize,
                        aiCallLimit: $dailyAiCallLimit,
                        channelVideoLimit: $dailyChannelVideoLimit,
                        userToken: $userToken,
                    ),
                );
                $jobs[] = $this->job(
                    type: 'daily',
                    date: $date,
                    result: $dailyResult,
                );
            }
        }

        foreach ($dates as $date) {
            if ($skipEvents) {
                $jobs[] = $this->skippedJob('event', $date, 'skip_events_requested');

                continue;
            }

            for ($pass = 1; $pass <= max(1, min(5, $maxEventPasses)); $pass++) {
                $preview = $this->safeResult(
                    type: 'event-preview',
                    date: $date,
                    callback: fn (): array => $this->eventIngestion->preview(
                        date: $date,
                        condition: $condition,
                        promptTypes: implode(',', $promptTypes),
                        limit: $eventLimit,
                        missingOnly: true,
                    ),
                );
                $jobs[] = $this->job('event-preview', $date, $preview, ['pass' => $pass]);
                $groups = $this->missingEventGroups($preview);

                if ($groups === []) {
                    break;
                }

                if ($eventCallsRemaining <= 0) {
                    $jobs[] = $this->skippedJob('event', $date, 'event_ai_call_guard_exhausted', ['pass' => $pass]);

                    break;
                }

                $insertedBeforePass = $this->eventInsertedCount($jobs);

                foreach ($groups as $group) {
                    if ($eventCallsRemaining <= 0) {
                        $jobs[] = $this->skippedJob(
                            type: 'event',
                            date: $date,
                            reason: 'event_ai_call_guard_exhausted',
                            meta: ['pass' => $pass, 'event' => $group['event']],
                        );

                        break;
                    }

                    $callLimit = min($eventCallsRemaining, count($group['prompt_types']));
                    $result = $this->safeResult(
                        type: 'event',
                        date: $date,
                        callback: fn (): array => $this->eventIngestion->execute(
                            date: $date,
                            condition: $condition,
                            event: $group['event'],
                            promptTypes: implode(',', $group['prompt_types']),
                            limit: $eventLimit,
                            aiCallLimit: $callLimit,
                            missingOnly: true,
                            userToken: $userToken,
                        ),
                    );
                    $eventCallsRemaining -= (int) data_get($result, 'ai_call_guard.used', 0);
                    $jobs[] = $this->job('event', $date, $result, ['pass' => $pass, 'event' => $group['event']]);
                }

                if ($this->eventInsertedCount($jobs) === $insertedBeforePass) {
                    break;
                }
            }
        }

        if ($skipPeriod) {
            foreach ($this->adjacentPairs($dates) as $pair) {
                $jobs[] = $this->skippedJob('period', $pair['to'], 'skip_period_requested', $pair);
            }
        } else {
            foreach ($this->adjacentPairs($dates) as $pair) {
                $periodResult = $this->safeResult(
                    type: 'period',
                    date: $pair['to'],
                    callback: fn (): array => $this->periodIngestion->execute(
                        from: $pair['from'],
                        to: $pair['to'],
                        condition: $condition,
                        limit: $periodLimit,
                        aiCallLimit: $periodAiCallLimit,
                        userToken: $userToken,
                    ),
                );
                $jobs[] = $this->job(
                    type: 'period',
                    date: $pair['to'],
                    result: $periodResult,
                    meta: $pair,
                );
            }
        }

        if (! $skipEvents) {
            foreach ($dates as $date) {
                $verifyResult = $this->safeResult(
                    type: 'event-verify',
                    date: $date,
                    callback: fn (): array => $this->eventIngestion->preview(
                        date: $date,
                        condition: $condition,
                        promptTypes: implode(',', $promptTypes),
                        limit: $eventLimit,
                        missingOnly: true,
                    ),
                );
                $jobs[] = $this->job(
                    type: 'event-verify',
                    date: $date,
                    result: $verifyResult,
                );
            }
        }

        return $this->result(
            mode: 'execute',
            condition: $condition,
            dates: $dates,
            jobs: $jobs,
            generatedAt: $now,
            writes: ['urt_channel_ai', 'urt_ai_date', 'urt_ai_event', 'urt_ai_period'],
        ) + [
            'ai_call_guard' => [
                'event_limit' => max(0, $eventAiCallLimit),
                'event_used' => max(0, $eventAiCallLimit) - $eventCallsRemaining,
                'event_remaining' => $eventCallsRemaining,
                'daily_limit_per_day' => max(0, $dailyAiCallLimit),
                'period_limit_per_pair' => max(0, $periodAiCallLimit),
            ],
            'secrets' => 'not_printed',
        ];
    }

    /**
     * @param  list<string>  $dates
     * @param  list<array<string, mixed>>  $jobs
     * @return array<string, mixed>
     */
    private function result(string $mode, string $condition, array $dates, array $jobs, CarbonImmutable $generatedAt, array $writes): array
    {
        $failedRows = collect($jobs)->sum(function (array $job): int {
            $reported = data_get($job, 'result.failed_rows');

            return is_numeric($reported)
                ? max(0, (int) $reported)
                : ((int) data_get($job, 'result.exit_code', 0) !== 0 ? 1 : 0);
        });

        return [
            'mode' => $mode,
            'status' => $failedRows > 0 ? 'partial_failure' : 'success',
            'exit_code' => $failedRows > 0 ? 1 : 0,
            'failed_rows' => $failedRows,
            'source' => 'ai_days_refresh',
            'condition' => $condition,
            'from_date' => $dates[0] ?? null,
            'to_date' => $dates[array_key_last($dates)] ?? null,
            'dates' => $dates,
            'date_count' => count($dates),
            'jobs' => $jobs,
            'summary' => $this->summary($jobs),
            'write_targets' => array_values(array_unique($writes)),
            'generated_at' => $generatedAt->format('Y-m-d H:i:s'),
        ];
    }

    /**
     * @param  list<array<string, mixed>>  $jobs
     * @return array<string, mixed>
     */
    private function summary(array $jobs): array
    {
        return [
            'jobs' => count($jobs),
            'failed_jobs' => collect($jobs)->filter(fn (array $job): bool => (int) data_get($job, 'result.exit_code', 0) !== 0)->count(),
            'failed_rows' => collect($jobs)->sum(fn (array $job): int => max(0, (int) data_get($job, 'result.failed_rows', 0))),
            'daily_jobs' => collect($jobs)->where('type', 'daily')->count(),
            'event_jobs' => collect($jobs)->whereIn('type', ['event-preview', 'event', 'event-verify'])->count(),
            'period_jobs' => collect($jobs)->where('type', 'period')->count(),
            'event_rows_inserted' => collect($jobs)->sum(fn (array $job): int => (int) data_get($job, 'result.event_ai.inserted', 0)),
            'event_rows_updated' => collect($jobs)->sum(fn (array $job): int => (int) data_get($job, 'result.event_ai.updated', 0)),
            'event_rows_skipped' => collect($jobs)->sum(fn (array $job): int => (int) data_get($job, 'result.event_ai.skipped', 0)),
            'event_missing_after' => collect($jobs)
                ->where('type', 'event-verify')
                ->sum(fn (array $job): int => (int) data_get($job, 'result.would_call_ai_requests', 0)),
            'period_rows_inserted' => collect($jobs)->sum(fn (array $job): int => data_get($job, 'result.period_ai.inserted') === true ? 1 : 0),
            'period_rows_updated' => collect($jobs)->sum(fn (array $job): int => data_get($job, 'result.period_ai.updated') === true ? 1 : 0),
            'period_rows_skipped' => collect($jobs)->sum(fn (array $job): int => data_get($job, 'result.period_ai.skipped') === true ? 1 : 0),
            'daily_ai_inserted' => collect($jobs)->sum(fn (array $job): int => (int) data_get($job, 'result.daily_ai.inserted', 0)),
            'daily_ai_updated' => collect($jobs)->sum(fn (array $job): int => (int) data_get($job, 'result.daily_ai.updated', 0)),
            'daily_ai_skipped' => collect($jobs)->sum(fn (array $job): int => (int) data_get($job, 'result.daily_ai.skipped', 0)),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function job(string $type, string $date, array $result, array $meta = []): array
    {
        return [
            'type' => $type,
            'date' => $date,
            'action' => (int) ($result['exit_code'] ?? 0) !== 0 ? 'failed' : 'run',
            'meta' => $meta,
            'result' => $result,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function skippedJob(string $type, string $date, string $reason, array $meta = []): array
    {
        return [
            'type' => $type,
            'date' => $date,
            'action' => 'skip',
            'meta' => $meta,
            'result' => [
                'mode' => 'skip',
                'source' => 'ai_days_refresh',
                'skipped' => true,
                'skip_reason' => $reason,
            ],
        ];
    }

    /**
     * @param  Closure(): array<string, mixed>  $callback
     * @return array<string, mixed>
     */
    private function safeResult(string $type, string $date, Closure $callback): array
    {
        try {
            return $callback();
        } catch (Throwable $exception) {
            Log::warning('AI days refresh child job failed.', [
                'type' => $type,
                'date' => $date,
                'exception_class' => $exception::class,
            ]);

            return [
                'mode' => 'execute',
                'source' => 'ai_days_refresh',
                'status' => 'failed',
                'exit_code' => 1,
                'failed_rows' => 1,
                'failed' => true,
                'skipped' => true,
                'skip_reason' => SensitiveTextRedactor::exception($exception, 240),
                'writes' => [],
                'secrets' => 'not_printed',
            ];
        }
    }

    /**
     * @param  array<string, mixed>  $preview
     * @return list<array{event: string, prompt_types: list<string>}>
     */
    private function missingEventGroups(array $preview): array
    {
        return collect($preview['rows'] ?? [])
            ->filter(fn (mixed $row): bool => is_array($row) && ! ($row['skipped'] ?? false))
            ->groupBy(fn (array $row): string => (string) ($row['event'] ?? ''))
            ->map(function ($rows, string $event): array {
                return [
                    'event' => $event,
                    'prompt_types' => collect($rows)
                        ->pluck('prompt_type')
                        ->filter(fn (mixed $type): bool => is_string($type) && $type !== '')
                        ->unique()
                        ->values()
                        ->all(),
                ];
            })
            ->filter(fn (array $group): bool => $group['event'] !== '' && $group['prompt_types'] !== [])
            ->values()
            ->all();
    }

    /**
     * @param  list<array<string, mixed>>  $jobs
     */
    private function eventInsertedCount(array $jobs): int
    {
        return collect($jobs)->sum(fn (array $job): int => (int) data_get($job, 'result.event_ai.inserted', 0));
    }

    /**
     * @return list<array{from: string, to: string}>
     */
    private function adjacentPairs(array $dates): array
    {
        $pairs = [];

        for ($index = 1; $index < count($dates); $index++) {
            $pairs[] = ['from' => $dates[$index - 1], 'to' => $dates[$index]];
        }

        return $pairs;
    }

    /**
     * @return list<string>
     */
    private function dates(?string $from, ?string $to, CarbonImmutable $now): array
    {
        $fromDate = $this->dateString($from) ?? $now->subDay()->toDateString();
        $toDate = $this->dateString($to) ?? $fromDate;

        if ($fromDate > $toDate) {
            [$fromDate, $toDate] = [$toDate, $fromDate];
        }

        $cursor = CarbonImmutable::parse($fromDate, $now->getTimezone());
        $end = CarbonImmutable::parse($toDate, $now->getTimezone());
        $dates = [];

        while ($cursor->lessThanOrEqualTo($end) && count($dates) < 31) {
            $dates[] = $cursor->toDateString();
            $cursor = $cursor->addDay();
        }

        return $dates;
    }

    private function dateString(?string $date): ?string
    {
        return is_string($date) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) ? $date : null;
    }

    private function condition(string $condition): string
    {
        $condition = trim($condition) !== '' ? trim($condition) : 'all';

        return preg_match('/^[A-Za-z0-9_-]{1,40}$/', $condition) ? $condition : 'all';
    }

    /**
     * @return list<string>
     */
    private function promptTypes(string $promptTypes): array
    {
        $types = collect(explode(',', $promptTypes))
            ->map(fn (string $type): string => trim($type))
            ->filter(fn (string $type): bool => in_array($type, ['summary', 'people', 'media'], true))
            ->unique()
            ->values()
            ->all();

        return $types === [] ? ['summary', 'people', 'media'] : $types;
    }
}
