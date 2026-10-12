import { sql } from 'drizzle-orm';
import type { Reader, Row } from './client.js';
import { DataSourceUnavailable } from './client.js';
export async function read<T extends Row = Row>(reader: Reader, query: ReturnType<typeof sql>): Promise<T[]> { return reader.rows<T>(query); }
export async function one<T extends Row = Row>(reader: Reader, query: ReturnType<typeof sql>): Promise<T | null> { return (await read<T>(reader, query))[0] ?? null; }
export { DataSourceUnavailable };
