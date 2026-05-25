<?php

namespace Tests\Feature;

use Tests\TestCase;

class LegacyRedirectTest extends TestCase
{
    public function test_legacy_index_url_redirects_to_home(): void
    {
        $response = $this->get('/index.php?sort=median&min=100');

        $response->assertStatus(308);
        $response->assertRedirect(route('home', [
            'sort' => 'median',
            'min' => '100',
        ]));
    }

    public function test_legacy_live_url_redirects_to_current_live_report(): void
    {
        $response = $this->get('/live.php?or=1,2&not=9');

        $response->assertStatus(308);
        $response->assertRedirect(route('live.current', [
            'or' => '1,2',
            'not' => '9',
        ]));
    }

    public function test_legacy_continuous_live_url_redirects_to_modern_report(): void
    {
        $response = $this->get('/live_cont.php?or=1,2');

        $response->assertStatus(308);
        $response->assertRedirect(route('live.continuous', [
            'or' => '1,2',
        ]));
    }

    public function test_legacy_live_day_url_redirects_to_dated_modern_report(): void
    {
        $response = $this->get('/live_day.php?date=2026-05-23&or=1,2');

        $response->assertStatus(308);
        $response->assertRedirect(route('live.days.date', [
            'date' => '2026-05-23',
            'or' => '1,2',
        ]));
    }

    public function test_legacy_live_line_url_redirects_to_video_trend(): void
    {
        $response = $this->get('/live_line.php?videoId=abc123&limit=24');

        $response->assertStatus(308);
        $response->assertRedirect(route('live.videos.trend', [
            'videoId' => 'abc123',
            'limit' => '24',
        ]));

        $this->get('/live_line.php?limit=24')
            ->assertStatus(308)
            ->assertRedirect(route('live.videos.trend', [
                'videoId' => 'oka2UDaeFZw',
                'limit' => '24',
            ]));
    }

    public function test_legacy_live_day_line_url_redirects_to_daily_trend(): void
    {
        $response = $this->get('/live_day_line.php?group=party&days=30&type=count_videos');

        $response->assertStatus(308);
        $response->assertRedirect(route('live.trends.daily', [
            'group' => 'party',
            'days' => '30',
            'type' => 'count_videos',
        ]));
    }

    public function test_legacy_live_channels_url_redirects_to_channel_aggregate(): void
    {
        $response = $this->get('/live_channels.php?tagid=1&days=30');

        $response->assertStatus(308);
        $response->assertRedirect(route('live.channels', [
            'tagid' => '1',
            'days' => '30',
        ]));
    }

    public function test_legacy_live_channel_url_redirects_to_video_ranking(): void
    {
        $this->get('/live_channel.php?date=2026-05-24&tagid=1')
            ->assertStatus(308)
            ->assertRedirect(route('live.days.date', [
            'date' => '2026-05-24',
            'tagid' => '1',
            ]));

        $this->get('/live_channel.php?from=2026-05-23&to=2026-05-24&or=1')
            ->assertStatus(308)
            ->assertRedirect(route('live.periods', [
                'from' => '2026-05-23',
                'to' => '2026-05-24',
                'or' => '1',
            ]));
    }

    public function test_legacy_live_hour_url_redirects_to_hourly_heatmap(): void
    {
        $response = $this->get('/live_hour.php?tagid=1&days=7');

        $response->assertStatus(308);
        $response->assertRedirect(route('live.hours', [
            'tagid' => '1',
            'days' => '7',
        ]));
    }

    public function test_legacy_live_period_url_redirects_to_period_report(): void
    {
        $response = $this->get('/live_period.php?from=2026-05-23&to=2026-05-24&or=1');

        $response->assertStatus(308);
        $response->assertRedirect(route('live.periods', [
            'from' => '2026-05-23',
            'to' => '2026-05-24',
            'or' => '1',
        ]));
    }

    public function test_legacy_live_tag_url_redirects_to_live_tag_report(): void
    {
        $response = $this->get('/live_tag.php?tagid=1&days=7&type=tags_video');

        $response->assertStatus(308);
        $response->assertRedirect(route('live.tags', [
            'tagid' => '1',
            'days' => '7',
            'type' => 'tags_video',
        ]));
    }

