import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { legacyRedirect } from '../shared/legacy-redirects.ts';

const cases = [
  ['/index.php?sort=median&min=100', '/?sort=median&min=100'],
  ['/live_day.php?date=2026-05-23&or=1,2', '/live/days/2026-05-23?or=1%2C2'],
  ['/live_rank.php?from=2026-05-20&to=2026-05-24', '/live/periods?from=2026-05-20&to=2026-05-24'],
  ['/ai_day.php?date=2026-05-23&condition=all&foo=bar', '/ai/days/2026-05-23/all?foo=bar'],
  ['/ai_day_prompt.php?condition=all', '/ai/days/prompt?condition=all'],
  ['/ai_day.php?date=invalid&condition=all', '/ai/days?condition=all'],
  ['/ai_event.php?pk=42', '/ai/events/42'],
  ['/ai_event_wall.php?pk=0', '/ai/days'],
  ['/rank.php?tagid=102&limit=5', '/tags/102/channels?limit=5'],
  ['/videos.php?tagid=0', '/tags/videos?hours=24&min=1000&column=viewCount&limit=1000'],
  ['/tag_video.php?tag=%E5%8F%B0%E7%81%A3', '/keywords/%E5%8F%B0%E7%81%A3/videos?days=7&column=viewCount&limit=1000'],
  ['/group_two.php?all=1&group=other&days=30', '/groups/two_all/trends?days=30'],
  ['/channel.php?u_id=7&channel=8', '/channels/7'],
  ['/channel_date.php?channel=8&date=2026-05-23', '/channels/8/ai/days/2026-05-23'],
  ['/ch/008/date?date=2026-05-23', '/channels/8/ai/days/2026-05-23'],
  ['/ch/9/line?u_id=10', '/channels/9/trends'],
  ['/video.php?videoId=AbCdEFg_123', '/videos/AbCdEFg_123'],
  ['/video.php?videoId=abcDEFg_123', '/videos/abcDEFg_123'],
  ['/html/group_chart_all.html?days=14', '/groups/media_all/ranking?days=14'],
  ['/html/live_social.html?or=99', '/live/current?or=1%2C2%2C12%2C13%2C14%2C81'],
  ['/author_comments_bak.php?author_id=ABC&ChannelId=DEF', '/comments/authors/ABC'],
  ['/mayor/html_taipei.html', '/mayor/cities/taipei'],
  ['/mayor/city.php?city=taipei', '/mayor/cities/taipei'],
  ['/rank.php?tagid=1&tagid=2', '/tags/2/channels?limit=200'],
  ['/ai_event.php?id=5&x=1', '/ai/days?id=5&x=1'],
  ['/live.php?or[]=1&or[]=2', '/live/current?or%5B0%5D=1&or%5B1%5D=2'],
  ['/live.php?or[2]=1&or[]=2', '/live/current?or%5B2%5D=1&or%5B3%5D=2'],
  ['/days.php?tagid=1e3', '/tags/1000/days'],
  ['/channel.php?u_id=99999999999999999999', '/channels/9223372036854775807'],
  ['/channel.php?u_id=9223372036854775806', '/channels/9223372036854775806'],
  ['/channel.php?u_id=1.234e2', '/channels/123'],
  ['/days.php?tagid=1e-30000', '/tags/days'],
  ['/live.php?a.b=1', '/live/current?a_b=1'],
];
for (const [input, expected] of cases) test(input, () => assert.equal(legacyRedirect(input), expected));
test('every inventoried redirect declaration has a translation', async () => {
  const { routes } = JSON.parse(await readFile(new URL('../inventory/legacy.json', import.meta.url)));
  const values = { date: '2026-05-23', condition: 'all', tagId: '102', u_id: '8', city: 'taipei', file: 'group_chart.html' };
  for (const route of routes.filter(r => r.kind === 'redirect')) {
    const sample = route.path.replace(/\{(\w+)\}/g, (_, key) => values[key]);
    assert.ok(legacyRedirect(sample), `Missing ${route.path}`);
  }
});
test('does not translate APIs, mutating endpoints, unknown pages or arbitrary files', () => {
  for (const path of ['/api/video_tags.php', '/redir/add_video.php', '/prompt/ai_hour_prompt.php', '/ops/ingestion/run', '/html/group_unknown.html', '/ch/abc', '/nonexistent']) assert.equal(legacyRedirect(path), null);
});
test('untrusted values remain within a same-origin encoded path', () => {
  const result = legacyRedirect('/video.php?videoId=https%3A%2F%2Fevil.example%2Fa%23b');
  assert.equal(new URL(result, 'https://youtube.example').origin, 'https://youtube.example');
  assert.equal(new URL(result, 'https://youtube.example').hash, '');
});

