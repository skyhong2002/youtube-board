<?php

namespace Tests\Feature\Notifications;

use App\Services\Notifications\TelegramDigestBroadcaster;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
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
        config()->set('services.telegram.update_cooldown_hours', 24);
        config()->set('services.telegram.update_min_videos', 5);
        config()->set('services.telegram.update_min_media', 2);
        config()->set('services.telegram.burst_cooldown_hours', 3);
        config()->set('services.telegram.burst_min_videos', 8);
        config()->set('services.telegram.burst_min_media', 3);
        config()->set('services.telegram.burst_min_new_videos', 4);
        config()->set('services.telegram.burst_baseline_hours', 3);
        config()->set('services.telegram.burst_ratio', 2.5);
        config()->set('services.telegram.dedup_store', 'array');
        config()->set('services.telegram.ai', [
            'base_url' => 'https://api.openai.test/v1',
            'api_key' => 'sk-test',
            'model' => 'gpt-5.4',
            'timeout' => 30,
            'max_output_tokens' => 900,
        ]);

        $this->fakeApis();
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();

        parent::tearDown();
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

    private function createTaggedVideoTables(int $videoCount = 30): void
    {
        foreach (['urt_video', 'urt_channel', 'urt_count', 'urt_tag'] as $table) {
            Schema::dropIfExists($table);
        }

        Schema::create('urt_video', function ($t): void {
            $t->integer('pk')->nullable();
            $t->string('videoId');
            $t->string('title')->nullable();
            $t->integer('u_id')->nullable();
            $t->string('channelTitle')->nullable();
            $t->integer('viewCount')->nullable();
            $t->dateTime('publishedAt')->nullable();
            $t->text('thumbnails')->nullable();
        });
        Schema::create('urt_channel', function ($t): void {
            $t->integer('u_id');
            $t->string('title');
        });
        Schema::create('urt_count', function ($t): void {
            $t->integer('u_id');
            $t->string('tags')->nullable();
        });
        Schema::create('urt_tag', function ($t): void {
            $t->integer('tag_id');
            $t->string('tag_name');
        });

        DB::table('urt_tag')->insert([
            ['tag_id' => 1, 'tag_name' => '泛綠'],
            ['tag_id' => 2, 'tag_name' => '泛藍'],
            ['tag_id' => 3, 'tag_name' => '公共電視'],
            ['tag_id' => 4, 'tag_name' => '台灣立場'],
        ]);

        $channels = [
            1 => ['三立新聞', '[1][4]'],
            2 => ['TVBS NEWS', '[2]'],
            3 => ['公視新聞網', '[3]'],
            4 => ['民視新聞', '[1]'],
            5 => ['東森新聞', '[2]'],
            6 => ['華視新聞', '[3]'],
        ];
        foreach ($channels as $uId => [$title, $tags]) {
            DB::table('urt_channel')->insert(['u_id' => $uId, 'title' => $title]);
            DB::table('urt_count')->insert(['u_id' => $uId, 'tags' => $tags]);
        }

        $videos = [];
        for ($index = 1; $index <= $videoCount; $index++) {
            $uId = (($index - 1) % count($channels)) + 1;
            $videos[] = [
                'pk' => $index,
                'videoId' => 'v'.$index,
                'title' => '第'.$index.'支事件影片',
                'u_id' => $uId,
                'channelTitle' => $channels[$uId][0],
                'viewCount' => 100000 - $index,
                'publishedAt' => '2026-05-24 10:00:00',
                'thumbnails' => null,
            ];
        }
        DB::table('urt_video')->insert($videos);
    }

    private function insertHourly(int $pk, string $from, array $events): void
    {
        DB::table('urt_ai_hour')->insert([
            'pk' => $pk,
            'date_from' => $from,
            'date_to' => Carbon::parse($from)->addMinutes(59)->format('Y-m-d H:i:s'),
            'condition_type' => 'all',
            'data_type' => 'hour',
            'result_json' => json_encode($events, JSON_UNESCAPED_UNICODE),
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

    public function test_hourly_run_fails_closed_when_durable_story_state_is_unavailable(): void
    {
        $this->createHourlyTable();
        $this->createVideoTable();
        Schema::dropIfExists('telegram_digest_stories');
        $this->insertHourly(1, '2026-05-24 11:00:00', [[
            '事件' => '毒駕事件',
            'videoId' => array_map(fn ($index) => "v{$index}", range(1, 9)),
        ]]);

        $result = app(TelegramDigestBroadcaster::class)->run('hourly');

        $this->assertSame(0, $result['posted']);
        Http::assertNotSent(fn ($request): bool => str_contains($request->url(), 'sendMessage'));
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
        // A live no-op is not a dry run — the summary must say so.
        $this->assertFalse($second['dry_run']);
    }

    public function test_daily_selection_ignores_week_and_period_rows(): void
    {
        $this->createDailyTable();
        $this->createVideoTable();

        DB::table('urt_ai_date')->insert([
            [
                'pk' => 1, 'date_from' => '2026-05-23 00:00:00', 'date_to' => '2026-05-23 23:59:59',
                'condition_type' => 'all', 'data_type' => 'oneday',
                'result_json' => json_encode([['標題' => '毒駕事件', 'videoId' => ['v1']]], JSON_UNESCAPED_UNICODE),
            ],
            [
                // Newer aggregate row that must NOT be published as the daily digest.
                'pk' => 2, 'date_from' => '2026-05-24 00:00:00', 'date_to' => '2026-05-30 23:59:59',
                'condition_type' => 'all', 'data_type' => 'week',
                'result_json' => json_encode([['標題' => '週報事件', 'videoId' => ['v1']]], JSON_UNESCAPED_UNICODE),
            ],
        ]);

        $result = app(TelegramDigestBroadcaster::class)->run('daily');

        $this->assertSame(1, $result['posted']);
        Http::assertSent(fn ($r) => str_contains($r->url(), 'sendMessage') && str_contains($r['text'], '毒駕事件'));
        Http::assertNotSent(fn ($r) => str_contains($r->url(), 'sendMessage') && str_contains($r['text'], '週報事件'));
    }

    public function test_duplicate_titles_within_one_batch_post_once(): void
    {
        $this->createDailyTable();
        $this->createVideoTable();
        DB::table('urt_ai_date')->insert([
            'pk' => 1, 'date_from' => '2026-05-24 00:00:00', 'date_to' => '2026-05-24 23:59:59',
            'condition_type' => 'all', 'data_type' => 'oneday',
            'result_json' => json_encode([
                ['標題' => '毒駕事件', 'videoId' => ['v1', 'v2']],
                ['標題' => '毒駕事件', 'videoId' => ['v1']],
            ], JSON_UNESCAPED_UNICODE),
        ]);

        $result = app(TelegramDigestBroadcaster::class)->run('daily');

        $this->assertSame(1, $result['posted']);
        $this->assertSame(1, $result['skipped_seen']);
    }

    public function test_zero_post_cap_disables_the_period(): void
    {
        config()->set('services.telegram.daily_max_posts', 0);
        $this->createDailyTable();
        $this->createVideoTable();
        DB::table('urt_ai_date')->insert([
            'pk' => 1, 'date_from' => '2026-05-24 00:00:00', 'date_to' => '2026-05-24 23:59:59',
            'condition_type' => 'all', 'data_type' => 'oneday',
            'result_json' => json_encode([['標題' => '毒駕事件', 'videoId' => ['v1']]], JSON_UNESCAPED_UNICODE),
        ]);

        $result = app(TelegramDigestBroadcaster::class)->run('daily');

        $this->assertSame(0, $result['posted']);
        Http::assertNotSent(fn ($r) => str_contains($r->url(), 'sendMessage'));
    }

    public function test_a_send_failure_does_not_abort_the_rest_of_the_batch(): void
    {
        $this->createDailyTable();
        $this->createVideoTable();
        DB::table('urt_ai_date')->insert([
            'pk' => 1, 'date_from' => '2026-05-24 00:00:00', 'date_to' => '2026-05-24 23:59:59',
            'condition_type' => 'all', 'data_type' => 'oneday',
            'result_json' => json_encode([
                ['標題' => '毒駕事件', 'videoId' => ['v1', 'v2']],
                ['標題' => '颱風動態', 'videoId' => ['v1']],
            ], JSON_UNESCAPED_UNICODE),
        ]);

        $calls = 0;
        Http::fake([
            'api.openai.test/*' => Http::response([
                'choices' => [['message' => ['content' => json_encode(['items' => [
                    ['title' => '毒駕事件', 'summary' => '摘要一'],
                    ['title' => '颱風動態', 'summary' => '摘要二'],
                ]], JSON_UNESCAPED_UNICODE)]]],
            ]),
            'api.telegram.test/*' => function () use (&$calls) {
                $calls++;
                if ($calls === 1) {
                    throw new ConnectionException('timeout');
                }

                return Http::response(['ok' => true, 'result' => ['message_id' => 1]]);
            },
        ]);

        $result = app(TelegramDigestBroadcaster::class)->run('daily');

        // First send times out; the second event must still be attempted and posted.
        $this->assertSame(1, $result['posted']);
        $this->assertSame(2, $calls);
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

    public function test_hourly_post_contains_system_tags_direct_links_and_large_preview(): void
    {
        Carbon::setTestNow('2026-05-24 10:05:00');
        $this->createHourlyTable();
        $this->createTaggedVideoTables();
        $this->insertHourly(1, '2026-05-24 10:00:00', [[
            '事件' => '毒駕修法進度',
            '描述' => '行政院與立法院持續討論修法。',
            '分類' => ['公共安全'],
            '角度' => '司法與修法',
            '陣營' => '跨陣營',
            '關鍵字' => ['毒駕', '修法'],
            '人物' => ['卓榮泰'],
            '地名' => ['台北'],
            'videoId' => array_map(fn (int $index): string => 'v'.$index, range(1, 8)),
        ]]);

        $result = app(TelegramDigestBroadcaster::class)->run('hourly');

        $this->assertSame(1, $result['posted']);
        Http::assertSent(function ($request): bool {
            if (! str_contains($request->url(), 'sendMessage')) {
                return false;
            }

            return str_contains($request['text'], '<blockquote expandable>')
                && str_contains($request['text'], '影片8、媒體6')
                && str_contains($request['text'], '分類公共安全｜角度司法與修法｜陣營跨陣營')
                && str_contains($request['text'], '關鍵字　毒駕、修法')
                && str_contains($request['text'], '人物　卓榮泰')
                && str_contains($request['text'], '三立新聞〔泛綠、台灣立場〕')
                && str_contains($request['text'], 'TVBS NEWS〔泛藍〕')
                && str_contains($request['text'], 'https://www.youtube.com/watch?v=v1')
                && $request['link_preview_options']['url'] === 'https://www.youtube.com/watch?v=v1'
                && $request['link_preview_options']['prefer_large_media'] === true;
        });
    }

    public function test_same_story_in_the_next_hour_is_suppressed_even_when_title_changes(): void
    {
        $this->createHourlyTable();
        $this->createTaggedVideoTables();
        Carbon::setTestNow('2026-05-24 10:05:00');
        $this->insertHourly(1, '2026-05-24 10:00:00', [[
            '事件' => '毒駕修法進度',
            '關鍵字' => ['毒駕', '修法'],
            '人物' => ['卓榮泰'],
            'videoId' => array_map(fn (int $index): string => 'v'.$index, range(1, 8)),
        ]]);
        $this->assertSame(1, app(TelegramDigestBroadcaster::class)->run('hourly')['posted']);

        Carbon::setTestNow('2026-05-24 11:05:00');
        $this->insertHourly(2, '2026-05-24 11:00:00', [[
            '事件' => '卓榮泰談毒駕修法最新進度',
            '關鍵字' => ['毒駕', '修法'],
            '人物' => ['卓榮泰'],
            'videoId' => array_map(fn (int $index): string => 'v'.$index, range(1, 8)),
        ]]);

        $result = app(TelegramDigestBroadcaster::class)->run('hourly');

        $this->assertSame(0, $result['posted']);
        $this->assertSame(1, DB::table('telegram_digest_stories')->count());
        $this->assertSame(1, DB::table('telegram_digest_stories')->value('post_count'));
    }

    public function test_follow_up_after_twenty_four_hours_uses_counts_since_previous_push(): void
    {
        $this->createHourlyTable();
        $this->createTaggedVideoTables();
        Carbon::setTestNow('2026-05-24 10:05:00');
        $this->insertHourly(1, '2026-05-24 10:00:00', [[
            '事件' => '毒駕修法進度',
            '關鍵字' => ['毒駕', '修法'],
            'videoId' => array_map(fn (int $index): string => 'v'.$index, range(1, 8)),
        ]]);
        $this->assertSame(1, app(TelegramDigestBroadcaster::class)->run('hourly')['posted']);

        Carbon::setTestNow('2026-05-25 10:05:00');
        $this->insertHourly(2, '2026-05-25 10:00:00', [[
            '事件' => '毒駕修法進度',
            '關鍵字' => ['毒駕', '修法'],
            'videoId' => array_map(fn (int $index): string => 'v'.$index, range(9, 13)),
        ]]);
        $this->fakeApis(['毒駕修法進度' => '修法出現新的討論進度。']);

        $result = app(TelegramDigestBroadcaster::class)->run('hourly');

        $this->assertSame(1, $result['posted']);
        Http::assertSent(fn ($request): bool => str_contains($request->url(), 'sendMessage')
            && str_contains($request['text'], '上次推播後　影片5、媒體5'));
        $this->assertSame(2, DB::table('telegram_digest_stories')->value('post_count'));
    }

    public function test_burst_override_posts_after_three_prior_low_activity_hours(): void
    {
        $this->createHourlyTable();
        $this->createTaggedVideoTables();
        Carbon::setTestNow('2026-05-24 10:05:00');
        $this->insertHourly(1, '2026-05-24 10:00:00', [[
            '事件' => '毒駕修法進度',
            '關鍵字' => ['毒駕', '修法'],
            'videoId' => array_map(fn (int $index): string => 'v'.$index, range(1, 8)),
        ]]);
        $this->assertSame(1, app(TelegramDigestBroadcaster::class)->run('hourly')['posted']);

        foreach ([11, 12, 13] as $hour) {
            Carbon::setTestNow("2026-05-24 {$hour}:05:00");
            $this->insertHourly($hour - 9, "2026-05-24 {$hour}:00:00", [[
                '事件' => '毒駕修法進度',
                '關鍵字' => ['毒駕', '修法'],
                'videoId' => ['v1', 'v2'],
            ]]);
            $this->assertSame(0, app(TelegramDigestBroadcaster::class)->run('hourly')['posted']);
        }

        Carbon::setTestNow('2026-05-24 14:05:00');
        $this->insertHourly(5, '2026-05-24 14:00:00', [[
            '事件' => '毒駕修法進度',
            '關鍵字' => ['毒駕', '修法'],
            'videoId' => ['v1', 'v2', 'v3', 'v4', 'v9', 'v10', 'v11', 'v12'],
        ]]);
        $this->fakeApis(['毒駕修法進度' => '一小時內報導量明顯升高。']);

        $result = app(TelegramDigestBroadcaster::class)->run('hourly');

        $this->assertSame(1, $result['posted']);
        Http::assertSent(fn ($request): bool => str_contains($request->url(), 'sendMessage')
            && str_contains($request['text'], '上次推播後　影片4、媒體4')
            && str_contains($request['text'], '為前3小時均值4倍'));
    }

    public function test_hourly_cap_is_applied_after_story_novelty_filtering(): void
    {
        config()->set('services.telegram.hourly_max_posts', 1);
        $this->createHourlyTable();
        $this->createTaggedVideoTables();
        Carbon::setTestNow('2026-05-24 10:05:00');
        $this->insertHourly(1, '2026-05-24 10:00:00', [
            ['事件' => '甲重大事件', '關鍵字' => ['甲議題'], 'videoId' => array_map(fn (int $index): string => 'v'.$index, range(1, 10))],
            ['事件' => '乙重大事件', '關鍵字' => ['乙議題'], 'videoId' => array_map(fn (int $index): string => 'v'.$index, range(11, 18))],
        ]);
        $this->fakeApis(['甲重大事件' => '甲摘要', '乙重大事件' => '乙摘要']);
        $this->assertSame(1, app(TelegramDigestBroadcaster::class)->run('hourly')['posted']);

        Carbon::setTestNow('2026-05-24 11:05:00');
        $this->insertHourly(2, '2026-05-24 11:00:00', [
            ['事件' => '甲重大事件', '關鍵字' => ['甲議題'], 'videoId' => array_map(fn (int $index): string => 'v'.$index, range(1, 10))],
            ['事件' => '乙重大事件', '關鍵字' => ['乙議題'], 'videoId' => array_map(fn (int $index): string => 'v'.$index, range(11, 18))],
        ]);
        $this->fakeApis(['甲重大事件' => '甲摘要', '乙重大事件' => '乙摘要']);

        $result = app(TelegramDigestBroadcaster::class)->run('hourly');

        $this->assertSame(1, $result['posted']);
        Http::assertSent(fn ($request): bool => str_contains($request->url(), 'sendMessage')
            && str_contains($request['text'], '乙重大事件'));
        Http::assertNotSent(fn ($request): bool => str_contains($request->url(), 'sendMessage')
            && str_contains($request['text'], '甲重大事件'));
    }

    public function test_legacy_exact_hour_cache_is_adopted_without_reposting(): void
    {
        $this->createHourlyTable();
        $this->createTaggedVideoTables();
        Carbon::setTestNow('2026-05-24 10:05:00');
        $title = '毒駕修法進度';
        $from = '2026-05-24 10:00:00';
        $this->insertHourly(1, $from, [[
            '事件' => $title,
            '關鍵字' => ['毒駕', '修法'],
            'videoId' => array_map(fn (int $index): string => 'v'.$index, range(1, 8)),
        ]]);
        Cache::store('array')->put('tg:digest:hourly:h:'.$from.':'.md5($title), true, now()->addDays(3));

        $first = app(TelegramDigestBroadcaster::class)->run('hourly');

        $this->assertSame(0, $first['posted']);
        $this->assertNotNull(DB::table('telegram_digest_stories')->value('last_posted_at'));
        $this->assertSame(1, DB::table('telegram_digest_stories')->value('post_count'));

        Carbon::setTestNow('2026-05-24 11:05:00');
        $this->insertHourly(2, '2026-05-24 11:00:00', [[
            '事件' => $title,
            '關鍵字' => ['毒駕', '修法'],
            'videoId' => array_map(fn (int $index): string => 'v'.$index, range(1, 8)),
        ]]);
        $this->assertSame(0, app(TelegramDigestBroadcaster::class)->run('hourly')['posted']);
    }
}
