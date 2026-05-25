<?php

namespace Tests\Feature\Ops;

use App\Services\Ingestion\IngestionSchedulerRunner;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class ReadOnlyAiHourlyCommandTest extends TestCase
{
    protected function tearDown(): void
    {
        CarbonImmutable::setTestNow();

        parent::tearDown();
    }

    public function test_ai_hourly_previews_default_cron_window_without_calling_ai_or_inserting_rows(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 10:10:00', 'Asia/Taipei'));
        $this->createTables();
        $this->seedDefaultFixtures();

        DB::table('urt_ai_hour')->insert([
            'ctime' => '2026-05-25 10:05:00',
            'mtime' => null,
            'date_from' => '2026-05-25 09:00:00',
            'date_to' => '2026-05-25 09:59:59',
            'condition_type' => 'all',
            'ai_type' => 'gpt-4o-mini',
            'data_type' => 'each',
            'user_token' => 'cli',
            'del_flag' => null,
            'result_json' => '[]',
        ]);

        $exitCode = Artisan::call('ai:hourly', [
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame('read-only-preview', $payload['mode']);
        $this->assertSame('legacy_ai_hour_prompt', $payload['source']);
        $this->assertSame('all', $payload['condition_type']);
        $this->assertFalse($payload['explicit_condition']);
        $this->assertSame([31, 41], $payload['filters']['not']);
        $this->assertSame('2026-05-25 09:00:00', $payload['date_from']);
        $this->assertSame('2026-05-25 09:59:59', $payload['date_to']);
        $this->assertSame(3, $payload['matching_channels']);
        $this->assertSame(3, $payload['video_rows']);
        $this->assertSame(['min' => 3, 'max' => 7], $payload['prompt_bounds']);
        $this->assertSame(1, $payload['existing_ai_hour_rows']);
        $this->assertSame(1, $payload['would_call_ai_requests']);
        $this->assertSame(1, $payload['would_insert_ai_hour_rows']);
        $this->assertSame([], $payload['writes']);
        $this->assertSame('blue-video', $payload['rows'][0]['video_id']);
        $this->assertSame(1, DB::table('urt_ai_hour')->count());
    }

    public function test_ai_hourly_preserves_legacy_condition_filter_branches(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 10:10:00', 'Asia/Taipei'));
        $this->createTables();
        $this->seedDefaultFixtures();

        $exitCode = Artisan::call('ai:hourly', [
            '--condition' => 'blue',
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame('blue', $payload['condition_type']);
        $this->assertTrue($payload['explicit_condition']);
        $this->assertSame([3, 13], $payload['filters']['tagid']);
        $this->assertSame(1, $payload['matching_channels']);
        $this->assertSame(1, $payload['video_rows']);
        $this->assertSame('blue-video', $payload['rows'][0]['video_id']);

        $exitCode = Artisan::call('ai:hourly', [
            '--condition' => 'all',
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame([102], $payload['filters']['tagid']);
        $this->assertSame(1, $payload['matching_channels']);
        $this->assertSame(1, $payload['video_rows']);
        $this->assertSame('explicit-all-video', $payload['rows'][0]['video_id']);
    }

    public function test_ingestion_scheduler_can_execute_read_only_ai_hourly_preview_when_due(): void
    {
        $this->createTables();
        config()->set('ingestion.scheduler_enabled', true);

        $result = app(IngestionSchedulerRunner::class)->run(
            at: CarbonImmutable::parse('2026-05-25 00:10:00', 'Asia/Taipei'),
            execute: true,
            jobKey: 'ai.hourly',
        );

        $this->assertSame(['evaluated' => 1, 'due' => 1, 'executed' => 1, 'skipped' => 0, 'failed' => 0], $result['summary']);
        $this->assertSame('executed', $result['jobs'][0]['action']);
        $this->assertSame(0, DB::table('urt_ai_hour')->count());
    }

    private function createTables(): void
    {
        foreach (['urt_ai_hour', 'urt_video', 'urt_count'] as $table) {
            Schema::dropIfExists($table);
        }

        Schema::create('urt_count', function ($table): void {
            $table->integer('u_id');
            $table->string('tags')->nullable();
        });

        Schema::create('urt_video', function ($table): void {
            $table->increments('pk');
            $table->integer('u_id');
            $table->string('videoId');
            $table->dateTime('publishedAt');
            $table->string('title')->nullable();
            $table->string('channelTitle')->nullable();
            $table->bigInteger('viewCount')->nullable();
            $table->integer('likeCount')->nullable();
            $table->integer('commentCount')->nullable();
        });

        Schema::create('urt_ai_hour', function ($table): void {
            $table->increments('pk');
            $table->dateTime('ctime');
            $table->dateTime('mtime')->nullable();
            $table->dateTime('date_from')->nullable();
            $table->dateTime('date_to')->nullable();
            $table->string('condition_type');
            $table->string('ai_type');
            $table->string('data_type');
            $table->string('user_token');
            $table->integer('del_flag')->nullable();
            $table->text('result_json');
        });
    }

    private function seedDefaultFixtures(): void
    {
        DB::table('urt_count')->insert([
            ['u_id' => 1, 'tags' => '[13]'],
            ['u_id' => 2, 'tags' => '[31]'],
            ['u_id' => 3, 'tags' => '[102]'],
            ['u_id' => 4, 'tags' => '[3],[13]'],
        ]);

        DB::table('urt_video')->insert([
            $this->videoRow(1, 'include-default', '2026-05-25 09:10:00', 1000, 'Default Included'),
            $this->videoRow(2, 'finance-excluded', '2026-05-25 09:20:00', 3000, 'Finance Excluded'),
            $this->videoRow(3, 'explicit-all-video', '2026-05-25 09:30:00', 2000, 'Explicit All'),
            $this->videoRow(4, 'blue-video', '2026-05-25 09:40:00', 2500, 'Blue Included'),
            $this->videoRow(1, 'too-old', '2026-05-25 08:59:59', 900, 'Too Old'),
            $this->videoRow(1, 'too-new', '2026-05-25 10:00:00', 900, 'Too New'),
        ]);
    }

    /**
     * @return array<string, mixed>
     */
    private function videoRow(int $uId, string $videoId, string $publishedAt, int $views, string $title): array
    {
        return [
            'u_id' => $uId,
            'videoId' => $videoId,
            'publishedAt' => $publishedAt,
            'title' => $title,
            'channelTitle' => 'Channel '.$uId,
            'viewCount' => $views,
            'likeCount' => 10,
            'commentCount' => 5,
        ];
    }
}
