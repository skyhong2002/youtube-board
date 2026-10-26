import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * YouTube pushes "new or changed video" notices through the public WebSub hub, so a channel that
 * uploads or schedules a live stream between two discovery sweeps is noticed within minutes instead
 * of waiting for its `urt_channel.vtime`. The hub is not the YouTube Data API: subscribing and
 * receiving cost no quota.
 *
 * The receiver (api/src/websub.ts) and the sync job (jobs/src/websub-cli.ts) share only a secret
 * (`WEBSUB_SECRET`) and a private Redis. Everything the receiver must check is derived from that
 * secret and the channel id, so it never reads the database.
 */
export const WEBSUB_HUB_URL = 'https://pubsubhubbub.appspot.com/subscribe';
export const WEBSUB_JOB = 'youtube.websub.sync';
export const WEBSUB_COMMAND = 'youtube:websub:sync';
export const WEBSUB_CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;
export const WEBSUB_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
/** YouTube grants five days whatever is asked; ask for it explicitly. */
export const WEBSUB_LEASE_SECONDS = 432000;
export const WEBSUB_MAX_LEASE_SECONDS = 30 * 86400;
/** `urt_channel.vtime` ahead of every real due time: the next general discovery sweep reads this channel first. */
export const WEBSUB_PRIORITY_VTIME = '2000-01-01 00:00:00';
export const WEBSUB_EVENT_CAP = 10000;
export const websubKeys = Object.freeze({
  /** List of `<channelId>:<videoId>` pushed by the receiver, drained by the job. */
  events: 'yt-ts:websub:events',
  /** Hash channelId -> lease expiry (epoch ms), written only by the receiver once the hub verified a subscription. */
  leases: 'yt-ts:websub:leases',
  /** Hash channelId -> epoch ms before which the job does not ask the hub again. */
  retry: 'yt-ts:websub:retry',
  /** Hash videoId -> `<channelId>|<firstSeenMs>|<lastBumpMs>|<bumps>`: notified videos not yet stored, re-checked for a while. */
  watch: 'yt-ts:websub:watch',
  /** Counters for operators: received, rejected, drained, bumped, ignored, rebumped, resolved, expired, subscribe_accepted, subscribe_failed. */
  stats: 'yt-ts:websub:stats',
});

export const websubTopic = (channelId: string) => `https://www.youtube.com/xml/feeds/videos.xml?channel_id=${channelId}`;
const derive = (secret: string, purpose: string, channelId: string) => createHmac('sha256', secret).update(`${purpose}\n${channelId}`).digest('hex');
/** Path token of a channel's callback URL; the hub only ever learns the URL we gave it. */
export const callbackToken = (secret: string, channelId: string) => derive(secret, 'callback', channelId).slice(0, 32);
/** `hub.secret` for one channel; the hub signs every notification body with it. */
export const hubSecret = (secret: string, channelId: string) => derive(secret, 'signature', channelId);
export const callbackUrl = (origin: string, secret: string, channelId: string) => `${origin}/websub/youtube/${channelId}/${callbackToken(secret, channelId)}`;

export function safeEqual(a: string, b: string) {
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
const SIGNATURE_ALGORITHMS: Readonly<Record<string, string>> = Object.freeze({ sha1: 'sha1', sha256: 'sha256', sha384: 'sha384', sha512: 'sha512' });
/** `X-Hub-Signature: <algorithm>=<hex>` over the exact request bytes (YouTube's hub uses sha1). */
export function verifyHubSignature(secret: string, channelId: string, body: Buffer, header: unknown) {
  if (typeof header !== 'string') return false;
  const match = /^([a-z0-9]+)=([0-9a-f]+)$/i.exec(header.trim());
  const algorithm = match ? SIGNATURE_ALGORITHMS[match[1]!.toLowerCase()] : undefined;
  if (!match || !algorithm) return false;
  return safeEqual(match[2]!.toLowerCase(), createHmac(algorithm, hubSecret(secret, channelId)).update(body).digest('hex'));
}

export interface WebsubEntry { channelId: string; videoId: string }
/**
 * Atom entries of one notification. Deliberately a pattern match, not an XML parser: the body is
 * attacker-influenced until its signature is checked, and only two fixed-shape ids are wanted.
 * Deleted-entry tombstones (`<at:deleted-entry>`) carry no `<entry>` and so yield nothing.
 */
export function parseNotification(xml: string, limit = 20): WebsubEntry[] {
  const entries: WebsubEntry[] = [];
  for (const block of xml.matchAll(/<entry[\s>][\s\S]*?<\/entry>/g)) {
    const videoId = /<yt:videoId>([A-Za-z0-9_-]{11})<\/yt:videoId>/.exec(block[0])?.[1];
    const channelId = /<yt:channelId>(UC[A-Za-z0-9_-]{22})<\/yt:channelId>/.exec(block[0])?.[1];
    if (videoId && channelId) entries.push({ channelId, videoId });
    if (entries.length >= limit) break;
  }
  return entries;
}
export const encodeEvent = (entry: WebsubEntry) => `${entry.channelId}:${entry.videoId}`;
export function decodeEvent(value: string): WebsubEntry | null {
  const [channelId, videoId, ...rest] = value.split(':');
  return rest.length === 0 && channelId && videoId && WEBSUB_CHANNEL_ID.test(channelId) && WEBSUB_VIDEO_ID.test(videoId) ? { channelId, videoId } : null;
}
/** The shared secret: required for both halves, long enough to derive tokens from. */
export function websubSecret(env: NodeJS.ProcessEnv): string | null {
  return env.TS_WEBSUB_ENABLED === 'true' && typeof env.WEBSUB_SECRET === 'string' && env.WEBSUB_SECRET.length >= 32 ? env.WEBSUB_SECRET : null;
}