    public function test_legacy_live_rank_url_redirects_to_daily_or_period_report(): void
    {
        $this->get('/live_rank.php?date=2026-05-23&or=1')
            ->assertStatus(308)
            ->assertRedirect(route('live.days.date', [
                'date' => '2026-05-23',
                'or' => '1',
            ]));

        $this->get('/live_rank.php?from=2026-05-20&to=2026-05-24&or=1')
            ->assertStatus(308)
            ->assertRedirect(route('live.periods', [
                'from' => '2026-05-20',
                'to' => '2026-05-24',
                'or' => '1',
            ]));
    }

    public function test_legacy_live_wall_urls_redirect_to_modern_walls(): void
    {
        $this->get('/live4.php?type=5')
            ->assertStatus(308)
            ->assertRedirect(route('live.wall', [
                'variant' => 'news',
                'type' => '5',
            ]));

        $this->get('/live5.php')
            ->assertStatus(308)
            ->assertRedirect(route('live.wall', [
                'variant' => 'alternate',
            ]));

        $this->get('/live_china.php')
            ->assertStatus(308)
            ->assertRedirect(route('live.wall', [
                'variant' => 'china',
            ]));
    }

    public function test_legacy_live_static_html_redirects_to_social_live_report(): void
    {
        $response = $this->get('/html/live_social.html?limit=20');

        $response->assertStatus(308);
        $response->assertRedirect(route('live.current', [
            'or' => '1,2,12,13,14,81',
            'limit' => '20',
        ]));
    }

    public function test_legacy_ai_hour_url_redirects_to_hourly_ai_report(): void
    {
        $response = $this->get('/ai_hour.php?date=2026-05-24&condition=all');

        $response->assertStatus(308);
        $response->assertRedirect(route('ai.hours', [
            'date' => '2026-05-24',
            'condition' => 'all',
        ]));
    }

    public function test_legacy_ai_day_url_redirects_to_daily_ai_report(): void
    {
        $response = $this->get('/ai_day.php?date=2026-05-23&condition=green&debug=0');

        $response->assertStatus(308);
        $response->assertRedirect(route('ai.days.condition', [
            'date' => '2026-05-23',
            'condition' => 'green',
            'debug' => '0',
        ]));
    }

    public function test_legacy_ai_day_prompt_url_redirects_to_read_only_prompt_preview(): void
    {
        $response = $this->get('/ai_day_prompt.php?date=2026-05-23&condition=green&type=oneday&limit=20');

        $response->assertStatus(308);
        $response->assertRedirect(route('ai.days.condition.prompt', [
            'date' => '2026-05-23',
            'condition' => 'green',
            'type' => 'oneday',
            'limit' => '20',
        ]));
    }

    public function test_legacy_pretty_ai_day_url_redirects_to_daily_ai_report(): void
    {
        $response = $this->get('/day/2026-05-23/blue?debug=0');

        $response->assertStatus(308);
        $response->assertRedirect(route('ai.days.condition', [
            'date' => '2026-05-23',
            'condition' => 'blue',
            'debug' => '0',
        ]));
    }

    public function test_legacy_ai_event_url_redirects_to_event_report(): void
    {
        $response = $this->get('/ai_event.php?pk=10&event=%E6%AF%92%E9%A7%95');

        $response->assertStatus(308);
        $response->assertRedirect(route('ai.events.show', [
            'id' => 10,
            'event' => '毒駕',
        ]));
    }

    public function test_legacy_ai_event_variant_urls_redirect_to_event_people_and_wall_reports(): void
    {
        $this->get('/ai_event_people.php?pk=10&event=%E6%AF%92%E9%A7%95')
            ->assertStatus(308)
            ->assertRedirect(route('ai.events.people', [
                'id' => 10,
                'event' => '毒駕',
            ]));

        $this->get('/ai_event_wall.php?pk=10&event=%E6%AF%92%E9%A7%95')
            ->assertStatus(308)
            ->assertRedirect(route('ai.events.wall', [
                'id' => 10,
                'event' => '毒駕',
            ]));
    }

