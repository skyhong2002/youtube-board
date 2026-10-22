import { expect, it } from 'vitest';
import mysql, { type RowDataPacket } from 'mysql2/promise';
import { isolatedTestEnv } from '../../shared/test-database.js';
import { MysqlQuotaLedger } from '../src/quota.js';

it.skipIf(process.env.INGESTION_DB_TEST !== '1')('atomically enforces comment and shared quotas across concurrent connections without consuming video reservations', async () => {
  const env = isolatedTestEnv();
  const config = { host: env.DB_HOST, port: Number(env.DB_PORT), database: env.DB_DATABASE, user: env.DB_USERNAME, password: env.DB_PASSWORD, dateStrings: true };
  const db = await mysql.createConnection(config), other = await mysql.createConnection(config);
  const date = '2098-11-11', at = () => new Date(date + 'T20:00:00Z');
  let created = false;
  try {
    // INSERT fails rather than adopting another test's pre-existing rows.
    await db.execute('INSERT INTO ingestion_youtube_quota_daily(provider,quota_date,consumed_units,reserved_units) VALUES(?,?,0,2),(?,?,0,0)', ['youtube_data_api_v3', date, 'youtube_data_api_v3_comments', date]);
    created = true;
    const comments = new MysqlQuotaLedger(db, 4, at, 1), competitor = new MysqlQuotaLedger(other, 4, at, 1);
    const outcomes = await Promise.allSettled([comments.precharge(1000), competitor.precharge(1000)]);
    expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.find(result => result.status === 'rejected')).toMatchObject({ reason: { code: 'quota-comment-budget' } });
    const usage = async () => {
      const [rows] = await db.execute<RowDataPacket[]>('SELECT provider,consumed_units,reserved_units FROM ingestion_youtube_quota_daily WHERE quota_date=? ORDER BY provider', [date]);
      return rows.map(row => ({ provider: row.provider, consumed: Number(row.consumed_units), reserved: Number(row.reserved_units) }));
    };
    expect(await usage()).toEqual([{ provider: 'youtube_data_api_v3', consumed: 1, reserved: 2 }, { provider: 'youtube_data_api_v3_comments', consumed: 1, reserved: 0 }]);
    const videos = new MysqlQuotaLedger(db, 4, at);
    await videos.precharge(1000);
    await expect(comments.precharge(1000)).rejects.toMatchObject({ code: 'quota-budget' });
    await videos.markDailyExhausted(date);
    await expect(comments.precharge(1000)).rejects.toMatchObject({ code: 'quota-exhausted' });
    expect(await usage()).toEqual([{ provider: 'youtube_data_api_v3', consumed: 2, reserved: 2 }, { provider: 'youtube_data_api_v3_comments', consumed: 1, reserved: 0 }]);
  } finally {
    if (created) await db.execute('DELETE FROM ingestion_youtube_quota_daily WHERE quota_date=? AND provider IN (?,?)', [date, 'youtube_data_api_v3', 'youtube_data_api_v3_comments']);
    await db.end(); await other.end();
  }
});

it('rejects invalid comment budgets instead of allowing an uncapped worker', () => {
  for (const budget of [0, -1, 9001, NaN, 1.5]) expect(() => new MysqlQuotaLedger({} as mysql.Connection, 9000, undefined, budget)).toThrow();
});
