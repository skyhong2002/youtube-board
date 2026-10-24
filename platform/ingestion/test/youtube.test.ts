import { it, expect, vi } from 'vitest';
import { YoutubeDataApiClient, durationToSeconds, rfc3339, unsigned } from '../src/youtube.js';
import { assertQuotaWindow, pacificDate } from '../src/quota.js';
const now = () => new Date('2026-10-12T02:00:00Z');
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
function client(...responses: (Response | Error)[]) {
  const fetcher = vi.fn(); responses.forEach(r => r instanceof Error ? fetcher.mockRejectedValueOnce(r) : fetcher.mockResolvedValueOnce(r));
  const ledger = { precharge: vi.fn().mockResolvedValue('2026-10-11'), markDailyExhausted: vi.fn() };
  const audit = vi.fn(); const api = new YoutubeDataApiClient({ keys: ['unit-key-a', 'unit-key-b'], ledger, fetcher, now, sleep: async () => {}, audit });
  return { api, ledger, fetcher, audit };
}
it('precharges every transient retry and key fallback, while omitting secrets from telemetry', async () => {
  const { api, ledger, audit } = client(new Error('connection failed unit-key-a'), response({ error: { errors: [{ reason: 'keyExpired' }] } }, 403), response({ items: [{ id: 'Abc12345678', statistics: { viewCount: '12' } }] }));
  expect((await api.videoStatistics(['Abc12345678'])).get('Abc12345678')?.viewCount).toBe(12);
  expect(ledger.precharge).toHaveBeenCalledTimes(3); expect(audit).toHaveBeenCalledTimes(3);
  expect(JSON.stringify(audit.mock.calls)).not.toContain('unit-key'); expect(ledger.markDailyExhausted).not.toHaveBeenCalled();
});
it('only daily exhaustion of every key trips the shared Pacific-day breaker', async () => {
  const daily = () => response({ error: { errors: [{ reason: 'quotaExceeded' }] } }, 403);
  const all = client(daily(), daily()); await expect(all.api.channelPresence(['UCtest'])).rejects.toMatchObject({ code: 'quota-daily' }); expect(all.ledger.markDailyExhausted).toHaveBeenCalledWith('2026-10-11');
  const rate = client(daily(), response({ error: { errors: [{ reason: 'rateLimitExceeded' }] } }, 429));
  await expect(rate.api.channelPresence(['UCtest'])).rejects.toMatchObject({ code: 'rate-limit' }); expect(rate.ledger.markDailyExhausted).not.toHaveBeenCalled();
  const auth = client(daily(), response({ error: { errors: [{ reason: 'keyInvalid' }], message: 'bad unit-key-b' } }, 400));
  await expect(auth.api.channelPresence(['UCtest'])).rejects.toThrow('authentication'); expect(auth.ledger.markDailyExhausted).not.toHaveBeenCalled();
});
it('fails before network when quota is denied or too near Pacific midnight', async () => {
  const fetcher = vi.fn(), ledger = { precharge: vi.fn().mockRejectedValue(new Error('denied')), markDailyExhausted: vi.fn() };
  const api = new YoutubeDataApiClient({ keys: ['unit-key'], ledger, fetcher, now });
  await expect(api.videoStatistics(['Abc12345678'])).rejects.toThrow('denied'); expect(fetcher).not.toHaveBeenCalled();
  expect(() => assertQuotaWindow(new Date('2026-10-12T06:59:50Z'), 15000)).toThrow('quota-window');
  expect(pacificDate(new Date('2026-01-01T07:59:59Z'))).toBe('2025-12-31');
  expect(pacificDate(new Date('2026-07-01T07:00:00Z'))).toBe('2026-07-01');
  expect(() => assertQuotaWindow(new Date('2026-10-12T07:00:00Z'), 15000, '2026-10-11')).toThrow('quota-window');
});
it('keeps omitted counts unknown and rejects malformed counts without conflating case-sensitive ids', async () => {
  const { api } = client(response({ items: [{ id: 'Abc12345678', statistics: { viewCount: '123', commentCount: '0' } }, { id: 'abc12345678', statistics: { viewCount: '-1' } }] }));
  const result = await api.videoStatistics(['Abc12345678', 'abc12345678']);
  expect(result.get('Abc12345678')).toEqual({ viewCount: 123, likeCount: null, dislikeCount: 0, favoriteCount: null, commentCount: 0 }); expect(result.has('abc12345678')).toBe(false);
  expect(unsigned('9007199254740992')).toBeNull(); expect(unsigned(true)).toBeNull();
});
it('honors hidden subscribers without replacing them by zero and presence rejects malformed retirement evidence', async () => {
  const { api } = client(response({ items: [{ id: 'UCtest', statistics: { viewCount: '20', videoCount: '2', hiddenSubscriberCount: true } }] }));
  expect((await api.channelStatistics(['UCtest'])).get('UCtest')?.subscriberCount).toBeNull();
  await expect(client(response({ items: [null] })).api.channelPresence(['UCtest'])).rejects.toMatchObject({ code: 'invalid-response' });
});
it('channel statistics carry the current name and yt3 avatar, dropping malformed snippet fields without losing counts', async () => {
  const statistics = { viewCount: '20', videoCount: '2', subscriberCount: '5' };
  const { api } = client(response({ items: [
    { id: 'UCrenamed', snippet: { title: ' 沈伯洋Puma ', thumbnails: { default: { url: 'https://yt3.ggpht.com/abc=s88-c-k' } } }, statistics },
    { id: 'UCforeign', snippet: { title: '', thumbnails: { default: { url: 'https://evil.example/a.png' } } }, statistics },
    { id: 'UCbare', statistics },
  ] }));
  const result = await api.channelStatistics(['UCrenamed', 'UCforeign', 'UCbare']);
  expect(result.get('UCrenamed')).toMatchObject({ viewCount: 20, title: '沈伯洋Puma', thumbnail: 'https://yt3.ggpht.com/abc=s88-c-k' });
  for (const id of ['UCforeign', 'UCbare']) { expect(result.get(id)).toMatchObject({ viewCount: 20 }); expect(result.get(id)).not.toHaveProperty('title'); expect(result.get(id)).not.toHaveProperty('thumbnail'); }
});
it('distinguishes malformed live details from a genuinely absent/non-live API item', async () => {
  const { api } = client(response({ items: [{ id: 'Abc12345678', liveStreamingDetails: { concurrentViewers: '-1' } }, { id: 'abc12345678' }] }));
  const result = await api.videoLiveStreamingDetails(['Abc12345678', 'abc12345678', 'Missing1234']);
  expect(result.has('Abc12345678')).toBe(true); expect(result.get('Abc12345678')).toBeNull(); expect(result.has('abc12345678')).toBe(false); expect(result.has('Missing1234')).toBe(false);
  await expect(client(response({ items: [null] })).api.videoLiveStreamingDetails(['Abc12345678'])).rejects.toMatchObject({ code: 'invalid-response' });
});
it('validates paginated playlist metadata and preserves continuation', async () => {
  const item = { id: 'playlist-item', snippet: { resourceId: { videoId: 'Abc12345678' }, publishedAt: '2026-10-11T01:00:00Z', channelId: 'UCtest', title: '台灣', description: '', thumbnails: { default: { url: 'https://i.ytimg.com/a.jpg' } }, channelTitle: '新聞', playlistId: 'UUtest', position: 0 } };
  const { api, fetcher } = client(response({ items: [item], nextPageToken: 'next' }));
  expect((await api.playlistItemsPage('UUtest', 'first', 50)).nextPageToken).toBe('next'); expect(new URL(fetcher.mock.calls[0]![0]).searchParams.get('pageToken')).toBe('first');
  await expect(client(response({ items: [{ ...item, snippet: { ...item.snippet, description: undefined } }] })).api.playlistItemsPage('UUtest')).rejects.toMatchObject({ code: 'invalid-response' });
});
it('supports duration and both comment APIs, rejecting impossible timestamps', async () => {
  expect(durationToSeconds('P1DT2H3M4S')).toBe(93784); expect(() => durationToSeconds('P')).toThrow(); expect(rfc3339('2026-02-31T00:00:00Z')).toBe(false);
  const { api } = client(response({ items: [{ id: 'Abc12345678', contentDetails: { duration: 'PT20S', caption: 'true' } }] }), response({ items: [{ id: 'thread' }], nextPageToken: 'more' }), response({ items: [{ id: 'reply' }] }));
  expect((await api.videoContentDetails(['Abc12345678'])).get('Abc12345678')?.durationSeconds).toBe(20);
  expect((await api.commentThreads('Abc12345678')).nextPageToken).toBe('more'); expect((await api.comments('parent')).items[0]?.id).toBe('reply');
});
it('requires a bounded total attempt cap, deduplicates keys and never exposes upstream error strings', async () => {
  const { api, ledger } = client(response({ error: { message: 'unit-key-a https://secret.example/?key=unit-key-b' } }, 404));
  await expect(api.videoStatistics(['Abc12345678'])).rejects.toThrow('YouTube request-failed (HTTP 404)'); expect(ledger.precharge).toHaveBeenCalledTimes(1);
  expect(() => new YoutubeDataApiClient({ keys: [], ledger, maxAttempts: NaN })).toThrow();
});
it('retries interrupted successful response bodies with another precharge and audits malformed JSON', async () => {
  const interrupted = new Response(new ReadableStream({ start(controller) { controller.error(new Error('socket interrupted')); } }));
  const { api, ledger, audit } = client(interrupted, response({ items: [{ id: 'UCtest' }] }));
  expect(await api.channelPresence(['UCtest'])).toEqual(['UCtest']); expect(ledger.precharge).toHaveBeenCalledTimes(2); expect(audit.mock.calls[0]?.[0]?.failure).toBe('transient');
  const malformed = client(response({})); await expect(malformed.api.channelPresence(['UCtest'])).rejects.toThrow('invalid-response'); expect(malformed.audit).toHaveBeenCalledWith(expect.objectContaining({ failure: 'invalid-response', units: 1 }));
});
it('isolates a malformed duration and retains valid videos in the same batch', async () => {
  const { api } = client(response({ items: [{ id: 'Abc12345678', contentDetails: { duration: '' } }, { id: 'abc12345678', contentDetails: { duration: 'PT10S' } }] }));
  const results = await api.videoContentDetails(['Abc12345678', 'abc12345678']); expect(results.has('Abc12345678')).toBe(false); expect(results.get('abc12345678')?.durationSeconds).toBe(10);
});
it('retains a conservative precharge if the clock crosses the safe window before dispatch, with no HTTP call', async () => {
  const ledger = { precharge: vi.fn().mockResolvedValue('2026-10-11'), markDailyExhausted: vi.fn() }, fetcher = vi.fn();
  const api = new YoutubeDataApiClient({ keys: ['fake-key'], ledger, fetcher, now: () => new Date('2026-10-12T07:00:00Z') });
  await expect(api.channelPresence(['UCtest'])).rejects.toMatchObject({ code: 'quota-window' }); expect(ledger.precharge).toHaveBeenCalledOnce(); expect(fetcher).not.toHaveBeenCalled();
});
it('pins a run to its first Pacific quota day and stops before another charge after midnight', async () => {
  let time = new Date('2026-10-12T02:00:00Z');
  const fetcher = vi.fn().mockImplementation(async () => response({ items: [{ id: 'UCtest' }] }));
  const ledger = { precharge: vi.fn().mockResolvedValue('2026-10-11'), markDailyExhausted: vi.fn() };
  const api = new YoutubeDataApiClient({ keys: ['fake-key'], ledger, fetcher, now: () => time });
  await api.channelPresence(['UCtest']);
  time = new Date('2026-10-12T20:00:00Z');
  await expect(api.channelPresence(['UCtest'])).rejects.toMatchObject({ code: 'quota-window' });
  expect(ledger.precharge).toHaveBeenCalledTimes(1); expect(fetcher).toHaveBeenCalledTimes(1);
});
it('a failed durable breaker write preserves quota-daily and prevents another request on the exhausted client',async()=>{
  let calls=0;
  const api=new YoutubeDataApiClient({keys:['fake'],ledger:{precharge:async()=>'2026-10-11',markDailyExhausted:async()=>{throw new Error('database unavailable');}},now:()=>new Date('2026-10-12T02:00:00Z'),fetcher:async()=>{calls++;return new Response(JSON.stringify({error:{errors:[{reason:'quotaExceeded'}]}}),{status:403});}});
  await expect(api.channelPresence(['UCtest'])).rejects.toMatchObject({code:'quota-daily'});
  await expect(api.channelPresence(['UCtest'])).rejects.toMatchObject({code:'quota-exhausted'});
  expect(calls).toBe(1);
});
