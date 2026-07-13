<?php

namespace Tests\Feature\Ops;

use App\Services\Ingestion\IngestionJobRegistry;
use App\Services\Ingestion\PhotoCacheBuilder;
use Carbon\CarbonImmutable;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class IngestionPhotoCacheCommandTest extends TestCase
{
    protected function tearDown(): void
    {
        CarbonImmutable::setTestNow();

        parent::tearDown();
    }

    public function test_preview_derives_capped_local_tags_dry_run_wins_and_does_not_call_wikipedia(): void
    {
        $this->createTables();
        $this->seedTag('低順位', 10);
        $this->seedTag('最高順位', 30);
        $this->seedTag('次高順位', 20);
        DB::table('urt_show_photo')->insert([
            'ctime' => '2026-05-24 00:00:00',
            'mtime' => null,
            'tag' => '最高順位',
            'image_url' => 'https://example.test/cached.jpg',
            'image_source' => 'import',
        ]);
        Http::preventStrayRequests();

        $exitCode = Artisan::call('reports:photos:build', [
            '--limit' => 2,
            '--execute' => true,
            '--dry-run' => true,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame('ingestion-preview', $payload['mode']);
        $this->assertSame('local_tags', $payload['source']);
        $this->assertSame(['最高順位', '次高順位'], $payload['selected_tags']);
        $this->assertSame(2, $payload['tag_limit']);
        $this->assertSame(1, $payload['cached']);
        $this->assertSame(1, $payload['would_insert']);
        $this->assertSame(0, $payload['external_requests']);
        $this->assertSame(0, $payload['writes']);
        $this->assertSame(1, DB::table('urt_show_photo')->count());
        Http::assertNothingSent();
    }

    public function test_execute_writes_cache_that_actual_api_reads_and_second_run_is_idempotent(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 04:00:00', 'Asia/Taipei'));
        $this->createTables();
        $imageUrl = 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/person.jpg/500px-person.jpg';
        Http::fake([
            'zh.wikipedia.org/*' => Http::response([
                'query' => [
                    'pages' => [
                        '123' => ['thumbnail' => ['source' => $imageUrl]],
                    ],
                ],
            ]),
        ]);

        $first = $this->runExecute('柯文哲');

        $this->assertSame(1, $first['inserted']);
        $this->assertSame(1, $first['writes']);
        $this->assertSame('wiki', DB::table('urt_show_photo')->value('image_source'));
        $this->assertSame($imageUrl, DB::table('urt_show_photo')->value('image_url'));
        Http::assertSent(function (Request $request): bool {
            parse_str((string) parse_url($request->url(), PHP_URL_QUERY), $query);

            return $request->method() === 'GET'
                && ($query['action'] ?? null) === 'query'
                && ($query['prop'] ?? null) === 'pageimages'
                && ($query['titles'] ?? null) === '柯文哲'
                && ($query['pithumbsize'] ?? null) === '500';
        });

        $response = $this->get('/api/api_get_photo.php?tag='.urlencode('柯文哲'));
        $response->assertOk();
        $response->assertHeader('Content-Type', 'text/plain; charset=UTF-8');
        $response->assertHeader('X-Youtube-Board-Data-Source', 'true');
        $this->assertSame($imageUrl, $response->getContent());

        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 05:00:00', 'Asia/Taipei'));
        $second = $this->runExecute('柯文哲');

        $this->assertSame(1, $second['cached']);
        $this->assertSame(1, $second['unchanged']);
        $this->assertSame(0, $second['external_requests']);
        $this->assertSame(0, $second['writes']);
        $this->assertSame(1, DB::table('urt_show_photo')->count());
        Http::assertSentCount(1);
    }

    public function test_http_failure_retries_are_bounded_isolated_and_return_nonzero(): void
    {
        $this->createTables();
        Http::fakeSequence()
            ->pushStatus(503)
            ->pushStatus(503)
            ->push([
                'query' => [
                    'pages' => [
                        ['thumbnail' => ['source' => 'https://upload.wikimedia.org/good.jpg']],
                    ],
                ],
            ]);

        $exitCode = Artisan::call('reports:photos:build', [
            '--tags' => '失敗標籤,成功標籤',
            '--execute' => true,
            '--json' => true,
        ]);
        $output = trim(Artisan::output());
        $payload = json_decode($output, true);

        $this->assertSame(1, $exitCode);
        $this->assertSame(1, $payload['failed_tags']);
        $this->assertSame(1, $payload['inserted']);
        $this->assertSame(2, $payload['external_requests']);
        $this->assertSame('failed', $payload['rows'][0]['status']);
        $this->assertSame('http_503', $payload['rows'][0]['reason']);
        $this->assertSame('inserted', $payload['rows'][1]['status']);
        $this->assertSame(['成功標籤'], DB::table('urt_show_photo')->pluck('tag')->all());
        $this->assertStringNotContainsString('SQLSTATE', $output);
        Http::assertSentCount(3);
    }

    public function test_unsafe_thumbnail_url_is_rejected_without_writing(): void
    {
        $this->createTables();
        Http::fake([
            'zh.wikipedia.org/*' => Http::response([
                'query' => [
                    'pages' => [
                        ['thumbnail' => ['source' => 'http://private.example.test/photo.jpg']],
                    ],
                ],
            ]),
        ]);

        $exitCode = Artisan::call('reports:photos:build', [
            '--tags' => '不安全來源',
            '--execute' => true,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(1, $exitCode);
        $this->assertSame(1, $payload['failed_tags']);
        $this->assertSame('unsafe_thumbnail_url', $payload['rows'][0]['reason']);
        $this->assertSame(0, DB::table('urt_show_photo')->count());
    }

    public function test_row_write_failure_is_isolated_and_output_is_sanitized(): void
    {
        $this->createTables();
        DB::statement(<<<'SQL'
            CREATE TRIGGER block_failed_photo
            BEFORE INSERT ON urt_show_photo
            WHEN NEW.tag = '寫入失敗'
            BEGIN
                SELECT RAISE(ABORT, 'private database detail');
            END
            SQL);
        Http::fake(function (Request $request) {
            parse_str((string) parse_url($request->url(), PHP_URL_QUERY), $query);
            $tag = (string) ($query['titles'] ?? 'unknown');

            return Http::response([
                'query' => [
                    'pages' => [
                        ['thumbnail' => ['source' => 'https://upload.wikimedia.org/'.sha1($tag).'.jpg']],
                    ],
                ],
            ]);
        });

        $exitCode = Artisan::call('reports:photos:build', [
            '--tags' => '寫入失敗,寫入成功',
            '--execute' => true,
            '--json' => true,
        ]);
        $output = trim(Artisan::output());
        $payload = json_decode($output, true);

        $this->assertSame(1, $exitCode);
        $this->assertSame(1, $payload['failed_tags']);
        $this->assertSame(1, $payload['inserted']);
        $this->assertSame('row_processing_failed', $payload['rows'][0]['reason']);
        $this->assertSame(['寫入成功'], DB::table('urt_show_photo')->pluck('tag')->all());
        $this->assertStringNotContainsString('private database detail', $output);
        $this->assertStringNotContainsString('SQLSTATE', $output);
    }

    public function test_missing_schema_empty_input_and_lock_return_nonzero_without_external_calls(): void
    {
        Http::preventStrayRequests();
        $missing = Artisan::call('reports:photos:build', [
            '--tags' => '測試',
            '--execute' => true,
            '--json' => true,
        ]);
        $missingPayload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(1, $missing);
        $this->assertSame('missing_table:urt_show_photo', $missingPayload['blocked_reason']);

        $this->createTables();
        $empty = Artisan::call('reports:photos:build', ['--json' => true]);
        $emptyPayload = json_decode(trim(Artisan::output()), true);
        $this->assertSame(1, $empty);
        $this->assertSame('no_candidate_tags', $emptyPayload['blocked_reason']);

        $lock = Cache::lock('ingestion:reports.photos.build', 60);
        $this->assertTrue($lock->get());

        try {
            $locked = Artisan::call('reports:photos:build', [
                '--tags' => '測試',
                '--execute' => true,
                '--json' => true,
            ]);
            $lockedPayload = json_decode(trim(Artisan::output()), true);
            $this->assertSame(1, $locked);
            $this->assertSame('lock_busy', $lockedPayload['blocked_reason']);
        } finally {
            $lock->release();
        }

        Http::assertNothingSent();
    }

    public function test_registry_entry_is_planned_manual_only_and_never_scheduled(): void
    {
        $job = app(IngestionJobRegistry::class)->find('reports.photos.build');

        $this->assertNotNull($job);
        $this->assertSame('planned', $job['status']);
        $this->assertSame('manual', $job['schedule']);
        $this->assertSame('reports:photos:build', $job['modern_command']);
        $this->assertSame('', $job['scheduled_execute_command']);
        $this->assertTrue($job['command_exists']);
        $this->assertFalse(app(IngestionJobRegistry::class)->scheduledWriteProfile($job)['allowed']);
    }

    public function test_lock_ttl_covers_maximum_bounded_http_workload(): void
    {
        $this->createTables();
        $tags = collect(range(1, 100))->map(fn (int $index): string => '人物'.$index)->all();

        $payload = app(PhotoCacheBuilder::class)->build(
            onlyTags: $tags,
            limit: 100,
        );

        $this->assertSame(100, $payload['tags_selected']);
        $this->assertSame(2620, $payload['lock']['ttl_seconds']);
        $this->assertSame(0, $payload['external_requests']);
        Http::assertNothingSent();
    }

    /**
     * @return array<string, mixed>
     */
    private function runExecute(string $tags): array
    {
        $exitCode = Artisan::call('reports:photos:build', [
            '--tags' => $tags,
            '--execute' => true,
            '--json' => true,
        ]);
        $output = trim(Artisan::output());

        $this->assertSame(0, $exitCode, $output);

        return json_decode($output, true);
    }

    private function createTables(): void
    {
        Schema::create('tags', function ($table): void {
            $table->increments('pk');
            $table->string('tag', 64);
            $table->integer('max_count')->default(0);
            $table->boolean('no_tag')->nullable();
        });
        Schema::create('urt_show_photo', function ($table): void {
            $table->increments('pk');
            $table->dateTime('ctime');
            $table->dateTime('mtime')->nullable();
            $table->string('tag', 32);
            $table->string('image_url', 256);
            $table->string('image_source', 32)->nullable();
        });
    }

    private function seedTag(string $tag, int $maxCount): void
    {
        DB::table('tags')->insert([
            'tag' => $tag,
            'max_count' => $maxCount,
            'no_tag' => null,
        ]);
    }
}
