/** Integration tests must never mutate the preview DB or an arbitrary configured runtime DB. */
export function isolatedTestEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const database = env.DB_DATABASE ?? 'youtube_board_test_rewrite';
  const host = env.DB_HOST ?? '127.0.0.1';
  if (database !== 'youtube_board_test_rewrite' || !['127.0.0.1', 'localhost'].includes(host) || (env.DB_PORT !== undefined && env.DB_PORT !== '23306')) throw new Error('Integration tests require the isolated loopback youtube_board_test_rewrite database');
  return { ...env, APP_ENV: 'test', DB_HOST: host, DB_PORT: env.DB_PORT ?? '23306', DB_DATABASE: database, DB_USERNAME: env.DB_USERNAME ?? 'youtube_rewrite' };
}

export function assertTestDatabaseUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'mysql:' || !['localhost', '127.0.0.1'].includes(url.hostname)
      || url.port !== '23306' || url.pathname !== '/youtube_board_test_rewrite' || url.search || url.hash)
    throw new Error('Fixture requires isolated localhost:23306/youtube_board_test_rewrite');
  return value;
}
