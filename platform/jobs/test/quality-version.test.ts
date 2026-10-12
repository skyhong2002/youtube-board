import {expect,it} from 'vitest';
import {matchingRuleForSnapshot} from '../../shared/youtube-match-policy.js';
import {storeVideoEvidence} from '../src/video-evidence.js';
it('keeps legacy readers active until an explicitly staged quality version is selected',()=>{
 expect(matchingRuleForSnapshot({})).toBe('exact-text-v1');expect(matchingRuleForSnapshot({matchingRule:'youtube-quality-v2'})).toBe('youtube-quality-v2');expect(()=>matchingRuleForSnapshot({matchingRule:'unknown'})).toThrow();
});
it('refuses evidence writes for a legacy serving version before touching the database',async()=>{
 await expect(storeVideoEvidence({} as any,{} as any,{matchingRule:undefined} as any,{} as any)).rejects.toThrow();
});
it('keeps the legacy shared matcher semantics until explicit quality activation',async()=>{
 const {matchVocabulary}=await import('../src/match.js');
 const {aggregateTerms,SOURCE}=await import('../src/vocabulary.js');
 const snapshot:import('../src/vocabulary.js').VocabularySnapshot={id:'legacy',source:SOURCE,coverage:'observed-article-window' as const,window:null,publishedAt:'',upstreamSnapshotConsistent:false,terms:aggregateTerms([{id:'1',media:'fixture',publishedAt:'',tags:['AI']}])};
 expect(matchVocabulary({title:'ai'},snapshot)).toEqual([]);expect(matchVocabulary({title:'AI'},snapshot)[0]?.method).toBe('exact-text-v1');
 expect(matchVocabulary({title:'ai'},{...snapshot,matchingRule:'youtube-quality-v2'})[0]?.method).toBe('youtube-quality-v2');
});
it('batches evidence inserts by count and encoded bytes while preserving every occurrence',async()=>{
 const {evidenceInsertBatches}=await import('../src/video-evidence.js');
 const e={termKey:'a'.repeat(64),term:'AI',vocabularyVersion:'candidate',source:'https://tag.observe.tw',field:'title' as const,start:0,end:2,text:'AI',method:'youtube-quality-v2' as const,snippet:'AI',snippetStart:0};
 const rows=Array.from({length:205},(_,i)=>({...e,start:i*2,end:i*2+2})),batch=evidenceInsertBatches('Video123456','candidate',rows);
 expect(batch.map(b=>b.length)).toEqual([100,100,5]);expect(batch.flat().map(r=>r[6])).toEqual(rows.map(r=>r.start));
 const large=evidenceInsertBatches('Video123456','candidate',Array.from({length:30},()=>({...e,snippet:'字'.repeat(10000)})));
 expect(large.length).toBeGreaterThan(1);expect(large.every(b=>512+b.reduce((sum,r)=>sum+128+r.reduce<number>((n,v)=>n+(typeof v==='string'?Buffer.byteLength(v)+8:8),0),0)<=256*1024)).toBe(true);
 expect(()=>evidenceInsertBatches('Video123456','candidate',[{...e,snippet:'x'.repeat(256*1024)}])).toThrow('byte cap');
});
