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
        config()->set('services.telegram.ai', [
            'base_url' => 'https://api.openai.test/v1', 'api_key' => 'sk-test',
            'model' => 'gpt-5.4', 'timeout' => 30, 'max_output_tokens' => 900,
        ]);
        Http::fake([
            'api.openai.test/*' => Http::response(['choices' => [['message' => ['content' => json_encode(['items' => [['title' => '毒駕事件', 'summary' => '毒駕摘要內容']]], JSON_UNESCAPED_UNICODE)]]]]),
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
            $t->text('result_json')->nullable();
            $t->text('data_json')->nullable();
        });
        DB::table('urt_ai_date')->insert([
            'pk' => 1, 'date_from' => '2026-05-24 00:00:00', 'date_to' => '2026-05-24 23:59:59',
            'condition_type' => 'all', 'data_type' => 'oneday',
            'result_json' => json_encode([['標題' => '毒駕事件', 'videoId' => ['v1']]], JSON_UNESCAPED_UNICODE),
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
            ->expectsOutputToContain('毒駕摘要內容')
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
