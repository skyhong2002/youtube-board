import { createServer } from 'node:http';
import { readScheduleConfig, runScheduleCycle } from '../jobs/src/scheduler.js';
import { requestWorkflowShutdown } from '../shared/shutdown.js';

const config = await readScheduleConfig(process.env.TS_SCHEDULE_CONFIG ?? 'runtime/schedules.json');
if (!config.schedules.length) throw new Error('No explicit recurring schedules configured');
let stopping = false, lastReady = 0;
let workflowStatus: 'unknown' | 'ok' | 'attention' = 'unknown';
let timer: ReturnType<typeof setTimeout> | undefined;
let current: Promise<void> = Promise.resolve();
const server = createServer((req, res) => {
  if (!['/up', '/ready'].includes(req.url ?? '')) { res.writeHead(404).end(); return; }
  const healthy = !stopping && (req.url === '/up' || lastReady > 0 && Date.now() - lastReady < 60000);
  res.writeHead(healthy ? 200 : 503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify({ status: healthy ? 'ok' : 'unavailable', workflowStatus }));
});
async function tick() {
  try {
    const cycle = await runScheduleCycle(config, process.env);
    lastReady = cycle.ready ? Date.now() : 0;
    workflowStatus = cycle.healthy ? 'ok' : 'attention';
    if (cycle.runs.length || cycle.missedWindow || cycle.persistenceError || cycle.aborted || cycle.clockSkew || cycle.baseline === 'unobserved') process.stdout.write(JSON.stringify({ event: cycle.healthy ? 'schedule-tick' : 'schedule-attention', ...cycle }) + '\n');
  } catch { if (!stopping) { lastReady = 0; workflowStatus = 'unknown'; process.stderr.write('Scheduler tick failed; configuration, gates and queue health require inspection\n'); } }
  finally { if (!stopping) timer = setTimeout(() => { current = tick(); }, 15000); }
}
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, async () => {
  stopping = true; requestWorkflowShutdown(); clearTimeout(timer); server.close();
  setTimeout(() => process.exit(1), 25000).unref();
  await current.catch(() => {}); process.exit(0);
});
server.listen(8002, '127.0.0.1');
current = tick();
