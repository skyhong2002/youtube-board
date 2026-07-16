<?php

namespace Tests\Feature\Ops;

use App\Services\Ingestion\TagDateCacheWriteLock;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class TagDateCacheWriteLockMariaDbTest extends TestCase
{
    public function test_two_mariadb_connections_serialize_the_same_tag_date_row(): void
    {
        if (getenv('TAG_DATE_LOCK_MARIADB_E2E') !== '1') {
            $this->markTestSkipped('Set TAG_DATE_LOCK_MARIADB_E2E=1 inside the local Compose app container.');
        }

        $defaultConnection = (string) config('database.default');
        $this->configureConnection('tag_date_lock_e2e_one');
        $this->configureConnection('tag_date_lock_e2e_two');
        $connectionOne = DB::connection('tag_date_lock_e2e_one');
        $connectionTwo = DB::connection('tag_date_lock_e2e_two');
        $connectionOneId = (int) data_get($connectionOne->selectOne('SELECT CONNECTION_ID() AS connection_id'), 'connection_id');
        $connectionTwoId = (int) data_get($connectionTwo->selectOne('SELECT CONNECTION_ID() AS connection_id'), 'connection_id');
        $this->assertNotSame($connectionOneId, $connectionTwoId);

        $locks = app(TagDateCacheWriteLock::class);
        $name = $locks->name([102, 1, 102], [4, 3], [9], '2026-07-15');
        $this->assertSame($name, $locks->name([1, 102], [3, 4], [9], '2026-07-15'));
        $this->assertLessThanOrEqual(64, strlen($name));
        $this->assertMatchesRegularExpression('/^ytb:tag-date:[a-f0-9]{51}$/', $name);

        $first = null;
        $different = null;
        $afterRelease = null;

        try {
            config()->set('database.default', 'tag_date_lock_e2e_one');
            $first = $locks->acquire([102, 1], [4, 3], [9], '2026-07-15');
            $this->assertNotNull($first);

            config()->set('database.default', 'tag_date_lock_e2e_two');
            $sameRow = $locks->acquire([1, 102], [3, 4], [9], '2026-07-15');
            $this->assertNull($sameRow);

            $different = $locks->acquire([1, 102], [3, 4], [9], '2026-07-14');
            $this->assertNotNull($different);

            $first->release();
            $first = null;
            $afterRelease = $locks->acquire([1, 102], [3, 4], [9], '2026-07-15');
            $this->assertNotNull($afterRelease);
        } finally {
            $afterRelease?->release();
            $different?->release();
            $first?->release();
            config()->set('database.default', $defaultConnection);
            DB::disconnect('tag_date_lock_e2e_one');
            DB::disconnect('tag_date_lock_e2e_two');
        }
    }

    private function configureConnection(string $name): void
    {
        config()->set('database.connections.'.$name, [
            'driver' => 'mysql',
            'host' => getenv('TAG_DATE_LOCK_MARIADB_HOST') ?: 'mysql',
            'port' => getenv('TAG_DATE_LOCK_MARIADB_PORT') ?: '3306',
            'database' => getenv('TAG_DATE_LOCK_MARIADB_DATABASE') ?: 'youtube_board',
            'username' => getenv('TAG_DATE_LOCK_MARIADB_USERNAME') ?: 'youtube_board',
            'password' => getenv('TAG_DATE_LOCK_MARIADB_PASSWORD') ?: 'youtube_board',
            'charset' => 'utf8mb4',
            'collation' => 'utf8mb4_unicode_ci',
            'prefix' => '',
            'prefix_indexes' => true,
            'strict' => true,
            'engine' => null,
        ]);
        DB::purge($name);
    }
}
