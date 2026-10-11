<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('ingestion_youtube_quota_daily')
            || Schema::hasColumn('ingestion_youtube_quota_daily', 'google_exhausted_at')) {
            return;
        }

        Schema::table('ingestion_youtube_quota_daily', function (Blueprint $table): void {
            $table->dateTime('google_exhausted_at')->nullable()->after('reserved_units');
            $table->unsignedInteger('google_exhausted_units')->nullable()->after('google_exhausted_at');
        });
    }

    public function down(): void
    {
        if (! Schema::hasColumn('ingestion_youtube_quota_daily', 'google_exhausted_at')) {
            return;
        }

        Schema::table('ingestion_youtube_quota_daily', function (Blueprint $table): void {
            $table->dropColumn(['google_exhausted_at', 'google_exhausted_units']);
        });
    }
};
