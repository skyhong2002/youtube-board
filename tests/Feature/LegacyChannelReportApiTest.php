<?php

namespace Tests\Feature;

use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class LegacyChannelReportApiTest extends TestCase
{
    public function test_channel_log_api_expands_urt_log_thedata_ingestion(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-10 12:00:00', 'Asia/Taipei'));
        $this->createChannelTable();
        $this->createLogTable();
        DB::table('urt_channel')->insert([
            'u_id' => 10,
            'youtube_id' => 'UC10',
            'title' => 'Test Channel',
        ]);
        DB::table('urt_log')->insert([
            'pk' => 1,
            'u_id' => 10,
            'ctime' => '2026-05-01 00:00:00',
            'mtime' => '2026-05-10 00:00:00',
            'themonth' => '2026-05-01',
            'thedata' => json_encode($this->dailyLog('2026-04-25', 16), JSON_UNESCAPED_UNICODE),
        ]);

        $response = $this->getJson('/api/api_channel_log.php?u_id=10&limit=3');

        $response->assertOk();
        $response->assertJsonPath('meta.source', 'urt_log.thedata');
        $response->assertJsonPath('meta.realtime_dashboard', true);
        $response->assertJsonPath('meta.channel.title', 'Test Channel');
        $this->assertSame(100, $response->json('result.2026-05-10.orig'));
        $this->assertSame(1, $response->json('result.2026-05-10.videos'));
        $this->assertSame(100, $response->json('result.2026-05-10.pred'));
        $this->assertSame(100, $response->json('result.2026-05-10.moving'));
        $this->assertSame(1, DB::table('urt_log')->count());

        Carbon::setTestNow();
    }

    public function test_channel_prediction_api_returns_summary_through_ingestion_workflow(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-10 12:00:00', 'Asia/Taipei'));
        $this->createLogTable();
        DB::table('urt_log')->insert([
            'pk' => 1,
            'u_id' => 10,
            'ctime' => '2026-05-01 00:00:00',
            'mtime' => '2026-05-10 00:00:00',
            'themonth' => '2026-05-01',
            'thedata' => json_encode($this->dailyLog('2026-04-25', 16), JSON_UNESCAPED_UNICODE),
        ]);

        $response = $this->getJson('/api/channel_pred.php?u_id=10&limit=7');

        $response->assertOk();
        $response->assertJsonPath('meta.writeback_skipped', 'run reports:channel-predictions:build --execute for reviewed urt_count prediction writeback');
        $response->assertJsonPath('meta.months_limit', 4);
        $response->assertJsonPath('summary.views_pred_week', 700);
        $this->assertSame(100, $response->json('result.2026-05-10.pred'));
        $this->assertSame(1, DB::table('urt_log')->count());

        Carbon::setTestNow();
    }

    public function test_channel_log_api_reports_empty_local_log_in_preview_mode(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-10 12:00:00', 'Asia/Taipei'));
        $this->createLogTable();

        $response = $this->getJson('/api/api_channel_log.php?u_id=10&limit=2');

        $response->assertOk();
        $response->assertJsonPath('meta.available', false);
        $response->assertJsonPath('meta.blocked_reason', 'local urt_log has no rows for this channel');
        $response->assertJsonPath('meta.log_rows', 0);
        $response->assertJsonPath('meta.invalid_log_rows', 0);
        $response->assertJsonPath('meta.unusable_log_rows', 0);
        $response->assertJsonPath('meta.valid_points', 0);
        $response->assertJsonPath('meta.view_points', 0);
        $response->assertJsonPath('meta.video_points', 0);
        $this->assertSame(3, count($response->json('result')));
        $this->assertSame(0, $response->json('result.2026-05-10.orig'));
        $this->assertSame(0, DB::table('urt_log')->count());

        Carbon::setTestNow();
    }

    public function test_channel_log_api_preserves_signed_deltas(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-10 12:00:00', 'Asia/Taipei'));
        $this->createLogTable();
        DB::table('urt_log')->insert([
            'pk' => 1,
            'u_id' => 10,
            'ctime' => '2026-05-01 00:00:00',
            'mtime' => '2026-05-10 00:00:00',
            'themonth' => '2026-05-01',
            'thedata' => json_encode([
                '2026-05-09' => ['view' => 1000, 'video' => 10],
                '2026-05-10' => ['view' => 900, 'video' => 8],
            ], JSON_UNESCAPED_UNICODE),
        ]);

        $response = $this->getJson('/api/api_channel_log.php?u_id=10&limit=1');

        $response->assertOk();
        $this->assertSame(-100, $response->json('result.2026-05-10.orig'));
        $this->assertSame(-2, $response->json('result.2026-05-10.videos'));

        Carbon::setTestNow();
    }

    public function test_channel_log_api_returns_zero_when_previous_date_is_missing(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-10 12:00:00', 'Asia/Taipei'));
        $this->createLogTable();
        DB::table('urt_log')->insert([
            'pk' => 1,
            'u_id' => 10,
            'ctime' => '2026-05-01 00:00:00',
            'mtime' => '2026-05-10 00:00:00',
            'themonth' => '2026-05-01',
            'thedata' => json_encode([
                '2026-05-10' => ['view' => 900, 'video' => 8],
            ], JSON_UNESCAPED_UNICODE),
        ]);

        $response = $this->getJson('/api/api_channel_log.php?u_id=10&limit=1');

        $response->assertOk();
        $this->assertSame(0, $response->json('result.2026-05-10.orig'));
        $this->assertSame(0, $response->json('result.2026-05-10.videos'));

        Carbon::setTestNow();
    }

    public function test_channel_log_api_tracks_alias_metric_presence_independently(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-10 12:00:00', 'Asia/Taipei'));
        $this->createLogTable();
        DB::table('urt_log')->insert([
            'pk' => 1,
            'u_id' => 10,
            'ctime' => '2026-05-01 00:00:00',
            'mtime' => '2026-05-10 00:00:00',
            'themonth' => '2026-05-01',
            'thedata' => json_encode([
                '2026-05-09' => ['total_views' => 1000],
                '2026-05-10' => ['total_views' => 900, 'videos' => 8],
            ], JSON_UNESCAPED_UNICODE),
        ]);

        $response = $this->getJson('/api/api_channel_log.php?u_id=10&limit=1');

        $response->assertOk();
        $response->assertJsonPath('meta.invalid_log_rows', 0);
        $response->assertJsonPath('meta.unusable_log_rows', 0);
        $response->assertJsonPath('meta.valid_points', 2);
        $response->assertJsonPath('meta.view_points', 2);
        $response->assertJsonPath('meta.video_points', 1);
        $this->assertSame(-100, $response->json('result.2026-05-10.orig'));
        $this->assertSame(0, $response->json('result.2026-05-10.videos'));

        Carbon::setTestNow();
    }

    public function test_channel_log_api_reports_mixed_payload_quality_counters(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-10 12:00:00', 'Asia/Taipei'));
        $this->createLogTable();
        DB::table('urt_log')->insert([
            $this->logRow(1, '{bad-json'),
            $this->logRow(2, 'null'),
            $this->logRow(3, '[]'),
            $this->logRow(4, json_encode('scalar', JSON_THROW_ON_ERROR)),
            $this->logRow(5, json_encode([
                '2026-05-08' => ['view' => 'not-numeric', 'video' => null],
            ], JSON_THROW_ON_ERROR)),
            $this->logRow(6, json_encode([
                '2026-05-09' => ['total_views' => '1000'],
            ], JSON_THROW_ON_ERROR)),
            $this->logRow(7, json_encode([
                '2026-05-10' => ['videos' => 8],
            ], JSON_THROW_ON_ERROR)),
            $this->logRow(8, null),
            $this->logRow(9, '   '),
        ]);

        $response = $this->getJson('/api/api_channel_log.php?u_id=10&limit=2');

        $response->assertOk();
        $response->assertJsonPath('meta.available', true);
        $response->assertJsonPath('meta.blocked_reason', null);
        $response->assertJsonPath('meta.log_rows', 9);
        $response->assertJsonPath('meta.invalid_log_rows', 1);
        $response->assertJsonPath('meta.unusable_log_rows', 6);
        $response->assertJsonPath('meta.valid_points', 3);
        $response->assertJsonPath('meta.view_points', 1);
        $response->assertJsonPath('meta.video_points', 1);
        $this->assertCount(3, $response->json('result'));

        Carbon::setTestNow();
    }

    public function test_channel_prediction_requires_view_points_while_channel_log_accepts_video_points(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-10 12:00:00', 'Asia/Taipei'));
        $this->createLogTable();
        DB::table('urt_log')->insert($this->logRow(1, json_encode([
            '2026-05-09' => ['video' => 10],
            '2026-05-10' => ['videos' => '12'],
        ], JSON_THROW_ON_ERROR)));

        $channelLog = $this->getJson('/api/api_channel_log.php?u_id=10&limit=1');
        $prediction = $this->getJson('/api/channel_pred.php?u_id=10&limit=1');

        $channelLog->assertOk();
        $channelLog->assertJsonPath('meta.available', true);
        $channelLog->assertJsonPath('meta.blocked_reason', null);
        $channelLog->assertJsonPath('meta.valid_points', 2);
        $channelLog->assertJsonPath('meta.view_points', 0);
        $channelLog->assertJsonPath('meta.video_points', 2);
        $this->assertSame(2, $channelLog->json('result.2026-05-10.videos'));

        $prediction->assertOk();
        $prediction->assertJsonPath('meta.available', false);
        $prediction->assertJsonPath('meta.blocked_reason', 'local urt_log has no usable rows for this channel');
        $prediction->assertJsonPath('meta.valid_points', 2);
        $prediction->assertJsonPath('meta.view_points', 0);
        $prediction->assertJsonPath('meta.video_points', 2);
        $this->assertCount(2, $prediction->json('result'));

        Carbon::setTestNow();
    }

    public function test_channel_log_api_uses_legacy_precision_and_truncation_for_missing_days(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-13 12:00:00', 'Asia/Taipei'));
        $this->createLogTable();
        $weekdayDeltas = [1, 2, 4, 8, 16, 32, 64];
        $view = 100_000;
        $log = [];
        $date = Carbon::parse('2026-01-01', 'Asia/Taipei');
        $lastCompleteDate = Carbon::parse('2026-05-10', 'Asia/Taipei');

        while ($date->lte($lastCompleteDate)) {
            $view += $weekdayDeltas[(int) $date->format('w')];
            $log[$date->toDateString()] = ['view' => $view, 'video' => 100];
            $date->addDay();
        }

        $view += 500;
        $log['2026-05-11'] = ['view' => $view, 'video' => 100];
        DB::table('urt_log')->insert([
            'pk' => 1,
            'u_id' => 10,
            'ctime' => '2026-01-01 00:00:00',
            'mtime' => '2026-05-11 00:00:00',
            'themonth' => '2026-01-01',
            'thedata' => json_encode($log, JSON_UNESCAPED_UNICODE),
        ]);

        $response = $this->getJson('/api/api_channel_log.php?u_id=10&limit=100');

        $response->assertOk();
        $this->assertSame(1003, $response->json('result.2026-05-12.pred'));
        $this->assertSame(2006, $response->json('result.2026-05-13.pred'));
        $this->assertSame(518, $response->json('result.2026-05-13.moving'));

        Carbon::setTestNow();
    }

    /**
     * @return array<string, array{view: int, video: int}>
     */
    private function dailyLog(string $startDate, int $days): array
    {
        $rows = [];
        $start = Carbon::parse($startDate, 'Asia/Taipei');

        for ($i = 0; $i < $days; $i++) {
            $date = $start->copy()->addDays($i)->toDateString();
            $rows[$date] = [
                'view' => 1000 + ($i * 100),
                'video' => 20 + $i,
            ];
        }

        return $rows;
    }

    /**
     * @return array<string, mixed>
     */
    private function logRow(int $pk, ?string $thedata): array
    {
        return [
            'pk' => $pk,
            'u_id' => 10,
            'ctime' => '2026-05-01 00:00:00',
            'mtime' => '2026-05-10 00:00:00',
            'themonth' => '2026-05-01',
            'thedata' => $thedata,
        ];
    }

    private function createChannelTable(): void
    {
        Schema::create('urt_channel', function ($table): void {
            $table->integer('u_id');
            $table->string('youtube_id')->nullable();
            $table->string('title')->nullable();
        });
    }

    private function createLogTable(): void
    {
        Schema::create('urt_log', function ($table): void {
            $table->integer('pk');
            $table->integer('u_id');
            $table->dateTime('ctime');
            $table->dateTime('mtime')->nullable();
            $table->date('themonth');
            $table->longText('thedata')->nullable();
        });
    }
}
