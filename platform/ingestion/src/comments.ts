import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { cap, channelId } from './channel-jobs.js';
import { clearItemBackoff, recordItemBackoff } from './backoff.js';
import { selectOne, taipeiSql, upsert, update } from './legacy-db.js';
import { record, rfc3339, unsigned, type Json, type Page } from './youtube.js';
import type { SourceJobContext } from './video-statistics.js';
import { isYoutubeItemFailure, YoutubeError } from './quota.js';
import { randomUUID } from 'node:crypto';

interface Comment { textDisplay: string; textOriginal: string; authorChannelId: string; publishedAt: string; updatedAt: string; likeCount: number; replies?: Record<string, Comment> }
interface Author { DisplayName: string; ImageUrl: string; ChannelUrl: string | null }
interface State {
  version: 1; videoId: string; channelId: string; uId: number; token: string | null;
  page: Page<Json> | null; index: number; seen: string[];
  reply: { key: string; parentId: string; token: string | null; seen: string[] } | null;
  comments: Record<string, Comment>; authors: Record<string, Author>; complete: boolean;
}
function key(value: unknown, max = 128): string {
  if (typeof value !== 'string' || !value || value.length > max || !(max <= 32 ? /^[A-Za-z0-9_-]+$/ : /^[A-Za-z0-9_.-]+$/).test(value) || Object.hasOwn(Object.prototype, value)) throw new Error('Malformed comment identity');
  return value;
}
function text(value: unknown, max: number, optional = false): string {
  if (optional && value == null) return '';
  if (typeof value !== 'string' || value.length > max || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) throw new Error('Malformed comment text'); return value;
}
function snippet(value: unknown, state: State): Comment {
  // Laravel mapCommentSnippet() counts a missing likeCount as 0.
  const likeCount = !record(value) ? null : value.likeCount === undefined ? 0 : unsigned(value.likeCount);
  if (!record(value) || !rfc3339(value.publishedAt) || !rfc3339(value.updatedAt) || likeCount === null) throw new Error('Malformed comment snippet');
  const authorId = record(value.authorChannelId) ? key(value.authorChannelId.value, 32) : '';
  // Laravel addAuthor(): the first occurrence of an author wins; a missing channel URL stays NULL.
  if (authorId && !Object.hasOwn(state.authors, authorId)) state.authors[authorId] = { DisplayName: text(value.authorDisplayName, 512, true), ImageUrl: text(value.authorProfileImageUrl, 512, true), ChannelUrl: value.authorChannelUrl === undefined || value.authorChannelUrl === null ? null : text(value.authorChannelUrl, 256) };
  return { textDisplay: text(value.textDisplay, 100000), textOriginal: text(value.textOriginal, 100000, true), authorChannelId: authorId, publishedAt: value.publishedAt, updatedAt: value.updatedAt, likeCount };
}
function replyItem(item: Json, state: State, parentId: string): [string, Comment] {
  if (!record(item.snippet) || item.snippet.parentId !== parentId || (item.snippet.videoId !== undefined && item.snippet.videoId !== state.videoId)) throw new Error('Reply parent/video identity mismatch');
  return [key(item.id), snippet(item.snippet, state)];
}
function prepareThread(item: Json, state: State) {
  // A thread naming another channel is rejected; an omitted channelId is tolerated like Laravel.
  if (!record(item.snippet) || item.snippet.videoId !== state.videoId || (item.snippet.channelId !== undefined && item.snippet.channelId !== state.channelId) || !record(item.snippet.topLevelComment)) throw new Error('Comment thread source identity mismatch');
  const threadKey = key(item.id), parentId = key(item.snippet.topLevelComment.id), totalReplies = unsigned(item.snippet.totalReplyCount);
  if (totalReplies === null) throw new Error('Invalid thread reply count');
  const comment = snippet(item.snippet.topLevelComment.snippet, state); comment.replies = {};
  if (item.replies !== undefined && (!record(item.replies) || !Array.isArray(item.replies.comments))) throw new Error('Malformed embedded replies');
  const embedded = record(item.replies) ? item.replies.comments as unknown[] : [];
  for (const item of embedded) { if (!record(item)) throw new Error('Malformed embedded reply'); const [id, reply] = replyItem(item, state, parentId); comment.replies[id] = reply; }
  state.comments[threadKey] = comment;
  if (totalReplies > Object.keys(comment.replies).length) { comment.replies = {}; state.reply = { key: threadKey, parentId, token: null, seen: [] }; }
}
class CommentCapacityError extends Error {}
const capacities = new WeakMap<object, number>();
function encodeState(state: State, maxMiB = 12) {
  const json = JSON.stringify(state);
  if (Buffer.byteLength(json) > maxMiB * 1024 * 1024) throw new CommentCapacityError('comment-state-capacity-increase-max-state-mib');
  return json;
}
async function save(ctx: SourceJobContext, queuePk: number, state: State, status = 'scanning') {
  await ctx.assertOwnership();
  await ctx.db.execute('INSERT INTO ts_comment_stages (video_id,queue_pk,state_json,status,updated_at) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE queue_pk=VALUES(queue_pk), state_json=VALUES(state_json), status=VALUES(status), updated_at=VALUES(updated_at)', [state.videoId, queuePk, encodeState(state, capacities.get(ctx) ?? 12), status, taipeiSql(ctx.now)]);
}
function readState(raw: unknown, source: RowDataPacket): State {
  const state: unknown = JSON.parse(String(raw));
  if (!record(state) || state.version !== 1 || state.videoId !== source.videoId || state.channelId !== source.channelId || state.uId !== Number(source.u_id) || !record(state.comments) || !record(state.authors) || !Array.isArray(state.seen) || !Number.isSafeInteger(state.index) || typeof state.complete !== 'boolean' || (state.page !== null && (!record(state.page) || !Array.isArray(state.page.items))) || (state.reply !== null && !record(state.reply))) throw new Error('Invalid saved comment stage');
  // All persisted data originated in the validated writer; parse errors must not silently reset a partial crawl.
  return state as unknown as State;
}
export interface CommentQueueTags { tagIds?: number[]; orTagIds?: number[]; notTagIds?: number[] }
/** Laravel LegacyTagFilter::matchingChannelTags(): channels come from urt_count; every --tagid, any --or,
 * and none of --not must appear in urt_count.tags. Without filters every urt_count channel matches. */
