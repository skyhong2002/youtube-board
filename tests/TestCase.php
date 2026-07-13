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

        Schema::create('ingestion_runs', function (Blueprint $table): void {
            $table->string('id', 52)->primary();
            $table->dateTime('recorded_at');
            $table->string('request_source', 32)->nullable();
            $table->string('request_mode', 16)->nullable();
            $table->string('result_mode', 16)->nullable();
            $table->longText('payload_json');
            $table->timestamps();
            $table->index('recorded_at', 'ingestion_runs_recorded_at_index');
            $table->index(
                ['request_source', 'request_mode', 'result_mode', 'recorded_at'],
                'ingestion_runs_scheduler_index',
            );
        });

        Schema::create('ingestion_run_jobs', function (Blueprint $table): void {
            $table->string('run_id', 52);
            $table->string('job_key', 120);
            $table->dateTime('recorded_at');
            $table->boolean('attempted')->default(true);
            $table->boolean('succeeded')->default(false);
            $table->boolean('failed')->default(false);
            $table->string('action', 120)->nullable();
            $table->integer('exit_code')->nullable();
            $table->string('started_at', 64)->nullable();
            $table->string('finished_at', 64)->nullable();
            $table->timestamps();
            $table->primary(['run_id', 'job_key'], 'ingestion_run_jobs_primary');
            $table->index(
                ['job_key', 'attempted', 'recorded_at'],
                'ingestion_run_jobs_attempt_index',
            );
            $table->index(
                ['job_key', 'succeeded', 'recorded_at'],
                'ingestion_run_jobs_success_index',
            );
            $table->foreign('run_id', 'ingestion_run_jobs_run_foreign')
                ->references('id')
                ->on('ingestion_runs')
                ->cascadeOnDelete();
        });
    }
}
