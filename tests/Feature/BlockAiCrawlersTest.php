<?php

namespace Tests\Feature;

use Tests\TestCase;

class BlockAiCrawlersTest extends TestCase
{
    public function test_ai_crawlers_receive_forbidden_before_reaching_routes(): void
    {
        $agents = [
            'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot',
            'Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)',
            'Mozilla/5.0 (Linux; Android 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Mobile Safari/537.36 (compatible; Bytespider; spider-feedback@bytedance.com)',
        ];

        foreach ($agents as $agent) {
            $this->withHeaders(['User-Agent' => $agent])
                ->get('/keywords/test/days?days=7')
                ->assertForbidden();
        }
    }

    public function test_browsers_and_search_engines_pass_through(): void
    {
        $agents = [
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36',
            'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        ];

        foreach ($agents as $agent) {
            $this->assertNotSame(403, $this->withHeaders(['User-Agent' => $agent])->get('/up')->getStatusCode());
        }
    }

    public function test_robots_txt_disallows_ai_crawlers_and_report_paths(): void
    {
        $robots = file_get_contents(public_path('robots.txt'));

        $this->assertStringContainsString("User-agent: GPTBot\n", $robots);
        $this->assertStringContainsString("User-agent: ClaudeBot\n", $robots);
        $this->assertStringContainsString("Disallow: /keywords/\n", $robots);
        $this->assertStringContainsString("Disallow: /channels/\n", $robots);
    }
}
