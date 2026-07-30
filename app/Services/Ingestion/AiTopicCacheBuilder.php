<?php

namespace App\Services\Ingestion;

use App\Services\Legacy\AiTopicProjector;
use App\Support\SensitiveTextRedactor;
use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Throwable;

class AiTopicCacheBuilder
{
    public const MAX_ROWS = 62;

    public function __construct(
        private readonly AiTopicProjector $projector,
        private readonly AiBusinessKeyLock $businessKeyLock,
    ) {}

    /**
     * @return array<string, mixed>
     */
    public function build(
        ?string $from = null,
        ?string $to = null,
        string $condition = 'all',
        string $dataType = 'oneday',
        ?int $pk = null,
        int $rowLimit = 31,
        int $topicLimit = 100,
        int $channelLimit = 100,
        int $videoLimit = 5000,
        bool $missingOnly = false,
        bool $execute = false,
        ?CarbonImmutable $now = null,
    ): array {
        $timezone = (string) config('ingestion.timezone', 'Asia/Taipei');
        $now ??= CarbonImmutable::now($timezone);
        $rowLimit = max(1, min(self::MAX_ROWS, $rowLimit));
        $topicLimit = max(1, min(AiTopicProjector::MAX_TOPICS, $topicLimit));
        $channelLimit = max(1, min(AiTopicProjector::MAX_CHANNELS, $channelLimit));
        $videoLimit = max(1, min(AiTopicProjector::MAX_VIDEOS, $videoLimit));
        $condition = AiCommandInputValidator::condition($condition, AiCommandInputValidator::DAILY_CONDITIONS);
        $dataType = AiCommandInputValidator::type($dataType, AiCommandInputValidator::DAILY_DATA_TYPES);
        $range = $this->range($from, $to, $now);
        $base = [
            'mode' => $execute ? 'execute' : 'preview',
            'source' => 'legacy_api_topic',
            'from' => $range['from'],
            'to' => $range['to'],
            'condition' => $condition,
            'data_type' => $dataType,
            'pk' => $pk,
            'row_limit' => $rowLimit,
            'topic_limit' => $topicLimit,
            'channel_limit' => $channelLimit,
            'video_limit' => $videoLimit,
            'missing_only' => $missingOnly,
            'write_targets' => ['urt_ai_date.data_json', 'urt_ai_date.video_json'],
            'external_requests' => 0,
            'credentials_required' => false,
            'secrets' => 'not_printed',
            'generated_at' => $now->format('Y-m-d H:i:s'),
        ];

        $blockedReason = $range['blocked_reason'] ?? $this->schemaBlock();

        if ($pk !== null && $pk <= 0) {
            $blockedReason = 'invalid_pk';
        }

        if ($blockedReason !== null) {
            return $this->summary($base, [], 0, 0, 0, 0, 1, $blockedReason, false);
        }

        try {
            $selection = $this->rows($range['from'], $range['to'], $condition, $dataType, $pk, $rowLimit);
        } catch (Throwable $exception) {
            $this->logFailure('source_query', $exception);

            return $this->summary($base, [], 0, 0, 0, 0, 1, 'source_query_failed', false);
        }

        if ($selection['truncated']) {
            return $this->summary($base, [], 0, 0, 0, 0, 1, 'row_source_limit_exceeded', true);
        }

        if ($selection['rows'] === []) {
            return $this->summary($base, [], 0, 0, 0, 0, 1, 'daily_rows_missing', false);
        }

        $results = [];
        $updated = 0;
        $wouldUpdate = 0;
        $unchanged = 0;
        $skipped = 0;
        $failed = 0;

        foreach ($selection['rows'] as $row) {
            try {
                $result = $this->processRow(
                    $row,
                    $topicLimit,
                    $channelLimit,
                    $videoLimit,
                    $missingOnly,
                    $execute,
                    $now,
                );
            } catch (Throwable $exception) {
                $this->logFailure('row_processing', $exception, (int) ($row->pk ?? 0));
                $result = $this->rowResult($row, 'failed', 'row_processing_failed');
            }

            $results[] = $result;
            $updated += (int) ($result['status'] === 'updated');
            $wouldUpdate += (int) ($result['status'] === 'would_update');
            $unchanged += (int) ($result['status'] === 'unchanged');
            $skipped += (int) ($result['status'] === 'skipped');
            $failed += (int) in_array($result['status'], ['blocked', 'failed'], true);
        }

        return $this->summary(
            $base,
            $results,
            $updated,
            $wouldUpdate,
            $unchanged,
            $skipped,
            $failed,
            $failed > 0 ? 'row_failures' : null,
            collect($results)->contains(fn (array $row): bool => (bool) ($row['source_truncated'] ?? false)),
        );
    }

