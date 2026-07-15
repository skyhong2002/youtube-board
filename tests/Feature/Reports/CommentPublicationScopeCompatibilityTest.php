<?php

namespace Tests\Feature\Reports;

use App\Services\Legacy\CommentPublicationScope;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class CommentPublicationScopeCompatibilityTest extends TestCase
{
    public function test_legacy_complete_rows_remain_public_while_laravel_staging_rows_stay_private(): void
    {
        Schema::dropIfExists('urt_comment');
        Schema::create('urt_comment', function ($table): void {
            $table->increments('pk');
            $table->string('videoId');
            $table->dateTime('mtime')->nullable();
            $table->dateTime('stime')->nullable();
            $table->string('pageToken')->nullable();
        });
        DB::table('urt_comment')->insert([
            [
                'videoId' => 'legacy-null-token',
                'mtime' => '2026-05-25 10:00:00',
                'stime' => null,
                'pageToken' => null,
            ],
            [
                'videoId' => 'legacy-empty-token',
                'mtime' => '2026-05-25 10:01:00',
                'stime' => null,
                'pageToken' => '',
            ],
            [
                'videoId' => 'laravel-published',
                'mtime' => '2026-05-25 10:02:00',
                'stime' => '2026-05-25 10:02:00',
                'pageToken' => '',
            ],
            [
                'videoId' => 'laravel-staged',
                'mtime' => '2026-05-25 10:03:00',
                'stime' => null,
                'pageToken' => 'NEXT-PAGE',
            ],
        ]);

        $visibleVideoIds = CommentPublicationScope::complete(DB::table('urt_comment'))
            ->orderBy('pk')
            ->pluck('videoId')
            ->all();

        $this->assertSame([
            'legacy-null-token',
            'legacy-empty-token',
            'laravel-published',
        ], $visibleVideoIds);
        $this->assertNotContains('laravel-staged', $visibleVideoIds);
    }
}
