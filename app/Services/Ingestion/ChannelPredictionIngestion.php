<?php

namespace App\Services\Ingestion;

use App\Services\Legacy\LegacyChannelReportApiReport;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Contracts\Cache\Lock;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Throwable;

class ChannelPredictionIngestion
{
    private const LOCK_KEY = 'ingestion:reports.channel_predictions.build';

    public function __construct(
        private readonly LegacyChannelReportApiReport $report,
    ) {}

    /**
     * @return array<string, mixed>
     */
    public function run(
        ?int $uId = null,
        int $limit = 20,
        bool $execute = false,
        ?CarbonInterface $now = null,
        int $offset = 0,
    ): array {
        $timezone = (string) config('ingestion.timezone', config('app.timezone', 'Asia/Taipei'));
        $now = $now === null
            ? CarbonImmutable::now($timezone)
            : CarbonImmutable::instance($now->toDateTimeImmutable())->setTimezone($timezone);
        $uId = $uId !== null ? max(1, $uId) : null;
        $limit = max(1, min(100, $limit));
        $offset = max(0, $offset);

        $schemaBlock = $this->schemaBlock();

        if ($schemaBlock !== null) {
            return $this->logged($this->emptyPayload($now, $execute, $limit, $uId, $schemaBlock, offset: $offset));
        }

        $lock = null;

        if ($execute) {
            $lock = Cache::lock(self::LOCK_KEY, 600);

            if (! $lock->get()) {
                return $this->logged($this->emptyPayload($now, true, $limit, $uId, 'lock_busy', available: true));
            }
        }

        try {
            return $this->logged($this->process($now, $uId, $limit, $execute, $offset));
        } finally {
            $this->release($lock);
        }
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return array<string, mixed>
     */
    private function logged(array $payload): array
    {
        $context = [
            'mode' => $payload['mode'] ?? 'unknown',
            'u_id' => $payload['u_id'] ?? null,
            'candidates' => $payload['candidates'] ?? 0,
            'updated' => $payload['updated'] ?? 0,
            'unchanged' => $payload['unchanged'] ?? 0,
            'skipped' => $payload['skipped'] ?? 0,
            'failed' => $payload['failed'] ?? 0,
            'blocked_reason' => $payload['blocked_reason'] ?? null,
        ];

        if (($payload['blocked_reason'] ?? null) !== null || (int) ($payload['failed'] ?? 0) > 0) {
            Log::warning('Channel prediction build completed with gaps.', $context);
        } else {
            Log::info('Channel prediction build completed.', $context);
        }

        return $payload;
    }

    /**
     * @return array<string, mixed>
     */
    private function process(CarbonImmutable $now, ?int $uId, int $limit, bool $execute, int $offset): array
    {
        try {
            $base = DB::table('urt_channel')
                ->when($uId !== null, fn ($query) => $query->where('u_id', $uId));
            $candidateTotal = (clone $base)->count();
            $effectiveOffset = $candidateTotal > 0 ? $offset % $candidateTotal : 0;
            $candidateIds = (clone $base)
                ->orderBy('u_id')
                ->offset($effectiveOffset)
                ->limit($limit)
                ->pluck('u_id')
                ->map(fn (mixed $value): int => (int) $value)
                ->all();
            $wrapped = false;

            if (count($candidateIds) < min($limit, $candidateTotal) && $effectiveOffset > 0) {
                $wrapped = true;
                $candidateIds = [
                    ...$candidateIds,
                    ...(clone $base)
                        ->orderBy('u_id')
                        ->limit(min($limit, $candidateTotal) - count($candidateIds))
                        ->pluck('u_id')
                        ->map(fn (mixed $value): int => (int) $value)
                        ->all(),
                ];
            }
        } catch (Throwable) {
            return $this->emptyPayload($now, $execute, $limit, $uId, 'candidate_query_failed', offset: $offset);
        }

        $rows = [];
        $wouldUpdate = 0;
        $updated = 0;
        $unchanged = 0;
        $skipped = 0;
        $failed = 0;

        foreach ($candidateIds as $candidateId) {
            try {
                $current = DB::table('urt_count')
                    ->where('u_id', $candidateId)
                    ->first(['u_id', 'views_pred_week', 'views_pred_month']);

                if ($current === null) {
                    $skipped++;
                    $rows[] = $this->skippedRow($candidateId, 'missing_count_row');

                    continue;
                }

                $prediction = $this->report->predictionForChannel($candidateId, limit: 29, monthsLimit: 4);

                if ((int) $prediction['view_points'] < 2) {
                    if ((int) $prediction['invalid_log_rows'] > 0) {
                        $failed++;
                        $rows[] = $this->failedRow(
                            $candidateId,
                            (int) $prediction['log_rows'],
                            (int) $prediction['invalid_log_rows'],
                            (int) $prediction['valid_points'],
                            'invalid_log_history',
                        );
                    } else {
                        $skipped++;
                        $rows[] = $this->skippedRow(
                            $candidateId,
                            'insufficient_log_history',
                            (int) $prediction['log_rows'],
                            (int) $prediction['valid_points'],
                        );
                    }

                    continue;
                }

                $computed = [
                    'views_pred_week' => (int) $prediction['summary']['views_pred_week'],
                    'views_pred_month' => (int) $prediction['summary']['views_pred_month'],
                ];
                $currentValues = [
                    'views_pred_week' => (int) ($current->views_pred_week ?? 0),
                    'views_pred_month' => (int) ($current->views_pred_month ?? 0),
                ];
                $changed = $computed !== $currentValues;

                if (! $changed) {
                    $unchanged++;
                    $rows[] = $this->resultRow($candidateId, $prediction, $currentValues, $computed, 'unchanged');

                    continue;
                }

                $wouldUpdate++;
                $status = 'would_update';

                if ($execute) {
                    DB::table('urt_count')->where('u_id', $candidateId)->update($computed);
                    $updated++;
                    $status = 'updated';
                }

                $rows[] = $this->resultRow($candidateId, $prediction, $currentValues, $computed, $status);
            } catch (Throwable) {
                $failed++;
                $rows[] = $this->failedRow($candidateId, reason: 'item_processing_failed');
            }
        }

        return [
            'mode' => $execute ? 'execute' : 'ingestion-preview',
            'available' => true,
            'blocked_reason' => null,
            'generated_at' => $now->format('Y-m-d H:i:s'),
            'u_id' => $uId,
            'limit' => $limit,
            'offset' => $effectiveOffset,
            'next_offset' => $candidateTotal > 0 ? ($effectiveOffset + count($candidateIds)) % $candidateTotal : 0,
            'batch_wrapped' => $wrapped,
            'source_truncated' => $candidateTotal > count($candidateIds),
            'candidate_total' => $candidateTotal,
            'candidates' => count($candidateIds),
            'would_update' => $wouldUpdate,
            'updated' => $updated,
            'unchanged' => $unchanged,
            'skipped' => $skipped,
            'failed' => $failed,
            'rows' => $rows,
            'writes' => $execute ? [
                'urt_count.views_pred_week',
                'urt_count.views_pred_month',
            ] : [],
            'lock' => [
                'key' => self::LOCK_KEY,
                'acquired' => $execute,
                'ttl_seconds' => 600,
            ],
        ];
    }

    private function schemaBlock(): ?string
    {
        foreach (['urt_channel', 'urt_count', 'urt_log'] as $table) {
            if (! Schema::hasTable($table)) {
                return 'missing_table:'.$table;
            }
        }

        $requiredColumns = [
            'urt_channel' => ['u_id'],
            'urt_count' => ['u_id', 'views_pred_week', 'views_pred_month'],
            'urt_log' => ['pk', 'u_id', 'thedata'],
        ];

        foreach ($requiredColumns as $table => $columns) {
            if (! Schema::hasColumns($table, $columns)) {
                return 'missing_columns:'.$table;
            }
        }

        return null;
    }

    /**
     * @param  array<string, mixed>  $prediction
     * @param  array{views_pred_week: int, views_pred_month: int}  $current
     * @param  array{views_pred_week: int, views_pred_month: int}  $computed
     * @return array<string, mixed>
     */
    private function resultRow(int $uId, array $prediction, array $current, array $computed, string $status): array
    {
        return [
            'u_id' => $uId,
            'status' => $status,
            'reason' => null,
            'log_rows' => (int) $prediction['log_rows'],
            'invalid_log_rows' => (int) $prediction['invalid_log_rows'],
            'valid_points' => (int) $prediction['valid_points'],
            'current' => $current,
            'computed' => $computed,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function skippedRow(int $uId, string $reason, int $logRows = 0, int $validPoints = 0): array
    {
        return [
            'u_id' => $uId,
            'status' => 'skipped',
            'reason' => $reason,
            'log_rows' => $logRows,
            'invalid_log_rows' => 0,
            'valid_points' => $validPoints,
            'current' => null,
            'computed' => null,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function failedRow(
        int $uId,
        int $logRows = 0,
        int $invalidLogRows = 0,
        int $validPoints = 0,
        string $reason = 'item_processing_failed',
    ): array {
        return [
            'u_id' => $uId,
            'status' => 'failed',
            'reason' => $reason,
            'log_rows' => $logRows,
            'invalid_log_rows' => $invalidLogRows,
            'valid_points' => $validPoints,
            'current' => null,
            'computed' => null,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function emptyPayload(
        CarbonImmutable $now,
        bool $execute,
        int $limit,
        ?int $uId,
        string $reason,
        bool $available = false,
        int $offset = 0,
    ): array {
        return [
            'mode' => $execute ? 'execute' : 'ingestion-preview',
            'available' => $available,
            'blocked_reason' => $reason,
            'generated_at' => $now->format('Y-m-d H:i:s'),
            'u_id' => $uId,
            'limit' => $limit,
            'offset' => $offset,
            'next_offset' => 0,
            'batch_wrapped' => false,
            'source_truncated' => false,
            'candidate_total' => 0,
            'candidates' => 0,
            'would_update' => 0,
            'updated' => 0,
            'unchanged' => 0,
            'skipped' => 0,
            'failed' => 0,
            'rows' => [],
            'writes' => [],
            'lock' => [
                'key' => self::LOCK_KEY,
                'acquired' => false,
                'ttl_seconds' => 600,
            ],
        ];
    }

    private function release(?Lock $lock): void
    {
        if ($lock === null) {
            return;
        }

        try {
            $lock->release();
        } catch (Throwable) {
            // Expired locks are safe to ignore after the command has finished.
        }
    }
}
