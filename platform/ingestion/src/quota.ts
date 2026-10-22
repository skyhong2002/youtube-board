import type { Connection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
export type YoutubeFailure = 'quota-exhausted' | 'quota-budget' | 'quota-comment-budget' | 'quota-daily' | 'quota-window' | 'authentication' | 'rate-limit' | 'transient' | 'invalid-response' | 'request-failed' | 'not-configured';
const YOUTUBE_API_REASONS = ['playlistNotFound', 'playlistItemsNotAccessible', 'videoNotFound', 'backendError', 'internalError', 'forbidden', 'invalidParameter', 'quotaExceeded', 'dailyLimitExceeded', 'rateLimitExceeded'] as const;
export type YoutubeApiReason = typeof YOUTUBE_API_REASONS[number] | 'other';
export class YoutubeError extends Error {
  readonly reason: YoutubeApiReason | null;
  constructor(public readonly code: YoutubeFailure, public readonly status?: number, reason?: unknown) {
    super(`YouTube ${code}${status ? ` (HTTP ${status})` : ''}`); this.name = 'YoutubeError';
    this.reason = reason === undefined || reason === null || reason === '' ? null
      : YOUTUBE_API_REASONS.includes(reason as typeof YOUTUBE_API_REASONS[number]) ? reason as YoutubeApiReason : 'other';
  }
}
/** Only bounded categories leave the provider boundary; never retain messages, URLs or response bodies. */
export function youtubeFailureDetail(error: unknown) {
  if (!(error instanceof YoutubeError)) return { category: 'unknown' as const, status: null, reason: null };
  return { category: error.code, status: Number.isInteger(error.status) && error.status! >= 100 && error.status! <= 599 ? error.status! : null, reason: error.reason };
}
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
  constructor(private readonly db: Connection, private readonly budget: number, private readonly now: () => Date = () => new Date(), private readonly commentBudget?: number) {
    if (!Number.isSafeInteger(budget) || budget < 1) throw new YoutubeError('quota-budget');
    if (commentBudget !== undefined && (!Number.isSafeInteger(commentBudget) || commentBudget < 1 || commentBudget > budget)) throw new YoutubeError('quota-comment-budget');
  }
  async precharge(timeoutMs: number): Promise<string> {
    const date = assertQuotaWindow(this.now(), timeoutMs);
    await this.db.execute('INSERT INTO ingestion_youtube_quota_daily (provider, quota_date, consumed_units, reserved_units, created_at, updated_at) VALUES (?, ?, 0, 0, UTC_TIMESTAMP(), UTC_TIMESTAMP()) ON DUPLICATE KEY UPDATE provider = provider', ['youtube_data_api_v3', date]);
    if (this.commentBudget !== undefined) {
      await this.db.execute('INSERT INTO ingestion_youtube_quota_daily (provider, quota_date, consumed_units, reserved_units, created_at, updated_at) VALUES (?, ?, 0, 0, UTC_TIMESTAMP(), UTC_TIMESTAMP()) ON DUPLICATE KEY UPDATE provider = provider', ['youtube_data_api_v3_comments', date]);
      // Charge shared and comment budgets in one statement. A rejected comment
      // reservation must not consume capacity reserved for video/live ingestion.
      const [result] = await this.db.execute<ResultSetHeader>(`UPDATE ingestion_youtube_quota_daily g JOIN ingestion_youtube_quota_daily c ON c.quota_date=g.quota_date
        SET g.consumed_units=g.consumed_units+1,g.updated_at=UTC_TIMESTAMP(),c.consumed_units=c.consumed_units+1,c.updated_at=UTC_TIMESTAMP()
        WHERE g.provider=? AND c.provider=? AND g.quota_date=? AND g.google_exhausted_at IS NULL
          AND g.consumed_units+g.reserved_units+1<=? AND c.consumed_units+c.reserved_units+1<=?`,
        ['youtube_data_api_v3', 'youtube_data_api_v3_comments', date, this.budget, this.commentBudget]);
      if (result.affectedRows !== 2) {
        const [rows] = await this.db.query<RowDataPacket[]>('SELECT google_exhausted_at,consumed_units,reserved_units FROM ingestion_youtube_quota_daily WHERE provider=? AND quota_date=?', ['youtube_data_api_v3', date]);
        throw new YoutubeError(rows[0]?.google_exhausted_at ? 'quota-exhausted' : !rows[0] || Number(rows[0].consumed_units)+Number(rows[0].reserved_units)+1>this.budget ? 'quota-budget' : 'quota-comment-budget');
      }
      assertQuotaWindow(this.now(), timeoutMs, date);
      return date;
    }
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