    public function test_legacy_ai_aspect_urls_redirect_to_aspect_report(): void
    {
        $this->get('/ai_channel.php?tagid=1&not=9')
            ->assertStatus(308)
            ->assertRedirect(route('ai.aspects', [
                'tagid' => '1',
                'not' => '9',
            ]));

        $this->get('/ai_tag.php?condition=green')
            ->assertStatus(308)
            ->assertRedirect(route('ai.aspects', [
                'condition' => 'green',
            ]));

        $this->get('/ai_dashboard.php?condition=blue')
            ->assertStatus(308)
            ->assertRedirect(route('ai.aspects', [
                'condition' => 'blue',
            ]));
    }

    public function test_legacy_rank_query_url_redirects_to_tag_channels(): void
    {
        $response = $this->get('/rank.php?tagid=1&not=2,9&column=view_week');

        $response->assertStatus(308);
        $response->assertRedirect(route('tags.channels', [
            'tagId' => 1,
            'not' => '2,9',
            'column' => 'view_week',
        ]));
    }

    public function test_legacy_rank_path_redirects_to_tag_channels(): void
    {
        $response = $this->get('/rank/12?limit=25');

        $response->assertStatus(308);
        $response->assertRedirect(route('tags.channels', [
            'tagId' => 12,
            'limit' => '25',
        ]));
    }

    public function test_legacy_keywords_url_redirects_to_modern_keywords(): void
    {
        $response = $this->get('/tags.php?limit=25');

        $response->assertStatus(308);
        $response->assertRedirect(route('keywords.index', [
            'limit' => '25',
        ]));
    }

    public function test_legacy_tag_trend_urls_redirect_to_modern_trend_report(): void
    {
        $this->get('/line.php?tagid=1&or=3,2&type=average&days=30')
            ->assertStatus(308)
            ->assertRedirect(route('tags.trends', [
                'tagId' => 1,
                'or' => '3,2',
                'type' => 'average',
                'days' => '30',
            ]));

        $this->get('/tag_group.php?tag=柯文哲&group=position&type=total_views')
            ->assertStatus(308)
            ->assertRedirect(route('keywords.groups.trends', [
                'keyword' => '柯文哲',
                'group' => 'position',
                'type' => 'total_views',
            ]));
    }

    public function test_legacy_videos_url_redirects_to_tag_videos(): void
    {
        $response = $this->get('/videos.php?tagid=1&not=9&hours=72');

        $response->assertStatus(308);
        $response->assertRedirect(route('tags.videos', [
            'tagId' => 1,
            'not' => '9',
            'hours' => '72',
            ]));
    }

    public function test_legacy_comments_url_redirects_to_tag_comments(): void
    {
        $this->get('/comments.php?tagid=1&not=9&hours=72')
            ->assertStatus(308)
            ->assertRedirect(route('tags.comments', [
                'tagId' => 1,
                'not' => '9',
                'hours' => '72',
            ]));

        $this->get('/comments.php?or=1,2')
            ->assertStatus(308)
            ->assertRedirect(route('tags.comments.index', [
                'or' => '1,2',
            ]));
    }

    public function test_legacy_live_videos_url_redirects_to_video_ranking(): void
    {
        $this->get('/live_videos.php?tagid=1&not=9&date=2026-05-24')
            ->assertStatus(308)
            ->assertRedirect(route('live.days.date', [
                'date' => '2026-05-24',
                'tagid' => '1',
                'not' => '9',
            ]));

        $this->get('/live_videos.php?from=2026-05-20&to=2026-05-24&or=1')
            ->assertStatus(308)
            ->assertRedirect(route('live.periods', [
                'from' => '2026-05-20',
                'to' => '2026-05-24',
                'or' => '1',
            ]));
    }