    /**
     * @return array<string, mixed>
     */
    private function processRow(
        object $row,
        int $topicLimit,
        int $channelLimit,
        int $videoLimit,
        bool $missingOnly,
        bool $execute,
        CarbonImmutable $now,
    ): array {
        $cached = $this->projector->cached($row);

        if ($missingOnly && $cached !== null) {
            return $this->rowResult($row, 'skipped', 'cache_already_present');
        }

        $projection = $this->projector->project($row, $topicLimit, $channelLimit, $videoLimit);

        if (! $projection['complete']) {
            return $this->rowResult(
                $row,
                'blocked',
                (string) $projection['blocked_reason'],
                $projection,
            );
        }

        if ($cached !== null && $this->same($cached['topic'], $projection['topic']) && $this->same($cached['video'], $projection['video'])) {
            return $this->rowResult($row, 'unchanged', null, $projection);
        }

        if (! $execute) {
            return $this->rowResult($row, 'would_update', null, $projection);
        }

        $identity = [
            'date_from' => (string) $row->date_from,
            'date_to' => (string) $row->date_to,
            'data_type' => (string) $row->data_type,
            'condition_type' => (string) ($row->condition_type ?: 'all'),
            'user_token' => (string) ($row->user_token ?? ''),
        ];
        $lock = $this->businessKeyLock->acquire('urt_ai_date', $identity);

        if ($lock === null) {
            return $this->rowResult($row, 'failed', 'business_key_locked', $projection);
        }

        try {
            $fresh = DB::table('urt_ai_date')->where('pk', (int) $row->pk)->whereNull('del_flag')->first();

            if (! $fresh) {
                return $this->rowResult($row, 'failed', 'daily_row_missing_after_lock');
            }

            $freshProjection = $this->projector->project($fresh, $topicLimit, $channelLimit, $videoLimit);

            if (! $freshProjection['complete']) {
                return $this->rowResult(
                    $fresh,
                    'blocked',
                    (string) $freshProjection['blocked_reason'],
                    $freshProjection,
                );
            }

            $freshCached = $this->projector->cached($fresh);

            if ($freshCached !== null
                && $this->same($freshCached['topic'], $freshProjection['topic'])
                && $this->same($freshCached['video'], $freshProjection['video'])) {
                return $this->rowResult($fresh, 'unchanged', null, $freshProjection);
            }

            DB::table('urt_ai_date')
                ->where('pk', (int) $fresh->pk)
                ->whereNull('del_flag')
                ->update([
                    'mtime' => $now->format('Y-m-d H:i:s'),
                    'data_json' => json_encode($freshProjection['topic'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR),
                    'video_json' => json_encode($freshProjection['video'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR),
                ]);

            return $this->rowResult($fresh, 'updated', null, $freshProjection);
        } catch (Throwable $exception) {
            $this->logFailure('row_write', $exception, (int) ($row->pk ?? 0));

            return $this->rowResult($row, 'failed', 'cache_write_failed', $projection);
        } finally {
            $lock->release();
        }
    }

    /**
     * @return array{rows: list<object>, truncated: bool}
     */
    private function rows(
        string $from,
        string $to,
        string $condition,
        string $dataType,
        ?int $pk,
        int $rowLimit,
    ): array {
        $query = DB::table('urt_ai_date')->whereNull('del_flag');

        if ($pk !== null) {
            $rows = $query->where('pk', $pk)->limit(1)->get()->all();

            return ['rows' => $rows, 'truncated' => false];
        }

        $query->where('date_from', '>=', $from.' 00:00:00')
            ->where('date_to', '<=', $to.' 23:59:59')
            ->where('data_type', $dataType);
        $this->conditionQuery($query, $condition);
        $rows = $query
            ->orderByDesc('date_from')
            ->orderByDesc('pk')
            ->limit($rowLimit + 1)
            ->get()
            ->unique(fn (object $row): string => implode('|', [
                (string) $row->date_from,
                (string) $row->date_to,
                (string) ($row->condition_type ?: 'all'),
                (string) $row->data_type,
            ]))
            ->values();

        return [
            'rows' => $rows->take($rowLimit)->all(),
            'truncated' => $rows->count() > $rowLimit,
        ];
    }

    private function conditionQuery(Builder $query, string $condition): void
    {
        if ($condition === 'all') {
            $query->where(function (Builder $inner): void {
                $inner->whereNull('condition_type')->orWhere('condition_type', 'all');
            });

            return;
        }

        $query->where('condition_type', $condition);
    }

    /**
     * @return array{from: string, to: string, blocked_reason: string|null}
     */
    private function range(?string $from, ?string $to, CarbonImmutable $now): array
    {
        $from = AiCommandInputValidator::date($from, '--from') ?? $now->subDay()->toDateString();
        $to = AiCommandInputValidator::date($to, '--to') ?? $from;

        return [
            'from' => $from,
            'to' => $to,
            'blocked_reason' => $from > $to ? 'invalid_date_range' : null,
        ];
    }

    private function schemaBlock(): ?string
    {
        if (! Schema::hasTable('urt_ai_date')) {
            return 'missing_urt_ai_date_table';
        }

        foreach (['pk', 'mtime', 'date_from', 'date_to', 'data_type', 'condition_type', 'user_token', 'del_flag', 'channel_id', 'result_json', 'data_json', 'video_json'] as $column) {
            if (! Schema::hasColumn('urt_ai_date', $column)) {
                return 'missing_urt_ai_date_column';
            }
        }

        return null;
    }

    private function same(array $left, array $right): bool
    {
        return $left === $right;
    }

    /**
     * @param  array<string, mixed>|null  $projection
     * @return array<string, mixed>
     */
    private function rowResult(object $row, string $status, ?string $reason, ?array $projection = null): array
    {
        return [
            'pk' => (int) ($row->pk ?? 0),
            'date' => substr((string) ($row->date_from ?? ''), 0, 10),
            'condition' => (string) (($row->condition_type ?? null) ?: 'all'),
            'data_type' => (string) ($row->data_type ?? ''),
            'status' => $status,
            'failed' => in_array($status, ['blocked', 'failed'], true),
            'blocked_reason' => $reason,
            'source_truncated' => (bool) ($projection['source_truncated'] ?? false),
            'topic_count' => (int) ($projection['topic_count'] ?? 0),
            'channel_count' => (int) ($projection['channel_count'] ?? 0),
            'video_count' => (int) ($projection['video_count'] ?? 0),
        ];
    }

    /**
     * @param  array<string, mixed>  $base
     * @param  list<array<string, mixed>>  $rows
     * @return array<string, mixed>
     */
    private function summary(
        array $base,
        array $rows,
        int $updated,
        int $wouldUpdate,
        int $unchanged,
        int $skipped,
        int $failed,
        ?string $blockedReason,
        bool $sourceTruncated,
    ): array {
        return $base + [
            'status' => $failed > 0 ? ($rows === [] ? 'blocked' : 'partial_failure') : 'success',
            'exit_code' => $failed > 0 ? 1 : 0,
            'selected_rows' => count($rows),
            'updated' => $updated,
            'would_update' => $wouldUpdate,
            'unchanged' => $unchanged,
            'skipped' => $skipped,
            'failed_rows' => $failed,
            'blocked_reason' => $blockedReason,
            'source_truncated' => $sourceTruncated,
            'rows' => $rows,
        ];
    }

    private function logFailure(string $stage, Throwable $exception, ?int $pk = null): void
    {
        Log::warning('AI topic cache row failed.', [
            'stage' => $stage,
            'pk' => $pk,
            'failure_reason' => SensitiveTextRedactor::exception($exception, 240),
            'exception_class' => $exception::class,
            'secrets' => 'not_printed',
        ]);
    }
}
