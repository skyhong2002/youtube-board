<?php

namespace Tests\Feature\Ops;

use App\Support\LegacyDashboardSchema;
use App\Support\YoutubeIdentifierSchema;
use Carbon\CarbonImmutable;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class YoutubeIdentifierCaseSensitivityMysqlTest extends TestCase
{
    protected function tearDown(): void
    {
        Carbon::setTestNow();
        CarbonImmutable::setTestNow();

        parent::tearDown();
    }

    public function test_full_identifier_migration_preserves_schema_and_isolates_discovery_stats_and_duration_writes(): void
    {
        $this->assertCount(23, YoutubeIdentifierSchema::COLUMNS);
        $this->assertSame(32, array_sum(array_map('count', YoutubeIdentifierSchema::COLUMNS)));

        $connectionName = 'mysql_case_sensitive_youtube_identifiers';
        $originalConnection = DB::getDefaultConnection();
        $mysql = config('database.connections.mysql');

        if (! is_array($mysql)) {
            $this->markTestSkipped('MySQL connection is not configured.');
        }

        $prefix = 'youtube_id_graph_';
        $mysql['prefix'] = $prefix;
        config()->set("database.connections.{$connectionName}", $mysql);
        DB::purge($connectionName);

        try {
            DB::connection($connectionName)->getPdo();
        } catch (\Throwable) {
            DB::purge($connectionName);
            config()->set("database.connections.{$connectionName}", null);
            $this->markTestSkipped('MySQL is unavailable for YouTube identifier graph proof.');
        }

        DB::setDefaultConnection($connectionName);
        $baselineTables = array_column(LegacyDashboardSchema::statements(
            database_path('schema/legacy-dashboard-baseline.sql'),
        ), 'table');

        try {
            Carbon::setTestNow(Carbon::parse('2026-05-25 18:00:00', 'Asia/Taipei'));
            CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 18:00:00', 'Asia/Taipei'));
            config()->set('services.youtube.api_key', 'test-key');
            config()->set('services.youtube.api_keys', null);
            config()->set('services.youtube.transient_retries', 0);
            config()->set('ingestion.lock_store', null);
            config()->set('ingestion.youtube_daily_quota_budget', 9000);

            $this->createLegacyCaseInsensitiveBaselineTables($baselineTables, $prefix);
            $this->createApplicationTables();
            $baseline = $this->identifierMetadata($prefix);

            foreach (YoutubeIdentifierSchema::COLUMNS as $table => $columns) {
                foreach ($columns as $column => $definition) {
                    $metadata = $baseline[$table][$column];
                    $this->assertNotSame('utf8mb4_bin', $metadata['collation'], "{$table}.{$column}");
                    $this->assertSame($definition['length'], $metadata['length'], "{$table}.{$column}");
                    $this->assertSame($definition['nullable'], $metadata['nullable'], "{$table}.{$column}");
                }
            }

            DB::statement(
                'ALTER TABLE `'.$prefix.'urt_comment` '
                .'MODIFY `channelId` VARCHAR(48) CHARACTER SET utf8mb4 '
                .'COLLATE utf8mb4_unicode_ci NOT NULL',
            );
            $before = $this->identifierMetadata($prefix);
            $this->assertSame(48, $before['urt_comment']['channelId']['length']);
            $this->assertFalse($before['urt_comment']['channelId']['nullable']);

            $legacySchemaExitCode = Artisan::call('deployment:schema-check', ['--json' => true]);
            $legacySchema = json_decode(trim(Artisan::output()), true, flags: JSON_THROW_ON_ERROR);

            $this->assertSame(1, $legacySchemaExitCode, (string) json_encode($legacySchema));
            $this->assertFalse($legacySchema['ready']);
            $this->assertSame([], $legacySchema['missing_tables']);
            $this->assertSame([], $legacySchema['missing_columns']);
            $this->assertSame([], $legacySchema['missing_indexes']);
            $this->assertSame([], $legacySchema['missing_foreign_keys']);
            $this->assertTrue($legacySchema['required_table_engines_valid']);
            $this->assertFalse($legacySchema['required_binary_collations_valid']);
            $this->assertSame(
                32,
                collect($legacySchema['required_binary_collations'])->flatten()->count(),
            );
            $this->assertSame(
                ['utf8mb4_unicode_ci'],
                collect($legacySchema['required_binary_collations'])->flatten()->unique()->values()->all(),
            );

            $migration = require database_path(
                'migrations/2026_07_15_000000_enforce_case_sensitive_comment_youtube_ids.php',
            );
            $migration->up();
            $migration->up();

            $after = $this->identifierMetadata($prefix);

            foreach (YoutubeIdentifierSchema::COLUMNS as $table => $columns) {
                foreach (array_keys($columns) as $column) {
                    $this->assertSame('utf8mb4_bin', $after[$table][$column]['collation'], "{$table}.{$column}");
                    $this->assertSame($before[$table][$column]['length'], $after[$table][$column]['length'], "{$table}.{$column}");
                    $this->assertSame($before[$table][$column]['nullable'], $after[$table][$column]['nullable'], "{$table}.{$column}");
                }
            }
            $this->assertSame(48, $after['urt_comment']['channelId']['length']);
            $this->assertFalse($after['urt_comment']['channelId']['nullable']);

            $migratedSchemaExitCode = Artisan::call('deployment:schema-check', ['--json' => true]);
            $migratedSchema = json_decode(trim(Artisan::output()), true, flags: JSON_THROW_ON_ERROR);

            $this->assertSame(0, $migratedSchemaExitCode, (string) json_encode($migratedSchema));
            $this->assertTrue($migratedSchema['ready']);
            $this->assertSame(64, $migratedSchema['required_table_count']);
            $this->assertSame([], $migratedSchema['missing_tables']);
            $this->assertSame([], $migratedSchema['missing_columns']);
            $this->assertSame([], $migratedSchema['missing_indexes']);
            $this->assertSame([], $migratedSchema['missing_foreign_keys']);
            $this->assertTrue($migratedSchema['required_table_engines_valid']);
            $this->assertTrue($migratedSchema['required_binary_collations_valid']);
            $this->assertSame(
                ['utf8mb4_bin'],
                collect($migratedSchema['required_binary_collations'])->flatten()->unique()->values()->all(),
            );

            $engine = DB::selectOne(
                'SELECT ENGINE AS engine FROM information_schema.TABLES '
                .'WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
                [$prefix.'urt_video'],
            );
            $this->assertSame('MyISAM', $engine->engine ?? null);

            DB::table('urt_channel')->insert([
                'u_id' => 10,
                'ctime' => '2026-05-20 00:00:00',
                'vtime' => null,
                'flag_del' => null,
                'youtube_id' => 'UC-Graph',
                'title' => 'Identifier Graph Channel',
                'uploads' => 'UU-Graph',
                'videoCount' => 2,
            ]);
            Http::fake([
                'www.googleapis.com/youtube/v3/playlistItems*' => Http::response([
                    'items' => [
                        $this->playlistItem('PlaylistItemCase', 'CaseVideoId', 'Upper video'),
                        $this->playlistItem('playlistitemcase', 'casevideoid', 'Lower video'),
                    ],
                ]),
            ]);

            $discoveryExitCode = Artisan::call('youtube:channels:videos', [
                '--execute' => true,
                '--channel' => 10,
                '--limit' => 1,
                '--max-results' => 2,
                '--json' => true,
            ]);
            $discovery = json_decode(trim(Artisan::output()), true, flags: JSON_THROW_ON_ERROR);

            $this->assertSame(0, $discoveryExitCode, (string) json_encode($discovery));
            $this->assertSame(2, $discovery['applied'][0]['video_upserts']);
            $this->assertSame(2, $discovery['applied'][0]['schedule_upserts']);
            $this->assertSame(2, $discovery['applied'][0]['live_upserts']);
            foreach (['urt_video', 'urt_video_schedule', 'urt_video_live'] as $table) {
                $this->assertSame(2, DB::table($table)->count(), $table);
                $this->assertSame(1, $this->exactVideoIdCount($table, 'CaseVideoId'), $table);
                $this->assertSame(1, $this->exactVideoIdCount($table, 'casevideoid'), $table);
            }
            $this->assertSame('Upper video', DB::table('urt_video')->where('videoId', 'CaseVideoId')->value('title'));
            $this->assertSame('Lower video', DB::table('urt_video')->where('videoId', 'casevideoid')->value('title'));

            $liveBuildExitCode = Artisan::call('reports:live:build', [
                '--hours' => 2,
                '--limit' => 10,
                '--json' => true,
            ]);
            $liveBuild = json_decode(trim(Artisan::output()), true, flags: JSON_THROW_ON_ERROR);
            $liveRows = collect($liveBuild['rows'])->keyBy('video_id');

            $this->assertSame(0, $liveBuildExitCode, (string) json_encode($liveBuild));
            $this->assertSame(2, $liveBuild['candidates']);
            $this->assertSame(2, $liveBuild['would_insert']);
            $this->assertSame(0, $liveBuild['missing_video_metadata']);
            $this->assertCount(2, $liveRows);
            $this->assertSame('Upper video', $liveRows->get('CaseVideoId')['title'] ?? null);
            $this->assertSame('Lower video', $liveRows->get('casevideoid')['title'] ?? null);
            $this->assertNotSame(
                $liveRows->get('CaseVideoId')['v_pk'] ?? null,
                $liveRows->get('casevideoid')['v_pk'] ?? null,
            );

            $statsRequests = [];
            $durationRequests = [];
            Http::fake(function ($request) use (&$statsRequests, &$durationRequests) {
                $videoId = (string) $request['id'];

                if ((string) $request['part'] === 'statistics') {
                    $statsRequests[] = $videoId;

                    return Http::response([
                        'items' => [[
                            'id' => $videoId,
                            'statistics' => [
                                'viewCount' => $videoId === 'CaseVideoId' ? '111' : '222',
                                'likeCount' => '10',
                                'favoriteCount' => '0',
                                'commentCount' => '3',
                            ],
                        ]],
                    ]);
                }

                $durationRequests[] = $videoId;

                return Http::response([
                    'items' => [[
                        'id' => $videoId,
                        'contentDetails' => [
                            'duration' => $videoId === 'CaseVideoId' ? 'PT1M1S' : 'PT2M2S',
                            'caption' => 'false',
                        ],
                    ]],
                ]);
            });

            $this->runStats('CaseVideoId');
            $this->assertSame(111, (int) DB::table('urt_video')->where('videoId', 'CaseVideoId')->value('viewCount'));
            $this->assertNull(DB::table('urt_video')->where('videoId', 'casevideoid')->value('viewCount'));
            $this->assertSame(1, $this->exactVideoIdCount('urt_video_log', 'CaseVideoId'));
            $this->assertSame(0, $this->exactVideoIdCount('urt_video_log', 'casevideoid'));

            $this->runStats('casevideoid');
            $this->assertSame(['CaseVideoId', 'casevideoid'], $statsRequests);
            $this->assertSame(111, (int) DB::table('urt_video')->where('videoId', 'CaseVideoId')->value('viewCount'));
            $this->assertSame(222, (int) DB::table('urt_video')->where('videoId', 'casevideoid')->value('viewCount'));
            foreach (['urt_video_log', 'urt_video_log_history'] as $table) {
                $this->assertSame(2, DB::table($table)->count(), $table);
                $this->assertSame(1, $this->exactVideoIdCount($table, 'CaseVideoId'), $table);
                $this->assertSame(1, $this->exactVideoIdCount($table, 'casevideoid'), $table);
            }

            $this->runDuration('CaseVideoId');
            $this->assertSame(1, $this->exactVideoIdCount('urt_video_duration', 'CaseVideoId'));
            $this->assertSame(0, $this->exactVideoIdCount('urt_video_duration', 'casevideoid'));

            $this->runDuration('casevideoid');
            $this->assertSame(['CaseVideoId', 'casevideoid'], $durationRequests);
            $this->assertSame(2, DB::table('urt_video_duration')->count());
            $this->assertSame(61, (int) DB::table('urt_video_duration')->where('videoId', 'CaseVideoId')->value('duration'));
            $this->assertSame(122, (int) DB::table('urt_video_duration')->where('videoId', 'casevideoid')->value('duration'));
        } finally {
            foreach ([
                'ingestion_run_jobs',
                'ingestion_runs',
                'ingestion_youtube_quota_daily',
                'urt_show_group',
                'urt_mayor_person_ai',
                'failed_jobs',
                'job_batches',
                'jobs',
                'cache_locks',
                'cache',
                'sessions',
                'password_reset_tokens',
                'users',
                'migrations',
                ...array_reverse($baselineTables),
            ] as $table) {
                Schema::dropIfExists($table);
            }

            DB::purge($connectionName);
            DB::setDefaultConnection($originalConnection);
            config()->set("database.connections.{$connectionName}", null);
        }
    }

    /**
     * @param  list<string>  $tables
     */
    private function createLegacyCaseInsensitiveBaselineTables(array $tables, string $prefix): void
    {
        $statements = collect(LegacyDashboardSchema::statements(
            database_path('schema/legacy-dashboard-baseline.sql'),
        ))->keyBy('table');

        foreach ($tables as $table) {
            $statement = $statements->get($table);
            $this->assertIsArray($statement, $table);
            $sql = preg_replace(
                '/\ACREATE TABLE IF NOT EXISTS `'.preg_quote($table, '/').'`/',
                'CREATE TABLE IF NOT EXISTS `'.$prefix.$table.'`',
                (string) $statement['sql'],
                1,
            );
            $this->assertIsString($sql, $table);
            DB::unprepared(str_replace('utf8mb4_bin', 'utf8mb4_unicode_ci', $sql));
        }
    }

    private function createApplicationTables(): void
    {
        Schema::create('migrations', function (Blueprint $table): void {
            $table->increments('id');
            $table->string('migration');
            $table->integer('batch');
        });

        foreach ([
            '0001_01_01_000000_create_users_table.php',
            '0001_01_01_000001_create_cache_table.php',
            '0001_01_01_000002_create_jobs_table.php',
            '2026_06_06_000000_create_urt_mayor_person_ai_table.php',
            '2026_07_13_000000_create_ingestion_youtube_quota_daily_table.php',
            '2026_07_18_000000_create_urt_show_group_table.php',
        ] as $migrationFile) {
            $migration = require database_path('migrations/'.$migrationFile);
            $migration->up();
        }

        Schema::create('ingestion_runs', function (Blueprint $table): void {
            $table->engine = 'InnoDB';
            $table->string('id', 52)->primary();
            $table->dateTime('recorded_at');
            $table->string('request_source', 32)->nullable();
            $table->string('request_mode', 16)->nullable();
            $table->string('result_mode', 16)->nullable();
            $table->longText('payload_json');
            $table->timestamps();
            $table->index('recorded_at', 'youtube_id_graph_runs_recorded_at_index');
            $table->index(
                ['request_source', 'request_mode', 'result_mode', 'recorded_at'],
                'youtube_id_graph_runs_scheduler_index',
            );
        });
        Schema::create('ingestion_run_jobs', function (Blueprint $table): void {
            $table->engine = 'InnoDB';
            $table->string('run_id', 52);
            $table->string('job_key', 120);
            $table->dateTime('recorded_at');
            $table->boolean('attempted')->default(true);
            $table->boolean('succeeded')->default(false);
            $table->boolean('failed')->default(false);
            $table->string('action', 120)->nullable();
            $table->integer('exit_code')->nullable();
            $table->string('started_at', 64)->nullable();
            $table->string('finished_at', 64)->nullable();
            $table->timestamps();
            $table->primary(['run_id', 'job_key'], 'youtube_id_graph_run_jobs_primary');
            $table->index(
                ['job_key', 'attempted', 'recorded_at'],
                'youtube_id_graph_run_jobs_attempt_index',
            );
            $table->index(
                ['job_key', 'succeeded', 'recorded_at'],
                'youtube_id_graph_run_jobs_success_index',
            );
            $table->foreign('run_id', 'youtube_id_graph_run_jobs_run_foreign')
                ->references('id')
                ->on('ingestion_runs')
                ->cascadeOnDelete();
        });
    }

    /**
     * @return array<string, array<string, array{collation: string|null, length: int, nullable: bool}>>
     */
    private function identifierMetadata(string $prefix): array
    {
        $metadata = [];

        foreach (YoutubeIdentifierSchema::COLUMNS as $table => $columns) {
            foreach (array_keys($columns) as $column) {
                $row = DB::selectOne(
                    'SELECT COLLATION_NAME AS collation_name, '
                    .'CHARACTER_MAXIMUM_LENGTH AS character_maximum_length, IS_NULLABLE AS is_nullable '
                    .'FROM information_schema.COLUMNS '
                    .'WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
                    [$prefix.$table, $column],
                );
                $this->assertIsObject($row, "{$table}.{$column}");
                $metadata[$table][$column] = [
                    'collation' => is_string($row->collation_name ?? null) ? $row->collation_name : null,
                    'length' => (int) ($row->character_maximum_length ?? 0),
                    'nullable' => strtoupper((string) ($row->is_nullable ?? 'NO')) === 'YES',
                ];
            }
        }

        return $metadata;
    }

    /**
     * @return array<string, mixed>
     */
    private function playlistItem(string $itemId, string $videoId, string $title): array
    {
        return [
            'id' => $itemId,
            'snippet' => [
                'publishedAt' => '2026-05-24T03:00:00Z',
                'channelId' => 'UC-Graph',
                'title' => $title,
                'description' => $title.' description',
                'thumbnails' => ['default' => ['url' => 'https://img.youtube.test/default_live.jpg']],
                'channelTitle' => 'Identifier Graph Channel',
                'playlistId' => 'UU-Graph',
                'position' => 0,
                'resourceId' => ['videoId' => $videoId],
                'liveBroadcastContent' => 'upcoming',
            ],
        ];
    }

    private function runStats(string $videoId): void
    {
        $exitCode = Artisan::call('youtube:videos:stats', [
            '--execute' => true,
            '--videoId' => $videoId,
            '--limit' => 1,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true, flags: JSON_THROW_ON_ERROR);

        $this->assertSame(0, $exitCode, (string) json_encode($payload));
        $this->assertSame(1, $payload['updated_videos']);
    }

    private function runDuration(string $videoId): void
    {
        $exitCode = Artisan::call('youtube:videos:duration', [
            '--execute' => true,
            '--videoId' => $videoId,
            '--limit' => 1,
            '--loops' => 1,
            '--enqueue-missing' => true,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true, flags: JSON_THROW_ON_ERROR);

        $this->assertSame(0, $exitCode, (string) json_encode($payload));
        $this->assertSame(1, $payload['updated_videos']);
    }

    private function exactVideoIdCount(string $table, string $videoId): int
    {
        return DB::table($table)
            ->whereRaw('BINARY `videoId` = BINARY ?', [$videoId])
            ->count();
    }
}
