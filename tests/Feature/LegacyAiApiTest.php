<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class LegacyAiApiTest extends TestCase
{
    public function test_ai_day_api_returns_daily_topics_and_channel_ai_read_only(): void
    {
        $this->createAiDateTable();
        $this->createChannelAiTable();
        $this->insertAiDayFixture();

        $response = $this->getJson('/api/ai_day.php?date=2026-05-23&condition=world');

        $response->assertOk();
        $response->assertJsonPath('meta.source', 'urt_ai_date + urt_channel_ai');
        $response->assertJsonPath('meta.read_only', true);
        $response->assertJsonPath('date', '2026-05-23');
        $response->assertJsonPath('result.0.標題', 'Topic A');
        $response->assertJsonPath('channel.10.0.事件', '事件A');
        $this->assertSame('News A', $response->json('channel_id')['10']);
        $this->assertSame(1, DB::table('urt_ai_date')->count());
        $this->assertSame(1, DB::table('urt_channel_ai')->count());
    }

    public function test_api_topic_uses_cached_topic_and_video_json_without_writeback(): void
    {
        $this->createAiDateTable();
        $this->insertAiDayFixture([
            'data_json' => json_encode(['Topic A' => ['媒體數' => 1, '影片數' => 2]], JSON_UNESCAPED_UNICODE),
            'video_json' => json_encode(['video-a' => ['title' => 'Video A']], JSON_UNESCAPED_UNICODE),
        ]);

        $response = $this->getJson('/api/api_topic.php?date=2026-05-23&condition=world');

        $response->assertOk();
        $response->assertJsonPath('meta.source', 'urt_ai_date.data_json/video_json');
        $response->assertJsonPath('meta.cache_writeback_skipped', false);
        $response->assertJsonPath('result.topic.Topic A.影片數', 2);
        $response->assertJsonPath('result.video.video-a.title', 'Video A');
        $this->assertSame(1, DB::table('urt_ai_date')->count());
    }

    public function test_api_event_returns_current_match_and_marks_missing_period_history(): void
    {
        $this->createAiDateTable();
        $this->createAiPeriodTable();
        $this->insertAiDayFixture();

        $response = $this->getJson('/api/api_event.php?pk=10&event=Topic%20A&prefetch=1');

        $response->assertOk();
        $response->assertJsonPath('meta.history_available', false);
        $response->assertJsonPath('meta.period_rows', 0);
        $this->assertSame(['Topic A'], $response->json('result.match.2026-05-23'));
        $this->assertSame('10', $response->json('result.pk.2026-05-23'));
        $this->assertSame(0, DB::table('urt_ai_period')->count());
    }

    public function test_api_comment_reads_local_comment_and_skips_log_api_insert(): void
    {
        $this->createCommentTable();
        $this->createLogApiTable();
        DB::table('urt_comment')->insert([
            'pk' => 1,
            'videoId' => 'video-a',
            'ctime' => '2026-05-23 00:00:00',
            'mtime' => '2026-05-23 01:00:00',
            'stime' => null,
            'comments_count' => 1,
            'latest_time' => '2026-05-23 00:30:00',
            'authors_json' => json_encode(['author-a' => 1], JSON_UNESCAPED_UNICODE),
            'comments_json' => json_encode(['comment-a' => ['text' => 'hello']], JSON_UNESCAPED_UNICODE),
        ]);

        $response = $this->getJson('/api/api_comment.php?videoId=video-a&token=test-token');

        $response->assertOk();
        $response->assertJsonPath('meta.log_write_skipped', 'legacy urt_log_api insert is intentionally omitted');
        $response->assertJsonPath('result.comment-a.text', 'hello');
        $response->assertJsonPath('authors.author-a', 1);
        $this->assertSame(0, DB::table('urt_log_api')->count());
    }

    /**
     * @param array<string, mixed> $overrides
     */
    private function insertAiDayFixture(array $overrides = []): void
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

    private function createAiDateTable(): void
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
    }

    private function createChannelAiTable(): void
    {
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
                ['事件' => '事件A', 'videoId' => ['video-a'], '關鍵字' => ['川普'], '人物' => ['拜登']],
            ], JSON_UNESCAPED_UNICODE),
        ]);
    }

    private function createAiPeriodTable(): void
    {
        Schema::create('urt_ai_period', function ($table): void {
            $table->integer('pk');
            $table->dateTime('date_from');
            $table->dateTime('date_to');
            $table->string('condition_type')->nullable();
            $table->integer('del_flag')->nullable();
            $table->text('result_json')->nullable();
            $table->text('data_json')->nullable();
        });
    }

    private function createCommentTable(): void
    {
        Schema::create('urt_comment', function ($table): void {
            $table->integer('pk');
            $table->string('videoId');
            $table->dateTime('ctime');
            $table->dateTime('mtime')->nullable();
            $table->dateTime('stime')->nullable();
            $table->integer('comments_count')->nullable();
            $table->dateTime('latest_time')->nullable();
            $table->longText('authors_json')->nullable();
            $table->longText('comments_json')->nullable();
        });
    }

    private function createLogApiTable(): void
    {
        Schema::create('urt_log_api', function ($table): void {
            $table->integer('pk')->nullable();
            $table->dateTime('ctime');
            $table->dateTime('created_time');
            $table->string('api_type');
            $table->string('api_key');
            $table->string('token');
        });
    }
}
