import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import type {AccountSession} from '../../../shared/account-contracts';
import {KeywordReviewError,applyVocabularyChoice,buildDecideCommand,buildSubmitCommand,executeReviewCommand,fetchReviewDetail,fetchReviewList,fetchReviewStatus,isKeywordReviewEndpoint,keywordReviewFetch,keywordReviewMessage,lookupVocabulary,needsRepreview,parseReview,parseStatus,parseVocabularyLookup,previewReviewCommand,reasonProblem,vocabularyLookupUrl,type SubmitCommand,type SubmitInput} from './keyword-review-client';

const session:AccountSession={enabled:true,user:{id:7,email:'admin@example.test',name:'管理員',picture:null,role:'admin',adminSource:'granted'},csrfToken:'csrf-fixture'};
const ID='11111111-1111-4111-8111-111111111111',REQ='22222222-2222-4222-8222-222222222222',KEY='a'.repeat(64),HASH='b'.repeat(64);
// ID is numeric-only (uppercasing leaves it unchanged and valid); ALPHA has a-f so its uppercase form is a real lowercase-contract violation.
const ALPHA='abcdef01-2345-4abc-9def-0123456789ab',ALPHA_UPPER=ALPHA.toUpperCase();
const reviewFixture=(over:Record<string,unknown>={})=>({id:ID,revision:1,status:'pending',decision:'exclude',context:'youtube-ranking-display',evidence:{vocabularyVersion:'v2026_10',termKey:KEY,rawTerm:'直播',ruleVersion:'youtube-quality-v2',payload:{key:KEY,term:'直播',upstreamId:'up-42',media:['公視','<b>x</b>'],privateNote:'PAYLOAD_SECRET'},source:'https://tag.observe.tw',sha256:HASH},submittedBy:'user:7',reason:'平台用語',applied:false,applicationStatus:'not-applied',createdAt:'2026-10-01T00:00:00.000Z',updatedAt:'2026-10-01T00:00:00.000Z',...over});
const statusFixture={enabled:true,writeEnabled:false,schemaReady:true,status:'ready',phase:'review-record-only',applied:false,applicationStatus:'not-applied',rankingOverlayEnabled:false};
type Call={url:string;init:RequestInit|undefined};
const recorder=(respond:(url:string,init?:RequestInit)=>Response|Promise<Response>)=>{const calls:Call[]=[];const fetcher=(async(url:RequestInfo|URL,init?:RequestInit)=>{calls.push({url:String(url),init});return respond(String(url),init);}) as typeof fetch;return {calls,fetcher};};
const submit:SubmitCommand={requestId:REQ,id:ID,action:'submit',reason:'平台用語',vocabularyVersion:'v2026_10',termKey:KEY,ruleVersion:'youtube-quality-v2',context:'youtube-ranking-display',decision:'exclude'};

