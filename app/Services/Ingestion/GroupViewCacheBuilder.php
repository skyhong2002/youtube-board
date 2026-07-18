<?php

namespace App\Services\Ingestion;

use App\Services\Legacy\GroupViewProjector;
use App\Services\Legacy\LegacyGroupViewConfig;
use App\Support\SensitiveTextRedactor;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Throwable;

final class GroupViewCacheBuilder
{
    public const MAX_GROUP_LENGTH = 128;

    public function __construct(
        private readonly GroupViewProjector $projector,
        private readonly AiBusinessKeyLock $businessKeyLock,
    ) {}

    /**
     * @param  list<string>  $explicitTags
     * @return array<string, mixed>
     */
    public function build(
        string $group = '六都市長候選人',
        string $view = 'politician',
        int $days = 30,
        array $explicitTags = [],
        int $tagLimit = GroupViewProjector::MAX_TAGS,
        bool $execute = false,
        ?CarbonImmutable $now = null,
    ): array {
        $timezone = (string) config('ingestion.timezone', config('app.timezone', 'Asia/Taipei'));
        $now ??= CarbonImmutable::now($timezone);
        $group = trim($group);
        $view = trim($view);
        $days = max(1, min(GroupViewProjector::MAX_DAYS, $days));
        $tagLimit = max(1, min(GroupViewProjector::MAX_TAGS, $tagLimit));
        $base = [
            'mode' => $execute ? 'execute' : 'preview',
            'source' => 'legacy_group_view',
            'group' => $group,
            'view' => $view,
            'days' => $days,
            'tag_limit' => $tagLimit,
            'explicit_tags' => count($explicitTags),
            'write_targets' => ['urt_show_group.ctime', 'urt_show_group.mtime', 'urt_show_group.the_result'],
            'external_requests' => 0,
            'credentials_required' => false,
            'secrets' => 'not_printed',
            'generated_at' => $now->format('Y-m-d H:i:s'),
        ];

        $blockedReason = match (true) {
            $group === '' || mb_strlen($group, 'UTF-8') > self::MAX_GROUP_LENGTH => 'invalid_group',
            ! array_key_exists($view, LegacyGroupViewConfig::views()) => 'unknown_view',
            default => $this->schemaBlock(),
        };

        if ($blockedReason !== null) {
            return $this->summary($base, 'blocked', $blockedReason, null);
        }

        try {
            $projection = $this->projector->project($group, $view, $days, $explicitTags, $tagLimit, $now);
        } catch (Throwable $exception) {
            $this->logFailure('projection', $exception);

            return $this->summary($base, 'failed', 'projection_failed', null);
        }

        $base += [
            'tag_count' => $projection['tag_count'],
            'group_count' => $projection['group_count'],
            'source_rows' => $projection['source_rows'],
        ];

        if (! $projection['complete']) {
            return $this->summary($base, 'blocked', (string) $projection['blocked_reason'], null);
        }

        $payload = ['result' => $projection['result']];
        $encoded = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

        if ($encoded === false) {
            return $this->summary($base, 'failed', 'result_encoding_failed', null);
        }

        $existing = DB::table('urt_show_group')
            ->where('the_group', $group)
            ->where('the_view', $view)
            ->orderByDesc('pk')
            ->first();

        if ($existing !== null && (string) ($existing->the_result ?? '') === $encoded) {
            return $this->summary($base, 'success', null, 'unchanged');
        }

        if (! $execute) {
            return $this->summary($base, 'success', null, $existing === null ? 'would_insert' : 'would_update');
        }

        $lock = $this->businessKeyLock->acquire('urt_show_group', ['the_group' => $group, 'the_view' => $view]);

        if ($lock === null) {
            return $this->summary($base, 'failed', 'business_key_locked', null);
        }

        try {
            $nowString = $now->format('Y-m-d H:i:s');
            $fresh = DB::table('urt_show_group')
                ->where('the_group', $group)
                ->where('the_view', $view)
                ->orderByDesc('pk')
                ->first();

            if ($fresh === null) {
                DB::table('urt_show_group')->insert([
                    'ctime' => $nowString,
                    'mtime' => $nowString,
                    'the_group' => $group,
                    'the_view' => $view,
                    'the_result' => $encoded,
                ]);

                return $this->summary($base, 'success', null, 'inserted');
            }

            DB::table('urt_show_group')
                ->where('pk', (int) $fresh->pk)
                ->update([
                    'mtime' => $nowString,
                    'the_result' => $encoded,
                ]);

            return $this->summary($base, 'success', null, 'updated');
        } catch (Throwable $exception) {
            $this->logFailure('cache_write', $exception);

            return $this->summary($base, 'failed', 'cache_write_failed', null);
        } finally {
            $lock->release();
        }
    }

    private function schemaBlock(): ?string
    {
        if (! Schema::hasTable('urt_show_group')) {
            return 'missing_urt_show_group_table';
        }

        foreach (['pk', 'ctime', 'mtime', 'the_group', 'the_view', 'the_result'] as $column) {
            if (! Schema::hasColumn('urt_show_group', $column)) {
                return 'missing_urt_show_group_column';
            }
        }

        return null;
    }

    /**
     * @param  array<string, mixed>  $base
     * @return array<string, mixed>
     */
    private function summary(array $base, string $status, ?string $blockedReason, ?string $action): array
    {
        return $base + [
            'status' => $status,
            'exit_code' => $status === 'success' ? 0 : 1,
            'action' => $action,
            'blocked_reason' => $blockedReason,
        ];
    }

    private function logFailure(string $stage, Throwable $exception): void
    {
        Log::warning('Group view cache build failed.', [
            'stage' => $stage,
            'failure_reason' => SensitiveTextRedactor::exception($exception, 240),
            'exception_class' => $exception::class,
            'secrets' => 'not_printed',
        ]);
    }
}
