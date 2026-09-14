<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * urt_video is a legacy MyISAM table managed outside these migrations. Report
 * pages run MAX(ctime) on it for every request, and without this index that is
 * a full scan of ~550k rows. Guarded so it is a no-op wherever the table or the
 * index already exists (production had the index added by hand on 2026-09-14).
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('urt_video') || Schema::hasIndex('urt_video', 'ctime')) {
            return;
        }

        Schema::table('urt_video', function (Blueprint $table): void {
            $table->index('ctime', 'ctime');
        });
    }

    public function down(): void
    {
        if (! Schema::hasTable('urt_video') || ! Schema::hasIndex('urt_video', 'ctime')) {
            return;
        }

        Schema::table('urt_video', function (Blueprint $table): void {
            $table->dropIndex('ctime');
        });
    }
};
