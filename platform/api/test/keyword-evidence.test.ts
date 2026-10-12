import {expect,it} from 'vitest';
import {boundedKeywordEvidence,enrichKeywordEvidence} from '../src/reports/keyword-evidence.js';
import {MySqlDialect} from 'drizzle-orm/mysql-core';
import type {Reader} from '../src/db/client.js';
import type {VideoRow} from '../src/contracts.js';
const row={video_id:'Video123456',term:'AI',field_name:'title',snippet:'😀AI 新聞',start_offset:2,end_offset:4,snippet_start:0};
it('bounds snippets per video and rejects foreign identity, malformed offsets and oversized data',()=>{
 const ids=new Set([row.video_id]);
 expect(boundedKeywordEvidence(Array(4).fill(row),ids).get(row.video_id)).toHaveLength(3);
 for(const bad of [{...row,video_id:'other'},{...row,start_offset:-1},{...row,end_offset:200},{...row,snippet:'x'.repeat(513)},{...row,field_name:'private'}])expect(boundedKeywordEvidence([bad],ids).size).toBe(0);
 expect(boundedKeywordEvidence(Array(151).fill(row),ids).size).toBe(0);
});
it('reads at most fifty selected video identities and ranks snippets before limiting',async()=>{
 const dialect=new MySqlDialect();let captured:any;
 const reader={close:async()=>{},rows:async(q:any)=>{captured=dialect.sqlToQuery(q);return [row];}} as Reader;
 const videos=Array.from({length:51},(_,i)=>({id:i===0?row.video_id:'v'+i}) as VideoRow);
 await enrichKeywordEvidence(reader,videos,'candidate-v2','youtube-quality-v2',[{key:'a'.repeat(64),term:'AI'}]);
 expect(captured.sql).toContain('ROW_NUMBER() OVER(PARTITION BY e.video_id');expect(captured.sql).toContain('evidence_rank<=3 LIMIT 151');expect(captured.params).not.toContain('v50');expect(captured.params).toContain('candidate-v2');expect(captured.params).toContain('youtube-quality-v2');expect(videos[0]?.keywordEvidence?.[0]?.snippet).toBe('😀AI 新聞');expect(videos[50]?.keywordEvidence).toBeUndefined();
});
