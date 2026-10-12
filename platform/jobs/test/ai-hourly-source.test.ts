import {describe,it,expect} from 'vitest';
import {refreshHourlySource} from '../src/ai-hourly-source.js';
import {CHANNEL_IDS,normalizeHourlyPipeline} from '@youtube-board/ai';
import {validateAiArguments,executeAiWorkflow} from '../src/ai-cli.js';
const caps={maxResults:50,maxPages:1,maxApiAttempts:200};
const result=(args:string[],oldest:string|null,exhausted=false)=>({selected:1,apiAttempts:1,skipped:[],applied:[{uId:Number(args.find(a=>a.startsWith('--u_id='))!.slice(7)),apiItems:50,pages:1,oldestPublishedAt:oldest,pageExhausted:exhausted}]});
describe('source-first hourly adapter',()=>{
 it('resolves relative Taipei hours and preserves implicit condition',()=>{const input=normalizeHourlyPipeline({hour:1,period:2},new Date('2026-10-11T17:22:00Z'));expect(input).toMatchObject({from:'2026-10-11 23:00:00',to:'2026-10-12 00:59:59',userToken:'cli'});expect(input.condition).toBeUndefined();expect(()=>normalizeHourlyPipeline({from:'2026-10-10 00:00:00',to:'2026-10-10 00:59:59',hour:1})).toThrow('absolute or relative');});
 it('covers all configured channels before declaring window complete',async()=>{const answer=await refreshHourlySource('2026-10-12 00:00:00',true,{},true,caps,async(args)=>result(args,'2026-10-11T15:59:59Z'));expect(answer.complete).toBe(true);expect(answer.details.apiAttempts).toBe(CHANNEL_IDS.length);expect(answer.details.completedChannels).toBe(CHANNEL_IDS.length);});
 it('blocks a full recent page and a short page with an advancing cursor',async()=>{const answer=await refreshHourlySource('2026-10-12 00:00:00',true,{},false,caps,async(args)=>({...result(args,'2026-10-11T16:30:00Z'),applied:result(args,'2026-10-11T16:30:00Z').applied.map(r=>({...r,apiItems:3}))}));expect(answer.complete).toBe(false);expect(answer.details.completedChannels).toBe(0);});
 it('stops budget consumption after an ambiguous source failure',async()=>{let calls=0;const answer=await refreshHourlySource('2026-10-12 00:00:00',true,{},false,caps,async()=>{calls++;throw Error('uncertain');});expect(answer.complete).toBe(false);expect(calls).toBe(1);expect(answer.details.apiAttempts).toBe(200);});
 it('validates ingress offline and forbids bypassing source-first scheduling',async()=>{expect(validateAiArguments(['ai:hourly:pipeline','--hour=1','--period=1','--source-max-results=50'])).toMatchObject({sourceMaxResults:50,sourceMaxPages:1,userToken:'cli'});await expect(executeAiWorkflow(['ai:hourly','--from=2026-10-10 00:00:00','--to=2026-10-10 00:59:59','--execute'],{},true)).rejects.toThrow('source-first');});
});