test('endpoint allowlist accepts only exact keyword-review paths and methods',()=>{
 assert.notEqual(ALPHA_UPPER,ALPHA);assert.equal(ID.toUpperCase(),ID);
 for(const [p,m] of [['/api/ops/keyword-reviews/status','GET'],['/api/ops/keyword-reviews?page=1','GET'],['/api/ops/keyword-reviews?page=3&version=v2026_10','GET'],['/api/ops/keyword-reviews/'+ID,'GET'],['/api/ops/keyword-reviews/'+ID.toUpperCase(),'GET'],['/api/ops/keyword-reviews/'+ALPHA,'GET'],['/api/ops/keyword-reviews/preview','POST'],['/api/ops/keyword-reviews/execute','POST']])assert.equal(isKeywordReviewEndpoint(p!,m!),true,p);
 for(const [p,m] of [['https://evil.test/api/ops/keyword-reviews/status','GET'],['//evil.test/api/ops/keyword-reviews/status','GET'],['/api/ops/keyword-reviews/status','POST'],['/api/ops/keyword-reviews/preview','GET'],['/api/ops/keyword-reviews','GET'],['/api/ops/keyword-reviews?page=0','GET'],['/api/ops/keyword-reviews?page=1001','GET'],['/api/ops/keyword-reviews?page=1&version=../x','GET'],['/api/ops/keyword-reviews?page=1&admin=1','GET'],['/api/ops/keyword-reviews?page=1&page=2','GET'],['/api/ops/keyword-reviews/'+ALPHA_UPPER,'GET'],['/api/ops/keyword-reviews/ABCDEF01-2345-4abc-9def-0123456789ab','GET'],['/api/v1/vocabulary?q=x&limit=20','GET'],['/api/ops/keyword-reviews/'+ID+'/x','GET'],['/api/ops/keyword-reviews/'+ID,'DELETE'],['/api/ops/keyword-reviews/execute?x=1','POST'],['/api/ops/keyword-reviews/../editorial','GET'],['/api/ops/editorial','GET'],['/api/ops/keyword-reviewsstatus','GET'],['/api/ops/keyword-reviews/preview','PUT']])assert.equal(isKeywordReviewEndpoint(p!,m!),false,p+' '+m);
});
test('arbitrary destinations, methods and unauthenticated writes fail before any fetch',async()=>{
 const {calls,fetcher}=recorder(()=>Response.json({}));
 await assert.rejects(keywordReviewFetch('https://evil.test/api/ops/keyword-reviews/status','GET',{fetcher}),{code:'INVALID_CLIENT_REQUEST'});
 await assert.rejects(keywordReviewFetch('/api/ops/keyword-reviews/status','PUT' as 'GET',{fetcher}),{code:'INVALID_CLIENT_REQUEST'});
 await assert.rejects(previewReviewCommand(submit,null,{fetcher}),{code:'SIGN_IN_REQUIRED'});
 await assert.rejects(previewReviewCommand(submit,{enabled:true,user:null,csrfToken:null},{fetcher}),{code:'SIGN_IN_REQUIRED'});
 await assert.rejects(fetchReviewDetail('not-a-uuid',{fetcher}),{code:'INVALID_REVIEW_ID'});
 await assert.rejects(fetchReviewDetail(ALPHA_UPPER,{fetcher}),{code:'INVALID_REVIEW_ID'});
 await assert.rejects(fetchReviewList(1,'bad version',{fetcher}),{code:'INVALID_REVIEW_QUERY'});
 assert.equal(calls.length,0);
});
test('reads use same-origin credentials, no-store, no Authorization and no CSRF; writes add CSRF only',async()=>{
 const {calls,fetcher}=recorder(url=>url.endsWith('/status')?Response.json(statusFixture):Response.json({mode:'preview',command:submit,before:null,after:reviewFixture(),previewHash:HASH,warnings:['覆核只記錄提案與決策，尚未套用排行或文字比對。'],writes:0,applied:false,applicationStatus:'not-applied',actor:'user:7'}));
 const info=await fetchReviewStatus({fetcher});assert.equal(info.writeEnabled,false);
 const preview=await previewReviewCommand(submit,session,{fetcher});
 assert.equal(calls[0]!.url,'/api/ops/keyword-reviews/status');assert.equal(calls[1]!.url,'/api/ops/keyword-reviews/preview');
 for(const c of calls){assert.equal(c.init?.credentials,'same-origin');assert.equal(c.init?.cache,'no-store');assert.ok(c.init?.signal);assert.equal(new Headers(c.init?.headers).has('authorization'),false);}
 assert.equal(new Headers(calls[0]!.init?.headers).has('x-csrf-token'),false);
 assert.equal(new Headers(calls[1]!.init?.headers).get('x-csrf-token'),'csrf-fixture');assert.equal(calls[1]!.init?.method,'POST');
 assert.deepEqual(JSON.parse(String(calls[1]!.init?.body)),{command:submit});assert.doesNotMatch(String(calls[1]!.init?.body),/csrf/);
 assert.equal(preview.after.evidence.rawTerm,'直播');assert.equal(preview.applied,false);
});
test('execute sends the exact previewed command and hash; replay result is accepted',async()=>{
 const {calls,fetcher}=recorder(()=>Response.json({mode:'execute',review:reviewFixture(),requestId:REQ,replayed:true,applied:false,applicationStatus:'not-applied'}));
 const done=await executeReviewCommand({command:submit,previewHash:HASH},session,{fetcher});
 assert.deepEqual(JSON.parse(String(calls[0]!.init?.body)),{command:submit,previewHash:HASH,execute:true});assert.equal(done.replayed,true);assert.equal(done.applied,false);
 await assert.rejects(executeReviewCommand({command:submit,previewHash:'short'},session,{fetcher}),{code:'PREVIEW_REQUIRED'});
});
test('execute failures distinguish definitive refusals from uncertain outcomes',async()=>{
 const net=recorder(()=>{throw new Error('socket reset');});
 await assert.rejects(executeReviewCommand({command:submit,previewHash:HASH},session,{fetcher:net.fetcher}),(e:unknown)=>e instanceof KeywordReviewError&&e.uncertain&&e.code==='NETWORK_ERROR');
 const unavailable=recorder(()=>Response.json({error:{code:'KEYWORD_REVIEW_UNAVAILABLE'}},{status:503}));
 await assert.rejects(executeReviewCommand({command:submit,previewHash:HASH},session,{fetcher:unavailable.fetcher}),(e:unknown)=>e instanceof KeywordReviewError&&e.uncertain);
 const conflict=recorder(()=>Response.json({error:{code:'PREVIEW_CHANGED'}},{status:409}));
 await assert.rejects(executeReviewCommand({command:submit,previewHash:HASH},session,{fetcher:conflict.fetcher}),(e:unknown)=>e instanceof KeywordReviewError&&!e.uncertain&&needsRepreview(e));
 const malformed=recorder(()=>Response.json({mode:'execute',review:reviewFixture({applied:true}),requestId:REQ,replayed:false,applied:false,applicationStatus:'not-applied'}));
 await assert.rejects(executeReviewCommand({command:submit,previewHash:HASH},session,{fetcher:malformed.fetcher}),(e:unknown)=>e instanceof KeywordReviewError&&e.uncertain&&e.code==='MALFORMED_RESPONSE');
 const gated=recorder(()=>Response.json({error:{code:'KEYWORD_REVIEW_WRITE_DISABLED'}},{status:403}));
 await assert.rejects(executeReviewCommand({command:submit,previewHash:HASH},session,{fetcher:gated.fetcher}),(e:unknown)=>e instanceof KeywordReviewError&&!e.uncertain&&/仍可預覽/.test(e.message));
});
test('errors are localized from bounded known codes only and never echo server detail',async()=>{
 const raw=recorder(()=>Response.json({error:{code:'ER_ACCESS_DENIED: user secret@db'}},{status:500}));
 await assert.rejects(fetchReviewStatus({fetcher:raw.fetcher}),(e:unknown)=>e instanceof KeywordReviewError&&e.code==='KEYWORD_REVIEW_UNAVAILABLE'&&!e.message.includes('secret'));
 const expired=recorder(()=>new Response('not json',{status:401}));
 await assert.rejects(fetchReviewStatus({fetcher:expired.fetcher}),(e:unknown)=>e instanceof KeywordReviewError&&e.code==='SIGN_IN_REQUIRED'&&e.status===401);
 const csrf=recorder(()=>Response.json({error:{code:'CSRF_REJECTED'}},{status:403}));
 await assert.rejects(previewReviewCommand(submit,session,{fetcher:csrf.fetcher}),(e:unknown)=>e instanceof KeywordReviewError&&/CSRF/.test(e.message));
 const forbidden=recorder(()=>Response.json({},{status:403}));
 await assert.rejects(fetchReviewStatus({fetcher:forbidden.fetcher}),{code:'FORBIDDEN'});
 assert.equal(keywordReviewMessage(new Error('raw sql')),'覆核操作暫時無法完成，請稍後重試。');
});
test('runtime validation fails closed on applied, unknown enums, overlay and unbounded arrays',async()=>{
 assert.throws(()=>parseStatus({...statusFixture,applied:true}),{code:'MALFORMED_RESPONSE'});
 assert.throws(()=>parseStatus({...statusFixture,rankingOverlayEnabled:true}),{code:'MALFORMED_RESPONSE'});
 assert.throws(()=>parseStatus({...statusFixture,status:'live'}),{code:'MALFORMED_RESPONSE'});
 assert.throws(()=>parseStatus({...statusFixture,enabled:false}),{code:'MALFORMED_RESPONSE'});
 for(const over of [{applied:true},{applicationStatus:'applied'},{status:'applied'},{decision:'delete'},{context:'homepage'},{revision:0},{id:ALPHA_UPPER},{id:'not-a-uuid'},{reason:'x'.repeat(2001)}])assert.throws(()=>parseReview(reviewFixture(over)),{code:'MALFORMED_RESPONSE'},JSON.stringify(over));
 // Numeric-only and lowercase alphabetic UUIDs remain valid.
 assert.equal(parseReview(reviewFixture()).id,ID);assert.equal(parseReview(reviewFixture({id:ALPHA})).id,ALPHA);
 assert.throws(()=>parseReview(reviewFixture({evidence:{...reviewFixture().evidence,ruleVersion:'fuzzy'}})),{code:'MALFORMED_RESPONSE'});
 const tooMany=recorder(()=>Response.json({rows:Array.from({length:51},()=>reviewFixture()),page:1,limit:50,hasMore:true,applied:false,applicationStatus:'not-applied'}));
 await assert.rejects(fetchReviewList(1,undefined,{fetcher:tooMany.fetcher}),{code:'MALFORMED_RESPONSE'});
 const listApplied=recorder(()=>Response.json({rows:[],page:1,limit:50,hasMore:false,applied:true,applicationStatus:'not-applied'}));
 await assert.rejects(fetchReviewList(1,undefined,{fetcher:listApplied.fetcher}),{code:'MALFORMED_RESPONSE'});
 const changed=recorder(()=>Response.json({mode:'preview',command:{...submit,decision:'keep'},before:null,after:reviewFixture(),previewHash:HASH,warnings:[],writes:0,applied:false,applicationStatus:'not-applied'}));
 await assert.rejects(previewReviewCommand(submit,session,{fetcher:changed.fetcher}),{code:'MALFORMED_RESPONSE'});
 const wrote=recorder(()=>Response.json({mode:'preview',command:submit,before:null,after:reviewFixture(),previewHash:HASH,warnings:[],writes:1,applied:false,applicationStatus:'not-applied'}));
 await assert.rejects(previewReviewCommand(submit,session,{fetcher:wrote.fetcher}),{code:'MALFORMED_RESPONSE'});
});
test('detail keeps exact stored term and only selected provenance fields; audit is bounded',async()=>{
 const audit=[{sequence:1,request_id:REQ,actor:'user:7',action:'submit',reason:'平台用語',before:null,after:reviewFixture(),created_at:'2026-10-01T00:00:00.000Z'}];
 const ok=recorder(()=>Response.json({review:reviewFixture({evidence:{...reviewFixture().evidence,rawTerm:' 直播 '}}),audit}));
 const detail=await fetchReviewDetail(ID,{fetcher:ok.fetcher});
 assert.equal(ok.calls[0]!.url,'/api/ops/keyword-reviews/'+ID);assert.equal(detail.review.evidence.rawTerm,' 直播 ');
 assert.deepEqual(detail.review.evidence.provenance,{upstreamId:'up-42',media:['公視','<b>x</b>']});assert.doesNotMatch(JSON.stringify(detail),/PAYLOAD_SECRET/);
 assert.equal(detail.audit[0]!.fromStatus,null);assert.equal(detail.audit[0]!.toStatus,'pending');
 const huge=recorder(()=>Response.json({review:reviewFixture(),audit:Array.from({length:101},()=>audit[0])}));
 await assert.rejects(fetchReviewDetail(ID,{fetcher:huge.fetcher}),{code:'MALFORMED_RESPONSE'});
 const badAction=recorder(()=>Response.json({review:reviewFixture(),audit:[{...audit[0],action:'apply'}]}));
 await assert.rejects(fetchReviewDetail(ID,{fetcher:badAction.fetcher}),{code:'MALFORMED_RESPONSE'});
});
test('command builders enforce exact target, mandatory reason and expected revision',()=>{
 let n=0;const ids=()=>['33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444'][n++%2]!;
 const c=buildSubmitCommand({vocabularyVersion:'v2026_10',termKey:KEY,ruleVersion:'exact-text-v1',context:'youtube-text-matching',decision:'keep',reason:'  保留  '},ids);
 assert.deepEqual(c,{requestId:'33333333-3333-4333-8333-333333333333',id:'44444444-4444-4444-8444-444444444444',action:'submit',reason:'保留',vocabularyVersion:'v2026_10',termKey:KEY,ruleVersion:'exact-text-v1',context:'youtube-text-matching',decision:'keep'});
 for(const bad of [{termKey:KEY.toUpperCase()},{termKey:'a'.repeat(63)},{ruleVersion:'fuzzy'},{context:'home'},{decision:'delete'},{reason:'   '},{reason:'a\u0007b'},{reason:'x'.repeat(2001)},{vocabularyVersion:'v 1'}])assert.throws(()=>buildSubmitCommand({vocabularyVersion:'v2026_10',termKey:KEY,ruleVersion:'exact-text-v1',context:'youtube-text-matching',decision:'keep',reason:'ok',...bad},ids),{code:'INVALID_INPUT'},JSON.stringify(bad));
 const d=buildDecideCommand({id:ID,revision:3,status:'pending'},'reject','重複',ids);assert.equal(d.expectedRevision,3);assert.equal(d.id,ID);
 assert.throws(()=>buildDecideCommand({id:ID,revision:3,status:'approved'},'approve','ok',ids),{code:'INVALID_INPUT'});
 assert.throws(()=>buildDecideCommand({id:ID,revision:3,status:'pending'},'approve','',ids),{code:'INVALID_INPUT'});
 assert.equal(reasonProblem('ok'),null);assert.ok(reasonProblem(''));
});

