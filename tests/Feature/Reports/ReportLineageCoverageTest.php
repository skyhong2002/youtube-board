<?php

namespace Tests\Feature\Reports;

use App\Support\ReportLineageProfiles;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

class ReportLineageCoverageTest extends TestCase
{
    public function test_modern_report_routes_have_lineage_profiles(): void
    {
        $profiles = new ReportLineageProfiles;

        $routeNames = collect(Route::getRoutes())
            ->filter(fn ($route): bool => in_array('GET', $route->methods(), true))
            ->map(fn ($route): ?string => $route->getName())
            ->filter()
            ->reject(fn (string $routeName): bool => $routeName === 'home'
                || Str::startsWith($routeName, ['legacy.', 'ops.', 'dev.', 'storage.']))
            ->values();

        foreach ($routeNames as $routeName) {
            $this->assertNotNull($profiles->forRoute($routeName), $routeName.' should have a lineage profile.');
        }
    }

    public function test_newly_covered_report_families_render_lineage_panels(): void
    {
        Storage::fake('local');

        $cases = [
            '/tags' => ['HomeTagIndexReport', 'youtube:channels:stats --execute --limit=25', 'Tag index sort whitelist'],
            '/tags/compare' => ['TagComparisonReport', 'TagComparisonReport::DEFAULT_TAGS', 'urt_show_tag_date'],
            '/tags/1/live/videos' => ['TagLiveVideosReport', 'urt_video_live_log', 'YouTube Data API videos.list(part=liveStreamingDetails)'],
            '/tags/1/trends' => ['TagTrendReport', 'reports:tag-date:build', '7-day rolling'],
            '/keywords/demo/groups/trends' => ['KeywordGroupTrendReport', 'LegacyKeywordGroupDefinitions', 'urt_show_tag_month'],
            '/keywords/demo/live/trends' => ['KeywordLiveTrendReport', 'LegacyLiveGroupDefinitions', 'urt_show_live_tag_date'],
            '/live/channels' => ['LiveChannelsReport', 'urt_video_live_log', 'reports:live:build --execute --hours=24 --limit=100'],
            '/live/continuous' => ['LiveContinuousReport', 'actualEndTime IS NULL', 'urt_video_live'],
            '/live/tags' => ['LiveTagReport', 'LiveTagReport::TYPES', 'reports.live_tag_date.build'],
            '/live/groups/media/hours' => ['LiveGroupHoursReport', 'hour_result', 'LegacyLiveGroupDefinitions'],
            '/live/videos/demo-video/trend' => ['LiveVideoTrendReport', 'urt_show_video_live', 'log_json'],
            '/live/walls/news' => ['LiveWallReport', 'fixed videoId lists', '不讀本機 DB'],
            '/channels/1' => ['ChannelProfileReport', 'urt_channel_ai', 'ai:daily --execute --channel-limit=39 --channel-batch-size=12 --ai-call-limit=45 --channel-video-limit=120 --limit=1000'],
            '/channels/1/videos' => ['ChannelVideosReport', 'urt_video', 'youtube:videos:stats --execute --limit=25'],
            '/channels/1/comments' => ['ChannelCommentsReport', 'urt_comment_author', 'YouTube Data API commentThreads.list'],
            '/channels/1/cloud' => ['ChannelCloudReport', 'urt_show_cloud', 'reports.channel_cloud.build'],
            '/channels/1/trends' => ['ChannelTrendsReport', 'channel log adapter', 'urt_log'],
            '/channels/1/people' => ['ChannelPeopleReport', 'ChannelPeopleReport::EXCLUDED_PEOPLE', 'urt_channel_ai'],
            '/channels/1/ai' => ['ChannelAiOverviewReport', 'ChannelAiOverviewReport::prompt', 'urt_channel_ai'],
            '/channels/1/ai/days' => ['ChannelAiDailyReport', 'ChannelAiDailyReport::type', 'urt_channel_ai'],
            '/channels/1/prompt' => ['ChannelPromptReport', 'ChannelPromptReport::prompt', '不呼叫 AI API'],
            '/videos/demo-video' => ['VideoDetailReport', 'urt_video_duration', 'youtube:videos:duration'],
            '/videos/demo-video/analytics' => ['VideoDetailReport', 'urt_video_log', 'comments_json'],
            '/comments/authors/demo-author' => ['AuthorCommentsReport', 'urt_comment_rev', 'AuthorCommentsReport::TAGS_TO_SHOW'],
            '/groups' => ['GroupDirectoryReport', 'reports:groups:build', 'configuredGroups'],
            '/groups/tags_president2024/ranking' => ['GroupMetricReport', 'LegacyLiveGroupDefinitions', 'reports:tag-date:build'],
            '/groups/tags_president2024/trends' => ['GroupMetricReport', 'rolling', 'urt_show_tag_date'],
            '/groups/tags_president2024/live' => ['GroupLiveReport', 'GroupLiveReport::tagSetFromLegacyFile', 'urt_show_live_tag_date'],
            '/mayor' => ['MayorReport', 'MayorReport::fallbackCities', 'reports:mayor:static'],
            '/mayor/cities/taipei' => ['MayorReport', 'MayorReport::tagIds = 3,4,5,6', 'MayorReport::factorTemplate'],
            '/mayor/cities/taipei/people/%E8%94%A3%E8%90%AC%E5%AE%89/days/2026-05-24' => ['MayorPersonDailyReport', 'urt_mayor_person_ai', 'ai:mayor-person'],
            '/ai/hours' => ['AiHourlyReport', 'urt_ai_hour', 'ai:hourly --execute --limit=20'],
            '/ai/periods' => ['AiPeriodReport', 'urt_ai_date', 'AiPeriodReport::dates max 62 days'],
            '/ai/events/1' => ['AiEventReport', 'urt_ai_event', 'Period history bound'],
            '/ai/events/1/people' => ['AiEventReport', 'show/people/wall', 'urt_ai_period'],
            '/ai/events/1/wall' => ['AiEventReport', 'wall videos', 'ai.event'],
            '/ai/aspects' => ['AiAspectReport', 'AiAspectReport::filters condition map', 'urt_channel_ai'],
            '/ai/days/prompt' => ['AiDailyPromptReport', 'AiDailyPromptReport::prompt', '不呼叫 AI API'],
            '/ai/days/2026-05-30/all/prompt' => ['AiDailyPromptReport', 'AiDailyPromptReport::conditionFilters', 'prompt preview'],
        ];

        foreach ($cases as $uri => $expected) {
            $response = $this->get($uri);

            $this->assertLineageShell($response, $uri);

            foreach ($expected as $text) {
                $response->assertSee($text, false);
            }
        }
    }

