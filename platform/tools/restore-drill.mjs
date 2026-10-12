import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

// Disposable local drill only. This cannot receive a production host/name/credential.
const source = 'youtube_board_rewrite';
if (process.env.APP_ENV === 'production' || process.env.NODE_ENV === 'production' || process.argv.slice(2).some(arg => arg !== '--execute')) throw new Error('Restore drill only supports local --execute');
if (!process.argv.includes('--execute')) {
  console.log(JSON.stringify({ mode: 'preview', source, target: 'new randomly named local restore database', externalCalls: 0, note: 'Locks local preview tables while dumping; validates exact rows, engines, table/column schemas and triggers, then drops only its newly created restore database.' }));
  process.exit(0);
}
const cwd = fileURLToPath(new URL('..', import.meta.url));
const id = randomUUID().replaceAll('-', ''), target = `youtube_board_restore_${id}_rewrite`;
const composeEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(DOCKER_|COMPOSE_)/.test(key)));
const directory = `${cwd}.local/restore-drill/${id}`;
await mkdir(directory, { recursive: true, mode: 0o700 });
const dump = `${directory}/preview.sql`;
let admin;
let created = false, stage = 'connect';
const comparisons = {};
const identityLock = `restore-drill-${id}`;
async function command(args, input, output) {
  const child = spawn('docker', ['--host', 'unix:///var/run/docker.sock', 'compose', '--project-directory', cwd, '-f', `${cwd}compose.yml`, '-p', 'youtube-board-rewrite', 'exec', '-T', ...args], { cwd, env: composeEnv, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stderr.resume(); // dump errors may contain source data; never print them
  const completion = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error('Local database command failed')));
  });
  const timeout = setTimeout(() => child.kill('SIGKILL'), 130000);
  const captured = []; let bytes = 0;
  try {
    const streams = [];
    if (input) streams.push(pipeline(createReadStream(input), child.stdin)); else child.stdin.end();
    if (output) streams.push(pipeline(child.stdout, createWriteStream(output, { mode: 0o600, flags: 'wx' }))); else child.stdout.on('data', chunk => { bytes += chunk.length; if (bytes > 16384) child.kill('SIGKILL'); else captured.push(chunk); });
    await Promise.all([completion, ...streams]);
    if (bytes > 16384) throw new Error('Local command output limit exceeded');
    return Buffer.concat(captured).toString('utf8').trim();
  } finally { clearTimeout(timeout); }
}
async function fingerprint(database) {
  const [tables] = await admin.execute('SELECT TABLE_NAME,ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_TYPE=\'BASE TABLE\' ORDER BY TABLE_NAME', [database]);
  const result = [];
  for (const table of tables) {
    if (!/^[a-zA-Z0-9_]+$/.test(table.TABLE_NAME)) throw new Error('Unexpected local table name');
    const [columns] = await admin.execute('SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,EXTRA,CHARACTER_SET_NAME,COLLATION_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY ORDINAL_POSITION', [database, table.TABLE_NAME]);
    const [definition] = await admin.query(`SHOW CREATE TABLE \`${database}\`.\`${table.TABLE_NAME}\``);
    const [rows] = await admin.query(`SELECT * FROM \`${database}\`.\`${table.TABLE_NAME}\``);
    const hashes = rows.map(row => createHash('sha256').update(JSON.stringify(row)).digest('hex')).sort();
    result.push({ table: table.TABLE_NAME, engine: table.ENGINE, ddlHash: createHash('sha256').update(definition[0]['Create Table']).digest('hex'), rows: rows.length, rowHash: createHash('sha256').update(hashes.join('\n')).digest('hex'), schemaHash: createHash('sha256').update(JSON.stringify(columns)).digest('hex') });
  }
  const [triggers] = await admin.execute('SELECT TRIGGER_NAME,EVENT_MANIPULATION,EVENT_OBJECT_TABLE,ACTION_ORDER,ACTION_CONDITION,ACTION_STATEMENT,ACTION_ORIENTATION,ACTION_TIMING,SQL_MODE,DEFINER,CHARACTER_SET_CLIENT,COLLATION_CONNECTION,DATABASE_COLLATION FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=? ORDER BY TRIGGER_NAME', [database]);
  return { tables: result, triggers: triggers.map(trigger => ({ name: trigger.TRIGGER_NAME, hash: createHash('sha256').update(JSON.stringify(trigger)).digest('hex') })) };
}
try {
  admin = await mysql.createConnection({ host: '127.0.0.1', port: 23306, user: 'root', password: 'youtube_rewrite_root_local', dateStrings: true, supportBigNumbers: true, bigNumberStrings: true, charset: 'utf8mb4_bin' });
  stage = 'source-identity';
  const [[identity]] = await admin.execute('SELECT CONNECTION_ID() AS id, GET_LOCK(?,0) AS acquired', [identityLock]);
  if (Number(identity.acquired) !== 1) throw new Error('Cannot acquire local identity lock');
  const observed = await command(['-e', 'MYSQL_PWD=youtube_rewrite_root_local', 'db', 'timeout', '--kill-after=5s', '120s', 'mariadb', '--user=root', '--batch', '--skip-column-names', '-e', `SELECT IS_USED_LOCK('${identityLock}')`]);
  if (observed !== String(identity.id)) throw new Error('Docker database differs from loopback source');
  stage = 'schema-preflight';
  const [[unsupported]] = await admin.execute("SELECT (SELECT COUNT(*) FROM information_schema.VIEWS WHERE TABLE_SCHEMA=?) + (SELECT COUNT(*) FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA=?) + (SELECT COUNT(*) FROM information_schema.EVENTS WHERE EVENT_SCHEMA=?) AS total", [source,source,source]);
  if (Number(unsupported.total) !== 0) throw new Error('Drill supports base tables and triggers only');
  const [schema] = await admin.execute('SELECT DEFAULT_CHARACTER_SET_NAME AS charset,DEFAULT_COLLATION_NAME AS collation FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?', [source]);
  if (schema.length !== 1 || !/^[a-zA-Z0-9_]+$/.test(schema[0].charset) || !/^[a-zA-Z0-9_]+$/.test(schema[0].collation)) throw new Error('Local preview schema missing');
  stage = 'source-fingerprint';
  const before = comparisons.before = await fingerprint(source);
  stage = 'dump';
  await command(['-e', 'MYSQL_PWD=youtube_rewrite_local', 'db', 'timeout', '--kill-after=5s', '120s', 'mariadb-dump', '--user=youtube_rewrite', '--lock-tables', '--hex-blob', '--skip-comments', source], null, dump);
  const raw = await readFile(dump), sql = raw.toString('utf8');
  if (/^\s*(?:(?:CREATE|DROP|ALTER)\s+DATABASE\b|USE\s+)/im.test(sql)) throw new Error('Dump contains database switching statements');
  stage = 'create-target';
  await admin.query(`CREATE DATABASE \`${target}\` CHARACTER SET ${schema[0].charset} COLLATE ${schema[0].collation}`);
  created = true;
  stage = 'restore';
  await command(['-e', 'MYSQL_PWD=youtube_rewrite_root_local', 'db', 'timeout', '--kill-after=5s', '120s', 'mariadb', '--user=root', target], dump, null);
  stage = 'verify';
  const restored = comparisons.restored = await fingerprint(target), after = comparisons.after = await fingerprint(source);
  const [restoredSchema] = await admin.execute('SELECT DEFAULT_CHARACTER_SET_NAME AS charset,DEFAULT_COLLATION_NAME AS collation FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?', [target]);
  if (JSON.stringify(schema) !== JSON.stringify(restoredSchema)) throw new Error('Database character set differs');
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Local source changed during drill; repeat with preview writers stopped');
  if (JSON.stringify(before) !== JSON.stringify(restored)) throw new Error('Restored schema, engine or row digest differs');
  const manifest = { performedAt: new Date().toISOString(), source, localOnly: true, tables: before.tables.length, triggers: before.triggers.length, rows: before.tables.reduce((sum, t) => sum + t.rows, 0), dumpSha256: createHash('sha256').update(raw).digest('hex'), result: 'exact-row-table-and-trigger-match', tablesVerified: before };
  await writeFile(`${directory}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify({ result: manifest.result, tables: manifest.tables, rows: manifest.rows, manifest: `.local/restore-drill/${id}/manifest.json`, scope: 'local preview only; not proof of a production backup' }));
} catch {
  await writeFile(`${directory}/failure.json`, JSON.stringify({ stage, target: created ? target : null, comparisons }, null, 2) + '\n', { mode: 0o600 }).catch(() => {});
  process.stderr.write(`Local restore drill failed at ${stage}; private hash diagnostics retained.\n`);
  process.exitCode = 1;
} finally {
  try { if (created) await admin.query(`DROP DATABASE \`${target}\``); }
  catch { process.exitCode = 1; process.stderr.write(`Local restore cleanup failed; inspect ${target} before dropping it manually.\n`); }
  finally { await admin?.end(); }
}
