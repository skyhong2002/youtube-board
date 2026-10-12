/** Runs the real upstream producer/routes against the real downstream importer.
 * Synthetic inputs only; HTTP is in-process injection and DB is fixed local test.
 * Usage: node --import tsx tools/verify-vocabulary-contract.mjs --upstream=/path/to/reviewed/checkout
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { connectDatabase, withWriterLock } from '../jobs/src/database.ts';
import { HttpSnapshotSource } from '../jobs/src/snapshot-client.ts';
import { importSnapshot } from '../jobs/src/snapshot-import.ts';
import { loadVocabularySnapshot } from '../jobs/src/load-vocabulary.ts';
import { SOURCE, VOCABULARY_JOB } from '../jobs/src/vocabulary.ts';

const args = process.argv.slice(2);
if (args.length !== 1 || !args[0].startsWith('--upstream=') || !args[0].slice(11))
  throw new Error('Provide exactly --upstream=/path/to/reviewed/tag/checkout');
const upstream = resolve(args[0].slice(11));
const { VocabularySnapshots } = await import(pathToFileURL(join(upstream, 'app/src/vocabulary/snapshots.ts')).href);
const { registerVocabulary } = await import(pathToFileURL(join(upstream, 'app/src/v1/vocabulary.ts')).href);
const Fastify = createRequire(join(upstream, 'app/package.json'))('fastify');
const directory = await mkdtemp(join(tmpdir(), 'youtube-tag-contract-'));
const app = Fastify({ logger: false });
registerVocabulary(app, directory);
const producer = new VocabularySnapshots(directory);
let db, laneOwned = false;
const ids = [];
let requests = 0, failSecondPage = false, tamper = null, report;
const fingerprint = async base => Object.fromEntries(await Promise.all((base === upstream ? ['app/src/vocabulary/snapshots.ts', 'app/src/v1/vocabulary.ts'] : ['jobs/src/snapshot-client.ts','jobs/src/snapshot-import.ts','jobs/src/load-vocabulary.ts','tools/verify-vocabulary-contract.mjs']).map(async file => [file, createHash('sha256').update(await readFile(join(base, file))).digest('hex')])));
const source = new HttpSnapshotSource(async (input, options) => {
  const url = new URL(String(input));
  assert.equal(url.origin, SOURCE);
  assert.equal(options.redirect, 'error');
  assert.equal(options.headers.Accept, 'application/json');
  assert.ok(url.pathname.startsWith('/api/v1/vocabulary/'));
  options.signal.throwIfAborted();
  requests++;
  if (failSecondPage && url.searchParams.get('cursor') === '1') { failSecondPage = false; return new Response('', { status: 503 }); }
  const reply = await app.inject({ method: 'GET', url: url.pathname + url.search });
  let body = reply.body;
  if (tamper && url.pathname.includes('/snapshots/') && !url.pathname.endsWith('/current') && reply.statusCode === 200) { const value = JSON.parse(body); tamper(value); body = JSON.stringify(value); }
  return new Response(body, { status: reply.statusCode, headers: reply.headers });
});
const row = tag => ({ tag, articleCount: 3, firstPublishedAt: '2026-01-01T00:00:00.000Z', lastPublishedAt: '2026-10-01T00:00:00.000Z' });
let generation = 0;
async function publish(rows) {
  const manifest = await producer.publish(async () => rows, new Date(Date.UTC(2026, 9, 12, generation++)));
  ids.push(`tag-${manifest.id}`);
  return manifest;
}
try {
  // Never inherit production destinations, credentials, gates or API keys.
  db = await connectDatabase({ APP_ENV: 'test', DB_HOST: '127.0.0.1', DB_PORT: '23306', DB_DATABASE: 'youtube_board_test_rewrite', DB_USERNAME: 'youtube_rewrite', DB_PASSWORD: 'youtube_rewrite_local' });
  const [lane] = await db.query("SELECT GET_LOCK('youtube-board-test-integration-lane',0) AS acquired");
  laneOwned = Number(lane[0]?.acquired) === 1;
  if (!laneOwned) throw new Error('Another integration lane holds the isolated database');
  await withWriterLock(db, VOCABULARY_JOB, async ownership => {
    const [before] = await db.query('SELECT run_id FROM ts_vocabulary_current WHERE source = ?', [SOURCE]);
    try {
      await db.execute('DELETE FROM ts_vocabulary_current WHERE source = ?', [SOURCE]);
      await assert.rejects(source.current(), /404/);
      const rows = [...Array.from({ length: 500 }, (_, i) => row(`詞${String(i).padStart(4, '0')}`)), ...['AI', 'ai', 'é', 'e\u0301', '影像😀', '有影儀表板'].map(row)];
      const first = await publish(rows);
      assert.equal(first.pages.length, 2);
      const pinned = await source.current();
      const originalPage = await source.page(pinned, 0);
      failSecondPage = true;
      await assert.rejects(importSnapshot(db, source, 2, ownership, async () => {}), /503/);
      const [staged] = await db.query('SELECT status,pages FROM ts_vocabulary_runs WHERE id=?', [`tag-${first.id}`]);
      assert.equal(staged[0].status, 'scanning'); assert.equal(Number(staged[0].pages), 1);
      const [unpublished] = await db.query('SELECT run_id FROM ts_vocabulary_current WHERE source=?', [SOURCE]); assert.equal(unpublished.length, 0);
      const imported = await importSnapshot(db, source, 2, ownership, async () => {});
      assert.equal(imported.status, 'published');
      const hydrated = await loadVocabularySnapshot(db);
      assert.equal(hydrated.id, `tag-${first.id}`);
      assert.equal(hydrated.terms.length, 506);
      assert.deepEqual(new Set(hydrated.terms.map(t => t.term)), new Set(rows.map(r => r.tag)));
      for (const term of hydrated.terms) assert.equal(term.upstreamId, createHash('sha256').update(term.term).digest('hex')); 
      assert.equal(new Set(hydrated.terms.map(t => t.upstreamId)).size, 506);
      assert.deepEqual(hydrated.upstreamManifest, first);
      assert.ok(hydrated.terms.every(t => t.upstream.journalistAssigned === null));
      const second = await publish([row('AI'), row('新詞')]);
      assert.deepEqual(await source.page(pinned, 0), originalPage);
      const changeResponse = await app.inject(`/api/v1/vocabulary/changes?after=${first.id}&target=${second.id}`);
      assert.equal(changeResponse.statusCode, 200);
      for (const mutate of [v => { v.entries[0].articleCount++; }, v => { v.nextCursor = '999'; }, v => { v.snapshot.generatedAt = '2026-10-13T00:00:00.000Z'; }]) {
        tamper = mutate;
        await assert.rejects(importSnapshot(db, source, 2, ownership, async () => {}), /checksum, count or cursor mismatch|snapshot changed while paging/);
        assert.equal((await loadVocabularySnapshot(db)).id, hydrated.id);
      }
      tamper = null;
      const path = join(directory, second.id, 'terms-0.json');
      const original = await readFile(path, 'utf8');
      await writeFile(path, '[]\n');
      await assert.rejects(importSnapshot(db, source, 2, ownership, async () => {}), /503/);
      assert.equal((await loadVocabularySnapshot(db)).id, hydrated.id);
      await writeFile(path, original);
      assert.equal((await importSnapshot(db, source, 2, ownership, async () => {})).status, 'published');
      assert.deepEqual((await loadVocabularySnapshot(db)).terms.map(t => t.term).sort(), ['AI', '新詞']);
      assert.equal((await loadVocabularySnapshot(db, hydrated.id)).terms.length, 506);
      assert.equal((await importSnapshot(db, source, 2, ownership)).status, 'already-published');
      const empty = await publish([]);
      assert.equal((await importSnapshot(db, source, 1, ownership)).total, 0);
      assert.equal((await loadVocabularySnapshot(db)).id, `tag-${empty.id}`);
      assert.deepEqual((await loadVocabularySnapshot(db)).terms, []);
      assert.equal((await app.inject(`/api/v1/vocabulary/changes?after=${first.id}&target=${empty.id}`)).statusCode, 409);
      report = { status: 'passed', executedAt: new Date().toISOString(), upstream, sourceFingerprints: { upstream: await fingerprint(upstream), downstream: await fingerprint(process.cwd()) }, synthetic: true, httpTransport: 'Fastify.inject (no external HTTP)', injectedHttpRequests: requests, snapshots: ids.length, terms: hydrated.terms.length, checks: ['real producer and HTTP serialization', 'two-page checksum and exact Unicode identity', 'real DB publication and hydration', 'pinned historical pages', 'producer rejects corrupt page and importer retains current', 'consumer rejects transport mutation', 'partially staged retry and published replay', 'removed terms preserve history', 'empty snapshot', 'upstream-only change-generation gap'] };
    } finally {
      // Restore the previous pointer before removing this run's synthetic history.
      if (before[0]) await db.execute('INSERT INTO ts_vocabulary_current(source,run_id) VALUES (?,?) ON DUPLICATE KEY UPDATE run_id=VALUES(run_id)', [SOURCE, before[0].run_id]);
      else for (const id of ids) await db.execute('DELETE FROM ts_vocabulary_current WHERE source=? AND run_id=?', [SOURCE, id]);
      for (const id of ids) {
        await db.execute('DELETE FROM ts_vocabulary_terms WHERE run_id=?', [id]);
        await db.execute('DELETE FROM ts_vocabulary_runs WHERE id=?', [id]);
      }
    }
  });
} finally {
  if (db) {
    if (laneOwned) await db.query("SELECT RELEASE_LOCK('youtube-board-test-integration-lane')").catch(() => {});
    await db.end();
  }
  await app.close();
  await rm(directory, { recursive: true, force: true });
}

console.log(JSON.stringify({ ...report, cleanup: 'completed' }, null, 2));
