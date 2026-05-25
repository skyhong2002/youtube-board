<?php

use App\Http\Controllers\Reports\LiveCurrentController;
use App\Http\Controllers\Reports\LiveChannelsController;
use App\Http\Controllers\Reports\LiveContinuousController;
use App\Http\Controllers\Reports\LiveDailyTrendController;
use App\Http\Controllers\Reports\LiveDayController;
use App\Http\Controllers\Reports\LiveGroupHoursController;
use App\Http\Controllers\Reports\LiveHoursController;
use App\Http\Controllers\Reports\LivePeriodController;
use App\Http\Controllers\Reports\LiveTagController;
use App\Http\Controllers\Reports\LiveVideoTrendController;
use App\Http\Controllers\Reports\LiveWallController;
use App\Http\Controllers\Reports\AiAspectController;
use App\Http\Controllers\Reports\AiDailyController;
use App\Http\Controllers\Reports\AiDailyPromptController;
use App\Http\Controllers\Reports\AiEventController;
use App\Http\Controllers\Reports\AiHourlyController;
use App\Http\Controllers\Reports\AiPeriodController;
use App\Http\Controllers\Reports\AuthorCommentsController;
use App\Http\Controllers\Reports\TagChannelRankingController;
use App\Http\Controllers\Reports\TagComparisonController;
use App\Http\Controllers\Reports\TagDailyRelationController;
use App\Http\Controllers\Reports\TagDataGapController;
use App\Http\Controllers\Reports\TagLiveVideosController;
use App\Http\Controllers\Reports\TagTrendController;
use App\Http\Controllers\Reports\TagVideosController;
use App\Http\Controllers\Reports\VideoDetailController;
use App\Http\Controllers\Reports\ChannelProfileController;
use App\Http\Controllers\Reports\ChannelDataGapController;
use App\Http\Controllers\Reports\ChannelAiDailyController;
use App\Http\Controllers\Reports\ChannelAiOverviewController;
use App\Http\Controllers\Reports\ChannelPeopleController;
use App\Http\Controllers\Reports\ChannelPromptController;
use App\Http\Controllers\Reports\ChannelVideosController;
use App\Http\Controllers\Reports\GroupDirectoryController;
use App\Http\Controllers\Reports\GroupLiveController;
use App\Http\Controllers\Reports\GroupMetricController;
use App\Http\Controllers\Reports\HomeController;
use App\Http\Controllers\Reports\KeywordGroupTrendController;
use App\Http\Controllers\Reports\KeywordListController;
use App\Http\Controllers\Reports\KeywordLiveTrendController;
use App\Http\Controllers\Reports\MayorReportController;
use App\Http\Controllers\LegacyApi\LiveApiController;
use App\Http\Controllers\LegacyApi\TagChannelApiController;
use App\Http\Controllers\LegacyApi\CloudGroupApiController;
use App\Http\Controllers\LegacyApi\ChannelReportApiController;
use App\Http\Controllers\LegacyApi\AiApiController;
use App\Http\Controllers\LegacyApi\MediaApiController;
use App\Http\Controllers\Ops\DokployDeployWebhookController;
use App\Http\Controllers\Ops\IngestionDashboardController;
use App\Http\Controllers\Ops\LegacyPromptGuardController;
use App\Http\Controllers\Ops\LegacyWriteGuardController;
use App\Http\Controllers\Dev\IntegrationProbeController;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

Route::get('/', HomeController::class)->name('home');
Route::get('/index.php', function (Request $request) {
    return redirect()->route('home', $request->query(), 308);
})->name('legacy.home.index');
Route::get('/groups', [GroupDirectoryController::class, 'index'])->name('groups.index');
Route::get('/groups/{groupName}/live', GroupLiveController::class)->where('groupName', '[^/]+')->name('groups.live');
Route::get('/groups/{groupName}/ranking', [GroupMetricController::class, 'ranking'])->where('groupName', '[A-Za-z0-9_]+')->name('groups.ranking');
Route::get('/groups/{groupName}/trends', [GroupMetricController::class, 'trends'])->where('groupName', '[A-Za-z0-9_]+')->name('groups.trends');
Route::get('/groups/{groupName}', [GroupDirectoryController::class, 'show'])->where('groupName', '[^/]+')->name('groups.show');
Route::get('/mayor', [MayorReportController::class, 'index'])->name('mayor.index');
Route::get('/mayor/cities/{city}', [MayorReportController::class, 'show'])->where('city', '[A-Za-z0-9_]+')->name('mayor.show');

