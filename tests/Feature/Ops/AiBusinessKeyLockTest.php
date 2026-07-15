<?php

namespace Tests\Feature\Ops;

use App\Services\Ingestion\AiBusinessKeyLock;
use Illuminate\Database\Connection;
use Illuminate\Support\Facades\DB;
use Mockery;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

class AiBusinessKeyLockTest extends TestCase
{
    public function test_lock_name_is_bounded_deterministic_and_contains_no_business_values(): void
    {
        $locks = app(AiBusinessKeyLock::class);
        $identity = [
            'aipk' => 123,
            'event_name' => 'private-event-title',
            'prompt_type' => 'summary',
            'user_token' => 'private-user-token',
        ];

        $name = $locks->name('urt_ai_event', $identity);
        $reverseOrderName = $locks->name('urt_ai_event', array_reverse($identity, true));

        $this->assertSame($name, $reverseOrderName);
        $this->assertLessThanOrEqual(64, strlen($name));
        $this->assertMatchesRegularExpression('/^ytb:ai:[a-f0-9]{56}$/', $name);
        $this->assertStringNotContainsString('private-event-title', $name);
        $this->assertStringNotContainsString('private-user-token', $name);
        $this->assertSame($name, $locks->name('urt_ai_event', [
            ...$identity,
            'user_token' => 'PRIVATE-USER-TOKEN',
        ]));
        $this->assertNotSame($name, $locks->name('urt_ai_event', $identity + ['other' => 1]));
        $this->assertNotSame($name, $locks->name('urt_ai_period', $identity));
    }

    public function test_sqlite_fallback_serializes_only_the_same_business_key_and_releases_it(): void
    {
        $locks = app(AiBusinessKeyLock::class);
        $identity = [
            'u_id' => 77,
            'date_from' => '2026-05-24 00:00:00',
            'date_to' => '2026-05-24 23:59:59',
            'data_type' => 'oneday',
            'user_token' => 'CLI',
        ];

        $first = $locks->acquire('urt_channel_ai', $identity);
        $caseEquivalentIdentity = array_reverse([
            ...$identity,
            'user_token' => 'cli',
        ], true);
        $sameKey = $locks->acquire('urt_channel_ai', $caseEquivalentIdentity);
        $differentKey = $locks->acquire('urt_channel_ai', [...$identity, 'u_id' => 78]);

        $this->assertNotNull($first);
        $this->assertNull($sameKey);
        $this->assertNotNull($differentKey);

        $differentKey->release();
        $first->release();
        $first->release();

        $reacquired = $locks->acquire('urt_channel_ai', $identity);
        $this->assertNotNull($reacquired);
        $reacquired->release();
    }

    #[DataProvider('advisoryLockDrivers')]
    public function test_mysql_and_mariadb_use_connection_scoped_advisory_lock_and_release(string $driver): void
    {
        $connection = Mockery::mock(Connection::class);
        $connection->shouldReceive('getDriverName')->once()->andReturn($driver);
        $connection->shouldReceive('selectOne')
            ->once()
            ->with(
                'SELECT GET_LOCK(?, ?) AS lock_acquired',
                Mockery::on(fn (array $bindings): bool => count($bindings) === 2
                    && preg_match('/^ytb:ai:[a-f0-9]{56}$/', $bindings[0]) === 1
                    && $bindings[1] === 0),
                false,
            )
            ->andReturn((object) ['lock_acquired' => 1]);
        $connection->shouldReceive('selectOne')
            ->once()
            ->with(
                'SELECT RELEASE_LOCK(?) AS lock_released',
                Mockery::on(fn (array $bindings): bool => count($bindings) === 1
                    && preg_match('/^ytb:ai:[a-f0-9]{56}$/', $bindings[0]) === 1),
                false,
            )
            ->andReturn((object) ['lock_released' => 1]);
        DB::shouldReceive('connection')->once()->andReturn($connection);

        $lock = app(AiBusinessKeyLock::class)->acquire('urt_ai_date', [
            'date_from' => '2026-05-24 00:00:00',
            'date_to' => '2026-05-24 23:59:59',
            'condition_type' => 'all',
        ]);

        $this->assertNotNull($lock);
        $lock->release();
    }

    /**
     * @return array<string, array{string}>
     */
    public static function advisoryLockDrivers(): array
    {
        return [
            'mysql' => ['mysql'],
            'mariadb' => ['mariadb'],
        ];
    }
}
