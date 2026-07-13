<?php

namespace Tests\Feature\Reports;

use Illuminate\Support\Facades\Storage;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

class ReportLineageExpansionTest extends TestCase
{
    public function test_tag_video_channel_and_comment_pages_render_lineage_profiles(): void
    {
        Storage::fake('local');

        $cases = [
            '/tags/1/videos' => [
                'urt_video',
                'youtube:channels:videos --execute --limit=5 --max-results=3',
                'YouTube Data API playlistItems.list(part=snippet)',
                'TagVideosReport',
                '固定規則：隨部署更新',
            ],
            '/tags/1/channels' => [
                'urt_count',
                'youtube:channels:stats --execute --limit=25',
                'reports:counts:build --execute --limit=500',
                'TagChannelRankingReport',
                '固定規則：隨部署更新',
            ],
            '/tags/1/comments' => [
                'urt_comment',
                'youtube:comments:fetch --execute --limit=5 --max-pages=1 --max-reply-pages=20',
                'YouTube Data API commentThreads.list',
                'TagCommentsReport',
                '固定規則：隨部署更新',
            ],
        ];

        foreach ($cases as $uri => $expected) {
            $response = $this->get($uri);

            $this->assertLineageShell($response);

            foreach ($expected as $text) {
                $response->assertSee($text, false);
            }
        }
    }

    public function test_keyword_day_and_video_pages_render_lineage_profiles(): void
    {
        Storage::fake('local');

        $cases = [
            '/keywords/%E8%94%A1%E8%8B%B1%E6%96%87/days' => [
                'urt_show_video_tag_date',
                'reports.keyword_relations.build',
                'KeywordRelationFallback',
                'Keyword relation cache status',
                '固定規則：隨部署更新',
            ],
            '/keywords/%E8%94%A1%E8%8B%B1%E6%96%87/videos' => [
                'urt_show_video_tag_date',
                'reports:keyword-relations:build',
                'KeywordVideosReport',
                'Fallback text match',
                'Keyword-video cache status',
                '固定規則：隨部署更新',
            ],
        ];

        foreach ($cases as $uri => $expected) {
            $response = $this->get($uri);

            $this->assertLineageShell($response);

            foreach ($expected as $text) {
                $response->assertSee($text, false);
            }
        }
    }

    public function test_live_history_trend_and_hour_pages_render_lineage_profiles(): void
    {
        Storage::fake('local');

        $cases = [
            '/live/days/2026-05-23' => [
                'urt_video_live_log',
                'youtube:live:poll --execute --limit=50',
                'YouTube Data API videos.list(part=liveStreamingDetails)',
                'LiveDayReport',
                '固定規則：隨部署更新',
            ],
            '/live/trends/daily' => [
                'urt_video_live_log',
                'youtube:live:poll --execute --limit=50',
                'LiveDailyTrendReport::GROUPS',
                '7-day rolling',
                '固定規則：隨部署更新',
            ],
            '/live/hours' => [
                'urt_show_live_tag_date.hour_result',
                'reports.live_tag_date.build',
                'reports:live:clean --execute --limit=500',
                'LiveHoursReport',
                '固定規則：隨部署更新',
            ],
        ];

        foreach ($cases as $uri => $expected) {
            $response = $this->get($uri);

            $this->assertLineageShell($response);

            foreach ($expected as $text) {
                $response->assertSee($text, false);
            }
        }
    }

    private function assertLineageShell(TestResponse $response): void
    {
        $response->assertOk();
        $response->assertSee('資料來源與更新狀態');
        $response->assertSee('data-lineage-toggle aria-expanded="false"', false);
        $response->assertSee('class="lineage-panel" hidden', false);
        $response->assertSee('data-lineage-graph', false);
        $response->assertSee('class="lineage-detail" data-lineage-detail aria-live="polite" hidden', false);
    }
}