Route::get('/live/current', LiveCurrentController::class)->name('live.current');
Route::get('/live/channels', LiveChannelsController::class)->name('live.channels');
Route::get('/live/continuous', LiveContinuousController::class)->name('live.continuous');
Route::get('/live/days', LiveDayController::class)->name('live.days.index');
Route::get('/live/days/{date}', LiveDayController::class)->name('live.days.date');
Route::get('/live/groups/{group}/hours', LiveGroupHoursController::class)->where('group', '[A-Za-z0-9_]+')->name('live.groups.hours');
Route::get('/live/hours', LiveHoursController::class)->name('live.hours');
Route::get('/live/periods', LivePeriodController::class)->name('live.periods');
Route::get('/live/tags', LiveTagController::class)->name('live.tags');
Route::get('/live/trends/daily', LiveDailyTrendController::class)->name('live.trends.daily');
Route::get('/live/videos/{videoId}/trend', LiveVideoTrendController::class)->name('live.videos.trend');
Route::get('/live/walls/{variant}', LiveWallController::class)->whereIn('variant', ['news', 'china', 'alternate'])->name('live.wall');
Route::get('/videos/{videoId}/analytics', [VideoDetailController::class, 'analytics'])->where('videoId', '[^/]+')->name('videos.analytics');
Route::get('/videos/{videoId}', [VideoDetailController::class, 'show'])->where('videoId', '[^/]+')->name('videos.show');
Route::get('/tags', HomeController::class)->name('tags.index');
Route::get('/keywords', KeywordListController::class)->name('keywords.index');
Route::get('/keywords/{keyword}/groups/trends', KeywordGroupTrendController::class)->where('keyword', '[^/]+')->name('keywords.groups.trends');
Route::get('/keywords/{keyword}/live/trends', KeywordLiveTrendController::class)->where('keyword', '[^/]+')->name('keywords.live.trends');
Route::get('/keywords/{keyword}/cloud', [TagDataGapController::class, 'keywordCloud'])->where('keyword', '[^/]+')->name('keywords.cloud');
Route::get('/keywords/{keyword}/days', [TagDailyRelationController::class, 'keyword'])->where('keyword', '[^/]+')->name('keywords.days');
Route::get('/keywords/{keyword}/videos', [TagDataGapController::class, 'keywordVideos'])->where('keyword', '[^/]+')->name('keywords.videos');
Route::get('/tags/cloud', [TagDataGapController::class, 'cloud'])->name('tags.cloud.index');
Route::get('/tags/compare', TagComparisonController::class)->name('tags.compare');
Route::get('/tags/comments', [TagDataGapController::class, 'comments'])->name('tags.comments.index');
Route::get('/tags/days', [TagDailyRelationController::class, 'tagFilters'])->name('tags.days.index');
Route::get('/tags/live/videos', TagLiveVideosController::class)->name('tags.live.videos.index');
Route::get('/tags/trends', [TagTrendController::class, 'index'])->name('tags.trends.index');
Route::get('/tags/videos', TagVideosController::class)->name('tags.videos.index');
Route::get('/tags/{tagId}/cloud', [TagDataGapController::class, 'cloud'])->whereNumber('tagId')->name('tags.cloud');
Route::get('/tags/{tagId}/channels', TagChannelRankingController::class)->whereNumber('tagId')->name('tags.channels');
Route::get('/tags/{tagId}/comments', [TagDataGapController::class, 'comments'])->whereNumber('tagId')->name('tags.comments');
Route::get('/tags/{tagId}/days', [TagDailyRelationController::class, 'tagFilters'])->whereNumber('tagId')->name('tags.days');
Route::get('/tags/{tagId}/live/videos', TagLiveVideosController::class)->whereNumber('tagId')->name('tags.live.videos');
Route::get('/tags/{tagId}/trends', [TagTrendController::class, 'show'])->whereNumber('tagId')->name('tags.trends');
Route::get('/tags/{tagId}/videos', TagVideosController::class)->whereNumber('tagId')->name('tags.videos');
Route::get('/comments/authors/{authorKey}', AuthorCommentsController::class)->where('authorKey', '[^/]+')->name('comments.authors.show');
Route::get('/channels/{u_id}/comments', [ChannelDataGapController::class, 'comments'])->whereNumber('u_id')->name('channels.comments');
Route::get('/channels/{u_id}/cloud', [ChannelDataGapController::class, 'cloud'])->whereNumber('u_id')->name('channels.cloud');
Route::get('/channels/{u_id}/ai', ChannelAiOverviewController::class)->whereNumber('u_id')->name('channels.ai');
Route::get('/channels/{u_id}/ai/days', ChannelAiDailyController::class)->whereNumber('u_id')->name('channels.ai.days');
Route::get('/channels/{u_id}/ai/days/{date}', ChannelAiDailyController::class)->whereNumber('u_id')->where('date', '\d{4}-\d{2}-\d{2}')->name('channels.ai.days.date');
Route::get('/channels/{u_id}/people', ChannelPeopleController::class)->whereNumber('u_id')->name('channels.people');
Route::get('/channels/{u_id}/prompt', ChannelPromptController::class)->whereNumber('u_id')->name('channels.prompt');
Route::get('/channels/{u_id}/trends', [ChannelDataGapController::class, 'trends'])->whereNumber('u_id')->name('channels.trends');
Route::get('/channels/{u_id}/videos', ChannelVideosController::class)->whereNumber('u_id')->name('channels.videos');
Route::get('/channels/{u_id}', ChannelProfileController::class)->whereNumber('u_id')->name('channels.show');
Route::get('/ai/aspects', AiAspectController::class)->name('ai.aspects');
Route::get('/ai/days', AiDailyController::class)->name('ai.days.index');
Route::get('/ai/days/prompt', AiDailyPromptController::class)->name('ai.days.prompt.index');
Route::get('/ai/days/{date}/prompt', AiDailyPromptController::class)->where('date', '\d{4}-\d{2}-\d{2}')->name('ai.days.prompt');
Route::get('/ai/days/{date}/{condition}/prompt', AiDailyPromptController::class)->where('date', '\d{4}-\d{2}-\d{2}')->name('ai.days.condition.prompt');
Route::get('/ai/days/{date}', AiDailyController::class)->where('date', '\d{4}-\d{2}-\d{2}')->name('ai.days.date');
Route::get('/ai/days/{date}/{condition}', AiDailyController::class)->where('date', '\d{4}-\d{2}-\d{2}')->name('ai.days.condition');
Route::get('/ai/events/{id}/people', [AiEventController::class, 'people'])->whereNumber('id')->name('ai.events.people');
Route::get('/ai/events/{id}/wall', [AiEventController::class, 'wall'])->whereNumber('id')->name('ai.events.wall');
Route::get('/ai/events/{id}', AiEventController::class)->whereNumber('id')->name('ai.events.show');
Route::get('/ai/hours', AiHourlyController::class)->name('ai.hours');
Route::get('/ai/periods', AiPeriodController::class)->name('ai.periods');
Route::get('/ops/ingestion', IngestionDashboardController::class)->name('ops.ingestion');
Route::post('/ops/ingestion/run', [IngestionDashboardController::class, 'run'])->name('ops.ingestion.run');
Route::get('/ops/ingestion/runs/{runId}', [IngestionDashboardController::class, 'runShow'])
    ->where('runId', '\d{8}-\d{6}-[0-9a-f-]{36}')
    ->name('ops.ingestion.runs.show');
