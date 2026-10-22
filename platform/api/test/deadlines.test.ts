import { describe, it, expect } from 'vitest';
import { setTimeout as delay } from 'node:timers/promises';
import { sql } from 'drizzle-orm';
import { createReader } from '../src/db/client.js';
import { assertTestDatabaseUrl } from '../../shared/test-database.js';
const url = process.env.TEST_DATABASE_URL ? assertTestDatabaseUrl(process.env.TEST_DATABASE_URL) : undefined;
describe.skipIf(!url)('MariaDB bounded reader deadlines', () => {
    it('cancels slow SQL on the server and can query again afterward', async () => {
        const reader = createReader(url, { acquireMs: 1000, statementMs: 50 });
        try {
            await expect(reader.rows(sql`SELECT SLEEP(1)`)).rejects.toMatchObject({ category: 'statement-deadline', driverCode: 'ER_STATEMENT_TIMEOUT' });
            expect(await reader.rows(sql`SELECT ${42} AS value`)).toEqual([{ value: 42 }]);
        } finally { await reader.close(); }
    });
    it('expires queued acquisition and releases connections arriving after expiry', async () => {
        const reader = createReader(url, { acquireMs: 300, statementMs: 2000 });
        try {
            await Promise.all(Array.from({ length: 6 }, () => reader.rows(sql`SELECT 1`)));
            const running = Array.from({ length: 6 }, () => reader.rows(sql`SELECT SLEEP(0.7)`));
            await delay(20);
            await expect(reader.rows(sql`SELECT 1`)).rejects.toMatchObject({ category: 'connection-acquire', driverCode: 'UNKNOWN' });
            await Promise.all(running);
            const recovered = await Promise.all(Array.from({ length: 6 }, () => reader.rows(sql`SELECT 1 AS value`)));
            expect(recovered.every(rows => rows[0]?.value === 1)).toBe(true);
        } finally { await reader.close(); }
    });
});
