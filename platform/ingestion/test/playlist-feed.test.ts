import { describe, expect, it } from 'vitest';
import { fetchPlaylistFeed, parsePlaylistFeed, PlaylistFeedError } from '../src/playlist-feed.js';

const PLAYLIST = 'PLWDKpvlDapjQ';
const feed = (ids: string[], playlistId = PLAYLIST) => `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">
 <id>yt:playlist:${playlistId}</id>
 <yt:playlistId>${playlistId}</yt:playlistId>
 <title>加入直播</title>
${ids.map(id => ` <entry>\n  <id>yt:video:${id}</id>\n  <yt:videoId>${id}</yt:videoId>\n  <yt:channelId>UCOSmkVK2xsihzKXQgiXPS4w</yt:channelId>\n </entry>`).join('\n')}
</feed>`;
const respond = (body: string, init: ResponseInit = {}) => (async () => new Response(body, { status: 200, headers: { 'content-type': 'text/xml; charset=UTF-8' }, ...init })) as unknown as typeof fetch;
const reason = async (promise: Promise<unknown>) => { try { await promise; } catch (error) { return error instanceof PlaylistFeedError ? error.reason : String(error); } return 'resolved'; };

describe('playlist feed', () => {
  it('reads video ids in feed order, once each', () => {
    expect(parsePlaylistFeed(feed(['dKGM2rzKRjs', 'Other123456', 'dKGM2rzKRjs']), PLAYLIST)).toEqual({ videoIds: ['dKGM2rzKRjs', 'Other123456'], entries: 3 });
    expect(parsePlaylistFeed(feed([]), PLAYLIST)).toEqual({ videoIds: [], entries: 0 });
    expect(parsePlaylistFeed(feed(['dKGM2rzKRjs']).replace('<entry>', '<entry xml:lang="en">'), PLAYLIST)).toEqual({ videoIds: ['dKGM2rzKRjs'], entries: 1 });
  });
  it('refuses anything that is not this playlist’s feed instead of reading it as empty', () => {
    expect(() => parsePlaylistFeed('<html><body>error</body></html>', PLAYLIST)).toThrow(PlaylistFeedError);
    expect(() => parsePlaylistFeed(feed(['dKGM2rzKRjs'], 'PLotherotherother'), PLAYLIST)).toThrow(PlaylistFeedError);
    expect(() => parsePlaylistFeed(feed(['bad id']), PLAYLIST)).toThrow(PlaylistFeedError);
    expect(() => parsePlaylistFeed(feed(['dKGM2rzKRjs']).replace('</feed>', ''), PLAYLIST)).toThrow(PlaylistFeedError);
    expect(() => parsePlaylistFeed(feed(['dKGM2rzKRjs', 'Other123456']).replace(/<\/entry>(?![\s\S]*<\/entry>)/, ''), PLAYLIST)).toThrow(PlaylistFeedError);
    expect(() => parsePlaylistFeed(feed(['dKGM2rzKRjs']).replace('<yt:videoId>dKGM2rzKRjs</yt:videoId>', ''), PLAYLIST)).toThrow(PlaylistFeedError);
  });
  it('fetches the public feed without a key and maps failures', async () => {
    let seen = '';
    const ok = (async (url: string | URL | Request, init?: RequestInit) => { seen = String(url); expect(init?.redirect).toBe('error'); return new Response(feed(['dKGM2rzKRjs']), { status: 200 }); }) as unknown as typeof fetch;
    expect(await fetchPlaylistFeed(PLAYLIST, ok)).toEqual({ videoIds: ['dKGM2rzKRjs'], entries: 1 });
    expect(seen).toBe('https://www.youtube.com/feeds/videos.xml?playlist_id=PLWDKpvlDapjQ');
    expect(await reason(fetchPlaylistFeed(PLAYLIST, respond('', { status: 404 })))).toBe('status');
    expect(await reason(fetchPlaylistFeed(PLAYLIST, respond('x', { headers: { 'content-length': '2000000' } })))).toBe('too-large');
    expect(await reason(fetchPlaylistFeed(PLAYLIST, respond('x'.repeat(1_000_001))))).toBe('too-large');
    expect(await reason(fetchPlaylistFeed(PLAYLIST, (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch))).toBe('request-failed');
    expect(await reason(fetchPlaylistFeed(PLAYLIST, respond('<html></html>')))).toBe('invalid-feed');
    expect(await reason(fetchPlaylistFeed('UUnotaplaylist', ok))).toBe('request-failed');
  });
});
