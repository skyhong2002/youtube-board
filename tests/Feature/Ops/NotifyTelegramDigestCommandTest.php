<?php

namespace Tests\Feature\Ops;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class NotifyTelegramDigestCommandTest extends TestCase
{
    private function configure(): void
    {
        config()->set('services.telegram.enabled', true);
        config()->set('services.telegram.bot_token', 'BOT');
        config()->set('services.telegram.channel_id', '@chan');
        config()->set('services.telegram.api_base_url', 'https://api.telegram.test');
        config()->set('services.telegram.dedup_store', 'array');
        config()->set('services.telegram.ai', [
            'base_url' => 'https://api.openai.test/v1', 'api_key' => 'sk-test',
            'model' => 'gpt-5.6-terra', 'timeout' => 30, 'max_output_tokens' => 900,
        ]);
        Http::fake([
            'api.openai.test/*' => Http::response(['choices' => [['message' => ['content' => json_encode(['items' => [[
                'title' => '毒駕事件',
                'summary' => '三立新聞整理事故責任，TVBS NEWS追蹤修法進度。',
            ]]], JSON_UNESCAPED_UNICODE)]]]]),
            'api.telegram.test/*' => Http::response(['ok' => true, 'result' => ['message_id' => 1]]),
        ]);
    }

    private function seedDaily(): void
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
        foreach (['urt_video', 'urt_channel', 'urt_count', 'urt_tag'] as $table) {
            Schema::dropIfExists($table);
        }
        Schema::create('urt_video', function ($t): void {
            $t->string('videoId');
            $t->string('title');
            $t->integer('u_id');
            $t->string('channelTitle');
            $t->integer('viewCount');
            $t->dateTime('publishedAt')->nullable();
            $t->text('thumbnails')->nullable();
        });
        Schema::create('urt_channel', function ($t): void {
            $t->integer('u_id');
            $t->string('title');
        });
        Schema::create('urt_count', function ($t): void {
            $t->integer('u_id');
            $t->string('tags');
        });
        Schema::create('urt_tag', function ($t): void {
            $t->integer('tag_id');
            $t->string('tag_name');
        });
        DB::table('urt_channel')->insert([
            ['u_id' => 1, 'title' => '三立新聞'],
            ['u_id' => 2, 'title' => 'TVBS NEWS'],
        ]);
        DB::table('urt_count')->insert([
            ['u_id' => 1, 'tags' => '[1]'],
            ['u_id' => 2, 'tags' => '[2]'],
        ]);
        DB::table('urt_tag')->insert([
            ['tag_id' => 1, 'tag_name' => '泛綠'],
            ['tag_id' => 2, 'tag_name' => '泛藍'],
        ]);
        DB::table('urt_video')->insert([
            ['videoId' => 'v1', 'title' => '毒駕責任追蹤', 'u_id' => 1, 'channelTitle' => '三立新聞', 'viewCount' => 300],
            ['videoId' => 'v2', 'title' => '毒駕修法進度', 'u_id' => 2, 'channelTitle' => 'TVBS NEWS', 'viewCount' => 200],
            ['videoId' => 'v3', 'title' => '毒駕案件整理', 'u_id' => 1, 'channelTitle' => '三立新聞', 'viewCount' => 100],
        ]);
        $topic = [
            '媒體數' => 2,
            '影片數' => 3,
            'videos' => ['1' => ['v1', 'v3'], '2' => ['v2']],
            '角度' => ['台灣' => 3],
            '陣營' => ['民進黨' => 2, '國民黨' => 1],
            '關鍵字' => ['毒駕' => 2],
            '人物' => ['卓榮泰' => 1],
            '地名' => ['台北' => 1],
            '標籤' => ['1' => 2, '2' => 1],
            '媒體明細' => [
                ['u_id' => 1, '媒體' => '三立新聞', '事件' => '毒駕責任', '描述' => '三立整理事故責任。', '分類' => '公共安全', '角度' => '台灣', '陣營' => '民進黨', '關鍵字' => ['毒駕'], '人物' => [], '地名' => ['台北'], 'videoId' => ['v1', 'v3']],
                ['u_id' => 2, '媒體' => 'TVBS NEWS', '事件' => '毒駕修法', '描述' => 'TVBS追蹤修法進度。', '分類' => '公共安全', '角度' => '台灣', '陣營' => '國民黨', '關鍵字' => ['毒駕'], '人物' => ['卓榮泰'], '地名' => ['台北'], 'videoId' => ['v2']],
            ],
        ];
        DB::table('urt_ai_date')->insert([
            'pk' => 1, 'date_from' => '2026-05-24 00:00:00', 'date_to' => '2026-05-24 23:59:59',
            'condition_type' => 'all', 'data_type' => 'oneday',
            'channel_id' => json_encode(['1' => '三立新聞', '2' => 'TVBS NEWS'], JSON_UNESCAPED_UNICODE),
            'result_json' => json_encode([['標題' => '毒駕事件', '媒體事件' => ['三立新聞' => ['毒駕責任'], 'TVBS NEWS' => ['毒駕修法']]]], JSON_UNESCAPED_UNICODE),
            'data_json' => json_encode(['毒駕事件' => $topic], JSON_UNESCAPED_UNICODE),
            'video_json' => json_encode(['v1' => ['title' => '毒駕責任追蹤']], JSON_UNESCAPED_UNICODE),
        ]);
    }

    public function test_rejects_invalid_period(): void
    {
        $this->artisan('notify:telegram:digest', ['--period' => 'weekly'])
            ->assertExitCode(1);
    }

    public function test_dry_run_prints_rendered_post_without_sending(): void
    {
        $this->configure();
        $this->seedDaily();

        $this->artisan('notify:telegram:digest', ['--period' => 'daily', '--dry-run' => true])
            ->expectsOutputToContain('三立新聞整理事故責任，TVBS NEWS追蹤修法進度。')
            ->assertExitCode(0);

        Http::assertNotSent(fn ($r) => str_contains($r->url(), 'api.telegram.test'));
    }

    public function test_run_posts_to_channel(): void
    {
        $this->configure();
        $this->seedDaily();

        $this->artisan('notify:telegram:digest', ['--period' => 'daily'])
            ->assertExitCode(0);

        Http::assertSent(fn ($r) => str_contains($r->url(), '/botBOT/sendMessage'));
    }
}
