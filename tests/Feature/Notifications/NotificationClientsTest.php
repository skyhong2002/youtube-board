<?php

namespace Tests\Feature\Notifications;

use App\Services\Notifications\EventNewsWriter;
use App\Services\Notifications\OpenAiChatClient;
use App\Services\Notifications\TelegramClient;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class NotificationClientsTest extends TestCase
{
    private function configureAi(): void
    {
        config()->set('services.telegram.ai', [
            'base_url' => 'https://api.openai.test/v1',
            'api_key' => 'sk-test-key',
            'model' => 'gpt-5.4',
            'timeout' => 30,
            'max_output_tokens' => 900,
        ]);
    }

    public function test_openai_client_posts_configured_model_and_returns_content(): void
    {
        $this->configureAi();
        Http::fake([
            'api.openai.test/*' => Http::response([
                'model' => 'gpt-5.4',
                'choices' => [['message' => ['content' => '摘要內容']]],
            ]),
        ]);

        $result = (new OpenAiChatClient)->complete('system', 'user', ['response_format' => ['type' => 'json_object']]);

        $this->assertSame('摘要內容', $result['content']);
        Http::assertSent(function ($request) {
            return str_contains($request->url(), 'api.openai.test/v1/chat/completions')
                && $request['model'] === 'gpt-5.4'
                && $request['messages'][0]['role'] === 'system'
                && $request['messages'][1]['content'] === 'user'
                && $request['response_format']['type'] === 'json_object'
                && $request->hasHeader('Authorization', 'Bearer sk-test-key');
        });
    }

    public function test_news_writer_maps_titles_to_summaries(): void
    {
        $this->configureAi();
        Http::fake([
            'api.openai.test/*' => Http::response([
                'choices' => [['message' => ['content' => json_encode([
                    'items' => [
                        ['title' => '毒駕事件', 'summary' => '摘要一'],
                        ['title' => '颱風動態', 'summary' => '摘要二'],
                    ],
                ], JSON_UNESCAPED_UNICODE)]]],
            ]),
        ]);

        $map = app(EventNewsWriter::class)->summaries([
            ['title' => '毒駕事件', 'keywords' => ['毒駕']],
            ['title' => '颱風動態', 'keywords' => ['颱風']],
        ]);

        $this->assertSame(['毒駕事件' => '摘要一', '颱風動態' => '摘要二'], $map);
    }

    public function test_news_writer_returns_empty_without_calling_model_for_no_events(): void
    {
        $this->configureAi();
        Http::fake();

        $this->assertSame([], app(EventNewsWriter::class)->summaries([]));
        Http::assertNothingSent();
    }

    public function test_news_writer_falls_back_to_empty_on_model_failure(): void
    {
        $this->configureAi();
        Http::fake(['api.openai.test/*' => Http::response('server error', 500)]);

        $this->assertSame([], app(EventNewsWriter::class)->summaries([
            ['title' => '毒駕事件', 'keywords' => ['毒駕']],
        ]));
    }

    public function test_news_writer_fallback_keeps_four_grounded_short_paragraphs(): void
    {
        $this->configureAi();
        Http::fake(['api.openai.test/*' => Http::response('server error', 500)]);

        $map = app(EventNewsWriter::class)->summaries([[
            'title' => '熊本震後救援進度',
            'description' => '熊本震後持續搜救並修復交通。',
            'keywords' => ['熊本強震', '搜救', '新幹線'],
            'group_video_counts' => ['泛綠' => 8, '泛藍' => 5],
            'media_reports' => [[
                'channel' => '三立新聞',
                'description' => '追蹤物資集散與災區支援。',
                'group' => '泛綠',
            ], [
                'channel' => 'TVBS NEWS',
                'description' => '整理道路與新幹線受損情況。',
                'group' => '泛藍',
            ]],
        ]]);

        $paragraphs = explode("\n\n", $map['熊本震後救援進度']);
        $this->assertCount(4, $paragraphs);
        $this->assertStringContainsString('泛綠來源中，三立新聞', $paragraphs[1]);
        $this->assertStringContainsString('泛藍來源中，TVBS NEWS', $paragraphs[2]);
        $this->assertStringContainsString('熊本強震、搜救、新幹線', $paragraphs[3]);
    }

    public function test_telegram_client_dry_runs_when_disabled(): void
    {
        config()->set('services.telegram.enabled', false);
        config()->set('services.telegram.bot_token', 'token');
        config()->set('services.telegram.channel_id', '@channel');
        Http::fake();

        $result = (new TelegramClient)->send(
            '<b>hi</b> <a href="https://www.youtube.com/watch?v=preview">影片</a>',
            'https://www.youtube.com/watch?v=preview',
        );

        $this->assertTrue($result['dry_run']);
        $this->assertFalse($result['sent']);
        Http::assertNothingSent();
    }

    public function test_telegram_client_sends_when_enabled_and_configured(): void
    {
        config()->set('services.telegram.enabled', true);
        config()->set('services.telegram.bot_token', 'BOTTOKEN');
        config()->set('services.telegram.channel_id', '@channel');
        config()->set('services.telegram.api_base_url', 'https://api.telegram.test');
        Http::fake(['api.telegram.test/*' => Http::response(['ok' => true, 'result' => ['message_id' => 1]])]);

        $result = (new TelegramClient)->send(
            '<b>hi</b> <a href="https://www.youtube.com/watch?v=preview">影片</a>',
            'https://www.youtube.com/watch?v=preview',
        );

        $this->assertTrue($result['sent']);
        $this->assertFalse($result['dry_run']);
        Http::assertSent(function ($request) {
            return str_contains($request->url(), '/botBOTTOKEN/sendMessage')
                && $request['chat_id'] === '@channel'
                && $request['parse_mode'] === 'HTML'
                && $request['text'] === '<b>hi</b> <a href="https://www.youtube.com/watch?v=preview">影片</a>'
                && $request['link_preview_options']['is_disabled'] === false
                && $request['link_preview_options']['url'] === 'https://www.youtube.com/watch?v=preview'
                && $request['link_preview_options']['prefer_large_media'] === true;
        });
    }
}
