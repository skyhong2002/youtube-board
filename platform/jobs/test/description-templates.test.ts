import {expect,it} from 'vitest';
import {createHash} from 'node:crypto';
import type {Connection} from 'mysql2/promise';
import {buildDescriptionTemplateProfile,descriptionExclusions,loadDescriptionTemplateProfiles,templateProfileProof,type TemplateSample} from '../src/description-templates.js';
import {evidenceForVideo,MATCH_RULE} from '../src/video-evidence.js';
import {SOURCE,aggregateTerms,type VocabularySnapshot} from '../src/vocabulary.js';
import {tagDisplayExclusion,tagDisplayGroup} from '../../shared/youtube-match-policy.js';
import {planRecentWindow,parseRecentCheckpoint} from '../src/recent-video-evidence.js';
const samples=(n=8):TemplateSample[]=>Array.from({length:n},(_,i)=>({pk:i+1,videoId:'Sample'+String(i).padStart(5,'0'),publishedAt:`2036-05-${String(i+1).padStart(2,'0')} 10:00:00`,description:i<4?'  YouTube 官方平台  \nYouTube 官方平台\n獨特'+i:'其他'+i}));
const snapshot:VocabularySnapshot={id:'quality-fixture',source:SOURCE,window:null,publishedAt:'',coverage:'observed-article-window',upstreamSnapshotConsistent:false,terms:aggregateTerms([{id:'1',media:'fixture',publishedAt:'',tags:['YouTube','Facebook','交通','台灣','AI','Youtube','新','新聞']}])};
it('requires eight samples, counts each line once per video and excludes exactly50percent',()=>{
 const profile=buildDescriptionTemplateProfile(1,samples());expect(profile).toMatchObject({sampleCount:8,status:'ready',repeatedLines:[{line:'YouTube 官方平台',count:4}]});
 expect(buildDescriptionTemplateProfile(1,samples(7))).toMatchObject({status:'insufficient-sample',repeatedLines:[]});
 const fewer=samples();fewer[0]!.description='其他0';expect(buildDescriptionTemplateProfile(1,fewer).repeatedLines).toEqual([]);
 expect(buildDescriptionTemplateProfile(1,[...samples().reverse()]).digest).toBe(profile.digest);
 const changed=samples();changed[0]!.description+='新行';expect(buildDescriptionTemplateProfile(1,changed).digest).not.toBe(profile.digest);
});
it('retains actual title subjects and offsets while suppressing description template/URL/CTA/hashtag spans',()=>{
 const profile=buildDescriptionTemplateProfile(1,samples()),video={channelId:1,pk:2,videoId:'Video123456',title:'😀YouTube裁員與Facebook政策 https://YouTube.test',description:'台灣交通政策\r\nYouTube 官方平台\n歡迎訂閱 Facebook 頻道\n連結 https://YouTube.test/news\n新聞內容 #台灣 #AI\n訂閱數下降引發YouTube裁員',observedAt:null};
 const result=evidenceForVideo(video,snapshot,profile);
 expect(result.evidence.filter(e=>e.field==='title').map(e=>e.term)).toEqual(['YouTube','Facebook','YouTube']);
 expect(result.evidence.filter(e=>e.field==='description').map(e=>e.term)).toEqual(['台灣','交通','新聞','YouTube']);
 for(const row of [...result.evidence,...result.quality.excluded]){expect(row.text).toBe(video[row.field].slice(row.start,row.end));expect(row.method).toBe(MATCH_RULE);}
 expect(new Set(result.quality.excluded.flatMap(e=>e.reasons))).toEqual(new Set(['channel-repeated-line','social-cta','url','hashtag-stack','single-character-substring']));
 expect(JSON.stringify(result.quality.profile)).not.toContain('YouTube 官方平台');expect(result.quality).not.toHaveProperty('description');
 expect(snapshot.terms.map(t=>t.term)).toContain('Facebook');expect(result.evidence.some(e=>e.term==='Facebook')).toBe(true);
 expect(()=>evidenceForVideo(video,snapshot,undefined as never)).toThrow('profile');expect(()=>evidenceForVideo(video,snapshot,buildDescriptionTemplateProfile(2,[]))).toThrow('profile');
});
it('uses exact upstream display policy without changing source terms or interpreting noEqual as matching deletion',()=>{
 for(const term of ['Facebook','YouTuber','交通','台灣','政治','新','123月','2026年','⭐'])expect(tagDisplayExclusion(term)).not.toBeNull();
 for(const term of ['AI','假新聞','人工智慧'])expect(tagDisplayExclusion(term)).toBeNull();
 expect(tagDisplayGroup('ＡＩ')).not.toBe(tagDisplayGroup(' ai '));expect(tagDisplayGroup('AI')).toBe(tagDisplayGroup('ai'));expect(tagDisplayExclusion('YouTube')).toBe('youtube-platform-or-promotion');
 const profile=buildDescriptionTemplateProfile(1,[]),result=evidenceForVideo({channelId:1,pk:1,videoId:'Video123456',title:'Facebook 台灣 交通 新聞 新',description:'',observedAt:null},snapshot,profile);
 expect(result.evidence.map(e=>e.term)).toEqual(['Facebook','台灣','交通','新聞','新']);
 expect(result.evidence.every(e=>snapshot.terms.some(t=>t.key===e.termKey&&t.term===e.term))).toBe(true);
});
it('bounds descriptions/profileaudit and returns hashes sufficient to trace sample content',()=>{
 expect(()=>buildDescriptionTemplateProfile(1,[{...samples()[0]!,description:'x'.repeat(20001)}])).toThrow();
 for(const publishedAt of ['0000-00-00 00:00:00','2036-02-31 12:00:00','2036-05-12 25:00:00'])expect(()=>buildDescriptionTemplateProfile(1,[{...samples()[0]!,publishedAt}])).toThrow();
 const p=buildDescriptionTemplateProfile(1,samples()),proof=templateProfileProof(p);
 expect(proof.repeatedLines[0]?.lineSha256).toBe(createHash('sha256').update('YouTube 官方平台').digest('hex'));
 expect(descriptionExclusions({title:'https://YouTube.test',description:'Facebook 裁員新聞'},buildDescriptionTemplateProfile(1,[]))).toEqual([]);
});
it('refuses an oversized exclusion audit rather than publishing partial quality evidence',()=>{
 const video={channelId:1,pk:1,videoId:'Video123456',title:'AI',description:'歡迎訂閱 AI\n'.repeat(2000),observedAt:null};
 expect(()=>evidenceForVideo(video,snapshot,buildDescriptionTemplateProfile(1,[]))).toThrow('audit exceeds cap');
});
it('batches channels once withlatest20 ordering, cappedfields andtimeouts; isolates an oversized sample',async()=>{
 const calls:Array<{sql:string;params:unknown[]}> = [];
 const db={query:async(sql:string,params:unknown[])=>{calls.push({sql,params});return [[{u_id:1,pk:1,videoId:'Video123456',publishedAt:'2036-05-01 10:00:00',description:'x',description_bytes:90000}],[]];}} as unknown as Connection;
 const result=await loadDescriptionTemplateProfiles(db,[1,1,2], '2036-05-12 12:00:00');
 expect(calls).toHaveLength(1);expect(calls[0]?.sql).toContain('SET STATEMENT max_statement_time=5');expect(calls[0]?.sql.match(/LIMIT 20/g)).toHaveLength(2);expect(calls[0]?.sql).toContain('ORDER BY publishedAt DESC,pk DESC');expect(calls[0]?.params).toEqual([1,'2036-05-12 12:00:00',2,'2036-05-12 12:00:00']);
 expect(result.get(1)).toEqual({profile:null,reason:'sample-budget-exceeded'});expect(result.get(2)?.profile?.status).toBe('insufficient-sample');
});
it('validates legacy checkpoint before rulechange resets cursor without pretending raw evidence isnewquality',()=>{
 const now=new Date('2036-05-12T04:00:00Z'),current=planRecentWindow(null,'same-vocab',now).checkpoint;
 const legacy={...current,schemaVersion:1,ruleVersion:undefined,generation:createHash('sha256').update(JSON.stringify([current.vocabularyVersion,current.windowFrom,current.windowUntil])).digest('hex'),processed:1,written:1,cursor:{publishedAt:'2036-05-12 11:00:00',pk:7}};
 const parsed=parseRecentCheckpoint(JSON.stringify(legacy)),next=planRecentWindow(parsed,'same-vocab',new Date(+now+1));
 expect(next.action).toBe('new-rule');expect(next.checkpoint).toMatchObject({schemaVersion:2,ruleVersion:MATCH_RULE,cursor:null,processed:0});expect(next.checkpoint.generation).not.toBe(parsed.generation);
 expect(()=>parseRecentCheckpoint(JSON.stringify({...legacy,schemaVersion:'1'}))).toThrow();
});
it('keeps legitimate 24小時 title tags while excluding repeated channel-description use',()=>{
 expect(tagDisplayExclusion('24小時')).toBeNull();
 const profile=buildDescriptionTemplateProfile(1,Array.from({length:8},(_,i)=>({pk:i+1,videoId:'Timing'+String(i).padStart(5,'0'),publishedAt:'2026-10-10 12:00:00',description:'24小時新聞不間斷'})));
 const snapshot:VocabularySnapshot={id:'timing-test',source:SOURCE,window:null,publishedAt:'',coverage:'observed-article-window' as const,upstreamSnapshotConsistent:false,matchingRule:'youtube-quality-v2' as const,terms:aggregateTerms([{id:'1',media:'fixture',publishedAt:'',tags:['24小時']}])};
 const result=evidenceForVideo({channelId:1,pk:1,videoId:'Timing00000',title:'攻擊發生前24小時',description:'24小時新聞不間斷',observedAt:null},snapshot,profile);
 expect(result.evidence.map(e=>({term:e.term,field:e.field}))).toEqual([{term:'24小時',field:'title'}]);
 expect(result.quality.excluded).toHaveLength(1);expect(result.quality.excluded[0]?.reasons).toContain('channel-repeated-line');
});

