import {sql} from 'drizzle-orm';
import {DataQueryFailed,type Reader} from '../db/client.js';
import {BadQuery} from '../reports/query.js';
import {timestamp} from '../reports/normalize.js';
import {youtubeCommands} from '../../../jobs/src/youtube-cli.js';
import {cacheCommands} from '../../../jobs/src/cache-cli.js';
import {derivedCommands} from '../../../jobs/src/ai-derived-cli.js';
import {notificationCommands} from '../../../jobs/src/notification-cli.js';

const sourceJobs=new Set<string>([...Object.values(youtubeCommands),...Object.values(cacheCommands)]);
const aiJobs=new Set<string>(['ai.channel','ai.daily','ai.hourly',...Object.values(derivedCommands)]);
const notificationJobs=new Set<string>(Object.values(notificationCommands));
const states=new Set(['running','failed','completed','incomplete','skipped','published','validated','scanning','ready','superseded','partial_failure','blocked','uncertain','sent','empty','preview','outside-slot','skipped-slot','no-source','already-dispatched','adopted-existing','nothing-eligible']);
const safeId=(value:unknown)=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(value)?value:null;
function epoch(value:unknown){const n=Number(value);return value!==null&&value!==undefined&&Number.isFinite(n)&&n>0&&n<8640000000000?new Date(n*1000).toISOString():null;}
/** Only fixed metadata columns. Never read provider errors, inputs, prompts or result JSON. */
export async function workflowHistory(reader:Reader,query:Record<string,unknown>){
 if(Object.keys(query).some(k=>!['workflow','limit'].includes(k))||typeof query.workflow!=='string'||query.limit!==undefined&&(typeof query.limit!=='string'||!/^\d+$/.test(query.limit)))throw new BadQuery('Invalid history query.');
 const workflow=query.workflow,limit=query.limit===undefined?25:Number(query.limit);
 if(!Number.isSafeInteger(limit)||limit<1||limit>50)throw new BadQuery('History limit must be 1–50.');
 if(['ai.daily.catchup','ai.days_refresh'].includes(workflow))return {workflow,source:null,scope:'child-workflow-journals',rows:[],hasMore:false,queueState:'not-inspected',relatedWorkflows:workflow==='ai.daily.catchup'?['youtube.tag_videos.backfill','ai.channel','ai.daily']:['ai.channel','ai.daily','ai.event','ai.period','reports.ai_topic.build'],note:'此工作編排多個子工作，請按子工作查閱持久化紀錄；沒有單一彙總 run row。'};
 let source:string,scope='exact-workflow',timeKind:'epoch'|'taipei'|'utc',statement;
 if(sourceJobs.has(workflow)){
  source='ts_job_runs';timeKind='epoch';statement=sql`SELECT execution_key AS id,status,UNIX_TIMESTAMP(updated_at) AS updated FROM ts_job_runs WHERE job_key=${workflow} ORDER BY updated_at DESC,execution_key DESC LIMIT ${limit+1}`;
 }else if(aiJobs.has(workflow)){
  source='ts_ai_runs';timeKind='taipei';statement=sql`SELECT run_id AS id,status,updated_at AS updated FROM ts_ai_runs WHERE workflow=${workflow} ORDER BY updated_at DESC,run_id DESC LIMIT ${limit+1}`;
 }else if(notificationJobs.has(workflow)){
  source='ts_notification_runs';timeKind='utc';statement=sql`SELECT run_id AS id,status,updated_at AS updated FROM ts_notification_runs WHERE workflow=${workflow} ORDER BY updated_at DESC,run_id DESC LIMIT ${limit+1}`;
 }else if(['tags.vocabulary.sync','tags.vocabulary.import'].includes(workflow)){
  source='ts_vocabulary_runs';scope='shared-vocabulary-journal';timeKind='epoch';statement=sql`SELECT id,status,UNIX_TIMESTAMP(created_at) AS updated FROM ts_vocabulary_runs ORDER BY created_at DESC,id DESC LIMIT ${limit+1}`;
 }else if(workflow==='tags.videos.match')return {workflow,source:null,scope:'no-run-journal',rows:[],hasMore:false,queueState:'not-inspected',note:'比對工作保留逐影片的版本與完成標記，沒有獨立執行紀錄；無紀錄不代表未執行。'};
 else throw new BadQuery('Unknown history workflow.');
 const rows=await reader.rows(statement);
 if(rows.length>limit+1)throw new DataQueryFailed('OPS_HISTORY_BOUND');
 return {workflow,source,scope,rows:rows.slice(0,limit).map(r=>({id:safeId(r.id),status:states.has(String(r.status))?String(r.status):'unknown',updatedAt:timeKind==='epoch'?epoch(r.updated):timestamp(typeof r.updated==='string'&&timeKind==='utc'?r.updated.replace(' ','T')+'Z':r.updated)})),hasMore:rows.length>limit,limit,queueState:'not-inspected',note:scope==='shared-vocabulary-journal'?'同步與匯入共用詞彙發布紀錄；依建立時間排列，時間不是最近進度時間。':'此為持久化執行紀錄，不代表目前仍有 worker 執行，也不等同佇列狀態。'};
}
