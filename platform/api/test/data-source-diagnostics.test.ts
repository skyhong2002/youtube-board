import { afterEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
const mocks = vi.hoisted(() => ({ createPool: vi.fn() }));
vi.mock('mysql2/promise', () => ({ default: { createPool: mocks.createPool } }));
import { createReader, DataQueryFailed, DataSourceUnavailable } from '../src/db/client.js';
import { dataSourceReporter } from '../src/db/diagnostics.js';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.clearAllMocks(); });
describe('bounded database failure diagnostics', () => {
  it('distinguishes missing configuration from current transport failures', async () => {
    await expect(createReader('').rows(sql`SELECT 1`)).rejects.toMatchObject({ category: 'configuration', driverCode: 'UNKNOWN' });
    mocks.createPool.mockReturnValue({ getConnection: vi.fn().mockRejectedValue({ code: 'ECONNREFUSED', sql: 'private SQL', message: 'private password' }), end: vi.fn() });
    const error = await createReader('mysql://fixture').rows(sql`SELECT 1`).catch(error => error);
    expect(error).toMatchObject({ category: 'connection-acquire', driverCode: 'ECONNREFUSED', cause: 'ECONNREFUSED' });
    expect(JSON.stringify(error)).not.toContain('private');
  });

  it('bounds concurrent admission and releases late connections after acquire deadlines', async () => {
    vi.useFakeTimers();
    const resolves: ((connection: unknown) => void)[] = [];
    const pool = { getConnection: vi.fn(() => new Promise(resolve => resolves.push(resolve))), end: vi.fn() };
    mocks.createPool.mockReturnValue(pool);
    const reader = createReader('mysql://fixture', { acquireMs: 10, statementMs: 10 });
    const pending = Array.from({ length: 24 }, () => reader.rows(sql`SELECT 1`).catch(error => error));
    await expect(reader.rows(sql`SELECT 1`)).rejects.toMatchObject({ category: 'pool-admission' });
    expect(pool.getConnection).toHaveBeenCalledTimes(24);
    await vi.advanceTimersByTimeAsync(10);
    expect((await Promise.all(pending)).every(error => error.category === 'connection-acquire')).toBe(true);
    const release = vi.fn();
    for (const resolve of resolves) resolve({ release });
    await Promise.resolve();
    expect(release).toHaveBeenCalledTimes(24);
  });

  it('identifies a server statement deadline and destroys only the failed connection', async () => {
    const connection = { execute: vi.fn().mockRejectedValue({ errno: 1969, message: 'private SQL and args' }), destroy: vi.fn(), release: vi.fn() };
    mocks.createPool.mockReturnValue({ getConnection: vi.fn().mockResolvedValue(connection), end: vi.fn() });
    await expect(createReader('mysql://fixture').rows(sql`SELECT 1`)).rejects.toMatchObject({ category: 'statement-deadline', driverCode: 'ER_STATEMENT_TIMEOUT' });
    expect(connection.destroy).toHaveBeenCalledOnce();
    expect(connection.release).not.toHaveBeenCalled();
  });

  it('preserves query errors separately instead of calling every failure unavailable', async () => {
    mocks.createPool.mockReturnValue({ getConnection: vi.fn().mockRejectedValue({ code: 'ER_BAD_FIELD_ERROR' }), end: vi.fn() });
    await expect(createReader('mysql://fixture').rows(sql`SELECT 1`)).rejects.toBeInstanceOf(DataQueryFailed);
  });

  it('coalesces repeated diagnostics without logging SQL, URLs, messages or credentials', () => {
    const write = vi.fn(); let now = 1000;
    const report = dataSourceReporter(write, () => now);
    const error = new DataSourceUnavailable({ message: 'private password and SQL' }, 'pool-admission');
    for (let i = 0; i < 100; i++) report(error, 'readiness');
    expect(write).toHaveBeenCalledOnce();
    now += 30000; report(error, 'readiness');
    expect(JSON.parse(write.mock.calls[1]![0])).toEqual({ event: 'data-source-failure', context: 'readiness', category: 'pool-admission', code: 'UNKNOWN', suppressed: 99 });
    expect(JSON.stringify(write.mock.calls)).not.toContain('private');
  });

  it('logs the reader category even when a report consumes the error before the HTTP handler', async () => {
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    mocks.createPool.mockReturnValue({ getConnection: vi.fn().mockRejectedValue({ code: 'ECONNREFUSED', message: 'private connection data' }), end: vi.fn() });
    const reader = createReader('mysql://fixture');
    for (let i = 0; i < 2; i++) await reader.rows(sql`SELECT 1`).catch(() => 'section-unavailable');
    expect(write).toHaveBeenCalledOnce();
    expect(JSON.parse(String(write.mock.calls[0]![0]))).toMatchObject({ event: 'data-source-failure', context: 'reader', category: 'connection-acquire', code: 'ECONNREFUSED' });
    expect(JSON.stringify(write.mock.calls)).not.toContain('private');
  });

  it('does not replace the source failure when the diagnostic sink fails', () => {
    const write = vi.fn(() => { throw new Error('sink-failed'); });
    const report = dataSourceReporter(write);
    expect(() => { report(new DataSourceUnavailable(), 'reader'); report(new DataSourceUnavailable(), 'reader'); }).not.toThrow();
    expect(write).toHaveBeenCalledOnce();
  });
});
