<?php

namespace Tests\Feature\Notifications;

use App\Services\Notifications\TelegramDigestBroadcaster;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class TelegramDigestBroadcasterTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        config()->set('services.telegram.enabled', true);
        config()->set('services.telegram.bot_token', 'BOT');
        config()->set('services.telegram.channel_id', '@chan');
        config()->set('services.telegram.api_base_url', 'https://api.telegram.test');
        config()->set('services.telegram.dashboard_url', 'https://youtube.observe.tw');
        config()->set('services.telegram.hourly_min_videos', 8);
        config()->set('services.telegram.daily_max_posts', 5);
        config()->set('services.telegram.hourly_max_posts', 3);
        config()->set('services.telegram.ai', [
            'base_url' => 'https://api.openai.test/v1',
            'api_key' => 'sk-test',
            'model' => 'gpt-5.4',
            'timeout' => 30,
            'max_output_tokens' => 900,
        ]);

        $this->fakeApis();
    }

    private function fakeApis(array $summaries = ['毒駕事件' => '毒駕摘要', '颱風動態' => '颱風摘要', '小事件' => '小摘要']): void
    {
        $items = [];
        foreach ($summaries as $title => $summary) {
            $items[] = ['title' => $title, 'summary' => $summary];
        }

        Http::fake([
            'api.openai.test/*' => Http::response([
                'choices' => [['message' => ['content' => json_encode(['items' => $items], JSON_UNESCAPED_UNICODE)]]],
            ]),
            'api.telegram.test/*' => Http::response(['ok' => true, 'result' => ['message_id' => 1]]),
        ]);
    }

    private function createDailyTable(): void
    {
        Schema::dropIfExists('urt_ai_date');
        Schema::create('urt_ai_date', function ($t): void {
            $t->integer('pk');
            $t->dateTime('date_from');
            $t->dateTime('date_to');
            $t->string('condition_type')->nullable();
            $t->string('data_type')->nullable();
            $t->integer('del_flag')->nullable();
            $t->text('channel_id')->nullable();
            $t->text('result_json')->nullable();
            $t->text('data_json')->nullable();
        });
    }

    private function createHourlyTable(): void
    {
        Schema::dropIfExists('urt_ai_hour');
        Schema::create('urt_ai_hour', function ($t): void {
            $t->integer('pk');
            $t->dateTime('date_from');
            $t->dateTime('date_to')->nullable();
            $t->string('condition_type')->nullable();
            $t->string('data_type')->nullable();
            $t->integer('del_flag')->nullable();
            $t->text('result_json')->nullable();
        });
    }

    private function createVideoTable(): void
    {
        Schema::dropIfExists('urt_video');
        Schema::create('urt_video', function ($t): void {
            $t->integer('pk')->nullable();
            $t->string('videoId');
            $t->string('title')->nullable();
            $t->integer('viewCount')->nullable();
        });
        DB::table('urt_video')->insert([
            ['videoId' => 'v1', 'title' => '毒駕撞死人只判緩刑', 'viewCount' => 5000],
            ['videoId' => 'v2', 'title' => '卓榮泰承諾加速修法', 'viewCount' => 3000],
        ]);
    }

    public function test_daily_run_posts_one_message_per_event_with_summary(): void
    {
        $this->createDailyTable();
        $this->createVideoTable();

        DB::table('urt_ai_date')->insert([
            'pk' => 1,
            'date_from' => '2026-05-24 00:00:00',
            'date_to' => '2026-05-24 23:59:59',
            'condition_type' => 'all',
            'data_type' => 'oneday',
            'result_json' => json_encode([
                ['標題' => '毒駕事件', '關鍵字' => ['毒駕'], '人物' => ['卓榮泰'], 'videoId' => ['v1', 'v2'], '媒體事件' => ['三立' => ['a'], 'TVBS' => ['b']]],
                ['標題' => '颱風動態', '關鍵字' => ['颱風'], 'videoId' => ['v1'], '媒體事件' => ['東森' => ['c']]],
            ], JSON_UNESCAPED_UNICODE),
            'data_json' => null,
        ]);

        $result = app(TelegramDigestBroadcaster::class)->run('daily');

        $this->assertSame(2, $result['posted']);
        $this->assertFalse($result['dry_run']);

        Http::assertSent(fn ($r) => str_contains($r->url(), '/botBOT/sendMessage')
            && str_contains($r['text'], '毒駕事件') && str_contains($r['text'], '毒駕摘要'));
    }

    public function test_hourly_run_only_posts_events_over_video_threshold(): void
    {
        $this->createHourlyTable();
        $this->createVideoTable();

        DB::table('urt_ai_hour')->insert([
            'pk' => 1,
            'date_from' => '2026-05-24 11:00:00',
            'date_to' => '2026-05-24 11:59:59',
            'condition_type' => 'all',
            'result_json' => json_encode([
                ['事件' => '毒駕事件', 'videoId' => array_map(fn ($i) => "v$i", range(1, 9))],
                ['事件' => '小事件', 'videoId' => ['v1', 'v2']],
            ], JSON_UNESCAPED_UNICODE),
        ]);

        $result = app(TelegramDigestBroadcaster::class)->run('hourly');

        $this->assertSame(2, $result['considered']);
        $this->assertSame(1, $result['eligible']);
        $this->assertSame(1, $result['posted']);
        Http::assertSentCount(2); // 1 OpenAI + 1 Telegram
    }

    public function test_second_run_deduplicates_already_posted_events(): void
    {
        $this->createDailyTable();
        $this->createVideoTable();
        DB::table('urt_ai_date')->insert([
            'pk' => 1, 'date_from' => '2026-05-24 00:00:00', 'date_to' => '2026-05-24 23:59:59',
            'condition_type' => 'all', 'data_type' => 'oneday',
            'result_json' => json_encode([['標題' => '毒駕事件', 'videoId' => ['v1']]], JSON_UNESCAPED_UNICODE),
        ]);

        $first = app(TelegramDigestBroadcaster::class)->run('daily');
        $second = app(TelegramDigestBroadcaster::class)->run('daily');

        $this->assertSame(1, $first['posted']);
        $this->assertSame(0, $second['posted']);
        $this->assertSame(1, $second['skipped_seen']);
    }

    public function test_dry_run_when_disabled_posts_nothing_and_does_not_mark_seen(): void
    {
        config()->set('services.telegram.enabled', false);
        $this->createDailyTable();
        $this->createVideoTable();
        DB::table('urt_ai_date')->insert([
            'pk' => 1, 'date_from' => '2026-05-24 00:00:00', 'date_to' => '2026-05-24 23:59:59',
            'condition_type' => 'all', 'data_type' => 'oneday',
            'result_json' => json_encode([['標題' => '毒駕事件', 'videoId' => ['v1']]], JSON_UNESCAPED_UNICODE),
        ]);

        $result = app(TelegramDigestBroadcaster::class)->run('daily');

        $this->assertTrue($result['dry_run']);
        $this->assertSame(0, $result['posted']);
        Http::assertSent(fn ($r) => str_contains($r->url(), 'api.openai.test')); // still generates
        Http::assertNotSent(fn ($r) => str_contains($r->url(), 'api.telegram.test')); // never sends

        // enabling now should still post (not marked seen during dry-run)
        config()->set('services.telegram.enabled', true);
        $result2 = app(TelegramDigestBroadcaster::class)->run('daily');
        $this->assertSame(1, $result2['posted']);
    }
}
