import type { ExecuteValues } from 'mysql2';
import { MySqlDialect } from 'drizzle-orm/mysql-core';
import type { SQL } from 'drizzle-orm';
import mysql from 'mysql2/promise';
import { dataSourceReporter } from './diagnostics.js';
import { readerOperation, readerPoolObservation, observationElapsed, type ReaderOperation, type ReaderFailureObservation } from './observation.js';
export type Row = Record<string, unknown>;
export interface Reader {
    /** statementMs raises or lowers this query's server-side deadline within the reader bounds. */
    rows<T extends Row = Row>(query: SQL, options?: { statementMs?: number; operation?: ReaderOperation }): Promise<T[]>;
    close(): Promise<void>;
}
export type DataSourceFailureCategory = 'configuration' | 'pool-admission' | 'connection-acquire' | 'statement-deadline' | 'driver';
export class DataSourceUnavailable extends Error {
    readonly driverCode: string;
    constructor(cause?: unknown, public readonly category: DataSourceFailureCategory = 'driver') {
        const code = typeof cause === 'string' && unavailableCodes.has(cause) ? cause : 'UNKNOWN';
        super('Dashboard data source is unavailable.', { cause: code });
        this.driverCode = code;
    }
}
const unavailableCodes = new Set(['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EHOSTUNREACH', 'ENETUNREACH', 'ECONNRESET', 'EPIPE', 'PROTOCOL_CONNECTION_LOST', 'PROTOCOL_SEQUENCE_TIMEOUT', 'ER_ACCESS_DENIED_ERROR', 'ER_DBACCESS_DENIED_ERROR', 'ER_TABLEACCESS_DENIED_ERROR', 'ER_COLUMNACCESS_DENIED_ERROR', 'ER_CON_COUNT_ERROR', 'ER_TOO_MANY_USER_CONNECTIONS', 'ER_SERVER_SHUTDOWN', 'ER_LOCK_WAIT_TIMEOUT', 'ER_STATEMENT_TIMEOUT', 'ER_QUERY_TIMEOUT', 'ER_QUERY_INTERRUPTED', 'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR', 'PROTOCOL_ENQUEUE_AFTER_QUIT']);
export class DataQueryFailed extends Error {
    constructor(public readonly driverCode: string) { super('Dashboard query failed.'); }
}
/** Drizzle wraps driver failures; never retain SQL, parameters, or driver messages. */
function driverCode(error: unknown): string {
    let current = error;
    for (let depth = 0; depth < 6 && current && typeof current === 'object'; depth++) {
        const e = current as {
            code?: unknown;
            errno?: unknown;
            cause?: unknown;
        };
        // mysql2's MySQL error-name table omits MariaDB statement timeout 1969.
        if (e.errno === 1969) return 'ER_STATEMENT_TIMEOUT';
        if (e.errno === 3024) return 'ER_QUERY_TIMEOUT';
        if (e.errno === 1317) return 'ER_QUERY_INTERRUPTED';
        if (typeof e.code === 'string' && /^(?:ER_[A-Z0-9_]+|E[A-Z0-9_]+|PROTOCOL_[A-Z0-9_]+)$/.test(e.code) && e.code.length < 80)
            return e.code;
        current = e.cause;
    }
    return 'UNKNOWN';
}
/** Request readers keep the 15-second statement ceiling. A background reader (the homepage keyword refresh,
 * which no request waits for) may raise it to at most 60 seconds on its own small pool. */
