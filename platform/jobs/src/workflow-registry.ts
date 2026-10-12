import {VOCABULARY_JOB,validateWindow} from './vocabulary.js';
import { youtubeCommands, executeYoutubeWorkflow, validateYoutubeArguments, youtubeResultState } from './youtube-cli.js';
import { executeAiWorkflow, validateAiArguments } from './ai-cli.js';
import { derivedCommands, derivedFields } from './ai-derived-cli.js';
import { cacheCommands, cacheFields, executeCacheWorkflow, validateCacheArguments } from './cache-cli.js';
import { notificationCommands, notificationFields, executeNotificationWorkflow, validateNotificationArguments } from './notification-cli.js';
import { executeSnapshotImport, SNAPSHOT_IMPORT_JOB } from './snapshot-import.js';
import { matchVideoBatch, VIDEO_EVIDENCE_JOB } from './video-evidence.js';
import { executionPolicy, assertExecute } from './policy.js';
import { MEDIA_AVATAR_JOB, MEDIA_AVATAR_COMMAND, validateMediaArguments, executeMediaWorkflow } from './media-cli.js';
export interface WorkflowInput { options: Record<string, string | number | boolean> }
interface Definition { command: string; values: string[]; flags: string[]; kind: 'youtube' | 'ai' | 'cache' | 'notification' | 'media' }
const common = ['limit', 'max-api-attempts'];
const fields: Record<string, [string[], string[]]> = {
  'youtube.channels.stats': [['u_id', 'hours'], []],
  'youtube.channels.retire': [['u_id', 'stale-days'], ['restore']],
  'youtube.channels.videos.general': [['u_id', 'max-pages', 'max-results', 'days'], []],
  'youtube.channels.videos.live_group': [['u_id', 'max-pages', 'max-results', 'days'], []],
  'youtube.channels.videos.live': [['u_id', 'max-pages', 'max-results', 'days'], []],
  'youtube.videos.duration': [['videoId'], ['enqueue-missing']],
  'youtube.comments.queue': [['videoId', 'u_id', 'hours', 'min', 'tagid'], []],
  'youtube.comments.reset': [['videoId'], []],
  'youtube.comments.fetch': [['videoId', 'max-pages', 'max-reply-pages', 'max-state-mib'], []],
  'youtube.videos.stats': [['videoId'], ['today']],
  'youtube.live.poll': [['videoId', 'interval'], []],
  'youtube.tvbs.videos': [['u_id', 'max-pages', 'max-results', 'days'], []],
  'youtube.tvbs.live.poll': [['videoId', 'interval', 'stale-seconds'], []],
  'youtube.tag_videos.backfill': [['tagid', 'or', 'not', 'from', 'to', 'days', 'max-pages', 'max-results', 'video-limit', 'vocabulary-version'], ['no-cache']],
};
const definitions: Record<string, Definition> = Object.create(null);
definitions[MEDIA_AVATAR_JOB] = { command: MEDIA_AVATAR_COMMAND, values: ['u_id', 'after-id', 'limit', 'max-age-days'], flags: [], kind: 'media' };
for (const [command, job] of Object.entries(youtubeCommands)) {
  const definition = fields[job];
  if (definition) definitions[job] = { command, values: [...common, ...definition[0]], flags: definition[1], kind: 'youtube' };
}
for (const kind of ['channel', 'daily', 'hourly']) definitions[`ai.${kind}`] = {
  command: `ai:${kind}`, kind: 'ai', values: ['from', 'to', 'condition', 'channel-id', 'limit', 'user-token', 'type', 'call-limit', 'channel-video-limit'], flags: ['retry-failed', 'missing-only'],
};
for (const [command, job] of Object.entries(derivedCommands)) definitions[job] = { command, kind: 'ai', ...derivedFields[job] };
for (const [command, job] of Object.entries(cacheCommands)) definitions[job] = { command, kind: 'cache', ...cacheFields[job]! };
for (const [command, job] of Object.entries(notificationCommands)) definitions[job] = { command, kind: 'notification', ...notificationFields[job]! };
export const registeredWorkflows = [...Object.keys(definitions), SNAPSHOT_IMPORT_JOB, VIDEO_EVIDENCE_JOB];
function optionSchema(name: string) {
  if(name===VOCABULARY_JOB)return {values:['since','until','max-pages'],flags:[] as string[]};
  if (name === SNAPSHOT_IMPORT_JOB) return { values: ['max-pages'], flags: [] as string[] };
  if (name === VIDEO_EVIDENCE_JOB) return { values: ['after-pk', 'limit', 'version', 'changed-since'], flags: [] as string[] };
  if (!Object.hasOwn(definitions, name)) throw new Error('Unregistered workflow');
  return definitions[name]!;
}
/** Queue envelopes cannot supply commands, environment variables or execute flags. */
export function validateWorkflowInput(name: string, raw: unknown): WorkflowInput {
  const schema = optionSchema(name);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some(key => key !== 'options')) throw new Error('Invalid workflow input');
  const options = (raw as WorkflowInput).options;
  if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).length > 20) throw new Error('Invalid workflow options');
  const normalized: WorkflowInput['options'] = Object.create(null);
  for (const [key, value] of Object.entries(options).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    if (schema.flags.includes(key)) { if (typeof value !== 'boolean') throw new Error('Invalid workflow flag'); }
    else if (!schema.values.includes(key) || !['string', 'number'].includes(typeof value) || typeof value === 'string' && (value.length > 512 || /[\r\n\0]/.test(value)) || typeof value === 'number' && !Number.isFinite(value)) throw new Error('Invalid workflow option');
    normalized[key] = value;
  }
  if (definitions[name]?.kind === 'youtube') validateYoutubeArguments(cliArgs(definitions[name]!, normalized));
  if (definitions[name]?.kind === 'ai') validateAiArguments(cliArgs(definitions[name]!, normalized));
  if (definitions[name]?.kind === 'cache') validateCacheArguments(cliArgs(definitions[name]!, normalized));
  if (definitions[name]?.kind === 'notification') validateNotificationArguments(cliArgs(definitions[name]!, normalized));
  if (definitions[name]?.kind === 'media') validateMediaArguments(cliArgs(definitions[name]!, normalized));
  if(name===VOCABULARY_JOB){
    validateWindow({since:String(normalized.since??''),until:String(normalized.until??'')});
    const maxPages=Number(normalized['max-pages']??20);if(!Number.isSafeInteger(maxPages)||maxPages<1||maxPages>1000)throw new Error('Invalid vocabulary page cap');
  }
  if (name === SNAPSHOT_IMPORT_JOB && (!Number.isSafeInteger(Number(normalized['max-pages'] ?? 100)) || Number(normalized['max-pages'] ?? 100) < 1 || Number(normalized['max-pages'] ?? 100) > 500)) throw new Error('Invalid full snapshot page cap');
  if (name === VIDEO_EVIDENCE_JOB) {
    for (const [key, fallback, min, max] of [['after-pk', 0, 0, Number.MAX_SAFE_INTEGER], ['limit', 100, 1, 1000]] as const) { const value = Number(normalized[key] ?? fallback); if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error('Invalid match bound'); }
    if (normalized['changed-since'] !== undefined && (!/(?:Z|[+-]\d\d:\d\d)$/.test(String(normalized['changed-since'])) || !Number.isFinite(Date.parse(String(normalized['changed-since']))))) throw new Error('Invalid matching timestamp');
    if (normalized.version !== undefined && !/^[A-Za-z0-9_-]{1,100}$/.test(String(normalized.version))) throw new Error('Invalid vocabulary version');
  }
  return { options: normalized };
}
export function workflowArgs(name: string, input: WorkflowInput): string[] {
  const validated = validateWorkflowInput(name, input), definition = definitions[name];
  if (!definition) throw new Error('Workflow has no CLI adapter');
  return cliArgs(definition, validated.options);
}
function cliArgs(definition: Definition, options: WorkflowInput['options']) {
  return [definition.command, ...Object.entries(options).flatMap(([key, value]) => typeof value === 'boolean' ? value ? [`--${key}`] : [] : [`--${key}=${value}`]), '--execute'];
}
export async function executeRegisteredWorkflow(name: string, raw: unknown, env: NodeJS.ProcessEnv) {
  const input = validateWorkflowInput(name, raw);
  assertExecute(name, executionPolicy(env, 'execute', true));
  if (name === 'ai.daily') assertExecute('ai.channel', executionPolicy(env, 'execute', true));
  if (name === SNAPSHOT_IMPORT_JOB) return executeSnapshotImport(env, Number(input.options['max-pages'] ?? 100));
  if (name === VIDEO_EVIDENCE_JOB) return matchVideoBatch({ afterPk: Number(input.options['after-pk'] ?? 0), limit: Number(input.options.limit ?? 100), ...(input.options.version ? { version: String(input.options.version) } : {}), ...(input.options['changed-since'] ? { changedSince: String(input.options['changed-since']) } : {}), execute: true }, env);
  const args = workflowArgs(name, input);
  if (definitions[name]!.kind === 'media') return executeMediaWorkflow(args, env, true);
  if (definitions[name]!.kind === 'notification') {
    const result = await executeNotificationWorkflow(args, env, true);
    if (['failed', 'uncertain', 'incomplete'].includes(result.status)) throw new Error('Notification requires durable dispatch reconciliation; no automatic replay');
    return result;
  }
  if (definitions[name]!.kind === 'cache') {
    const result = await executeCacheWorkflow(args, env, true);
    if (result.skipped.length) throw new Error('Cache publication incomplete; inspect durable history and lineage before retry');
    return result;
  }
  const result = definitions[name]!.kind === 'youtube' ? await executeYoutubeWorkflow(args, env, true) : await executeAiWorkflow(args, env, true);
  const record = result as Record<string, unknown>;
  if (definitions[name]!.kind === 'youtube' ? youtubeResultState(result as Awaited<ReturnType<typeof executeYoutubeWorkflow>>) === 'failed' : ['partial_failure', 'blocked', 'failed'].includes(String(record.status))) throw new Error('Workflow incomplete; inspect durable run history before retry');
  return result;
}