Route::get('/ops/ingestion/{jobKey}', [IngestionDashboardController::class, 'show'])->where('jobKey', '[A-Za-z0-9_.-]+')->name('ops.ingestion.show');
Route::post('/ops/deploy/dokploy', DokployDeployWebhookController::class)->name('ops.deploy.dokploy');
Route::match(['GET', 'POST'], '/redir/{script}.php', LegacyWriteGuardController::class)
    ->where('script', 'add_live|add_live_tvbs|add_video|ai_day|ai_hour|channel_ai|channel_gpt|make_live|renew|tag')
    ->name('legacy.redir.guard');
Route::match(['GET', 'POST'], '/prompt/{script}.php', LegacyPromptGuardController::class)
    ->where('script', 'ai_hour_prompt|ai_cont_prompt|ai_event_prompt|ai_period_prompt')
    ->name('legacy.prompt.guard');

Route::get('/api/api_live_day.php', [LiveApiController::class, 'liveDay'])->name('legacy.api.live.day');
Route::get('/api/api_live_date.php', [LiveApiController::class, 'liveDate'])->name('legacy.api.live.date');
Route::get('/api/api_live_hour.php', [LiveApiController::class, 'liveHour'])->name('legacy.api.live.hour');
Route::get('/api/api_live_tag_date.php', [LiveApiController::class, 'liveTagDate'])->name('legacy.api.live.tag.date');
Route::get('/api/live_date.php', [LiveApiController::class, 'liveDateList'])->name('legacy.api.live.date.list');
Route::get('/api/live_tvbs.php', [LiveApiController::class, 'liveTvbs'])->name('legacy.api.live.tvbs');
Route::get('/api/video_live.php', [LiveApiController::class, 'videoLive'])->name('legacy.api.live.video');
Route::get('/api/csv_live_line.php', [LiveApiController::class, 'csvLiveLine'])->name('legacy.api.live.csv.line');
Route::get('/api/tags_list.php', [TagChannelApiController::class, 'tagsList'])->name('legacy.api.tags.list');
Route::get('/api/tags_index.php', [TagChannelApiController::class, 'tagsIndex'])->name('legacy.api.tags.index');
Route::get('/api/tags_all.php', [TagChannelApiController::class, 'tagsAll'])->name('legacy.api.tags.all');
Route::get('/api/video_tags.php', [TagChannelApiController::class, 'videoTags'])->name('legacy.api.video.tags');
Route::get('/api/video_tags_title.php', [TagChannelApiController::class, 'videoTagsTitle'])->name('legacy.api.video.tags.title');
Route::get('/api/channels_list.php', [TagChannelApiController::class, 'channelsList'])->name('legacy.api.channels.list');
Route::get('/api/channel_videos.php', [TagChannelApiController::class, 'channelVideos'])->name('legacy.api.channel.videos');
Route::get('/api/channels_videos.php', [TagChannelApiController::class, 'channelsVideos'])->name('legacy.api.channels.videos');
Route::get('/api/api_channel_log.php', [ChannelReportApiController::class, 'channelLog'])->name('legacy.api.channel.log');
Route::get('/api/channel_pred.php', [ChannelReportApiController::class, 'channelPrediction'])->name('legacy.api.channel.prediction');
Route::get('/api/api_tag.php', [TagChannelApiController::class, 'tagMap'])->name('legacy.api.tag.map');
Route::get('/api/api_tag_log.php', [TagChannelApiController::class, 'tagLog'])->name('legacy.api.tag.log');
Route::get('/api/tags_day.php', [TagChannelApiController::class, 'tagCloud'])->name('legacy.api.tags.day');
Route::get('/api/tags_video.php', [TagChannelApiController::class, 'tagCloud'])->name('legacy.api.tags.video');
Route::get('/api/tags_relation_date.php', [TagChannelApiController::class, 'tagRelationDate'])->name('legacy.api.tags.relation.date');
Route::get('/api/tag_month.php', [TagChannelApiController::class, 'tagMonth'])->name('legacy.api.tag.month');
Route::get('/api/tag_period.php', [TagChannelApiController::class, 'tagPeriod'])->name('legacy.api.tag.period');
Route::get('/api/tag_tags_days.php', [TagChannelApiController::class, 'tagTagsDays'])->name('legacy.api.tag.tags.days');
Route::get('/api/cloud.php', [CloudGroupApiController::class, 'channelCloud'])->name('legacy.api.cloud.channel');
Route::get('/api/cloud_tag_date.php', [CloudGroupApiController::class, 'cloudTagDate'])->name('legacy.api.cloud.tag.date');
Route::get('/api/cloud_tag_date_noapi.php', [CloudGroupApiController::class, 'cloudTagDateNoApi'])->name('legacy.api.cloud.tag.date.noapi');
Route::get('/api/group_view.php', [CloudGroupApiController::class, 'groupView'])->name('legacy.api.group.view');
Route::get('/api/ai_day.php', [AiApiController::class, 'aiDay'])->name('legacy.api.ai.day');
Route::get('/api/api_topic.php', [AiApiController::class, 'topic'])->name('legacy.api.ai.topic');
Route::get('/api/api_event.php', [AiApiController::class, 'event'])->name('legacy.api.ai.event');
Route::get('/api/api_comment.php', [AiApiController::class, 'comment'])->name('legacy.api.comment');
Route::get('/api/api_duration.php', [MediaApiController::class, 'duration'])->name('legacy.api.duration');
Route::get('/api/api_get_photo.php', [MediaApiController::class, 'photo'])->name('legacy.api.photo');

