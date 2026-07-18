<?php

namespace App\Services\Ingestion;

use App\Support\SensitiveTextRedactor;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Throwable;

/**
 * Retires urt_channel rows whose YouTube channels no longer exist, so
 * youtube:channels:stats stops re-polling terminated channels forever.
 * Candidates are stale-statistics channels, and execute additionally requires
 * the channel to be absent from a fresh channels.list(part=id) response
 * before writing the legacy soft-delete flag_del marker.
 */
final class ChannelRetirementIngestion
{
    public const MAX_LIMIT = 50;

    public const MIN_STALE_DAYS = 7;

    public const MAX_STALE_DAYS = 365;

    public function __construct(
        private readonly YoutubeDataApiClient $youtube,
    ) {}

    /**
     * @return array<string, mixed>
     */
    public function preview(
        ?int $uId = null,
        int $staleDays = 14,
        int $limit = self::MAX_LIMIT,
        ?CarbonInterface $now = null,
    ): array {
        $now = $this->now($now);
        $staleDays = $this->staleDays($staleDays);
        $limit = $this->limit($limit);
        $base = $this->basePayload('ingestion-preview', $uId, $staleDays, $limit, $now);

        if ($schemaBlock = $this->schemaBlock()) {
            return $base + ['blocked_reason' => $schemaBlock, 'exit_code' => 1, 'rows' => []];
        }

        $rows = $this->candidates($uId, $staleDays, $limit, $now);

        return $base + [
            'blocked_reason' => null,
            'exit_code' => 0,
            'selected_rows' => count($rows),
            'would_call_api' => $rows !== [],
            'api_call_skipped' => 'channels.list(part=id) presence confirmation runs only in execute mode',
            'writes' => [],
            'rows' => $rows,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function execute(
        ?int $uId = null,
        int $staleDays = 14,
        int $limit = self::MAX_LIMIT,
        ?CarbonInterface $now = null,
    ): array {
        $now = $this->now($now);
        $staleDays = $this->staleDays($staleDays);
        $limit = $this->limit($limit);
        $base = $this->basePayload('local-execute', $uId, $staleDays, $limit, $now);

        if ($schemaBlock = $this->schemaBlock()) {
            return $base + ['blocked_reason' => $schemaBlock, 'exit_code' => 1, 'retired' => [], 'skipped' => []];
        }

        $rows = $this->candidates($uId, $staleDays, $limit, $now);

        if ($rows === []) {
            return $base + [
                'blocked_reason' => null,
                'exit_code' => 0,
                'selected_rows' => 0,
                'api_requested_rows' => 0,
                'retired_rows' => 0,
                'skipped_rows' => 0,
                'failed_rows' => 0,
                'retired' => [],
                'skipped' => [],
            ];
        }

        try {
            $presentIds = $this->youtube->channelPresence(
                array_map(fn (array $row): string => $row['youtube_id'], $rows),
            );
        } catch (Throwable $exception) {
            $this->logFailure('presence_lookup', $exception);

            return $base + [
                'blocked_reason' => 'presence_lookup_failed',
                'exit_code' => 1,
                'selected_rows' => count($rows),
                'api_requested_rows' => count($rows),
                'retired_rows' => 0,
                'skipped_rows' => 0,
                'failed_rows' => count($rows),
                'retired' => [],
                'skipped' => [],
            ];
        }

        $retired = [];
        $skipped = [];
        $failed = 0;

        foreach ($rows as $row) {
            if (in_array($row['youtube_id'], $presentIds, true)) {
                $skipped[] = [
                    'u_id' => $row['u_id'],
                    'youtube_id' => $row['youtube_id'],
                    'reason' => 'still_on_youtube',
                ];

                continue;
            }

            try {
                DB::table('urt_channel')
                    ->where('u_id', $row['u_id'])
                    ->whereNull('flag_del')
                    ->update([
                        'flag_del' => 1,
                        'mtime' => $now->format('Y-m-d H:i:s'),
                    ]);
                $retired[] = [
                    'u_id' => $row['u_id'],
                    'youtube_id' => $row['youtube_id'],
                    'title' => $row['title'],
                ];
                Log::warning('Channel retirement flagged a terminated channel.', [
                    'u_id' => $row['u_id'],
                    'write' => 'urt_channel.flag_del=1',
                    'secrets' => 'not_printed',
                ]);
            } catch (Throwable $exception) {
                $failed++;
                $skipped[] = [
                    'u_id' => $row['u_id'],
                    'youtube_id' => $row['youtube_id'],
                    'reason' => 'retire_write_failed',
                ];
                $this->logFailure('retire_write', $exception, $row['u_id']);
            }
        }

        return $base + [
            'blocked_reason' => null,
            'exit_code' => $failed > 0 ? 1 : 0,
            'selected_rows' => count($rows),
            'api_requested_rows' => count($rows),
            'retired_rows' => count($retired),
            'skipped_rows' => count($skipped),
            'failed_rows' => $failed,
            'retired' => $retired,
            'skipped' => $skipped,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function restore(int $uId, ?CarbonInterface $now = null): array
    {
        $now = $this->now($now);
        $base = $this->basePayload('local-execute-restore', $uId, null, 1, $now);

        if ($schemaBlock = $this->schemaBlock()) {
            return $base + ['blocked_reason' => $schemaBlock, 'exit_code' => 1, 'restored' => false];
        }

        $row = DB::table('urt_channel')->where('u_id', $uId)->first(['u_id', 'youtube_id', 'title', 'flag_del']);

        if ($row === null || trim((string) ($row->youtube_id ?? '')) === '') {
            return $base + ['blocked_reason' => 'channel_not_found', 'exit_code' => 1, 'restored' => false];
        }

        if ((int) ($row->flag_del ?? 0) < 1) {
            return $base + ['blocked_reason' => 'channel_not_retired', 'exit_code' => 1, 'restored' => false];
        }

        try {
            $presentIds = $this->youtube->channelPresence([(string) $row->youtube_id]);
        } catch (Throwable $exception) {
            $this->logFailure('presence_lookup', $exception, $uId);

            return $base + ['blocked_reason' => 'presence_lookup_failed', 'exit_code' => 1, 'restored' => false];
        }

        if (! in_array((string) $row->youtube_id, $presentIds, true)) {
            return $base + ['blocked_reason' => 'still_missing_on_youtube', 'exit_code' => 1, 'restored' => false];
        }

        try {
            DB::table('urt_channel')
                ->where('u_id', $uId)
                ->update([
                    'flag_del' => null,
                    'mtime' => $now->format('Y-m-d H:i:s'),
                ]);
        } catch (Throwable $exception) {
            $this->logFailure('restore_write', $exception, $uId);

            return $base + ['blocked_reason' => 'restore_write_failed', 'exit_code' => 1, 'restored' => false];
        }

        return $base + ['blocked_reason' => null, 'exit_code' => 0, 'restored' => true, 'title' => (string) ($row->title ?? '')];
    }

    /**
     * Stale-statistics candidates: polled at least once, no successful
     * statistics publication (urt_channel.mtime) inside the window.
     *
     * @return list<array{u_id: int, youtube_id: string, title: string, mtime: string|null, stime: string|null}>
     */
    private function candidates(?int $uId, int $staleDays, int $limit, CarbonImmutable $now): array
    {
        $cutoff = $now->subDays($staleDays)->format('Y-m-d H:i:s');
        $query = DB::table('urt_channel')
            ->whereNull('flag_del')
            ->whereNotNull('youtube_id')
            ->where('youtube_id', '!=', '')
            ->whereNotNull('stime');

        if ($uId !== null) {
            $query->where('u_id', $uId);
        } else {
            $query->where(function ($inner) use ($cutoff): void {
                $inner->where('mtime', '<', $cutoff)
                    ->orWhere(function ($never) use ($cutoff): void {
                        $never->whereNull('mtime')->where('ctime', '<', $cutoff);
                    });
            });
        }

        return $query
            ->orderBy('mtime')
            ->orderBy('u_id')
            ->limit($limit)
            ->get(['u_id', 'youtube_id', 'title', 'mtime', 'stime'])
            ->map(fn (object $row): array => [
                'u_id' => (int) $row->u_id,
                'youtube_id' => trim((string) $row->youtube_id),
                'title' => (string) ($row->title ?? ''),
                'mtime' => $row->mtime !== null ? (string) $row->mtime : null,
                'stime' => $row->stime !== null ? (string) $row->stime : null,
            ])
            ->all();
    }

    private function schemaBlock(): ?string
    {
        if (! Schema::hasTable('urt_channel')) {
            return 'missing_urt_channel_table';
        }

        foreach (['u_id', 'ctime', 'mtime', 'stime', 'flag_del', 'youtube_id', 'title'] as $column) {
            if (! Schema::hasColumn('urt_channel', $column)) {
                return 'missing_urt_channel_column';
            }
        }

        return null;
    }

    /**
     * @return array<string, mixed>
     */
    private function basePayload(string $mode, ?int $uId, ?int $staleDays, int $limit, CarbonImmutable $now): array
    {
        return [
            'mode' => $mode,
            'source' => 'stale_statistics_channels',
            'u_id' => $uId,
            'stale_days' => $staleDays,
            'limit' => $limit,
            'write_targets' => ['urt_channel.flag_del', 'urt_channel.mtime'],
            'external_calls' => ['YouTube Data API channels.list(part=id)'],
            'generated_at' => $now->format('Y-m-d H:i:s'),
            'secrets' => 'not_printed',
        ];
    }

    private function now(?CarbonInterface $now): CarbonImmutable
    {
        $timezone = (string) config('ingestion.timezone', config('app.timezone', 'Asia/Taipei'));

        return $now === null
            ? CarbonImmutable::now($timezone)
            : CarbonImmutable::instance($now->toDateTimeImmutable())->setTimezone($timezone);
    }

    private function staleDays(int $staleDays): int
    {
        return max(self::MIN_STALE_DAYS, min(self::MAX_STALE_DAYS, $staleDays));
    }

    private function limit(int $limit): int
    {
        return max(1, min(self::MAX_LIMIT, $limit));
    }

    private function logFailure(string $stage, Throwable $exception, ?int $uId = null): void
    {
        Log::warning('Channel retirement failed.', [
            'stage' => $stage,
            'u_id' => $uId,
            'failure_reason' => SensitiveTextRedactor::exception($exception, 240),
            'exception_class' => $exception::class,
            'secrets' => 'not_printed',
        ]);
    }
}
