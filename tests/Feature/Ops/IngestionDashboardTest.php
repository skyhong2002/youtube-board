<?php

namespace Tests\Feature\Ops;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class IngestionDashboardTest extends TestCase
{
    public function test_ingestion_dashboard_renders_legacy_cron_registry_with_controlled_polling_state(): void
    {
        Storage::fake('local');

        $response = $this->get('/ops/ingestion');

        $response->assertOk();
        $response->assertSee('擷取排程');
        $response->assertSee('Web Request Gates');
        $response->assertSee('scheduler disabled');
        $response->assertSee('local polling disabled');
        $response->assertSee('External Scheduler Activity');
        $response->assertSee('external scheduler not observed');
        $response->assertSee('No external');
        $response->assertSee('外部資料擷取');
        $response->assertSee('內部報表處理');
        $response->assertSee('/ops/ingestion/data-capture', false);
        $response->assertSee('/ops/ingestion/report-processing', false);
        $response->assertSee('scheduled write allowlist 0');
        $response->assertSee('command-missing');
        $response->assertSee('command-ready');
        $response->assertSee('reports:live:show');
        $response->assertSee('<code>urt_channel</code>', false);
        $response->assertSee('/ops/ingestion/reports.live.show', false);
        $response->assertSee('youtube:live:poll');
        $response->assertSee('/usr/bin/php /home/urtube/maint/get_live.php');
        $response->assertSee('youtube:tvbs:live:poll');
        $response->assertSee('/usr/bin/php /home/urtube/maint/get_live_tvbs.php');
        $response->assertSee('ai:daily');
        $response->assertSee('/home/urtube/maint/make_ai_day.sh');
        $response->assertSee('youtube:comments:queue');
        $response->assertSee('youtube:comments:fetch');
        $response->assertSee('reports:mayor:static');
        $response->assertSee('/home/urtube/mayor/make_mayor.sh');
        $response->assertSee('planned');
        $response->assertSee('One-shot Runner');
        $response->assertSee('Latest One-shot Runs');
        $response->assertSee('Run Once');
    }

    public function test_ingestion_dashboard_splits_external_capture_status_page(): void
    {
        Storage::fake('local');

        $response = $this->get('/ops/ingestion/data-capture');

        $response->assertOk();
        $response->assertSee('外部資料擷取狀態');
        $response->assertSee('追蹤會跟 YouTube Data API');
        $response->assertSee('排程可執行');
        $response->assertSee('scheduled blocked');
        $response->assertSee('external scheduler not observed');
        $response->assertSee('youtube:live:poll');
        $response->assertSee('youtube:channels:videos');
        $response->assertSee('youtube:comments:fetch');
        $response->assertSee('youtube:tag-videos:backfill');
        $response->assertDontSee('reports:tag-date:build');
        $response->assertDontSee('ai:daily');
    }

    public function test_ingestion_dashboard_splits_report_processing_status_page(): void
    {
        Storage::fake('local');

        $response = $this->get('/ops/ingestion/report-processing');

        $response->assertOk();
        $response->assertSee('內部報表處理狀態');
        $response->assertSee('重建 dashboard cache');
        $response->assertSee('排程預覽 / request 渲染');
        $response->assertSee('reports:live:build');
        $response->assertSee('reports:tag-date:build');
        $response->assertSee('reports:static:build');
        $response->assertSee('ai:daily');
        $response->assertDontSee('youtube.live.poll');
        $response->assertDontSee('youtube.comments.fetch');
    }

    public function test_ingestion_dashboard_prefills_job_from_query_parameter(): void
    {
        Storage::fake('local');

        $response = $this->get('/ops/ingestion?job=ai.daily');

        $response->assertOk();
        $response->assertSee('value="ai.daily"  selected', false);
    }

    public function test_ingestion_dashboard_shows_recent_external_scheduler_activity_while_web_gates_are_disabled(): void
    {
        Storage::fake('local');
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-26 02:52:30', 'Asia/Taipei'));

        try {
            config()->set('ingestion.scheduler_enabled', false);
            config()->set('ingestion.local_polling_enabled', false);

            Storage::disk('local')->put('ingestion-runs/20260526-025200-00000000-0000-4000-8000-000000000000.json', json_encode([
                'id' => '20260526-025200-00000000-0000-4000-8000-000000000000',
                'path' => 'ingestion-runs/20260526-025200-00000000-0000-4000-8000-000000000000.json',
                'created_at' => '2026-05-26 02:52:00 Asia/Taipei',
                'request' => [
                    'source' => 'artisan',
                    'mode' => 'execute',
                    'job' => null,
                ],
                'result' => [
                    'mode' => 'execute',
                    'summary' => [
                        'evaluated' => 25,
                        'due' => 2,
                        'executed' => 2,
                        'skipped' => 0,
                        'failed' => 0,
                    ],
                ],
            ], JSON_THROW_ON_ERROR));

            $response = $this->get('/ops/ingestion');

            $response->assertOk();
            $response->assertSee('Web Request Gates');
            $response->assertSee('scheduler disabled');
            $response->assertSee('local polling disabled');
            $response->assertSee('External Scheduler Activity');
            $response->assertSee('external scheduler active');
            $response->assertSee('latest=2026-05-26 02:52:00 Asia/Taipei');
            $response->assertSee('executed=2');
            $response->assertDontSee('external scheduler not observed');
        } finally {
            CarbonImmutable::setTestNow();
        }
    }

