<?php

namespace Tests\Unit;

use App\Support\InlineCodeFormatter;
use PHPUnit\Framework\TestCase;

class InlineCodeFormatterTest extends TestCase
{
    public function test_it_formats_backtick_wrapped_text_as_inline_code(): void
    {
        $html = InlineCodeFormatter::render('Read `urt_channel` rows and run `--execute`.')->toHtml();

        $this->assertSame('Read <code>urt_channel</code> rows and run <code>--execute</code>.', $html);
    }

    public function test_it_escapes_plain_text_and_inline_code_text(): void
    {
        $html = InlineCodeFormatter::render('<b>plain</b> `x<y>`')->toHtml();

        $this->assertSame('&lt;b&gt;plain&lt;/b&gt; <code>x&lt;y&gt;</code>', $html);
    }
}
