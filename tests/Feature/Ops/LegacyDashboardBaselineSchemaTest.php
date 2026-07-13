<?php

namespace Tests\Feature\Ops;

use App\Support\LegacyDashboardSchema;
use Tests\TestCase;

class LegacyDashboardBaselineSchemaTest extends TestCase
{
    public function test_committed_baseline_contains_only_the_approved_sanitized_table_definitions(): void
    {
        $path = database_path('schema/legacy-dashboard-baseline.sql');
        $contents = file_get_contents($path);
        $statements = LegacyDashboardSchema::statements($path);

        $this->assertIsString($contents);
        $this->assertCount(50, $statements);
        $this->assertCount(50, array_unique(array_column($statements, 'table')));
        $this->assertSame(491, preg_match_all('/^  `[a-zA-Z0-9_]+` /m', $contents));
        $this->assertSame(142, preg_match_all('/^  (?:PRIMARY KEY|UNIQUE KEY|KEY )/m', $contents));
        $this->assertContains('urt_channel', array_column($statements, 'table'));
        $this->assertContains('urt_video', array_column($statements, 'table'));
        $this->assertContains('urt_comment_queue', array_column($statements, 'table'));
        $this->assertContains('urt_show_tag_date', array_column($statements, 'table'));
        $this->assertContains('urt_ai_date', array_column($statements, 'table'));
        $this->assertNotContains('urt_mayor_person_ai', array_column($statements, 'table'));
        $this->assertDoesNotMatchRegularExpression('/\bDROP\b/i', $contents);
        $this->assertDoesNotMatchRegularExpression('/\b(?:DATA|INDEX)\s+DIRECTORY\b/i', $contents);
        $this->assertDoesNotMatchRegularExpression('/\bAUTO_INCREMENT\s*=\s*\d+/i', $contents);
    }
}