test('legacy video pages materialize their page defaults without altering modern routes',()=>{
 for(const path of ['/channel_videos.php?u_id=8','/ch/8/videos'])assert.equal(legacyRedirect(path),'/channels/8/videos?hours=24&min=1000&column=viewCount&limit=1000');
 assert.equal(legacyRedirect('/videos.php?tagid=8&hours=72&min=0&column=likeCount&limit=20'),'/tags/8/videos?hours=72&min=0&column=likeCount&limit=20');
 assert.equal(legacyRedirect('/channel_videos.php?u_id=0'),'/');
 assert.equal(legacyRedirect('/channels/8/videos'),null);
 assert.equal(legacyRedirect('/tag_video.php?tag=AI&hours=24&days=3'),'/keywords/AI/videos?days=3&column=viewCount&limit=1000');
 assert.equal(legacyRedirect('/videos.php?hours=invalid&limit=1001'),'/tags/videos?hours=invalid&limit=1001&min=1000&column=viewCount');
});

test('blank legacy scalars keep bounded PHP normalization and keyword redirects ignore inactive filters',()=>{
 assert.equal(legacyRedirect('/channel_videos.php?u_id=8&hours=&min=&column=&limit='),'/channels/8/videos?hours=1&min=0&column=viewCount&limit=1');
 assert.equal(legacyRedirect('/tag_video.php?tag=AI&days=&limit=&column=likeCount&min=5&from=2034-01-01&q=x'),'/keywords/AI/videos?days=1&limit=1&column=viewCount');
});

test('legacy ranking and comments bounds retain legacy meaning and invalid sorts/group keys fall back',()=>{
 assert.equal(legacyRedirect('/rank.php?tagid=3&limit=1000&column=nope'),'/tags/3/channels?limit=200&column=view_month');
 assert.equal(legacyRedirect('/rank/3?column=bad'),'/tags/3/channels?column=view_month&limit=200');
 assert.equal(legacyRedirect('/comments.php?tagid=5&limit='),'/tags/5/comments?limit=1&sourceLimit=1');
 assert.equal(legacyRedirect('/comments.php?tagid=5'),'/tags/5/comments?limit=25&sourceLimit=25');
 assert.equal(legacyRedirect('/comments_recent.php?tagid=5&limit=100'),'/tags/5/comments?limit=100&sourceLimit=100');
 assert.equal(legacyRedirect('/channel_comments.php?u_id=8&limit=1000'),'/channels/8/comments?limit=200&sourceLimit=1000');
 assert.equal(legacyRedirect('/ch/8/comments'),'/channels/8/comments?limit=200&sourceLimit=1000');
 assert.equal(legacyRedirect('/videos.php?column=bad'),'/tags/videos?column=viewCount&hours=24&min=1000&limit=1000');
 assert.equal(legacyRedirect('/group_chart.php?group=foo'),'/groups/media/ranking');
 assert.equal(legacyRedirect('/group_line.php?group=media_social'),'/groups/media_social/trends');
 assert.equal(legacyRedirect('/group_view.php?group=政治人物'),'/groups/%E6%94%BF%E6%B2%BB%E4%BA%BA%E7%89%A9');
});