it('excludes authorized news sources and no-equal terms while retaining named subjects',()=>{
 for(const term of ['Yahoo','yahoo',' YAHOO ','合作媒體','TVBS','tvbs','聯合','三立'])expect(tagDisplayExclusion(term)).toBe('youtube-source-or-platform');
 for(const term of ['美國','民進黨'])expect(tagDisplayExclusion(term)).toBe('upstream-no-equal-or-category');
 for(const term of ['沈伯洋','川普','台積電'])expect(tagDisplayExclusion(term)).toBeNull();
});


it('audited display noise uses whole terms and does not delete source matching evidence',()=>{
 for(const term of ['支持','登場','粉絲','真相','曝光','未來','市場','打造','持續','公開','畫面','危機','影響','服務','感謝','攻擊','互動','投資','安全','挑戰','成功','相關','歷史','關注'])expect(tagDisplayExclusion(term)).toBe('youtube-generic-two-character');
 for(const term of ['中共','北京','烏克蘭'])expect(tagDisplayExclusion(term)).toBe('youtube-country-city-party');
 for(const term of ['沈伯洋','川普','台積電','國慶','雙十國慶','新聞直播','AI','假新聞','烏克蘭戰爭','中共軍演','市場改革','支持者'])expect(tagDisplayExclusion(term)).toBeNull();
 expect(tagDisplayExclusion(' 支持 ')).toBe('youtube-generic-two-character');
 const pool={...snapshot,terms:aggregateTerms([{id:'fixture',media:'fixture',publishedAt:'',tags:['支持','中共','烏克蘭','國慶']}])};
 const before=JSON.stringify(pool);const result=evidenceForVideo({channelId:1,pk:1,videoId:'Video123456',title:'支持 中共 烏克蘭 國慶',description:'',observedAt:null},pool,buildDescriptionTemplateProfile(1,[]));
 expect(result.evidence.map(e=>e.term)).toEqual(['支持','中共','烏克蘭','國慶']);
 expect(JSON.stringify(pool)).toBe(before);
});

it('supplements qualified pool refill with exact general context and reusable city labels',()=>{
 expect(tagDisplayExclusion('TVBS新聞')).toBe('upstream-tag-noise');
 for(const term of ['報導','回應','討論','專訪','風險','質疑','表態'])expect(tagDisplayExclusion(term)).toBe('youtube-generic-two-character');
 for(const term of ['主持人','議員','政府'])expect(tagDisplayExclusion(term)).toBe('youtube-generic-context');
 for(const term of ['桃園','桃園市','台南','臺南市','台東','臺東縣','伊朗'])expect(tagDisplayExclusion(term)).toBe('youtube-country-city-party');
 for(const term of ['沈伯洋','川普','台積電','國慶演說','假民主真獨裁','青年','理財','手機','台北市長','桃園機場','巨大','巨大機械','聯合國','三立電視'])expect(tagDisplayExclusion(term)).toBeNull();
});
