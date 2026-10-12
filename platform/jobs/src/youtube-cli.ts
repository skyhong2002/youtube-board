import { withLaravelSourceLock } from './laravel-source-lock.js';
import { workflowShutdownSignal } from '../../shared/shutdown.js';
import { randomUUID } from 'node:crypto';
import { channelStatisticsJob, channelRetirementJob, channelUploadsJob, videoDurationsJob, commentQueueJob, commentFetchJob, commentResetJob, MysqlQuotaLedger, YoutubeDataApiClient, videoStatisticsJob, livePollingJob, tagBackfillJob, taipeiSql, type BackfillInput, type TagDictionary } from '@youtube-board/ingestion';
import { connectDatabase, withWriterLock } from './database.js';
import { assertExecute, executionPolicy } from './policy.js';
import { loadVocabularySnapshot } from './load-vocabulary.js';
import { matchVocabulary } from './match.js';
export const youtubeCommands = { 'youtube:tvbs:videos': 'youtube.tvbs.videos', 'youtube:tvbs:live:poll': 'youtube.tvbs.live.poll', 'youtube:channels:stats': 'youtube.channels.stats', 'youtube:channels:retire': 'youtube.channels.retire', 'youtube:channels:videos': 'youtube.channels.videos.general', 'youtube:channels:videos:live-group': 'youtube.channels.videos.live_group', 'youtube:channels:videos:live': 'youtube.channels.videos.live', 'youtube:videos:duration': 'youtube.videos.duration', 'youtube:comments:queue': 'youtube.comments.queue', 'youtube:comments:fetch': 'youtube.comments.fetch', 'youtube:comments:reset': 'youtube.comments.reset', 'youtube:videos:stats': 'youtube.videos.stats', 'youtube:live:poll': 'youtube.live.poll', 'youtube:tag-videos:backfill': 'youtube.tag_videos.backfill' } as const;
export function youtubeResultState(result: { skipped: unknown[]; applied?:unknown[]; enqueued?:unknown[]; truncated?: boolean; checkpointed?: unknown[]; stoppedReason?: string; capacityBlocked?: string }): 'failed' | 'incomplete' | 'completed' | 'skipped' {
  if(result.skipped.length)return 'failed';
  if(result.stoppedReason==='quota-exhausted')return result.applied?.length || result.enqueued?.length || result.checkpointed?.length ? 'incomplete' : 'skipped';
  if (result.stoppedReason) return 'failed';
  if(result.capacityBlocked)return 'incomplete';
  return result.truncated || result.checkpointed?.length ? 'incomplete' : 'completed';
}
/** Pure validation for CLI and queue ingress: no database or provider requests. */
export function validateYoutubeArguments(args: string[]) {
  if (!Array.isArray(args) || args.length > 25 || args.some(a => typeof a !== 'string' || a.length > 1000) || !args[0] || !Object.hasOwn(youtubeCommands, args[0])) throw new Error('Unknown YouTube source command');
  const command = args[0] as keyof typeof youtubeCommands, job = youtubeCommands[command];
  const options = job === 'youtube.channels.stats' ? ['u_id','channel','hours']
    : job === 'youtube.channels.retire' ? ['u_id','channel','stale-days','restore']
    : (job.startsWith('youtube.channels.videos.') || job === 'youtube.tvbs.videos') ? ['u_id','channel','days','max-pages','max-results']
    : job === 'youtube.videos.duration' ? ['videoId','enqueue-missing']
    : job === 'youtube.comments.queue' ? ['u_id','channel','videoId','hours','min','tagid']
    : job === 'youtube.comments.fetch' ? ['videoId','max-pages','max-reply-pages','max-state-mib']
    : job === 'youtube.comments.reset' ? ['videoId']
    : job === 'youtube.videos.stats' ? ['videoId','today']
    : (job === 'youtube.live.poll' || job === 'youtube.tvbs.live.poll') ? ['videoId','interval','stale-seconds']
    : ['tagid','or','not','from','to','days','max-pages','max-results','video-limit','no-cache','vocabulary-version'];
  const allowed = new Set(['execute','dry-run','limit','max-api-attempts', ...options]), parsed = new Map<string,string>();
  const flags = new Set(['execute','dry-run','restore','enqueue-missing','today','no-cache']);
  for (const arg of args.slice(1)) {
    const match = /^--([A-Za-z_-]+)(?:=(.*))?$/.exec(arg);
    if (!match || !allowed.has(match[1]!) || parsed.has(match[1]!) || (flags.has(match[1]!) ? match[2] !== undefined : !match[2])) throw new Error('Unknown, duplicate or malformed source argument');
    parsed.set(match[1]!, match[2] ?? '');
  }
  if ((parsed.has('execute') && parsed.has('dry-run')) || (parsed.has('channel') && parsed.has('u_id'))) throw new Error('Conflicting source arguments');
  const maximum: Record<string,number> = { u_id:2147483647, channel:2147483647, hours:job === 'youtube.comments.queue' ? 720 : 168, 'stale-days':365, days:job === 'youtube.tag_videos.backfill' ? 31 : 365, 'max-api-attempts':1000, 'max-pages':job === 'youtube.comments.fetch' ? 3 : 200, 'max-reply-pages':100, 'max-state-mib':64, 'max-results':50, 'video-limit':20000, interval:240, 'stale-seconds':3600, min:10000000, limit:job === 'youtube.comments.queue' ? 20 : job === 'youtube.comments.fetch' ? 10 : job === 'youtube.tag_videos.backfill' ? 500 : (job.startsWith('youtube.channels.videos.') || job === 'youtube.tvbs.videos') ? 100 : 50 };
  for (const [name,value] of parsed) {
    if (name in maximum && (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < (name === 'min' ? 0 : name === 'stale-days' || (name === 'days' && (job.startsWith('youtube.channels.videos.') || job === 'youtube.tvbs.videos')) ? 7 : 1) || Number(value) > maximum[name]!)) throw new Error(`Invalid ${name} cap`);
    if (name === 'videoId' && !/^[A-Za-z0-9_-]{1,32}$/.test(value)) throw new Error('Invalid video identity');
    if (['tagid','or','not'].includes(name) && (!/^\d+(,\d+)*$/.test(value) || value.split(',').length > 20 || value.split(',').some(v => Number(v) < 1 || Number(v) > 2147483647))) throw new Error('Invalid taxonomy IDs');
    if (['from','to'].includes(name) && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,10) !== value)) throw new Error('Invalid source date');
    if (name === 'vocabulary-version' && !/^[A-Za-z0-9_-]{1,100}$/.test(value)) throw new Error('Invalid vocabulary version');
  }
  if (job === 'youtube.comments.reset' && !parsed.has('videoId')) throw new Error('Reset requires explicit video identity');
  if (parsed.has('restore') && !parsed.has('u_id') && !parsed.has('channel')) throw new Error('Restore requires explicit channel');
  if (job === 'youtube.tag_videos.backfill' && !parsed.has('tagid') && !parsed.has('or')) throw new Error('Backfill requires explicit taxonomy selection');
  if (parsed.has('from') && parsed.has('to')) { const days = (Date.parse(parsed.get('to')!) - Date.parse(parsed.get('from')!)) / 86400000 + 1; if (days < 1 || days > 31) throw new Error('Backfill range must be 1–31 days'); }
  return { command, job, execute: parsed.has('execute') };
}
export async function executeYoutubeWorkflow(args: string[], env: NodeJS.ProcessEnv, scheduled = false) {
  const { job, execute } = validateYoutubeArguments(args);
  const policy = executionPolicy(env, execute ? 'execute' : 'dry-run', scheduled);
  if (execute) assertExecute(job, policy);
  const option = (name: string) => args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  const integer = (name: string, fallback: number, max: number) => { const value = Number(option(name) ?? fallback); if (!Number.isInteger(value) || value < 1 || value > max) throw new Error(`Invalid ${name} cap`); return value; };
  const list = (name: string) => option(name)?.split(',').map(Number) ?? [];
  const maxAttempts = integer('max-api-attempts', 200, 1000);
  const db = await connectDatabase(env);
  try {
    const youtube = new YoutubeDataApiClient({ keys: [env.YOUTUBE_API_KEY ?? '', ...(env.YOUTUBE_API_KEYS ?? '').split(',')], ledger: new MysqlQuotaLedger(db, Number(env.INGESTION_YOUTUBE_DAILY_QUOTA_BUDGET ?? 9000)), maxAttempts });
    const work = async (assertOwnership: () => Promise<void>) => {
      const now = new Date(), ctx = { db, youtube, now, clock:()=>new Date(), execute, assertOwnership };
      const videoId = option('videoId');
      const specific = videoId ? { videoId } : {};
      const uId = option('u_id') ?? option('channel');
      const channel = uId === undefined ? {} : { uId: Number(uId) };
      if (job === 'youtube.channels.stats') return channelStatisticsJob(ctx, { ...channel, limit: integer('limit', 25, 50), hours: integer('hours', 22, 168) });
      if (job === 'youtube.channels.retire') return channelRetirementJob(ctx, { ...channel, limit: integer('limit', 25, 50), staleDays: integer('stale-days', 14, 365), restore: args.includes('--restore') });
      if ((job.startsWith('youtube.channels.videos.') || job === 'youtube.tvbs.videos')) return channelUploadsJob(ctx, { ...channel, limit: integer('limit', 20, 100), tvbs: job === 'youtube.tvbs.videos', maxPages: integer('max-pages', 1, 200), maxResults:integer('max-results',5,50), days: integer('days', 7, 365), ...(job.endsWith('live_group') ? { live: 1 as const } : job.endsWith('.live') ? { live: 2 as const } : {}) });
      if (job === 'youtube.videos.duration') return videoDurationsJob(ctx, { ...specific, limit: integer('limit', 50, 50), enqueueMissing: args.includes('--enqueue-missing') });
      if (job === 'youtube.comments.queue') return commentQueueJob(ctx, { ...specific, ...channel, limit: integer('limit', 20, 20), hours: integer('hours', 24, 720), min: Number(option('min') ?? 500), tagIds: list('tagid') });
      if (job === 'youtube.comments.reset') return commentResetJob(ctx, videoId!);
      if (job === 'youtube.comments.fetch') return commentFetchJob(ctx, { ...specific, limit: integer('limit', 1, 10), maxPages: integer('max-pages', 1, 3), maxReplyPages: integer('max-reply-pages', 20, 100), maxStateMiB:integer('max-state-mib',12,64) });
      if (job === 'youtube.videos.stats') return videoStatisticsJob(ctx, { ...specific, limit: integer('limit', 50, 50), today: args.includes('--today') });
      if (job === 'youtube.live.poll' || job === 'youtube.tvbs.live.poll') return livePollingJob(ctx, { ...specific, tvbs: job === 'youtube.tvbs.live.poll', staleSeconds: integer('stale-seconds', 40, 3600), limit: integer('limit', 50, 50), intervalMinutes: integer('interval', 11, 240) });
      const to = option('to') ?? taipeiSql(now).slice(0, 10), days = integer('days', 2, 31);
      const from = option('from') ?? new Date(Date.parse(to + 'T00:00:00Z') - (days - 1) * 86400000).toISOString().slice(0, 10);
      const input: BackfillInput = { tagIds: list('tagid'), orTagIds: list('or'), notTagIds: list('not'), from, to, channelLimit: integer('limit', 100, 500), maxPages: integer('max-pages', 20, 200), maxResults: integer('max-results', 50, 50), videoLimit: integer('video-limit', 20000, 20000), rebuildCache: !args.includes('--no-cache') };
      let dictionary: TagDictionary | undefined;
      if (input.rebuildCache) {
        const snapshot = await loadVocabularySnapshot(db, option('vocabulary-version'));
        dictionary = { version: snapshot.id, coverage: snapshot.coverage, rule: 'youtube-tag-exact-v1-title2-length', match: (title, description) => matchVocabulary({ title, description }, snapshot) };
      }
      return tagBackfillJob(ctx, input, dictionary);
    };
    // Shared lock serializes overlapping source/cache writes among the reviewed TS YouTube jobs.
    if (!execute) return await work(async () => {});
    return await withWriterLock(db, 'youtube.source-and-caches', async assertTsOwnership => withLaravelSourceLock(db,job==='youtube.comments.reset'?'youtube.comments.fetch':job,env,async assertLaravelOwnership => {
      const assertOwnership=async()=>{workflowShutdownSignal().throwIfAborted();await assertTsOwnership();await assertLaravelOwnership();};
      const execution = randomUUID();
      await db.execute('INSERT INTO ts_job_runs (job_key,execution_key,status) VALUES (?,?,?)', [job, execution, 'running']);
      try {
        const result = { ...await work(assertOwnership), executionKey: execution };
        await db.execute('UPDATE ts_job_runs SET status=?,result=? WHERE job_key=? AND execution_key=?', [youtubeResultState(result), JSON.stringify(result), job, execution]);
        return result;
      } catch (error) {
        if(error instanceof Error && 'code' in error && error.code==='quota-exhausted') { const result={mode:'execute',selected:0,apiAttempts:youtube.attemptsMade,applied:[],skipped:[],stoppedReason:'quota-exhausted',executionKey:execution};await db.execute('UPDATE ts_job_runs SET status=?,result=? WHERE job_key=? AND execution_key=?',['skipped',JSON.stringify(result),job,execution]);return result;}
        await db.execute('UPDATE ts_job_runs SET status=?,result=? WHERE job_key=? AND execution_key=?', ['failed', JSON.stringify({ error: error instanceof Error && error.name === 'YoutubeError' ? error.message : 'source-workflow-failed', apiAttempts: youtube.attemptsMade }), job, execution]).catch(() => undefined);
        throw error;
      }
    }));
  } finally { await db.end(); }
}

export async function handleYoutubeCli(args: string[], env: NodeJS.ProcessEnv): Promise<boolean> {
  if (!args[0] || !Object.hasOwn(youtubeCommands, args[0])) return false;
  const result = await executeYoutubeWorkflow(args, env);
  console.log(JSON.stringify(result, null, 2));
  if (youtubeResultState(result) === 'failed') process.exitCode = 2;
  return true;
}
