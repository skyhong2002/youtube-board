<?php

namespace Tests\Feature\Ops;

use App\Services\Ingestion\AiBusinessKeyLock;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class AiBusinessKeyLockMariaDbTest extends TestCase
{
    public function test_two_mariadb_connections_serialize_the_same_key_but_not_different_keys(): void
    {
        if (getenv('AI_LOCK_MARIADB_E2E') !== '1') {
            $this->markTestSkipped('Set AI_LOCK_MARIADB_E2E=1 inside the local Compose app container.');
        }

        $this->configureConnection('ai_lock_e2e_one');
        $this->configureConnection('ai_lock_e2e_two');
        $connectionOne = DB::connection('ai_lock_e2e_one');
        $connectionTwo = DB::connection('ai_lock_e2e_two');
        $connectionOneId = (int) data_get($connectionOne->selectOne('SELECT CONNECTION_ID() AS connection_id'), 'connection_id');
        $connectionTwoId = (int) data_get($connectionTwo->selectOne('SELECT CONNECTION_ID() AS connection_id'), 'connection_id');
        $this->assertNotSame($connectionOneId, $connectionTwoId);

        $locks = app(AiBusinessKeyLock::class);
        $identity = [
            'date_from' => '2026-05-24 00:00:00',
            'date_to' => '2026-05-24 23:59:59',
            'condition_type' => 'all',
            'user_token' => 'identity-must-not-leak',
        ];
        $name = $locks->name('urt_ai_date', $identity);
        $this->assertLessThanOrEqual(64, strlen($name));
        $this->assertStringNotContainsString('identity-must-not-leak', $name);

        $first = null;
        $different = null;
        $afterRelease = null;

        try {
            config()->set('database.default', 'ai_lock_e2e_one');
            $first = $locks->acquire('urt_ai_date', $identity);
            $this->assertNotNull($first);

            config()->set('database.default', 'ai_lock_e2e_two');
            $sameKey = $locks->acquire('urt_ai_date', $identity);
            $this->assertNull($sameKey);

            $different = $locks->acquire('urt_ai_date', [...$identity, 'condition_type' => 'green']);
            $this->assertNotNull($different);

            $first->release();
            $first = null;
            $afterRelease = $locks->acquire('urt_ai_date', $identity);
            $this->assertNotNull($afterRelease);
        } finally {
            $afterRelease?->release();
            $different?->release();
            $first?->release();
            DB::disconnect('ai_lock_e2e_one');
            DB::disconnect('ai_lock_e2e_two');
        }
    }

    private function configureConnection(string $name): void
    {
        config()->set('database.connections.'.$name, [
            'driver' => 'mysql',
            'host' => getenv('AI_LOCK_MARIADB_HOST') ?: 'mysql',
            'port' => getenv('AI_LOCK_MARIADB_PORT') ?: '3306',
            'database' => getenv('AI_LOCK_MARIADB_DATABASE') ?: 'youtube_board',
            'username' => getenv('AI_LOCK_MARIADB_USERNAME') ?: 'youtube_board',
            'password' => getenv('AI_LOCK_MARIADB_PASSWORD') ?: 'youtube_board',
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
