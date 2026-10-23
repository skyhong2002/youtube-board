export const LEGACY_VIDEO_DEFAULTS={hours:'24',min:'1000',column:'viewCount',limit:'1000'} as const;
export const LEGACY_KEYWORD_VIDEO_DEFAULTS={days:'7',column:'viewCount',limit:'1000'} as const;
/** Legacy public redirects. Pure URL translation; never invokes a mutating route. */
const simple: Record<string, string> = {
  '/index.php': '/', '/live.php': '/live/current', '/live_index.php': '/live/current',
  '/live_cont.php': '/live/continuous', '/live_day_line.php': '/live/trends/daily',
  '/live_channels.php': '/live/channels', '/live_hour.php': '/live/hours',
  '/live_period.php': '/live/periods', '/live_tag.php': '/live/tags',
  '/live4.php': '/live/walls/news', '/live5.php': '/live/walls/alternate',
  '/live_china.php': '/live/walls/china', '/ai_hour.php': '/ai/hours',
  '/ai_period.php': '/ai/periods', '/ai_channel.php': '/ai/aspects',
  '/ai_tag.php': '/ai/aspects', '/ai_dashboard.php': '/ai/aspects',
  '/tags.php': '/keywords', '/tag.php': '/tags/compare',
};
const tagReports: Record<string, string> = {
  '/days.php': 'days', '/comments_recent.php': 'comments', '/comments.php': 'comments',
  '/cloud.php': 'cloud', '/line.php': 'trends', '/videos.php': 'videos',
};
const keywordReports: Record<string, [string, string]> = {
  '/tag_days.php': ['days', '蔡英文'], '/tag_cloud.php': ['cloud', '蔡英文'],
  '/tag_video.php': ['videos', '楊丞琳'], '/tag_live.php': ['live/trends', '柯文哲'],
  '/tag_group.php': ['groups/trends', '柯文哲'],
};
const groups: Record<string, [string, string]> = {
  '/group_view.php': ['', '政治人物'], '/group_people.php': ['', '政治人物'],
  '/group_tag.php': ['', 'politic'], '/group_live.php': ['/live', 'tags_president2024'],
  '/group_chart.php': ['/ranking', 'media'], '/group_line.php': ['/trends', 'media'],
};
const channels: Record<string, string> = {
  '/channel.php': '', '/channel_videos.php': '/videos', '/channel_comments.php': '/comments',
  '/channel_cloud.php': '/cloud', '/channel_line.php': '/trends', '/channel_days.php': '/people',
  '/channel_date.php': '/ai/days', '/channel_prompt.php': '/prompt', '/channel_gpt.php': '/ai',
};
const dayShape = /^\d{4}-\d{2}-\d{2}$/;
// Match PHP's numeric-prefix cast without rounding opaque integer route ids.
const integer = (value: string | null): bigint => {
  const numeric = value?.trimStart().match(/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i)?.[0];
  if (!numeric) return 0n;
  const negative = numeric.startsWith('-');
  const [coefficient, exponent = '0'] = numeric.replace(/^[+-]/, '').toLowerCase().split('e');
  const [whole, fraction = ''] = coefficient.split('.');
  const digits = `${whole}${fraction}`.replace(/^0+/, '');
  if (!digits) return 0n;
  const shift = Number(exponent) - fraction.length;
  const length = digits.length + shift;
  if (length <= 0) return 0n;
  const max = negative ? 9223372036854775808n : 9223372036854775807n;
  const absolute = length > 19 ? max : BigInt(shift >= 0 ? digits + '0'.repeat(shift) : digits.slice(0, length));
  return (negative ? -1n : 1n) * (absolute > max ? max : absolute);
};
const part = (value: string) => encodeURIComponent(value);

