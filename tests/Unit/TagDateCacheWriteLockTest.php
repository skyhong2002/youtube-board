<?php

namespace Tests\Unit;

use App\Services\Ingestion\TagDateCacheWriteLock;
use Illuminate\Database\Connection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Mockery;
use Tests\TestCase;

class TagDateCacheWriteLockTest extends TestCase
{
    public function test_unconfirmed_mysql_release_is_logged_without_exposing_secrets(): void
    {
        $connection = Mockery::mock(Connection::class);
        $connection->shouldReceive('getDriverName')->once()->andReturn('mysql');
        $connection->shouldReceive('selectOne')
            ->once()
            ->with('SELECT GET_LOCK(?, 0) AS lock_acquired', Mockery::type('array'), false)
            ->andReturn((object) ['lock_acquired' => 1]);
        $connection->shouldReceive('selectOne')
            ->once()
            ->with('SELECT RELEASE_LOCK(?) AS lock_released', Mockery::type('array'), false)
            ->andReturn((object) ['lock_released' => null]);
        DB::shouldReceive('connection')->once()->andReturn($connection);
        Log::shouldReceive('warning')
            ->once()
            ->with('Tag date cache write lock unavailable.', Mockery::on(
                fn (array $context): bool => $context['status'] === 'mysql_release_unconfirmed'
                    && $context['exception_class'] === null
                    && $context['secrets'] === 'not_printed'
                    && preg_match('/^ytb:tag-date:[a-f0-9]{51}$/', $context['lock_name']) === 1,
            ));

        $handle = app(TagDateCacheWriteLock::class)->acquire([102], [], [], '2026-07-15');

        $this->assertNotNull($handle);
        $handle->release();
    }
}
