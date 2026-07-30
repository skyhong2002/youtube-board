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
            'summary' => '近日多起毒駕致死案件引發關注，三立聚焦肇事責任，TVBS整理修法進度。',
            'description' => '行政院與立法院討論加重刑責。',
            'category' => '公共安全',
            'angle' => '司法與修法',
            'camp' => '跨陣營',
            'keywords' => ['毒駕', '交通安全', '修法'],
            'people' => ['卓榮泰', '鍾小平'],
            'places' => ['台北'],
            'video_count' => 18,
            'media_count' => 6,
            'channel_tag_counts' => ['泛綠' => 2, '泛藍' => 2, '公共電視' => 1],
            'videos' => [
                [
                    'title' => '毒駕撞死人只判緩刑',
                    'channel' => '三立新聞',
                    'tags' => ['泛綠', '台灣立場'],
                    'group' => '泛綠',
                    'url' => 'https://www.youtube.com/watch?v=green1',
                ],
                [
                    'title' => '卓榮泰承諾加速修法',
                    'channel' => 'TVBS NEWS',
                    'tags' => ['泛藍'],
                    'group' => '泛藍',
                    'url' => 'https://www.youtube.com/watch?v=blue1',
                ],
            ],
            'url' => 'https://youtube.observe.tw/ai/days/2026-05-24',
            'label' => '2026-05-24',
        ], $overrides);
    }

    public function test_renders_compact_metadata_and_expandable_source_coverage(): void
    {
        $message = (new TelegramDigestFormatter)->format($this->post());

        $this->assertStringContainsString('<b>毒駕致死案引發修法討論</b>', $message);
        $this->assertStringContainsString('影片18、媒體6', $message);
        $this->assertStringContainsString('分類公共安全｜角度司法與修法｜陣營跨陣營', $message);
        $this->assertStringContainsString('頻道標籤　泛綠2、泛藍2、公共電視1', $message);
        $this->assertStringContainsString('關鍵字　毒駕、交通安全、修法', $message);
        $this->assertStringContainsString('人物　卓榮泰、鍾小平', $message);
        $this->assertStringContainsString('地名　台北', $message);
        $this->assertStringContainsString('<blockquote expandable>', $message);
        $this->assertStringContainsString('<b>先看</b>', $message);
        $this->assertStringContainsString('<b>三立新聞〔泛綠、台灣立場〕</b>', $message);
        $this->assertStringContainsString('href="https://www.youtube.com/watch?v=green1"', $message);
        $this->assertStringContainsString('<b>TVBS NEWS〔泛藍〕</b>', $message);
        $this->assertStringContainsString('<a href="https://youtube.observe.tw/ai/days/2026-05-24">完整整理</a>', $message);
        $this->assertStringNotContainsString('🎬', $message);
        $this->assertStringNotContainsString('🔑', $message);
        $this->assertStringNotContainsString('👤', $message);
        $this->assertStringNotContainsString('🔴', $message);
    }

    public function test_optional_metadata_is_omitted_when_absent(): void
    {
        $message = (new TelegramDigestFormatter)->format($this->post([
            'people' => [],
            'places' => [],
            'media_count' => 0,
            'channel_tag_counts' => [],
        ]));

        $this->assertStringNotContainsString('人物　', $message);
        $this->assertStringNotContainsString('地名　', $message);
        $this->assertStringNotContainsString('媒體0', $message);
        $this->assertStringNotContainsString('頻道標籤　', $message);
        $this->assertStringContainsString('影片18', $message);
    }

    public function test_html_special_characters_are_escaped_in_text_and_attributes(): void
    {
        $message = (new TelegramDigestFormatter)->format($this->post([
            'title' => 'A & B <live>',
            'summary' => 'x > y & z',
            'description' => '',
            'keywords' => [],
            'people' => [],
            'videos' => [[
                'title' => 'A&B <片>',
                'channel' => 'C&D',
                'tags' => [],
                'group' => '其他',
                'url' => 'https://www.youtube.com/watch?v=a&list=b',
            ]],
        ]));

        $this->assertStringContainsString('<b>A &amp; B &lt;live&gt;</b>', $message);
        $this->assertStringContainsString('x &gt; y &amp; z', $message);
        $this->assertStringContainsString('href="https://www.youtube.com/watch?v=a&amp;list=b"', $message);
        $this->assertStringNotContainsString('<live>', $message);
    }

    public function test_long_summary_is_trimmed_but_preserves_expandable_video_link(): void
    {
        $message = (new TelegramDigestFormatter)->format($this->post([
            'summary' => str_repeat('長句子。', 2000),
        ]));

        $this->assertLessThanOrEqual(TelegramDigestFormatter::MAX_LENGTH, $this->visibleUtf16Length($message));
        $this->assertStringContainsString('<blockquote expandable>', $message);
        $this->assertStringContainsString('https://www.youtube.com/watch?v=green1', $message);
        $this->assertStringContainsString('https://www.youtube.com/watch?v=blue1', $message);
        $this->assertStringContainsString('完整整理', $message);
        $this->assertStringContainsString('…', $message);
    }

    public function test_limit_is_enforced_in_visible_utf16_units_for_non_bmp_content(): void
    {
        $message = (new TelegramDigestFormatter)->format($this->post([
            'summary' => str_repeat('📊', 4000),
        ]));

        $this->assertLessThanOrEqual(TelegramDigestFormatter::MAX_LENGTH, $this->visibleUtf16Length($message));
        $this->assertStringContainsString('https://www.youtube.com/watch?v=green1', $message);
        $this->assertStringContainsString('https://www.youtube.com/watch?v=blue1', $message);
    }

    public function test_includes_as_many_video_links_as_fit_and_reports_the_remainder(): void
    {
        $videos = [];
        for ($index = 1; $index <= 80; $index++) {
            $videos[] = [
                'title' => str_repeat('完整新聞標題', 6).$index,
                'channel' => '新聞台'.$index,
                'tags' => [$index % 2 === 0 ? '泛藍' : '泛綠'],
                'group' => $index % 2 === 0 ? '泛藍' : '泛綠',
                'url' => 'https://www.youtube.com/watch?v=video'.$index,
            ];
        }

        $message = (new TelegramDigestFormatter)->format($this->post([
            'summary' => '事件摘要。',
            'description' => '',
            'videos' => $videos,
            'video_count' => 80,
        ]));

        preg_match_all('/youtube\.com\/watch\?v=video\d+/', $message, $matches);
        $this->assertGreaterThan(2, count($matches[0]));
        $this->assertLessThan(80, count($matches[0]));
        $this->assertMatchesRegularExpression('/其餘\d+支見完整整理/', $message);
        $this->assertLessThanOrEqual(TelegramDigestFormatter::MAX_LENGTH, $this->visibleUtf16Length($message));
    }

    private function visibleUtf16Length(string $html): int
    {
        $visible = html_entity_decode(
            strip_tags(str_replace(['<br>', '<br/>', '<br />'], "\n", $html)),
            ENT_QUOTES | ENT_HTML5,
            'UTF-8',
        );

        return intdiv(strlen(mb_convert_encoding($visible, 'UTF-16LE', 'UTF-8')), 2);
    }
}
