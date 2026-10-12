import type { Connection, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
export const taipeiSql = (date: Date) => new Date(date.getTime() + 8 * 3600000).toISOString().slice(0, 19).replace('T', ' ');
export const legacyInstant = (value: unknown): Date | null => {
  if (value instanceof Date) throw new Error('Read legacy DATETIME values with dateStrings enabled');
  const text = typeof value === 'string' ? value : '';
  if (!text) return null;
  const date = new Date(text.replace(' ', 'T') + (/Z$|[+-]\d{2}:\d{2}$/.test(text) ? '' : '+08:00'));
  return Number.isFinite(date.getTime()) ? date : null;
};
const tables = new Set(['urt_video', 'urt_video_schedule', 'urt_video_log', 'urt_video_log_history', 'urt_video_live', 'urt_video_live_log', 'urt_show_tag_date', 'urt_channel', 'urt_count', 'urt_log', 'urt_video_duration', 'urt_comment', 'urt_comment_author', 'urt_comment_rev', 'urt_comment_queue', 'urt_comment_queue_done', 'urt_video_live_tvbs', 'urt_video_live_log_tvbs', 'urt_show_cloud', 'urt_show_photo', 'urt_show_data', 'urt_show_tag_cloud', 'urt_show_tag_cloud_tag', 'urt_show_tag_month', 'urt_show_video_tag_date', 'urt_show_video_live', 'urt_show_live_tag_date']);
const primaryKey: Record<string, string> = { urt_show_video_live: 'pk_live', urt_channel: 'u_id', urt_count: 'u_id', urt_video_duration: 'pk_video', urt_comment_author: 'author_id', urt_comment_rev: 'author_id' };
function identifier(value: string): string { if (!/^[A-Za-z_][A-Za-z_0-9]*$/.test(value)) throw new Error('Invalid internal SQL identifier'); return '`' + value + '`'; }
function params(values: unknown[]): (string | number | boolean | Date | null)[] { return values.map(value => { if (value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)) || value instanceof Date) return value; throw new Error('Invalid SQL scalar'); }); }
export function whereKeys(keys: Record<string, unknown>) {
  if (!Object.keys(keys).length) throw new Error('Empty database identity');
  return { sql: Object.keys(keys).map(k => keys[k] === null && ['tagid', 'tag_or', 'tag_not'].includes(k) ? `(${identifier(k)} IS NULL OR ${identifier(k)} = '')` : `${['videoId', 'youtube_id', 'ChannelId', 'channelId', 'tag'].includes(k) ? 'BINARY ' : ''}${identifier(k)} <=> ${['videoId', 'youtube_id', 'ChannelId', 'channelId', 'tag'].includes(k) ? 'BINARY ' : ''}?`).join(' AND '), values: Object.entries(keys).filter(([k, v]) => !(v === null && ['tagid', 'tag_or', 'tag_not'].includes(k))).map(([, v]) => v) };
}
export async function selectOne(db: Connection, table: string, keys: Record<string, unknown>): Promise<RowDataPacket | undefined> {
  if (!tables.has(table)) throw new Error('Unregistered write table'); const where = whereKeys(keys);
  const [rows] = await db.query<RowDataPacket[]>(`SELECT * FROM ${identifier(table)} WHERE ${where.sql} ORDER BY ${identifier(primaryKey[table] ?? 'pk')} DESC LIMIT 2`, where.values);
  if (rows.length > 1 && !(table === 'urt_video_log_history' && !('ctime' in keys))) throw new Error('Duplicate logical source/cache identity');
  return rows[0];
}
export async function update(db: Connection, table: string, keys: Record<string, unknown>, values: Record<string, unknown>): Promise<void> {
  if (!tables.has(table)) throw new Error('Unregistered write table'); if (!Object.keys(values).length) return;
  const where = whereKeys(keys); await db.execute(`UPDATE ${identifier(table)} SET ${Object.keys(values).map(k => identifier(k) + ' = ?').join(', ')} WHERE ${where.sql}`, params([...Object.values(values), ...where.values]));
}
/** Only under the workflow writer lock; works on MyISAM without claiming rollback. */
export async function upsert(db: Connection, table: string, keys: Record<string, unknown>, values: Record<string, unknown>): Promise<void> {
  const existing = await selectOne(db, table, keys);
  if (existing) return update(db, table, { [primaryKey[table] ?? 'pk']: existing[primaryKey[table] ?? 'pk'] }, values);
  const row = { ...keys, ...values }; await db.execute<ResultSetHeader>(`INSERT INTO ${identifier(table)} (${Object.keys(row).map(identifier).join(', ')}) VALUES (${Object.keys(row).map(() => '?').join(', ')})`, params(Object.values(row)));
}
export function jsonMap(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined || value === '') return {};
  const parsed: unknown = JSON.parse(String(value));
  if (Array.isArray(parsed) && parsed.length === 0) return {};
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid existing report JSON');
  return parsed as Record<string, unknown>;
}