export function commentQueueChannelFilter(input: CommentQueueTags): { sql: string; params: string[] } {
  const ids = (values: number[] | undefined) => { const list = [...new Set(values ?? [])]; if (list.length > 20) throw new Error('Too many taxonomy tags'); list.forEach(channelId); return list; };
  const all = ids(input.tagIds), any = ids(input.orTagIds), none = ids(input.notTagIds), clauses: string[] = [], params: string[] = [];
  if (any.length) { clauses.push('(' + any.map(() => 'n.tags LIKE ?').join(' OR ') + ')'); params.push(...any.map(tag => `%[${tag}]%`)); }
  for (const tag of all) { clauses.push('n.tags LIKE ?'); params.push(`%[${tag}]%`); }
  for (const tag of none) { clauses.push('n.tags NOT LIKE ?'); params.push(`%[${tag}]%`); }
  return { sql: `v.u_id IN (SELECT n.u_id FROM urt_count n${clauses.length ? ' WHERE ' + clauses.join(' AND ') : ''})`, params };
}
export async function commentQueueJob(ctx: SourceJobContext, input: { uId?: number; videoId?: string; limit: number; hours: number; min: number } & CommentQueueTags) {
  channelId(input.uId); cap(input.limit, ctx.execute?20:1000); cap(input.hours, 720); cap(input.min, 10000000, 0);
  // An explicit TS-only --videoId without taxonomy filters targets that video directly.
  const filtered = !input.videoId || [input.tagIds, input.orTagIds, input.notTagIds].some(list => list?.length);
  const channels = filtered ? commentQueueChannelFilter(input) : { sql: '1=1', params: [] };
  const clauses = [input.videoId ? 'BINARY v.videoId = BINARY ?' : 'v.publishedAt >= ? AND v.viewCount >= ? AND v.commentCount >= ?', channels.sql];
  const params: (string | number)[] = input.videoId ? [key(input.videoId, 32)] : [taipeiSql(new Date(ctx.now.getTime() - input.hours * 3600000)), input.min, input.min];
  params.push(...channels.params);
  if (input.uId) { clauses.push('v.u_id = ?'); params.push(input.uId); }
  clauses.push('NOT EXISTS (SELECT 1 FROM urt_comment_queue q WHERE BINARY q.videoId=BINARY v.videoId)', 'NOT EXISTS (SELECT 1 FROM urt_comment_queue_done d WHERE BINARY d.videoId=BINARY v.videoId)');
  // Laravel CommentQueuePreview orders candidates by publishedAt DESC, videoId.
  const [rows] = await ctx.db.query<RowDataPacket[]>(`SELECT v.videoId FROM urt_video v WHERE ${clauses.join(' AND ')} ORDER BY v.publishedAt DESC,v.videoId LIMIT ?`, [...params, input.limit + 1]);
  const applied: string[] = [], skipped: { videoId: string; reason: string }[] = [];
  if (ctx.execute) for (const row of rows.slice(0, input.limit)) {
    await ctx.assertOwnership();
    await upsert(ctx.db, 'urt_comment_queue', { videoId: row.videoId }, { ctime: taipeiSql(ctx.now) }); applied.push(row.videoId);
  }
  return { mode: ctx.execute ? 'execute' : 'dry-run', selected: Math.min(input.limit, rows.length), truncated: rows.length > input.limit, apiAttempts: 0, applied, skipped };
}
async function commentAuthor(ctx: SourceJobContext,id:string) { const[rows]=await ctx.db.query<RowDataPacket[]>('SELECT * FROM urt_comment_author WHERE BINARY ChannelId=BINARY ? ORDER BY author_id LIMIT 1',[id]);return rows[0]; }
/** Laravel finishQueueRow(): copy the queue row into done once, then delete it. */
async function finishQueue(ctx: SourceJobContext, queue: RowDataPacket, at: string) {
  const done = await selectOne(ctx.db,'urt_comment_queue_done',{pk:queue.pk});
  if (done && done.videoId !== queue.videoId) throw new Error('Queue completion identity collision');
  if (!done) await upsert(ctx.db, 'urt_comment_queue_done', { pk: queue.pk }, { ctime: queue.ctime, stime: queue.stime, ftime: at, videoId: queue.videoId });
  await ctx.db.execute('DELETE FROM urt_comment_queue WHERE pk = ? AND BINARY videoId = BINARY ?', [queue.pk, queue.videoId]);
}
/** Laravel hasRecentPublishedComment(): a complete urt_comment (empty pageToken, stime==mtime or a done row)
 * refreshed within three hours finishes the queue row without YouTube calls. */
