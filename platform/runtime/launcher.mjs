import { spawn } from 'node:child_process';

const role = process.argv[2] ?? 'web';
if (!['web', 'worker', 'scheduler'].includes(role)) throw new Error('Runtime role must be web, worker or scheduler');
const children = [];
const termSent = new Set();
function terminate(child) { termSent.add(child); child.kill('SIGTERM'); }
let stopping = false;
let exitCode = 0;
let gateway;
let ui;
function child(args, extra = {}) {
  const processChild = spawn(process.execPath, args, { stdio: 'inherit', env: { ...process.env, ...extra } });
  children.push(processChild);
  processChild.once('error', () => { process.stderr.write('Runtime child failed to start\n'); stop(1); });
  processChild.once('exit', (code, signal) => {
    process.stdout.write(JSON.stringify({ event: 'runtime-child-exit', role: processChild === gateway ? 'gateway' : processChild === ui ? 'ui' : role, code, signal, stopping }) + '\n');
    if (!stopping) stop(code || 1);
    else if ((signal && signal !== 'SIGTERM') || (code && code !== 0 && !(code === 143 && termSent.has(processChild)))) exitCode = 1;
    if (stopping && processChild === gateway && ui) terminate(ui);
    finish();
  });
  return processChild;
}
function finish() { if (stopping && children.every(p => p.exitCode !== null || p.signalCode !== null)) process.exit(exitCode); }
function stop(code) {
  if (stopping) return;
  stopping = true; exitCode = code; process.exitCode = code;
  if (gateway && gateway.exitCode === null && gateway.signalCode === null) terminate(gateway);
  else for (const processChild of children) terminate(processChild);
  setTimeout(() => { for (const processChild of children) processChild.kill('SIGKILL'); process.exit(1); }, role === 'worker' ? 250000 : 28000).unref();
  finish();
}
process.once('SIGTERM', () => stop(0));
process.once('SIGINT', () => stop(0));
if (role === 'worker') child(['--import', 'tsx', 'runtime/worker.ts'], { NODE_OPTIONS: '--max-old-space-size=384' });
else if (role === 'scheduler') child(['--import', 'tsx', 'runtime/scheduler.ts'], { NODE_OPTIONS: '--max-old-space-size=128' });
else {
  ui = child(['web/.next/standalone/web/server.js'], { HOSTNAME: '127.0.0.1', PORT: '3100', NODE_OPTIONS: '--max-old-space-size=384', YOUTUBE_API_BASE_URL: `http://127.0.0.1:${process.env.PORT ?? 8000}/api/v1` });
  gateway = child(['--import', 'tsx', 'runtime/server.ts'], { NODE_OPTIONS: '--max-old-space-size=384', UI_ORIGIN: 'http://127.0.0.1:3100' });
}