    public function test_ingestion_dashboard_keeps_old_or_web_runs_out_of_active_external_scheduler_activity(): void
    {
        Storage::fake('local');
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-26 02:52:30', 'Asia/Taipei'));

        try {
            Storage::disk('local')->put('ingestion-runs/20260526-024800-00000000-0000-4000-8000-000000000000.json', json_encode([
                'id' => '20260526-024800-00000000-0000-4000-8000-000000000000',
                'created_at' => '2026-05-26 02:48:00 Asia/Taipei',
                'request' => [
                    'source' => 'artisan',
                    'mode' => 'execute',
                    'job' => null,
                ],
                'result' => [
                    'mode' => 'execute',
                    'summary' => [
                        'evaluated' => 25,
                        'due' => 2,
                        'executed' => 2,
                        'skipped' => 0,
                        'failed' => 0,
                    ],
                ],
            ], JSON_THROW_ON_ERROR));

            Storage::disk('local')->put('ingestion-runs/20260526-025220-11111111-1111-4111-8111-111111111111.json', json_encode([
                'id' => '20260526-025220-11111111-1111-4111-8111-111111111111',
                'created_at' => '2026-05-26 02:52:20 Asia/Taipei',
                'request' => [
                    'mode' => 'execute',
                    'job' => 'reports.live.static',
                    'scheduler_enabled_temporarily' => true,
                ],
                'result' => [
                    'mode' => 'execute',
                    'summary' => [
                        'evaluated' => 1,
                        'due' => 1,
                        'executed' => 1,
                        'skipped' => 0,
                        'failed' => 0,
                    ],
                ],
            ], JSON_THROW_ON_ERROR));

            $response = $this->get('/ops/ingestion');

            $response->assertOk();
            $response->assertSee('external scheduler not observed');
            $response->assertSee('No external scheduler run file was created within the recent activity window.');
            $response->assertDontSee('external scheduler active');
        } finally {
            CarbonImmutable::setTestNow();
        }
    }

    public function test_ingestion_dashboard_can_run_one_ingestion_job_once_and_store_history(): void
    {
        Storage::fake('local');
        config()->set('legacy.ground_truth_path', storage_path('framework/testing-missing-legacy'));

        $response = $this->withSession(['_token' => 'test-token'])->post('/ops/ingestion/run', [
            '_token' => 'test-token',
            'mode' => 'execute',
            'job' => 'reports.live.static',
            'at' => '2026-05-25 00:19:00',
        ]);

        $response->assertRedirect('/ops/ingestion');
        $response->assertSessionHas('ingestion_run_summary', [
            'evaluated' => 1,
            'due' => 1,
            'executed' => 1,
            'skipped' => 0,
            'failed' => 0,
        ]);

        $files = Storage::disk('local')->files('ingestion-runs');
        $this->assertCount(1, $files);

        $record = json_decode((string) Storage::disk('local')->get($files[0]), true);
        $this->assertSame('execute', $record['request']['mode']);
        $this->assertSame('reports.live.static', $record['request']['job']);
        $this->assertTrue($record['request']['scheduler_enabled_temporarily']);
        $this->assertSame('execute', $record['result']['mode']);
        $this->assertSame('executed', $record['result']['jobs'][0]['action']);

        $dashboard = $this->get('/ops/ingestion');
        $dashboard->assertOk();
        $dashboard->assertSee('Latest One-shot Runs');
        $dashboard->assertSee('reports.live.static');
        $dashboard->assertSee('execute');
        $dashboard->assertSee('ingestion-runs/');
        $dashboard->assertSee('/ops/ingestion/runs/'.$record['id'], false);

        $detail = $this->get('/ops/ingestion/runs/'.$record['id']);
        $detail->assertOk();
        $detail->assertSee($record['id']);
        $detail->assertSee('evaluated=1');
        $detail->assertSee('due=1');
        $detail->assertSee('executed=1');
        $detail->assertSee('failed=0');
        $detail->assertSee('reports.live.static');
        $detail->assertSee('reports:live:static');
        $detail->assertSee('executed');
        $detail->assertSee('ingestion-runs/'.$record['id'].'.json');
    }

