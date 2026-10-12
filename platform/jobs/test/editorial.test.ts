import {describe,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {parseCommand,actorFrom} from '../../shared/editorial/contracts.js';
import {validateEditorialArguments,executeEditorialWorkflow} from '../src/editorial-cli.js';
const base=()=>({requestId:randomUUID(),id:randomUUID(),reason:'已核對原始來源'});
describe('editorial command contracts',()=>{
 it('accepts exact explicit source refs and stable UUID identities',()=>expect(parseCommand({...base(),action:'create',title:'地方事件',sources:[{kind:'daily',sourceId:'10:0'},{kind:'video',sourceId:'ABCDEFGHIJK'}]}).sources).toHaveLength(2));
 it('rejects automatic identity hints, actor assertions, duplicate references and invalid variants',()=>{
  const c={...base(),action:'create',title:'地方事件',sources:[{kind:'video',sourceId:'ABCDEFGHIJK'}]};
  for(const other of [{...c,actor:'forged'},{...c,similarity:0.9},{...c,id:c.id.toUpperCase()},{...c,sources:[...c.sources,...c.sources]},{...c,sources:[{kind:'video',sourceId:'https://youtube.com/test'}]},{...c,sources:[{kind:'video',sourceId:'ABCDEFGHIJK',headline:'forged'}]},{...c,title:' '.repeat(3)}])expect(()=>parseCommand(other)).toThrow();
 });
 it('requires exact UC channel ID, expected versions and explicit split refs',()=>{
  expect(parseCommand({...base(),action:'candidate.submit',channelId:'UC'+'A'.repeat(22),proposedName:'記者頻道'}).channelId).toHaveLength(24);
  for(const channelId of ['uc'+'A'.repeat(22),'UC'+'A'.repeat(21),'@name','UC'+'A'.repeat(22)+' '])expect(()=>parseCommand({...base(),action:'candidate.submit',channelId,proposedName:'頻道'})).toThrow();
  expect(()=>parseCommand({...base(),action:'rename',title:'新名'})).toThrow();expect(()=>parseCommand({...base(),action:'split',title:'新事件',expectedVersion:1,targetId:randomUUID(),sourceIds:[]})).toThrow();
 });
 it('rejects self merges/splits and alternative numeric spellings of the same daily source',()=>{
  const b=base();expect(()=>parseCommand({...b,action:'merge',targetId:b.id,expectedVersion:1,targetVersion:1})).toThrow('INVALID_TARGET');
  expect(()=>parseCommand({...b,action:'split',targetId:b.id,expectedVersion:1,title:'拆分',sourceIds:[randomUUID()]})).toThrow('INVALID_TARGET');
  for(const sourceId of ['123:00','0123:0','123:01'])expect(()=>parseCommand({...base(),action:'create',title:'事件',sources:[{kind:'daily',sourceId}]})).toThrow('INVALID_SOURCE_ID');
 });
 it('requires source snapshot version for article refs and rejects unsafe URL schemes',()=>{
  const c={...base(),action:'create',title:'跨來源',sources:[{kind:'article',sourceId:'123',headline:'轉錄標題',url:'https://news.example/article/123',sourceVersion:'v1'}]};expect(parseCommand(c).sources).toHaveLength(1);
  for(const url of ['javascript:alert(1)','file:///etc/passwd','https://user:secret@example.com'])expect(()=>parseCommand({...c,sources:[{...c.sources[0],url}]})).toThrow();
 });
 it('requires server actor attribution and never accepts browser actor',()=>{expect(()=>actorFrom({})).toThrow();expect(actorFrom({TS_OPS_ACTOR:'editorial-team'})).toBe('editorial-team');});
 it('validates capped operator-only adoption without connecting or making provider calls',async()=>{
  const args=['youtube:channels:adopt','--candidate-id='+randomUUID(),'--request-id='+randomUUID(),'--expected-version=2'];expect(validateEditorialArguments(args).execute).toBe(false);
  expect(()=>validateEditorialArguments([...args,'--limit=100'])).toThrow();expect(()=>validateEditorialArguments([...args,'--execute','--dry-run'])).toThrow();
  await expect(executeEditorialWorkflow(args,{},true)).rejects.toThrow('operator-only');await expect(executeEditorialWorkflow([...args,'--execute'],{APP_ENV:'production',TS_OPS_ACTOR:'operator'})).rejects.toThrow('disabled');
 });
});
