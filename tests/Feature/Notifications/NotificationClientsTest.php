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
            'model' => 'gpt-5.6-terra',
            'reasoning_effort' => 'low',
            'timeout' => 30,
            'max_output_tokens' => 900,
        ]);
    }

    public function test_openai_client_posts_configured_model_and_returns_content(): void
    {
        $this->configureAi();
        Http::fake([
            'api.openai.test/*' => Http::response([
                'model' => 'gpt-5.6-terra',
                'choices' => [['message' => ['content' => '摘要內容']]],
            ]),
        ]);

        $result = (new OpenAiChatClient)->complete('system', 'user', ['response_format' => ['type' => 'json_object']]);

        $this->assertSame('摘要內容', $result['content']);
        Http::assertSent(function ($request) {
            return str_contains($request->url(), 'api.openai.test/v1/chat/completions')
                && $request['model'] === 'gpt-5.6-terra'
                && $request['reasoning_effort'] === 'low'
                && $request['max_completion_tokens'] === 900
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

    public function test_news_writer_generates_a_display_headline_with_known_video_evidence(): void
    {
        $this->configureAi();
        $headline = '沈伯洋赴信義區拜廟，批蔣市府「不知道在做什麼」';
        Http::fake(['api.openai.test/*' => Http::response([
            'choices' => [['message' => ['content' => json_encode(['items' => [[
                'title' => '沈伯洋掃街與互動活動',
                'headline' => $headline,
                'headline_video_ids' => ['41fj51cAmr0'],
                'summary' => '三立新聞LIVE報導沈伯洋赴信義區拜廟並批評蔣市府。',
            ]]], JSON_UNESCAPED_UNICODE)]]],
        ])]);

        $briefs = app(EventNewsWriter::class)->briefs([[
            'title' => '沈伯洋掃街與互動活動',
            'videos' => [[
                'video_id' => '41fj51cAmr0',
                'channel' => '三立新聞LIVE',
                'title' => '沈伯洋信義區拜廟 批蔣市府不知道在做什麼',
            ]],
        ]]);

        $this->assertSame($headline, $briefs['沈伯洋掃街與互動活動']['headline']);
        $this->assertArrayNotHasKey($headline, $briefs);
        Http::assertSent(fn ($request): bool => str_contains($request['messages'][0]['content'], '不可把問句改成確定結論')
            && str_contains($request['messages'][0]['content'], '不能當成已核實事實'));
    }

    public function test_news_writer_rejects_malformed_or_untraceable_headlines_without_losing_summary(): void
    {
        $this->configureAi();
        $headline = '介文汲稱F-16交付恐延至2030年';
        $variants = [
            [],
            ['headline' => $headline, 'headline_video_ids' => []],
            ['headline' => $headline, 'headline_video_ids' => ['invented']],
            ['headline' => $headline, 'headline_video_ids' => ['known', 'invented']],
            ['headline' => $headline, 'headline_video_ids' => [['known']]],
            ['headline' => ['wrong type'], 'headline_video_ids' => ['known']],
            ['headline' => '軍售議題', 'headline_video_ids' => ['known']],
            ['headline' => str_repeat('字', 65), 'headline_video_ids' => ['known']],
            ['headline' => $headline."\n額外一行", 'headline_video_ids' => ['known']],
        ];
        $sequence = Http::sequence();
        foreach ($variants as $variant) {
            $sequence->push(['choices' => [['message' => ['content' => json_encode(['items' => [[
                'title' => '習川會後分析', 'summary' => '中天新聞引述介文汲對軍售交付時程的推測。', ...$variant,
            ]]], JSON_UNESCAPED_UNICODE)]]]]);
        }
        Http::fake(['api.openai.test/*' => $sequence]);

        foreach ($variants as $variant) {
            $briefs = app(EventNewsWriter::class)->briefs([[
                'title' => '習川會後分析',
                'videos' => [['video_id' => 'known', 'channel' => '中天新聞', 'title' => '介文汲：66架F-16恐延到2030']],
            ]]);
            $this->assertSame('習川會後分析', $briefs['習川會後分析']['headline']);
            $this->assertSame('中天新聞引述介文汲對軍售交付時程的推測。', $briefs['習川會後分析']['summary']);
        }
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

    public function test_news_writer_video_fallback_uses_group_order_and_removes_title_noise(): void
    {
        $this->configureAi();
        Http::fake(['api.openai.test/*' => Http::response('server error', 500)]);

        $map = app(EventNewsWriter::class)->summaries([[
            'title' => '熊本震後救援進度',
            'description' => '熊本震後持續搜救並修復交通。',
            'keywords' => ['熊本強震', '搜救'],
            'group_video_counts' => ['泛綠' => 8, '泛藍' => 5],
            'videos' => [[
                'channel' => '三立新聞',
                'group' => '泛綠',
                'title' => '【#直播中LIVE】熊本物資集散與災區支援｜三立新聞 @setn',
            ], [
                'channel' => 'TVBS NEWS',
                'group' => '泛藍',
                'title' => '【國際懶人包】新幹線與道路修復進度｜TVBS新聞 @tvbsnews01',
            ]],
        ]]);

        $paragraphs = explode("\n\n", $map['熊本震後救援進度']);
        $this->assertCount(4, $paragraphs);
        $this->assertSame('泛綠來源中，三立新聞著重熊本物資集散與災區支援。', $paragraphs[1]);
        $this->assertSame('泛藍來源中，TVBS NEWS著重新幹線與道路修復進度。', $paragraphs[2]);
        $this->assertStringNotContainsString('LIVE', $map['熊本震後救援進度']);
        $this->assertStringNotContainsString('@', $map['熊本震後救援進度']);
        $this->assertStringNotContainsString('｜', $map['熊本震後救援進度']);
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