Route::get('/live.php', function (Request $request) {
    return redirect()->route('live.current', $request->query(), 308);
})->name('legacy.live.current');

Route::get('/live_index.php', function (Request $request) {
    return redirect()->route('live.current', $request->query(), 308);
})->name('legacy.live.index');

Route::get('/live_cont.php', function (Request $request) {
    return redirect()->route('live.continuous', $request->query(), 308);
})->name('legacy.live.continuous');

Route::get('/live_day.php', function (Request $request) {
    $query = $request->query();
    $date = $query['date'] ?? null;
    unset($query['date']);

    if (is_string($date) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
        return redirect()->route('live.days.date', ['date' => $date] + $query, 308);
    }

    return redirect()->route('live.days.index', $query, 308);
})->name('legacy.live.day');

Route::get('/live_line.php', function (Request $request) {
    $videoId = trim((string) $request->query('videoId', 'oka2UDaeFZw')) ?: 'oka2UDaeFZw';
    $query = $request->query();
    unset($query['videoId']);

    return redirect()->route('live.videos.trend', ['videoId' => $videoId] + $query, 308);
})->name('legacy.live.video.trend');

Route::get('/live_day_line.php', function (Request $request) {
    return redirect()->route('live.trends.daily', $request->query(), 308);
})->name('legacy.live.daily.trend');

Route::get('/lives_date.php', function (Request $request) {
    $group = trim((string) $request->query('group', 'media')) ?: 'media';
    $query = $request->query();
    unset($query['group']);

    return redirect()->route('live.groups.hours', ['group' => $group] + $query, 308);
})->name('legacy.live.group.hours');

Route::get('/live_channels.php', function (Request $request) {
    return redirect()->route('live.channels', $request->query(), 308);
})->name('legacy.live.channels');

Route::get('/live_channel.php', function (Request $request) {
    $query = $request->query();

    if (isset($query['from'])) {
        return redirect()->route('live.periods', $query, 308);
    }

    $date = $query['date'] ?? null;
    unset($query['date']);

    if (is_string($date) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
        return redirect()->route('live.days.date', ['date' => $date] + $query, 308);
    }

    return redirect()->route('live.days.index', $query, 308);
})->name('legacy.live.channel');

Route::get('/live_hour.php', function (Request $request) {
    return redirect()->route('live.hours', $request->query(), 308);
})->name('legacy.live.hours');

Route::get('/live_period.php', function (Request $request) {
    return redirect()->route('live.periods', $request->query(), 308);
})->name('legacy.live.period');

Route::get('/live_tag.php', function (Request $request) {
    return redirect()->route('live.tags', $request->query(), 308);
})->name('legacy.live.tags');

Route::get('/live_rank.php', function (Request $request) {
    $query = $request->query();

    if (isset($query['from'])) {
        return redirect()->route('live.periods', $query, 308);
    }

    $date = $query['date'] ?? null;
    unset($query['date']);

    if (is_string($date) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
        return redirect()->route('live.days.date', ['date' => $date] + $query, 308);
    }

    return redirect()->route('live.days.index', $query, 308);
})->name('legacy.live.rank');

Route::get('/live4.php', function (Request $request) {
    return redirect()->route('live.wall', ['variant' => 'news'] + $request->query(), 308);
})->name('legacy.live.wall.news');

Route::get('/live5.php', function (Request $request) {
    return redirect()->route('live.wall', ['variant' => 'alternate'] + $request->query(), 308);
})->name('legacy.live.wall.alternate');

Route::get('/live_china.php', function (Request $request) {
    return redirect()->route('live.wall', ['variant' => 'china'] + $request->query(), 308);
})->name('legacy.live.wall.china');

Route::get('/ai_hour.php', function (Request $request) {
    return redirect()->route('ai.hours', $request->query(), 308);
})->name('legacy.ai.hours');

Route::get('/ai_period.php', function (Request $request) {
    return redirect()->route('ai.periods', $request->query(), 308);
})->name('legacy.ai.periods');

