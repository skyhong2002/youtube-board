import type { Connection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
export type YoutubeFailure = 'quota-exhausted' | 'quota-budget' | 'quota-daily' | 'quota-window' | 'authentication' | 'rate-limit' | 'transient' | 'invalid-response' | 'request-failed' | 'not-configured';
export class YoutubeError extends Error { constructor(public readonly code: YoutubeFailure, public readonly status?: number) { super(`YouTube ${code}${status ? ` (HTTP ${status})` : ''}`); this.name = 'YoutubeError'; } }
/** Per-resource rejections must not pin the head of a channel/comment queue. */
export function isYoutubeItemFailure(error: unknown): boolean {
  return error instanceof YoutubeError && (error.code === 'invalid-response' || (error.code === 'request-failed' && (error.status === undefined || [400,403,404,410].includes(error.status))));
}
export interface QuotaLedger { precharge(timeoutMs: number): Promise<string>; markDailyExhausted(date: string): Promise<void> }
export function pacificDate(at: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at);
  const part = (name: string) => parts.find(p => p.type === name)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function assertQuotaWindow(at: Date, timeoutMs: number, expectedDate?: string): string {
  const date = pacificDate(at);
  if ((expectedDate && date !== expectedDate) || pacificDate(new Date(at.getTime() + timeoutMs + 1000)) !== date) throw new YoutubeError('quota-window');
  return date;
}
/** Precharge every real network attempt. Never settle/release Laravel's outstanding reservations. */
export class MysqlQuotaLedger implements QuotaLedger {
  constructor(private readonly db: Connection, private readonly budget: number, private readonly now: () => Date = () => new Date()) {
    if (!Number.isSafeInteger(budget) || budget < 1) throw new YoutubeError('quota-budget');
  }
  async precharge(timeoutMs: number): Promise<string> {
    const date = assertQuotaWindow(this.now(), timeoutMs);
    await this.db.execute('INSERT INTO ingestion_youtube_quota_daily (provider, quota_date, consumed_units, reserved_units, created_at, updated_at) VALUES (?, ?, 0, 0, UTC_TIMESTAMP(), UTC_TIMESTAMP()) ON DUPLICATE KEY UPDATE provider = provider', ['youtube_data_api_v3', date]);
    const [result] = await this.db.execute<ResultSetHeader>('UPDATE ingestion_youtube_quota_daily SET consumed_units = consumed_units + 1, updated_at = UTC_TIMESTAMP() WHERE provider = ? AND quota_date = ? AND google_exhausted_at IS NULL AND consumed_units + reserved_units + 1 <= ?', ['youtube_data_api_v3', date, this.budget]);
    if (result.affectedRows !== 1) {
      const [rows]=await this.db.query<RowDataPacket[]>('SELECT google_exhausted_at FROM ingestion_youtube_quota_daily WHERE provider=? AND quota_date=?',['youtube_data_api_v3',date]);
      throw new YoutubeError(rows[0]?.google_exhausted_at ? 'quota-exhausted' : 'quota-budget');
    }
    assertQuotaWindow(this.now(), timeoutMs, date);
    return date;
  }
  async markDailyExhausted(date: string): Promise<void> {
    await this.db.execute('UPDATE ingestion_youtube_quota_daily SET google_exhausted_at = UTC_TIMESTAMP(), google_exhausted_units = consumed_units + reserved_units, updated_at = UTC_TIMESTAMP() WHERE provider = ? AND quota_date = ? AND google_exhausted_at IS NULL', ['youtube_data_api_v3', date]);
  }
}