    public function test_legacy_channel_php_urls_redirect_to_channel_surfaces(): void
    {
        $this->get('/channel.php?u_id=10&debug=0')
            ->assertStatus(308)
            ->assertRedirect(route('channels.show', ['u_id' => 10, 'debug' => '0']));

        $this->get('/channel_videos.php?channel=10&hours=72')
            ->assertStatus(308)
            ->assertRedirect(route('channels.videos', ['u_id' => 10, 'hours' => '72']));

        $this->get('/channel_comments.php?u_id=10&hours=72')
            ->assertStatus(308)
            ->assertRedirect(route('channels.comments', ['u_id' => 10, 'hours' => '72']));

        $this->get('/channel_cloud.php?u_id=10&days=7')
            ->assertStatus(308)
            ->assertRedirect(route('channels.cloud', ['u_id' => 10, 'days' => '7']));

        $this->get('/channel_line.php?u_id=10&limit=90')
            ->assertStatus(308)
            ->assertRedirect(route('channels.trends', ['u_id' => 10, 'limit' => '90']));

        $this->get('/channel_days.php?u_id=10&days=14')
            ->assertStatus(308)
            ->assertRedirect(route('channels.people', ['u_id' => 10, 'days' => '14']));

        $this->get('/channel_date.php?u_id=10&date=2026-05-23&type=week')
            ->assertStatus(308)
            ->assertRedirect(route('channels.ai.days.date', ['u_id' => 10, 'date' => '2026-05-23', 'type' => 'week']));

        $this->get('/channel_prompt.php?u_id=10&date=2026-05-23&limit=20')
            ->assertStatus(308)
            ->assertRedirect(route('channels.prompt', ['u_id' => 10, 'date' => '2026-05-23', 'limit' => '20']));
    }

    public function test_legacy_channel_path_redirects_to_channel_profile(): void
    {
        $response = $this->get('/ch/10');

        $response->assertStatus(308);
        $response->assertRedirect(route('channels.show', [
            'u_id' => 10,
        ]));
    }

    public function test_legacy_channel_videos_path_redirects_to_channel_videos(): void
    {
        $response = $this->get('/ch/10/videos?hours=72');

        $response->assertStatus(308);
        $response->assertRedirect(route('channels.videos', [
            'u_id' => 10,
            'hours' => '72',
        ]));
    }

    public function test_legacy_channel_gap_paths_redirect_to_modern_unavailable_pages(): void
    {
        $this->get('/ch/10/comments?hours=72')
            ->assertStatus(308)
            ->assertRedirect(route('channels.comments', ['u_id' => 10, 'hours' => '72']));

        $this->get('/ch/10/cloud?days=7')
            ->assertStatus(308)
            ->assertRedirect(route('channels.cloud', ['u_id' => 10, 'days' => '7']));

        $this->get('/ch/10/line?limit=90')
            ->assertStatus(308)
            ->assertRedirect(route('channels.trends', ['u_id' => 10, 'limit' => '90']));
    }

    public function test_legacy_channel_days_path_redirects_to_people_report(): void
    {
        $response = $this->get('/ch/10/days?days=14');

        $response->assertStatus(308);
        $response->assertRedirect(route('channels.people', [
            'u_id' => 10,
            'days' => '14',
        ]));
    }

    public function test_legacy_channel_date_path_redirects_to_channel_ai_daily_report(): void
    {
        $response = $this->get('/ch/10/date?date=2026-05-23&type=week');

        $response->assertStatus(308);
        $response->assertRedirect(route('channels.ai.days.date', [
            'u_id' => 10,
            'date' => '2026-05-23',
            'type' => 'week',
        ]));
    }

    public function test_legacy_channel_prompt_path_redirects_to_read_only_prompt_preview(): void
    {
        $response = $this->get('/ch/10/prompt?date=2026-05-23&limit=20');

        $response->assertStatus(308);
        $response->assertRedirect(route('channels.prompt', [
            'u_id' => 10,
            'date' => '2026-05-23',
            'limit' => '20',
        ]));
    }

    public function test_legacy_channel_ai_paths_redirect_to_read_only_gpt_overview(): void
    {
        $this->get('/ch/10/ai?date=2026-05-23')
            ->assertStatus(308)
            ->assertRedirect(route('channels.ai', [
                'u_id' => 10,
                'date' => '2026-05-23',
            ]));

        $this->get('/channel_gpt.php?channel=10&show=1')
            ->assertStatus(308)
            ->assertRedirect(route('channels.ai', [
                'u_id' => 10,
                'show' => '1',
            ]));

        $this->get('/channel_gpt.php?u_id=10&limit=20')
            ->assertStatus(308)
            ->assertRedirect(route('channels.ai', [
                'u_id' => 10,
                'limit' => '20',
            ]));
    }
}
