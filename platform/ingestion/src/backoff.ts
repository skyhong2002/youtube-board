import type { Connection, RowDataPacket } from 'mysql2/promise';
import { taipeiSql } from './legacy-db.js';
export async function recordItemBackoff(db: Connection, workflow: string, videoId: string, reason: string, now: Date): Promise<void> {
  const [rows] = await db.query<RowDataPacket[]>('SELECT failures FROM ts_youtube_item_backoff WHERE workflow = ? AND BINARY video_id = BINARY ?', [workflow, videoId]);
  const failures = Math.min(12, Number(rows[0]?.failures ?? 0) + 1), seconds = Math.min(21600, 300 * 2 ** (failures - 1));
  await db.execute('INSERT INTO ts_youtube_item_backoff (workflow, video_id, failures, retry_after, reason, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE failures = VALUES(failures), retry_after = VALUES(retry_after), reason = VALUES(reason), updated_at = VALUES(updated_at)', [workflow, videoId, failures, taipeiSql(new Date(now.getTime() + seconds * 1000)), reason, taipeiSql(now)]);
}
export async function clearItemBackoff(db: Connection, workflow: string, videoId: string): Promise<void> { await db.execute('DELETE FROM ts_youtube_item_backoff WHERE workflow = ? AND BINARY video_id = BINARY ?', [workflow, videoId]); }
