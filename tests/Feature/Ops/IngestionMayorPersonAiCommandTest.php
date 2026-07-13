<?php

namespace Tests\Feature\Ops;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class IngestionMayorPersonAiCommandTest extends TestCase
{
    protected function tearDown(): void
    {
        CarbonImmutable::setTestNow();

        parent::tearDown();
    }

    public function test_mayor_person_ai_preview_and_execute_upsert_daily_rows(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 16:35:00', 'Asia/Taipei'));
        $this->createTables();
        $this->seedTaipeiDailySource();
        config()->set('services.opencode_go.api_key', 'test-key');
        config()->set('services.opencode_go.base_url', 'https://opencode.test/v1');
        config()->set('services.opencode_go.model', 'qwen-test');

        $exitCode = Artisan::call('ai:mayor-person', [
            '--city' => 'taipei',
            '--person' => '蔣萬安,沈伯洋',
            '--date' => '2026-05-24',
            '--json' => true,
        ]);
        $preview = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame('ingestion-preview', $preview['mode']);
        $this->assertSame('mayor_person_ai', $preview['source']);
        $this->assertSame(2, $preview['targets']);
        $this->assertSame(2, $preview['would_call_ai_requests']);
        $this->assertSame(0, DB::table('urt_mayor_person_ai')->count());

        Http::fake([
            'https://opencode.test/v1/chat/completions' => Http::sequence()
                ->push([
                    'choices' => [[
                        'message' => [
                            'content' => json_encode([
                                'summary' => '蔣萬安今日市政聲量升高。',
                                'what_happened' => ['媒體聚焦市政攻防'],
                                'risks' => [['level' => 'medium', 'item' => '攻防升溫', 'reason' => '代表影片留言增加']],
                                'adjustments' => ['補一段市政成果說法'],
                                'actions_today' => ['安排短影音回應'],
                                'follow_up_metrics' => ['明日觀看數 delta'],
                            ], JSON_UNESCAPED_UNICODE),
                        ],
                    ]],
                    'usage' => ['prompt_tokens' => 100, 'completion_tokens' => 30],
                ])
                ->push([
                    'choices' => [[
                        'message' => [
                            'content' => json_encode([
                                'summary' => '沈伯洋今日國會議題延燒。',
                                'what_happened' => ['媒體聚焦國會議題'],
                                'risks' => [['level' => 'low', 'item' => '資料量中等', 'reason' => '來源影片集中']],
                                'adjustments' => ['補充地方連結'],
                                'actions_today' => ['整理 Q&A'],
                                'follow_up_metrics' => ['明日影片數'],
                            ], JSON_UNESCAPED_UNICODE),
                        ],
                    ]],
                    'usage' => ['prompt_tokens' => 90, 'completion_tokens' => 28],
                ]),
        ]);

        $exitCode = Artisan::call('ai:mayor-person', [
            '--execute' => true,
            '--city' => 'taipei',
            '--person' => '蔣萬安,沈伯洋',
            '--date' => '2026-05-24',
            '--ai-call-limit' => 2,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame('execute', $payload['mode']);
        $this->assertSame(2, $payload['inserted']);
        $this->assertSame(0, $payload['skipped']);
        $this->assertSame(2, $payload['ai_call_guard']['used']);
        $this->assertDatabaseHas('urt_mayor_person_ai', [
            'city_key' => 'taipei',
            'person' => '蔣萬安',
            'the_date' => '2026-05-24',
            'ai_type' => 'qwen-test',
            'provider' => 'primary',
        ]);
        $this->assertDatabaseHas('urt_mayor_person_ai', [
            'city_key' => 'taipei',
            'person' => '沈伯洋',
            'the_date' => '2026-05-24',
            'ai_type' => 'qwen-test',
            'provider' => 'primary',
        ]);
    }

    public function test_mayor_person_db_failure_is_isolated_and_later_target_is_written(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 16:35:00', 'Asia/Taipei'));
        $this->createTables();
        $this->seedTaipeiDailySource();
        config()->set('services.opencode_go.api_key', 'test-key');
        config()->set('services.opencode_go.base_url', 'https://opencode.test/v1');
        config()->set('services.opencode_go.model', 'qwen-test');
        config()->set('services.opencode_go.fallback_api_key', null);

        DB::unprepared(<<<'SQL'
CREATE TRIGGER fail_jiang_mayor_ai
BEFORE INSERT ON urt_mayor_person_ai
WHEN NEW.person = '蔣萬安'
BEGIN
    SELECT RAISE(FAIL, 'password=mayor-db-secret');
END
SQL);

        $success = [
            'choices' => [[
                'message' => ['content' => json_encode([
                    'summary' => '候選人今日聲量摘要。',
                    'what_happened' => [],
                    'risks' => [],
                    'adjustments' => [],
                    'actions_today' => [],
                    'follow_up_metrics' => [],
                ], JSON_UNESCAPED_UNICODE)],
            ]],
        ];
        Http::fake([
            'https://opencode.test/v1/chat/completions' => Http::sequence()
                ->push($success)
                ->push($success),
        ]);

        $exitCode = Artisan::call('ai:mayor-person', [
            '--execute' => true,
            '--city' => 'taipei',
            '--person' => '蔣萬安,沈伯洋',
            '--date' => '2026-05-24',
            '--ai-call-limit' => 2,
            '--json' => true,
        ]);
        $output = trim(Artisan::output());
        $payload = json_decode($output, true);

        $this->assertSame(1, $exitCode);
        $this->assertSame(1, $payload['exit_code']);
        $this->assertSame(1, $payload['failed_rows']);
        $this->assertSame(1, $payload['failed']);
        $this->assertTrue($payload['rows'][0]['failed']);
        $this->assertFalse($payload['rows'][1]['failed']);
        $this->assertFalse(DB::table('urt_mayor_person_ai')->where('person', '蔣萬安')->exists());
        $this->assertTrue(DB::table('urt_mayor_person_ai')->where('person', '沈伯洋')->exists());
        $this->assertStringNotContainsString('mayor-db-secret', $output);
        $this->assertStringContainsString('password=<redacted>', $payload['rows'][0]['skip_reason']);
        Http::assertSentCount(2);
    }

    public function test_mayor_person_ai_isolates_candidate_write_failures_and_continues(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 16:35:00', 'Asia/Taipei'));
        $this->createTables();
        $this->seedTaipeiDailySource();
        DB::statement("CREATE TRIGGER fail_mayor_person_insert BEFORE INSERT ON urt_mayor_person_ai WHEN NEW.person = '蔣萬安' BEGIN SELECT RAISE(ABORT, 'token=mayor-super-secret'); END");
        config()->set('services.opencode_go.api_key', 'test-key');
        config()->set('services.opencode_go.base_url', 'https://opencode.test/v1');
        config()->set('services.opencode_go.model', 'qwen-test');
        Http::fake([
            'https://opencode.test/v1/chat/completions' => Http::sequence()
                ->push($this->mayorChatPayload('蔣萬安市政聲量'))
                ->push($this->mayorChatPayload('沈伯洋國會聲量')),
        ]);

        $exitCode = Artisan::call('ai:mayor-person', [
            '--execute' => true,
            '--city' => 'taipei',
            '--person' => '蔣萬安,沈伯洋',
            '--date' => '2026-05-24',
            '--ai-call-limit' => 2,
            '--json' => true,
        ]);
        $output = trim(Artisan::output());
        $payload = json_decode($output, true);

        $this->assertSame(1, $exitCode);
        $this->assertSame('partial_failure', $payload['status']);
        $this->assertSame(1, $payload['failed_rows']);
        $this->assertSame(1, $payload['inserted']);
        $this->assertSame(1, $payload['failed']);
        $this->assertSame(['沈伯洋'], DB::table('urt_mayor_person_ai')->pluck('person')->all());
        $this->assertStringNotContainsString('mayor-super-secret', $output);
        Http::assertSentCount(2);
    }

    /**
     * @return array<string, mixed>
     */
    private function mayorChatPayload(string $summary): array
    {
        return [
            'choices' => [[
                'message' => [
                    'content' => json_encode([
                        'summary' => $summary,
                        'what_happened' => ['測試事件'],
                        'risks' => [],
                        'adjustments' => [],
                        'actions_today' => [],
                        'follow_up_metrics' => [],
                    ], JSON_UNESCAPED_UNICODE),
                ],
            ]],
            'usage' => ['prompt_tokens' => 10, 'completion_tokens' => 10],
        ];
    }

    private function createTables(): void
    {
        foreach (['urt_mayor_person_ai', 'urt_show_video_tag_date', 'urt_show_tag_date', 'urt_video', 'urt_tag'] as $table) {
            Schema::dropIfExists($table);
        }

        Schema::create('urt_mayor_person_ai', function ($table): void {
            $table->increments('pk');
            $table->dateTime('ctime');
            $table->dateTime('mtime')->nullable();
            $table->string('city_key');
            $table->string('city_label');
            $table->string('person');
            $table->date('the_date');
            $table->string('ai_type')->nullable();
            $table->string('provider')->nullable();
            $table->string('user_token')->default('CLI');
            $table->text('prompt_json')->nullable();
            $table->text('source_json')->nullable();
            $table->text('result_json');
            $table->integer('del_flag')->nullable();
        });

        Schema::create('urt_show_tag_date', function ($table): void {
            $table->integer('pk');
            $table->string('tagid')->nullable();
            $table->string('tag_or')->nullable();
            $table->string('tag_not')->nullable();
            $table->date('the_date');
            $table->text('tags_views')->nullable();
            $table->text('tags_video')->nullable();
            $table->text('tags_result')->nullable();
        });

        Schema::create('urt_show_video_tag_date', function ($table): void {
            $table->integer('pk');
            $table->dateTime('ctime');
            $table->dateTime('mtime')->nullable();
            $table->date('the_date');
            $table->string('tag');
            $table->integer('count_videos')->nullable();
            $table->integer('count_tags')->nullable();
            $table->integer('count_channels')->nullable();
            $table->text('videos_json')->nullable();
            $table->text('tags_json')->nullable();
        });

        Schema::create('urt_video', function ($table): void {
            $table->string('videoId');
            $table->integer('u_id')->nullable();
            $table->string('thumbnails')->nullable();
            $table->string('channelTitle')->nullable();
            $table->dateTime('publishedAt')->nullable();
            $table->string('title')->nullable();
            $table->text('description')->nullable();
            $table->integer('viewCount')->nullable();
            $table->integer('likeCount')->nullable();
            $table->integer('commentCount')->nullable();
        });

        Schema::create('urt_tag', function ($table): void {
            $table->integer('tag_id');
            $table->string('tag_name');
        });
    }

    private function seedTaipeiDailySource(): void
    {
        DB::table('urt_tag')->insert([
            ['tag_id' => 3, 'tag_name' => '泛藍'],
            ['tag_id' => 4, 'tag_name' => '泛綠'],
            ['tag_id' => 5, 'tag_name' => '泛紅'],
            ['tag_id' => 6, 'tag_name' => '泛白'],
        ]);

        $pk = 1;
        foreach (['2026-05-23', '2026-05-24'] as $date) {
            foreach ([3, 4, 5, 6] as $tagId) {
                DB::table('urt_show_tag_date')->insert([
                    'pk' => $pk++,
                    'tagid' => (string) $tagId,
                    'tag_or' => null,
                    'tag_not' => null,
                    'the_date' => $date,
                    'tags_views' => json_encode($this->weights($tagId), JSON_UNESCAPED_UNICODE),
                    'tags_video' => json_encode($this->videoWeights($tagId), JSON_UNESCAPED_UNICODE),
                    'tags_result' => json_encode($this->weights($tagId), JSON_UNESCAPED_UNICODE),
                ]);
            }
        }

        DB::table('urt_show_video_tag_date')->insert([
            [
                'pk' => 1,
                'ctime' => '2026-05-24 00:00:00',
                'mtime' => '2026-05-24 01:00:00',
                'the_date' => '2026-05-24',
                'tag' => '蔣萬安',
                'count_videos' => 1,
                'count_tags' => 2,
                'count_channels' => 1,
                'videos_json' => json_encode(['jiang-video' => 10], JSON_UNESCAPED_UNICODE),
                'tags_json' => json_encode(['市政' => 2, '交通' => 1], JSON_UNESCAPED_UNICODE),
            ],
            [
                'pk' => 2,
                'ctime' => '2026-05-24 00:00:00',
                'mtime' => '2026-05-24 01:00:00',
                'the_date' => '2026-05-24',
                'tag' => '沈伯洋',
                'count_videos' => 1,
                'count_tags' => 2,
                'count_channels' => 1,
                'videos_json' => json_encode(['shen-video' => 20], JSON_UNESCAPED_UNICODE),
                'tags_json' => json_encode(['國會' => 2, '防衛' => 1], JSON_UNESCAPED_UNICODE),
            ],
        ]);

        DB::table('urt_video')->insert([
            [
                'videoId' => 'jiang-video',
                'u_id' => 10,
                'channelTitle' => 'City News',
                'publishedAt' => '2026-05-24 10:00:00',
                'title' => '蔣萬安市政攻防',
                'description' => '蔣萬安交通政策',
                'viewCount' => 5000,
                'likeCount' => 50,
                'commentCount' => 20,
            ],
            [
                'videoId' => 'shen-video',
                'u_id' => 20,
                'channelTitle' => 'Policy News',
                'publishedAt' => '2026-05-24 11:00:00',
                'title' => '沈伯洋國會議題',
                'description' => '沈伯洋防衛政策',
                'viewCount' => 4000,
                'likeCount' => 40,
                'commentCount' => 16,
            ],
        ]);
    }

    /**
     * @return array<string, int>
     */
    private function weights(int $tagId): array
    {
        return match ($tagId) {
            3 => ['蔣萬安' => 1000, '沈伯洋' => 50],
            4 => ['蔣萬安' => 80, '沈伯洋' => 900],
            5 => ['蔣萬安' => 300, '沈伯洋' => 60],
            default => ['蔣萬安' => 120, '沈伯洋' => 120],
        };
    }

    /**
     * @return array<string, int>
     */
    private function videoWeights(int $tagId): array
    {
        return match ($tagId) {
            3 => ['蔣萬安' => 4, '沈伯洋' => 1],
            4 => ['蔣萬安' => 1, '沈伯洋' => 4],
            default => ['蔣萬安' => 1, '沈伯洋' => 1],
        };
    }
}