// ---------- public read-only vocabulary lookup ----------
const VKEY='0123456789abcdef'.repeat(4),VKEY2='f'.repeat(64),VVERSION='run_2026_10_13';
const vocabRowFixture=(over:Record<string,unknown>={})=>({key:VKEY,term:' 直播 ',articleCount:12,media:['公視','<b>x</b>',3],provenance:'upstream-article-tag-origin-unspecified',displayExclusion:null,upstreamId:'up-1',secret:'ROW_SECRET',...over});
const vocabBody=(data:Record<string,unknown>={},meta:Record<string,unknown>={})=>({data:{rows:[vocabRowFixture(),{key:VKEY2,term:'直播主',articleCount:3,media:[],provenance:'upstream-article-tag-origin-unspecified',displayExclusion:'平台用語'}],total:2,limit:20,offset:0,version:VVERSION,source:'https://tag.observe.tw',attribution:'新文易數 tag.observe.tw',window:null,publishedAt:null,coverage:'all-current-indexed-article-tags',upstreamSnapshotConsistent:true,...data},meta:{schemaVersion:1,requestedAt:'2026-10-13T00:00:00.000Z',updatedAt:null,timezone:'Asia/Taipei',source:'mariadb',dataset:'fixture',coverage:{},warnings:[],...meta}});
const oneRow=(over:Record<string,unknown>)=>vocabBody({rows:[vocabRowFixture(over)],total:1});

