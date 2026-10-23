import {test} from 'node:test';
import assert from 'node:assert/strict';
import {legacyRedirect} from '../../../shared/legacy-redirects';

// URL shapes the old youtube.board.tw pages linked (vh-board.conf rewrites) and that
// Google still requested in October 2026.
test('channel paths with the old "/&k=v" filter segment reach the channel report',()=>{
  assert.equal(legacyRedirect('/ch/3113/videos/&hours=24'),'/channels/3113/videos?hours=24&min=1000&column=viewCount&limit=1000');
  assert.equal(legacyRedirect('/ch/3113/comments/&hours=72'),'/channels/3113/comments?hours=72&limit=200&sourceLimit=1000');
  assert.equal(legacyRedirect('/ch/3113/cloud/&days=7'),'/channels/3113/cloud?days=7');
  assert.equal(legacyRedirect('/ch/3113/line/&'),'/channels/3113/trends');
  assert.equal(legacyRedirect('/ch/3113/line/&orig=1'),'/channels/3113/trends?orig=1');
  assert.equal(legacyRedirect('/ch/3113/prompt/&date=2026-10-17'),'/channels/3113/prompt?date=2026-10-17');
  assert.equal(legacyRedirect('/ch/3113/date/&date=2026-10-17'),'/channels/3113/ai/days/2026-10-17');
  assert.equal(legacyRedirect('/ch/3113/&hours=24'),'/channels/3113?hours=24');
  // The embedded segment wins over a real query string, as Apache dropped the latter.
  assert.equal(legacyRedirect('/ch/3113/cloud/&days=7?days=1'),'/channels/3113/cloud?days=7');
  assert.equal(legacyRedirect('/ch/3113/cloud/&tag=%E6%9F%AF%E6%96%87%E5%93%B2'),'/channels/3113/cloud?tag=%E6%9F%AF%E6%96%87%E5%93%B2');
});

test('a trailing slash on a legacy page is the same page, one hop',()=>{
  assert.equal(legacyRedirect('/ch/3113/'),'/channels/3113');
  assert.equal(legacyRedirect('/ch/3113/days/'),'/channels/3113/people');
  assert.equal(legacyRedirect('/rank/5/'),'/tags/5/channels?limit=200');
  assert.equal(legacyRedirect('/day/2026-10-01/all/'),'/ai/days/2026-10-01/all');
  assert.equal(legacyRedirect('/ch/3113/videos/?hours=72'),'/channels/3113/videos?hours=72&min=1000&column=viewCount&limit=1000');
});

test('GSC sample URLs keep their meaning and existing mappings are unchanged',()=>{
  assert.equal(legacyRedirect('/tag_group.php?&tag=%E6%B8%85%E6%B0%B4%E6%B4%BE%E5%87%BA%E6%89%80&days=7&type=total_views&group=politician'),
    '/keywords/%E6%B8%85%E6%B0%B4%E6%B4%BE%E5%87%BA%E6%89%80/groups/trends?days=7&type=total_views&group=politician');
  assert.equal(legacyRedirect('/tag_live.php?tag=%E6%9F%AF%E6%96%87%E5%93%B2&days=7'),'/keywords/%E6%9F%AF%E6%96%87%E5%93%B2/live/trends?days=7');
  assert.equal(legacyRedirect('/live_videos.php?date=2026-10-17'),'/live/days/2026-10-17');
  assert.equal(legacyRedirect('/live_videos.php?from=2026-10-01&to=2026-10-02'),'/live/periods?from=2026-10-01&to=2026-10-02');
  assert.equal(legacyRedirect('/ch/3113'),'/channels/3113');
  assert.equal(legacyRedirect('/index.php'),'/');
});

test('non-legacy and unknown paths are left alone',()=>{
  for(const path of ['/','/channels/3113/','/ch/abc/','/ch/3113/unknown/&x=1','/ch/3113/videos/extra','/group/group_media.php','/nav_index.php'])
    assert.equal(legacyRedirect(path),null,path);
});