async function recentlyPublished(ctx: SourceJobContext, videoId: string, at: Date) {
  const [rows] = await ctx.db.query<RowDataPacket[]>("SELECT c.mtime,c.stime,EXISTS(SELECT 1 FROM urt_comment_queue_done d WHERE BINARY d.videoId=BINARY c.videoId) done FROM urt_comment c WHERE BINARY c.videoId=BINARY ? AND (c.pageToken IS NULL OR c.pageToken='') AND c.mtime > ? LIMIT 1", [videoId, taipeiSql(new Date(at.getTime() - 3 * 3600000))]);
  const row = rows[0]; return !!row && ((row.stime !== null && String(row.stime) === String(row.mtime)) || Number(row.done) === 1);
}
async function publish(ctx: SourceJobContext, queue: RowDataPacket, state: State) {
  // Laravel stamps each queue row with its own processing time, never the batch start.
  const at = taipeiSql(ctx.clock?.() ?? ctx.now);
  const done = await selectOne(ctx.db,'urt_comment_queue_done',{pk:queue.pk});
  if (done && done.videoId !== state.videoId) throw new Error('Queue completion identity collision');
  // Embedded replies can disappear before their complete replay. Publish only retained authors.
  const retained = new Set(Object.values(state.comments).flatMap(c => [c, ...Object.values(c.replies ?? {})]).map(c => c.authorChannelId).filter(Boolean));
  state.authors = Object.fromEntries(Object.entries(state.authors).filter(([id]) => retained.has(id)));
  const authors: { id: string; values: Author; index: string[] }[] = [];
  // Validate every existing author index before any nontransactional public writes.
  for (const [id, values] of Object.entries(state.authors)) {
    const author = await commentAuthor(ctx,id);
    const rev = author ? await selectOne(ctx.db, 'urt_comment_rev', { author_id: author.author_id }) : null;
    let index: unknown = String(rev?.index_json ?? '').trim() ? JSON.parse(rev!.index_json) : [];
    if (record(index) && !Object.keys(index).length) index=[];
    if (!Array.isArray(index) || index.some(v => typeof v !== 'string' || !v)) throw new Error('Corrupt existing author reverse index');
    // Laravel upsertAuthor() appends the video only when it is absent and keeps the stored order.
    authors.push({ id, values, index: (index as string[]).includes(state.videoId) ? index as string[] : [...index as string[], state.videoId] });
  }
  let likes = 0, replies = 0, latest: string | null = null;
  for (const comment of Object.values(state.comments)) {
    const children = Object.values(comment.replies ?? {}); replies += children.length;
    for (const item of [comment, ...children]) { likes += item.likeCount; if (!Number.isSafeInteger(likes)) throw new Error('Comment likes exceed safe integer range'); if (!latest || Date.parse(item.publishedAt) > Date.parse(latest)) latest = item.publishedAt; }
  }
  await save(ctx, queue.pk, state, 'publishing');
  for (const author of authors) {
    await ctx.assertOwnership();
    // Laravel only inserts unseen authors (no mtime) and never rewrites an existing author's profile.
    if (!await commentAuthor(ctx,author.id)) await upsert(ctx.db, 'urt_comment_author', { ChannelId: author.id }, { ctime: at, ...author.values, ChannelUrl: author.values.ChannelUrl ?? '' }); // NOT NULL column: '' where Laravel's strict insert of NULL would fail
    const row = await commentAuthor(ctx,author.id);
    const rev = await selectOne(ctx.db, 'urt_comment_rev', { author_id: row!.author_id });
    await upsert(ctx.db, 'urt_comment_rev', { author_id: row!.author_id }, { ...(rev ? {} : { ctime: at }), mtime: at, videos: author.index.length, index_json: JSON.stringify(author.index) });
  }
  await ctx.assertOwnership(); const existing = await selectOne(ctx.db, 'urt_comment', { videoId: state.videoId });
  // Laravel takes channelId from the returned threads (else the stored row) and resolves u_id via urt_channel.youtube_id,
  // so a video without comment threads keeps NULL channel fields unless an earlier row named them.
  const sourceChannel: string | null = Object.keys(state.comments).length ? state.channelId : typeof existing?.channelId === 'string' && existing.channelId ? existing.channelId : null;
  const [owners] = sourceChannel ? await ctx.db.query<RowDataPacket[]>('SELECT u_id FROM urt_channel WHERE BINARY youtube_id=BINARY ? LIMIT 1', [sourceChannel]) : [[] as RowDataPacket[]];
  await upsert(ctx.db, 'urt_comment', { videoId: state.videoId }, { ...(existing ? {} : { ctime: at }), mtime: at, stime: at, comments_count: Object.keys(state.comments).length + replies, threads_count: Object.keys(state.comments).length, replies_count: replies, likes_count: likes, authors_count: authors.length, latest_time: latest ? taipeiSql(new Date(latest)) : null, pageToken: '', channelId: sourceChannel, u_id: owners[0] ? Number(owners[0].u_id) : null, comments_json: JSON.stringify(state.comments), authors_json: JSON.stringify(state.authors) });
  // Laravel finishQueueRow() inserts the done row once and never rewrites an existing one.
  if (!done) await upsert(ctx.db, 'urt_comment_queue_done', { pk: queue.pk }, { ctime: queue.ctime, stime: queue.stime, ftime: at, videoId: state.videoId });
  await save(ctx, queue.pk, state, 'published');
  await ctx.db.execute('DELETE FROM urt_comment_queue WHERE pk = ? AND BINARY videoId = BINARY ?', [queue.pk, state.videoId]);
  await ctx.db.execute('DELETE FROM ts_comment_stages WHERE BINARY video_id = BINARY ? AND queue_pk = ?', [state.videoId, queue.pk]);
  await clearItemBackoff(ctx.db, 'youtube.comments.fetch', state.videoId);
}
async function fetchOne(ctx: SourceJobContext, queue: RowDataPacket, input: { maxPages: number; maxReplyPages: number }) {
  const [stages] = await ctx.db.query<RowDataPacket[]>('SELECT * FROM ts_comment_stages WHERE BINARY video_id=BINARY ?', [queue.videoId]);
  const started = ctx.clock?.() ?? ctx.now;
  if ((!stages[0] || stages[0].status === 'published') && await recentlyPublished(ctx, queue.videoId, started)) {
    await ctx.assertOwnership(); await finishQueue(ctx, queue, taipeiSql(started));
    if (stages[0]) await ctx.db.execute("DELETE FROM ts_comment_stages WHERE BINARY video_id = BINARY ? AND status='published'", [queue.videoId]);
    await clearItemBackoff(ctx.db, 'youtube.comments.fetch', queue.videoId);
    return { videoId: queue.videoId, complete: true, pages: 0, replyPages: 0, recentCache: true };
  }
  const source = await selectOne(ctx.db, 'urt_video', { videoId: queue.videoId });
  if (!source) throw new Error('Queued comment video is missing');
  let saved: RowDataPacket | undefined = stages[0];
  if (saved && Number(saved.queue_pk) !== Number(queue.pk)) {
    if (saved.status !== 'published') throw new Error('Comment stage belongs to another queue generation');
    saved = undefined; // A crash after deleting the old queue may leave its published stage.
  }
  const state: State = saved ? readState(saved.state_json, source) : { version: 1, videoId: source.videoId, channelId: source.channelId, uId: Number(source.u_id), token: null, page: null, index: 0, seen: [], reply: null, comments: {}, authors: {}, complete: false };
  let pages = 0, replyPages = 0;
  while (!state.complete) {
    await ctx.assertOwnership();
    if (state.reply) {
      if (replyPages >= input.maxReplyPages) break;
      const active = state.reply, page = await ctx.youtube.comments(active.parentId, active.token); replyPages++;
      const replies = state.comments[active.key]?.replies; if (!replies) throw new Error('Invalid saved reply state');
      for (const item of page.items) { const [id, comment] = replyItem(item, state, active.parentId); replies[id] = comment; }
      if (page.nextPageToken !== null) {
        if (active.seen.includes(page.nextPageToken) || active.token === page.nextPageToken) throw new Error('Reply cursor did not advance');
        active.seen.push(page.nextPageToken); active.token = page.nextPageToken;
      } else state.reply = null;
      await save(ctx, queue.pk, state); continue;
    }
    if (state.page) {
      const item = state.page.items[state.index];
      if (item) { prepareThread(item, state); state.index++; if (state.reply) await save(ctx, queue.pk, state); continue; }
      state.token = state.page.nextPageToken; state.page = null; state.index = 0;
      if (state.token === null) { state.complete = true; break; }
    }
    if (pages >= input.maxPages) break;
    const page = await ctx.youtube.commentThreads(state.videoId, state.token); pages++;
    if (page.nextPageToken !== null) {
      if (state.seen.includes(page.nextPageToken) || state.token === page.nextPageToken) throw new Error('Thread cursor did not advance');
      state.seen.push(page.nextPageToken);
    }
    state.page = page; await save(ctx, queue.pk, state);
  }
  await save(ctx, queue.pk, state);
  if (state.complete) await publish(ctx, queue, state);
  return { videoId: state.videoId, complete: state.complete, pages, replyPages };
}
export async function commentFetchJob(ctx: SourceJobContext, input: { videoId?: string; limit: number; maxPages: number; maxReplyPages: number; maxStateMiB?: number }) {
  cap(input.limit, 10); cap(input.maxPages, 3); cap(input.maxReplyPages, 100); const maxStateMiB=cap(input.maxStateMiB ?? 12,64);
  const clock=ctx.clock ?? (()=>ctx.now), expired=taipeiSql(new Date(clock().getTime()-30*60000));
  const [rows] = await ctx.db.query<RowDataPacket[]>(`SELECT q.* FROM urt_comment_queue q LEFT JOIN ts_youtube_item_backoff b ON b.workflow = 'youtube.comments.fetch' AND BINARY b.video_id=BINARY q.videoId WHERE q.ftime IS NULL AND (q.stime IS NULL OR q.stime <= ?) AND ${input.videoId ? 'BINARY q.videoId=BINARY ?' : '(b.retry_after IS NULL OR b.retry_after <= ?)'} ORDER BY q.pk LIMIT ?`, [expired, ...(input.videoId ? [key(input.videoId, 32)] : [taipeiSql(ctx.now)]), input.limit]);
  const applied: { videoId: string; complete: boolean; pages: number; replyPages: number; recentCache?: boolean }[] = [], skipped: { videoId: string; reason: string }[] = [], checkpointed: string[] = [];
  if (!ctx.execute) return { mode: 'dry-run', selected: rows.length, apiAttempts: 0, applied, skipped, checkpointed };
  const [packet] = await ctx.db.query<RowDataPacket[]>('SELECT @@max_allowed_packet AS bytes');
  if (Number(packet[0]?.bytes) < (maxStateMiB+1) * 1024 * 1024) return {mode:'execute',selected:rows.length,apiAttempts:0,applied,skipped,checkpointed,capacityBlocked:'increase-database-max-allowed-packet-or-reduce-max-state-mib'};
  for (const row of rows) {
    await ctx.assertOwnership();
    const previous=row.stime ?? null; let claimTime=taipeiSql(clock());
    const [claim]=await ctx.db.execute<ResultSetHeader>('UPDATE urt_comment_queue SET stime=? WHERE pk=? AND ftime IS NULL AND (stime IS NULL OR stime <= ?)',[claimTime,row.pk,taipeiSql(new Date(clock().getTime()-30*60000))]);
    if (claim.affectedRows !== 1) {skipped.push({videoId:row.videoId,reason:'claim-not-acquired'});continue;}
    row.stime=claimTime;
    const claimedCtx: SourceJobContext={...ctx,assertOwnership:async()=>{
      await ctx.assertOwnership(); const renewed=taipeiSql(clock());
      const [owners]=await ctx.db.query<RowDataPacket[]>('SELECT pk FROM urt_comment_queue WHERE pk=? AND ftime IS NULL AND stime=?',[row.pk,claimTime]);
      if (!owners.length) throw new Error('Comment queue claim lost');
      if (renewed>claimTime) {
        const [changed]=await ctx.db.execute<ResultSetHeader>('UPDATE urt_comment_queue SET stime=? WHERE pk=? AND ftime IS NULL AND stime=?',[renewed,row.pk,claimTime]);
        if(changed.affectedRows!==1)throw new Error('Comment queue claim lost');claimTime=renewed;row.stime=renewed;
      }
    }};
    capacities.set(claimedCtx,maxStateMiB);
    try { const result = await fetchOne(claimedCtx, row, input); if (result.complete) applied.push(result); else checkpointed.push(row.videoId); }
    catch (error) {
      if (error instanceof CommentCapacityError) return {mode:'execute',selected:rows.length,apiAttempts:ctx.youtube.attemptsMade,applied,skipped,checkpointed,capacityBlocked:error.message};
      if (error instanceof YoutubeError && !isYoutubeItemFailure(error)) return {mode:'execute',selected:rows.length,apiAttempts:ctx.youtube.attemptsMade,applied,skipped,checkpointed,stoppedReason:error.code,remaining:rows.length-applied.length-skipped.length-checkpointed.length};
      await claimedCtx.assertOwnership();
      await recordItemBackoff(ctx.db, 'youtube.comments.fetch', row.videoId, 'comment-fetch-or-publication-failed', ctx.now);
      skipped.push({ videoId: row.videoId, reason: error instanceof Error && error.message === 'Comment stage belongs to another queue generation' ? 'queue-generation-mismatch-use-explicit-reset' : 'comment-fetch-or-publication-failed' });
    } finally {
      // CAS release restores the pre-claim marker and never releases a replacement owner's claim.
      await ctx.db.execute('UPDATE urt_comment_queue SET stime=? WHERE pk=? AND ftime IS NULL AND stime=?',[previous,row.pk,claimTime]).catch(()=>undefined);
      capacities.delete(claimedCtx);
    }
  }
  return { mode: 'execute', selected: rows.length, apiAttempts: ctx.youtube.attemptsMade, applied, skipped, checkpointed };
}
/** Explicit repair command archives prior evidence before resetting the resumable crawl. */
export async function commentResetJob(ctx: SourceJobContext, videoId: string) {
  videoId = key(videoId, 32);
  const queue = await selectOne(ctx.db, 'urt_comment_queue', { videoId });
  const source=await selectOne(ctx.db,'urt_video',{videoId});
  const applied: string[] = [], skipped: { videoId: string; reason: string }[] = [];
  if (ctx.execute && source) {
    const cutoff=taipeiSql(new Date((ctx.clock?.() ?? ctx.now).getTime()-30*60000));
    if(queue?.ftime || (queue?.stime && String(queue.stime)>cutoff)) throw new Error('Cannot reset an active or finished queue claim');
    await ctx.assertOwnership();
    await ctx.db.execute('INSERT INTO ts_comment_stage_archive (id,video_id,queue_pk,state_json,status,archived_at) SELECT ?,video_id,queue_pk,state_json,status,? FROM ts_comment_stages WHERE BINARY video_id=BINARY ?', [randomUUID(),taipeiSql(ctx.now),videoId]);
    await ctx.db.execute('DELETE FROM ts_comment_stages WHERE BINARY video_id=BINARY ?', [videoId]);
    if(!queue) await upsert(ctx.db,'urt_comment_queue',{videoId},{ctime:taipeiSql(ctx.now),stime:null,ftime:null});
    await clearItemBackoff(ctx.db,'youtube.comments.fetch',videoId); applied.push(videoId);
  }
  return { mode:ctx.execute?'execute':'dry-run', selected:source?1:0, apiAttempts:0, applied, skipped };
}
