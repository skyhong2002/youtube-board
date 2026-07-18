<?php

namespace Tests\Feature\Reports;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class GroupViewCacheBuilderTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-24 12:00:00', 'Asia/Taipei'));
    }

    protected function tearDown(): void
    {
        CarbonImmutable::setTestNow();
        parent::tearDown();
    }

    public function test_preview_reports_would_insert_without_writing_cache(): void
    {
        $this->createTables();
        $this->seedSources();

        $exitCode = Artisan::call('reports:group-view:build', [
            '--group' => '政治人物',
            '--view' => 'politician',
            '--days' => 7,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true, 512, JSON_THROW_ON_ERROR);

        $this->assertSame(0, $exitCode);
        $this->assertSame('preview', $payload['mode']);
        $this->assertSame('success', $payload['status']);
        $this->assertSame('would_insert', $payload['action']);
        $this->assertSame(2, $payload['tag_count']);
        $this->assertSame(4, $payload['group_count']);
        $this->assertGreaterThan(0, $payload['source_rows']);
        $this->assertSame(0, DB::table('urt_show_group')->count());
    }

    public function test_execute_writes_legacy_payload_and_is_idempotent(): void
    {
        $this->createTables();
        $this->seedSources();

        $exitCode = Artisan::call('reports:group-view:build', [
            '--group' => '政治人物',
            '--view' => 'politician',
            '--days' => 7,
            '--execute' => true,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true, 512, JSON_THROW_ON_ERROR);

        $this->assertSame(0, $exitCode);
        $this->assertSame('inserted', $payload['action']);
        $row = DB::table('urt_show_group')->first();
        $this->assertSame('政治人物', $row->the_group);
        $this->assertSame('politician', $row->the_view);
        $result = json_decode((string) $row->the_result, true)['result'];
        $this->assertSame(['賴清德', '柯文哲'], $result['tag_array']);
        $this->assertSame('新聞', $result['group_array'][0]['name']);
        $this->assertSame(7000, $result['group_data'][0]['total_views']);
        $this->assertSame(3, $result['group_data'][0]['count_videos']);
        $this->assertSame(7000, $result['group_data'][0]['2026-05-24']['total_views']);
        $this->assertSame(5000, $result['data_array'][0][0]['2026-05-24']['tags_views']);
        $this->assertSame(2, $result['data_array'][0][0]['2026-05-24']['tags_video']);
        $this->assertArrayNotHasKey(1, $result['data_array'][0][0] ?? []);

        $repeat = Artisan::call('reports:group-view:build', [
            '--group' => '政治人物',
            '--view' => 'politician',
            '--days' => 7,
            '--execute' => true,
            '--json' => true,
        ]);
        $repeatPayload = json_decode(trim(Artisan::output()), true, 512, JSON_THROW_ON_ERROR);

        $this->assertSame(0, $repeat);
        $this->assertSame('unchanged', $repeatPayload['action']);
        $this->assertSame(1, DB::table('urt_show_group')->count());
    }

    public function test_group_view_api_serves_derived_payload_then_built_cache(): void
    {
        $this->createTables();
        $this->seedSources();

        $derived = $this->getJson('/api/group_view.php?group=政治人物&view=politician&days=7');
        $derived->assertOk();
        $derived->assertJsonPath('meta.cache_available', false);
        $derived->assertJsonPath('meta.cache_builder', 'reports:group-view:build');
        $derived->assertJsonPath('meta.source', 'urt_show_tag_date derived real-time YouTube dashboard');
        $this->assertSame(['賴清德', '柯文哲'], $derived->json('result.tag_array'));
        $this->assertSame(7000, $derived->json('result.group_data.0.total_views'));

        Artisan::call('reports:group-view:build', [
            '--group' => '政治人物',
            '--view' => 'politician',
            '--days' => 7,
            '--execute' => true,
            '--json' => true,
        ]);

        $cached = $this->getJson('/api/group_view.php?group=政治人物&view=politician');
        $cached->assertOk();
        $cached->assertJsonPath('meta.source', 'urt_show_group.the_result');
        $cached->assertJsonPath('meta.cache_available', true);
        $this->assertSame(7000, $cached->json('result.group_data.0.total_views'));
    }

    public function test_unknown_view_and_missing_cache_table_are_blocked(): void
    {
        $this->createTables();
        $this->seedSources();

        $viewExit = Artisan::call('reports:group-view:build', [
            '--group' => '政治人物',
            '--view' => 'not-a-view',
            '--json' => true,
        ]);
        $viewPayload = json_decode(trim(Artisan::output()), true, 512, JSON_THROW_ON_ERROR);

        Schema::drop('urt_show_group');
        $tableExit = Artisan::call('reports:group-view:build', [
            '--group' => '政治人物',
            '--view' => 'politician',
            '--json' => true,
        ]);
        $tablePayload = json_decode(trim(Artisan::output()), true, 512, JSON_THROW_ON_ERROR);

        $this->assertSame(1, $viewExit);
        $this->assertSame('unknown_view', $viewPayload['blocked_reason']);
        $this->assertSame(1, $tableExit);
        $this->assertSame('missing_urt_show_group_table', $tablePayload['blocked_reason']);
    }

    public function test_missing_tag_date_source_blocks_without_replacing_cache(): void
    {
        $this->createTables();
        DB::table('tag_group')->insert([
            ['group_name' => '政治人物', 'tag' => '賴清德', 'latest_time' => '2026-05-21 00:00:00', 'del_flag' => 0],
        ]);
        DB::table('urt_show_group')->insert([
            'ctime' => '2026-05-20 00:00:00',
            'mtime' => '2026-05-20 00:00:00',
            'the_group' => '政治人物',
            'the_view' => 'politician',
            'the_result' => json_encode(['result' => ['tag_array' => ['既有']]], JSON_UNESCAPED_UNICODE),
        ]);

        $exitCode = Artisan::call('reports:group-view:build', [
            '--group' => '政治人物',
            '--view' => 'politician',
            '--execute' => true,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true, 512, JSON_THROW_ON_ERROR);

        $this->assertSame(1, $exitCode);
        $this->assertSame('missing_tag_date_source', $payload['blocked_reason']);
        $this->assertStringContainsString('既有', (string) DB::table('urt_show_group')->value('the_result'));
    }

    public function test_explicit_tags_override_and_tag_cap_block(): void
    {
        $this->createTables();
        $this->seedSources();

        $exitCode = Artisan::call('reports:group-view:build', [
            '--group' => '政治人物',
            '--view' => 'politician',
            '--days' => 7,
            '--tags' => '柯文哲',
            '--execute' => true,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true, 512, JSON_THROW_ON_ERROR);

        $this->assertSame(0, $exitCode);
        $this->assertSame(1, $payload['tag_count']);
        $result = json_decode((string) DB::table('urt_show_group')->value('the_result'), true)['result'];
        $this->assertSame(['柯文哲'], $result['tag_array']);

        $capExit = Artisan::call('reports:group-view:build', [
            '--group' => '政治人物',
            '--view' => 'politician',
            '--tags' => '柯文哲,賴清德',
            '--tag-limit' => 1,
            '--json' => true,
        ]);
        $capPayload = json_decode(trim(Artisan::output()), true, 512, JSON_THROW_ON_ERROR);

        $this->assertSame(1, $capExit);
        $this->assertSame('tag_list_limit_exceeded', $capPayload['blocked_reason']);
    }

    private function seedSources(): void
    {
        DB::table('tag_group')->insert([
            ['group_name' => '政治人物', 'tag' => '賴清德', 'latest_time' => '2026-05-22 00:00:00', 'del_flag' => 0],
            ['group_name' => '政治人物', 'tag' => '柯文哲', 'latest_time' => '2026-05-21 00:00:00', 'del_flag' => 0],
            ['group_name' => '政治人物', 'tag' => '已刪除', 'latest_time' => '2026-05-23 00:00:00', 'del_flag' => 1],
        ]);

        DB::table('urt_show_tag_date')->insert([
            [
                'pk' => 1,
                'ctime' => '2026-05-24 03:00:00',
                'mtime' => '2026-05-24 03:00:00',
                'tagid' => '13',
                'tag_or' => '',
                'tag_not' => '',
                'the_date' => '2026-05-24',
                'total_views' => 7000,
                'count_videos' => 3,
                'tags_views' => json_encode(['賴清德' => 5000, '其他' => 100], JSON_UNESCAPED_UNICODE),
                'tags_video' => json_encode(['賴清德' => 2], JSON_UNESCAPED_UNICODE),
            ],
            [
                'pk' => 2,
                'ctime' => '2026-05-23 03:00:00',
                'mtime' => '2026-05-23 03:00:00',
                'tagid' => '13',
                'tag_or' => '',
                'tag_not' => '',
                'the_date' => '2026-05-23',
                'total_views' => 0,
                'count_videos' => 0,
                'tags_views' => json_encode([], JSON_UNESCAPED_UNICODE),
                'tags_video' => json_encode([], JSON_UNESCAPED_UNICODE),
            ],
        ]);
    }

    private function createTables(): void
    {
        Schema::create('tag_group', function ($table): void {
            $table->string('group_name');
            $table->string('tag');
            $table->dateTime('latest_time')->nullable();
            $table->integer('del_flag')->nullable();
        });

        Schema::create('urt_show_tag_date', function ($table): void {
            $table->integer('pk');
            $table->dateTime('ctime');
            $table->dateTime('mtime')->nullable();
            $table->string('tagid')->nullable();
            $table->string('tag_or')->nullable();
            $table->string('tag_not')->nullable();
            $table->date('the_date');
            $table->integer('total_views')->nullable();
            $table->integer('count_videos')->nullable();
            $table->longText('tags_views')->nullable();
            $table->longText('tags_video')->nullable();
        });

        Schema::create('urt_show_group', function ($table): void {
            $table->increments('pk');
            $table->dateTime('ctime');
            $table->dateTime('stime')->nullable();
            $table->dateTime('mtime')->nullable();
            $table->string('the_group');
            $table->string('the_view');
            $table->longText('the_result')->nullable();
        });
    }
}