Route::get('/ai_day.php', function (Request $request) {
    $query = $request->query();
    $date = $query['date'] ?? null;
    $condition = $query['condition'] ?? null;
    unset($query['date'], $query['condition']);

    if (is_string($date) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
        if (is_string($condition) && $condition !== '') {
            return redirect()->route('ai.days.condition', ['date' => $date, 'condition' => $condition] + $query, 308);
        }

        return redirect()->route('ai.days.date', ['date' => $date] + $query, 308);
    }

    if (is_string($condition) && $condition !== '') {
        $query['condition'] = $condition;
    }

    return redirect()->route('ai.days.index', $query, 308);
})->name('legacy.ai.days');

Route::get('/ai_day_prompt.php', function (Request $request) {
    $query = $request->query();
    $date = $query['date'] ?? null;
    $condition = $query['condition'] ?? null;
    unset($query['date'], $query['condition']);

    if (is_string($date) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
        if (is_string($condition) && $condition !== '') {
            return redirect()->route('ai.days.condition.prompt', ['date' => $date, 'condition' => $condition] + $query, 308);
        }

        return redirect()->route('ai.days.prompt', ['date' => $date] + $query, 308);
    }

    if (is_string($condition) && $condition !== '') {
        $query['condition'] = $condition;
    }

    return redirect()->route('ai.days.prompt.index', $query, 308);
})->name('legacy.ai.days.prompt');

Route::get('/day/{date}/{condition}', function (Request $request, string $date, string $condition) {
    return redirect()->route('ai.days.condition', ['date' => $date, 'condition' => $condition] + $request->query(), 308);
})->where('date', '\d{4}-\d{2}-\d{2}')->name('legacy.ai.days.pretty');

Route::get('/ai_event.php', function (Request $request) {
    $pk = (int) $request->query('pk', 0);
    $query = $request->query();
    unset($query['pk']);

    if ($pk > 0) {
        return redirect()->route('ai.events.show', ['id' => $pk] + $query, 308);
    }

    return redirect()->route('ai.days.index', $query, 308);
})->name('legacy.ai.event');

Route::get('/ai_event_people.php', function (Request $request) {
    $pk = (int) $request->query('pk', 0);
    $query = $request->query();
    unset($query['pk']);

    if ($pk > 0) {
        return redirect()->route('ai.events.people', ['id' => $pk] + $query, 308);
    }

    return redirect()->route('ai.days.index', $query, 308);
})->name('legacy.ai.event.people');

Route::get('/ai_event_wall.php', function (Request $request) {
    $pk = (int) $request->query('pk', 0);
    $query = $request->query();
    unset($query['pk']);

    if ($pk > 0) {
        return redirect()->route('ai.events.wall', ['id' => $pk] + $query, 308);
    }

    return redirect()->route('ai.days.index', $query, 308);
})->name('legacy.ai.event.wall');

Route::get('/ai_channel.php', function (Request $request) {
    return redirect()->route('ai.aspects', $request->query(), 308);
})->name('legacy.ai.channel.aspects');

Route::get('/ai_tag.php', function (Request $request) {
    return redirect()->route('ai.aspects', $request->query(), 308);
})->name('legacy.ai.tag.aspects');

Route::get('/ai_dashboard.php', function (Request $request) {
    return redirect()->route('ai.aspects', $request->query(), 308);
})->name('legacy.ai.dashboard.aspects');

Route::get('/rank.php', function (Request $request) {
    $tagId = $request->query('tagid', 1);
    $query = $request->query();
    unset($query['tagid']);

    return redirect()->route('tags.channels', ['tagId' => (int) $tagId] + $query, 308);
})->name('legacy.rank.query');

Route::get('/rank/{tagId}', function (Request $request, int $tagId) {
    return redirect()->route('tags.channels', ['tagId' => $tagId] + $request->query(), 308);
})->whereNumber('tagId')->name('legacy.rank.path');

Route::get('/tags.php', function (Request $request) {
    return redirect()->route('keywords.index', $request->query(), 308);
})->name('legacy.keywords.index');

Route::get('/days.php', function (Request $request) {
    $tagId = (int) $request->query('tagid', 0);
    $query = $request->query();
    unset($query['tagid']);

    if ($tagId > 0) {
        return redirect()->route('tags.days', ['tagId' => $tagId] + $query, 308);
    }

    return redirect()->route('tags.days.index', $query, 308);
})->name('legacy.tags.days');

Route::get('/tag_days.php', function (Request $request) {
    $keyword = trim((string) $request->query('tag', '蔡英文')) ?: '蔡英文';
    $query = $request->query();
    unset($query['tag']);

    return redirect()->route('keywords.days', ['keyword' => $keyword] + $query, 308);
})->name('legacy.keywords.days');

Route::get('/comments_recent.php', function (Request $request) {
    $tagId = (int) $request->query('tagid', 0);
    $query = $request->query();
    unset($query['tagid']);

    if ($tagId > 0) {
        return redirect()->route('tags.comments', ['tagId' => $tagId] + $query, 308);
    }

    return redirect()->route('tags.comments.index', $query, 308);
})->name('legacy.tags.comments');

Route::get('/comments.php', function (Request $request) {
    $tagId = (int) $request->query('tagid', 0);
    $query = $request->query();
    unset($query['tagid']);

    if ($tagId > 0) {
        return redirect()->route('tags.comments', ['tagId' => $tagId] + $query, 308);
    }

    return redirect()->route('tags.comments.index', $query, 308);
})->name('legacy.tags.comments.full');

