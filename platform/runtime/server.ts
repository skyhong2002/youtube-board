import {registerAuth} from '../api/src/auth/index.js';
import {registerReaderAccounts} from '../api/src/reader/routes.js';
import { setTimeout as delay } from 'node:timers/promises';
import { buildApp } from '../api/src/app.js';
import { registerOps } from '../api/src/ops/index.js';
import { registerUiProxy } from '../api/src/ui-proxy.js';
import { readinessProbe } from './readiness.js';
import {frontendDatabases} from '../api/src/db/frontend.js';
import {publicScriptManifest} from '../api/src/public-html.js';
import {THEME_SCRIPT} from '../shared/public-render-contract.js';
import {fileURLToPath} from 'node:url';

const databases=frontendDatabases(process.env);
const app = buildApp();
const auth=await registerAuth(app,{databaseUrl:databases.auth,env:{...process.env,DATABASE_URL:databases.auth}});
await registerReaderAccounts(app,auth,{databaseUrl:databases.auth});
let stopping = false;
const active = new Set<string>();
app.addHook('onRequest', async (request, reply) => {
  if (stopping && request.url !== '/up' && !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress ?? '')) return reply.code(503).send({ status: 'draining' });
  active.add(request.id);
});
app.addHook('onResponse', async request => { active.delete(request.id); });
app.addHook('onRequestAbort', async request => { active.delete(request.id); });
await registerOps(app,{auth});
const uiOrigin = process.env.UI_ORIGIN ?? 'http://127.0.0.1:3100';
const assets=await publicScriptManifest(fileURLToPath(new URL('../web/.next/standalone/web/.next/static/',import.meta.url)));
await registerUiProxy(app, { origin: uiOrigin,htmlSecurity:{assets,themeScript:THEME_SCRIPT} });
const ready = readinessProbe(async () => {
  const [api, ui] = await Promise.all([
    app.inject({ method: 'GET', url: '/ready' }),
    app.inject({method:'GET',url:'/about'}),
  ]);
  return api.statusCode === 200 && ui.statusCode===200 && typeof ui.headers['content-security-policy']==='string' && ui.headers['content-security-policy'].includes("'strict-dynamic'");
});
app.get('/runtime/ready', async (_request, reply) => stopping || !await ready() ? reply.code(503).send({ status: 'unavailable' }) : { status: 'ready' });
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, async () => {
  if (stopping) return;
  stopping = true;
  const force = setTimeout(() => process.exit(1), 25000).unref();
  try {
    // Allow in-flight Next renders to finish their loopback API calls first.
    const deadline = Date.now() + 20000;
    while (active.size && Date.now() < deadline) await delay(50);
    await app.close(); clearTimeout(force); process.exit(0);
  } catch { process.exit(1); }
});
await app.listen({ host: '0.0.0.0', port: Number(process.env.PORT ?? 8000) });