function phpQuery(source: URLSearchParams): URLSearchParams {
  const output = new URLSearchParams();
  const nextIndex = new Map<string, number>();
  for (const [raw, value] of source) {
    let key = raw.replace(/^[^[]+/, base => base.replace(/[ .]/g, '_'));
    if (key.endsWith('[]')) {
      const base = key.slice(0, -2);
      const index = nextIndex.get(base) ?? 0;
      key = `${base}[${index}]`;
      nextIndex.set(base, index + 1);
    } else {
      const indexed = key.match(/^(.*)\[(\d+)\]$/);
      if (indexed) nextIndex.set(indexed[1], Math.max(nextIndex.get(indexed[1]) ?? 0, Number(indexed[2]) + 1));
    }
    output.set(key, value);
  }
  return output;
}

export function legacyRedirect(input: string): string | null {
  let url: URL;
  try { url = new URL(input, 'http://local.invalid'); } catch { return null; }
  // Apache (vh-board.conf) rewrote /ch/{id}/{view}/{rest} to channel_{view}.php?u_id={id}&{rest},
  // and the old pages linked filters that way (/ch/3113/videos/&hours=24). Read the trailing
  // "&k=v" segment as query parameters; they win over a real query string as they did in PHP.
  // A single trailing slash (/ch/3113/, /rank/5/) is the same legacy page.
  const embedded = url.pathname.match(/^(\/ch\/\d+(?:\/(?:videos|comments|cloud|line|days|date|ai|prompt))?)\/(&[^/]*)?$/);
  const path = embedded ? embedded[1] : url.pathname.replace(/(.)\/$/, '$1');
  const source = new URLSearchParams(url.searchParams);
  if (embedded?.[2]) for (const [key, value] of new URLSearchParams(embedded[2])) source.append(key, value);
  // PHP query parsing keeps the last scalar value. Preserve arbitrary filter
  // keys but never interpret any value as a redirect destination or host.
  const query = phpQuery(source);
  const take = (name: string, fallback = '') => {
    const value = query.get(name) ?? fallback;
    query.delete(name);
    return value;
  };
  const defaults=(values:Record<string,string>)=>{const blank:Record<string,string>={hours:'1',days:'1',min:'0',column:'viewCount',limit:'1'};for(const [key,value]of Object.entries(values)){if(!query.has(key))query.set(key,value);else if(query.get(key)?.trim()==='')query.set(key,blank[key]??value);}};
  const clamp=(key:string,fallback:number,max:number)=>{const value=integer(query.get(key)??String(fallback));query.set(key,String(value<1n?1n:value>BigInt(max)?BigInt(max):value));};
  const sort=(allowed:string[],fallback:string)=>{if(query.has('column')&&!allowed.includes(query.get('column')!))query.set('column',fallback);};
  const videoDefaults=()=>{defaults(LEGACY_VIDEO_DEFAULTS);sort(['publishedAt','viewCount','likeCount','commentCount'],'viewCount');};
  const ranking=()=>{clamp('limit',1000,200);sort(['viewCount','subscriberCount','videoCount','view_week','view_month','views_pred_week','views_pred_month','sub_week','sub_month','video_week','video_month'],'view_month');};
  const comments=(fallback:number)=>{clamp('limit',fallback,1000);query.set('sourceLimit',query.get('limit')!);clamp('limit',fallback,200);};
  const finish = (target: string) => {
    const search = query.toString();
    return target + (search ? `?${search}` : '');
  };
  if (Object.hasOwn(simple, path)) {
    if (path === '/live4.php' || path === '/live5.php' || path === '/live_china.php') query.delete('variant');
    return finish(simple[path]);
  }
  if (['/live_day.php', '/live_channel.php', '/live_rank.php', '/live_videos.php'].includes(path)) {
    if (path !== '/live_day.php' && query.has('from')) return finish('/live/periods');
    const date = take('date');
    return finish(dayShape.test(date) ? `/live/days/${date}` : '/live/days');
  }
  if (path === '/live_line.php') return finish(`/live/videos/${part(take('videoId', 'oka2UDaeFZw').trim() || 'oka2UDaeFZw')}/trend`);
  if (path === '/lives_date.php') return finish(`/live/groups/${part(take('group', 'media').trim() || 'media')}/hours`);
  if (path === '/ai_day.php' || path === '/ai_day_prompt.php') {
    const date = take('date'); const condition = take('condition');
    let target = '/ai/days';
    if (dayShape.test(date)) {
      target += `/${date}`;
      if (condition) target += `/${part(condition)}`;
    } else if (condition) query.set('condition', condition);
    if (path.endsWith('_prompt.php')) target += '/prompt';
    return finish(target);
  }
  if (['/ai_event.php', '/ai_event_people.php', '/ai_event_wall.php'].includes(path)) {
    const id = integer(take('pk'));
    const suffix = path === '/ai_event_people.php' ? '/people' : path === '/ai_event_wall.php' ? '/wall' : '';
    if (id > 0) query.delete('id');
    return finish(id > 0 ? `/ai/events/${id}${suffix}` : '/ai/days');
  }
  if (path === '/rank.php') {
    ranking();
    const id = integer(take('tagid', '1')); query.delete('tagId');
    return finish(`/tags/${id}/channels`);
  }
  if (Object.hasOwn(tagReports, path)) {
    if(path==='/videos.php')videoDefaults();
    if(tagReports[path]==='comments')comments(25);
    const id = integer(take('tagid'));
    if (id > 0) query.delete('tagId');
    return finish(`/tags${id > 0 ? `/${id}` : ''}/${tagReports[path]}`);
  }
  if (Object.hasOwn(keywordReports, path)) {
    if(path==='/tag_video.php'){for(const key of [...query.keys()])if(!['tag','days','limit'].includes(key))query.delete(key);defaults(LEGACY_KEYWORD_VIDEO_DEFAULTS);}
    const [suffix, fallback] = keywordReports[path];
    const tag = take('tag', fallback).trim() || fallback;
    query.delete('keyword');
    return finish(`/keywords/${part(tag)}/${suffix}`);
  }
  if (Object.hasOwn(groups, path)) {
    const [suffix, fallback] = groups[path];
    let group = take('group', fallback).trim() || fallback;
    if(['/group_chart.php','/group_line.php'].includes(path)){group=group.replace(/[^a-zA-Z0-9_]/g,'');if(!['media','media_social','media_all','position','tv_position','two','two_all','china','all','politic'].includes(group))group='media';}
    query.delete('groupName');
    return finish(`/groups/${part(group)}${suffix}`);
  }
  if (path === '/group_two.php') {
    const group = integer(take('all')) > 0 ? 'two_all' : 'two';
    query.delete('group'); query.delete('groupName');
    return finish(`/groups/${group}/trends`);
  }
  if (path === '/author_comments_bak.php') {
    const author = query.get('author_id')?.trim();
    query.delete('authorKey');
    if (author) {
      query.delete('author_id'); query.delete('ChannelId');
      return finish(`/comments/authors/${part(author)}`);
    }
    const channel = take('ChannelId', 'UCCZDPRsKSOtP_vhNyvZvgMA').trim();
    query.set('lookup', 'ChannelId');
    return finish(`/comments/authors/${part(channel)}`);
  }
  if (path === '/mayor/city.php') return finish(`/mayor/cities/${part(take('city', 'taipei').trim() || 'taipei')}`);
  const mayor = path.match(/^\/mayor\/(?:html_([A-Za-z0-9_]+)\.html|([A-Za-z0-9_]+)\.php)$/);
  if (mayor) { query.delete('city'); return finish(`/mayor/cities/${part(mayor[1] ?? mayor[2])}`); }
  if (path === '/html/live_social.html') { query.set('or', '1,2,12,13,14,81'); return finish('/live/current'); }
  const staticGroups: Record<string, [string, string, string]> = {
    'group_chart.html': ['ranking', 'media', '7'], 'group_chart_7.html': ['ranking', 'media', '7'],
    'group_chart_30.html': ['ranking', 'media', '30'], 'group_chart_all.html': ['ranking', 'media_all', '30'],
    'group_line.html': ['trends', 'media', '30'], 'group_line_30.html': ['trends', 'media', '30'],
  };
  const file = path.startsWith('/html/') ? path.slice(6) : '';
  if (Object.hasOwn(staticGroups, file)) {
    const [view, group, days] = staticGroups[file];
    if (!query.has('days')) query.set('days', days);
    query.delete('groupName');
    return finish(`/groups/${group}/${view}`);
  }
  if (['/video.php', '/video_data.php', '/video_data_att.php'].includes(path)) {
    const analytics = path !== '/video.php';
    const id = take('videoId', analytics ? 'XVfaDA8qaFU' : 'oka2UDaeFZw').trim();
    return id ? finish(`/videos/${part(id)}${analytics ? '/analytics' : ''}`) : null;
  }
  if (Object.hasOwn(channels, path)) {
    const id = integer(query.get('u_id') ?? query.get('channel'));
    query.delete('u_id'); query.delete('channel');
    if(path==='/channel_videos.php'&&id>0)videoDefaults();
    if(path==='/channel_comments.php'&&id>0)comments(1000);
    let suffix = channels[path];
    if (path === '/channel_date.php') {
      const date = take('date');
      if (dayShape.test(date)) suffix += `/${date}`;
    }
    return finish(id > 0 ? `/channels/${id}${suffix}` : '/');
  }
  const channelPath = path.match(/^\/ch\/(\d+)(?:\/(videos|comments|cloud|line|days|date|ai|prompt))?$/);
  if (channelPath) {
    query.delete('u_id');
    if(channelPath[2]==='videos')videoDefaults();
    if(channelPath[2]==='comments')comments(1000);
    const views: Record<string, string> = { videos: '/videos', comments: '/comments', cloud: '/cloud', line: '/trends', days: '/people', date: '/ai/days', ai: '/ai', prompt: '/prompt' };
    let suffix = views[channelPath[2]] ?? '';
    if (channelPath[2] === 'date') {
      const date = take('date'); if (dayShape.test(date)) suffix += `/${date}`;
    }
    return finish(`/channels/${integer(channelPath[1])}${suffix}`);
  }
  const rank = path.match(/^\/rank\/(\d+)$/);
  if (rank) { ranking();query.delete('tagId'); return finish(`/tags/${integer(rank[1])}/channels`); }
  const day = path.match(/^\/day\/(\d{4}-\d{2}-\d{2})\/([^/]+)$/);
  if (day) {
    query.delete('date'); query.delete('condition');
    try { return finish(`/ai/days/${day[1]}/${part(decodeURIComponent(day[2]))}`); } catch { return null; }
  }
  return null;
}
