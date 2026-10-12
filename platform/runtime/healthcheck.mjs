const worker = process.env.RUNTIME_ROLE === 'worker';
const scheduler = process.env.RUNTIME_ROLE === 'scheduler';
const port = worker ? 8001 : scheduler ? 8002 : Number(process.env.PORT ?? 8000);
try {
  const response = await fetch(`http://127.0.0.1:${port}/${worker || scheduler ? 'ready' : 'runtime/ready'}`, { signal: AbortSignal.timeout(4000) });
  await response.body?.cancel();
  process.exit(response.ok ? 0 : 1);
} catch { process.exit(1); }
