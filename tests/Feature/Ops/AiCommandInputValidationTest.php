<?php

namespace Tests\Feature\Ops;

use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class AiCommandInputValidationTest extends TestCase
{
    public function test_daily_and_source_first_pipelines_reject_explicit_invalid_inputs_before_side_effects(): void
    {
        Http::fake();

        $this->assertRejected('ai:daily', ['--date' => '2026-02-31'], '--date must be');
        $this->assertRejected('ai:daily', ['--date' => ''], '--date must be');
        $this->assertRejected('ai:daily', ['--condition' => 'not-a-condition'], '--condition must be one of');
        $this->assertRejected('ai:daily', ['--type' => 'monthly'], '--type must be one of');
        $this->assertRejected('ai:daily:pipeline', ['--date' => '2026-13-01'], '--date must be');
        $this->assertRejected('ai:hourly', ['--condition' => 'not-a-condition'], '--condition must be one of');
        $this->assertRejected('ai:hourly:pipeline', ['--condition' => 'not-a-condition'], '--condition must be one of');
    }

    public function test_mayor_person_rejects_unknown_city_and_invalid_date_before_schema_or_provider_work(): void
    {
        Http::fake();

        $this->assertRejected('ai:mayor-person', ['--city' => 'unknown_city'], '--city must be one of');
        $this->assertRejected('ai:mayor-person', ['--city' => 'taipei', '--date' => '2026-02-30'], '--date must be');
        $this->assertRejected('ai:mayor-person', ['--city' => 'taipei', '--date' => ''], '--date must be');
    }

    public function test_days_event_and_period_commands_reject_invalid_dates_conditions_and_prompt_types(): void
    {
        Http::fake();

        $this->assertRejected('ai:event', ['--date' => '2026-02-31'], '--date must be');
        $this->assertRejected('ai:event', ['--condition' => 'bad value'], '--condition contains unsupported characters');
        $this->assertRejected('ai:event', ['--condition' => 'custom'], '--condition must be one of');
        $this->assertRejected('ai:event', ['--prompt-types' => 'summary,unsupported'], '--prompt-types contains unsupported values');
        $this->assertRejected('ai:event', ['--prompt-types' => ''], '--prompt-types must contain at least one supported type');
        $this->assertRejected('ai:period', ['--from' => '2026-02-31'], '--from must be');
        $this->assertRejected('ai:period', ['--from' => '2026-05-24', '--to' => '2026-05-23'], '--from must not be after --to');
        $this->assertRejected('ai:period', ['--condition' => 'bad value'], '--condition contains unsupported characters');
        $this->assertRejected('ai:period', ['--condition' => 'custom'], '--condition must be one of');
        $this->assertRejected('ai:days:refresh', ['--to' => '2026-13-01'], '--to must be');
        $this->assertRejected('ai:days:refresh', ['--from' => '2026-05-24', '--to' => '2026-05-23'], '--from must not be after --to');
        $this->assertRejected('ai:days:refresh', ['--condition' => 'bad value'], '--condition contains unsupported characters');
        $this->assertRejected('ai:days:refresh', ['--condition' => 'custom'], '--condition must be one of');
        $this->assertRejected('ai:days:refresh', ['--prompt-types' => 'summary,unsupported'], '--prompt-types contains unsupported values');
    }

    public function test_explicit_ai_record_selectors_reject_values_that_would_otherwise_expand_scope(): void
    {
        Http::fake();

        $this->assertRejected('ai:channel', [
            'u_id' => 'not-an-id',
            '--from' => '2026-05-24',
        ], 'u_id must be a positive integer');
        $this->assertRejected('ai:channel', [
            'u_id' => '0',
            '--from' => '2026-05-24',
        ], 'u_id must be a positive integer');
        $this->assertRejected('ai:event', ['--aipk' => 'not-an-id'], '--aipk must be a positive integer');
        $this->assertRejected('ai:event', ['--aipk' => '0'], '--aipk must be a positive integer');
        $this->assertRejected('ai:event', ['--event' => ''], '--event must not be empty');
        $this->assertRejected('ai:mayor-person', ['--person' => ''], '--person must not be empty');
        $this->assertRejected('ai:mayor-person', ['--person' => ', ,'], '--person must contain only non-empty values');
    }

    public function test_hourly_commands_require_strict_real_timestamps_before_source_or_ai_work(): void
    {
        Http::fake();

        foreach (['ai:hourly', 'ai:hourly:pipeline'] as $command) {
            $this->assertRejected($command, ['--at' => '2026-02-31 10:10:00'], '--at must be a valid timestamp in Y-m-d H:i:s');
            $this->assertRejected($command, ['--at' => '2026-05-24T10:10:00+08:00'], '--at must be a valid timestamp in Y-m-d H:i:s');
            $this->assertRejected($command, ['--at' => ''], '--at must not be empty');
        }
    }

    public function test_ai_numeric_options_reject_non_integer_values_before_side_effects(): void
    {
        Http::fake();

        $cases = [
            ['ai:channel', ['u_id' => 77, '--from' => '2026-05-24'], ['--limit']],
            ['ai:daily', [], ['--limit', '--channel-limit', '--channel-offset', '--channel-batch-size', '--ai-call-limit', '--channel-video-limit']],
            ['ai:daily:pipeline', [], ['--limit', '--channel-limit', '--channel-batch-size', '--ai-call-limit', '--channel-video-limit']],
            ['ai:mayor-person', [], ['--limit', '--ai-call-limit']],
            ['ai:period', [], ['--limit', '--ai-call-limit']],
            ['ai:event', [], ['--limit', '--ai-call-limit']],
            ['ai:days:refresh', [], [
                '--daily-limit',
                '--daily-channel-limit',
                '--daily-channel-offset',
                '--daily-channel-batch-size',
                '--daily-ai-call-limit',
                '--daily-channel-video-limit',
                '--event-limit',
                '--event-ai-call-limit',
                '--event-passes',
                '--period-limit',
                '--period-ai-call-limit',
            ]],
            ['ai:hourly', [], ['--hour', '--period', '--limit', '--prompt-video-limit']],
            ['ai:hourly:pipeline', [], ['--hour', '--period', '--limit', '--prompt-video-limit', '--source-max-results']],
        ];

        foreach ($cases as [$command, $arguments, $options]) {
            foreach ($options as $option) {
                $this->assertRejected($command, $arguments + [$option => 'not-an-integer'], $option.' must be');
            }
        }
    }

    /**
     * @param  array<string, mixed>  $options
     */
    private function assertRejected(string $command, array $options, string $expectedMessage): void
    {
        DB::flushQueryLog();
        DB::enableQueryLog();

        $exitCode = Artisan::call($command, $options + [
            '--execute' => true,
            '--json' => true,
        ]);
        $queries = DB::getQueryLog();
        DB::disableQueryLog();

        $this->assertSame(1, $exitCode, $command.' should reject invalid explicit input');
        $this->assertStringContainsString($expectedMessage, Artisan::output());
        $this->assertSame([], collect($queries)
            ->pluck('query')
            ->filter(fn (string $sql): bool => preg_match('/^\s*(insert|update|delete|replace|create|alter|drop|truncate)\b/i', $sql) === 1)
            ->values()
            ->all());
        Http::assertNothingSent();
    }
}
