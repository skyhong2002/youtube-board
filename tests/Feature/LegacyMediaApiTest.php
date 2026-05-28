<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class LegacyMediaApiTest extends TestCase
{
    public function test_duration_api_returns_cached_duration_plain_text_through_ingestion_lookup(): void
    {
        $this->createVideoDurationTable();
        DB::table('urt_video_duration')->insert([
            'pk_video' => 1,
            'ctime' => '2026-05-24 00:00:00',
            'mtime' => '2026-05-24 01:00:00',
            'stime' => null,
            'publishedAt' => '2026-05-24 00:00:00',
            'u_id' => 10,
            'videoId' => 'video-a',
            'duration' => 345,
            'caption' => null,
        ]);

        $hit = $this->get('/api/api_duration.php?videoId=video-a');
        $miss = $this->get('/api/api_duration.php?videoId=video-missing');

        $hit->assertOk();
        $hit->assertHeader('X-Youtube-Board-Data-Source', 'true');
        $this->assertSame('345', $hit->getContent());
        $this->assertSame('0', $miss->getContent());
        $this->assertSame(1, DB::table('urt_video_duration')->count());
    }

    public function test_get_photo_api_returns_cached_url_plain_text_through_cached_photo_lookup(): void
    {
        $this->createPhotoTable();
        DB::table('urt_show_photo')->insert([
            'pk' => 1,
            'ctime' => '2026-05-24 00:00:00',
            'mtime' => '2026-05-24 01:00:00',
            'tag' => '柯文哲',
            'image_url' => 'https://example.test/kp.jpg',
            'image_source' => 'wiki',
        ]);

        $hit = $this->get('/api/api_get_photo.php?tag=柯文哲');
        $miss = $this->get('/api/api_get_photo.php?tag=不存在');

        $hit->assertOk();
        $hit->assertHeader('X-Youtube-Board-Data-Source', 'true');
        $this->assertSame('https://example.test/kp.jpg', $hit->getContent());
        $this->assertSame('null', $miss->getContent());
        $this->assertSame(1, DB::table('urt_show_photo')->count());
    }

    private function createVideoDurationTable(): void
    {
        Schema::create('urt_video_duration', function ($table): void {
            $table->integer('pk_video');
            $table->dateTime('ctime');
            $table->dateTime('mtime')->nullable();
            $table->dateTime('stime')->nullable();
            $table->dateTime('publishedAt')->nullable();
            $table->integer('u_id')->nullable();
            $table->string('videoId');
            $table->integer('duration')->nullable();
            $table->string('caption')->nullable();
        });
    }

    private function createPhotoTable(): void
    {
        Schema::create('urt_show_photo', function ($table): void {
            $table->integer('pk');
            $table->dateTime('ctime');
            $table->dateTime('mtime')->nullable();
            $table->string('tag');
            $table->string('image_url');
            $table->string('image_source')->nullable();
        });
    }
}
