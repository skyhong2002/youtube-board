<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('urt_show_group')) {
            return;
        }

        Schema::create('urt_show_group', function (Blueprint $table): void {
            $table->bigIncrements('pk');
            $table->dateTime('ctime');
            $table->dateTime('stime')->nullable();
            $table->dateTime('mtime')->nullable();
            $table->string('the_group', 128);
            $table->string('the_view', 64);
            $table->longText('the_result')->nullable();

            $table->index(['the_group', 'the_view'], 'show_group_lookup_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('urt_show_group');
    }
};
