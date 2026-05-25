<?php

namespace Tests\Feature\Reports;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class GroupDirectoryRouteTest extends TestCase
{
    public function test_group_index_reads_tag_group_membership(): void
    {
        $this->createTable();

        DB::table('tag_group')->insert([
            ['ctime' => '2026-05-01 00:00:00', 'latest_time' => '2026-05-20 00:00:00', 'tag' => '柯文哲', 'group_name' => '政治人物', 'del_flag' => null],
            ['ctime' => '2026-05-01 00:00:00', 'latest_time' => '2026-05-21 00:00:00', 'tag' => '賴清德', 'group_name' => '政治人物', 'del_flag' => null],
            ['ctime' => '2026-05-01 00:00:00', 'latest_time' => '2026-05-22 00:00:00', 'tag' => '周杰倫', 'group_name' => '藝人', 'del_flag' => null],
        ]);

        $response = $this->get('/groups');

        $response->assertOk();
        $response->assertSee('Group directory');
        $response->assertSee('政治人物');
        $response->assertSee('藝人');
        $response->assertSee('tag_group 3');
        $response->assertSee('read-only membership');
    }

    public function test_group_detail_reads_database_or_legacy_configured_membership(): void
    {
        $this->createTable();

        DB::table('tag_group')->insert([
            ['ctime' => '2026-05-01 00:00:00', 'latest_time' => '2026-05-20 00:00:00', 'tag' => '柯文哲', 'group_name' => '政治人物', 'del_flag' => null],
            ['ctime' => '2026-05-01 00:00:00', 'latest_time' => '2026-05-21 00:00:00', 'tag' => '賴清德', 'group_name' => '政治人物', 'del_flag' => null],
            ['ctime' => '2026-05-01 00:00:00', 'latest_time' => '2026-05-22 00:00:00', 'tag' => '刪除項', 'group_name' => '政治人物', 'del_flag' => '1'],
        ]);

        $this->get('/groups/%E6%94%BF%E6%B2%BB%E4%BA%BA%E7%89%A9')
            ->assertOk()
            ->assertSee('政治人物')
            ->assertSee('柯文哲')
            ->assertSee('賴清德')
            ->assertDontSee('刪除項')
            ->assertSee('tags 2');

        $this->get('/groups/tags_straits')
            ->assertOk()
            ->assertSee('兩岸')
            ->assertSee('台海')
            ->assertSee('legacy group file');
    }

    public function test_legacy_group_urls_redirect_to_group_directory_surfaces(): void
    {
        $this->get('/group_view.php?group=政治人物&view=position&days=30')
            ->assertStatus(308)
            ->assertRedirect(route('groups.show', [
                'groupName' => '政治人物',
                'view' => 'position',
                'days' => '30',
            ]));

        $this->get('/group_tag.php?group=politic&days=7')
            ->assertStatus(308)
            ->assertRedirect(route('groups.show', [
                'groupName' => 'politic',
                'days' => '7',
            ]));

        $this->get('/group_two.php')
            ->assertStatus(308)
            ->assertRedirect(route('groups.show', [
                'groupName' => 'tags_straits',
            ]));

    }

    private function createTable(): void
    {
        Schema::dropIfExists('tag_group');

        Schema::create('tag_group', function ($table): void {
            $table->integer('pk')->nullable();
            $table->dateTime('ctime');
            $table->dateTime('mtime')->nullable();
            $table->dateTime('latest_time');
            $table->string('tag');
            $table->string('group_name');
            $table->string('del_flag')->nullable();
        });
    }
}