    public function test_lineage_defers_d3_until_first_expansion_and_keeps_the_html_fallback(): void
    {
        Storage::fake('local');

        $response = $this->get('/ai/days');

        $response->assertOk();
        $response->assertDontSee('<script src="https://d3js.org/d3.v7.min.js"></script>', false);
        $response->assertSee("script.src = 'https://d3js.org/d3.v7.min.js';", false);
        $response->assertSee('loadD3().then(renderAll)', false);
        $response->assertSee('data-lineage-fallback', false);
        $response->assertSee('<noscript>', false);
        $response->assertSee('[hidden] { display: block !important; }', false);
    }

    private function assertLineageShell(TestResponse $response, string $uri): void
    {
        $this->assertTrue($response->isOk(), $uri.' returned HTTP '.$response->getStatusCode());
        $response->assertSee('資料來源與更新狀態');
        $response->assertSee('.lineage-toggle { display: flex;', false);
        $response->assertSee('data-lineage-toggle aria-expanded="false"', false);
        $response->assertSee('class="lineage-panel" hidden', false);
        $response->assertSee('data-lineage-graph', false);
        $response->assertSee('class="lineage-detail" data-lineage-detail aria-live="polite" hidden', false);
        $this->assertSame(1, substr_count($response->getContent(), 'data-lineage-toggle aria-expanded="false"'));
    }
}
