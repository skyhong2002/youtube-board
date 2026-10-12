import { describe, expect, it } from 'vitest';
import { executeMediaWorkflow, validateMediaArguments, MEDIA_AVATAR_COMMAND, MEDIA_AVATAR_JOB } from '../src/media-cli.js';
import { validateWorkflowInput, workflowArgs } from '../src/workflow-registry.js';
import { validateScheduleConfig } from '../src/scheduler.js';
const args = [MEDIA_AVATAR_COMMAND];
describe('channel avatar refresh execution boundary', () => {
  it('dry run performs no DB/network/cache operations, even without environment', async () => {
    expect(await executeMediaWorkflow(args, {})).toMatchObject({ mode: 'dry-run', externalCalls: 0, sourceWrites: 0, cacheWrites: 0, limit: 100 });
  });
  it('validates bounds and incompatible or injected options before any side effect', () => {
    for (const extra of [['--execute', '--execute'], ['--limit=501'], ['--u_id=0'], ['--after-id=-1'], ['--max-age-days=0'], ['--url=https://example.com'], ['--limit=1','--limit=2'], ['--u_id=1','--after-id=2']]) expect(() => validateMediaArguments([...args, ...extra])).toThrow();
  });
  it('execute requires enable, ownership, scheduler and production gates', async () => {
    for (const env of [{ APP_ENV: 'local' }, { APP_ENV: 'local', TS_INGESTION_ENABLED: 'true' }, { APP_ENV: 'production', TS_INGESTION_ENABLED: 'true', TS_INGESTION_OWNERS: MEDIA_AVATAR_JOB }]) await expect(executeMediaWorkflow([...args, '--execute'], env)).rejects.toThrow();
    await expect(executeMediaWorkflow([...args, '--execute'], { APP_ENV: 'local', TS_INGESTION_ENABLED: 'true', TS_INGESTION_OWNERS: MEDIA_AVATAR_JOB }, true)).rejects.toThrow('Scheduler');
  });
  it('queue registration and opt-in recurring schedule share validated limits', () => {
    const input = validateWorkflowInput(MEDIA_AVATAR_JOB, { options: { limit: 100 } });
    expect(workflowArgs(MEDIA_AVATAR_JOB, input)).toEqual([MEDIA_AVATAR_COMMAND, '--limit=100', '--execute']);
    expect(() => validateWorkflowInput(MEDIA_AVATAR_JOB, { options: { limit: 501 } })).toThrow();
    expect(validateScheduleConfig({ version: 1, timezone: 'Asia/Taipei', schedules: [{ id: 'channel-avatars', workflow: MEDIA_AVATAR_JOB, cron: '17 * * * *', options: { limit: 100, 'max-age-days': 7 } }] }).schedules).toHaveLength(1);
  });
});
