<?php

namespace Tests\Feature\Notifications;

use App\Services\Notifications\TelegramDigestBroadcaster;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Factory;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
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
            $t->text('video_json')->nullable();
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
            $t->integer('likeCount')->nullable();
            $t->integer('commentCount')->nullable();
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
                'likeCount' => 1000 - $index,
                'commentCount' => 100 - $index,
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

    /**
     * @param  list<array<string, mixed>>|null  $topics
     */
    private function seedCachedDaily(?array $topics = null, string $dataType = 'oneday'): void
    {
        $topics ??= [[
            '標題' => '毒駕事件',
            '媒體事件' => [
                '三立新聞' => ['三立毒駕追蹤'],
                'TVBS NEWS' => ['TVBS修法追蹤'],
            ],
        ]];
        $topicCache = [];
        foreach ($topics as $topicIndex => $topic) {
            $title = (string) ($topic['標題'] ?? '');
            $offset = $topicIndex * 3;
            $topicCache[$title] = [
                '媒體數' => 2,
                '影片數' => 3,
                'videos' => [
                    1 => ['v'.($offset + 1), 'v'.($offset + 3)],
                    2 => ['v'.($offset + 2)],
                ],
                '角度' => ['台灣' => 3],
                '陣營' => ['民進黨' => 2, '國民黨' => 1],
                '關鍵字' => ['毒駕' => 2, '修法' => 1],
                '關鍵字次數' => ['毒駕' => 3, '修法' => 1],
                '人物' => ['卓榮泰' => 2],
                '地名' => ['台北' => 1],
                '標籤' => ['1' => 2, '2' => 1],
                '媒體明細' => [
                    [
                        'u_id' => 1,
                        '媒體' => '三立新聞',
                        '事件' => '三立毒駕追蹤',
                        '描述' => '三立整理事故責任與受害者家屬訴求。',
                        '分類' => '公共安全',
                        '角度' => '台灣',
                        '陣營' => '民進黨',
                        '關鍵字' => ['毒駕'],
                        '人物' => ['卓榮泰'],
                        '地名' => ['台北'],
                        'videoId' => ['v'.($offset + 1), 'v'.($offset + 3)],
                    ],
                    [
                        'u_id' => 2,
                        '媒體' => 'TVBS NEWS',
                        '事件' => 'TVBS修法追蹤',
                        '描述' => 'TVBS追蹤行政院與立法院修法進度。',
                        '分類' => '公共安全',
                        '角度' => '台灣',
                        '陣營' => '國民黨',
                        '關鍵字' => ['修法'],
                        '人物' => ['卓榮泰'],
                        '地名' => ['台北'],
                        'videoId' => ['v'.($offset + 2)],
                    ],
                ],
            ];
        }

        DB::table('urt_ai_date')->insert([
            'pk' => $dataType === 'oneday' ? 1 : 2,
            'date_from' => '2026-05-24 00:00:00',
            'date_to' => $dataType === 'oneday' ? '2026-05-24 23:59:59' : '2026-05-30 23:59:59',
            'condition_type' => 'all',
            'data_type' => $dataType,
            'channel_id' => json_encode(['1' => '三立新聞', '2' => 'TVBS NEWS'], JSON_UNESCAPED_UNICODE),
            'result_json' => json_encode($topics, JSON_UNESCAPED_UNICODE),
            'data_json' => json_encode($topicCache, JSON_UNESCAPED_UNICODE),
            'video_json' => json_encode(['v1' => ['title' => 'cached']], JSON_UNESCAPED_UNICODE),
        ]);
    }

    public function test_daily_run_posts_only_the_top_complete_event_with_summary(): void
    {
        $this->createDailyTable();
        $this->createTaggedVideoTables();
        $this->seedCachedDaily();

        $result = app(TelegramDigestBroadcaster::class)->run('daily');

        $this->assertSame(1, $result['posted']);
        $this->assertFalse($result['dry_run']);

        Http::assertSent(fn ($r) => str_contains($r->url(), '/botBOT/sendMessage')
            && str_contains($r['text'], '毒駕事件')
            && str_contains($r['text'], '三立新聞：三立整理事故責任與受害者家屬訴求。')
            && str_contains($r['text'], 'TVBS NEWS：TVBS追蹤行政院與立法院修法進度。')
            && str_contains($r['text'], '昨日整理　影片3、媒體3')
            && str_contains($r['text'], '<b>先看</b>'));
    }

    public function test_daily_projects_production_shaped_sources_when_cache_is_missing(): void
    {
        $this->createDailyTable();
        $this->createTaggedVideoTables();
        Schema::create('urt_channel_ai', function ($t): void {
            $t->integer('pk');
            $t->integer('u_id');
            $t->dateTime('date_from');
            $t->dateTime('date_to');
            $t->string('data_type');
            $t->integer('del_flag')->nullable();
            $t->text('result_json');
        });
        DB::table('urt_channel_ai')->insert([
            [
                'pk' => 1,
                'u_id' => 1,
                'date_from' => '2026-05-24 00:00:00',
                'date_to' => '2026-05-24 23:59:59',
                'data_type' => 'oneday',
                'result_json' => json_encode([[
                    '事件' => '三立救援追蹤',
                    '描述' => '三立新聞整理救援進度與餘震影響。',
                    '分類' => '國際',
                    '角度' => '台灣',
                    '陣營' => '民進黨',
                    '關鍵字' => ['熊本強震', '救援'],
                    '人物' => ['高市早苗'],
                    '地名' => ['熊本'],
                    'videoId' => ['v1', 'v7'],
                ]], JSON_UNESCAPED_UNICODE),
            ],
            [
                'pk' => 2,
                'u_id' => 2,
                'date_from' => '2026-05-24 00:00:00',
                'date_to' => '2026-05-24 23:59:59',
                'data_type' => 'oneday',
                'result_json' => json_encode([[
                    '事件' => 'TVBS餘震追蹤',
                    '描述' => 'TVBS NEWS追蹤餘震與交通恢復情形。',
                    '分類' => '國際',
                    '角度' => '中國',
                    '陣營' => '國民黨',
                    '關鍵字' => ['熊本強震', '餘震'],
                    '人物' => ['高市早苗'],
                    '地名' => ['熊本'],
                    'videoId' => ['v2'],
                ]], JSON_UNESCAPED_UNICODE),
            ],
        ]);
        DB::table('urt_ai_date')->insert([
            'pk' => 1,
            'date_from' => '2026-05-24 00:00:00',
            'date_to' => '2026-05-24 23:59:59',
            'condition_type' => 'all',
            'data_type' => 'oneday',
            'channel_id' => json_encode([1 => '三立新聞', 2 => 'TVBS NEWS'], JSON_UNESCAPED_UNICODE),
            'result_json' => json_encode([[
                '標題' => '熊本強震救援進展',
                '媒體事件' => [
                    '三立新聞' => ['三立救援追蹤'],
                    'TVBS NEWS' => ['TVBS餘震追蹤'],
                ],
            ]], JSON_UNESCAPED_UNICODE),
            'data_json' => null,
            'video_json' => null,
        ]);

        $result = app(TelegramDigestBroadcaster::class)->run('daily');

        $this->assertSame(1, $result['posted']);
        Http::assertSent(fn ($request): bool => str_contains($request->url(), 'sendMessage')
            && str_contains($request['text'], '熊本強震救援進展')
            && str_contains($request['text'], '三立新聞：三立新聞整理救援進度與餘震影響。')
            && str_contains($request['text'], 'TVBS NEWS：TVBS NEWS追蹤餘震與交通恢復情形。')
            && str_contains($request['text'], '人物　高市早苗')
            && str_contains($request['text'], '地名　熊本')
            && str_contains($request['text'], '<b>先看</b>'));
        $this->assertNull(DB::table('urt_ai_date')->value('data_json'));
        $this->assertNull(DB::table('urt_ai_date')->value('video_json'));
    }

    public function test_daily_skips_story_already_posted_by_hourly(): void
    {
        $this->createHourlyTable();
        $this->createDailyTable();
        $this->createTaggedVideoTables();
        Carbon::setTestNow('2026-05-24 12:05:00');
        $this->insertHourly(1, '2026-05-24 12:00:00', [[
            '事件' => '毒駕事件',
            '關鍵字' => ['毒駕', '修法'],
            '人物' => ['卓榮泰'],
            'videoId' => array_map(fn (int $index): string => 'v'.$index, range(1, 8)),
        ]]);
        $this->assertSame(1, app(TelegramDigestBroadcaster::class)->run('hourly')['posted']);
        $this->seedCachedDaily();

        $daily = app(TelegramDigestBroadcaster::class)->run('daily');

        $this->assertSame(0, $daily['posted']);
        $this->assertSame(1, $daily['skipped_seen']);
        $this->assertSame(1, DB::table('telegram_digest_stories')->count());
        Http::assertSentCount(2);
    }

    public function test_daily_falls_through_when_top_ranked_candidate_is_incomplete(): void
    {
        $this->createDailyTable();
        $this->createTaggedVideoTables();
        $this->seedCachedDaily([
            ['標題' => '第一事件', '媒體事件' => ['三立新聞' => ['a'], 'TVBS NEWS' => ['b']]],
            ['標題' => '第二事件', '媒體事件' => ['三立新聞' => ['c'], 'TVBS NEWS' => ['d']]],
        ]);
        $cache = json_decode((string) DB::table('urt_ai_date')->value('data_json'), true, 512, JSON_THROW_ON_ERROR);
        $cache['第二事件']['關鍵字'] = ['颱風' => 1];
        $cache['第二事件']['人物'] = ['氣象署' => 1];
        DB::table('urt_ai_date')->update([
            'data_json' => json_encode($cache, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
        ]);
        DB::table('urt_video')->where('videoId', 'v3')->delete();

        $result = app(TelegramDigestBroadcaster::class)->run('daily');

        $this->assertSame(1, $result['posted']);
        $this->assertSame(1, $result['skipped_incomplete']);
        Http::assertSent(fn ($request): bool => str_contains($request->url(), 'sendMessage')
            && str_contains($request['text'], '第二事件'));
        Http::assertNotSent(fn ($request): bool => str_contains($request->url(), 'sendMessage')
            && str_contains($request['text'], '第一事件'));
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
        $this->assertSame(0, $result['posted']);
        $this->assertSame(1, $result['skipped_incomplete']);
        Http::assertNotSent(fn ($request): bool => str_contains($request->url(), 'sendMessage'));
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
        $this->createTaggedVideoTables();
        $this->seedCachedDaily();

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
        $this->createTaggedVideoTables();
        $this->seedCachedDaily();
        $this->seedCachedDaily([[
            '標題' => '週報事件',
            '媒體事件' => ['三立新聞' => ['a'], 'TVBS NEWS' => ['b']],
        ]], 'week');

        $result = app(TelegramDigestBroadcaster::class)->run('daily');

        $this->assertSame(1, $result['posted']);
        Http::assertSent(fn ($r) => str_contains($r->url(), 'sendMessage') && str_contains($r['text'], '毒駕事件'));
        Http::assertNotSent(fn ($r) => str_contains($r->url(), 'sendMessage') && str_contains($r['text'], '週報事件'));
    }

    public function test_duplicate_titles_within_one_batch_post_once(): void
    {
        $this->createDailyTable();
        $this->createTaggedVideoTables();
        $this->seedCachedDaily([
            ['標題' => '毒駕事件', '媒體事件' => ['三立新聞' => ['a'], 'TVBS NEWS' => ['b']]],
            ['標題' => '毒駕事件', '媒體事件' => ['三立新聞' => ['a'], 'TVBS NEWS' => ['b']]],
        ]);

        $result = app(TelegramDigestBroadcaster::class)->run('daily');

        $this->assertSame(1, $result['posted']);
        $this->assertSame(1, $result['skipped_seen']);
    }

    public function test_zero_post_cap_disables_the_period(): void
    {
        config()->set('services.telegram.daily_max_posts', 0);
        $this->createDailyTable();
        $this->createTaggedVideoTables();
        $this->seedCachedDaily();

        $result = app(TelegramDigestBroadcaster::class)->run('daily');

        $this->assertSame(0, $result['posted']);
        Http::assertNotSent(fn ($r) => str_contains($r->url(), 'sendMessage'));
    }

    public function test_uncertain_daily_send_failure_keeps_claim_fail_closed(): void
    {
        $this->createDailyTable();
        $this->createTaggedVideoTables();
        $this->seedCachedDaily();

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
                throw new ConnectionException('timeout');
            },
        ]);

        $first = app(TelegramDigestBroadcaster::class)->run('daily');
        $second = app(TelegramDigestBroadcaster::class)->run('daily');

        $this->assertSame(0, $first['posted']);
        $this->assertSame(0, $second['posted']);
        $this->assertSame(1, $calls);
        $this->assertDatabaseHas('telegram_digest_dispatches', [
            'context_key' => 'd:2026-05-24',
            'status' => 'pending',
        ]);
    }

    public function test_explicit_daily_send_failure_releases_claim_for_retry(): void
    {
        $this->createDailyTable();
        $this->createTaggedVideoTables();
        $this->seedCachedDaily();
        Http::swap(new Factory);
        Http::fake([
            'api.openai.test/*' => Http::response([
                'choices' => [['message' => ['content' => '{"items":[]}']]],
            ]),
            'api.telegram.test/*' => Http::response(['ok' => false, 'description' => 'Bad Request'], 400),
        ]);
        Log::spy();

        $first = app(TelegramDigestBroadcaster::class)->run('daily');
        $this->assertSame(0, $first['posted']);
        Log::shouldHaveReceived('warning')->once()->with(
            'Telegram digest send failed.',
            \Mockery::on(fn (array $context): bool => $context === [
                'period' => 'daily',
                'story_id' => 1,
                'uncertain' => false,
                'error' => 'Bad Request',
            ]),
        );
        $this->assertDatabaseMissing('telegram_digest_dispatches', [
            'context_key' => 'd:2026-05-24',
        ]);

        Http::swap(new Factory);
        Http::fake([
            'api.openai.test/*' => Http::response([
                'choices' => [['message' => ['content' => '{"items":[]}']]],
            ]),
            'api.telegram.test/*' => Http::response(['ok' => true, 'result' => ['message_id' => 2]]),
        ]);
        $second = app(TelegramDigestBroadcaster::class)->run('daily');

        $this->assertSame(1, $second['posted']);
        $this->assertDatabaseHas('telegram_digest_dispatches', [
            'context_key' => 'd:2026-05-24',
            'status' => 'sent',
        ]);
    }

    public function test_existing_daily_exact_cache_is_adopted_without_reposting(): void
    {
        $this->createDailyTable();
        $this->createTaggedVideoTables();
        $this->seedCachedDaily();
        Cache::store('array')->put(
            'tg:digest:daily:d:2026-05-24:'.md5('毒駕事件'),
            true,
            now()->addDays(3),
        );

        $result = app(TelegramDigestBroadcaster::class)->run('daily');

        $this->assertSame(0, $result['posted']);
        $this->assertSame(1, $result['skipped_seen']);
        $this->assertDatabaseHas('telegram_digest_dispatches', [
            'context_key' => 'd:2026-05-24',
            'status' => 'adopted',
        ]);
        Http::assertNothingSent();
    }

    public function test_ai_failure_uses_two_named_media_descriptions_instead_of_skeleton_copy(): void
    {
        $this->createDailyTable();
        $this->createTaggedVideoTables();
        $this->seedCachedDaily();
        Http::fake([
            'api.openai.test/*' => Http::response(['error' => ['message' => 'unavailable']], 503),
            'api.telegram.test/*' => Http::response(['ok' => true, 'result' => ['message_id' => 1]]),
        ]);

        $result = app(TelegramDigestBroadcaster::class)->run('daily');

        $this->assertSame(1, $result['posted']);
        Http::assertSent(fn ($request): bool => str_contains($request->url(), 'sendMessage')
            && str_contains($request['text'], '三立新聞：三立整理事故責任與受害者家屬訴求。')
            && str_contains($request['text'], 'TVBS NEWS：TVBS追蹤行政院與立法院修法進度。')
            && str_contains($request['text'], '<blockquote expandable>'));
    }

    public function test_dry_run_when_disabled_posts_nothing_and_does_not_mark_seen(): void
    {
        config()->set('services.telegram.enabled', false);
        $this->createDailyTable();
        $this->createTaggedVideoTables();
        $this->seedCachedDaily();

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
