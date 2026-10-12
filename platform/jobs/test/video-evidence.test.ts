import {buildDescriptionTemplateProfile} from '../src/description-templates.js';
import {MATCH_RULE,VIDEO_QUALITY_JOB} from '../src/video-evidence.js';
const profile=buildDescriptionTemplateProfile(1,[]);
import { isolatedTestEnv } from '../../shared/test-database.js';
import { it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { evidenceForVideo, storeVideoEvidence,storeUnavailableVideoQuality,videoQualityKey } from '../src/video-evidence.js';
import { aggregateTerms, SOURCE, type VocabularySnapshot } from '../src/vocabulary.js';
import { MysqlVocabularyStore } from '../src/mysql-vocabulary-store.js';
import { connectDatabase, withWriterLock } from '../src/database.js';
import type { RowDataPacket } from 'mysql2/promise';
const snapshot = { id: 'test', source: SOURCE, window: { since: '2026-10-08T00:00:00.000Z', until: '2026-10-09T00:00:00.000Z' }, publishedAt: '', matchingRule:'youtube-quality-v2', coverage: 'observed-article-window', upstreamSnapshotConsistent: false, terms: aggregateTerms([{ id: '1', media: 'cna', publishedAt: '2026-10-08T01:00:00Z', tags: ['台灣大學', 'AI', 'Jose'] }]) } satisfies VocabularySnapshot;
const video = { channelId:1,pk: 1, videoId: 'Abcdef12345', title: '😀台灣大學 AI 新聞', description: 'Jose\u0301 不應部分命中', observedAt: null };
it('preserves evidence source, offsets, rule and snippet against original source text', () => {
  const result = evidenceForVideo(video, snapshot,profile);
  expect(result.evidence.map(e => e.term)).toEqual(['台灣大學', 'AI']);
  for (const item of result.evidence) {
    expect(item.text).toBe(video[item.field].slice(item.start, item.end));
    expect(item.snippet.slice(item.start - item.snippetStart, item.end - item.snippetStart)).toBe(item.text);
    expect(item.source).toBe(SOURCE); expect(item.method).toBe(MATCH_RULE);
  }
  expect(evidenceForVideo({ ...video, title: video.title + '更新' }, snapshot,profile).sourceHash).not.toBe(result.sourceHash);
});
it.skipIf(process.env.JOBS_DB_TEST !== '1')('evidence writes keep byte-exact video identities, canonical alias provenance and replace stale matches including zero matches', async () => {
  const db = await connectDatabase(isolatedTestEnv());
  const id = 'evidence_test_' + randomUUID().replaceAll('-', '');
  const [previous] = await db.query<RowDataPacket[]>('SELECT run_id FROM ts_vocabulary_current WHERE source = ?', [SOURCE]);
  try {
    await withWriterLock(db, 'evidence-integration-test', async () => {
      const store = new MysqlVocabularyStore(db);
      await store.begin(id, snapshot.window);
      await store.stage(id, null, { articles: [{ id: '1', media: 'cna', publishedAt: snapshot.window.since, tags: ['台灣大學', 'AI', 'ai'] }], nextCursor: null });
      const published = {...await store.publish(id),matchingRule:MATCH_RULE};
      await db.execute("UPDATE ts_vocabulary_runs SET snapshot=JSON_SET(snapshot,'$.matchingRule',?) WHERE id=?",[MATCH_RULE,id]);
      expect(await storeVideoEvidence(db, video, published,profile)).toEqual({ status: 'written', count: 2 });
      expect(await storeVideoEvidence(db, { ...video, pk: 2, observedAt: '2026-10-10 08:00:00' }, published,profile)).toEqual({ status: 'unchanged', count: 2 });
      const [fresh] = await db.query<RowDataPacket[]>('SELECT source_pk, source_observed_at FROM ts_video_tag_matches WHERE video_id = ? AND vocabulary_version = ?', [video.videoId, published.id]);
      expect(Number(fresh[0]?.source_pk)).toBe(2);
      expect(fresh[0]?.source_observed_at).toBe('2026-10-10 08:00:00.000');
      expect(await storeVideoEvidence(db, { ...video, videoId: 'abcdef12345' }, published,profile)).toEqual({ status: 'written', count: 2 });
      expect(await storeVideoEvidence(db, { ...video, title: '完全不相干' }, published,profile)).toEqual({ status: 'written', count: 0 });
      const [markers] = await db.query<RowDataPacket[]>('SELECT video_id, evidence_count FROM ts_video_tag_matches WHERE vocabulary_version = ? ORDER BY video_id', [id]);
      expect(markers.map(m => [m.video_id, m.evidence_count])).toEqual([['Abcdef12345', 0], ['abcdef12345', 2]]);
      const [evidence] = await db.query<RowDataPacket[]>('SELECT video_id FROM ts_video_tag_evidence WHERE vocabulary_version = ?', [id]);
      expect(evidence.map(e => e.video_id)).toEqual(['abcdef12345', 'abcdef12345']);
      const repeated=buildDescriptionTemplateProfile(1,Array.from({length:8},(_,i)=>({pk:i+1,videoId:'Sample'+String(i).padStart(5,'0'),publishedAt:'2026-10-10 12:00:00',description:'AI'}))),body={...video,description:'AI'};
      expect(await storeVideoEvidence(db,body,published,repeated)).toEqual({status:'written',count:2});
      const [audit]=await db.query<RowDataPacket[]>('SELECT result FROM ts_job_runs WHERE job_key=? AND execution_key=?',[VIDEO_QUALITY_JOB,videoQualityKey(id,video.videoId)]);
      const quality=JSON.parse(audit[0]!.result);expect(quality.excluded).toMatchObject([{field:'description',start:0,end:2,text:'AI',reasons:['channel-repeated-line']}]);expect(quality.profile.repeatedLines[0]).not.toHaveProperty('line');
      expect(await storeVideoEvidence(db,body,published,profile)).toEqual({status:'written',count:3});
      expect(await storeVideoEvidence(db,{...video,title:'😀aI',description:''},published,profile)).toEqual({status:'written',count:1});
      const[aliases]=await db.query<RowDataPacket[]>('SELECT term_key,matched_text,start_offset,end_offset FROM ts_video_tag_evidence WHERE video_id=? AND vocabulary_version=?',[video.videoId,id]);
      const keys=published.terms.filter(t=>t.term==='AI'||t.term==='ai').map(t=>t.key).sort();
      expect(aliases).toHaveLength(1);expect(aliases[0]).toMatchObject({term_key:keys[0],matched_text:'aI',start_offset:2,end_offset:4});
      const[aliasAudit]=await db.query<RowDataPacket[]>('SELECT result FROM ts_job_runs WHERE job_key=? AND execution_key=?',[VIDEO_QUALITY_JOB,videoQualityKey(id,video.videoId)]);
      expect(JSON.parse(aliasAudit[0]!.result).acceptedAliases[0].sourceTerms.map((t:{termKey:string})=>t.termKey)).toEqual(keys);
      expect(await storeVideoEvidence(db,body,published,profile)).toEqual({status:'written',count:3});
      expect(await storeVideoEvidence(db,body,published,profile)).toEqual({status:'unchanged',count:3});
      const faulty=new Proxy(db,{get(target,key){if(key==='execute')return async(sql:string,params:unknown[])=>{if(sql.startsWith('INSERT INTO ts_job_runs'))throw new Error('Injected quality audit failure');return target.execute(sql,params as never);};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
      await expect(storeVideoEvidence(faulty,body,published,repeated)).rejects.toThrow('Injected');
      const[rollback]=await db.query<RowDataPacket[]>('SELECT evidence_count FROM ts_video_tag_matches WHERE video_id=? AND vocabulary_version=?',[video.videoId,id]);expect(rollback[0]?.evidence_count).toBe(3);
      const[remaining]=await db.query<RowDataPacket[]>('SELECT COUNT(*) AS n FROM ts_video_tag_evidence WHERE video_id=? AND vocabulary_version=?',[video.videoId,id]);expect(Number(remaining[0]?.n)).toBe(3);
      await storeUnavailableVideoQuality(db,body,published,'sample-timeout');
      const[withheld]=await db.query<RowDataPacket[]>('SELECT rule_version FROM ts_video_tag_matches WHERE video_id=? AND vocabulary_version=?',[video.videoId,id]);expect(withheld[0]?.rule_version).toBe('quality-unavailable-v2');
      expect(await storeVideoEvidence(db,body,published,profile)).toEqual({status:'written',count:3});
    });
  } finally {
    await db.execute("DELETE FROM ts_job_runs WHERE job_key=? AND JSON_UNQUOTE(JSON_EXTRACT(result,'$.vocabularyVersion'))=?",[VIDEO_QUALITY_JOB,id]);
    await db.execute('DELETE FROM ts_video_tag_matches WHERE vocabulary_version = ?', [id]);
    if (previous[0]) await db.execute('UPDATE ts_vocabulary_current SET run_id = ? WHERE source = ? AND run_id = ?', [previous[0].run_id, SOURCE, id]);
    else await db.execute('DELETE FROM ts_vocabulary_current WHERE run_id = ?', [id]);
    await db.execute('DELETE FROM ts_vocabulary_stage WHERE run_id = ?', [id]);
    await db.execute('DELETE FROM ts_vocabulary_runs WHERE id = ?', [id]); await db.end();
  }
});
it.skipIf(process.env.JOBS_DB_TEST !== '1')('batch advances past malformed source rows and can select corrected lower-pk videos by modification time', async () => {
  const { matchVideoBatch } = await import('../src/video-evidence.js');
  const db = await connectDatabase(isolatedTestEnv());
  const base = 1900000000 + Math.floor(Math.random() * 1000000);
  const ids = ['BaTch000001', 'invalid-id', 'BaTch000003'];
  const version = 'batch_' + randomUUID().replaceAll('-', '');
  const [previous] = await db.query<RowDataPacket[]>('SELECT run_id FROM ts_vocabulary_current WHERE source = ?', [SOURCE]);
  try {
    const store = new MysqlVocabularyStore(db);
    await store.begin(version, snapshot.window);
    await store.stage(version, null, { articles: [{ id: '1', media: 'cna', publishedAt: snapshot.window.since, tags: ['台灣'] }], nextCursor: null });
    await store.publish(version);
    await db.execute("UPDATE ts_vocabulary_runs SET snapshot=JSON_SET(snapshot,'$.matchingRule',?) WHERE id=?",[MATCH_RULE,version]);
    for (let index = 0; index < ids.length; index++) await db.execute('INSERT INTO urt_video (pk, ctime, mtime, u_id, id, publishedAt, channelId, title, thumbnails, channelTitle, playlistId, position, videoId, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [base + index, new Date(), new Date('2026-10-11T00:00:00Z'), 1, ids[index], new Date(), 'UC-test', '台灣新聞', '', 'test', '', 0, ids[index], '']);
    const first = await matchVideoBatch({ version, afterPk: base - 1, limit: 2, execute: false, changedSince: '2026-10-10T00:00:00Z' }, isolatedTestEnv());
    expect(first.results.map(r => r.status)).toEqual(['preview', 'invalid']);
    expect(first.nextAfterPk).toBe(base + 1);
    const second = await matchVideoBatch({ version, afterPk: first.nextAfterPk!, limit: 2, execute: false }, isolatedTestEnv());
    expect(second.results[0]?.videoId).toBe(ids[2]);
    const excluded = await matchVideoBatch({ version, afterPk: base - 1, limit: 10, execute: false, changedSince: '2026-10-12T00:00:00Z' }, isolatedTestEnv());
    expect(excluded.processed).toBe(0);
    const offsetExcluded = await matchVideoBatch({ version, afterPk: base - 1, limit: 10, execute: false, changedSince: '2026-10-11T02:00:00+09:00' }, isolatedTestEnv());
    expect(offsetExcluded.results.filter(row => ids.includes(row.videoId ?? ''))).toHaveLength(0);
  } finally {
    for (let index = 0; index < ids.length; index++) await db.execute('DELETE FROM urt_video WHERE pk = ? AND BINARY videoId = BINARY ?', [base + index, ids[index]]);
    if (previous[0]) await db.execute('UPDATE ts_vocabulary_current SET run_id = ? WHERE source = ? AND run_id = ?', [previous[0].run_id, SOURCE, version]);
    else await db.execute('DELETE FROM ts_vocabulary_current WHERE run_id = ?', [version]);
    await db.execute('DELETE FROM ts_vocabulary_stage WHERE run_id = ?', [version]);
    await db.execute('DELETE FROM ts_vocabulary_runs WHERE id = ?', [version]);
    await db.end();
  }
});
