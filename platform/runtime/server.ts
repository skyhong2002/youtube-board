import {registerAuth} from '../api/src/auth/index.js';
import {mysqlApiKeyStore} from '../api/src/reader/api-key-store.js';
import {registerPersonalApiKeys} from '../api/src/reader/api-keys.js';
import {registerReaderAccounts} from '../api/src/reader/routes.js';
import {registerManage} from '../api/src/manage/routes.js';
import { setTimeout as delay } from 'node:timers/promises';
import { buildApp } from '../api/src/app.js';
import { registerOps } from '../api/src/ops/index.js';
import { registerUiProxy } from '../api/src/ui-proxy.js';
import { readinessProbe } from './readiness.js';
import {frontendDatabases} from '../api/src/db/frontend.js';
import {publicScriptManifest} from '../api/src/public-html.js';
import {THEME_SCRIPT} from '../shared/public-render-contract.js';
import {fileURLToPath} from 'node:url';
import {loadUnavailableAssets} from '../api/src/ui-unavailable.js';
import {analyticsTransportEnabled} from '../shared/analytics-runtime.js';

const databases=frontendDatabases(process.env);
const apiKeys=databases.state?mysqlApiKeyStore(databases.state):null;
const apiKeysReady=apiKeys?await apiKeys.ready():false;
const app = buildApp({sitemapWarmup:true,homeWarmup:true,publicApi:{keys:apiKeysReady?apiKeys:null}});
if(apiKeys)app.addHook('onClose',()=>apiKeys.close());
const auth=await registerAuth(app,{databaseUrl:databases.auth,env:{...process.env,DATABASE_URL:databases.auth}});
await registerReaderAccounts(app,auth,{databaseUrl:databases.auth});
await registerPersonalApiKeys(app,auth,{store:apiKeysReady?apiKeys:null});
await registerManage(app,auth,{stateUrl:databases.state,reportsUrl:databases.reports});
let stopping = false;
const active = new Set<string>();
app.addHook('onRequest', async (request, reply) => {
  if (stopping && request.url !== '/up' && !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress ?? '')) return reply.code(503).send({ status: 'draining' });
  active.add(request.id);
});
app.addHook('onResponse', async request => { active.delete(request.id); });
app.addHook('onRequestAbort', async request => { active.delete(request.id); });
await registerOps(app,{auth,onRankingDisplayChanged:()=>app.keywordRankingChanged()});
const uiOrigin = process.env.UI_ORIGIN ?? 'http://127.0.0.1:3100';
const assets=await publicScriptManifest(fileURLToPath(new URL('../web/.next/standalone/web/.next/static/',import.meta.url)));
const unavailable=await loadUnavailableAssets(new URL('../web/.next/standalone/web/public/errors/',import.meta.url));
await registerUiProxy(app, { origin: uiOrigin,htmlSecurity:{assets,themeScript:THEME_SCRIPT,...unavailable,analytics:analyticsTransportEnabled(process.env)} });
let readinessChecks = { api: 'unchecked', ui: 'unchecked', security: 'unchecked' };
const ready = readinessProbe(async () => {
  const [api, ui] = await Promise.allSettled([
    app.inject({ method: 'GET', url: '/ready' }),
    app.inject({method:'GET',url:'/about'}),
  ]);
  const uiReady = ui.status === 'fulfilled' && ui.value.statusCode === 200;
  const csp = ui.status === 'fulfilled' ? ui.value.headers['content-security-policy'] : undefined;
  readinessChecks = { api: api.status === 'fulfilled' && api.value.statusCode === 200 ? 'ready' : 'unavailable',
    ui: uiReady ? 'ready' : 'unavailable', security: typeof csp === 'string' && csp.includes("'strict-dynamic'") ? 'ready' : 'unavailable' };
  return Object.values(readinessChecks).every(state => state === 'ready');
});
app.get('/runtime/ready', async (_request, reply) => {
  reply.header('Cache-Control', 'no-store');
  if (stopping) return reply.code(503).send({ status: 'unavailable', checks: { lifecycle: 'stopping' } });
  return !await ready() ? reply.code(503).send({ status: 'unavailable', checks: readinessChecks }) : { status: 'ready', checks: readinessChecks };
});
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