    public function test_ingestion_run_detail_returns_404_for_unknown_or_invalid_run(): void
    {
        Storage::fake('local');

        $this->get('/ops/ingestion/runs/20260525-001900-00000000-0000-4000-8000-000000000000')
            ->assertNotFound();

        $this->get('/ops/ingestion/runs/../../.env')
            ->assertNotFound();
    }

    public function test_ingestion_job_detail_shows_ingestion_next_runs_and_safe_execute_command(): void
    {
        $response = $this->get('/ops/ingestion/reports.live.show?at=2026-05-25%2000:07:00');

        $response->assertOk();
        $response->assertSee('reports.live.show');
        $response->assertSee('reports:live:show');
        $response->assertSee('<code>urt_show_video_live</code>', false);
        $response->assertSee('/usr/bin/php /home/urtube/maint/show_live.php');
        $response->assertSee('即時 YouTube 儀表板');
        $response->assertSee('due now');
        $response->assertSee('2026-05-25 00:14:00 CST');
        $response->assertSee('INGESTION_SCHEDULER_ENABLED=true php artisan ingestion:run --execute --job=reports.live.show');
    }

    public function test_ingestion_job_detail_allows_ai_hourly_preview_and_gated_execute(): void
    {
        $response = $this->get('/ops/ingestion/ai.hourly?at=2026-05-25%2000:10:00');

        $response->assertOk();
        $response->assertSee('ai.hourly');
        $response->assertSee('ai:hourly');
        $response->assertSee('explicit <code>--execute</code> calls OpenCode-compatible chat completions and upserts <code>urt_ai_hour</code>', false);
        $response->assertSee('due now');
        $response->assertSee('INGESTION_SCHEDULER_ENABLED=true php artisan ingestion:run --execute --job=ai.hourly');
        $response->assertSee('Scheduled Local Polling');
        $response->assertSee('ai:hourly --execute --limit=20');
        $response->assertSee('INGESTION_LOCAL_POLLING_ENABLED is false.');
    }

    public function test_ingestion_job_detail_allows_ai_daily_ingestion_preview(): void
    {
        $response = $this->get('/ops/ingestion/ai.daily?at=2026-05-25%2016:15:00');

        $response->assertOk();
        $response->assertSee('ai.daily');
        $response->assertSee('ai:daily');
        $response->assertSee('explicit <code>--execute</code> calls OpenCode-compatible chat completions and upserts <code>urt_channel_ai</code> / <code>urt_ai_date</code>', false);
        $response->assertSee('due now');
        $response->assertSee('INGESTION_SCHEDULER_ENABLED=true php artisan ingestion:run --execute --job=ai.daily');
        $response->assertSee('Scheduled Local Polling');
        $response->assertSee('ai:daily --execute --channel-limit=3 --limit=1000');
        $response->assertSee('INGESTION_LOCAL_POLLING_ENABLED is false.');
    }

    public function test_ingestion_job_detail_allows_live_poll_ingestion_preview(): void
    {
        $response = $this->get('/ops/ingestion/youtube.live.poll?at=2026-05-25%2000:00:00');

        $response->assertOk();
        $response->assertSee('youtube.live.poll');
        $response->assertSee('youtube:live:poll');
        $response->assertSee('updates live rows and live logs');
        $response->assertSee('due now');
        $response->assertSee('INGESTION_SCHEDULER_ENABLED=true php artisan ingestion:run --execute --job=youtube.live.poll');
        $response->assertSee('explicit/scheduled <code>--execute --videoId/--limit</code>', false);
        $response->assertSee('Scheduler 在 write allowlist 開啟時使用 scheduled execute command；未開啟時維持 preview mode');
    }

    public function test_ingestion_job_detail_allows_tvbs_live_poll_ingestion_preview(): void
    {
        $response = $this->get('/ops/ingestion/youtube.tvbs.live.poll?at=2026-05-25%2000:00:00');

        $response->assertOk();
        $response->assertSee('youtube.tvbs.live.poll');
        $response->assertSee('youtube:tvbs:live:poll');
        $response->assertSee('updates <code>urt_video_live_tvbs</code> and <code>urt_video_live_log_tvbs</code>', false);
        $response->assertSee('due now');
        $response->assertSee('INGESTION_SCHEDULER_ENABLED=true php artisan ingestion:run --execute --job=youtube.tvbs.live.poll');
        $response->assertSee('Scheduled Local Polling');
        $response->assertSee('youtube:tvbs:live:poll --execute --limit=20');
        $response->assertSee('manual/scheduled <code>--execute --videoId/--limit</code>', false);
        $response->assertSee('Scheduler 在 write allowlist 開啟時使用 capped scheduled execute command；未開啟時維持 preview mode');
    }