export function createReader(databaseUrl: string | undefined, limits = { acquireMs: 3000, statementMs: 5000 }, { maxStatementMs = 15000, connectionLimit = 6 }: { maxStatementMs?: number; connectionLimit?: number } = {}): Reader {
    if (!Number.isSafeInteger(maxStatementMs) || maxStatementMs < 10 || maxStatementMs > 60000 || !Number.isSafeInteger(connectionLimit) || connectionLimit < 1 || connectionLimit > 6) throw new Error("Invalid query deadline");
    if (![limits.acquireMs, limits.statementMs].every(n => Number.isSafeInteger(n) && n >= 10 && n <= maxStatementMs) || limits.acquireMs > 15000) throw new Error("Invalid query deadline");
    // Report before callers translate source errors into section-level failures.
    const reportFailure = dataSourceReporter();
    if (!databaseUrl)
        return { rows: async () => { const error = new DataSourceUnavailable(undefined, 'configuration'); reportFailure(error, 'reader'); throw error; }, close: async () => { } };
    const pool = mysql.createPool({ uri: databaseUrl, connectionLimit, connectTimeout: 5000, queueLimit: 24, maxPreparedStatements: 200,
        dateStrings: true, supportBigNumbers: true, bigNumberStrings: true, timezone: '+08:00',
        multipleStatements: false });
    const dialect = new MySqlDialect();
    let pending = 0;
    const observation = readerPoolObservation();
    async function acquire(operation: ReaderOperation) {
        if (pending >= 24) throw new DataSourceUnavailable(undefined, 'pool-admission');
        pending++;
        const lease = observation.queue(operation);
        return await new Promise<{connection: mysql.PoolConnection; lease: ReturnType<typeof observation.queue>}>((resolve, reject) => {
                let settled = false;
                const timer = setTimeout(() => { settled = true; observation.expire(lease); reject(new DataSourceUnavailable(undefined, 'connection-acquire')); }, limits.acquireMs);
                pool.getConnection().then(connection => {
                    pending--;
                    if (settled) { observation.abandon(lease); connection.release(); return; }
                    settled = true; clearTimeout(timer); observation.acquired(lease); resolve({connection, lease});
                }, error => { pending--; observation.abandon(lease); if (!settled) { settled = true; clearTimeout(timer); const code = driverCode(error); reject(unavailableCodes.has(code) ? new DataSourceUnavailable(code, 'connection-acquire') : new DataQueryFailed(code)); } });
            });
    }
    return {
        async rows<T extends Row>(query: SQL, options?: { statementMs?: number; operation?: ReaderOperation }): Promise<T[]> {
            const statementMs = options?.statementMs ?? limits.statementMs;
            if (!Number.isSafeInteger(statementMs) || statementMs < 10 || statementMs > maxStatementMs) throw new Error("Invalid query deadline");
            const started = performance.now();
            let operation = readerOperation('', options?.operation), phase: ReaderFailureObservation['phase'] = 'compile', acquireStarted: number | undefined, acquiredAt: number | undefined, failure: ReaderFailureObservation | undefined;
            const detail = (): ReaderFailureObservation => ({operation, phase, durationMs: observationElapsed(started, performance.now()), acquireMs: acquireStarted === undefined ? 0 : observationElapsed(acquireStarted, acquiredAt ?? performance.now()), statementMs: acquiredAt === undefined ? 0 : observationElapsed(acquiredAt, performance.now()), pool: observation.snapshot()});
            try {
                const compiled = dialect.sqlToQuery(query);
                operation = readerOperation(compiled.sql, options?.operation);
                acquireStarted = performance.now();
                phase = pending >= 24 ? 'admission' : 'acquire';
                const {connection, lease} = await acquire(operation);
                acquiredAt = performance.now(); phase = 'statement';
                let failed = false;
                try {
                    // Server-side cancellation bounds SQL work; socket timeout also
                    // covers transport failure. No background timed-out SELECT remains.
                    const [rows] = await connection.execute({ sql: `SET STATEMENT max_statement_time=${statementMs / 1000} FOR ${compiled.sql}`, timeout: statementMs + 1000 }, compiled.params as ExecuteValues[]);
                    return rows as unknown as T[];
                } catch (error) { failure = detail(); failed = true; connection.destroy(); throw error; }
                finally { observation.release(lease); if (!failed) connection.release(); }
            }
            catch (cause) {
                if (cause instanceof DataSourceUnavailable) { reportFailure(cause, 'reader', failure ?? detail()); throw cause; }
                if (cause instanceof DataQueryFailed) { reportFailure(cause, 'reader', failure ?? detail()); throw cause; }
                const code = driverCode(cause);
                const category = ['ER_STATEMENT_TIMEOUT', 'ER_QUERY_TIMEOUT', 'ER_QUERY_INTERRUPTED', 'PROTOCOL_SEQUENCE_TIMEOUT'].includes(code) ? 'statement-deadline' : 'driver';
                const error = unavailableCodes.has(code) ? new DataSourceUnavailable(code, category) : new DataQueryFailed(code);
                reportFailure(error, 'reader', failure ?? detail());
                throw error;
            }
        },
        close: async () => {
            try {
                await pool.end();
            }
            catch (error) {
                const code = driverCode(error);
                if (!unavailableCodes.has(code))
                    throw new DataQueryFailed(code);
            }
        },
    };
}
