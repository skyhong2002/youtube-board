import {handleQualityCli} from './quality-cli.js';
import { RECENT_VIDEO_EVIDENCE_COMMAND, validateRecentArguments, matchRecentVideoBatch } from './recent-video-evidence.js';
import {planVocabularyBackfill} from './vocabulary-plan.js';
import { assertReportCacheSchema } from './report-schema.js';
import { handleMediaCli } from './media-cli.js';
import { handleCacheCli } from './cache-cli.js';
import { handleNotificationCli } from './notification-cli.js';
import { handleEditorialCli } from './editorial-cli.js';
import { handleGroupStatusCli } from './group-status-cli.js';
import { enqueueWorkflow } from './worker.js';
import { readScheduleConfig, planSchedules, tickSchedules } from './scheduler.js';
import { requestWorkflowShutdown } from '../../shared/shutdown.js';
import { validateWorkflowInput } from './workflow-registry.js';
import { assertSourceCountSchema } from './source-schema.js';
import { handleAiCli } from './ai-cli.js';
import { handleYoutubeCli } from './youtube-cli.js';
import { matchVideoBatch } from './video-evidence.js';
import { executeSnapshotImport, SNAPSHOT_IMPORT_JOB } from './snapshot-import.js';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { migrationStatements } from './migration-statements.js';
import { connectDatabase } from './database.js';
import { executeVocabulary, enqueueVocabulary, startWorker } from './worker.js';
import { executionPolicy } from './policy.js';
import { validateWindow, VOCABULARY_JOB, type VocabularySnapshot } from './vocabulary.js';
import { matchVocabulary } from './match.js';
const args = process.argv.slice(2);
const command = args[0] ?? 'help';
const option = (name: string) => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
async function main() {
  if(await handleQualityCli(args,process.env))return;
  if (command === 'scheduler:tick') {
    const seen = new Set<string>();
    for (const arg of args.slice(1)) {
      const match = /^--(config|at|lookback-minutes|execute)(?:=(.*))?$/.exec(arg);
      if (!match || seen.has(match[1]!) || (match[1] === 'execute' ? match[2] !== undefined : !match[2])) throw new Error('Invalid scheduler argument');
      seen.add(match[1]!);
    }
    const config = await readScheduleConfig(option('config') ?? '');
    const at = option('at');
    if (at && !/(Z|[+-]\d{2}:\d{2})$/.test(at)) throw new Error('Schedule time requires an explicit timezone');
    if (option('lookback-minutes') && !/^\d+$/.test(option('lookback-minutes')!)) throw new Error('Invalid lookback');
    const now = at ? new Date(at) : new Date(), lookback = Number(option('lookback-minutes') ?? 2);
    if (!args.includes('--execute')) return console.log(JSON.stringify({ mode: 'dry-run', queueWrites: 0, runs: planSchedules(config, now, lookback) }));
    return console.log(JSON.stringify({ mode: 'execute', runs: await tickSchedules(config, process.env, now, lookback) }));
  }
  if (command === 'workflow:enqueue') {
    const job = option('job') ?? '', id = option('id') ?? '';
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) throw new Error('Explicit run ID required');
    const input = validateWorkflowInput(job, JSON.parse(await readFile(option('input') ?? '', 'utf8')));
    if (!args.includes('--execute')) return console.log(JSON.stringify({ mode: 'dry-run', workflow: job, id, input, queueWrites: 0, sourceWrites: 0 }));
    const queued = await enqueueWorkflow(job, id, input, process.env);
    return console.log(JSON.stringify({ workflow: job, id: queued.id, status: 'queued-or-existing' }));
  }
  if (await handleGroupStatusCli(args, process.env)) return;
  if (await handleMediaCli(args, process.env)) return;
  if (await handleEditorialCli(args, process.env)) return;
  if (await handleNotificationCli(args, process.env)) return;
  if (await handleCacheCli(args, process.env)) return;
  if (await handleAiCli(args, process.env)) return;
  if (await handleYoutubeCli(args, process.env)) return;
  if(command==='vocabulary:plan'){
    const seen=new Set<string>();for(const arg of args.slice(1)){const match=/^--(id|since|until|max-pages)=(.+)$/.exec(arg);if(!match||seen.has(match[1]!))throw new Error('Invalid vocabulary plan argument');seen.add(match[1]!);}
    return console.log(JSON.stringify(planVocabularyBackfill(option('id')??'',{since:option('since')??'',until:option('until')??''},Number(option('max-pages')??20)),null,2));
  }
  if (command === 'vocabulary:import') {
    const maxPages = Number(option('max-pages') ?? 100);
    if (!args.includes('--execute')) return console.log(JSON.stringify({ mode: 'dry-run', workflow: SNAPSHOT_IMPORT_JOB, maxPages, source: 'https://tag.observe.tw/api/v1/vocabulary/snapshots/current', externalCalls: 0, writes: 0 }));
    return console.log(JSON.stringify(await executeSnapshotImport(process.env, maxPages)));
  }
  if (command === 'help') return console.log('Commands: vocabulary:plan --id=PLAN --since=ISO --until=ISO [--max-pages=20]; vocabulary:sync --id=RUN --since=ISO --until=ISO [--max-pages=20] [--execute|--enqueue]; videos:match [--after-pk=0] [--limit=100] [--version=ID] [--execute]; vocabulary:match --snapshot=FILE --title=TEXT; migrate --execute; worker --execute. Default sync is an offline dry-run.');
  if (command === 'vocabulary:match') {
    const snapshot = JSON.parse(await readFile(option('snapshot') ?? '', 'utf8')) as VocabularySnapshot;
    return console.log(JSON.stringify(matchVocabulary({ title: option('title') ?? '', description: option('description') ?? '' }, snapshot), null, 2));
  }
  if (command === RECENT_VIDEO_EVIDENCE_COMMAND) return console.log(JSON.stringify(await matchRecentVideoBatch(validateRecentArguments(args), process.env)));
  if (command === 'videos:match') return console.log(JSON.stringify(await matchVideoBatch({ afterPk: Number(option('after-pk') ?? 0), limit: Number(option('limit') ?? 100), ...(option('version') ? { version: option('version') } : {}), ...(option('changed-since') ? { changedSince: option('changed-since') } : {}), execute: args.includes('--execute') }, process.env), null, 2));
  if (command === 'migrate') {
    if (process.env.TS_WORKER_SCHEMA_MODE || process.env.DB_DATABASE?.startsWith('youtube_board_ts_worker')) throw new Error('Worker facade migrations are forbidden');
    const policy = executionPolicy(process.env);
    if (!args.includes('--execute') || policy.environment === 'production') throw new Error('CLI migrations require explicit local --execute; production uses reviewed deployment migration');
    const db = await connectDatabase(process.env);
    try {
      const directory = fileURLToPath(new URL('../migrations/', import.meta.url));
      for (const name of (await readdir(directory)).filter(n => n.endsWith('.sql')).sort()) {
        if (name === '008_report_cache_lineage.sql') await assertReportCacheSchema(db);
        if (name === '007_source_counts_and_comments.sql') await assertSourceCountSchema(db);
        const sql = await readFile(`${directory}/${name}`, 'utf8');
        for (const statement of migrationStatements(sql)) await db.query(statement);
      }
      return console.log('Reviewed platform migrations applied to isolated local database');
    } finally { await db.end(); }
  }
  if (command === 'worker') {
    if (!args.includes('--execute')) throw new Error('Worker startup requires --execute');
    const handle = startWorker(process.env);
    handle.worker.on('error', () => console.error('Worker connection failure'));
    handle.worker.on('failed', job => console.error(JSON.stringify({ job: job?.name, status: 'failed' })));
    const close = async () => { requestWorkflowShutdown(); setTimeout(() => process.exit(1), 240000).unref(); await handle.close(); process.exit(0); };
    process.once('SIGTERM', close); process.once('SIGINT', close);
    console.log('TypeScript worker started; no recurring schedules created');
    return;
  }
  if (command !== 'vocabulary:sync') throw new Error('Unknown jobs command');
  const input = { id: option('id') ?? '', window: { since: option('since') ?? '', until: option('until') ?? '' }, maxPages: Number(option('max-pages') ?? 20) };
  validateWindow(input.window);
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(input.id)) throw new Error('Provide an explicit run id');
  if (args.includes('--enqueue')) {
    const job = await enqueueVocabulary(input, process.env);
    return console.log(JSON.stringify({ queued: true, id: job.id }));
  }
  if (!args.includes('--execute')) return console.log(JSON.stringify({ mode: 'dry-run', workflow: VOCABULARY_JOB, ...input, source: 'https://tag.observe.tw/api/v1/articles', coverage: 'observed-article-window', externalCalls: 0, writes: 0 }, null, 2));
  const result = await executeVocabulary(input, process.env);
  console.log(JSON.stringify(result.status === 'published' ? { status: result.status, version: result.snapshot.id, terms: result.snapshot.terms.length, coverage: result.snapshot.coverage } : result, null, 2));
  if (result.status === 'incomplete') process.exitCode = 2;
}
main().catch(error => { console.error(error instanceof Error && !('sql' in error) ? error.message : 'Database operation failed'); process.exitCode = 1; });
