<?php

namespace Tests\Unit;

use App\Services\Notifications\TelegramDigestFormatter;
use PHPUnit\Framework\TestCase;

class TelegramDigestFormatterTest extends TestCase
{
    private function post(array $overrides = []): array
    {
        return array_merge([
            'title' => '毒駕致死案引發修法討論',
            'summary' => '近日多起毒駕致死案件在新聞頻道引發關注，各家媒體聚焦肇事責任與法規漏洞。',
            'keywords' => ['毒駕', '交通安全', '修法'],
            'people' => ['卓榮泰', '鍾小平'],
            'video_count' => 18,
            'media_count' => 6,
            'url' => 'https://youtube.observe.tw/ai/days/2026-05-24',
            'label' => '2026-05-24',
        ], $overrides);
    }

    public function test_renders_headline_summary_facets_and_footer(): void
    {
        $message = (new TelegramDigestFormatter)->format($this->post());

        $this->assertStringContainsString('<b>毒駕致死案引發修法討論</b>', $message);
        $this->assertStringContainsString('各家媒體聚焦肇事責任', $message);
        $this->assertStringContainsString('18 部影片・6 家媒體', $message);
        $this->assertStringContainsString('🔑 毒駕・交通安全・修法', $message);
        $this->assertStringContainsString('👤 卓榮泰、鍾小平', $message);
        $this->assertStringContainsString('<a href="https://youtube.observe.tw/ai/days/2026-05-24">相關影片整理</a> · 2026-05-24', $message);
    }

    public function test_breaking_flag_prefixes_headline(): void
    {
        $message = (new TelegramDigestFormatter)->format($this->post(['breaking' => true]));

        $this->assertStringContainsString('<b>🔴 毒駕致死案引發修法討論</b>', $message);
    }

    public function test_optional_facets_are_omitted_when_absent(): void
    {
        $message = (new TelegramDigestFormatter)->format($this->post([
            'summary' => '一段不含特定字詞的測試摘要。',
            'people' => [],
            'media_count' => 0,
        ]));

        $this->assertStringNotContainsString('👤', $message);
        $this->assertStringNotContainsString('家媒體', $message);
        $this->assertStringContainsString('18 部影片', $message);
    }

    public function test_html_special_characters_are_escaped(): void
    {
        $message = (new TelegramDigestFormatter)->format($this->post([
            'title' => 'A & B <live>',
            'summary' => 'x > y & z',
            'keywords' => [],
            'people' => [],
        ]));

        $this->assertStringContainsString('<b>A &amp; B &lt;live&gt;</b>', $message);
        $this->assertStringContainsString('x &gt; y &amp; z', $message);
        $this->assertStringNotContainsString('<live>', $message);
    }

    public function test_long_summary_is_trimmed_under_the_limit(): void
    {
        $message = (new TelegramDigestFormatter)->format($this->post([
            'summary' => str_repeat('長句子。', 2000),
        ]));

        $this->assertLessThanOrEqual(TelegramDigestFormatter::MAX_LENGTH, mb_strlen($message, 'UTF-8'));
        $this->assertStringContainsString('<b>毒駕致死案引發修法討論</b>', $message);
        $this->assertStringContainsString('相關影片整理', $message);
        $this->assertStringContainsString('…', $message);
    }
}
