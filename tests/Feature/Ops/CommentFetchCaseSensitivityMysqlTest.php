<?php

namespace Tests\Feature\Ops;

use App\Support\YoutubeIdentifierSchema;
use Carbon\CarbonImmutable;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class CommentFetchCaseSensitivityMysqlTest extends TestCase
{
    protected function tearDown(): void
    {
        CarbonImmutable::setTestNow();

        parent::tearDown();
    }

    public function test_upgrade_migration_prevents_case_variant_cross_resume_and_overwrite_on_myisam(): void
    {
        $connectionName = 'mysql_case_sensitive_comment_fetch';
        $originalConnection = DB::getDefaultConnection();
        $mysql = config('database.connections.mysql');

        if (! is_array($mysql)) {
            $this->markTestSkipped('MySQL connection is not configured.');
        }

        $prefix = 'comment_fetch_case_';
        $mysql['prefix'] = $prefix;
        config()->set("database.connections.{$connectionName}", $mysql);
        DB::purge($connectionName);

        try {
            DB::connection($connectionName)->getPdo();
        } catch (\Throwable) {
            DB::purge($connectionName);
            config()->set("database.connections.{$connectionName}", null);
            $this->markTestSkipped('MySQL is unavailable for comment fetch case-sensitivity proof.');
        }

        DB::setDefaultConnection($connectionName);

        try {
            CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 12:00:00', 'Asia/Taipei'));
            config()->set('services.youtube.api_key', 'test-key');
            $this->createLegacyCaseInsensitiveTables();

            DB::table('urt_comment')->insert([
                'videoId' => 'CaseVideoId',
                'ctime' => '2026-05-25 09:00:00',
                'mtime' => '2026-05-25 09:30:00',
                'stime' => null,
                'pageToken' => 'UPPER-NEXT',
                'authors_json' => '{}',
                'comments_json' => '{}',
            ]);
            DB::table('urt_comment_queue')->insert([
                $this->queueRow(1, 'CaseVideoId'),
                $this->queueRow(2, 'casevideoid'),
            ]);

            $this->assertSame(1, DB::table('urt_comment')->where('videoId', 'casevideoid')->count());

            $migration = require database_path(
                'migrations/2026_07_15_000000_enforce_case_sensitive_comment_youtube_ids.php',
            );
            $migration->up();

            foreach ([
                'urt_video.videoId',
                'urt_comment.videoId',
                'urt_comment.channelId',
                'urt_comment_author.ChannelId',
                'urt_comment_queue.videoId',
                'urt_comment_queue_done.videoId',
            ] as $qualifiedColumn) {
                [$table, $column] = explode('.', $qualifiedColumn, 2);
                $collation = DB::selectOne(
                    'SELECT COLLATION_NAME AS collation_name FROM information_schema.COLUMNS '
                    .'WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
                    [$prefix.$table, $column],
                );

                $this->assertSame('utf8mb4_bin', $collation->collation_name ?? null, $qualifiedColumn);
            }
            $this->assertSame(0, DB::table('urt_comment')->where('videoId', 'casevideoid')->count());

            $requests = [];
            Http::fake(function ($request) use (&$requests) {
                $requests[] = [
                    'videoId' => (string) $request['videoId'],
                    'pageToken' => isset($request['pageToken']) ? (string) $request['pageToken'] : null,
                ];

                return Http::response(['items' => []]);
            });

            $exitCode = Artisan::call('youtube:comments:fetch', [
                '--execute' => true,
                '--limit' => 2,
                '--max-pages' => 1,
                '--json' => true,
            ]);
            $payload = json_decode(trim(Artisan::output()), true, flags: JSON_THROW_ON_ERROR);

            $this->assertSame(0, $exitCode);
            $this->assertSame(2, $payload['selected_rows']);
            $this->assertSame(2, $payload['api_called_videos']);
            $this->assertSame(2, $payload['moved_to_done_rows']);
            $this->assertSame(0, $payload['failed_rows']);
            $this->assertSame([
                ['videoId' => 'CaseVideoId', 'pageToken' => 'UPPER-NEXT'],
                ['videoId' => 'casevideoid', 'pageToken' => null],
            ], $requests);
            $this->assertSame(2, DB::table('urt_comment')->count());
            $this->assertSame(0, DB::table('urt_comment_queue')->count());
            $this->assertSame(2, DB::table('urt_comment_queue_done')->count());
            $this->assertSame(1, $this->exactVideoIdCount('urt_comment', 'CaseVideoId'));
            $this->assertSame(1, $this->exactVideoIdCount('urt_comment', 'casevideoid'));
            $this->assertSame(1, $this->exactVideoIdCount('urt_comment_queue_done', 'CaseVideoId'));
            $this->assertSame(1, $this->exactVideoIdCount('urt_comment_queue_done', 'casevideoid'));
            Http::assertSentCount(2);
        } finally {
            foreach ([
                ...array_reverse(array_keys(YoutubeIdentifierSchema::COLUMNS)),
                'urt_comment_rev',
                'ingestion_youtube_quota_daily',
            ] as $table) {
                Schema::dropIfExists($table);
            }

            DB::purge($connectionName);
            DB::setDefaultConnection($originalConnection);
            config()->set("database.connections.{$connectionName}", null);
        }
    }

    private function createLegacyCaseInsensitiveTables(): void
    {
        foreach ([
            ...array_reverse(array_keys(YoutubeIdentifierSchema::COLUMNS)),
            'urt_comment_rev',
            'ingestion_youtube_quota_daily',
        ] as $table) {
            Schema::dropIfExists($table);
        }

        Schema::create('urt_video', function (Blueprint $table): void {
            $table->engine = 'MyISAM';
            $table->increments('pk');
            $table->string('id', 64)->collation('utf8mb4_unicode_ci');
            $table->string('channelId', 32)->collation('utf8mb4_unicode_ci');
            $table->string('playlistId', 40)->collation('utf8mb4_unicode_ci');
            $table->string('videoId', 32)->collation('utf8mb4_unicode_ci')->unique();
        });
        Schema::create('urt_comment', function (Blueprint $table): void {
            $table->engine = 'MyISAM';
            $table->increments('pk');
            $table->string('videoId', 32)->collation('utf8mb4_unicode_ci')->unique();
            $table->dateTime('ctime');
            $table->dateTime('mtime')->nullable();
            $table->dateTime('stime')->nullable();
            $table->integer('comments_count')->nullable();
            $table->dateTime('latest_time')->nullable();
            $table->integer('likes_count')->nullable();
            $table->integer('threads_count')->nullable();
            $table->integer('replies_count')->nullable();
            $table->integer('authors_count')->nullable();
            $table->string('pageToken', 256)->nullable();
            $table->string('channelId', 32)->collation('utf8mb4_unicode_ci')->nullable();
            $table->integer('u_id')->nullable();
            $table->longText('authors_json')->nullable();
            $table->longText('comments_json')->nullable();
        });
        Schema::create('urt_comment_author', function (Blueprint $table): void {
            $table->engine = 'MyISAM';
            $table->increments('author_id');
            $table->dateTime('ctime');
            $table->dateTime('mtime')->nullable();
            $table->string('ChannelId', 32)->collation('utf8mb4_unicode_ci')->index();
            $table->string('ChannelUrl')->nullable();
            $table->string('ImageUrl', 512)->nullable();
            $table->string('DisplayName')->nullable();
        });
        Schema::create('urt_comment_rev', function (Blueprint $table): void {
            $table->engine = 'MyISAM';
            $table->integer('author_id')->primary();
            $table->dateTime('ctime');
            $table->dateTime('mtime')->nullable();
            $table->integer('comments')->nullable();
            $table->integer('videos')->nullable();
            $table->longText('index_json')->nullable();
        });
        Schema::create('urt_comment_queue', function (Blueprint $table): void {
            $table->engine = 'MyISAM';
            $table->integer('pk')->primary();
            $table->dateTime('ctime');
            $table->dateTime('stime')->nullable();
            $table->dateTime('ftime')->nullable();
            $table->string('videoId', 32)->collation('utf8mb4_unicode_ci');
        });
        Schema::create('urt_comment_queue_done', function (Blueprint $table): void {
            $table->engine = 'MyISAM';
            $table->integer('pk')->primary();
            $table->dateTime('ctime');
            $table->dateTime('stime')->nullable();
            $table->dateTime('ftime')->nullable();
            $table->string('videoId', 32)->collation('utf8mb4_unicode_ci');
        });
        foreach (YoutubeIdentifierSchema::COLUMNS as $tableName => $columns) {
            if (Schema::hasTable($tableName)) {
                continue;
            }

            Schema::create($tableName, function (Blueprint $table) use ($columns, $tableName): void {
                $table->engine = $tableName === 'urt_video_schedule'
                    ? 'InnoDB'
                    : 'MyISAM';

                foreach ($columns as $column => $definition) {
                    $field = $table->string($column, $definition['length'])
                        ->collation('utf8mb4_unicode_ci');

                    if ($definition['nullable']) {
                        $field->nullable();
                    }
                }
            });
        }
        Schema::create('ingestion_youtube_quota_daily', function (Blueprint $table): void {
            $table->engine = 'InnoDB';
            $table->id();
            $table->string('provider', 64);
            $table->date('quota_date');
            $table->unsignedBigInteger('consumed_units')->default(0);
            $table->unsignedBigInteger('reserved_units')->default(0);
            $table->timestamps();
            $table->unique(['provider', 'quota_date'], 'comment_fetch_case_quota_unique');
        });
    }

    /**
     * @return array<string, mixed>
     */
    private function queueRow(int $pk, string $videoId): array
    {
        return [
            'pk' => $pk,
            'ctime' => '2026-05-25 10:00:00',
            'stime' => null,
            'ftime' => null,
            'videoId' => $videoId,
        ];
    }

    private function exactVideoIdCount(string $table, string $videoId): int
    {
        return DB::table($table)
            ->whereRaw('BINARY `videoId` = BINARY ?', [$videoId])
            ->count();
    }
}
