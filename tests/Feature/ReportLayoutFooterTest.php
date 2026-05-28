<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class ReportLayoutFooterTest extends TestCase
{
    public function test_report_layout_renders_global_footer(): void
    {
        Storage::fake('local');
        config()->set('legacy.public_site_url', 'https://legacy.example.test');

        $response = $this->get('/ops/ingestion');

        $response->assertOk();
        $response->assertSee('<footer class="yb-footer" aria-label="頁尾">', false);
        $response->assertSee('即時 YouTube 資料擷取儀表板');
        $response->assertSee('報表瀏覽、快取重建、排程與 AI 工作流由 ops 工作台控管');
        $response->assertSee('擷取排程');
        $response->assertSee('整合檢查');
        $response->assertSee('href="https://legacy.example.test"', false);
        $response->assertSee('現行站台');

        $content = $response->getContent();
        $this->assertSame(1, preg_match('/<div class="yb-topbar">(?P<topbar>.*?)<\/div>/s', $content, $topbarMatch));
        $this->assertSame(1, preg_match('/<footer class="yb-footer" aria-label="頁尾">(?P<footer>.*?)<\/footer>/s', $content, $footerMatch));
        $topbar = $topbarMatch['topbar'];
        $footer = $footerMatch['footer'];

        $this->assertStringNotContainsString('擷取排程', $topbar);
        $this->assertStringNotContainsString('整合檢查', $topbar);
        $this->assertStringContainsString('擷取排程</a>', $footer);
        $this->assertStringContainsString('整合檢查</a>', $footer);
        $this->assertStringNotContainsString('>總覽</a>', $footer);
        $this->assertStringNotContainsString('>目前直播</a>', $footer);
        $this->assertStringNotContainsString('>分類</a>', $footer);
        $this->assertStringNotContainsString('>關鍵字</a>', $footer);
    }
}
