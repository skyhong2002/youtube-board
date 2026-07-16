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
        $this->assertSame(-100, $response->json('result.2026-05-10.orig'));
        $this->assertSame(0, $response->json('result.2026-05-10.videos'));

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
