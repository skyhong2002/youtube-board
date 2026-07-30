<?php

namespace Tests\Feature\Reports;

use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class AiTopicCacheBuilderTest extends TestCase
{
    public function test_preview_reports_would_update_without_writing_cache(): void
    {
        $this->createTables();
        $this->seedCompleteDailyRow();

        $exitCode = Artisan::call('reports:ai-topic:build', [
            '--from' => '2026-05-23',
            '--condition' => 'world',
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true, 512, JSON_THROW_ON_ERROR);

        $this->assertSame(0, $exitCode);
        $this->assertSame('preview', $payload['mode']);
        $this->assertSame('success', $payload['status']);
        $this->assertSame(1, $payload['would_update']);
        $this->assertSame(0, $payload['updated']);
        $this->assertSame(['urt_ai_date.data_json', 'urt_ai_date.video_json'], $payload['write_targets']);
        $this->assertNull(DB::table('urt_ai_date')->value('data_json'));
        $this->assertNull(DB::table('urt_ai_date')->value('video_json'));
    }

    public function test_execute_writes_topic_and_video_cache_and_is_idempotent(): void
    {
        $this->createTables();
        $this->seedCompleteDailyRow();

        $exitCode = Artisan::call('reports:ai-topic:build', [
            '--from' => '2026-05-23',
            '--condition' => 'world',
            '--execute' => true,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true, 512, JSON_THROW_ON_ERROR);

        $this->assertSame(0, $exitCode);
        $this->assertSame('execute', $payload['mode']);
        $this->assertSame(1, $payload['updated']);
        $topic = json_decode((string) DB::table('urt_ai_date')->value('data_json'), true);
        $video = json_decode((string) DB::table('urt_ai_date')->value('video_json'), true);
        $this->assertSame(1, $topic['Topic A']['媒體數']);
        $this->assertSame(2, $topic['Topic A']['影片數']);
        $this->assertSame(['video-1', 'video-2'], $topic['Topic A']['videos']['10']);
        $this->assertSame(['川普' => 1], $topic['Topic A']['關鍵字']);
        $this->assertSame(['拜登' => 1], $topic['Topic A']['人物']);
        $this->assertSame(['華盛頓' => 1], $topic['Topic A']['地名']);
        $this->assertSame([
            'u_id' => 10,
            '媒體' => 'News A',
            '事件' => '事件A',
            '描述' => 'News A 追蹤外交政策進展。',
            '分類' => '國際',
            '角度' => '台灣',
            '陣營' => '民進黨',
            '關鍵字' => ['川普'],
            '人物' => ['拜登'],
            '地名' => ['華盛頓'],
            'videoId' => ['video-1', 'video-2'],
        ], $topic['Topic A']['媒體明細'][0]);
        $this->assertSame('Video 1', $video['video-1']['title']);
        $this->assertSame(120, $video['video-1']['duration']);

        $repeat = Artisan::call('reports:ai-topic:build', [
            '--from' => '2026-05-23',
            '--condition' => 'world',
            '--execute' => true,
            '--json' => true,
        ]);
        $repeatPayload = json_decode(trim(Artisan::output()), true, 512, JSON_THROW_ON_ERROR);

        $this->assertSame(0, $repeat);
        $this->assertSame(0, $repeatPayload['updated']);
        $this->assertSame(1, $repeatPayload['unchanged']);
    }

    public function test_channel_event_matching_uses_daily_identity_without_requiring_matching_data_type(): void
    {
        $this->createTables();
        $this->seedCompleteDailyRow();
        DB::table('urt_channel_ai')->update(['data_type' => 'daily']);

        $exitCode = Artisan::call('reports:ai-topic:build', [
            '--from' => '2026-05-23',
            '--condition' => 'world',
            '--execute' => true,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true, 512, JSON_THROW_ON_ERROR);

        $this->assertSame(0, $exitCode);
        $this->assertSame(1, $payload['updated']);
        $this->assertSame(2, json_decode(
            (string) DB::table('urt_ai_date')->value('data_json'),
            true,
            512,
            JSON_THROW_ON_ERROR,
        )['Topic A']['影片數']);
    }

    public function test_api_topic_route_serves_the_built_cache(): void
    {
        $this->createTables();
        $this->seedCompleteDailyRow();

        $miss = $this->getJson('/api/api_topic.php?date=2026-05-23&condition=world');
        $miss->assertOk();
        $miss->assertJsonPath('meta.cache_available', false);
        $miss->assertJsonPath('meta.cache_builder', 'reports:ai-topic:build');

        Artisan::call('reports:ai-topic:build', [
            '--from' => '2026-05-23',
            '--condition' => 'world',
            '--execute' => true,
            '--json' => true,
        ]);

        $hit = $this->getJson('/api/api_topic.php?date=2026-05-23&condition=world');
        $hit->assertOk();
        $hit->assertJsonPath('meta.source', 'urt_ai_date.data_json/video_json');
        $hit->assertJsonPath('meta.cache_available', true);
        $hit->assertJsonPath('meta.cache_writeback_skipped', false);
        $hit->assertJsonPath('result.topic.Topic A.影片數', 2);
        $hit->assertJsonPath('result.video.video-1.title', 'Video 1');
    }

    public function test_api_event_prefetch_reports_topic_cache_ownership(): void
    {
        $this->createTables();
        $this->seedCompleteDailyRow();

        $response = $this->getJson('/api/api_event.php?pk=10&event=Topic%20A&prefetch=1');

        $response->assertOk();
        $response->assertJsonPath('meta.prefetch.keyword_shells', 'empty');
        $response->assertJsonPath('meta.prefetch.topic_cache_builder', 'reports:ai-topic:build');

        $plain = $this->getJson('/api/api_event.php?pk=10&event=Topic%20A');
        $plain->assertOk();
        $this->assertArrayNotHasKey('prefetch', $plain->json('meta'));
    }

    public function test_missing_only_skips_rows_with_existing_cache(): void
    {
        $this->createTables();
        $this->seedCompleteDailyRow([
            'data_json' => json_encode(['Existing' => ['媒體數' => 1]], JSON_UNESCAPED_UNICODE),
            'video_json' => json_encode(['video-x' => ['title' => 'Kept']], JSON_UNESCAPED_UNICODE),
        ]);

        $exitCode = Artisan::call('reports:ai-topic:build', [
            '--from' => '2026-05-23',
            '--condition' => 'world',
            '--missing-only' => true,
            '--execute' => true,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true, 512, JSON_THROW_ON_ERROR);

        $this->assertSame(0, $exitCode);
        $this->assertSame(1, $payload['skipped']);
        $this->assertSame(0, $payload['updated']);
        $this->assertSame('cache_already_present', $payload['rows'][0]['blocked_reason']);
        $this->assertStringContainsString('Kept', (string) DB::table('urt_ai_date')->value('video_json'));
    }

    public function test_incomplete_channel_source_blocks_the_row_without_replacing_cache(): void
    {
        $this->createTables();
        $this->seedCompleteDailyRow([
            'data_json' => json_encode(['Existing' => ['媒體數' => 1]], JSON_UNESCAPED_UNICODE),
            'video_json' => json_encode(['video-x' => ['title' => 'Kept']], JSON_UNESCAPED_UNICODE),
        ]);
        DB::table('urt_channel_ai')->delete();

        $exitCode = Artisan::call('reports:ai-topic:build', [
            '--from' => '2026-05-23',
            '--condition' => 'world',
            '--execute' => true,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true, 512, JSON_THROW_ON_ERROR);

        $this->assertSame(1, $exitCode);
        $this->assertSame('partial_failure', $payload['status']);
        $this->assertSame(1, $payload['failed_rows']);
        $this->assertSame('incomplete_channel_source', $payload['rows'][0]['blocked_reason']);
        $this->assertStringContainsString('Kept', (string) DB::table('urt_ai_date')->value('video_json'));
    }

    public function test_missing_referenced_video_blocks_the_row(): void
    {
        $this->createTables();
        $this->seedCompleteDailyRow();
        DB::table('urt_video')->where('videoId', 'video-2')->delete();

        $exitCode = Artisan::call('reports:ai-topic:build', [
            '--from' => '2026-05-23',
            '--condition' => 'world',
            '--execute' => true,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true, 512, JSON_THROW_ON_ERROR);

        $this->assertSame(1, $exitCode);
        $this->assertSame('missing_video_source', $payload['rows'][0]['blocked_reason']);
        $this->assertNull(DB::table('urt_ai_date')->value('data_json'));
    }

    public function test_invalid_calendar_date_is_blocked_before_selection(): void
    {
        $this->createTables();

        $exitCode = Artisan::call('reports:ai-topic:build', [
            '--from' => '2026-02-31',
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true, 512, JSON_THROW_ON_ERROR);

        $this->assertSame(1, $exitCode);
        $this->assertSame('validation_failed', $payload['blocked_reason']);
        $this->assertStringContainsString('--from must be', $payload['failure_reason']);
    }

    public function test_invalid_date_range_and_pk_are_blocked(): void
    {
        $this->createTables();

        $rangeExit = Artisan::call('reports:ai-topic:build', [
            '--from' => '2026-05-24',
            '--to' => '2026-05-23',
            '--json' => true,
        ]);
        $rangePayload = json_decode(trim(Artisan::output()), true, 512, JSON_THROW_ON_ERROR);

        $pkExit = Artisan::call('reports:ai-topic:build', [
            '--pk' => '0',
            '--json' => true,
        ]);
        $pkPayload = json_decode(trim(Artisan::output()), true, 512, JSON_THROW_ON_ERROR);

        $this->assertSame(1, $rangeExit);
        $this->assertSame('invalid_date_range', $rangePayload['blocked_reason']);
        $this->assertSame(1, $pkExit);
        $this->assertSame('validation_failed', $pkPayload['blocked_reason']);
    }

    public function test_row_source_over_limit_is_blocked_before_processing(): void
    {
        $this->createTables();
        $this->seedCompleteDailyRow();
        $this->seedCompleteDailyRow([
            'pk' => 11,
            'date_from' => '2026-05-22 00:00:00',
            'date_to' => '2026-05-22 23:59:59',
        ]);

        $exitCode = Artisan::call('reports:ai-topic:build', [
            '--from' => '2026-05-22',
            '--to' => '2026-05-23',
            '--condition' => 'world',
            '--row-limit' => 1,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true, 512, JSON_THROW_ON_ERROR);

        $this->assertSame(1, $exitCode);
        $this->assertSame('row_source_limit_exceeded', $payload['blocked_reason']);
        $this->assertSame(0, $payload['selected_rows']);
    }

    public function test_missing_daily_rows_report_blocked_reason(): void
    {
        $this->createTables();

        $exitCode = Artisan::call('reports:ai-topic:build', [
            '--from' => '2026-05-23',
            '--condition' => 'world',
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true, 512, JSON_THROW_ON_ERROR);

        $this->assertSame(1, $exitCode);
        $this->assertSame('daily_rows_missing', $payload['blocked_reason']);
        $this->assertSame(0, $payload['selected_rows']);
    }

    /**
     * @param  array<string, mixed>  $overrides
     */
    private function seedCompleteDailyRow(array $overrides = []): void
    {
        DB::table('urt_ai_date')->insert(array_merge([
            'pk' => 10,
            'ctime' => '2026-05-23 00:00:00',
            'mtime' => '2026-05-23 01:00:00',
            'date_from' => '2026-05-23 00:00:00',
            'date_to' => '2026-05-23 23:59:59',
            'ai_type' => 'daily',
            'data_type' => 'oneday',
            'condition_type' => 'world',
            'user_token' => 'CLI',
            'del_flag' => null,
            'channel_id' => json_encode([10 => 'News A'], JSON_UNESCAPED_UNICODE),
            'result_json' => json_encode([
                ['標題' => 'Topic A', '媒體事件' => ['News A' => ['事件A']]],
            ], JSON_UNESCAPED_UNICODE),
            'data_json' => null,
            'video_json' => null,
        ], $overrides));
    }

    private function createTables(): void
    {
        Schema::create('urt_ai_date', function ($table): void {
            $table->integer('pk');
            $table->dateTime('ctime');
            $table->dateTime('mtime')->nullable();
            $table->dateTime('date_from');
            $table->dateTime('date_to');
            $table->string('ai_type');
            $table->string('data_type');
            $table->string('condition_type')->nullable();
            $table->string('user_token');
            $table->integer('del_flag')->nullable();
            $table->text('channel_id');
            $table->text('result_json');
            $table->text('data_json')->nullable();
            $table->longText('video_json')->nullable();
        });

        Schema::create('urt_ai_period', function ($table): void {
            $table->integer('pk');
            $table->dateTime('date_from');
            $table->dateTime('date_to');
            $table->string('condition_type')->nullable();
            $table->integer('del_flag')->nullable();
            $table->text('result_json')->nullable();
            $table->text('data_json')->nullable();
        });

        Schema::create('urt_channel_ai', function ($table): void {
            $table->integer('pk');
            $table->integer('u_id');
            $table->dateTime('ctime');
            $table->dateTime('mtime')->nullable();
            $table->dateTime('date_from')->nullable();
            $table->dateTime('date_to')->nullable();
            $table->string('ai_type');
            $table->string('data_type');
            $table->string('user_token');
            $table->integer('del_flag')->nullable();
            $table->text('result_json');
        });

        DB::table('urt_channel_ai')->insert([
            'pk' => 1,
            'u_id' => 10,
            'ctime' => '2026-05-23 00:00:00',
            'mtime' => '2026-05-23 01:00:00',
            'date_from' => '2026-05-23 00:00:00',
            'date_to' => '2026-05-23 23:59:59',
            'ai_type' => 'daily',
            'data_type' => 'oneday',
            'user_token' => 'CLI',
            'del_flag' => null,
            'result_json' => json_encode([
                [
                    '事件' => '事件A',
                    'videoId' => ['video-1', 'video-2'],
                    '關鍵字' => ['川普'],
                    '人物' => ['拜登'],
                    '地名' => ['華盛頓'],
                    '描述' => 'News A 追蹤外交政策進展。',
                    '分類' => '國際',
                    '角度' => '台灣',
                    '陣營' => '民進黨',
                ],
            ], JSON_UNESCAPED_UNICODE),
        ]);

        Schema::create('urt_count', function ($table): void {
            $table->integer('u_id');
            $table->string('tags')->nullable();
        });

        DB::table('urt_count')->insert(['u_id' => 10, 'tags' => '[1][102]']);

        Schema::create('urt_video', function ($table): void {
            $table->string('videoId');
            $table->string('title')->nullable();
            $table->integer('u_id')->nullable();
            $table->dateTime('publishedAt')->nullable();
            $table->text('thumbnails')->nullable();
            $table->integer('viewCount')->nullable();
            $table->integer('likeCount')->nullable();
            $table->integer('commentCount')->nullable();
        });

        DB::table('urt_video')->insert([
            [
                'videoId' => 'video-1',
                'title' => 'Video 1',
                'u_id' => 10,
                'publishedAt' => '2026-05-23 08:00:00',
                'thumbnails' => 'https://img.example/1.jpg',
                'viewCount' => 100,
                'likeCount' => 10,
                'commentCount' => 1,
            ],
            [
                'videoId' => 'video-2',
                'title' => 'Video 2',
                'u_id' => 10,
                'publishedAt' => '2026-05-23 09:00:00',
                'thumbnails' => 'https://img.example/2.jpg',
                'viewCount' => 200,
                'likeCount' => 20,
                'commentCount' => 2,
            ],
        ]);

        Schema::create('urt_video_duration', function ($table): void {
            $table->integer('pk_video');
            $table->string('videoId');
            $table->integer('duration')->nullable();
        });

        DB::table('urt_video_duration')->insert([
            ['pk_video' => 1, 'videoId' => 'video-1', 'duration' => 120],
            ['pk_video' => 2, 'videoId' => 'video-2', 'duration' => 240],
        ]);
    }
}
