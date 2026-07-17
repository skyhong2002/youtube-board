<?php

namespace Tests\Feature\Ops;

use App\Services\Ingestion\IngestionJobRegistry;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class IngestionDashboardTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        config()->set('ingestion.scheduler_enabled', true);
        config()->set('ingestion.local_polling_enabled', true);
        config()->set('ingestion.production_polling_enabled', true);
        config()->set('ingestion.scheduled_write_allowlist', ['*']);
    }

    public function test_provider_backed_jobs_are_classified_as_external_calls(): void
    {
        $registry = app(IngestionJobRegistry::class);
        $jobKeys = [
            'youtube.channels.stats',
            'youtube.live.poll',
            'youtube.tvbs.live.poll',
            'youtube.channels.videos.live_group',
            'youtube.channels.videos.live',
            'youtube.channels.videos.general',
            'youtube.tvbs.videos',
            'youtube.videos.stats',
            'youtube.videos.duration',
            'ai.daily',
            'ai.mayor_person',
            'ai.period',
            'ai.event',
            'ai.days_refresh',
            'ai.hourly',
        ];

        foreach ($jobKeys as $jobKey) {
            $description = $registry->describe($jobKey);

            $this->assertNotNull($description, $jobKey);
            $this->assertTrue($description['execution']['external_calls'], $jobKey);
        }

        $this->assertTrue($registry->describe('youtube.live.poll')['execution']['can_execute_when_due']);
        $this->assertFalse($registry->describe('youtube.channels.stats')['execution']['can_execute_when_due']);
        $this->assertContains(
            'Job declares an external API dependency.',
            $registry->describe('youtube.channels.stats')['execution']['blocks'],
        );
        $this->assertFalse($registry->describe('youtube.live.cleanup')['execution']['external_calls']);
    }

    public function test_ingestion_dashboard_renders_legacy_cron_registry_with_controlled_polling_state(): void
    {
        Storage::fake('local');

        $response = $this->get('/ops/ingestion');

        $response->assertOk();
        $response->assertSee('擷取排程');
        $response->assertSee('Web Request Gates');
        $response->assertSee('scheduler enabled');
        $response->assertSee('local polling enabled');
        $response->assertSee('External Scheduler Activity');
        $response->assertSee('external scheduler not observed');
        $response->assertSee('No external');
        $response->assertSee('YouTube Data API Quota Estimate');
        $response->assertSee('estimated 0 / 10,000 units');
        $response->assertSee('Ingestion Health Check');
        $response->assertSee('php artisan ingestion:health');
        $response->assertSee('外部資料擷取');
        $response->assertSee('內部報表處理');
        $response->assertSee('/ops/ingestion/data-capture', false);
        $response->assertSee('/ops/ingestion/report-processing', false);
        $response->assertSee('all scheduled writes enabled');
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
        $response->assertSee('Latest Ingestion Runs');
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
        $response->assertSee('0 scheduled blocked');
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
            $response->assertSee('No external scheduler run record was created within the recent activity window.');
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

        $this->assertSame([], Storage::disk('local')->files('ingestion-runs'));
        $this->assertSame(1, DB::table('ingestion_runs')->count());
        $this->assertSame(1, DB::table('ingestion_run_jobs')->count());

        $storedRun = DB::table('ingestion_runs')->first();
        $record = json_decode((string) $storedRun->payload_json, true, flags: JSON_THROW_ON_ERROR);
        $this->assertSame('execute', $record['request']['mode']);
        $this->assertSame('reports.live.static', $record['request']['job']);
        $this->assertTrue($record['request']['scheduler_enabled_temporarily']);
        $this->assertSame('execute', $record['result']['mode']);
        $this->assertSame('executed', $record['result']['jobs'][0]['action']);
        $this->assertSame('reports.live.static', DB::table('ingestion_run_jobs')->value('job_key'));

        $dashboard = $this->get('/ops/ingestion');
        $dashboard->assertOk();
        $dashboard->assertSee('Run saved:');
        $dashboard->assertSee($record['id']);
        $dashboard->assertSee('Latest Ingestion Runs');
        $dashboard->assertSee('reports.live.static');
        $dashboard->assertSee('execute');
        $dashboard->assertSee('YT Units');
        $dashboard->assertSee('database:ingestion_runs/');
        $dashboard->assertSee('/ops/ingestion/runs/'.$record['id'], false);

        $detail = $this->get('/ops/ingestion/runs/'.$record['id']);
        $detail->assertOk();
        $detail->assertSee($record['id']);
        $detail->assertSee('evaluated=1');
        $detail->assertSee('due=1');
        $detail->assertSee('executed=1');
        $detail->assertSee('failed=0');
        $detail->assertSee('yt quota≈0 units');
        $detail->assertSee('reports.live.static');
        $detail->assertSee('reports:live:static');
        $detail->assertSee('executed');
        $detail->assertSee('database:ingestion_runs/'.$record['id']);
    }

    public function test_ingestion_dashboard_blocks_web_execute_outside_local_development(): void
    {
        Storage::fake('local');
        config()->set('app.env', 'production');

        $dashboard = $this->get('/ops/ingestion');

        $dashboard->assertOk();
        $dashboard->assertDontSee('execute due jobs once');
        $dashboard->assertSee('Web runner 在此環境只提供 dry-run');

        $this->withSession(['_token' => 'test-token'])->post('/ops/ingestion/run', [
            '_token' => 'test-token',
            'mode' => 'execute',
            'job' => 'reports.live.static',
            'at' => '2026-05-25 00:19:00',
        ])->assertForbidden();

        $this->assertSame([], Storage::disk('local')->files('ingestion-runs'));
        $this->assertSame(0, DB::table('ingestion_runs')->count());
    }

    public function test_production_web_dry_run_does_not_write_durable_history(): void
    {
        Storage::fake('local');
        config()->set('app.env', 'production');

        $response = $this->followingRedirects()
            ->withSession(['_token' => 'test-token'])
            ->post('/ops/ingestion/run', [
                '_token' => 'test-token',
                'mode' => 'dry-run',
                'job' => 'reports.live.static',
                'at' => '2026-05-25 00:19:00',
            ]);

        $response->assertOk();
        $response->assertSee('Preview completed (not persisted):');
        $response->assertDontSee('Run saved:');
        $this->assertDatabaseCount('ingestion_runs', 0);
        $this->assertDatabaseCount('ingestion_run_jobs', 0);
        $this->assertSame([], Storage::disk('local')->files('ingestion-runs'));
    }

    public function test_production_web_runner_rate_limits_repeated_previews(): void
    {
        Storage::fake('local');
        config()->set('app.env', 'production');
        $payload = [
            '_token' => 'test-token',
            'mode' => 'dry-run',
            'job' => 'reports.live.static',
            'at' => '2026-05-25 00:19:00',
        ];

        for ($attempt = 0; $attempt < 10; $attempt++) {
            $this->withSession(['_token' => 'test-token'])
                ->post('/ops/ingestion/run', $payload)
                ->assertRedirect('/ops/ingestion');
        }

        $this->withSession(['_token' => 'test-token'])
            ->post('/ops/ingestion/run', $payload)
            ->assertTooManyRequests();
        $this->assertDatabaseCount('ingestion_runs', 0);
    }

    public function test_ingestion_dashboard_sums_daily_youtube_quota_estimate_from_run_history(): void
    {
        Storage::fake('local');
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-06-01 12:00:00', 'America/Los_Angeles'));

        try {
            Storage::disk('local')->put('ingestion-runs/20260601-110000-00000000-0000-4000-8000-000000000000.json', json_encode([
                'id' => '20260601-110000-00000000-0000-4000-8000-000000000000',
                'created_at' => '2026-06-01 11:00:00 America/Los_Angeles',
                'request' => [
                    'source' => 'artisan',
                    'mode' => 'execute',
                ],
                'result' => [
                    'mode' => 'execute',
                    'jobs' => [
                        [
                            'key' => 'youtube.tag_videos.backfill',
                            'executed' => true,
                            'failed' => false,
                            'estimated_youtube_quota_units' => 3,
                            'youtube_quota_estimate' => [
                                'estimated_units' => 3,
                                'basis' => 'test',
                            ],
                        ],
                        [
                            'key' => 'youtube.live.poll',
                            'executed' => true,
                            'failed' => false,
                            'output' => 'youtube:live:poll mode=local-execute selected_rows=4 api_requested_videos=4 updated_videos=4 skipped_videos=0',
                        ],
                    ],
                ],
            ], JSON_THROW_ON_ERROR));

            Storage::disk('local')->put('ingestion-runs/20260531-230000-11111111-1111-4111-8111-111111111111.json', json_encode([
                'id' => '20260531-230000-11111111-1111-4111-8111-111111111111',
                'created_at' => '2026-05-31 23:00:00 America/Los_Angeles',
                'request' => [
                    'source' => 'artisan',
                    'mode' => 'execute',
                ],
                'result' => [
                    'mode' => 'execute',
                    'youtube_quota_estimate' => ['estimated_units' => 99],
                ],
            ], JSON_THROW_ON_ERROR));

            $response = $this->get('/ops/ingestion');

            $response->assertOk();
            $response->assertSee('estimated 4 / 10,000 units');
            $response->assertSee('youtube.tag_videos.backfill=3');
            $response->assertSee('youtube.live.poll=1');
            $response->assertDontSee('99 / 10,000 units');
        } finally {
            CarbonImmutable::setTestNow();
        }
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
        $response->assertSee('explicit <code>--execute</code> calls OpenAI-compatible chat completions and upserts <code>urt_ai_hour</code>', false);
        $response->assertSee('due now');
        $response->assertSee('INGESTION_SCHEDULER_ENABLED=true php artisan ingestion:run --execute --job=ai.hourly');
        $response->assertSee('Scheduled Local Polling');
        $response->assertSee('ai:hourly:pipeline --execute --limit=20 --source-max-results=50');
        $response->assertSee('Runtime env 已明確啟用全部 scheduled polling');
    }

    public function test_ingestion_job_detail_allows_ai_daily_ingestion_preview(): void
    {
        $response = $this->get('/ops/ingestion/ai.daily?at=2026-05-26%2000:00:00');

        $response->assertOk();
        $response->assertSee('ai.daily');
        $response->assertSee('ai:daily');
        $response->assertSee('explicit <code>--execute</code> calls OpenAI-compatible chat completions and upserts <code>urt_channel_ai</code> / <code>urt_ai_date</code>', false);
        $response->assertSee('due now');
        $response->assertSee('INGESTION_SCHEDULER_ENABLED=true php artisan ingestion:run --execute --job=ai.daily');
        $response->assertSee('Scheduled Local Polling');
        $response->assertSee('ai:daily:pipeline --execute --date=yesterday --channel-limit=39 --channel-batch-size=12 --ai-call-limit=45 --channel-video-limit=120 --limit=1000');
        $response->assertSee('Runtime env 已明確啟用全部 scheduled polling');
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
        $response->assertSee('Scheduler 在 scheduled-write gates 允許時使用 scheduled execute command；關閉時不執行 capped command');
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
        $response->assertSee('Scheduler 在 scheduled-write gates 允許時使用 capped scheduled execute command；關閉時不執行 capped command');
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
        $response->assertSee('Runtime env 已明確啟用全部 scheduled polling');
        $response->assertSee('Scheduler 在 scheduled-write gates 允許時使用 capped scheduled execute command；關閉時不執行 capped command');
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
        $live->assertSee('Scheduler 在 scheduled-write gates 允許時使用 scheduled execute command；關閉時不執行 capped command');
        $liveGroup->assertSee('youtube.channels.videos.live_group');
        $liveGroup->assertSee('youtube:channels:videos --live=2 --force=3');
        $liveGroup->assertSee('Scheduler 在 scheduled-write gates 允許時使用 scheduled execute command；關閉時不執行 capped command');
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
        $response->assertSee('youtube:tvbs:videos --execute --limit=1 --max-results=1 --offset=auto');
        $response->assertSee('manual/scheduled <code>--execute --id/--channel --limit --max-results --offset</code>', false);
        $response->assertSee('Scheduler 使用 <code>--offset=auto</code> 每五分鐘輪轉 capped batch；缺 uploads playlist 會隔離為失敗且不會永久阻塞後續頻道。', false);
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
        $response->assertSee('Scheduler 在 scheduled-write gates 允許時使用 capped scheduled execute command；關閉時不執行 capped command');
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
        $response->assertSee('Scheduler 在 scheduled-write gates 允許時使用 capped scheduled execute command；關閉時不執行 capped command');
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
        $response->assertSee('malformed oldest history 只更新 <code>mtime</code> 作 cooldown', false);
    }

    public function test_ingestion_job_detail_allows_keywords_build_ingestion_preview(): void
    {
        $response = $this->get('/ops/ingestion/reports.keywords.build?at=2026-05-25%2003:27:00');

        $response->assertOk();
        $response->assertSee('reports.keywords.build');
        $response->assertSee('reports:keywords:build');
        $response->assertSee('scheduled/local <code>--execute</code> upserts local <code>tags</code> rows', false);
        $response->assertSee('due now');
        $response->assertSee('reports:keywords:build --execute --hours=2 --limit=100 --offset=auto');
        $response->assertSee('Runtime env 已明確啟用全部 scheduled polling');
        $response->assertSee('先套 offset/limit 再逐筆驗證');
    }

    public function test_ingestion_job_detail_allows_groups_build_ingestion_preview(): void
    {
        $response = $this->get('/ops/ingestion/reports.groups.build?at=2026-05-25%2003:27:00');

        $response->assertOk();
        $response->assertSee('reports.groups.build');
        $response->assertSee('reports:groups:build');
        $response->assertSee('scheduled/local <code>--execute</code> upserts local <code>tag_group</code> rows', false);
        $response->assertSee('due now');
        $response->assertSee('reports:groups:build --execute --hours=22 --limit=100 --offset=auto');
        $response->assertSee('Runtime env 已明確啟用全部 scheduled polling');
        $response->assertSee('malformed selected row 隔離且 cursor 仍前進');
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
        $response->assertSee('保留既有 <code>stime</code> 並讓 capped batch 輪替', false);
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
        $response->assertSee('Explicit/scheduled <code>--execute --videoId/--limit --max-pages --max-reply-pages</code>', false);
        $response->assertSee('comments.list(parentId)');
        $response->assertSee('最後才發布 <code>urt_comment</code>', false);
        $response->assertSee('完成後才建立 idempotent done row 並刪 queue row');
        $response->assertSee('單筆失敗會保留 queue row、釋放 claim');
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
        $this->assertStringContainsString('scheduler=enabled', $output);
        $this->assertStringContainsString('command_missing=0', $output);
        $this->assertStringContainsString('command_ready=42', $output);
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
        $this->assertStringContainsString('active command:ready /usr/bin/php /home/urtube/api/cloud.php uid=... -> reports:channel-cloud:build', $output);
        $this->assertStringContainsString('active command:ready /usr/bin/php /home/urtube/maint/make_schedule.php -> reports:schedule:build', $output);
        $this->assertStringContainsString('active command:ready /usr/bin/php /home/urtube/maint/get_duration.php -> youtube:videos:duration', $output);
        $this->assertStringContainsString('active command:ready /usr/bin/php /home/urtube/maint/get_video_count.php -> youtube:videos:stats', $output);
        $this->assertStringContainsString('active command:ready /home/urtube/maint/make_ai_day.sh -> ai:daily', $output);
        $this->assertStringContainsString('planned command:ready /usr/bin/php /home/urtube/prompt/ai_cont_prompt.php do=1 -> ai:period', $output);
        $this->assertStringContainsString('planned command:ready /usr/bin/php /home/urtube/prompt/ai_event_prompt.php do=1 -> ai:event', $output);
        $this->assertStringContainsString('planned command:ready operator-run make_ai_day.sh + ai_event_prompt.php + ai_cont_prompt.php sequence -> ai:days:refresh', $output);
        $this->assertStringContainsString('active command:ready /usr/bin/php /home/urtube/prompt/ai_hour_prompt.php do=1 -> ai:hourly', $output);
        $this->assertStringContainsString('active command:ready /usr/bin/php /home/urtube/maint/make_comments.php or=1,2,3,4,5,6,13,14,81 hours=72 min=500 -> youtube:comments:queue --or=1,2,3,4,5,6,13,14,81 --hours=72 --min=500', $output);
        $this->assertStringContainsString('active command:ready /usr/bin/php /home/urtube/maint/do_comments.php -> youtube:comments:fetch', $output);
        $this->assertStringContainsString('active command:ready /usr/bin/php /home/urtube/maint/make_tag_date.php -> reports:tag-date:build', $output);
        $this->assertStringContainsString('active command:ready /usr/bin/php /home/urtube/maint/tags_all.php -> reports:keywords:cache', $output);
        $this->assertStringContainsString('planned command:ready /usr/bin/php /home/urtube/api/api_live_tag_date.php -> reports:live-tag-date:build', $output);
        $this->assertStringContainsString('planned command:ready approved legacy snapshot/export -> urt_show_tag_month -> reports:tag-month:build', $output);
        $this->assertStringContainsString('planned command:ready /usr/bin/php /home/urtube/maint/channel_pred.php -> reports:channel-predictions:build', $output);
        $this->assertStringContainsString('planned command:ready /usr/bin/php /home/urtube/api/tags_relation_date.php -> reports:keyword-relations:build', $output);
        $this->assertStringContainsString('planned command:ready /usr/bin/php /home/urtube/api/tag_tags_days.php -> reports:keyword-cloud:build', $output);
        $this->assertStringContainsString('youtube:live:poll', $output);
    }

    public function test_ingestion_run_dry_run_evaluates_due_jobs_in_preview_mode(): void
    {
        config()->set('ingestion.scheduler_enabled', false);

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

        $this->assertSame([], Storage::disk('local')->files('ingestion-runs'));
        $this->assertSame(1, DB::table('ingestion_runs')->count());

        $storedRun = DB::table('ingestion_runs')->first();
        $record = json_decode((string) $storedRun->payload_json, true, flags: JSON_THROW_ON_ERROR);
        $this->assertSame('artisan', $record['request']['source']);
        $this->assertSame('execute', $record['request']['mode']);
        $this->assertSame('reports.live.static', $record['request']['job']);
        $this->assertFalse($record['request']['scheduler_enabled_temporarily']);
        $this->assertTrue($record['request']['original_scheduler_enabled']);
        $this->assertSame('executed', $record['result']['jobs'][0]['action']);
        $this->assertSame('reports.live.static', DB::table('ingestion_run_jobs')->value('job_key'));
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
