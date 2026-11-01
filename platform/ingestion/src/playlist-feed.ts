import { workflowShutdownSignal } from '../../shared/shutdown.js';

/** YouTube serves at most this many entries in a playlist feed; a full feed may be cut off. */
export const PLAYLIST_FEED_CAP = 15;
const MAX_BYTES = 1_000_000;

export class PlaylistFeedError extends Error {
  constructor(readonly reason: 'request-failed' | 'status' | 'too-large' | 'invalid-feed') { super(`Playlist feed ${reason}`); }
}

export interface PlaylistFeed { videoIds: string[]; entries: number }
/**
 * Video ids of a playlist's Atom feed, in feed order, and the raw entry count (duplicates included, so a full feed is still
 * recognised as possibly cut off). The document must be one complete Atom feed naming this playlist before its first entry,
 * and every entry must carry exactly one well-formed video id, so an error page or a damaged feed is never read as a shorter list.
 */
export function parsePlaylistFeed(xml: string, playlistId: string): PlaylistFeed {
  const body = /^\s*(?:<\?xml[^>]*\?>\s*)?<feed(?:\s[^>]*)?>([\s\S]*)<\/feed>\s*$/.exec(xml)?.[1];
  if (body === undefined) throw new PlaylistFeedError('invalid-feed');
  const opens = body.match(/<entry(?:\s[^>]*)?>/g) ?? [], closes = body.match(/<\/entry>/g) ?? [];
  const head = body.split(/<entry(?:\s[^>]*)?>/)[0]!;
  if (opens.length !== closes.length || !head.includes(`<yt:playlistId>${playlistId}</yt:playlistId>`)) throw new PlaylistFeedError('invalid-feed');
  const ids: string[] = [];
  for (const [, entry] of body.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/g)) {
    const found = [...entry!.matchAll(/<yt:videoId>([^<]*)<\/yt:videoId>/g)], videoId = found[0]?.[1]?.trim() ?? '';
    if (found.length !== 1 || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) throw new PlaylistFeedError('invalid-feed');
    if (!ids.includes(videoId)) ids.push(videoId);
  }
  return { videoIds: ids, entries: opens.length };
}

/** https://www.youtube.com/feeds/videos.xml?playlist_id=… — public, no API key and no quota. */
export async function fetchPlaylistFeed(playlistId: string, fetcher: typeof fetch = fetch, timeoutMs = 10000): Promise<PlaylistFeed> {
  if (!/^PL[A-Za-z0-9_-]{10,64}$/.test(playlistId)) throw new PlaylistFeedError('request-failed');
  const url = 'https://www.youtube.com/feeds/videos.xml?' + new URLSearchParams({ playlist_id: playlistId });
  let text: string;
  try {
    const response = await fetcher(url, { redirect: 'error', signal: AbortSignal.any([AbortSignal.timeout(timeoutMs), workflowShutdownSignal()]), headers: { 'User-Agent': 'YouTubeBoard/TypeScript (https://youtube.observe.tw)', Accept: 'application/atom+xml, application/xml, text/xml' } });
    if (response.status !== 200) { await response.body?.cancel().catch(() => undefined); throw new PlaylistFeedError('status'); }
    if (Number(response.headers.get('content-length') ?? 0) > MAX_BYTES) { await response.body?.cancel().catch(() => undefined); throw new PlaylistFeedError('too-large'); }
    text = await response.text();
  } catch (error) {
    workflowShutdownSignal().throwIfAborted();
    if (error instanceof PlaylistFeedError) throw error;
    throw new PlaylistFeedError('request-failed');
  }
  if (Buffer.byteLength(text) > MAX_BYTES) throw new PlaylistFeedError('too-large');
  return parsePlaylistFeed(text, playlistId);
}
