<?php

namespace App\Http\Controllers\LegacyApi;

use App\Http\Controllers\Controller;
use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;

class MediaApiController extends Controller
{
    public function duration(Request $request): Response
    {
        $videoId = trim((string) $request->query('videoId', 'xotRiUF93-M')) ?: 'xotRiUF93-M';
        $duration = 0;

        try {
            $row = DB::table('urt_video_duration')->where('videoId', $videoId)->first();
            $duration = max(0, (int) ($row->duration ?? 0));
        } catch (QueryException) {
            $duration = 0;
        }

        return $this->text((string) $duration);
    }

    public function photo(Request $request): Response
    {
        $tag = trim((string) $request->query('tag', '柯文哲')) ?: '柯文哲';
        $imageUrl = 'null';

        try {
            $row = DB::table('urt_show_photo')
                ->where('tag', 'like', $tag)
                ->orderByDesc('pk')
                ->first();
            $imageUrl = is_string($row->image_url ?? null) && strlen($row->image_url) > 5
                ? $row->image_url
                : 'null';
        } catch (QueryException) {
            $imageUrl = 'null';
        }

        return $this->text($imageUrl);
    }

    private function text(string $body): Response
    {
        return response($body, 200)
            ->header('Content-Type', 'text/plain; charset=UTF-8')
            ->header('Access-Control-Allow-Origin', '*')
            ->header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
            ->header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With')
            ->header('X-Youtube-Board-Data-Source', 'true');
    }
}
