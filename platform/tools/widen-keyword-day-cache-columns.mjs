import mysql from 'mysql2/promise';

// urt_show_video_tag_date.videos_json/tags_json were TEXT (64 KiB): a busy keyword's day (thousands of
// videos) does not fit, so `reports:keyword-relations:build` failed under strict SQL mode. Every other
// cache payload column is already LONGTEXT. Widen both, keeping charset, collation, nullability and
// default, like tools/widen-topic-cache-column.mjs. Preview by default; --execute needs an ALTER-capable account.
const execute = process.argv.includes('--execute');
const address = process.env.DATABASE_URL;
if (!address) throw new Error('DATABASE_URL is required.');
const table = 'urt_show_video_tag_date', names = ['videos_json', 'tags_json'];
const db = await mysql.createConnection(address);
const read = async () => {
  const [rows] = await db.query("SELECT COLUMN_NAME name, DATA_TYPE type, CHARACTER_SET_NAME charset, COLLATION_NAME collation, IS_NULLABLE nullable, COLUMN_DEFAULT fallback FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME IN (?,?) ORDER BY COLUMN_NAME", [table, ...names]);
  if (rows.length !== names.length) throw new Error(`${table} payload columns not found.`);
  return rows;
};
try {
  const columns = await read();
  const [[size]] = await db.query(`SELECT COUNT(*) rows_total, MAX(OCTET_LENGTH(videos_json)) videos, MAX(OCTET_LENGTH(tags_json)) tags FROM ${table}`);
  const before = { columns: columns.map(c => ({ name: c.name, type: c.type, charset: c.charset, collation: c.collation, nullable: c.nullable, default: c.fallback })), rows: Number(size.rows_total), longest: { videos_json: size.videos === null ? null : Number(size.videos), tags_json: size.tags === null ? null : Number(size.tags) } };
  const narrow = columns.filter(c => String(c.type).toLowerCase() !== 'longtext');
  if (!narrow.length) console.log(JSON.stringify({ mode: execute ? 'execute' : 'preview', status: 'already-longtext', before }));
  else {
    const clauses = narrow.map(c => {
      if (!/^[a-z0-9_]+$/.test(c.charset) || !/^[a-z0-9_]+$/.test(c.collation)) throw new Error('Unexpected column charset or collation.');
      const fallback = c.fallback === null || c.fallback === 'NULL' ? (c.nullable === 'YES' ? ' DEFAULT NULL' : '') : null;
      if (fallback === null) throw new Error(`Unexpected non-null default on ${c.name}.`);
      return `MODIFY ${c.name} LONGTEXT CHARACTER SET ${c.charset} COLLATE ${c.collation} ${c.nullable === 'YES' ? 'NULL' : 'NOT NULL'}${fallback}`;
    });
    const statement = `ALTER TABLE ${table} ${clauses.join(', ')}`;
    if (!execute) console.log(JSON.stringify({ mode: 'preview', status: 'would-alter', before, statement }));
    else {
      await db.query(statement);
      const after = await read(), [[count]] = await db.query(`SELECT COUNT(*) rows_total FROM ${table}`);
      if (after.some(c => String(c.type).toLowerCase() !== 'longtext') || Number(count.rows_total) !== before.rows) throw new Error('Column change did not verify.');
      console.log(JSON.stringify({ mode: 'execute', status: 'altered', before, after: { columns: after.map(c => ({ name: c.name, type: c.type, charset: c.charset, collation: c.collation, nullable: c.nullable })), rows: Number(count.rows_total) }, statement }));
    }
  }
} finally {
  await db.end();
}
