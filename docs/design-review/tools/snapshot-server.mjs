#!/usr/bin/env node
// Frozen-data front door for the design review. It stands where the production
// gateway stands: /api/v1/* and /media/* come from a frozen snapshot, every other
// path is proxied to a local `next start`. Next's server-side reads point here too
// (YOUTUBE_API_BASE_URL=http://127.0.0.1:PORT/api/v1), so no page ever reaches the
// production API while screenshots are taken.
//
//   node snapshot-server.mjs --data DIR --port 8501 --next http://127.0.0.1:3101 [--errors DIR] [--record ORIGIN]
//
// --record ORIGIN fills the snapshot: a missing /api/v1 or /media entry is fetched
// once from ORIGIN (DNT: 1, no cookies) and stored; an existing entry is never
// refetched. Without --record a missing entry is a 404 and is logged, so a
// replay can never silently fall back to live data.
//
// Scenarios (POST /__review/scenario {"mode":"normal|empty|error|hang","match":"regex"}):
// requests whose path+query matches `match` are answered empty (every array in
// `data` emptied), as a 500, or never answered. Default mode is normal.
import http from 'node:http';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, all) => (value.startsWith('--') ? [...pairs, [value.slice(2), all[index + 1]]] : pairs), []));
const DATA = args.data;
const PORT = Number(args.port || 8501);
const NEXT = new URL(args.next || 'http://127.0.0.1:3101');
const RECORD = args.record ? new URL(args.record) : null;
// The production gateway answers every 5xx page from Next with the static, scriptless
// web/public/errors/unavailable.html (api/src/ui-unavailable.ts); --errors points at that
// directory of the build being shot, so error states show what readers actually get.
const ERRORS = args.errors || null;
if (!DATA) throw new Error('--data is required');
mkdirSync(join(DATA, 'entries'), { recursive: true });
let scenario = { mode: 'normal', match: null };

const keyOf = (url) => createHash('sha256').update(url).digest('hex').slice(0, 32);
const log = (line) => appendFileSync(join(DATA, 'requests.log'), `${new Date().toISOString()} ${line}\n`);

function load(url) {
  const file = join(DATA, 'entries', keyOf(url));
  if (!existsSync(file + '.json')) return null;
  const meta = JSON.parse(readFileSync(file + '.json', 'utf8'));
  return { ...meta, body: readFileSync(file + '.body') };
}

// One upstream fetch at a time, at most ~2 per second; a 429 is retried after a
// pause and never stored.
let queue = Promise.resolve();
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
function record(url) {
  const run = queue.then(() => recordNow(url));
  queue = run.catch(() => {}).then(() => sleep(500));
  return run;
}
async function recordNow(url) {
  const existing = load(url);
  if (existing) return existing;
  let response;
  for (let attempt = 0; ; attempt++) {
    response = await fetch(new URL(url, RECORD), { headers: { DNT: '1', 'Sec-GPC': '1', Accept: url.startsWith('/api/') ? 'application/json' : '*/*', 'User-Agent': 'design-review-snapshot/1' }, redirect: 'manual' });
    if (response.status !== 429 || attempt >= 6) break;
    await response.arrayBuffer();
    log(`429 ${url}, retry ${attempt + 1}`);
    await sleep(Math.max(5, Number(response.headers.get('retry-after')) || 0) * 1000 * (attempt + 1));
  }
  if (response.status === 429) throw new Error('still rate limited');
  const body = Buffer.from(await response.arrayBuffer());
  const meta = { url, status: response.status, contentType: response.headers.get('content-type') || 'application/octet-stream', recordedAt: new Date().toISOString() };
  const file = join(DATA, 'entries', keyOf(url));
  writeFileSync(file + '.body', body);
  writeFileSync(file + '.json', JSON.stringify(meta));
  appendFileSync(join(DATA, 'index.tsv'), `${keyOf(url)}\t${response.status}\t${url}\n`);
  log(`RECORD ${response.status} ${url}`);
  return { ...meta, body };
}

// Every array under `data` becomes empty (a collection's total with it); other
// counts stay as they were, the way a cache that just lost its rows would look.
function emptied(body) {
  const json = JSON.parse(body.toString('utf8'));
  // A collection's `total` follows its emptied `rows`.
  const walk = (value) => {
    if (Array.isArray(value)) return [];
    if (!value || typeof value !== 'object') return value;
    const out = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v)]));
    if (Array.isArray(value.rows) && typeof value.total === 'number') out.total = 0;
    return out;
  };
  return Buffer.from(JSON.stringify({ ...json, data: walk(json.data) }));
}

