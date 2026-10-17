import { expect, it } from 'vitest';
import { validateYoutubeArguments, executeYoutubeWorkflow, youtubeResultState, handleYoutubeCli } from '../src/youtube-cli.js';
import { connectDatabase } from '../src/database.js';
import { isolatedTestEnv } from '../../shared/test-database.js';
import type { RowDataPacket } from 'mysql2/promise';
it('validates exact workflow selection before enqueue/DB access',()=>{
  expect(validateYoutubeArguments(['youtube:channels:videos:live-group','--execute','--limit=1'])).toMatchObject({job:'youtube.channels.videos.live_group',execute:true});
  expect(validateYoutubeArguments(['youtube:comments:queue','--min=0'])).toMatchObject({execute:false});
  for(const args of [ ['toString'], ['youtube:videos:stats','--limit=0'], ['youtube:videos:stats','--limit=2','--limit=3'], ['youtube:videos:stats','--execute','--dry-run'], ['youtube:comments:fetch','--max-pages=101'], ['youtube:channels:retire','--restore'], ['youtube:channels:stats','--u_id=1','--channel=2'], ['youtube:videos:stats','--unknown'], ['youtube:tag-videos:backfill','--tagid=0'], ['youtube:tag-videos:backfill','--tagid=102','--to=2026-02-30'], ['youtube:channels:stats','--execute=true'] ]) expect(()=>validateYoutubeArguments(args)).toThrow();
});
it.skipIf(process.env.JOBS_DB_TEST !== '1')('writer session always enforces strict SQL semantics',async()=>{
  const db=await connectDatabase(isolatedTestEnv());
  try { const[rows]=await db.query<RowDataPacket[]>('SELECT @@sql_mode AS mode');expect(rows[0]?.mode.split(',')).toContain('STRICT_ALL_TABLES'); }
  finally { await db.end(); }
});
it('scheduled source execution rejects missing exact ownership and scheduler gates before DB connection',async()=>{
  const env={APP_ENV:'test',TS_INGESTION_ENABLED:'true',TS_INGESTION_OWNERS:'youtube.channels.stats'};
  await expect(executeYoutubeWorkflow(['youtube:comments:fetch','--execute'],env,true)).rejects.toThrow('ownership');
  await expect(executeYoutubeWorkflow(['youtube:channels:stats','--execute'],env,true)).rejects.toThrow('Scheduler');
});
it('normal bounded continuation differs from errors and handler ignores prototype command names',async()=>{
  expect(youtubeResultState({skipped:[],checkpointed:['video']})).toBe('incomplete');
  expect(youtubeResultState({skipped:[{uId:3724,reason:'api-item-missing-or-invalid'}],applied:[1]})).toBe('incomplete');
  expect(youtubeResultState({skipped:[{uId:1}],stoppedReason:'quota-budget'})).toBe('failed');
  expect(youtubeResultState({skipped:[],truncated:true})).toBe('incomplete');
  expect(youtubeResultState({skipped:[],stoppedReason:'quota-budget'})).toBe('failed');
  expect(youtubeResultState({skipped:[],stoppedReason:'quota-exhausted'})).toBe('skipped');
  expect(youtubeResultState({skipped:[],applied:['video'],stoppedReason:'quota-exhausted'})).toBe('incomplete');
  expect(youtubeResultState({skipped:[],enqueued:['video'],stoppedReason:'quota-exhausted'})).toBe('incomplete');
  expect(youtubeResultState({skipped:[],checkpointed:['video'],stoppedReason:'quota-exhausted'})).toBe('incomplete');
  expect(youtubeResultState({skipped:[],capacityBlocked:'stage-size'})).toBe('incomplete');
  expect(youtubeResultState({skipped:[{reason:'invalid-source'}],capacityBlocked:'stage-size'})).toBe('incomplete');
  expect(youtubeResultState({skipped:[{reason:'invalid-source'}]})).toBe('incomplete');
  expect(youtubeResultState({skipped:[]})).toBe('completed');
  expect(await handleYoutubeCli(['toString'],{})).toBe(false);
});