    public function test_ingestion_job_detail_allows_channel_stats_ingestion_preview(): void
    {
        $response = $this->get('/ops/ingestion/youtube.channels.stats?at=2026-05-25%2000:09:00');

        $response->assertOk();
        $response->assertSee('youtube.channels.stats');
        $response->assertSee('youtube:channels:stats');
        $response->assertSee('scheduled/local <code>--execute</code> updates channel/count/log rows', false);
        $response->assertSee('due now');
        $response->assertSee('INGESTION_SCHEDULER_ENABLED=true php artisan ingestion:run --execute --job=youtube.channels.stats');
        $response->assertSee('Scheduled Local Polling');
        $response->assertSee('youtube:channels:stats --execute --limit=25');
        $response->assertSee('INGESTION_LOCAL_POLLING_ENABLED is false.');
        $response->assertSee('INGESTION_SCHEDULED_WRITE_ALLOWLIST=youtube.channels.stats');
        $response->assertSee('Scheduler 在 write allowlist 開啟時使用 capped scheduled execute command；未開啟時維持 preview mode');
    }

    public function test_ingestion_job_detail_allows_channel_video_discovery_ingestion_previews(): void
    {
        $general = $this->get('/ops/ingestion/youtube.channels.videos.general?at=2026-05-25%2000:05:00');
        $live = $this->get('/ops/ingestion/youtube.channels.videos.live?at=2026-05-25%2002:05:00');
        $liveGroup = $this->get('/ops/ingestion/youtube.channels.videos.live_group?at=2026-05-25%2000:01:00');

        foreach ([$general, $live, $liveGroup] as $response) {
            $response->assertOk();
            $response->assertSee('youtube:channels:videos');
            $response->assertSee('scheduled/local <code>--execute</code> inserts videos/schedules/live rows', false);
            $response->assertSee('due now');
            $response->assertSee('explicit/scheduled <code>--execute --id/--channel --limit --max-results</code>', false);
        }

        $general->assertSee('youtube.channels.videos.general');
        $general->assertSee('INGESTION_SCHEDULER_ENABLED=true php artisan ingestion:run --execute --job=youtube.channels.videos.general');
        $general->assertSee('單一 playlist API 失敗會跳過該 channel 並延後重試，避免整個 job 卡死');
        $live->assertSee('youtube.channels.videos.live');
        $live->assertSee('youtube:channels:videos --live=1 --force=3');
        $live->assertSee('Scheduler 在 write allowlist 開啟時使用 scheduled execute command；未開啟時維持 preview mode');
        $liveGroup->assertSee('youtube.channels.videos.live_group');
        $liveGroup->assertSee('youtube:channels:videos --live=2 --force=3');
        $liveGroup->assertSee('Scheduler 在 write allowlist 開啟時使用 scheduled execute command；未開啟時維持 preview mode');
    }

    public function test_ingestion_job_detail_allows_tvbs_video_discovery_ingestion_preview(): void
    {
        $response = $this->get('/ops/ingestion/youtube.tvbs.videos?at=2026-05-25%2000:05:00');

        $response->assertOk();
        $response->assertSee('youtube.tvbs.videos');
        $response->assertSee('youtube:tvbs:videos');
        $response->assertSee('scheduled/local <code>--execute</code> inserts videos/schedules/TVBS live rows', false);
        $response->assertSee('due now');
        $response->assertSee('INGESTION_SCHEDULER_ENABLED=true php artisan ingestion:run --execute --job=youtube.tvbs.videos');
        $response->assertSee('Scheduled Local Polling');
        $response->assertSee('youtube:tvbs:videos --execute --limit=1 --max-results=1');
        $response->assertSee('manual/scheduled <code>--execute --id/--channel --limit --max-results</code>', false);
        $response->assertSee('Scheduler 在 write allowlist 開啟時使用 capped scheduled execute command；未開啟時維持 preview mode');
    }

    public function test_ingestion_job_detail_allows_live_build_ingestion_preview(): void
    {
        $response = $this->get('/ops/ingestion/reports.live.build?at=2026-05-25%2000:09:00');

        $response->assertOk();
        $response->assertSee('reports.live.build');
        $response->assertSee('reports:live:build');
        $response->assertSee('display-cache ingestion preview');
        $response->assertSee('due now');
        $response->assertSee('INGESTION_SCHEDULER_ENABLED=true php artisan ingestion:run --execute --job=reports.live.build');
        $response->assertSee('display-cache ingestion preview');
    }

