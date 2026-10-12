import { createServer } from 'node:http';
import { startWorker } from '../jobs/src/worker.js';
import { requestWorkflowShutdown } from '../shared/shutdown.js';

const handle = startWorker(process.env);
let ready = false, stopping = false;
let connected = () => false;
const server = createServer((req, res) => {
  if (req.url !== '/up' && req.url !== '/ready') { res.writeHead(404).end(); return; }
  const healthy = req.url === '/up' ? !stopping : ready && !stopping && connected() && handle.worker.isRunning();
  res.writeHead(healthy ? 200 : 503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify({ status: healthy ? 'ok' : 'unavailable' }));
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, async () => {
  if (stopping) return;
  stopping = true; ready = false;
  requestWorkflowShutdown();
  setTimeout(() => process.exit(1), 240000).unref();
  server.close();
  try { await handle.close(); process.exit(0); } catch { process.exit(1); }
});
server.listen(8001, '127.0.0.1');
handle.worker.on('error', () => process.stderr.write('Worker runtime error\n'));
handle.worker.on('failed', () => process.stderr.write('Worker job failed\n'));
try {
  const redis = await handle.worker.getBackend().client;
  const blocking = await handle.worker.getBackend().blockingClient;
  connected = () => redis.status === 'ready' && (!blocking || blocking.status === 'ready');
  await handle.worker.waitUntilReady();
  ready = !stopping;
} catch {
  process.stderr.write('Worker startup failed\n');
  server.close();
  await handle.close().catch(() => {});
  process.exit(1);
}
