<?php

namespace Tests\Feature;

use Tests\TestCase;

class RobotsTxtTest extends TestCase
{
    public function test_robots_txt_allows_crawlers_but_keeps_them_off_expensive_paths(): void
    {
        $robots = file_get_contents(public_path('robots.txt'));

        $this->assertStringContainsString("User-agent: *\n", $robots);
        $this->assertStringContainsString("Disallow: /keywords/*/videos\n", $robots);
        $this->assertStringContainsString("Disallow: /api/\n", $robots);
        $this->assertStringContainsString("Crawl-delay: 10\n", $robots);
        $this->assertStringNotContainsString("Disallow: /\n", $robots);
    }

    public function test_ai_crawlers_are_not_blocked_at_the_application_layer(): void
    {
        $status = $this->withHeaders(['User-Agent' => 'Mozilla/5.0 (compatible; GPTBot/1.2)'])
            ->get('/up')
            ->getStatusCode();

        $this->assertNotSame(403, $status);
    }
}
