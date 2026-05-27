<?php

namespace App\Support;

use Illuminate\Support\HtmlString;

final class InlineCodeFormatter
{
    public static function render(string $text): HtmlString
    {
        $segments = preg_split('/(`[^`]+`)/u', $text, -1, PREG_SPLIT_DELIM_CAPTURE | PREG_SPLIT_NO_EMPTY);

        if ($segments === false) {
            return new HtmlString(e($text));
        }

        $html = '';

        foreach ($segments as $segment) {
            if (preg_match('/^`([^`]+)`$/u', $segment, $matches) === 1) {
                $html .= '<code>'.e($matches[1]).'</code>';

                continue;
            }

            $html .= e($segment);
        }

        return new HtmlString($html);
    }
}
