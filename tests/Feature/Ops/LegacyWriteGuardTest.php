<?php

namespace Tests\Feature\Ops;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class LegacyWriteGuardTest extends TestCase
{
    public function test_legacy_redir_get_endpoint_renders_ingestion_guard(): void
    {
        $response = $this->get('/redir/add_video.php?videoId=test-video&u_id=10');

        $response->assertStatus(403);
        $response->assertSee('Legacy Writeback Disabled');
        $response->assertSee('/home/urtube/redir/add_video.php');
        $response->assertSee('call YouTube Data API videos.list');
        $response->assertSee('Writes performed');
        $response->assertSee('0');
        $response->assertSee('youtube:channels:videos');
    }

    public function test_legacy_redir_post_endpoint_returns_controlled_json(): void
    {
        Schema::dropIfExists('urt_channel_ai');
        Schema::create('urt_channel_ai', function ($table): void {
            $table->integer('pk')->nullable();
            $table->integer('u_id')->nullable();
            $table->string('data_type')->nullable();
            $table->text('result_json')->nullable();
        });

        $response = $this->postJson('/redir/channel_gpt.php', [
            'u_id' => 10,
            'token' => 'Gene',
            'topic_json' => str_repeat('x', 80),
        ]);

        $response->assertStatus(403);
        $response->assertJsonPath('script', 'channel_gpt');
        $response->assertJsonPath('realtime_dashboard', true);
        $response->assertJsonPath('writes', 0);
        $response->assertJsonPath('external_calls', 0);
        $response->assertJsonFragment(['insert urt_channel_ai topic rows']);
        $this->assertSame(0, DB::table('urt_channel_ai')->count());
    }

    public function test_unknown_redir_endpoint_remains_404(): void
    {
        $this->get('/redir/unknown.php')->assertNotFound();
    }
}