Route::get('/author_comments_bak.php', function (Request $request) {
    $query = $request->query();

    if (isset($query['author_id']) && trim((string) $query['author_id']) !== '') {
        $authorKey = trim((string) $query['author_id']);
        unset($query['author_id'], $query['ChannelId']);

        return redirect()->route('comments.authors.show', ['authorKey' => $authorKey] + $query, 308);
    }

    $authorKey = trim((string) ($query['ChannelId'] ?? 'UCCZDPRsKSOtP_vhNyvZvgMA'));
    unset($query['ChannelId']);

    return redirect()->route('comments.authors.show', ['authorKey' => $authorKey, 'lookup' => 'ChannelId'] + $query, 308);
})->name('legacy.comments.author');

Route::get('/cloud.php', function (Request $request) {
    $tagId = (int) $request->query('tagid', 0);
    $query = $request->query();
    unset($query['tagid']);

    if ($tagId > 0) {
        return redirect()->route('tags.cloud', ['tagId' => $tagId] + $query, 308);
    }

    return redirect()->route('tags.cloud.index', $query, 308);
})->name('legacy.tags.cloud');

Route::get('/tag_cloud.php', function (Request $request) {
    $keyword = trim((string) $request->query('tag', '蔡英文')) ?: '蔡英文';
    $query = $request->query();
    unset($query['tag']);

    return redirect()->route('keywords.cloud', ['keyword' => $keyword] + $query, 308);
})->name('legacy.keywords.cloud');

Route::get('/tag_video.php', function (Request $request) {
    $keyword = trim((string) $request->query('tag', '楊丞琳')) ?: '楊丞琳';
    $query = $request->query();
    unset($query['tag']);

    return redirect()->route('keywords.videos', ['keyword' => $keyword] + $query, 308);
})->name('legacy.keywords.videos');

Route::get('/tag_live.php', function (Request $request) {
    $keyword = trim((string) $request->query('tag', '柯文哲')) ?: '柯文哲';
    $query = $request->query();
    unset($query['tag']);

    return redirect()->route('keywords.live.trends', ['keyword' => $keyword] + $query, 308);
})->name('legacy.keywords.live.trends');

Route::get('/tag.php', function (Request $request) {
    return redirect()->route('tags.compare', $request->query(), 308);
})->name('legacy.tags.compare');

Route::get('/line.php', function (Request $request) {
    $tagId = (int) $request->query('tagid', 0);
    $query = $request->query();
    unset($query['tagid']);

    if ($tagId > 0) {
        return redirect()->route('tags.trends', ['tagId' => $tagId] + $query, 308);
    }

    return redirect()->route('tags.trends.index', $query, 308);
})->name('legacy.tags.trends');

Route::get('/tag_group.php', function (Request $request) {
    $keyword = trim((string) $request->query('tag', '柯文哲')) ?: '柯文哲';
    $query = $request->query();
    unset($query['tag']);

    return redirect()->route('keywords.groups.trends', ['keyword' => $keyword] + $query, 308);
})->name('legacy.keywords.group.trends');

Route::get('/group_view.php', function (Request $request) {
    $group = trim((string) $request->query('group', '政治人物')) ?: '政治人物';
    $query = $request->query();
    unset($query['group']);

    return redirect()->route('groups.show', ['groupName' => $group] + $query, 308);
})->name('legacy.groups.view');

Route::get('/group_people.php', function (Request $request) {
    $group = trim((string) $request->query('group', '政治人物')) ?: '政治人物';
    $query = $request->query();
    unset($query['group']);

    return redirect()->route('groups.show', ['groupName' => $group] + $query, 308);
})->name('legacy.groups.people');

Route::get('/group_tag.php', function (Request $request) {
    $group = trim((string) $request->query('group', 'politic')) ?: 'politic';
    $query = $request->query();
    unset($query['group']);

    return redirect()->route('groups.show', ['groupName' => $group] + $query, 308);
})->name('legacy.groups.tag');

Route::get('/group_live.php', function (Request $request) {
    $group = trim((string) $request->query('group', 'tags_president2024')) ?: 'tags_president2024';
    $query = $request->query();
    unset($query['group']);

    return redirect()->route('groups.live', ['groupName' => $group] + $query, 308);
})->name('legacy.groups.live');

Route::get('/group_two.php', function (Request $request) {
    $query = $request->query();
    $group = (int) ($query['all'] ?? 0) > 0 ? 'two_all' : 'two';
    unset($query['group'], $query['all']);

    return redirect()->route('groups.trends', ['groupName' => $group] + $query, 308);
})->name('legacy.groups.two');

Route::get('/group_chart.php', function (Request $request) {
    $group = trim((string) $request->query('group', 'media')) ?: 'media';
    $query = $request->query();
    unset($query['group']);

    return redirect()->route('groups.ranking', ['groupName' => $group] + $query, 308);
})->name('legacy.groups.ranking');

Route::get('/group_line.php', function (Request $request) {
    $group = trim((string) $request->query('group', 'media')) ?: 'media';
    $query = $request->query();
    unset($query['group']);

    return redirect()->route('groups.trends', ['groupName' => $group] + $query, 308);
})->name('legacy.groups.trends');

