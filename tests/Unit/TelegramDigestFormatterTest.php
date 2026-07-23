<?php

namespace Tests\Unit;

use App\Services\Notifications\TelegramDigestFormatter;
use PHPUnit\Framework\TestCase;

class TelegramDigestFormatterTest extends TestCase
{
    private function daily(array $events): array
    {
        return [
            'period' => 'daily',
            'label' => '2026-05-24',
            'url' => 'https://youtube.observe.tw/ai/days/2026-05-24',
            'events' => $events,
        ];
    }

    public function test_daily_message_renders_heading_events_and_link(): void
    {
        $message = (new TelegramDigestFormatter)->format($this->daily([
            ['title' => '毒駕事件', 'keywords' => ['毒駕', '交通'], 'people' => ['卓榮泰'], 'video_count' => 5, 'media_count' => 2],
        ]), 8);

        $this->assertStringContainsString('每日精華', $message);
        $this->assertStringContainsString('2026-05-24', $message);
        $this->assertStringContainsString('毒駕事件', $message);
        $this->assertStringContainsString('毒駕、交通', $message);
        $this->assertStringContainsString('卓榮泰', $message);
        $this->assertStringContainsString('5 部影片・2 家媒體', $message);
        $this->assertStringContainsString('<a href="https://youtube.observe.tw/ai/days/2026-05-24">完整整理</a>', $message);
    }

    public function test_hourly_uses_realtime_heading(): void
    {
        $message = (new TelegramDigestFormatter)->format([
            'period' => 'hourly',
            'label' => '2026-05-24 11時',
            'url' => 'https://youtube.observe.tw/ai/hours?date=2026-05-24',
            'events' => [['title' => '最新事件', 'keywords' => [], 'people' => [], 'video_count' => 3, 'media_count' => 0]],
        ], 8);

        $this->assertStringContainsString('即時重大事件', $message);
        $this->assertStringContainsString('2026-05-24 11時', $message);
        $this->assertStringContainsString('3 部影片', $message);
        $this->assertStringNotContainsString('家媒體', $message);
    }

    public function test_html_special_characters_are_escaped(): void
    {
        $message = (new TelegramDigestFormatter)->format($this->daily([
            ['title' => 'A & B <live>', 'keywords' => ['x>y'], 'people' => [], 'video_count' => 0, 'media_count' => 0],
        ]), 8);

        $this->assertStringContainsString('A &amp; B &lt;live&gt;', $message);
        $this->assertStringContainsString('x&gt;y', $message);
        $this->assertStringNotContainsString('<live>', $message);
    }

    public function test_events_beyond_cap_are_summarized(): void
    {
        $events = [];
        for ($i = 1; $i <= 10; $i++) {
            $events[] = ['title' => "事件{$i}", 'keywords' => [], 'people' => [], 'video_count' => 1, 'media_count' => 0];
        }

        $message = (new TelegramDigestFormatter)->format($this->daily($events), 3);

        $this->assertStringContainsString('事件1', $message);
        $this->assertStringContainsString('事件3', $message);
        $this->assertStringNotContainsString('事件4', $message);
        $this->assertStringContainsString('另有 7 則事件', $message);
    }

    public function test_message_never_exceeds_telegram_limit(): void
    {
        $events = [];
        for ($i = 1; $i <= 200; $i++) {
            $events[] = ['title' => str_repeat('長標題', 40)." {$i}", 'keywords' => ['關鍵字'], 'people' => ['人物'], 'video_count' => 9, 'media_count' => 3];
        }

        $message = (new TelegramDigestFormatter)->format($this->daily($events), 200);

        $this->assertLessThanOrEqual(TelegramDigestFormatter::MAX_LENGTH, mb_strlen($message, 'UTF-8'));
        $this->assertStringContainsString('完整整理', $message);
    }
}
