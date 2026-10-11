<?php

namespace App\Services\Ingestion;

use App\Services\Legacy\MayorReport;
use App\Support\AiDailyContract;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Throwable;

class IngestionHealthCheck
{
    private const DAILY_CONDITIONS = ['all', 'green', 'blue', 'neutral', 'finance', 'world'];

    private const YOUTUBE_SLOW_MS = 3000;

    private const AI_SLOW_MS = 180000;

    public function __construct(
        private readonly IngestionJobRegistry $registry,
        private readonly IngestionRunHistory $history,
        private readonly MayorReport $mayorReport,
        private readonly YoutubeQuotaBudgetLedger $quotaLedger,
        private readonly AiJsonPayloadValidator $jsonValidator,
    ) {}

    /**
     * @return array<string, mixed>
     */
    public function check(?string $date = null, ?CarbonInterface $now = null): array
    {
        $timezone = (string) config('ingestion.timezone', config('app.timezone', 'Asia/Taipei'));
        $now = $now === null
            ? CarbonImmutable::now($timezone)
            : CarbonImmutable::instance($now->toDateTimeImmutable())->setTimezone($timezone);
        $targetDate = $this->targetDate($date, $now);
        $records = $this->history->latest(500);
        $events = $this->events($records, $now);
        unset($records);
        $scheduler = $this->history->externalSchedulerActivity(now: $now);
        $youtube = $this->youtubeHealth($events['youtube_requests'], $now);
        $ai = $this->aiHealth($events['ai_requests'], $now);
        $processing = $this->processingHealth($events['jobs']);
        $targets = [
            'ai_daily' => $this->aiDailyCompleteness($targetDate),
            'mayor_person' => $this->mayorPersonCompleteness($targetDate),
        ];
        $status = $this->worstStatus([
            $scheduler['active'] ? 'ok' : 'warn',
            $youtube['status'],
            $ai['status'],
            $processing['status'],
            $targets['ai_daily']['status'],
            $targets['mayor_person']['status'],
        ]);

        return [
            'status' => $status,
            'generated_at' => $now->toDateTimeString().' '.$timezone,
            'target_date' => $targetDate,
            'scheduler' => [
                'status' => $scheduler['active'] ? 'ok' : 'warn',
                'active' => $scheduler['active'],
                'latest_created_at' => $scheduler['latest_created_at'],
                'latest_age_seconds' => $scheduler['latest_age_seconds'],
                'window_minutes' => $scheduler['window_minutes'],
            ],
            'youtube' => $youtube,
            'ai' => $ai,
            'processing' => $processing,
            'targets' => $targets,
            'recommendations' => $this->recommendations($status, $scheduler['active'], $youtube, $ai, $targets),
        ];
    }

    private function targetDate(?string $date, CarbonImmutable $now): string
    {
        if (is_string($date) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
            return $date;
        }

        return $now->subDay()->toDateString();
    }

    /**
     * @param  list<array<string, mixed>>  $records
     * @return array{jobs: list<array<string, mixed>>, youtube_requests: list<array<string, mixed>>, ai_requests: list<array<string, mixed>>}
     */
    private function events(array $records, CarbonImmutable $now): array
    {
        $jobs = [];
        $youtubeRequests = [];
        $aiRequests = [];

        foreach ($records as $record) {
            if (! is_array($record)) {
                continue;
            }

            $recordCreatedAt = $this->createdAt($record, $now);
            $recordMeta = [
                'record_id' => $record['id'] ?? null,
                'record_created_at' => $recordCreatedAt !== null
                    ? $recordCreatedAt->toDateTimeString().' '.$recordCreatedAt->getTimezone()->getName()
                    : null,
                'record_age_seconds' => $recordCreatedAt?->diffInSeconds($now),
            ];

            $recordJobs = data_get($record, 'result.jobs');

            foreach (is_array($recordJobs) ? $recordJobs : [] as $job) {
                if (! is_array($job)) {
                    continue;
                }

                $jobKey = is_string($job['key'] ?? null) ? $job['key'] : 'unknown';
                $jobs[] = [
                    'key' => $jobKey,
                    'failed' => ($job['failed'] ?? false) === true,
                    'action' => is_string($job['action'] ?? null) ? $job['action'] : null,
                    'exit_code' => is_numeric($job['exit_code'] ?? null) ? (int) $job['exit_code'] : null,
                    'runtime_ms' => is_numeric($job['runtime_ms'] ?? null) ? (int) $job['runtime_ms'] : null,
                    'started_at' => is_string($job['started_at'] ?? null) ? $job['started_at'] : null,
                    'finished_at' => is_string($job['finished_at'] ?? null) ? $job['finished_at'] : null,
                ] + $recordMeta;

                $jobYoutubeRequests = data_get($job, 'telemetry.youtube_requests');

                foreach (is_array($jobYoutubeRequests) ? $jobYoutubeRequests : [] as $event) {
                    if (is_array($event)) {
                        $youtubeRequests[] = ['job_key' => $jobKey] + $event + $recordMeta;
                    }
                }

                $jobAiRequests = data_get($job, 'telemetry.ai_requests');

                foreach (is_array($jobAiRequests) ? $jobAiRequests : [] as $event) {
                    if (is_array($event)) {
                        $aiRequests[] = ['job_key' => $jobKey] + $event + $recordMeta;
                    }
                }
            }
        }

        return [
            'jobs' => $jobs,
            'youtube_requests' => $youtubeRequests,
            'ai_requests' => $aiRequests,
        ];
    }