    public function test_ingestion_job_detail_allows_stale_live_cleanup_ingestion_preview(): void
    {
        $response = $this->get('/ops/ingestion/youtube.live.cleanup?at=2026-05-25%2004:27:00');

        $response->assertOk();
        $response->assertSee('youtube.live.cleanup');
        $response->assertSee('youtube:live:cleanup');
        $response->assertSee('scheduled/local <code>--execute</code> marks stale <code>urt_video_live.del_flag=1</code>', false);
        $response->assertSee('due now');
        $response->assertSee('INGESTION_SCHEDULER_ENABLED=true php artisan ingestion:run --execute --job=youtube.live.cleanup');
        $response->assertSee('marks stale');
    }

    public function test_ingestion_job_detail_allows_live_tag_date_cleanup_ingestion_preview(): void
    {
        $response = $this->get('/ops/ingestion/reports.live.clean?at=2026-05-25%2003:33:00');

        $response->assertOk();
        $response->assertSee('reports.live.clean');
        $response->assertSee('reports:live:clean');
        $response->assertSee('scheduled/local <code>--execute</code> deletes invalid <code>urt_show_live_tag_date</code> cache rows', false);
        $response->assertSee('due now');
        $response->assertSee('INGESTION_SCHEDULER_ENABLED=true php artisan ingestion:run --execute --job=reports.live.clean');
        $response->assertSee('限量刪除本機 cache rows');
    }

    public function test_ingestion_job_detail_allows_live_static_ingestion_preview(): void
    {
        $response = $this->get('/ops/ingestion/reports.live.static?at=2026-05-25%2000:19:00');

        $response->assertOk();
        $response->assertSee('reports.live.static');
        $response->assertSee('reports:live:static');
        $response->assertSee('live static HTML ingestion preview');
        $response->assertSee('due now');
        $response->assertSee('INGESTION_SCHEDULER_ENABLED=true php artisan ingestion:run --execute --job=reports.live.static');
        $response->assertSee('靜態 HTML 輸出改由動態 Laravel route 承接');
    }

    public function test_ingestion_job_detail_allows_group_static_ingestion_preview(): void
    {
        $response = $this->get('/ops/ingestion/reports.static.html?at=2026-05-25%2008:13:00');

        $response->assertOk();
        $response->assertSee('reports.static.html');
        $response->assertSee('reports:static:build');
        $response->assertSee('group static HTML ingestion preview');
        $response->assertSee('due now');
        $response->assertSee('INGESTION_SCHEDULER_ENABLED=true php artisan ingestion:run --execute --job=reports.static.html');
        $response->assertSee('/groups/{group}/ranking');
        $response->assertSee('靜態 HTML 輸出改由動態 Laravel route 承接');
    }

    public function test_ingestion_job_detail_allows_mayor_static_ingestion_preview(): void
    {
        $response = $this->get('/ops/ingestion/reports.mayor.static?at=2026-05-25%2005:13:00');

        $response->assertOk();
        $response->assertSee('reports.mayor.static');
        $response->assertSee('reports:mayor:static');
        $response->assertSee('mayor static HTML ingestion preview');
        $response->assertSee('due now');
        $response->assertSee('INGESTION_SCHEDULER_ENABLED=true php artisan ingestion:run --execute --job=reports.mayor.static');
        $response->assertSee('/mayor/cities/{city}');
        $response->assertSee('靜態 HTML 輸出改由動態 Laravel route 承接');
    }

    public function test_ingestion_job_detail_allows_video_duration_ingestion_preview(): void
    {
        $response = $this->get('/ops/ingestion/youtube.videos.duration?at=2026-05-25%2000:23:00');

        $response->assertOk();
        $response->assertSee('youtube.videos.duration');
        $response->assertSee('youtube:videos:duration');
        $response->assertSee('scheduled/local <code>--execute</code> updates duration queue rows', false);
        $response->assertSee('due now');
        $response->assertSee('INGESTION_SCHEDULER_ENABLED=true php artisan ingestion:run --execute --job=youtube.videos.duration');
        $response->assertSee('youtube:videos:duration --execute --limit=25 --enqueue-missing');
        $response->assertSee('Scheduler 在 write allowlist 開啟時使用 capped scheduled execute command；未開啟時維持 preview mode');
    }

