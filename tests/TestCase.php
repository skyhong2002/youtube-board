<?php

namespace Tests;

use Illuminate\Database\Schema\Blueprint;
use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
use Illuminate\Support\Facades\Schema;

abstract class TestCase extends BaseTestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        config()->set('cache.default', 'array');
        config()->set('database.default', 'sqlite');
        config()->set('database.connections.sqlite.database', ':memory:');
        config()->set('queue.default', 'sync');
        config()->set('session.driver', 'array');

        Schema::create('ingestion_youtube_quota_daily', function (Blueprint $table): void {
            $table->id();
            $table->string('provider', 64);
            $table->date('quota_date');
            $table->unsignedBigInteger('consumed_units')->default(0);
            $table->unsignedBigInteger('reserved_units')->default(0);
            $table->timestamps();
            $table->unique(['provider', 'quota_date']);
        });
    }
}