Route::get('/mayor/city.php', function (Request $request) {
    $city = trim((string) $request->query('city', 'taipei')) ?: 'taipei';
    $query = $request->query();
    unset($query['city']);

    return redirect()->route('mayor.show', ['city' => $city] + $query, 308);
})->name('legacy.mayor.city');

Route::get('/mayor/html_{city}.html', function (Request $request, string $city) {
    return redirect()->route('mayor.show', ['city' => $city] + $request->query(), 308);
})->where('city', '[A-Za-z0-9_]+')->name('legacy.mayor.static');

Route::get('/mayor/{city}.php', function (Request $request, string $city) {
    return redirect()->route('mayor.show', ['city' => $city] + $request->query(), 308);
})->where('city', '[A-Za-z0-9_]+')->name('legacy.mayor.config');

Route::get('/html/{file}', function (Request $request, string $file) {
    $targets = [
        'group_chart.html' => ['route' => 'groups.ranking', 'group' => 'media', 'query' => ['days' => 7]],
        'group_chart_7.html' => ['route' => 'groups.ranking', 'group' => 'media', 'query' => ['days' => 7]],
        'group_chart_30.html' => ['route' => 'groups.ranking', 'group' => 'media', 'query' => ['days' => 30]],
        'group_chart_all.html' => ['route' => 'groups.ranking', 'group' => 'media_all', 'query' => ['days' => 30]],
        'group_line.html' => ['route' => 'groups.trends', 'group' => 'media', 'query' => ['days' => 30]],
        'group_line_30.html' => ['route' => 'groups.trends', 'group' => 'media', 'query' => ['days' => 30]],
    ];

    abort_if(! isset($targets[$file]), 404);

    $target = $targets[$file];
    $query = array_merge($target['query'], $request->query());

    return redirect()->route($target['route'], ['groupName' => $target['group']] + $query, 308);
})->where('file', 'group_[A-Za-z0-9_]+\.html')->name('legacy.groups.static.html');

Route::get('/html/live_social.html', function (Request $request) {
    return redirect()->route('live.current', ['or' => '1,2,12,13,14,81'] + $request->query(), 308);
})->name('legacy.live.static.social');

Route::get('/videos.php', function (Request $request) {
    $tagId = (int) $request->query('tagid', 0);
    $query = $request->query();
    unset($query['tagid']);

    if ($tagId > 0) {
        return redirect()->route('tags.videos', ['tagId' => $tagId] + $query, 308);
    }

    return redirect()->route('tags.videos.index', $query, 308);
})->name('legacy.tags.videos');

Route::get('/live_videos.php', function (Request $request) {
    $query = $request->query();

    if (isset($query['from'])) {
        return redirect()->route('live.periods', $query, 308);
    }

    $date = $query['date'] ?? null;
    unset($query['date']);

    if (is_string($date) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
        return redirect()->route('live.days.date', ['date' => $date] + $query, 308);
    }

    return redirect()->route('live.days.index', $query, 308);
})->name('legacy.live.videos');

Route::get('/video.php', function (Request $request) {
    $videoId = trim((string) $request->query('videoId', 'oka2UDaeFZw'));
    $query = $request->query();
    unset($query['videoId']);

    return redirect()->route('videos.show', ['videoId' => $videoId] + $query, 308);
})->name('legacy.video.show');

Route::get('/video_data_att.php', function (Request $request) {
    $videoId = trim((string) $request->query('videoId', 'XVfaDA8qaFU'));
    $query = $request->query();
    unset($query['videoId']);

    return redirect()->route('videos.analytics', ['videoId' => $videoId] + $query, 308);
})->name('legacy.video.analytics');

Route::get('/video_data.php', function (Request $request) {
    $videoId = trim((string) $request->query('videoId', 'XVfaDA8qaFU'));
    $query = $request->query();
    unset($query['videoId']);

    return redirect()->route('videos.analytics', ['videoId' => $videoId] + $query, 308);
})->name('legacy.video.analytics.short');

Route::get('/channel.php', function (Request $request) {
    $uId = (int) $request->query('u_id', $request->query('channel', 0));
    $query = $request->query();
    unset($query['u_id'], $query['channel']);

    if ($uId > 0) {
        return redirect()->route('channels.show', ['u_id' => $uId] + $query, 308);
    }

    return redirect()->route('home', $query, 308);
})->name('legacy.channel.query.show');

Route::get('/channel_videos.php', function (Request $request) {
    $uId = (int) $request->query('u_id', $request->query('channel', 0));
    $query = $request->query();
    unset($query['u_id'], $query['channel']);

    if ($uId > 0) {
        return redirect()->route('channels.videos', ['u_id' => $uId] + $query, 308);
    }

    return redirect()->route('home', $query, 308);
})->name('legacy.channel.query.videos');

Route::get('/channel_comments.php', function (Request $request) {
    $uId = (int) $request->query('u_id', $request->query('channel', 0));
    $query = $request->query();
    unset($query['u_id'], $query['channel']);

    if ($uId > 0) {
        return redirect()->route('channels.comments', ['u_id' => $uId] + $query, 308);
    }

    return redirect()->route('home', $query, 308);
})->name('legacy.channel.query.comments');

Route::get('/channel_cloud.php', function (Request $request) {
    $uId = (int) $request->query('u_id', $request->query('channel', 0));
    $query = $request->query();
    unset($query['u_id'], $query['channel']);

    if ($uId > 0) {
        return redirect()->route('channels.cloud', ['u_id' => $uId] + $query, 308);
    }

    return redirect()->route('home', $query, 308);
})->name('legacy.channel.query.cloud');

