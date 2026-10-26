import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { ChannelAdminError, applyTagDelta, parsePayload, type ChannelAdminErrorCode, type ChannelAdminPayload } from '../../shared/channel-admin.js';
import { isRunStoppingYoutubeError } from './channel-jobs.js';
import { taipeiSql } from './legacy-db.js';
import { YoutubeError } from './quota.js';
import type { SourceJobContext } from './video-statistics.js';
import type { ChannelProfile } from './youtube.js';

type Db = SourceJobContext['db'];
type Outcome = Record<string, unknown>;
const utcSql = (date: Date) => date.toISOString().slice(0, 19).replace('T', ' ');
const live = '(del_flag IS NULL OR del_flag < 1)';

/** A stored result stays small: the column holds 2,000 characters and a cut-off JSON would be useless. */
const resultJson = (outcome: Outcome) => JSON.stringify(outcome).slice(0, 2000);
async function finish(db: Db, id: number, status: 'done' | 'failed', code: ChannelAdminErrorCode | null, outcome: Outcome | null, now: Date) {
  await db.execute("UPDATE ts_channel_admin_requests SET status = ?, error_code = ?, result = ?, applied_at = ? WHERE id = ? AND status = 'pending'", [status, code, outcome ? resultJson(outcome) : null, utcSql(now), id]);
}
/** Every tag a request adds must exist and not be retired; removing an unknown or retired one is harmless. */
async function assertTagsExist(db: Db, ids: number[]) {
  if (!ids.length) return;
  const [rows] = await db.query<RowDataPacket[]>(`SELECT tag_id FROM urt_tag WHERE tag_id IN (?) AND ${live}`, [ids]);
  if (rows.length !== new Set(ids).size) throw new ChannelAdminError('TAG_NOT_FOUND');
}
/** Same change the legacy `redir/tag.php` made: edit `urt_count.tags` and log each effective add or del in `urt_tag_log`. */
async function changeTags(ctx: SourceJobContext, uId: number, add: number[], remove: number[]) {
  const { db } = ctx, at = taipeiSql(ctx.now);
  await assertTagsExist(db, add);
  let [rows] = await db.query<RowDataPacket[]>('SELECT tags FROM urt_count WHERE u_id = ? FOR UPDATE', [uId]);
  if (!rows.length) { await db.execute('INSERT INTO urt_count (u_id, ctime) VALUES (?, ?)', [uId, at]); rows = [{ tags: null } as RowDataPacket]; }
  const before = rows[0]!.tags === null ? null : String(rows[0]!.tags), delta = applyTagDelta(before, add, remove);
  if (delta.changed) {
    await db.execute('UPDATE urt_count SET tags = ? WHERE u_id = ?', [delta.tags, uId]);
    for (const [ids, type] of [[delta.added, 'add'], [delta.removed, 'del']] as const) for (const id of ids) await db.execute('INSERT INTO urt_tag_log (ctime, u_id, tag_id, log_type) VALUES (?, ?, ?, ?)', [at, uId, id, type]);
  }
  return { uId, before, after: delta.tags, added: delta.added, removed: delta.removed };
}

async function setTags(ctx: SourceJobContext, id: number, payload: Extract<ChannelAdminPayload, { kind: 'set-tags' }>): Promise<Outcome> {
  const { db } = ctx;
  const [channel] = await db.query<RowDataPacket[]>('SELECT u_id FROM urt_channel WHERE u_id = ?', [payload.uId]);
  if (!channel.length) throw new ChannelAdminError('CHANNEL_NOT_FOUND');
  const outcome = await changeTags(ctx, payload.uId, payload.add, payload.remove);
  await finish(db, id, 'done', null, outcome, ctx.now);
  return outcome;
}

async function createTag(ctx: SourceJobContext, id: number, payload: Extract<ChannelAdminPayload, { kind: 'create-tag' }>): Promise<Outcome> {
  const { db } = ctx;
  const [same] = await db.query<RowDataPacket[]>(`SELECT tag_id FROM urt_tag WHERE tag_name = ? AND ${live} ORDER BY tag_id LIMIT 1`, [payload.name]);
  let outcome: Outcome;
  if (same.length) outcome = { tagId: Number(same[0]!.tag_id), name: payload.name, created: false };
  else {
    const [inserted] = await db.execute<ResultSetHeader>('INSERT INTO urt_tag (ctime, tag_name) VALUES (?, ?)', [taipeiSql(ctx.now), payload.name]);
    outcome = { tagId: inserted.insertId, name: payload.name, created: true };
  }
  await finish(db, id, 'done', null, outcome, ctx.now);
  return outcome;
}

/**
 * Insert the channel like the legacy `admin.php` did, from the exact YouTube profile, with no category. `stime` and `vtime`
 * stay empty, so the next statistics and discovery runs pick it up first. A channel we already track is only tagged.
 */
