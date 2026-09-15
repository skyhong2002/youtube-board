<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Report pages compute "資料更新" by running MAX(<timestamp columns>) over the
 * legacy source tables (see App\Support\ReportSourceTimestampLookup). Without
 * an index on every timestamp column in that query the optimizer falls back to
 * a full scan, which on urt_video (~550k rows, MyISAM) took ~1.7 s per request.
 *
 * KeywordRelationFallback additionally filters urt_video by channel (u_id) and
 * publishedAt range; a composite index lets that use one range scan instead of
 * reading every video of each channel and sorting on disk.
 *
 * The legacy tables are not created by these migrations, so this is guarded to
 * be a no-op wherever a table, column, or index is missing. Production had the
 * indexes applied by hand on 2026-09-14.
 */
return new class extends Migration
{
    private const TABLES = [
        'urt_channel_ai',
        'urt_show_video_live',
        'urt_video',
        'urt_video_live',
        'urt_video_live_log',
        'urt_video_log',
        'urt_video_log_history',
        'urt_video_schedule',
    ];

    private const TIMESTAMP_COLUMNS = [
        'ctime',
        'date_from',
        'date_to',
        'ftime',
        'latest_time',
        'mtime',
        'publishedAt',
        'stime',
        'the_date',
        'thedate',
        'vtime',
    ];

    public function up(): void
    {
        if (Schema::hasTable('urt_video')
            && Schema::hasColumns('urt_video', ['u_id', 'publishedAt'])
            && ! Schema::hasIndex('urt_video', 'u_id_publishedAt')) {
            Schema::table('urt_video', function (Blueprint $blueprint): void {
                $blueprint->index(['u_id', 'publishedAt'], 'u_id_publishedAt');
            });
        }

        foreach (self::TABLES as $table) {
            if (! Schema::hasTable($table)) {
                continue;
            }

            foreach (self::TIMESTAMP_COLUMNS as $column) {
                if (! Schema::hasColumn($table, $column) || Schema::hasIndex($table, $column)) {
                    continue;
                }

                Schema::table($table, function (Blueprint $blueprint) use ($column): void {
                    $blueprint->index($column, $column);
                });
            }
        }
    }

    public function down(): void
    {
        // Indexes may pre-date this migration in production; leave them in place.
    }
};