test('vocabulary lookup URL is fixed: encoded trimmed q and limit=20 only',()=>{
 assert.equal(vocabularyLookupUrl('直播'),'/api/v1/vocabulary?q='+encodeURIComponent('直播')+'&limit=20');
 assert.equal(vocabularyLookupUrl('  a&limit=200#x?y=/  '),'/api/v1/vocabulary?q=a%26limit%3D200%23x%3Fy%3D%2F&limit=20');
 for(const bad of ['','   ','x'.repeat(101),'a\u0000b','a\nb'])assert.throws(()=>vocabularyLookupUrl(bad),{code:'VOCABULARY_QUERY_INVALID'},JSON.stringify(bad));
});
test('vocabulary lookup is a public GET with credentials omitted, no CSRF/Authorization, no-store and redirect:error',async()=>{
 const {calls,fetcher}=recorder(()=>Response.json(vocabBody()));
 const out=await lookupVocabulary(' 直播 ',{fetcher});
 assert.equal(calls.length,1);const c=calls[0]!;
 assert.equal(c.url,'/api/v1/vocabulary?q=%E7%9B%B4%E6%92%AD&limit=20');
 assert.equal(c.init?.method,'GET');assert.equal(c.init?.credentials,'omit');assert.equal(c.init?.cache,'no-store');assert.equal(c.init?.redirect,'error');assert.ok(c.init?.signal);assert.equal(c.init?.body,undefined);
 const h=new Headers(c.init?.headers);assert.equal(h.has('authorization'),false);assert.equal(h.has('x-csrf-token'),false);assert.equal(h.has('cookie'),false);
 assert.equal(out.status,'synchronized');
 if(out.status!=='synchronized')return;
 assert.equal(out.version,VVERSION);assert.equal(out.rows.length,2);
 // Exact returned identity: original (untrimmed) term and stored key, no derivation.
 assert.deepEqual(out.rows[0],{key:VKEY,term:' 直播 ',articleCount:12,media:['公視','<b>x</b>'],upstreamId:'up-1',displayExclusion:null});
 assert.equal(out.rows[1]!.displayExclusion,'平台用語');assert.doesNotMatch(JSON.stringify(out),/ROW_SECRET/);
 // Invalid query never fetches.
 await assert.rejects(lookupVocabulary('   ',{fetcher}),{code:'VOCABULARY_QUERY_INVALID'});assert.equal(calls.length,1);
});
test('vocabulary envelope validation fails closed and reports not-synchronized explicitly',()=>{
 const sync=parseVocabularyLookup(vocabBody({version:null,rows:[],total:0}));
 assert.deepEqual(sync,{status:'not-synchronized',version:null,rows:[],total:0,source:'https://tag.observe.tw'});
 const empty=parseVocabularyLookup(vocabBody({rows:[],total:0}));assert.equal(empty.status,'synchronized');assert.equal(empty.rows.length,0);
 const bad:unknown[]=[
  null,[],{data:vocabBody().data},{meta:vocabBody().meta},vocabBody({},{schemaVersion:2}),
  vocabBody({source:'https://evil.test'}),vocabBody({rows:'x'}),vocabBody({rows:Array.from({length:21},(_,i)=>vocabRowFixture({key:i.toString(16).padStart(64,'0')})),total:21}),
  vocabBody({total:1}),vocabBody({total:-1}),vocabBody({version:'bad version'}),vocabBody({version:42}),vocabBody({version:null}),
  vocabBody({rows:[vocabRowFixture(),vocabRowFixture()],total:2}),
  oneRow({key:VKEY.toUpperCase()}),oneRow({key:'a'.repeat(63)}),oneRow({key:7}),oneRow({term:''}),oneRow({term:'x'.repeat(241)}),oneRow({term:null}),
  oneRow({articleCount:-1}),oneRow({articleCount:1.5}),oneRow({media:'公視'}),oneRow({upstreamId:5}),oneRow({displayExclusion:{}}),
 ];
 for(const v of bad)assert.throws(()=>parseVocabularyLookup(v),{code:'VOCABULARY_MALFORMED'},JSON.stringify(v)?.slice(0,120));
});
test('vocabulary lookup errors are explicit, localized and never echo server detail',async()=>{
 const net=recorder(()=>{throw new TypeError('fetch failed: secret-host');});
 await assert.rejects(lookupVocabulary('直播',{fetcher:net.fetcher}),(e:unknown)=>e instanceof KeywordReviewError&&e.code==='VOCABULARY_UNAVAILABLE'&&/重試/.test(e.message)&&!e.message.includes('secret'));
 const missing=recorder(()=>new Response('<html>Not Found</html>',{status:404,headers:{'content-type':'text/html'}}));
 await assert.rejects(lookupVocabulary('直播',{fetcher:missing.fetcher}),{code:'VOCABULARY_UNAVAILABLE'});
 const limited=recorder(()=>Response.json({error:{code:'RATE_LIMITED',message:'x'}},{status:429}));
 await assert.rejects(lookupVocabulary('直播',{fetcher:limited.fetcher}),{code:'VOCABULARY_RATE_LIMITED'});
 const failed=recorder(()=>Response.json({error:{code:'ER_ACCESS_DENIED',message:'secret@db'}},{status:500}));
 await assert.rejects(lookupVocabulary('直播',{fetcher:failed.fetcher}),(e:unknown)=>e instanceof KeywordReviewError&&e.code==='VOCABULARY_UNAVAILABLE'&&!e.message.includes('secret'));
 const notJson=recorder(()=>new Response('nope',{status:200}));
 await assert.rejects(lookupVocabulary('直播',{fetcher:notJson.fetcher}),{code:'VOCABULARY_MALFORMED'});
 const ctrl=new AbortController();ctrl.abort();
 const aborted=recorder((_url,init)=>{if(init?.signal?.aborted)throw new DOMException('aborted','AbortError');return Response.json(vocabBody());});
 await assert.rejects(lookupVocabulary('直播',{fetcher:aborted.fetcher,signal:ctrl.signal}),{code:'ABORTED'});
});
test('selected result fills the proposal with exact returned version/key; nothing is derived from display text',()=>{
 const lookup=parseVocabularyLookup(vocabBody());assert.equal(lookup.status,'synchronized');if(lookup.status!=='synchronized')return;
 const base:SubmitInput={vocabularyVersion:'',termKey:'',ruleVersion:'youtube-quality-v2',context:'youtube-ranking-display',decision:'exclude',reason:'平台用語'};
 const filled=applyVocabularyChoice(base,lookup,lookup.rows[0]!);
 assert.equal(filled.vocabularyVersion,VVERSION);assert.equal(filled.termKey,VKEY);assert.equal(filled.ruleVersion,'youtube-quality-v2');
 const ids=['55555555-5555-4555-8555-555555555555','66666666-6666-4666-8666-666666666666'];let n=0;
 const command=buildSubmitCommand(filled,()=>ids[n++]!);
 assert.equal(command.vocabularyVersion,VVERSION);assert.equal(command.termKey,VKEY);assert.equal('rawTerm' in command,false);
 // A row that is not part of the returned lookup (e.g. edited term or foreign key) is refused.
 assert.throws(()=>applyVocabularyChoice(base,lookup,{...lookup.rows[0]!,term:'直播'}),{code:'INVALID_INPUT'});
 assert.throws(()=>applyVocabularyChoice(base,lookup,{...lookup.rows[0]!,key:'e'.repeat(64)}),{code:'INVALID_INPUT'});
 const unsynced=parseVocabularyLookup(vocabBody({version:null,rows:[],total:0}));
 assert.throws(()=>applyVocabularyChoice(base,unsynced,lookup.rows[0]!),{code:'INVALID_INPUT'});
});

