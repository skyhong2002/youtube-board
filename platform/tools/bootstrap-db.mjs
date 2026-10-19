import { readFile } from 'node:fs/promises';
import mysql from 'mysql2/promise';

// This bootstrap only accepts the isolated Compose database. It is not an
// adoption/migration command for an existing installation.
const address = new URL(process.env.DATABASE_URL ?? 'mysql://youtube_rewrite:youtube_rewrite_local@127.0.0.1:23306/youtube_board_rewrite');
if (!['127.0.0.1', 'localhost', 'db'].includes(address.hostname)
    || !['/youtube_board_rewrite', '/youtube_board_test_rewrite'].includes(address.pathname)
    || (address.hostname !== 'db' && address.port !== '23306')
    || process.env.NODE_ENV === 'production') {
  throw new Error('Bootstrap is restricted to the isolated local rewrite database.');
}
const execute = process.argv.includes('--execute');
const baseline = await readFile(new URL('../migrations/000-legacy-dashboard-baseline.sql', import.meta.url), 'utf8');
const supplements = await readFile(new URL('../migrations/001-local-adoption.sql', import.meta.url), 'utf8');
const statements = `${baseline}\n${supplements}`.split(';').map(s => s.trim()).filter(Boolean);
if (!execute) {
  console.log(JSON.stringify({ mode: 'preview', database: address.pathname.slice(1), statements: statements.length, instruction: 'Add --execute to initialize the isolated local schema.' }));
} else {
  const db = await mysql.createConnection(address.toString());
  try {
    await db.query("SET time_zone = '+00:00'");
    for (const statement of statements) await db.query(statement);
    // Adopt the same byte-exact ID contract as Laravel. Read deployed column
    // lengths/nullability instead of silently narrowing any field.
    const { columns } = JSON.parse(await readFile(new URL('../migrations/youtube-identifier-columns.json', import.meta.url), 'utf8'));
    for (const [table, column] of Object.entries(columns).flatMap(([table, fields]) => Object.keys(fields).map(column => [table, column]))) {
      const [rows] = await db.execute('SELECT DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE, COLLATION_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?', [table, column]);
      if (rows.length !== 1 || rows[0].DATA_TYPE !== 'varchar') throw new Error(`Unexpected identifier schema: ${table}.${column}`);
      if (rows[0].COLLATION_NAME === 'utf8mb4_bin') continue;
      await db.query(`ALTER TABLE \`${table}\` MODIFY \`${column}\` VARCHAR(${Number(rows[0].CHARACTER_MAXIMUM_LENGTH)}) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin ${rows[0].IS_NULLABLE === 'YES' ? 'NULL' : 'NOT NULL'}`);
    }
    const [tables] = await db.query('SHOW TABLES');
    console.log(JSON.stringify({ mode: 'execute', database: address.pathname.slice(1), tables: tables.length, dataImported: false }));
  } finally { await db.end(); }
}