function proxyToNext(request, response) {
  const upstream = http.request({ host: NEXT.hostname, port: NEXT.port, method: request.method, path: request.url, headers: { ...request.headers, host: `${NEXT.hostname}:${NEXT.port}` } }, (reply) => {
    const page = request.headers.rsc === undefined && !request.url.startsWith('/_next/');
    if (ERRORS && reply.statusCode >= 500 && page) {
      reply.resume();
      log(`GATEWAY-503 ${request.url}`);
      response.writeHead(503, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return response.end(readFileSync(join(ERRORS, 'unavailable.html')));
    }
    response.writeHead(reply.statusCode, reply.headers);
    reply.pipe(response);
  });
  upstream.on('error', (error) => { response.writeHead(502); response.end(String(error)); });
  request.pipe(upstream);
}

http.createServer(async (request, response) => {
  const url = request.url;
  if (url === '/__review/scenario' && request.method === 'POST') {
    let text = '';
    for await (const chunk of request) text += chunk;
    scenario = JSON.parse(text || '{}');
    scenario.mode ||= 'normal';
    log(`SCENARIO ${JSON.stringify(scenario)}`);
    response.writeHead(200, { 'content-type': 'application/json' });
    return response.end(JSON.stringify(scenario));
  }
  if (ERRORS && url.split('?')[0] === '/errors/unavailable.css') {
    response.writeHead(200, { 'content-type': 'text/css; charset=utf-8' });
    return response.end(readFileSync(join(ERRORS, 'unavailable.css')));
  }
  // Account and operator routes belong to Fastify behind the production gateway. Next's
  // same-origin bridge (web/src/lib/private-proxy.ts) forwards them to the API origin,
  // which is this server: proxying them back to Next would recurse without end. Answer
  // them here as an API without login configured (accounts-handoff.md: enabled:false).
  const path = url.split('?')[0];
  if (path === '/auth/me' && request.method === 'GET') {
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store' });
    return response.end(JSON.stringify({ enabled: false, user: null, csrfToken: null }));
  }
  if (path.startsWith('/auth/') || path.startsWith('/api/ops/') || path.startsWith('/feeds/u/')) {
    log(`PRIVATE-503 ${url}`);
    response.writeHead(503, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store' });
    return response.end(JSON.stringify({ error: { code: 'AUTH_UNAVAILABLE' } }));
  }
  const frozen = url.startsWith('/api/v1/') || url.startsWith('/media/');
  if (!frozen) return proxyToNext(request, response);
  const applies = scenario.mode !== 'normal' && url.startsWith('/api/v1/') && (!scenario.match || new RegExp(scenario.match).test(url));
  if (applies && scenario.mode === 'hang') { log(`HANG ${url}`); return; }
  if (applies && scenario.mode === 'error') {
    log(`ERROR ${url}`);
    response.writeHead(500, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    return response.end(JSON.stringify({ error: 'Server error.', code: 'INTERNAL_ERROR' }));
  }
  try {
    let entry = load(url);
    if (!entry && RECORD) entry = await record(url);
    if (!entry) {
      log(`MISS ${url}`);
      response.writeHead(404, { 'content-type': 'application/json' });
      return response.end(JSON.stringify({ error: 'Not in snapshot.', code: 'NOT_FOUND' }));
    }
    let body = entry.body;
    if (applies && scenario.mode === 'empty' && entry.contentType.includes('json') && entry.status === 200) body = emptied(body);
    log(`${applies ? scenario.mode.toUpperCase() : 'HIT'} ${entry.status} ${url}`);
    response.writeHead(entry.status, { 'content-type': entry.contentType, 'cache-control': 'no-store' });
    response.end(body);
  } catch (error) {
    log(`FAIL ${url} ${error}`);
    response.writeHead(502);
    response.end();
  }
}).listen(PORT, '127.0.0.1', () => console.log(`snapshot server on ${PORT} → ${NEXT.href} (${RECORD ? 'recording from ' + RECORD.origin : 'replay only'})`));