    public function test_ingestion_job_detail_allows_video_stats_ingestion_preview(): void
    {
        $response = $this->get('/ops/ingestion/youtube.videos.stats?at=2026-05-25%2000:07:00');

        $response->assertOk();
        $response->assertSee('youtube.videos.stats');
        $response->assertSee('youtube:videos:stats');
        $response->assertSee('scheduled/local <code>--execute</code> updates video stats/log rows', false);
        $response->assertSee('due now');
        $response->assertSee('INGESTION_SCHEDULER_ENABLED=true php artisan ingestion:run --execute --job=youtube.videos.stats');
        $response->assertSee('Scheduler 在 write allowlist 開啟時使用 capped scheduled execute command；未開啟時維持 preview mode');
    }



    public function test_ingestion_job_detail_allows_counts_build_ingestion_preview(): void
    {
        $response = $this->get('/ops/ingestion/reports.counts.build?at=2026-05-25%2003:27:00');

        $response->assertOk();
        $response->assertSee('reports.counts.build');
        $response->assertSee('reports:counts:build');
        $response->assertSee('scheduled/local <code>--execute</code> updates <code>urt_count</code> weekly/monthly delta columns', false);
        $response->assertSee('due now');
        $response->assertSee('INGESTION_SCHEDULER_ENABLED=true php artisan ingestion:run --execute --job=reports.counts.build');
        $response->assertSee('更新本機 <code>urt_count</code> delta columns', false);
    }

    public function test_ingestion_job_detail_allows_keywords_build_ingestion_preview(): void
    {
        $response = $this->get('/ops/ingestion/reports.keywords.build?at=2026-05-25%2003:27:00');

        $response->assertOk();
        $response->assertSee('reports.keywords.build');
        $response->assertSee('reports:keywords:build');
        $response->assertSee('scheduled/local <code>--execute</code> upserts local <code>tags</code> rows', false);
        $response->assertSee('due now');
        $response->assertSee('reports:keywords:build --execute --hours=2 --limit=100');
        $response->assertSee('Scheduler-enabled local polling is blocked');
        $response->assertSee('tag.analysis.tw/api/tag_json.php');
    }

    public function test_ingestion_job_detail_allows_groups_build_ingestion_preview(): void
    {
        $response = $this->get('/ops/ingestion/reports.groups.build?at=2026-05-25%2003:27:00');

        $response->assertOk();
        $response->assertSee('reports.groups.build');
        $response->assertSee('reports:groups:build');
        $response->assertSee('scheduled/local <code>--execute</code> upserts local <code>tag_group</code> rows', false);
        $response->assertSee('due now');
        $response->assertSee('reports:groups:build --execute --hours=22 --limit=100');
        $response->assertSee('Scheduler-enabled local polling is blocked');
        $response->assertSee('external group API');
    }

    public function test_ingestion_job_detail_allows_people_build_ingestion_preview(): void
    {
        $response = $this->get('/ops/ingestion/reports.people.build?at=2026-05-25%2003:27:00');

        $response->assertOk();
        $response->assertSee('reports.people.build');
        $response->assertSee('reports:people:build');
        $response->assertSee('scheduled/local <code>--execute</code> upserts people <code>urt_show_tag_date</code> cache rows', false);
        $response->assertSee('due now');
        $response->assertSee('INGESTION_SCHEDULER_ENABLED=true php artisan ingestion:run --execute --job=reports.people.build');
        $response->assertSee('TagDateCacheBuilder');
    }

    public function test_ingestion_job_detail_allows_schedule_build_ingestion_preview(): void
    {
        $response = $this->get('/ops/ingestion/reports.schedule.build?at=2026-05-25%2003:29:00');

        $response->assertOk();
        $response->assertSee('reports.schedule.build');
        $response->assertSee('reports:schedule:build');
        $response->assertSee('scheduled/local <code>--execute</code> updates <code>urt_video_schedule.stime/mtime</code>', false);
        $response->assertSee('due now');
        $response->assertSee('INGESTION_SCHEDULER_ENABLED=true php artisan ingestion:run --execute --job=reports.schedule.build');
        $response->assertSee('限量更新本機 schedule rows');
    }

    public function test_ingestion_job_detail_allows_comment_queue_ingestion_preview(): void
    {
        $response = $this->get('/ops/ingestion/youtube.comments.queue?at=2026-05-25%2004:23:00');

        $response->assertOk();
        $response->assertSee('youtube.comments.queue');
        $response->assertSee('youtube:comments:queue --or=1,2,3,4,5,6,13,14,81 --hours=72 --min=500');
        $response->assertSee('explicit/scheduled <code>--execute --limit</code>', false);
        $response->assertSee('due now');
        $response->assertSee('INGESTION_SCHEDULER_ENABLED=true php artisan ingestion:run --execute --job=youtube.comments.queue');
        $response->assertSee('Production crontab 使用 <code>hours=72 min=500</code> 且只在 04/10/16 點第 23 分排程', false);
    }