import {isKeywordReviewEndpoint as allowed,decideRankingDisplay as decide,parseRankingDisplay as parseExclusions} from './keyword-review-client';
test('one-click ranking display calls the exact endpoint with CSRF and validates the answer',async()=>{
 assert.equal(allowed('/api/ops/keyword-reviews/ranking-display','POST'),true);assert.equal(allowed('/api/ops/keyword-reviews/ranking-display','GET'),true);
 assert.equal(allowed('/api/ops/keyword-reviews/ranking-display?x=1','GET'),false);assert.equal(allowed('/api/ops/keyword-reviews/ranking-display','DELETE'),false);
 const session={enabled:true,user:{id:1,email:'a@example.test',name:null,picture:null,role:'admin' as const,adminSource:'config' as const},csrfToken:'csrf'};
 let seen:{url:string;init:RequestInit}|null=null;
 const fetcher=(async(url:string,init:RequestInit)=>{seen={url,init};return Response.json({decision:'exclude',changed:true,results:[{term:'OpenAI',status:'decided'},{term:'openai',status:'unchanged'}]});}) as unknown as typeof fetch;
 const result=await decide(['OpenAI','openai'],'exclude',session as never,'',{fetcher,newId:()=>'33333333-3333-4333-8333-333333333333'});
 assert.deepEqual(result,{decision:'exclude',changed:true,results:[{term:'OpenAI',status:'decided'},{term:'openai',status:'unchanged'}]});
 assert.equal(seen!.url,'/api/ops/keyword-reviews/ranking-display');assert.equal((seen!.init.headers as Record<string,string>)['x-csrf-token'],'csrf');
 assert.deepEqual(JSON.parse(String(seen!.init.body)),{requestId:'33333333-3333-4333-8333-333333333333',terms:['OpenAI','openai'],decision:'exclude'});
 await assert.rejects(decide(['OpenAI'],'exclude',session as never,'',{fetcher:(async()=>Response.json({decision:'exclude',changed:true,results:[{term:'other',status:'decided'}]})) as unknown as typeof fetch}),/伺服器回應格式無法驗證/);
 await assert.rejects(decide([],'exclude',session as never),/排行決定的內容不正確/);
 assert.throws(()=>parseExclusions({rows:[{termKey:'bad'}]}),/伺服器回應格式無法驗證/);
});
