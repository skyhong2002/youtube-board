<?php

namespace Tests\Feature\Ops;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class LegacyPromptGuardTest extends TestCase
{
    public function test_legacy_prompt_get_endpoint_renders_ingestion_guard(): void
    {
        $response = $this->get('/prompt/ai_hour_prompt.php?do=1&condition=green');

        $response->assertStatus(403);
        $response->assertSee('Legacy Writeback Disabled');
        $response->assertSee('/home/urtube/prompt/ai_hour_prompt.php');
        $response->assertSee('call AI chat completions');
        $response->assertSee('insert urt_ai_hour');
        $response->assertSee('ai:hourly');
        $response->assertSee('/ai/hours');
    }

    public function test_legacy_prompt_post_endpoint_returns_controlled_json(): void
    {
        Schema::dropIfExists('urt_ai_event');
        Schema::create('urt_ai_event', function ($table): void {
            $table->integer('pk')->nullable();
            $table->string('event')->nullable();
            $table->text('result_json')->nullable();
        });

        $response = $this->postJson('/prompt/ai_event_prompt.php', [
            'do' => 1,
            'event' => 'test event',
            'prompt' => str_repeat('x', 80),
        ]);

        $response->assertStatus(403);
        $response->assertJsonPath('script', 'ai_event_prompt');
        $response->assertJsonPath('realtime_dashboard', true);
        $response->assertJsonPath('writes', 0);
        $response->assertJsonPath('external_calls', 0);
        $response->assertJsonFragment(['insert urt_ai_event']);
        $this->assertSame(0, DB::table('urt_ai_event')->count());
    }

    public function test_legacy_period_prompt_is_guarded_as_prompt_compatibility_surface(): void
    {
        $response = $this->get('/prompt/ai_period_prompt.php?from=2026-05-01&to=2026-05-07');

        $response->assertStatus(403);
        $response->assertSee('ai_period_prompt');
        $response->assertSee('expose raw legacy prompt text assembled from urt_ai_date');
        $response->assertSee('/ai/periods');
    }

    public function test_unknown_prompt_endpoint_remains_404(): void
    {
        $this->get('/prompt/unknown.php')->assertNotFound();
    }
}
