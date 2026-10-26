/**
 * Administrator edits of the channel list: add a channel, change its category tags, create a category.
 * The web only appends a request row (ts_channel_admin_requests); the youtube-source worker applies it to the source
 * tables, so the public web never holds a source-table write grant. This module is the contract both sides share.
 */
export const CHANNEL_ADMIN_JOB = 'youtube.channels.admin';
export const CHANNEL_ADMIN_COMMAND = 'youtube:channels:admin';
export const CHANNEL_ADMIN_KINDS = ['add-channel', 'set-tags', 'create-tag'] as const;
export type ChannelAdminKind = typeof CHANNEL_ADMIN_KINDS[number];
export type ChannelAdminStatus = 'pending' | 'done' | 'failed';

/** `urt_count.tags` is VARCHAR(100): markers like `[12]` are appended, so a channel holds about twenty tags. */
export const CHANNEL_TAGS_MAX_LENGTH = 100;
export const TAG_NAME_MAX_LENGTH = 32;
export const TAG_IDS_PER_REQUEST_MAX = 20;
export const YOUTUBE_CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;
export const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type ChannelAdminPayload =
  | { kind: 'add-channel'; source: string; tags: number[] }
  | { kind: 'set-tags'; uId: number; add: number[]; remove: number[] }
  | { kind: 'create-tag'; name: string };

/** Stable error codes written to the request row and shown to the administrator. */
export const CHANNEL_ADMIN_ERRORS = {
  INVALID_REQUEST: '請求內容不正確',
  CHANNEL_NOT_FOUND: '找不到這個頻道',
  CHANNEL_RETIRED: '這個頻道已封存',
  TAG_NOT_FOUND: '有分類編號不存在',
  TAGS_TOO_LONG: '這個頻道的分類已滿（上限約 20 個）',
  PROVIDER_ERROR: 'YouTube 回應異常，稍後再試',
  APPLY_FAILED: '套用時發生錯誤',
} as const;
export type ChannelAdminErrorCode = keyof typeof CHANNEL_ADMIN_ERRORS;
export class ChannelAdminError extends Error {
  constructor(readonly code: ChannelAdminErrorCode) { super(code); this.name = 'ChannelAdminError'; }
}

const marker = (id: number) => `[${id}]`;
/** Tag ids in stored order; anything that is not a `[digits]` marker is ignored, as the legacy matching does. */
export function parseTags(raw: string | null | undefined): number[] {
  const ids: number[] = [];
  for (const match of String(raw ?? '').matchAll(/\[(\d+)\]/g)) { const id = Number(match[1]); if (Number.isSafeInteger(id) && !ids.includes(id)) ids.push(id); }
  return ids;
}
export const tagIdList = (value: unknown, max = TAG_IDS_PER_REQUEST_MAX): number[] | null => {
  if (!Array.isArray(value) || value.length > max) return null;
  const ids: number[] = [];
  for (const item of value) { if (typeof item !== 'number' || !Number.isSafeInteger(item) || item < 1 || item > 2147483647) return null; if (!ids.includes(item)) ids.push(item); }
  return ids;
};
/**
 * Legacy redir/tag.php semantics: an added tag is appended as `[id]`, a removed one is cut out of the string, and a
 * channel left with none keeps an empty string (not NULL). Only tags that really change are reported, because only those
 * get an urt_tag_log row. The result must fit the column or the whole change is refused.
 */
export function applyTagDelta(current: string | null | undefined, add: number[], remove: number[]) {
  let tags = String(current ?? '');
  const added: number[] = [], removed: number[] = [];
  for (const id of remove) if (tags.includes(marker(id))) { tags = tags.split(marker(id)).join(''); removed.push(id); }
  for (const id of add) if (!tags.includes(marker(id)) && !removed.includes(id)) { tags += marker(id); added.push(id); }
  if (tags.length > CHANNEL_TAGS_MAX_LENGTH) throw new ChannelAdminError('TAGS_TOO_LONG');
  return { tags, added, removed, changed: added.length + removed.length > 0 };
}

export const normalizeTagName = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const name = value.normalize('NFC').replace(/\s+/g, ' ').trim();
  return name && [...name].length <= TAG_NAME_MAX_LENGTH && !/[\u0000-\u001f\u007f]/.test(name) ? name : null;
};

/**
 * What the administrator pasted: a channel id, a /channel/ URL or an @handle (bare or in a URL). /user/ and /c/ URLs
 * cannot be resolved without a search request, so they are refused with the reason instead of guessed.
 */
export function parseChannelSource(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const text = input.trim();
  if (!text || text.length > 300) return null;
  if (YOUTUBE_CHANNEL_ID.test(text)) return text;
  const handle = (value: string) => { const name = decodeURIComponent(value.replace(/^@/, '')); return /^[\p{L}\p{N}._-]{3,30}$/u.test(name) ? '@' + name : null; };
  try {
    if (text.startsWith('@')) return handle(text);
    const url = new URL(/^https?:\/\//i.test(text) ? text : 'https://' + text);
    if (!['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(url.hostname.toLowerCase()) || url.username || url.password) return null;
    const first = url.pathname.split('/').filter(Boolean)[0] ?? '', second = url.pathname.split('/').filter(Boolean)[1] ?? '';
    if (first === 'channel') return YOUTUBE_CHANNEL_ID.test(second) ? second : null;
    if (first.startsWith('@')) return handle(first);
  } catch { /* not a URL */ }
  return null;
}

/** Strict parse of a stored or incoming payload; null means malformed. */
export function parsePayload(kind: unknown, value: unknown): ChannelAdminPayload | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (kind === 'add-channel') {
    const source = parseChannelSource(body.source), tags = body.tags === undefined ? [] : tagIdList(body.tags);
    return source && tags ? { kind, source, tags } : null;
  }
  if (kind === 'set-tags') {
    const add = body.add === undefined ? [] : tagIdList(body.add), remove = body.remove === undefined ? [] : tagIdList(body.remove);
    const uId = body.uId;
    if (typeof uId !== 'number' || !Number.isSafeInteger(uId) || uId < 1 || !add || !remove || add.length + remove.length === 0 || add.some(id => remove.includes(id))) return null;
    return { kind, uId, add, remove };
  }
  if (kind === 'create-tag') { const name = normalizeTagName(body.name); return name ? { kind, name } : null; }
  return null;
}

/** One row of the administrator's request history. */
export interface ChannelAdminRequest {
  id: number;
  requestId: string;
  kind: ChannelAdminKind;
  actor: string;
  payload: ChannelAdminPayload;
  status: ChannelAdminStatus;
  errorCode: ChannelAdminErrorCode | null;
  result: Record<string, unknown> | null;
  createdAt: string;
  appliedAt: string | null;
}
export interface ChannelAdminRequestList { requests: ChannelAdminRequest[]; generatedAt: string }
export interface ChannelAdminAccepted { requestId: string; status: 'pending' }
