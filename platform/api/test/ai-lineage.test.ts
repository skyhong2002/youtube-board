import { describe,it,expect } from 'vitest';
import { dailyLineage } from '../src/reports/ai-lineage.js';
import { buildTopics } from '../src/reports/topics.js';
import type { Reader,Row } from '../src/db/client.js';
const row={pk:9,date_from:'2040-10-10 00:00:00',date_to:'2040-10-10 23:59:59',data_type:'oneday',user_token:'CLI',condition_type:'all',result_json:JSON.stringify([{標題:'新聞事件',媒體事件:{甲:['來源事件']}}])};
const snapshot={plan:{table:'urt_ai_date',key:{date_from:row.date_from,date_to:row.date_to,data_type:row.data_type,user_token:row.user_token,condition_type:row.condition_type},source:[{pk:'12',u_id:7,title:'甲',events:[{事件:'來源事件',videoId:['ABCDEFGHIJ1'],關鍵字:['交通']}]}]}};
const reader=(rows:Row[]):Reader=>({rows:async<T extends Row>()=>rows as T[],close:async()=>{}});
describe('immutable AI daily lineage',()=>{
 it('resolves original events from snapshot even after source channel cache changes',async()=>{const lineage=await dailyLineage(reader([{run_id:'a'.repeat(64),status:'published',input_json:JSON.stringify(snapshot),result_json:row.result_json}]),row);expect(lineage!.state).toBe('immutable-snapshot');const topics=buildTopics(9,row.result_json,lineage!.channels,lineage!.sources);expect(topics[0]!.evidence[0]!.videoIds).toEqual(['ABCDEFGHIJ1']);expect(topics[0]!.evidence[0]!.source).toEqual({table:'urt_channel_ai',id:12,snapshotRunId:'a'.repeat(64)});});
 it('refuses mismatched or damaged TS snapshot rather than guessing mutable sources',async()=>{expect(await dailyLineage(reader([{status:'published',result_json:'wrong'}]),row)).toMatchObject({state:'snapshot-unavailable'});expect(await dailyLineage(reader([{status:'published',result_json:row.result_json,input_json:'invalid'}]),row)).toMatchObject({state:'snapshot-unavailable'});});
 it('preserves existing legacy lookup only when no TS run exists',async()=>{expect(await dailyLineage(reader([]),row)).toBeNull();});
});
