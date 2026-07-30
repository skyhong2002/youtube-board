<?php

namespace Tests\Unit;

use App\Services\Notifications\TelegramVideoRanker;
use PHPUnit\Framework\TestCase;

class TelegramVideoRankerTest extends TestCase
{
    public function test_representative_score_prefers_relevance_then_adds_group_and_channel_diversity(): void
    {
        $selected = (new TelegramVideoRanker)->select([
            'title' => '熊本強震救援進展',
            'keywords' => ['熊本', '救援'],
            'videos' => [
                $this->video('relevant', '熊本強震救援進展', 1, '泛綠', 1000, 0),
                $this->video('same-channel', '熊本強震救援最新', 1, '泛綠', 900, 1),
                $this->video('blue', '熊本救援與餘震消息', 2, '泛藍', 800, 2),
                $this->video('other', '熊本救援現場', 3, '其他', 700, 3),
            ],
        ]);

        $this->assertSame(['relevant', 'blue', 'other'], array_column($selected, 'video_id'));
        $this->assertSame([1, 2, 3], array_column($selected, 'u_id'));
    }

    public function test_other_group_gets_no_stance_diversity_bonus(): void
    {
        $selected = (new TelegramVideoRanker)->select([
            'title' => '共同標題',
            'keywords' => [],
            'videos' => [
                $this->video('first', '共同標題', 1, '其他', 100, 0),
                $this->video('other', '共同標題', 2, '其他', 100, 1),
                $this->video('blue', '共同標題', 3, '泛藍', 100, 2),
            ],
        ], 2);

        $this->assertSame(['first', 'blue'], array_column($selected, 'video_id'));
    }

    public function test_ties_use_views_publication_time_then_source_position(): void
    {
        $ranker = new TelegramVideoRanker;
        $event = [
            'title' => '共同標題',
            'keywords' => [],
            'videos' => [
                $this->video('old', '共同標題', 1, '其他', 100, 0, '2026-07-30 10:00:00'),
                $this->video('new', '共同標題', 2, '其他', 100, 1, '2026-07-30 11:00:00'),
            ],
        ];

        $this->assertSame('new', $ranker->select($event, 1)[0]['video_id']);

        $event['videos'][0]['published_at'] = '2026-07-30 11:00:00';
        $this->assertSame('old', $ranker->select($event, 1)[0]['video_id']);
    }

    /**
     * @return array<string, mixed>
     */
    private function video(
        string $id,
        string $title,
        int $uId,
        string $group,
        int $views,
        int $position,
        string $publishedAt = '2026-07-30 10:00:00',
    ): array {
        return [
            'video_id' => $id,
            'title' => $title,
            'u_id' => $uId,
            'channel' => 'Channel '.$uId,
            'group' => $group,
            'view_count' => $views,
            'published_at' => $publishedAt,
            'position' => $position,
            'url' => 'https://www.youtube.com/watch?v='.$id,
        ];
    }
}