    /**
     * @param  list<array<string, mixed>>  $events
     * @return array<string, mixed>
     */
    private function youtubeHealth(array $events, CarbonImmutable $now): array
    {
        $budget = max(0, (int) config('ingestion.youtube_daily_quota_budget', 9000));
        $quota = $this->quotaLedger->state($budget, $now);
        $quotaUnavailable = ! (bool) ($quota['available'] ?? false);

        if ((bool) ($quota['available'] ?? false)) {
            $quota['estimated_units'] = (int) ($quota['projected_units'] ?? 0);
            $quota['daily_limit'] = $budget;
            $quota['percent_used'] = $budget > 0
                ? round(((int) $quota['estimated_units'] / $budget) * 100, 1)
                : 0.0;
        } else {
            $quota = $this->history->youtubeQuotaDailyEstimate($now) + [
                'available' => false,
                'reason' => $quota['reason'] ?? 'quota_ledger_unavailable',
            ];
        }
        $failed = collect($events)->filter(fn (array $event): bool => ($event['ok'] ?? true) !== true);
        $hardFailed = $failed->filter(fn (array $event): bool => $this->isHardYoutubeFailure($event));
        $slow = collect($events)->filter(fn (array $event): bool => (int) ($event['latency_ms'] ?? 0) >= self::YOUTUBE_SLOW_MS);
        $quotaPercent = (float) ($quota['percent_used'] ?? 0);
        $status = 'ok';

        if ($quotaUnavailable || $hardFailed->isNotEmpty() || $quotaPercent >= 95) {
            $status = 'fail';
        } elseif ($failed->isNotEmpty() || $slow->isNotEmpty() || $quotaPercent >= 80) {
            $status = 'warn';
        }

        if ((bool) ($quota['google_quota_exhausted'] ?? false)) {
            $status = $status === 'fail' ? 'fail' : 'warn';

            if ((int) ($quota['google_exhausted_units'] ?? 0) < $budget) {
                $quota['warning'] = 'Google reported the daily quota exhausted while the local ledger was below budget: '
                    .'the GCP project quota is being consumed outside this app, or its cap is lower than configured.';
            }
        }

        return [
            'status' => $status,
            'requests' => count($events),
            'failed_requests' => $failed->count(),
            'slow_requests' => $slow->count(),
            'slow_threshold_ms' => self::YOUTUBE_SLOW_MS,
            'total_latency_ms' => $this->sumLatency($events),
            'max_latency_ms' => $this->maxLatency($events),
            'by_method' => $this->groupLatency($events, 'method'),
            'by_job' => $this->groupLatency($events, 'job_key'),
            'quota' => $quota,
        ];
    }

    private function isHardYoutubeFailure(array $event): bool
    {
        $status = (int) ($event['status'] ?? 0);
        $error = strtolower((string) ($event['error'] ?? ''));

        if (($event['quota_or_rate_limit_retry'] ?? false) === true) {
            return true;
        }

        if ($status === 0 || $status >= 500 || in_array($status, [401, 403, 429], true)) {
            return true;
        }

        return $status === 400 && str_contains($error, 'api key');
    }

