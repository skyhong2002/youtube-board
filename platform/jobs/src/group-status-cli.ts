import { groupStatus, validateGroupStatusInput } from '@youtube-board/ingestion';
import { connectDatabase } from './database.js';
export function validateGroupStatusArguments(args: string[]) {
  if (!Array.isArray(args) || args[0] !== 'reports:groups:build' || args.length > 8 || args.some(v => typeof v !== 'string' || v.length > 280)) throw new Error('Invalid group status command');
  const values = new Map<string,string>();
  for (const arg of args.slice(1)) {
    const m = /^--(group|hours|limit|offset|execute|dry-run|json)(?:=(.*))?$/.exec(arg);
    if (!m || values.has(m[1]!) || (['execute','dry-run','json'].includes(m[1]!) ? m[2] !== undefined : m[2] === undefined)) throw new Error('Unknown, duplicate or malformed group status option');
    values.set(m[1]!, m[2] ?? '');
  }
  if (values.has('execute') && values.has('dry-run')) throw new Error('Conflicting group status modes');
  if (values.has('offset') && values.get('offset')!.trim().toLowerCase() === 'auto') values.set('offset','auto');
  for (const key of ['hours','limit','offset']) if (values.has(key) && !(key === 'offset' && values.get(key) === 'auto') && !/^\d+$/.test(values.get(key)!)) throw new Error('Invalid group status numeric option');
  return validateGroupStatusInput({ group: values.get('group'), hours: Number(values.get('hours') ?? 22), limit: Number(values.get('limit') ?? 20), offset: values.get('offset') === 'auto' ? 'auto' : Number(values.get('offset') ?? 0), execute: values.has('execute') });
}
export async function executeGroupStatus(args: string[], env: NodeJS.ProcessEnv) {
  const input = validateGroupStatusArguments(args);
  const remoteSync = (env.INGESTION_LEGACY_EXTERNAL_SYNC_ENABLED ?? '').trim().toLowerCase();
  if (remoteSync && !['false','(false)','0','null','(null)','empty','(empty)'].includes(remoteSync)) throw new Error('Legacy external group sync is unsupported; unset its gate for the local read-only report');
  const db = await connectDatabase(env);
  try { return await groupStatus(db, input); } finally { await db.end(); }
}
export async function handleGroupStatusCli(args: string[], env: NodeJS.ProcessEnv) {
  if (args[0] !== 'reports:groups:build') return false;
  console.log(JSON.stringify(await executeGroupStatus(args, env), null, 2)); return true;
}