    public function test_ingestion_job_detail_allows_comment_fetch_ingestion_preview(): void
    {
        $response = $this->get('/ops/ingestion/youtube.comments.fetch?at=2026-05-25%2005:05:00');

        $response->assertOk();
        $response->assertSee('youtube.comments.fetch');
        $response->assertSee('youtube:comments:fetch');
        $response->assertSee('explicit/scheduled <code>--execute --videoId/--limit --max-pages</code>', false);
        $response->assertSee('due now');
        $response->assertSee('此 job 目前不會執行；下面保留 guardrail 原始原因，方便對照 CLI/output。');
        $response->assertSee('php artisan ingestion:run --job=youtube.comments.fetch', false);
        $response->assertSee('Production crontab 只在每小時第 5 分排程');
    }

    public function test_ingestion_job_detail_returns_404_for_unknown_job(): void
    {
        $this->get('/ops/ingestion/not.real')->assertNotFound();
    }

    public function test_ingestion_list_console_command_summarizes_registry(): void
    {
        $exitCode = Artisan::call('ingestion:list');
        $output = Artisan::output();

        $this->assertSame(0, $exitCode);
        $this->assertStringContainsString('scheduler=disabled', $output);
        $this->assertStringContainsString('command_missing=0', $output);
        $this->assertStringContainsString('command_ready=29', $output);
        $this->assertStringContainsString('active command:ready /usr/bin/php /home/urtube/maint/get_statics.php -> youtube:channels:stats', $output);
        $this->assertStringContainsString('active command:ready /usr/bin/php /home/urtube/maint/get_live.php -> youtube:live:poll', $output);
        $this->assertStringContainsString('active command:ready /usr/bin/php /home/urtube/maint/get_live_tvbs.php -> youtube:tvbs:live:poll', $output);
        $this->assertStringContainsString('active command:ready /usr/bin/php /home/urtube/maint/get_video.php -> youtube:channels:videos', $output);
        $this->assertStringContainsString('active command:ready /usr/bin/php /home/urtube/maint/get_video_tvbs.php -> youtube:tvbs:videos', $output);
        $this->assertStringContainsString('active command:ready /usr/bin/php /home/urtube/maint/get_video.php tagid=102 plus make_tag_date.php -> youtube:tag-videos:backfill', $output);
        $this->assertStringContainsString('active command:ready /usr/bin/php /home/urtube/maint/get_video.php live=1 force=3 -> youtube:channels:videos --live=1 --force=3', $output);
        $this->assertStringContainsString('active command:ready /usr/bin/php /home/urtube/maint/get_video.php live=2 force=3 -> youtube:channels:videos --live=2 --force=3', $output);
        $this->assertStringContainsString('active command:ready /usr/bin/php /home/urtube/maint/unlist_live.php -> youtube:live:cleanup', $output);
        $this->assertStringContainsString('active command:ready /usr/bin/php /home/urtube/maint/make_live.php -> reports:live:build', $output);
        $this->assertStringContainsString('active command:ready /usr/bin/php /home/urtube/maint/show_live.php -> reports:live:show', $output);
        $this->assertStringContainsString('active command:ready /usr/bin/php /home/urtube/maint/clean_show_live.php -> reports:live:clean', $output);
        $this->assertStringContainsString('active command:ready /home/urtube/html/make_live.sh -> reports:live:static', $output);
        $this->assertStringContainsString('active command:ready /home/urtube/html/make_html.sh -> reports:static:build', $output);
        $this->assertStringContainsString('active command:ready /home/urtube/mayor/make_mayor.sh -> reports:mayor:static', $output);
        $this->assertStringContainsString('active command:ready /usr/bin/php /home/urtube/maint/make_count.php -> reports:counts:build', $output);
        $this->assertStringContainsString('active command:ready /usr/bin/php /home/urtube/maint/get_group.php -> reports:groups:build', $output);
        $this->assertStringContainsString('active command:ready /usr/bin/php /home/urtube/maint/make_keyword.php -> reports:keywords:build', $output);
        $this->assertStringContainsString('active command:ready /usr/bin/php /home/urtube/maint/make_people.php -> reports:people:build', $output);
        $this->assertStringContainsString('active command:ready /usr/bin/php /home/urtube/maint/make_tag_cloud.php -> reports:tag-cloud:build', $output);
        $this->assertStringContainsString('active command:ready /usr/bin/php /home/urtube/maint/make_schedule.php -> reports:schedule:build', $output);
        $this->assertStringContainsString('active command:ready /usr/bin/php /home/urtube/maint/get_duration.php -> youtube:videos:duration', $output);
        $this->assertStringContainsString('active command:ready /usr/bin/php /home/urtube/maint/get_video_count.php -> youtube:videos:stats', $output);
        $this->assertStringContainsString('active command:ready /home/urtube/maint/make_ai_day.sh -> ai:daily', $output);
        $this->assertStringContainsString('active command:ready /usr/bin/php /home/urtube/prompt/ai_hour_prompt.php do=1 -> ai:hourly', $output);
        $this->assertStringContainsString('active command:ready /usr/bin/php /home/urtube/maint/make_comments.php or=1,2,3,4,5,6,13,14,81 hours=72 min=500 -> youtube:comments:queue --or=1,2,3,4,5,6,13,14,81 --hours=72 --min=500', $output);
        $this->assertStringContainsString('active command:ready /usr/bin/php /home/urtube/maint/do_comments.php -> youtube:comments:fetch', $output);
        $this->assertStringContainsString('active command:ready /usr/bin/php /home/urtube/maint/make_tag_date.php -> reports:tag-date:build', $output);
        $this->assertStringContainsString('active command:ready /usr/bin/php /home/urtube/maint/tags_all.php -> reports:keywords:cache', $output);
        $this->assertStringContainsString('youtube:live:poll', $output);
    }