    /**
     * @param  list<array<string, mixed>>  $events
     * @return array<string, mixed>
     */
    private function aiHealth(array $events, CarbonImmutable $now): array
    {
        $usage = $this->history->aiProviderUsageDailyEstimate($now);
        $failed = collect($events)->filter(fn (array $event): bool => ($event['ok'] ?? true) !== true);
        $slow = collect($events)->filter(fn (array $event): bool => (int) ($event['latency_ms'] ?? 0) >= self::AI_SLOW_MS);
        $status = $failed->isNotEmpty() ? 'warn' : ($slow->isNotEmpty() ? 'warn' : 'ok');

        return [
            'status' => $status,
            'requests' => count($events),
            'failed_requests' => $failed->count(),
            'slow_requests' => $slow->count(),
            'slow_threshold_ms' => self::AI_SLOW_MS,
            'total_latency_ms' => $this->sumLatency($events),
            'max_latency_ms' => $this->maxLatency($events),
            'by_provider' => $this->groupLatency($events, 'provider'),
            'by_job' => $this->groupLatency($events, 'job_key'),
            'usage' => $usage,
        ];
    }

    /**
     * @param  list<array<string, mixed>>  $jobEvents
     * @return array<string, mixed>
     */
    private function processingHealth(array $jobEvents): array
    {
        $latestByJob = [];

        foreach ($jobEvents as $event) {
            $key = (string) ($event['key'] ?? '');

            if ($key !== '' && ! isset($latestByJob[$key])) {
                $latestByJob[$key] = $event;
            }
        }

        $rows = $this->registry->jobs()
            ->filter(fn (array $job): bool => ($job['status'] ?? null) === 'active')
            ->map(function (array $job) use ($latestByJob): array {
                $key = (string) ($job['key'] ?? '');
                $latest = $latestByJob[$key] ?? null;
                $runtimeMs = is_array($latest) && isset($latest['runtime_ms']) ? (int) $latest['runtime_ms'] : null;
                $lastFailed = is_array($latest) && (($latest['failed'] ?? false) === true);
                $status = 'ok';

                if ($lastFailed) {
                    $status = 'fail';
                } elseif ($latest === null && ! empty($job['scheduled_execute_command'])) {
                    $status = 'warn';
                } elseif ($runtimeMs !== null && $runtimeMs >= $this->slowRuntimeMs($key)) {
                    $status = 'warn';
                }

                return [
                    'key' => $key,
                    'workload' => $job['workload'] ?? null,
                    'scheduled' => ! empty($job['scheduled_execute_command']),
                    'status' => $status,
                    'last_action' => is_array($latest) ? ($latest['action'] ?? null) : null,
                    'last_exit_code' => is_array($latest) ? ($latest['exit_code'] ?? null) : null,
                    'last_runtime_ms' => $runtimeMs,
                    'slow_runtime_ms' => $this->slowRuntimeMs($key),
                    'last_started_at' => is_array($latest) ? ($latest['started_at'] ?? null) : null,
                    'last_finished_at' => is_array($latest) ? ($latest['finished_at'] ?? null) : null,
                    'last_record_id' => is_array($latest) ? ($latest['record_id'] ?? null) : null,
                    'last_record_created_at' => is_array($latest) ? ($latest['record_created_at'] ?? null) : null,
                ];
            })
            ->values()
            ->all();

        return [
            'status' => $this->worstStatus(array_column($rows, 'status')),
            'jobs' => $rows,
            'scheduled_jobs' => collect($rows)->where('scheduled', true)->count(),
            'missing_runtime_jobs' => collect($rows)
                ->filter(fn (array $row): bool => $row['scheduled'] && $row['last_runtime_ms'] === null)
                ->count(),
            'failed_jobs' => collect($rows)->where('status', 'fail')->count(),
            'slow_jobs' => collect($rows)
                ->filter(fn (array $row): bool => $row['last_runtime_ms'] !== null && $row['last_runtime_ms'] >= $row['slow_runtime_ms'])
                ->count(),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function aiDailyCompleteness(string $date): array
    {
        try {
            if (! Schema::hasTable('urt_ai_date')) {
                return $this->unknownAiDaily($date, 'urt_ai_date table is missing');
            }

            $aiDateColumns = ['pk', 'condition_type'];

            if (Schema::hasColumn('urt_ai_date', 'mtime')) {
                $aiDateColumns[] = 'mtime';
            }

            $hasResultJson = Schema::hasColumn('urt_ai_date', 'result_json');

            if ($hasResultJson) {
                $aiDateColumns[] = 'result_json';
            }

            $rows = DB::table('urt_ai_date')
                ->when(Schema::hasColumn('urt_ai_date', 'del_flag'), fn ($query) => $query->whereNull('del_flag'))
                ->where('date_from', $date.' 00:00:00')
                ->where('date_to', $date.' 23:59:59')
                ->when(Schema::hasColumn('urt_ai_date', 'data_type'), fn ($query) => $query->where('data_type', 'oneday'))
                ->orderByDesc('pk')
                ->get($aiDateColumns)
                ->unique(fn (object $row): string => $this->normalizeCondition($row->condition_type ?? null))
                ->values();
        } catch (Throwable) {
            return $this->unknownAiDaily($date, 'database unavailable while checking AI daily completeness');
        }

        $validRows = $hasResultJson
            ? $rows->filter(function (object $row): bool {
                $condition = $this->normalizeCondition($row->condition_type ?? null);
                $bounds = AiDailyContract::bounds($condition);

                return $this->jsonValidator->validateEventList(
                    (string) ($row->result_json ?? ''),
                    'daily',
                    expectedMinItems: $bounds['min'],
                    expectedMaxItems: $bounds['max'],
                )['valid'];
            })
            : $rows;
        $completed = $validRows
            ->map(fn (object $row): string => $this->normalizeCondition($row->condition_type ?? null))
            ->unique()
            ->intersect(self::DAILY_CONDITIONS)
            ->values()
            ->all();
        $missing = array_values(array_diff(self::DAILY_CONDITIONS, $completed));
        $channelRows = $this->channelAiRows($date);
        $validChannelRows = $channelRows['valid'] ?? null;
        $status = $missing === []
            ? ($validChannelRows !== null && $validChannelRows < count(AiDailyPreview::channelAiUids()) ? 'warn' : 'ok')
            : 'fail';

        return [
            'status' => $status,
            'date' => $date,
            'available' => true,
            'expected_conditions' => self::DAILY_CONDITIONS,
            'completed_conditions' => $completed,
            'missing_conditions' => $missing,
            'condition_rows' => $rows->count(),
            'valid_condition_rows' => $validRows->count(),
            'invalid_condition_rows' => $rows->count() - $validRows->count(),
            'channel_rows' => $validChannelRows,
            'channel_rows_total' => $channelRows['total'] ?? null,
            'invalid_channel_rows' => $channelRows['invalid'] ?? null,
            'expected_channel_rows' => count(AiDailyPreview::channelAiUids()),
            'latest_mtime' => $validRows->max('mtime'),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function mayorPersonCompleteness(string $date): array
    {
        $target = $this->mayorPersonTarget();

        try {
            if (! Schema::hasTable('urt_mayor_person_ai')) {
                return $this->unknownMayorPerson($date, $target, 'urt_mayor_person_ai table is missing');
            }

            $mayorColumns = ['person'];

            if (Schema::hasColumn('urt_mayor_person_ai', 'mtime')) {
                $mayorColumns[] = 'mtime';
            }

            $rows = DB::table('urt_mayor_person_ai')
                ->where('city_key', $target['city'])
                ->where('the_date', $date)
                ->when(Schema::hasColumn('urt_mayor_person_ai', 'del_flag'), fn ($query) => $query->whereNull('del_flag'))
                ->get($mayorColumns);
        } catch (Throwable) {
            return $this->unknownMayorPerson($date, $target, 'database unavailable while checking mayor person AI completeness');
        }

        $completed = $rows
            ->pluck('person')
            ->map(fn (mixed $person): string => (string) $person)
            ->unique()
            ->intersect($target['people'])
            ->values()
            ->all();
        $missing = array_values(array_diff($target['people'], $completed));

        return [
            'status' => match (true) {
                $missing === [] => 'ok',
                $completed !== [] => 'warn',
                default => 'fail',
            },
            'date' => $date,
            'available' => true,
            'city' => $target['city'],
            'city_label' => $target['city_label'],
            'expected_people' => $target['people'],
            'completed_people' => $completed,
            'missing_people' => $missing,
            'rows' => $rows->count(),
            'latest_mtime' => $rows->max('mtime'),
        ];
    }

    private function normalizeCondition(mixed $condition): string
    {
        return is_string($condition) && trim($condition) !== '' ? trim($condition) : 'all';
    }

    /**
     * @return array{valid: int, total: int, invalid: int}|null
     */
    private function channelAiRows(string $date): ?array
    {
        try {
            if (! Schema::hasTable('urt_channel_ai')) {
                return null;
            }

            $columns = ['pk', 'u_id'];
            $hasResultJson = Schema::hasColumn('urt_channel_ai', 'result_json');

            if ($hasResultJson) {
                $columns[] = 'result_json';
            }

            $rows = DB::table('urt_channel_ai')
                ->when(Schema::hasColumn('urt_channel_ai', 'del_flag'), fn ($query) => $query->whereNull('del_flag'))
                ->where('date_from', $date.' 00:00:00')
                ->where('date_to', $date.' 23:59:59')
                ->when(Schema::hasColumn('urt_channel_ai', 'data_type'), function ($query): void {
                    $query->whereIn('data_type', ['oneday', 'todate']);
                })
                ->orderByDesc('pk')
                ->get($columns)
                ->unique('u_id')
                ->values();
            $total = $rows->count();
            $valid = $hasResultJson
                ? $rows
                    ->filter(fn (object $row): bool => $this->jsonValidator
                        ->validateEventList((string) ($row->result_json ?? ''), 'channel')['valid'])
                    ->count()
                : $total;

            return [
                'valid' => $valid,
                'total' => $total,
                'invalid' => $total - $valid,
            ];
        } catch (Throwable) {
            return null;
        }
    }

    /**
     * @return array<string, mixed>
     */
    private function unknownAiDaily(string $date, string $reason): array
    {
        return [
            'status' => 'unknown',
            'date' => $date,
            'available' => false,
            'reason' => $reason,
            'expected_conditions' => self::DAILY_CONDITIONS,
            'completed_conditions' => [],
            'missing_conditions' => self::DAILY_CONDITIONS,
            'condition_rows' => null,
            'valid_condition_rows' => null,
            'invalid_condition_rows' => null,
            'channel_rows' => null,
            'channel_rows_total' => null,
            'invalid_channel_rows' => null,
            'expected_channel_rows' => count(AiDailyPreview::channelAiUids()),
            'latest_mtime' => null,
        ];
    }

    /**
     * @param  array{city: string, city_label: string, people: list<string>}  $target
     * @return array<string, mixed>
     */
    private function unknownMayorPerson(string $date, array $target, string $reason): array
    {
        return [
            'status' => 'unknown',
            'date' => $date,
            'available' => false,
            'reason' => $reason,
            'city' => $target['city'],
            'city_label' => $target['city_label'],
            'expected_people' => $target['people'],
            'completed_people' => [],
            'missing_people' => $target['people'],
            'rows' => null,
            'latest_mtime' => null,
        ];
    }

    /**
     * @return array{city: string, city_label: string, people: list<string>}
     */
    private function mayorPersonTarget(): array
    {
        $job = $this->registry->find('ai.mayor_person') ?? [];
        $command = $this->registry->scheduledExecutionCommand($job);
        $cityKey = $this->stringOption($command, 'city', 'taipei');
        $limit = $this->intOption($command, 'limit', 10);
        $cities = $this->mayorReport->cities();
        $city = $cities[$cityKey] ?? $cities['taipei'];

        return [
            'city' => $city['key'],
            'city_label' => $city['label'],
            'people' => collect($city['candidates'])->take($limit)->values()->all(),
        ];
    }

    private function stringOption(string $command, string $option, string $default): string
    {
        if (preg_match('/--'.preg_quote($option, '/').'(?:=|\s+)([A-Za-z0-9_]+)/', $command, $matches)) {
            return $matches[1];
        }

        return $default;
    }

    private function intOption(string $command, string $option, int $default): int
    {
        if (preg_match('/--'.preg_quote($option, '/').'(?:=|\s+)(\d+)/', $command, $matches)) {
            return max(1, (int) $matches[1]);
        }

        return $default;
    }

    /**
     * @param  list<array<string, mixed>>  $events
     */
    private function sumLatency(array $events): int
    {
        return array_sum(array_map(fn (array $event): int => max(0, (int) ($event['latency_ms'] ?? 0)), $events));
    }

    /**
     * @param  list<array<string, mixed>>  $events
     */
    private function maxLatency(array $events): int
    {
        return $events === [] ? 0 : max(array_map(fn (array $event): int => max(0, (int) ($event['latency_ms'] ?? 0)), $events));
    }

    /**
     * @param  list<array<string, mixed>>  $events
     * @return list<array<string, mixed>>
     */
    private function groupLatency(array $events, string $field): array
    {
        return collect($events)
            ->groupBy(fn (array $event): string => (string) ($event[$field] ?? 'unknown'))
            ->map(function ($group, string $key): array {
                $latencies = collect($group)->map(fn (array $event): int => max(0, (int) ($event['latency_ms'] ?? 0)));

                return [
                    'key' => $key,
                    'requests' => $group->count(),
                    'failed_requests' => $group->filter(fn (array $event): bool => ($event['ok'] ?? true) !== true)->count(),
                    'avg_latency_ms' => $latencies->isEmpty() ? 0 : (int) round($latencies->avg()),
                    'max_latency_ms' => $latencies->max() ?? 0,
                ];
            })
            ->sortByDesc('max_latency_ms')
            ->values()
            ->all();
    }

    private function slowRuntimeMs(string $jobKey): int
    {
        if ($jobKey === 'ai.daily') {
            return 90 * 60 * 1000;
        }

        if (str_starts_with($jobKey, 'ai.')) {
            return 30 * 60 * 1000;
        }

        return 10 * 60 * 1000;
    }

    /**
     * @param  list<string>  $statuses
     */
    private function worstStatus(array $statuses): string
    {
        $rank = ['ok' => 1, 'unknown' => 2, 'warn' => 2, 'fail' => 3];
        $worst = 'ok';

        foreach ($statuses as $status) {
            $status = is_string($status) && array_key_exists($status, $rank) ? $status : 'unknown';

            if ($rank[$status] > $rank[$worst]) {
                $worst = $status;
            }
        }

        return $worst;
    }

    /**
     * @return list<string>
     */
    private function recommendations(string $status, bool $schedulerActive, array $youtube, array $ai, array $targets): array
    {
        $recommendations = [];

        if (! $schedulerActive) {
            $recommendations[] = '確認 Dokploy scheduler 是否每分鐘執行 php artisan schedule:run，且 ingestion:run --execute --record 能寫入 run-history。';
        }

        if (($targets['ai_daily']['status'] ?? 'ok') === 'fail') {
            $recommendations[] = '補跑 php artisan ingestion:run --execute --job=ai.daily --record，或直接執行 ai:daily 的 capped execute command。';
        }

        if (($targets['mayor_person']['status'] ?? 'ok') === 'fail') {
            $recommendations[] = '補跑 php artisan ingestion:run --execute --job=ai.mayor_person --record，讓候選人每日 AI cache 補齊。';
        }

        if (($youtube['quota']['percent_used'] ?? 0) >= 80) {
            $recommendations[] = 'YouTube quota 已超過 80%，優先保留 live/stats 與 tag backfill，延後低優先度補抓。';
        }

        if (($youtube['quota']['available'] ?? true) !== true) {
            $recommendations[] = 'YouTube quota ledger 無法使用；先確認 migration 與資料庫連線，scheduler 會 fail closed。';
        }

        if (($youtube['failed_requests'] ?? 0) > 0) {
            $recommendations[] = '檢查最新 run-history 的 YouTube telemetry，確認是否為 quota/rate limit 或單一 method 失敗。';
        }

        if (($ai['failed_requests'] ?? 0) > 0) {
            $recommendations[] = '檢查 AI provider telemetry；若 primary 慢或失敗但 fallback 成功，調整 provider 或降低單次 ai_call_limit。';
        }

        if ($recommendations === [] && $status === 'ok') {
            $recommendations[] = '目前健康檢查未發現會阻擋每日報表產出的問題。';
        }

        return $recommendations;
    }

    /**
     * @param  array<string, mixed>  $record
     */
    private function createdAt(array $record, CarbonImmutable $now): ?CarbonImmutable
    {
        $timezone = $now->getTimezone()->getName();
        $value = $record['created_at'] ?? null;

        if (is_string($value) && trim($value) !== '') {
            try {
                return CarbonImmutable::parse($value, $timezone)->setTimezone($timezone);
            } catch (Throwable) {
                return null;
            }
        }

        return null;
    }
}
