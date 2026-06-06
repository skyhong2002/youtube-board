<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('urt_mayor_person_ai', function (Blueprint $table): void {
            $table->bigIncrements('pk');
            $table->dateTime('ctime');
            $table->dateTime('mtime')->nullable();
            $table->string('city_key', 64);
            $table->string('city_label', 64);
            $table->string('person', 128);
            $table->date('the_date');
            $table->string('ai_type', 128)->nullable();
            $table->string('provider', 32)->nullable();
            $table->string('user_token', 64)->default('CLI');
            $table->longText('prompt_json')->nullable();
            $table->longText('source_json')->nullable();
            $table->longText('result_json');
            $table->unsignedTinyInteger('del_flag')->nullable();

            $table->index(['city_key', 'person', 'the_date'], 'mayor_person_ai_lookup_idx');
            $table->index(['the_date', 'city_key'], 'mayor_person_ai_date_city_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('urt_mayor_person_ai');
    }
};
