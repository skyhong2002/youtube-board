import type { Connection, RowDataPacket } from 'mysql2/promise';
import { taipeiSql } from './legacy-db.js';
export interface GroupStatusInput { group?: string; hours: number; limit: number; offset: number | 'auto'; execute: boolean }
export function validateGroupStatusInput(input: GroupStatusInput): GroupStatusInput {
  if (!Number.isInteger(input.hours) || input.hours < 1 || input.hours > 168 || !Number.isInteger(input.limit) || input.limit < 1 || input.limit > 200 || (input.offset !== 'auto' && (!Number.isSafeInteger(input.offset) || input.offset < 0 || input.offset > 1000000)) || typeof input.execute !== 'boolean') throw new Error('Invalid group status bounds');
  if (input.group !== undefined && (typeof input.group !== 'string' || [...input.group].length > 64 || /[\x00-\x1f\x7f]/.test(input.group))) throw new Error('Invalid group name');
  return { ...input, group: input.group?.replace(/^ +| +$/g, '') || undefined };
}
/** Local Laravel path is a status report, even with --execute. Never sync remote groups. */
export async function groupStatus(db: Pick<Connection, 'query'>, input: GroupStatusInput, now = new Date()) {
  const v = validateGroupStatusInput(input), where = v.group ? 'WHERE group_name = ?' : '', params = v.group ? [v.group] : [];
  const [summary] = await db.query<RowDataPacket[]>(`SELECT COUNT(DISTINCT group_name) AS group_count,COUNT(*) AS tag_rows,COALESCE(SUM(del_flag IS NULL OR del_flag < '1'),0) AS active_rows,MAX(latest_time) AS latest_time FROM tag_group ${where}`, params);
  const [records] = await db.query<RowDataPacket[]>(`SELECT group_name,COUNT(*) AS tag_rows,SUM(del_flag IS NULL OR del_flag < '1') AS active_rows,MAX(latest_time) AS latest_time FROM tag_group ${where} GROUP BY group_name ORDER BY active_rows DESC,group_name ASC LIMIT ?`, [...params, v.limit]);
  const counts = (r: RowDataPacket) => ({ tag_rows: Number(r.tag_rows), active_rows: Number(r.active_rows), deleted_rows: Number(r.tag_rows) - Number(r.active_rows), latest_time: r.latest_time ?? null });
  return { mode: 'read-only', requested_mode: v.execute ? 'execute' : 'ingestion-preview', generated_at: taipeiSql(now), hours: v.hours, group_name: v.group ?? null, group_count: Number(summary[0]!.group_count), ...counts(summary[0]!), rows: records.map(r => ({ group_name: r.group_name, ...counts(r) })), rows_truncated: Number(summary[0]!.group_count) > records.length, external_fetch_skipped: true, external_sync: 'unsupported', external_sync_reason: 'The maintained tag.observe.tw vocabulary export has no group membership contract; existing local display groups are preserved. Legacy remote sync is not supported.', sync_candidates: 0, sync_attempted: 0, synced_rows: 0, failed_rows: 0, requested_offset: v.offset, sync_offset: 0, sync_next_offset: 0, exit_code: 0, writes: [], external_calls: 0, notes: ['hours and offset are compatibility parameters; local status has no time window or remote cursor.', 'Totals and bounded group rows are separate read observations, not an atomic snapshot.'] };
}
