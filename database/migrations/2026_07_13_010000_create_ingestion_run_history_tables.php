<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('ingestion_runs')) {
            Schema::create('ingestion_runs', function (Blueprint $table): void {
                $table->engine = 'InnoDB';
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
        }

        if (! Schema::hasTable('ingestion_run_jobs')) {
            Schema::create('ingestion_run_jobs', function (Blueprint $table): void {
                $table->engine = 'InnoDB';
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

    public function down(): void
    {
        // Durable operational history must survive application rollbacks.
    }
};