async function addChannel(ctx: SourceJobContext, id: number, payload: Extract<ChannelAdminPayload, { kind: 'add-channel' }>): Promise<Outcome> {
  const { db, youtube } = ctx;
  // A request for a category that does not exist is refused before it spends any YouTube quota.
  await assertTagsExist(db, payload.tags);
  let youtubeId = payload.source;
  if (youtubeId.startsWith('@')) {
    const resolved = await youtube.channelIdForHandle(youtubeId);
    if (!resolved) throw new ChannelAdminError('CHANNEL_NOT_FOUND');
    youtubeId = resolved;
  }
  const [existing] = await db.query<RowDataPacket[]>('SELECT u_id, flag_del, title FROM urt_channel WHERE youtube_id = ? AND BINARY youtube_id = BINARY ? LIMIT 2', [youtubeId, youtubeId]);
  if (existing.length > 1) throw new ChannelAdminError('APPLY_FAILED');
  let profile: ChannelProfile | undefined;
  if (existing[0]) { if (existing[0].flag_del !== null && Number(existing[0].flag_del) >= 1) throw new ChannelAdminError('CHANNEL_RETIRED'); }
  else { profile = (await youtube.channelProfiles([youtubeId])).get(youtubeId); if (!profile) throw new ChannelAdminError('CHANNEL_NOT_FOUND'); }
  await ctx.assertOwnership();
  const at = taipeiSql(ctx.now);
  let uId = Number(existing[0]?.u_id ?? 0), title = String(existing[0]?.title ?? '');
  if (profile) {
    const stats = profile.statistics;
    const [channel] = await db.execute<ResultSetHeader>('INSERT INTO urt_channel (ctime, mtime, youtube_id, title, description, publishedAt, thumbnails, uploads, viewCount, subscriberCount, videoCount) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [at, at, profile.id, profile.title, profile.description, taipeiSql(new Date(profile.publishedAt)), profile.thumbnail, profile.uploads, stats.viewCount, stats.subscriberCount, stats.videoCount]);
    uId = channel.insertId; title = profile.title;
    await db.execute('INSERT INTO urt_count (u_id, ctime, mtime, viewCount, subscriberCount, videoCount) VALUES (?, ?, ?, ?, ?, ?)', [uId, at, at, stats.viewCount, stats.subscriberCount, stats.videoCount]);
  }
  const tagged = payload.tags.length ? await changeTags(ctx, uId, payload.tags, []) : null;
  const outcome = { uId, youtubeId, title: title.slice(0, 100), created: Boolean(profile), tags: tagged?.after ?? null };
  await finish(db, id, 'done', null, outcome, ctx.now);
  return outcome;
}

const errorCode = (error: unknown): ChannelAdminErrorCode =>
  error instanceof ChannelAdminError ? error.code : error instanceof YoutubeError ? (error.code === 'invalid-response' ? 'CHANNEL_NOT_FOUND' : 'PROVIDER_ERROR') : 'APPLY_FAILED';

/**
 * Apply the administrators' pending requests, oldest first, each in its own transaction together with its status row, so a
 * request is either fully applied and marked done or untouched. A refused request is marked failed with a reason code and
 * never retried; a quota or credential stop leaves the rest pending for the next run.
 */
export async function channelAdminJob(ctx: SourceJobContext, input: { limit: number }) {
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 50) throw new Error('Invalid source workflow cap');
  const [rows] = await ctx.db.query<RowDataPacket[]>("SELECT id, kind, payload FROM ts_channel_admin_requests WHERE status = 'pending' ORDER BY id LIMIT ?", [input.limit]);
  const applied: { id: number; kind: string; outcome: Outcome }[] = [], rejected: { id: number; kind: string; code: ChannelAdminErrorCode }[] = [], skipped: { id: number; reason: string }[] = [];
  const summary = () => ({ mode: 'execute' as const, selected: rows.length, apiAttempts: ctx.youtube.attemptsMade, applied, rejected, skipped });
  if (!ctx.execute) return { mode: 'dry-run' as const, selected: rows.length, apiAttempts: 0, applied, rejected, skipped };
  for (const row of rows) {
    await ctx.assertOwnership();
    const id = Number(row.id), kind = String(row.kind);
    let payload: ChannelAdminPayload | null = null;
    try { payload = parsePayload(kind, JSON.parse(String(row.payload))); } catch { /* malformed: refused below */ }
    if (!payload) { await finish(ctx.db, id, 'failed', 'INVALID_REQUEST', null, ctx.now); rejected.push({ id, kind, code: 'INVALID_REQUEST' }); continue; }
    try {
      await ctx.db.beginTransaction();
      let outcome: Outcome;
      try {
        outcome = payload.kind === 'set-tags' ? await setTags(ctx, id, payload) : payload.kind === 'create-tag' ? await createTag(ctx, id, payload) : await addChannel(ctx, id, payload);
        await ctx.db.commit();
      } catch (error) { await ctx.db.rollback().catch(() => undefined); throw error; }
      applied.push({ id, kind, outcome });
    } catch (error) {
      if (isRunStoppingYoutubeError(error)) return { ...summary(), stoppedReason: error.code, remaining: rows.length - applied.length - rejected.length };
      const code = errorCode(error);
      await ctx.assertOwnership();
      await finish(ctx.db, id, 'failed', code, null, ctx.now);
      rejected.push({ id, kind, code });
      if (code === 'APPLY_FAILED') skipped.push({ id, reason: 'apply-failed' });
    }
  }
  return summary();
}
