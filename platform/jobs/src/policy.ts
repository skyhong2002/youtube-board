export type Mode = 'dry-run' | 'shadow' | 'execute';
export interface ExecutionPolicy {
  environment: 'local' | 'production';
  mode: Mode;
  enabled: boolean;
  productionEnabled: boolean;
  scheduled: boolean;
  schedulerEnabled: boolean;
  allowlist: ReadonlySet<string>;
  /** An operator records the workflow ownership transfer; never inferred from an allowlist. */
  typescriptOwners: ReadonlySet<string>;
}
export function assertExecute(job: string, policy: ExecutionPolicy): void {
  if (policy.mode !== 'execute') throw new Error('Execution requires explicit execute mode');
  if (!policy.enabled) throw new Error('TypeScript ingestion is disabled');
  if (!policy.typescriptOwners.has(job)) throw new Error('Workflow ownership has not transferred to TypeScript');
  if (policy.scheduled && !policy.schedulerEnabled) throw new Error('Scheduler is disabled');
  if (policy.environment === 'production') {
    if (!policy.productionEnabled || !policy.allowlist.has(job)) throw new Error('Production execution requires an exact allowlist and enabled gate');
    if (policy.allowlist.has('*')) throw new Error('Wildcard production allowlists are forbidden');
  }
}
const list = (value = '') => new Set(value.split(',').map(s => s.trim()).filter(Boolean));
export function executionPolicy(env: NodeJS.ProcessEnv, mode: Mode = 'dry-run', scheduled = false): ExecutionPolicy {
  const environment = env.APP_ENV === 'production' ? 'production' : 'local';
  if (environment === 'local' && env.APP_ENV !== 'local' && env.APP_ENV !== 'test') throw new Error('APP_ENV must explicitly be local, test, or production');
  return { environment, mode, scheduled, enabled: env.TS_INGESTION_ENABLED === 'true', productionEnabled: env.TS_INGESTION_PRODUCTION_ENABLED === 'true', schedulerEnabled: env.TS_SCHEDULER_ENABLED === 'true', allowlist: list(env.TS_INGESTION_WRITE_ALLOWLIST), typescriptOwners: list(env.TS_INGESTION_OWNERS) };
}
export function assertLocalDatabase(host: string, database: string, environment: string): void {
  if (environment !== 'production' && (!['127.0.0.1', 'localhost', 'db', 'mariadb'].includes(host) || !database.endsWith('_rewrite'))) throw new Error('Local jobs require an isolated local *_rewrite database');
}
