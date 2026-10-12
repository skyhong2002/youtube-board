import {expect,it,vi} from 'vitest';
import {matchVocabularyWithExclusions} from '../src/match.js';
import {aggregateTerms,SOURCE,type VocabularySnapshot} from '../src/vocabulary.js';
import {buildDescriptionTemplateProfile} from '../src/description-templates.js';
import {evidenceForVideo} from '../src/video-evidence.js';
const vocabulary=(tags:string[]):VocabularySnapshot=>({id:'boundary-quality',source:SOURCE,window:null,publishedAt:'',coverage:'observed-article-window',upstreamSnapshotConsistent:false,terms:aggregateTerms([{id:'1',media:'test',publishedAt:'',tags}])});
it('single-codepoint words require standalone boundaries while multi-CJK reporter tags still match phrases',()=>{
 const snapshot=vocabulary(['性','新','𠮷','記者','新聞']),title='穩定性與性別 新新聞 𠮷野 性；新！𠮷。資深記者報導',result=matchVocabularyWithExclusions({title},snapshot,[]);
 expect(result.evidence.map(row=>row.term)).toEqual(['新聞','性','新','𠮷','記者']);
 expect(result.excluded.filter(row=>row.term==='性')).toHaveLength(2);
 expect(result.excluded.every(row=>row.reasons.includes('single-character-substring'))).toBe(true);
 for(const row of [...result.evidence,...result.excluded])expect(title.slice(row.start,row.end)).toBe(row.text);
 expect(snapshot.terms.map(row=>row.term)).toContain('性');
});
it('ASCII case aliases yield one stable original-key occurrence and retain every original alias identity',()=>{
 const snapshot=vocabulary(['AI','ai','Ai']),title='😀AI ai Ai aI AIDS XAI AI_2 ai研究';
 const result=matchVocabularyWithExclusions({title},snapshot,[]),canonical=[...snapshot.terms].sort((a,b)=>a.key<b.key?-1:1)[0]!;
 expect(result.evidence.map(row=>row.text)).toEqual(['AI','ai','Ai','aI','ai']);
 expect(result.evidence.every(row=>row.termKey===canonical.key&&row.term===canonical.term)).toBe(true);
 for(const row of result.evidence){expect(title.slice(row.start,row.end)).toBe(row.text);expect(row.sourceTerms).toEqual(snapshot.terms.map(({key,term})=>({termKey:key,term})));}
 expect(result.evidence[0]!.start).toBe(2);
 expect(matchVocabularyWithExclusions({title},{...snapshot,terms:[...snapshot.terms].reverse()},[])).toEqual(result);
});
it('does not apply expanding Unicode folds or compatibility normalization to source offsets',()=>{
 const snapshot=vocabulary(['İ','ß','SS','AI']),title='😀İ ß SS ss ＡＩ';
 const result=matchVocabularyWithExclusions({title},snapshot,[]);
 expect(result.evidence.map(row=>row.text)).toEqual(['İ','ß','SS','ss']);
 for(const row of result.evidence)expect(title.slice(row.start,row.end)).toBe(row.text);
});
it('single ASCII and digit terms have the same explicit substring exclusion audit as CJK',()=>{
 const snapshot=vocabulary(['A','1']),result=matchVocabularyWithExclusions({title:'CAT 123 A 1 中文A A中文'},snapshot,[]);
 expect(result.evidence.map(row=>row.text)).toEqual(['A','1']);
 expect(result.excluded).toHaveLength(4);
 expect(result.excluded.every(row=>row.reasons.includes('single-character-substring'))).toBe(true);
});
it('quality journal persists accepted alias identity once per occurrence and single-character exclusion reasons',()=>{
 const snapshot=vocabulary(['AI','ai','性']),video={channelId:1,pk:1,videoId:'Video123456',title:'😀ai 穩定性',description:'',observedAt:null};
 const result=evidenceForVideo(video,snapshot,buildDescriptionTemplateProfile(1,[]));
 expect(result.evidence).toHaveLength(1);expect(result.quality.acceptedAliases).toHaveLength(1);
 expect(result.quality.acceptedAliases[0]).toEqual({termKey:result.evidence[0]!.termKey,field:'title',start:2,end:4,sourceTerms:result.evidence[0]!.sourceTerms});
 expect(result.quality.excluded[0]).toMatchObject({term:'性',reasons:['single-character-substring']});
 expect(JSON.parse(result.qualityJson).acceptedAliases[0].sourceTerms.map((row:{term:string})=>row.term).sort()).toEqual(['AI','ai']);
});
it('bounds repeated case-alias serialization before building the quality JSON',()=>{
 const term='abcdefghij',aliases=Array.from({length:512},(_,mask)=>[...term].map((char,index)=>mask&(1<<index)?char.toUpperCase():char).join(''));
 const snapshot=vocabulary(aliases),video={channelId:1,pk:1,videoId:'Video123456',title:(term+' ').repeat(500),description:'',observedAt:null},profile=buildDescriptionTemplateProfile(1,[]);
 const stringify=vi.spyOn(JSON,'stringify');
 try{expect(()=>evidenceForVideo(video,snapshot,profile)).toThrow('audit exceeds cap');expect(stringify.mock.calls.some(([value])=>value&&typeof value==='object'&&'acceptedAliases' in value)).toBe(false);}
 finally{stringify.mockRestore();}
});
