import mysql from 'mysql2/promise';

// urt_ai_date.data_json was TEXT (64 KiB), so most daily topic caches were rejected and the
// Laravel pipeline hid the failure. Widen it to LONGTEXT like video_json, keeping its charset,
// collation, nullability and default. Preview by default; --execute needs an ALTER-capable account.
const execute = process.argv.includes('--execute');
const address = process.env.DATABASE_URL;
if (!address) throw new Error('DATABASE_URL is required.');
const db = await mysql.createConnection(address);
try {
  const [rows] = await db.query("SELECT DATA_TYPE type, CHARACTER_SET_NAME charset, COLLATION_NAME collation, IS_NULLABLE nullable, COLUMN_DEFAULT fallback FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='urt_ai_date' AND COLUMN_NAME='data_json'");
  const column = rows[0];
  if (!column) throw new Error('urt_ai_date.data_json not found.');
  const [[size]] = await db.query('SELECT COUNT(*) rows_total, MAX(OCTET_LENGTH(data_json)) longest FROM urt_ai_date');
  const before = { type: column.type, charset: column.charset, collation: column.collation, nullable: column.nullable, default: column.fallback, rows: Number(size.rows_total), longest: size.longest === null ? null : Number(size.longest) };
  if (String(column.type).toLowerCase() === 'longtext') {
    console.log(JSON.stringify({ mode: execute ? 'execute' : 'preview', status: 'already-longtext', before }));
  } else {
    if (!/^[a-z0-9_]+$/.test(column.charset) || !/^[a-z0-9_]+$/.test(column.collation)) throw new Error('Unexpected column charset or collation.');
    const fallback = column.fallback === null || column.fallback === 'NULL' ? (column.nullable === 'YES' ? ' DEFAULT NULL' : '') : null;
    if (fallback === null) throw new Error('Unexpected non-null default on data_json.');
    const statement = `ALTER TABLE urt_ai_date MODIFY data_json LONGTEXT CHARACTER SET ${column.charset} COLLATE ${column.collation} ${column.nullable === 'YES' ? 'NULL' : 'NOT NULL'}${fallback}`;
    if (!execute) console.log(JSON.stringify({ mode: 'preview', status: 'would-alter', before, statement }));
    else {
      await db.query(statement);
      const [[after]] = await db.query("SELECT DATA_TYPE type, CHARACTER_SET_NAME charset, COLLATION_NAME collation, IS_NULLABLE nullable FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='urt_ai_date' AND COLUMN_NAME='data_json'");
      const [[count]] = await db.query('SELECT COUNT(*) rows_total FROM urt_ai_date');
      if (String(after.type).toLowerCase() !== 'longtext' || Number(count.rows_total) !== before.rows) throw new Error('Column change did not verify.');
      console.log(JSON.stringify({ mode: 'execute', status: 'altered', before, after: { ...after, rows: Number(count.rows_total) }, statement }));
    }
  }
} finally {
  await db.end();
}