    public function test_ingestion_run_dry_run_evaluates_due_jobs_in_preview_mode(): void
    {
        $this->artisan('ingestion:run', [
            '--at' => '2026-05-25 00:00:00',
        ])
            ->expectsOutputToContain('mode=dry-run scheduler=disabled')
            ->expectsOutputToContain('[due] youtube.live.poll skip:scheduler-disabled -> youtube:live:poll')
            ->assertExitCode(0);

        $this->artisan('ingestion:run', [
            '--execute' => true,
            '--job' => 'reports.live.show',
            '--at' => '2026-05-25 00:07:00',
        ])
            ->expectsOutputToContain('mode=execute scheduler=disabled')
            ->expectsOutputToContain('[due] reports.live.show skip:scheduler-disabled -> reports:live:show')
            ->assertExitCode(0);
    }

    public function test_ingestion_run_can_record_cli_history_for_scheduled_runs(): void
    {
        Storage::fake('local');
        config()->set('ingestion.scheduler_enabled', true);
        config()->set('legacy.ground_truth_path', storage_path('framework/testing-missing-legacy'));

        $this->artisan('ingestion:run', [
            '--execute' => true,
            '--record' => true,
            '--job' => 'reports.live.static',
            '--at' => '2026-05-25 00:19:00',
        ])
            ->expectsOutputToContain('mode=execute scheduler=enabled')
            ->expectsOutputToContain('[due] reports.live.static executed -> reports:live:static')
            ->expectsOutputToContain('recorded=')
            ->assertExitCode(0);

        $files = Storage::disk('local')->files('ingestion-runs');
        $this->assertCount(1, $files);

        $record = json_decode((string) Storage::disk('local')->get($files[0]), true);
        $this->assertSame('artisan', $record['request']['source']);
        $this->assertSame('execute', $record['request']['mode']);
        $this->assertSame('reports.live.static', $record['request']['job']);
        $this->assertFalse($record['request']['scheduler_enabled_temporarily']);
        $this->assertTrue($record['request']['original_scheduler_enabled']);
        $this->assertSame('executed', $record['result']['jobs'][0]['action']);
    }

    public function test_active_ingestion_job_would_run_when_scheduler_is_enabled(): void
    {
        config()->set('ingestion.scheduler_enabled', true);

        $this->artisan('ingestion:run', [
            '--job' => 'reports.live.show',
            '--at' => '2026-05-25 00:07:00',
        ])
            ->expectsOutputToContain('mode=dry-run scheduler=enabled')
            ->expectsOutputToContain('[due] reports.live.show would-run -> reports:live:show')
            ->assertExitCode(0);
    }

    public function test_scheduler_refuses_active_jobs_that_declare_writes(): void
    {
        config()->set('ingestion.scheduler_enabled', true);
        config()->set('ingestion.jobs', collect(config('ingestion.jobs'))
            ->map(function (array $job): array {
                if ($job['key'] === 'reports.live.show') {
                    $job['writes'] = ['urt_show_video_live'];
                }

                return $job;
            })
            ->all());

        $this->artisan('ingestion:run', [
            '--execute' => true,
            '--job' => 'reports.live.show',
            '--at' => '2026-05-25 00:07:00',
        ])
            ->expectsOutputToContain('mode=execute scheduler=enabled')
            ->expectsOutputToContain('[due] reports.live.show skip:controlled-execution-guardrail -> reports:live:show')
            ->assertExitCode(0);
    }
}
