<?php

namespace Tests\Feature\Reports;

use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class ChannelTrendsRouteTest extends TestCase
{
    public function test_channel_trends_page_renders_legacy_urt_log_series(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-10 12:00:00', 'Asia/Taipei'));
        $this->createTables();
        $this->seedLogRows();

        $response = $this->get('/channels/10/trends?limit=3&orig=1');

        $response->assertOk();
        $response->assertSee('Test Channel 在 3 天的折線圖');
        $response->assertSee('原始資料');
        $response->assertSee('2026-05-10');
        $response->assertSee('100');
        $response->assertSee('urt_log', false);

        $this->get('/channels/10/trends?limit=3&each=1')
            ->assertOk()
            ->assertSee('估計值');

        $this->get('/channels/10/trends?limit=3&videos=1')
            ->assertOk()
            ->assertSee('影片數');

        Carbon::setTestNow();
    }

    public function test_channel_trends_page_reports_empty_local_log(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-10 12:00:00', 'Asia/Taipei'));
        $this->createTables();
        DB::table('urt_channel')->insert([
            'u_id' => 10,
            'youtube_id' => 'UC10',
            'title' => 'Test Channel',
            'thumbnails' => 'https://example.test/channel.jpg',
        ]);

        $this->get('/channels/10/trends?limit=2')
            ->assertOk()
            ->assertSee('Data unavailable locally')
            ->assertSee('local urt_log has no rows for this channel')
            ->assertSee('channel_line.php + api/api_channel_log.php')
            ->assertSee('empty');

        Carbon::setTestNow();
    }

    private function createTables(): void
    {
        foreach (['urt_channel', 'urt_log'] as $table) {
            Schema::dropIfExists($table);
        }

        Schema::create('urt_channel', function ($table): void {
            $table->integer('u_id');
            $table->string('youtube_id')->nullable();
            $table->string('title')->nullable();
            $table->string('thumbnails')->nullable();
        });

        Schema::create('urt_log', function ($table): void {
            $table->integer('pk');
            $table->integer('u_id');
            $table->dateTime('ctime');
            $table->dateTime('mtime')->nullable();
            $table->date('themonth');
            $table->longText('thedata')->nullable();
        });
    }

    private function seedLogRows(): void
    {
        DB::table('urt_channel')->insert([
            'u_id' => 10,
            'youtube_id' => 'UC10',
            'title' => 'Test Channel',
            'thumbnails' => 'https://example.test/channel.jpg',
        ]);

        DB::table('urt_log')->insert([
            'pk' => 1,
            'u_id' => 10,
            'ctime' => '2026-05-01 00:00:00',
            'mtime' => '2026-05-10 00:00:00',
            'themonth' => '2026-05-01',
            'thedata' => json_encode($this->dailyLog('2026-04-25', 16), JSON_UNESCAPED_UNICODE),
        ]);
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
}