Route::get('/channel_line.php', function (Request $request) {
    $uId = (int) $request->query('u_id', $request->query('channel', 0));
    $query = $request->query();
    unset($query['u_id'], $query['channel']);

    if ($uId > 0) {
        return redirect()->route('channels.trends', ['u_id' => $uId] + $query, 308);
    }

    return redirect()->route('home', $query, 308);
})->name('legacy.channel.query.trends');

Route::get('/channel_days.php', function (Request $request) {
    $uId = (int) $request->query('u_id', $request->query('channel', 0));
    $query = $request->query();
    unset($query['u_id'], $query['channel']);

    if ($uId > 0) {
        return redirect()->route('channels.people', ['u_id' => $uId] + $query, 308);
    }

    return redirect()->route('home', $query, 308);
})->name('legacy.channel.query.people');

Route::get('/channel_date.php', function (Request $request) {
    $uId = (int) $request->query('u_id', $request->query('channel', 0));
    $query = $request->query();
    $date = $query['date'] ?? null;
    unset($query['u_id'], $query['channel'], $query['date']);

    if ($uId <= 0) {
        return redirect()->route('home', $query, 308);
    }

    if (is_string($date) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
        return redirect()->route('channels.ai.days.date', ['u_id' => $uId, 'date' => $date] + $query, 308);
    }

    return redirect()->route('channels.ai.days', ['u_id' => $uId] + $query, 308);
})->name('legacy.channel.query.ai.days');

Route::get('/channel_prompt.php', function (Request $request) {
    $uId = (int) $request->query('u_id', $request->query('channel', 0));
    $query = $request->query();
    unset($query['u_id'], $query['channel']);

    if ($uId > 0) {
        return redirect()->route('channels.prompt', ['u_id' => $uId] + $query, 308);
    }

    return redirect()->route('home', $query, 308);
})->name('legacy.channel.query.prompt');

Route::get('/ch/{u_id}/videos', function (Request $request, int $u_id) {
    return redirect()->route('channels.videos', ['u_id' => $u_id] + $request->query(), 308);
})->whereNumber('u_id')->name('legacy.channel.videos');

Route::get('/ch/{u_id}/comments', function (Request $request, int $u_id) {
    return redirect()->route('channels.comments', ['u_id' => $u_id] + $request->query(), 308);
})->whereNumber('u_id')->name('legacy.channel.comments');

Route::get('/ch/{u_id}/cloud', function (Request $request, int $u_id) {
    return redirect()->route('channels.cloud', ['u_id' => $u_id] + $request->query(), 308);
})->whereNumber('u_id')->name('legacy.channel.cloud');

Route::get('/ch/{u_id}/line', function (Request $request, int $u_id) {
    return redirect()->route('channels.trends', ['u_id' => $u_id] + $request->query(), 308);
})->whereNumber('u_id')->name('legacy.channel.trends');

Route::get('/ch/{u_id}/days', function (Request $request, int $u_id) {
    return redirect()->route('channels.people', ['u_id' => $u_id] + $request->query(), 308);
})->whereNumber('u_id')->name('legacy.channel.people');

Route::get('/ch/{u_id}/date', function (Request $request, int $u_id) {
    $query = $request->query();
    $date = $query['date'] ?? null;
    unset($query['date']);

    if (is_string($date) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
        return redirect()->route('channels.ai.days.date', ['u_id' => $u_id, 'date' => $date] + $query, 308);
    }

    return redirect()->route('channels.ai.days', ['u_id' => $u_id] + $query, 308);
})->whereNumber('u_id')->name('legacy.channel.ai.days');

Route::get('/ch/{u_id}/ai', function (Request $request, int $u_id) {
    return redirect()->route('channels.ai', ['u_id' => $u_id] + $request->query(), 308);
})->whereNumber('u_id')->name('legacy.channel.ai');

Route::get('/ch/{u_id}/prompt', function (Request $request, int $u_id) {
    return redirect()->route('channels.prompt', ['u_id' => $u_id] + $request->query(), 308);
})->whereNumber('u_id')->name('legacy.channel.prompt');

Route::get('/channel_gpt.php', function (Request $request) {
    $uId = (int) $request->query('u_id', $request->query('channel', 0));
    $query = $request->query();
    unset($query['u_id'], $query['channel']);

    if ($uId > 0) {
        return redirect()->route('channels.ai', ['u_id' => $uId] + $query, 308);
    }

    return redirect()->route('home', $query, 308);
})->name('legacy.channel.gpt');

Route::get('/ch/{u_id}', function (Request $request, int $u_id) {
    return redirect()->route('channels.show', ['u_id' => $u_id] + $request->query(), 308);
})->whereNumber('u_id')->name('legacy.channel.show');

if (app()->environment(['local', 'testing'])) {
    $youtubeProbe = [IntegrationProbeController::class, 'youtube'];

    Route::get('/dev/check', [IntegrationProbeController::class, 'youtubePage'])
        ->name('dev.check');

    Route::get('/dev/yt-check', $youtubeProbe)
        ->name('dev.yt.check');

    Route::get('/dev/youtube-api-probe', $youtubeProbe)
        ->name('dev.youtube-api.probe');

    Route::get('/dev/integrations/youtube/probe', $youtubeProbe)
        ->name('dev.integrations.youtube.probe');
}
