<?php

namespace App\Services\Ingestion;

use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use RuntimeException;

class CommentQueueIngestion
{
    public function __construct(private readonly CommentQueuePreview $preview)
    {
    }

    /**
     * @return array<string, mixed>
     */
    public function execute(
        ?string $tagid = null,
        ?string $or = null,
        ?string $not = null,
        int $min = 500,
        int $hours = 24,
        int $limit = 1,
        ?CarbonInterface $now = null,
    ): array {
        if (! Schema::hasTable('urt_comment_queue')) {
            throw new RuntimeException('Missing local table: urt_comment_queue');
        }

        $timezone = (string) config('ingestion.timezone', config('app.timezone', 'Asia/Taipei'));
        $now = $now === null
            ? CarbonImmutable::now($timezone)
            : CarbonImmutable::instance($now->toDateTimeImmutable())->setTimezone($timezone);
        $limit = max(1, min(20, $limit));
        $preview = $this->preview->preview(
            tagid: $tagid,
            or: $or,
            not: $not,
            min: $min,
            hours: $hours,
            limit: $limit,
            now: $now,
        );
        $rows = collect($preview['rows'] ?? [])
            ->filter(fn (array $row): bool => (bool) ($row['would_insert_queue'] ?? false))
            ->take($limit)
            ->values();
        $inserted = [];
        $skipped = [];

        foreach ($rows as $row) {
            $videoId = trim((string) ($row['video_id'] ?? ''));

            if ($videoId === '') {
                $skipped[] = ['videoId' => '', 'reason' => 'missing_video_id'];

                continue;
            }

            DB::transaction(function () use ($videoId, $now, &$inserted, &$skipped): void {
                if (DB::table('urt_comment_queue')->where('videoId', $videoId)->exists()) {
                    $skipped[] = ['videoId' => $videoId, 'reason' => 'already_queued'];

                    return;
                }

                $insert = $this->onlyExistingColumns('urt_comment_queue', [
                    'ctime' => $now->format('Y-m-d H:i:s'),
                    'stime' => null,
                    'ftime' => null,
                    'videoId' => $videoId,
                ]);

                DB::table('urt_comment_queue')->insert($insert);
                $inserted[] = ['videoId' => $videoId];
            });
        }

        return [
            'mode' => 'local-execute',
            'generated_at' => $now->format('Y-m-d H:i:s'),
            'source' => 'recent_high_comment_videos',
            'selected_rows' => $rows->count(),
            'inserted_queue_rows' => count($inserted),
            'skipped_rows' => count($skipped),
            'write_targets' => [
                'urt_comment_queue.ctime',
                'urt_comment_queue.videoId',
            ],
            'external_calls' => [],
            'inserted' => $inserted,
            'skipped' => $skipped,
            'secrets' => 'not printed',
        ] + collect($preview)->only([
            'matching_channels',
            'recent_video_rows',
            'comment_threshold_rows',
            'already_queued_rows',
            'already_done_rows',
            'would_insert_queue_rows',
            'hours',
            'min',
            'published_after',
        ])->all();
    }

    /**
     * @param  array<string, mixed>  $values
     * @return array<string, mixed>
     */
    private function onlyExistingColumns(string $table, array $values): array
    {
        $columns = Schema::getColumnListing($table);

        return collect($values)
            ->filter(fn (mixed $value, string $column): bool => in_array($column, $columns, true))
            ->all();
    }

}
