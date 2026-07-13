<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('ingestion_youtube_quota_daily')) {
            return;
        }

        Schema::create('ingestion_youtube_quota_daily', function (Blueprint $table): void {
            $table->engine = 'InnoDB';
            $table->id();
            $table->string('provider', 64);
            $table->date('quota_date');
            $table->unsignedBigInteger('consumed_units')->default(0);
            $table->unsignedBigInteger('reserved_units')->default(0);
            $table->timestamps();
            $table->unique(['provider', 'quota_date'], 'ingestion_youtube_quota_daily_unique');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('ingestion_youtube_quota_daily');
    }
};
